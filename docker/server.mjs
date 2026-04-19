// BZFlag web server — serves WASM client + WebSocket proxy to bzfs
// Single port handles both HTTP (static files) and WS (game traffic)
// Serves custom index.html with player name entry and server config

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { createConnection } from 'net';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

const PORT = parseInt(process.env.PORT || '8080');
const BZFS_PORT = parseInt(process.env.BZFS_PORT || '5154');
const STATIC_DIR = process.env.STATIC_DIR || '/app/public';
const BZFS_ARGS = (process.env.BZFS_ARGS || '-j +r -ms 10 -mp 20 -noMasterBanlist -noudp').split(' ');
const BUILD_ID = Date.now().toString(36); // cache buster

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ── Start bzfs ─────────────────────────────────────────────────────
console.log(`[bzfs] Starting: bzfs -p ${BZFS_PORT} ${BZFS_ARGS.join(' ')}`);
const bzfs = spawn('bzfs', ['-p', String(BZFS_PORT), ...BZFS_ARGS], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

bzfs.stdout.on('data', (d) => process.stdout.write(`[bzfs] ${d}`));
bzfs.stderr.on('data', (d) => process.stderr.write(`[bzfs] ${d}`));
bzfs.on('exit', (code) => {
  console.error(`[bzfs] Exited with code ${code}`);
  process.exit(1);
});

// Build the custom index.html with lobby + game
function buildIndexHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BZFlag</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: #1a1a2e; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

  #lobby {
    position: fixed; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; background: #1a1a2e; color: #e0e0e0; z-index: 20;
  }
  #lobby h1 { font-size: 2.5rem; margin-bottom: 0.5rem; color: #fff; }
  #lobby .subtitle { color: #999; margin-bottom: 2rem; font-size: 0.95rem; }
  #lobby label { display: block; margin-bottom: 0.5rem; color: #ccc; font-size: 0.9rem; }
  #lobby input, #lobby select {
    width: 260px; padding: 0.6rem 1rem; font-size: 1rem; border: 1px solid #444;
    border-radius: 6px; background: #2a2a4a; color: #fff; outline: none;
    font-family: inherit; margin-bottom: 1.5rem; text-align: center;
  }
  #lobby input:focus, #lobby select:focus { border-color: #4a9eff; }
  .btn-row { display: flex; gap: 1rem; margin-top: 0.5rem; }
  .play-btn {
    padding: 0.75rem 2rem; font-size: 1.1rem; color: #fff;
    border: none; border-radius: 6px; cursor: pointer; font-family: inherit;
  }
  #play-multi { background: #4a9eff; }
  #play-multi:hover { background: #3a8eef; }
  #play-solo { background: #555; }
  #play-solo:hover { background: #666; }
  #lobby .info { margin-top: 1.5rem; color: #666; font-size: 0.8rem; }

  #game-container { display: none; width: 100%; height: 100%; }
  #canvas { display: block; width: 100%; height: 100%; outline: none; }

  #loading {
    position: fixed; inset: 0; display: none; flex-direction: column;
    align-items: center; justify-content: center; background: #1a1a2e; color: #e0e0e0; z-index: 10;
  }
  #loading h1 { font-size: 2rem; margin-bottom: 1.5rem; color: #fff; }
  #progress-container { width: 320px; height: 8px; background: #2a2a4a; border-radius: 4px; overflow: hidden; }
  #progress-bar { width: 0%; height: 100%; background: #4a9eff; border-radius: 4px; transition: width 0.2s ease; }
  #progress-text { margin-top: 0.75rem; font-size: 0.875rem; color: #999; }

  #restart-screen {
    position: fixed; inset: 0; display: none; flex-direction: column;
    align-items: center; justify-content: center; background: #1a1a2e; color: #e0e0e0; z-index: 10;
  }
  #restart-screen h1 { font-size: 2rem; margin-bottom: 1.5rem; color: #fff; }
  #restart-screen p { margin-bottom: 1.5rem; color: #999; font-size: 0.95rem; }
  #restart-btn {
    padding: 0.75rem 2rem; font-size: 1.1rem; background: #4a9eff; color: #fff;
    border: none; border-radius: 6px; cursor: pointer; font-family: inherit;
  }
  #restart-btn:hover { background: #3a8eef; }
</style>
</head>
<body>

<!-- Lobby -->
<div id="lobby">
  <h1>BZFlag</h1>
  <div class="subtitle">Multiplayer Tank Battle</div>
  <label for="callsign">Your Name</label>
  <input id="callsign" type="text" maxlength="31" placeholder="Enter callsign" autocomplete="off" spellcheck="false">
  <label for="team">Team</label>
  <select id="team">
    <option value="rogue">Rogue (Free-for-all)</option>
    <option value="red">Red</option>
    <option value="green">Green</option>
    <option value="blue">Blue</option>
    <option value="purple">Purple</option>
    <option value="observer">Observer</option>
  </select>
  <div class="btn-row">
    <button id="play-multi" class="play-btn">Multiplayer</button>
    <button id="play-solo" class="play-btn">Solo + Bots</button>
  </div>
  <div class="info">Jump: Tab &bull; Shoot: Enter &bull; Move: Arrow keys</div>
