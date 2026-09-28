// SQLite storage for the webStats events, plus the per player statistics
// derived from them while they are ingested.

import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server TEXT NOT NULL,
  run TEXT NOT NULL,
  seq INTEGER NOT NULL,
  t INTEGER NOT NULL,
  type TEXT NOT NULL,
  player_key TEXT,
  other_key TEXT,
  data TEXT NOT NULL,
  UNIQUE (server, run, seq)
);
CREATE INDEX IF NOT EXISTS events_t ON events (t);
CREATE INDEX IF NOT EXISTS events_type ON events (type, id);
CREATE INDEX IF NOT EXISTS events_player ON events (player_key, id);
CREATE INDEX IF NOT EXISTS events_other ON events (other_key, id);

CREATE TABLE IF NOT EXISTS players (
  key TEXT PRIMARY KEY,
  callsign TEXT NOT NULL,
  bzid TEXT,
  first_seen INTEGER,
  last_seen INTEGER,
  joins INTEGER DEFAULT 0,
  kills INTEGER DEFAULT 0,
  deaths INTEGER DEFAULT 0,
  suicides INTEGER DEFAULT 0,
  teamkills INTEGER DEFAULT 0,
  captures INTEGER DEFAULT 0,
  flags INTEGER DEFAULT 0,
  messages INTEGER DEFAULT 0,
  playtime_ms INTEGER DEFAULT 0,
  sessions_opened INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kills (
  t INTEGER NOT NULL,
  server TEXT NOT NULL,
  killer_key TEXT NOT NULL,
  victim_key TEXT NOT NULL,
  flag TEXT
);
CREATE INDEX IF NOT EXISTS kills_killer ON kills (killer_key);
CREATE INDEX IF NOT EXISTS kills_victim ON kills (victim_key);

CREATE TABLE IF NOT EXISTS player_flags (
  key TEXT NOT NULL,
  flag TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (key, flag)
);

CREATE TABLE IF NOT EXISTS servers (
  name TEXT PRIMARY KEY,
  run TEXT,
  description TEXT,
  running INTEGER DEFAULT 0,
  last_seen INTEGER,
  open_session INTEGER
);

CREATE TABLE IF NOT EXISTS online (
  server TEXT NOT NULL,
  pid INTEGER NOT NULL,
  key TEXT NOT NULL,
  callsign TEXT NOT NULL,
  team TEXT,
  since INTEGER NOT NULL,
  PRIMARY KEY (server, pid)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  opener TEXT,
  opener_key TEXT,
  peak INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS session_players (
  session_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  callsign TEXT NOT NULL,
  PRIMARY KEY (session_id, key)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created INTEGER NOT NULL,
  failures INTEGER DEFAULT 0
);
`;

// Fields that never leave the server through the public API
const PRIVATE_FIELDS = ['ip'];

export function playerKey(callsign, bzid) {
  if (bzid) return `bz:${bzid}`;
  if (!callsign) return null;
  return `cs:${callsign.toLowerCase()}`;
}

export class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this.stmts = new Map();
  }

  q(sql) {
    let stmt = this.stmts.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmts.set(sql, stmt);
    }
    return stmt;
  }

  close() {
    this.db.close();
  }

  // Stores a batch of plugin events. Returns the events that were new, each
  // with the extra fields the caller may need (id, notify decisions).
  ingest(events, { notifyCooldownMs = 10 * 60 * 1000 } = {}) {
    const accepted = [];
    this.db.exec('BEGIN');
    try {
      for (const ev of events) {
        if (!ev || typeof ev !== 'object' || !ev.server || !ev.run || !Number.isFinite(ev.seq) || !ev.type) continue;
        ev.t = Number.isFinite(ev.t) ? ev.t : Date.now();
        const [pk, ok] = this.eventKeys(ev);
        const res = this.q(`INSERT OR IGNORE INTO events (server, run, seq, t, type, player_key, other_key, data)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(ev.server, String(ev.run), ev.seq, ev.t, ev.type, pk, ok, JSON.stringify(ev));
        if (res.changes === 0) continue; // already seen
        const out = { id: Number(res.lastInsertRowid), event: ev };
        this.apply(ev, out, notifyCooldownMs);
        accepted.push(out);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return accepted;
  }

  eventKeys(ev) {
    switch (ev.type) {
      case 'join': case 'part': case 'game-open':
        return [playerKey(ev.callsign, ev.bzid), null];
      case 'kill':
        return [playerKey(ev.killerCallsign, ev.killerBzid), playerKey(ev.victimCallsign, ev.victimBzid)];
      case 'capture': case 'flag': case 'auth':
        return [playerKey(ev.playerCallsign, ev.playerBzid), null];
      case 'chat':
        return [ev.fromCallsign === 'SERVER' ? null : playerKey(ev.fromCallsign, ev.fromBzid),
          playerKey(ev.toCallsign, ev.toBzid)];
      default:
        return [null, null];
    }
  }

  touchPlayer(key, callsign, bzid, t) {
    if (!key) return;
    this.q(`INSERT INTO players (key, callsign, bzid, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (key) DO UPDATE SET callsign = excluded.callsign,
              bzid = COALESCE(excluded.bzid, players.bzid),
              last_seen = MAX(players.last_seen, excluded.last_seen)`)
      .run(key, callsign, bzid || null, t, t);
  }

  bump(key, column, amount = 1) {
    if (!key) return;
    this.q(`UPDATE players SET ${column} = ${column} + ? WHERE key = ?`).run(amount, key);
  }

  // Closes an online row, crediting its play time
  leave(server, pid, t) {
    const row = this.q('SELECT * FROM online WHERE server = ? AND pid = ?').get(server, pid);
    if (!row) return;
    if (row.team !== 'observer') this.bump(row.key, 'playtime_ms', Math.max(0, t - row.since));
    this.q('DELETE FROM online WHERE server = ? AND pid = ?').run(server, pid);
  }

  closeServer(server, t) {
    for (const row of this.q('SELECT pid FROM online WHERE server = ?').all(server)) this.leave(server, row.pid, t);
    this.closeSession(server, t);
  }

  closeSession(server, t) {
    const srv = this.q('SELECT open_session FROM servers WHERE name = ?').get(server);
    if (!srv || !srv.open_session) return;
    this.q('UPDATE sessions SET closed_at = ? WHERE id = ?').run(t, srv.open_session);
    this.q('UPDATE servers SET open_session = NULL WHERE name = ?').run(server);
  }

  addToSession(server, key, callsign, players) {
    const srv = this.q('SELECT open_session FROM servers WHERE name = ?').get(server);
    if (!srv || !srv.open_session || !key) return;
    this.q('INSERT OR IGNORE INTO session_players (session_id, key, callsign) VALUES (?, ?, ?)')
      .run(srv.open_session, key, callsign);
    if (Number.isFinite(players)) {
      this.q('UPDATE sessions SET peak = MAX(peak, ?) WHERE id = ?').run(players, srv.open_session);
    }
  }

  join(ev, key) {
    this.touchPlayer(key, ev.callsign, ev.bzid, ev.t);
    this.q(`INSERT OR REPLACE INTO online (server, pid, key, callsign, team, since) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(ev.server, ev.pid, key, ev.callsign, ev.team || '', ev.t);
  }

  apply(ev, out, notifyCooldownMs) {
    const { server, t } = ev;
    const prev = this.q('SELECT run, last_seen FROM servers WHERE name = ?').get(server);
    this.q(`INSERT INTO servers (name, run, running, last_seen) VALUES (?, ?, 1, ?)
            ON CONFLICT (name) DO UPDATE SET last_seen = MAX(COALESCE(servers.last_seen, 0), excluded.last_seen)`)
      .run(server, String(ev.run), t);

    switch (ev.type) {
      case 'server-start': {
        if (prev && prev.run !== String(ev.run)) this.closeServer(server, prev.last_seen || t);
        this.q('DELETE FROM online WHERE server = ?').run(server);
        this.q('UPDATE servers SET run = ?, running = 1, description = ? WHERE name = ?')
          .run(String(ev.run), ev.description || '', server);
        for (const p of ev.players || []) {
          const key = playerKey(p.callsign, p.bzid);
          if (key) this.join({ ...p, server, t }, key);
        }
        break;
      }
      case 'server-stop':
        this.closeServer(server, t);
        this.q('UPDATE servers SET running = 0 WHERE name = ?').run(server);
        break;
      case 'join': {
        const key = playerKey(ev.callsign, ev.bzid);
        if (!key) break;
        this.join(ev, key);
        this.bump(key, 'joins');
        if (ev.team !== 'observer') this.addToSession(server, key, ev.callsign, ev.players);
        break;
      }
      case 'part':
        this.leave(server, ev.pid, t);
        break;
      case 'game-open': {
        const key = playerKey(ev.callsign, ev.bzid);
        // a quick reconnect should not wake everybody up again
        const last = this.q('SELECT MAX(closed_at) AS closed FROM sessions WHERE server = ?').get(server);
        out.notify = !(last && last.closed && t - last.closed < notifyCooldownMs);
        this.closeSession(server, t);
        const res = this.q('INSERT INTO sessions (server, opened_at, opener, opener_key) VALUES (?, ?, ?, ?)')
          .run(server, t, ev.callsign, key);
        this.q('UPDATE servers SET open_session = ? WHERE name = ?').run(Number(res.lastInsertRowid), server);
        this.addToSession(server, key, ev.callsign, 1);
        this.bump(key, 'sessions_opened');
        break;
      }
      case 'game-empty':
        this.closeSession(server, t);
        break;
      case 'kill': {
        const victim = playerKey(ev.victimCallsign, ev.victimBzid);
        const killer = playerKey(ev.killerCallsign, ev.killerBzid);
        this.touchPlayer(victim, ev.victimCallsign, ev.victimBzid, t);
        this.bump(victim, 'deaths');
        if (!killer || ev.killerCallsign === 'SERVER') break;
        this.touchPlayer(killer, ev.killerCallsign, ev.killerBzid, t);
        if (ev.killerPid === ev.victimPid) {
          this.bump(killer, 'suicides');
        } else if (ev.teamKill) {
          this.bump(killer, 'teamkills');
        } else {
          this.bump(killer, 'kills');
          this.q('INSERT INTO kills (t, server, killer_key, victim_key, flag) VALUES (?, ?, ?, ?, ?)')
            .run(t, server, killer, victim, ev.flag || '');
        }
        break;
      }
      case 'capture': {
        const key = playerKey(ev.playerCallsign, ev.playerBzid);
        this.touchPlayer(key, ev.playerCallsign, ev.playerBzid, t);
        this.bump(key, 'captures');
        break;
      }
      case 'flag': {
        const key = playerKey(ev.playerCallsign, ev.playerBzid);
        if (!key || !ev.flag) break;
        this.touchPlayer(key, ev.playerCallsign, ev.playerBzid, t);
        this.bump(key, 'flags');
        this.q(`INSERT INTO player_flags (key, flag, count) VALUES (?, ?, 1)
                ON CONFLICT (key, flag) DO UPDATE SET count = count + 1`).run(key, ev.flag);
        break;
      }
      case 'chat': {
        if (ev.fromCallsign === 'SERVER') break;
        const key = playerKey(ev.fromCallsign, ev.fromBzid);
        this.touchPlayer(key, ev.fromCallsign, ev.fromBzid, t);
        this.bump(key, 'messages');
        break;
      }
      default:
        break;
    }
  }

  // ---- queries used by the HTTP API ----

  static publicEvent(row) {
    const data = JSON.parse(row.data);
    for (const f of PRIVATE_FIELDS) delete data[f];
    return { id: row.id, ...data };
  }

  events({ before, after, limit = 100, types, player, q, server } = {}) {
    const where = [];
    const args = [];
    if (before) { where.push('id < ?'); args.push(before); }
    if (after) { where.push('id > ?'); args.push(after); }
    if (types && types.length) { where.push(`type IN (${types.map(() => '?').join(',')})`); args.push(...types); }
    if (player) { where.push('(player_key = ? OR other_key = ?)'); args.push(player, player); }
    if (server) { where.push('server = ?'); args.push(server); }
    if (q) { where.push('data LIKE ?'); args.push(`%${q}%`); }
    limit = Math.min(Math.max(1, limit | 0), 500);
    const sql = `SELECT id, data FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY id ${after ? 'ASC' : 'DESC'} LIMIT ${limit}`;
    const rows = this.db.prepare(sql).all(...args).map(Store.publicEvent);
    return after ? rows.reverse() : rows;
  }

  players({ sort = 'kills', since } = {}) {
    const columns = ['kills', 'deaths', 'captures', 'playtime_ms', 'joins', 'last_seen', 'teamkills', 'ratio', 'sessions_opened'];
    if (!columns.includes(sort)) sort = 'kills';
    const order = sort === 'ratio' ? 'CAST(kills AS REAL) / MAX(deaths, 1)' : sort;
    const where = since ? 'WHERE last_seen >= ?' : '';
    return this.db.prepare(`SELECT *, ROUND(CAST(kills AS REAL) / MAX(deaths, 1), 2) AS ratio
                            FROM players ${where} ORDER BY ${order} DESC, callsign LIMIT 500`)
      .all(...(since ? [since] : []));
  }

  player(key) {
    const player = this.q(`SELECT *, ROUND(CAST(kills AS REAL) / MAX(deaths, 1), 2) AS ratio
                           FROM players WHERE key = ?`).get(key);
    if (!player) return null;
    const victims = this.q(`SELECT k.victim_key AS key, p.callsign, COUNT(*) AS count FROM kills k
                            LEFT JOIN players p ON p.key = k.victim_key WHERE k.killer_key = ?
                            GROUP BY k.victim_key ORDER BY count DESC LIMIT 10`).all(key);
    const killers = this.q(`SELECT k.killer_key AS key, p.callsign, COUNT(*) AS count FROM kills k
                            LEFT JOIN players p ON p.key = k.killer_key WHERE k.victim_key = ?
                            GROUP BY k.killer_key ORDER BY count DESC LIMIT 10`).all(key);
    const killFlags = this.q(`SELECT flag, COUNT(*) AS count FROM kills WHERE killer_key = ?
                              GROUP BY flag ORDER BY count DESC LIMIT 10`).all(key);
    const flags = this.q('SELECT flag, count FROM player_flags WHERE key = ? ORDER BY count DESC LIMIT 10').all(key);
    const hours = this.q(`SELECT CAST(strftime('%H', t / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                          COUNT(*) AS count FROM events WHERE player_key = ? AND type = 'join'
                          GROUP BY hour`).all(key);
    const sessions = this.q(`SELECT s.* FROM sessions s JOIN session_players sp ON sp.session_id = s.id
                             WHERE sp.key = ? ORDER BY s.id DESC LIMIT 20`).all(key);
    return { player, victims, killers, killFlags, flags, hours, sessions };
  }

  online() {
    return this.q('SELECT server, pid, key, callsign, team, since FROM online ORDER BY server, since').all();
  }

  servers() {
    return this.q('SELECT name, description, running, last_seen, open_session FROM servers ORDER BY name').all();
  }

  sessions({ limit = 30 } = {}) {
    const sessions = this.db.prepare(`SELECT * FROM sessions ORDER BY id DESC LIMIT ${Math.min(limit | 0 || 30, 200)}`).all();
    const members = this.q('SELECT key, callsign FROM session_players WHERE session_id = ?');
    return sessions.map((s) => ({ ...s, players: members.all(s.id) }));
  }

  summary() {
    return this.q(`SELECT (SELECT COUNT(*) FROM players) AS players,
                          (SELECT COUNT(*) FROM sessions) AS sessions,
                          (SELECT COALESCE(SUM(kills), 0) FROM players) AS kills,
                          (SELECT COALESCE(SUM(playtime_ms), 0) FROM players) AS playtime_ms,
                          (SELECT COUNT(*) FROM subscriptions) AS subscribers`).get();
  }

  // ---- push subscriptions ----

  subscribe({ endpoint, keys }) {
    this.q(`INSERT INTO subscriptions (endpoint, p256dh, auth, created) VALUES (?, ?, ?, ?)
            ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, failures = 0`)
      .run(endpoint, keys.p256dh, keys.auth, Date.now());
  }

  unsubscribe(endpoint) {
    this.q('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint);
  }

  subscription(endpoint) {
    return this.q('SELECT * FROM subscriptions WHERE endpoint = ?').get(endpoint);
  }

  subscriptions() {
    return this.q('SELECT * FROM subscriptions').all();
  }

  pushFailed(endpoint, gone) {
    if (gone) return this.unsubscribe(endpoint);
    this.q('UPDATE subscriptions SET failures = failures + 1 WHERE endpoint = ?').run(endpoint);
    this.q('DELETE FROM subscriptions WHERE endpoint = ? AND failures >= 10').run(endpoint);
  }

  pushOk(endpoint) {
    this.q('UPDATE subscriptions SET failures = 0 WHERE endpoint = ?').run(endpoint);
  }
}
