#!/usr/bin/env node
// webStats web service: receives events from the bzfs webStats plugin,
// keeps the history in SQLite, serves the web page and sends Web Push
// notifications when somebody opens a game.
//
//   node server.js                    start the service
//   node server.js import FILE.jsonl  import the plugin's file output

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.js';
import { loadOrCreateVapidKeys, sendPush } from './lib/webpush.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(here, 'data'),
  ingestKey: process.env.INGEST_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@localhost',
  notifyCooldownMs: Number(process.env.NOTIFY_COOLDOWN_MIN ?? 10) * 60 * 1000,
  // events older than this are history (e.g. an import), never notify for them
  notifyMaxAgeMs: 5 * 60 * 1000,
};

fs.mkdirSync(config.dataDir, { recursive: true });
const store = new Store(path.join(config.dataDir, 'webstats.db'));

if (process.argv[2] === 'import') {
  await importFile(process.argv[3]);
  process.exit(0);
}

const vapid = loadOrCreateVapidKeys(config.dataDir);
const streams = new Set();

async function importFile(file) {
  if (!file) {
    console.error('usage: node server.js import FILE.jsonl');
    process.exit(1);
  }
  const lines = readline.createInterface({ input: fs.createReadStream(file) });
  let batch = [];
  let total = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      batch.push(JSON.parse(line));
    } catch {
      continue;
    }
    if (batch.length >= 1000) {
      total += store.ingest(batch, config).length;
      batch = [];
    }
  }
  total += store.ingest(batch, config).length;
  console.log(`imported ${total} new events from ${file}`);
}

// ---- push notifications ----

async function notifyAll(payload) {
  const subs = store.subscriptions();
  await Promise.all(subs.map(async (sub) => {
    try {
      const res = await sendPush(sub, payload, vapid, config.vapidSubject);
      if (res.ok) store.pushOk(sub.endpoint);
      else {
        console.warn(`push to ${new URL(sub.endpoint).host} failed: ${res.status}`);
        store.pushFailed(sub.endpoint, res.gone);
      }
    } catch (err) {
      console.warn(`push failed: ${err.message}`);
      store.pushFailed(sub.endpoint, false);
    }
  }));
}

function gameOpenNotification(ev) {
  const where = ev.description || ev.server;
  return {
    title: 'BZFlag: a început un joc',
    body: `${ev.callsign} a intrat pe ${where}`,
    tag: `game-open:${ev.server}`,
    url: '#live',
  };
}

// ---- HTTP helpers ----

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  return JSON.parse(await readBody(req));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  const publicDir = path.join(here, 'public');
  const file = path.normalize(path.join(publicDir, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(publicDir + path.sep)) return send(res, 404, 'not found');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found');
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
    // the service worker must always be fresh so updates reach the phones
    headers['Cache-Control'] = path.basename(file) === 'sw.js' ? 'no-cache' : 'public, max-age=300';
    res.writeHead(200, headers);
    res.end(data);
  });
}

function isLoopback(req) {
  // behind a reverse proxy every request looks local
  if (req.headers['x-forwarded-for'] || req.headers.forwarded) return false;
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// ---- routes ----

async function ingest(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'invalid json' });
  }
  const allowed = config.ingestKey ? body.key === config.ingestKey : isLoopback(req);
  if (!allowed) return send(res, 403, { error: 'bad key' });
  if (!Array.isArray(body.events)) return send(res, 400, { error: 'events missing' });

  const accepted = store.ingest(body.events, config);
  send(res, 200, { accepted: accepted.length });

  for (const { id, event, notify } of accepted) {
    const pub = Store.publicEvent({ id, data: JSON.stringify(event) });
    const line = `id: ${id}\ndata: ${JSON.stringify(pub)}\n\n`;
    for (const stream of streams) stream.write(line);
    if (event.type === 'game-open' && notify && Date.now() - event.t < config.notifyMaxAgeMs) {
      notifyAll(gameOpenNotification(event));
    }
  }
}

function stream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  // resend what was missed while reconnecting
  const lastId = Number(req.headers['last-event-id']);
  if (lastId) {
    for (const ev of store.events({ after: lastId, limit: 500 })) {
      res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
    }
  }
  streams.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    streams.delete(res);
  });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const qs = url.searchParams;

  if (req.method === 'POST' && p === '/api/ingest') return ingest(req, res);
  if (req.method === 'GET' && p === '/api/stream') return stream(req, res);

  if (req.method === 'GET' && p === '/api/events') {
    const types = qs.get('types') ? qs.get('types').split(',').filter(Boolean) : null;
    return send(res, 200, store.events({
      before: Number(qs.get('before')) || undefined,
      after: Number(qs.get('after')) || undefined,
      limit: Number(qs.get('limit')) || 100,
      types,
      player: qs.get('player') || undefined,
      server: qs.get('server') || undefined,
      q: qs.get('q') || undefined,
    }));
  }
  if (req.method === 'GET' && p === '/api/live') {
    return send(res, 200, {
      servers: store.servers(),
      online: store.online(),
      sessions: store.sessions({ limit: 10 }),
      summary: store.summary(),
    });
  }
  if (req.method === 'GET' && p === '/api/sessions') {
    return send(res, 200, store.sessions({ limit: Number(qs.get('limit')) || 30 }));
  }
  if (req.method === 'GET' && p === '/api/players') {
    const days = Number(qs.get('days'));
    return send(res, 200, store.players({
      sort: qs.get('sort') || 'kills',
      since: days > 0 ? Date.now() - days * 86400000 : undefined,
    }));
  }
  if (req.method === 'GET' && p.startsWith('/api/players/')) {
    const data = store.player(decodeURIComponent(p.slice('/api/players/'.length)));
    return data ? send(res, 200, data) : send(res, 404, { error: 'unknown player' });
  }

  if (req.method === 'GET' && p === '/api/push/key') return send(res, 200, { key: vapid.publicKey });
  if (req.method === 'POST' && p.startsWith('/api/push/')) {
    let sub;
    try {
      sub = await readJson(req);
    } catch {
      return send(res, 400, { error: 'invalid json' });
    }
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) {
      return send(res, 400, { error: 'invalid subscription' });
    }
    if (p === '/api/push/subscribe') {
      if (!sub.keys || !sub.keys.p256dh || !sub.keys.auth) return send(res, 400, { error: 'invalid subscription' });
      store.subscribe(sub);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/push/unsubscribe') {
      store.unsubscribe(sub.endpoint);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/push/test') {
      const known = store.subscription(sub.endpoint);
      if (!known) return send(res, 404, { error: 'not subscribed' });
      try {
        const result = await sendPush(known, {
          title: 'BZFlag', body: 'Notificările funcționează!', tag: 'test', url: '#live',
        }, vapid, config.vapidSubject);
        return send(res, result.ok ? 200 : 502, result);
      } catch (err) {
        return send(res, 502, { error: err.message });
      }
    }
  }

  if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(req, res, p);
  return send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'internal error' });
    else res.end();
  });
});

server.listen(config.port, config.host, () => {
  console.log(`webStats listening on http://${config.host}:${config.port}`);
  if (!config.ingestKey) console.log('INGEST_KEY not set: only accepting events from localhost');
});

function shutdown() {
  for (const s of streams) s.end();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