</div>

<!-- Loading screen -->
<div id="loading">
  <h1>BZFlag</h1>
  <div id="progress-container"><div id="progress-bar"></div></div>
  <div id="progress-text">Loading...</div>
</div>

<!-- Restart screen -->
<div id="restart-screen">
  <h1>BZFlag</h1>
  <p>Game ended.</p>
  <button id="restart-btn">Play Again</button>
</div>

<!-- Game container -->
<div id="game-container">
  <canvas id="canvas" tabindex="0"></canvas>
</div>

<!-- Mock BZFlag server for solo mode -->
<script src="mock-server.js?v=${BUILD_ID}"></script>
<script>
(function() {
  var MockBZFlagServer = window.MockBZFlagServer;
  if (!MockBZFlagServer) return;

  window.__bzCreateMockServer = function() {
    var mockServer = new MockBZFlagServer({
      worldSize: 800.0, gameType: 1, maxShots: 10, maxPlayers: 20, debug: true,
    });
    window.__bzMockServer = mockServer;
    return mockServer;
  };
  window.__bzCreateMockServer();

  function MockWebSocketAdapter(server) {
    this.server = server;
    this.readyState = 0;
    this.binaryType = 'arraybuffer';
    this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
    this.bufferedAmount = 0; this.extensions = ''; this.protocol = ''; this.url = '';
    this.CONNECTING = 0; this.OPEN = 1; this.CLOSING = 2; this.CLOSED = 3;
    var self = this;
    var serverAdapter = {
      send: function(data) {
        if (self.readyState !== 1) return;
        var ab = data instanceof ArrayBuffer ? data : data.buffer || data;
        if (self.onmessage) setTimeout(function() { if (self.onmessage) self.onmessage({ data: ab }); }, 0);
      },
      close: function() { self._doClose(); },
      _handshakePhase: 'waiting_header', _handshakeBuf: new Uint8Array(0),
      _playerId: -1, _msgBuf: new Uint8Array(0),
    };
    this._playerId = server.onConnection(serverAdapter);
    setTimeout(function() { self.readyState = 1; if (self.onopen) self.onopen({}); }, 0);
  }
  MockWebSocketAdapter.prototype.send = function(data) {
    if (this.readyState !== 1) return;
    var bytes;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (data instanceof Uint8Array) bytes = data;
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else bytes = new TextEncoder().encode(data);
    var server = this.server; var playerId = this._playerId;
    setTimeout(function() { server.onMessage(playerId, bytes); }, 0);
  };
  MockWebSocketAdapter.prototype.close = function() {
    if (this.readyState >= 2) return;
    this.readyState = 2; this.server.onDisconnect(this._playerId); this._doClose();
  };
  MockWebSocketAdapter.prototype._doClose = function() {
    if (this.readyState === 3) return; this.readyState = 3;
    var self = this;
    if (this.onclose) setTimeout(function() { if (self.onclose) self.onclose({ code: 1000, reason: '', wasClean: true }); }, 0);
  };
  MockWebSocketAdapter.prototype.addEventListener = function(type, fn) {
    if (type === 'open') this.onopen = fn;
    else if (type === 'message') this.onmessage = fn;
    else if (type === 'close') this.onclose = fn;
    else if (type === 'error') this.onerror = fn;
  };
  MockWebSocketAdapter.prototype.removeEventListener = function() {};

  var RealWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    if (typeof url === 'string' && (url.indexOf('localhost') !== -1 || url.indexOf('127.0.0.1') !== -1)) {
      console.log('[BZFlag] Intercepting WebSocket to ' + url + ' -> mock server');
      var adapter = new MockWebSocketAdapter(window.__bzMockServer);
      adapter.url = url;
      return adapter;
    }
    // Multiplayer: rewrite ws://host:port to use same-origin WebSocket proxy
    var wsUrl = url;
    if (typeof url === 'string') {
      var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      wsUrl = proto + location.host + '/';
      console.log('[BZFlag] Rewriting WebSocket ' + url + ' -> ' + wsUrl);
    }
    return protocols !== undefined ? new RealWebSocket(wsUrl, protocols) : new RealWebSocket(wsUrl);
  };
  window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1;
  window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;
  window.WebSocket.prototype = RealWebSocket.prototype;
})();
</script>

<script>
  var _resizing = false;
  function resizeCanvas() {
    if (_resizing) return;
    _resizing = true;
    var canvas = document.getElementById('canvas');
    if (!canvas || canvas.style.display === 'none') { _resizing = false; return; }
    var w = window.innerWidth, h = window.innerHeight;
    canvas.width = w; canvas.height = h;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    _resizing = false;
  }
  window.addEventListener('resize', resizeCanvas);

  window.__bzOnGameExit = function() {
    console.log('[BZFlag] Game exited');
    var c = document.getElementById('canvas');
    if (c) c.style.display = 'none';
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('restart-screen').style.display = 'flex';
  };

  document.getElementById('restart-btn').addEventListener('click', function() {
    window.location.reload();
  });

  // Lobby state
  var savedName = localStorage.getItem('bzflag-callsign') || '';
  var savedTeam = localStorage.getItem('bzflag-team') || 'rogue';
  var callsignInput = document.getElementById('callsign');
  var teamSelect = document.getElementById('team');
  if (savedName) callsignInput.value = savedName;
  teamSelect.value = savedTeam;
  callsignInput.focus();
  callsignInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('play-multi').click();
  });

  function startGame(solo) {
    var callsign = callsignInput.value.trim();
    if (!callsign) { callsignInput.focus(); return; }
    var team = teamSelect.value;

    localStorage.setItem('bzflag-callsign', callsign);
    localStorage.setItem('bzflag-team', team);

    document.getElementById('lobby').style.display = 'none';
    document.getElementById('loading').style.display = 'flex';
    document.getElementById('game-container').style.display = 'block';
    resizeCanvas();

    var canvas = document.getElementById('canvas');
    var args = ['-window', canvas.width + 'x' + canvas.height, '-time', '12:00:00', '-longitude', '0', '-nolist', '-mute', '-team', team];

    if (solo) {
      args.push('-solo', '3', callsign + '@localhost');
    } else {
      args.push(callsign + '@' + location.host);
    }

    console.log('[BZFlag] Starting with args:', args);

    window.Module = {
      canvas: canvas,
      arguments: args,
      setStatus: function(text) {
        var el = document.getElementById('loading');
        var bar = document.getElementById('progress-bar');
        var txt = document.getElementById('progress-text');
        if (!text) { el.style.display = 'none'; canvas.focus(); return; }
        txt.textContent = text;
        var m = text.match(/(\\d+(?:\\.\\d+)?)\\s*\\/\\s*(\\d+)/);
        if (m && parseInt(m[2]) > 0) bar.style.width = ((parseInt(m[1]) / parseInt(m[2])) * 100) + '%';
      },
      print: function(text) { console.log(text); },
      printErr: function(text) { console.warn(text); },
    };

    canvas.addEventListener('click', function() { canvas.focus(); });
    canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    canvas.addEventListener('keydown', function(e) { if (e.key === 'Tab') e.preventDefault(); });

    window.addEventListener('beforeunload', function() {
      try {
        var data = FS.readFile('/persistent/bzf/2.4/config.cfg', { encoding: 'utf8' });
        localStorage.setItem('bzflag-config', data);
      } catch(e) {}
    });

    var script = document.createElement('script');
    script.src = 'bzflag.js?v=${BUILD_ID}';
    document.body.appendChild(script);
  }

  document.getElementById('play-multi').addEventListener('click', function() { startGame(false); });
  document.getElementById('play-solo').addEventListener('click', function() { startGame(true); });
</script>
</body>
</html>`;
}

const indexHtml = buildIndexHtml();

// Common headers: process isolation + no cache for HTML
const COMMON_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// ── HTTP server ────────────────────────────────────────────────────
const server = createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/' || urlPath === '/index.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Content-Length': Buffer.byteLength(indexHtml),
      'Cache-Control': 'no-store',
      ...COMMON_HEADERS,
    });
    res.end(indexHtml);
    return;
  }

  let filePath = join(STATIC_DIR, urlPath);
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const content = readFileSync(filePath);

  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
    ...COMMON_HEADERS,
  });
  res.end(content);
});

// ── WebSocket server (proxy to bzfs) ───────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log(`[ws] New connection from ${req.socket.remoteAddress}`);

  const tcp = createConnection({ host: '127.0.0.1', port: BZFS_PORT }, () => {
    console.log(`[ws] TCP connected to bzfs:${BZFS_PORT}`);
  });

  tcp.on('data', (data) => {
    if (ws.readyState === 1) ws.send(data);
  });

  ws.on('message', (data) => {
    tcp.write(Buffer.from(data));
  });

  tcp.on('error', (err) => {
    console.log(`[ws] TCP error: ${err.message}`);
    ws.close();
  });

  tcp.on('close', () => {
    console.log('[ws] TCP closed');
    ws.close();
  });

  ws.on('close', () => {
    console.log('[ws] WS closed');
    tcp.destroy();
  });

  ws.on('error', (err) => {
    console.log(`[ws] WS error: ${err.message}`);
    tcp.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`[server] BZFlag web server listening on http://0.0.0.0:${PORT}`);
  console.log(`[server] bzfs running on port ${BZFS_PORT}`);
  console.log(`[server] WebSocket proxy active on same port`);
  console.log(`[server] Build ID: ${BUILD_ID}`);
});
