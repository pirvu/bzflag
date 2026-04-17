/**
 * MockBZFlagServer — a JavaScript BZFlag server that runs in-browser
 * for solo mode with robot tanks. Implements the BZFlag binary protocol
 * so the WASM client can connect without any external server.
 *
 * Protocol reference: include/Protocol.h, src/bzfs/bzfs.cxx
 */

// ── Message codes (from Protocol.h) ────────────────────────────────────
const Msg = {
  Accept:            0x6163,
  Alive:             0x616c,
  AddPlayer:         0x6170,
  AutoPilot:         0x6175,
  CaptureFlag:       0x6366,
  DropFlag:          0x6466,
  Enter:             0x656e,
  Exit:              0x6578,
  FlagType:          0x6674,
  FlagUpdate:        0x6675,
  GrabFlag:          0x6766,
  GMUpdate:          0x676d,
  GetWorld:          0x6777,
  GameSettings:      0x6773,
  GameTime:          0x6774,
  Killed:            0x6b6c,
  Message:           0x6d67,
  NegotiateFlags:    0x6e66,
  PlayerInfo:        0x7062,
  PlayerUpdate:      0x7075,
  PlayerUpdateSmall: 0x7073,
  Reject:            0x726a,
  RemovePlayer:      0x7270,
  ShotBegin:         0x7362,
  Score:             0x7363,
  ShotEnd:           0x7365,
  SuperKill:         0x736b,
  SetVar:            0x7376,
  TimeUpdate:        0x746f,
  Teleport:          0x7470,
  TeamUpdate:        0x7475,
  WantWHash:         0x7768,
  WantSettings:      0x7773,
  LagPing:           0x7069,
  UDPLinkRequest:    0x6f66,
  UDPLinkEstablished:0x6f67,
};

// World database codes
const WorldCode = {
  Header: 0x6865,
  End:    0x6564,
};

// Sizes from Protocol.h
const WorldSettingsSize = 30;
const WorldCodeHeaderSize = 10;
const WorldCodeEndSize = 0;

// Player constants from global.h
const CallSignLen = 32;
const MottoLen    = 128;
const TokenLen    = 22;
const VersionLen  = 60;

// Team colors
const TeamColor = {
  Automatic: -2,
  Rogue:    0,
  Red:      1,
  Green:    2,
  Blue:     3,
  Purple:   4,
  Observer: 5,
};

// Player types
const PlayerType = {
  Tank:     0,
  Computer: 1,
};

// Game types
const GameType = {
  ClassicCTF:  0,
  OpenFFA:     1,
  RabbitChase: 2,
};

const CtfTeams = 5;
const MaxPacketLen = 1024;

// ── Handshake constants ────────────────────────────────────────────────
const BZ_CONNECT_HEADER = 'BZFLAG\r\n\r\n';  // 10 bytes from client
const BZ_SERVER_VERSION = 'BZFS0221';         // 8 bytes reply

// ── Constants for obstacle manager ────────────────────────────────────
const ObstacleTypeCount = 10; // wallType through tetraType

// ── Helper: build the uncompressed world data ────────────────────────
// This must match what WorldInfo::packDatabase() produces for an empty world.
// Order: DynColorMgr, TexMatrixMgr, MaterialMgr, PhysDrvMgr, TransformMgr,
//        ObstacleMgr (root GroupDef), LinkManager, waterLevel, Weapons, EntryZones
function buildUncompressedWorldData() {
  // Calculate size:
  // 5 managers × 4 bytes (u32 count=0) = 20
  // ObstacleMgr (GroupDefinitionMgr::unpack):
  //   root GroupDefinition: u32 nameLen=0 + 10×u32 counts + u32 groupInstanceCount = 48
  //   additional group defs count: u32 = 4
  // Links: u32=0 = 4
  // WaterLevel: float=-1.0 = 4
  // Weapons: u32=0 = 4
  // EntryZones: u32=0 = 4
  // Total = 88
  const size = 20 + 48 + 4 + 4 + 4 + 4 + 4;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  let off = 0;

  // 5 empty managers (DynColor, TexMatrix, Material, PhysDrv, Transform)
  for (let i = 0; i < 5; i++) { view.setUint32(off, 0); off += 4; }

  // ObstacleMgr = GroupDefinitionMgr::unpack
  // 1) root GroupDefinition (world.unpack)
  // name: nboPackStdString packs u32 length + string bytes. Empty string = u32(0).
  view.setUint32(off, 0); off += 4;  // name length = 0
  // 10 obstacle type counts (all 0)
  for (let i = 0; i < ObstacleTypeCount; i++) { view.setUint32(off, 0); off += 4; }
  // group instances count = 0
  view.setUint32(off, 0); off += 4;
  // 2) additional group definitions count = 0
  view.setUint32(off, 0); off += 4;

  // LinkManager: u32 count=0
  view.setUint32(off, 0); off += 4;

  // Water level: float < 0 means no water
  view.setFloat32(off, -1.0); off += 4;
  // (no material index since waterLevel < 0)

  // WorldWeapons: u32 count=0
  view.setUint32(off, 0); off += 4;

  // EntryZones: u32 count=0
  view.setUint32(off, 0); off += 4;

  return new Uint8Array(buf);
}

// ── Helper: zlib compress using raw deflate ───────────────────────────
// Minimal zlib-format compression. For our tiny world data, we can use
// the browser's DecompressionStream... but we need compression. Instead,
// we use a "stored" zlib block (no compression), which is valid zlib.
function zlibCompress(data) {
  // zlib format: [CMF][FLG][...data blocks...][ADLER32]
  // CMF = 0x78 (deflate, window=32K)
  // FLG = 0x01 (check bits, no dict, compression level 0)
  // For stored deflate block: [BFINAL=1, BTYPE=00][LEN][NLEN][data]
  const len = data.length;
  // Deflate stored block header: 1 byte (0x01 = final block, type=stored)
  // + 2 bytes LEN (little-endian) + 2 bytes NLEN (~LEN) + data
  const deflateSize = 1 + 2 + 2 + len;
  const totalSize = 2 + deflateSize + 4; // CMF+FLG + deflate + adler32
  const out = new Uint8Array(totalSize);
  let off = 0;

  // zlib header
  out[off++] = 0x78; // CMF: deflate method, 32K window
  out[off++] = 0x01; // FLG: check bits (0x7801 → 0x7801 % 31 == 0? 0x78*256+0x01=30721, 30721%31=1, need 0x9C for correct check)
  // Actually, FLG must satisfy (CMF*256 + FLG) % 31 == 0
  // 0x78 = 120, so 120*256 = 30720. 30720 % 31 = 30720 - 991*31 = 30720-30721 = -1? Let me compute:
  // 30720 / 31 = 990.96... → 990 * 31 = 30690. 30720 - 30690 = 30. So FLG needs (31 - 30) % 31 = 1.
  // FLG = 0x01 → (30720 + 1) = 30721. 30721 / 31 = 991.0 → exact! Good.

  // Stored deflate block
  out[off++] = 0x01; // BFINAL=1, BTYPE=00 (stored)
  out[off++] = len & 0xFF;
  out[off++] = (len >> 8) & 0xFF;
  out[off++] = (~len) & 0xFF;
  out[off++] = ((~len) >> 8) & 0xFF;
  out.set(data, off);
  off += len;

  // Adler-32 checksum
  var a = 1, b = 0;
  for (var i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  var adler = ((b << 16) | a) >>> 0;
  out[off++] = (adler >> 24) & 0xFF;
  out[off++] = (adler >> 16) & 0xFF;
  out[off++] = (adler >> 8) & 0xFF;
  out[off++] = adler & 0xFF;

  return out;
}

// ── Helper: build minimal empty world database ────────────────────────
function buildEmptyWorldDatabase() {
  const uncompressed = buildUncompressedWorldData();
  const compressed = zlibCompress(uncompressed);

  // World database format:
  // [u16 headerSize][u16 WorldCodeHeader][u16 mapVersion][u32 uncompressedSize][u32 compressedSize]
  // [compressed data bytes]
  // [u16 endSize][u16 WorldCodeEnd]
  const headerFrameSize = 2 + 2 + WorldCodeHeaderSize; // 14 bytes
  const endFrameSize = 2 + 2 + WorldCodeEndSize;       // 4 bytes
  const totalSize = headerFrameSize + compressed.length + endFrameSize;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let off = 0;

  // WorldCodeHeader chunk
  view.setUint16(off, WorldCodeHeaderSize);      off += 2;
  view.setUint16(off, WorldCode.Header);         off += 2;
  view.setUint16(off, 1);                        off += 2;  // mapVersion (global.h: mapVersion=1)
  view.setUint32(off, uncompressed.length);      off += 4;  // uncompressedSize
  view.setUint32(off, compressed.length);        off += 4;  // compressedSize

  // Compressed world data
  bytes.set(compressed, off);
  off += compressed.length;

  // WorldCodeEnd chunk
  view.setUint16(off, WorldCodeEndSize);         off += 2;
  view.setUint16(off, WorldCode.End);            off += 2;

  return new Uint8Array(buf);
}

// ── MD5 implementation for world hash verification ────────────────────
// The BZFlag client computes MD5 on the downloaded world data and compares
// it against the hash the server sends. We must produce a real MD5 digest.
function md5hex(data) {
  // Minimal MD5 (RFC 1321)
  function md5cycle(x, k) {
    var a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936);   d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);  b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);      b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);   d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510);    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);   b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);  b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);     d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);   b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);  d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);   b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558);       d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);  b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);   d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);   b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);   b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);   b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844);    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);   d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);     b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);  b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);    b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]);
    x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function add32(a, b) { return (a + b) & 0xFFFFFFFF; }

  var n = data.length;
  var state = [1732584193, -271733879, -1732584194, 271733878];
  var tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var i, lo;
  for (i = 64; i <= n; i += 64) {
    var block = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    for (var j = 0; j < 64; j += 4)
      block[j >> 2] = data[i - 64 + j] | (data[i - 64 + j+1] << 8) | (data[i - 64 + j+2] << 16) | (data[i - 64 + j+3] << 24);
    md5cycle(state, block);
  }
  for (var j = 0; j < 16; j++) tail[j] = 0;
  for (i = i - 64; i < n; i++) {
    tail[(i & 63) >> 2] |= data[i] << ((i & 3) << 3);
  }
  tail[(i & 63) >> 2] |= 0x80 << ((i & 3) << 3);
  if ((i & 63) > 55) { md5cycle(state, tail); for (j = 0; j < 16; j++) tail[j] = 0; }
  lo = n * 8;
  tail[14] = lo & 0xFFFFFFFF;
  tail[15] = 0; // high bits of bit length (we don't support >512MB)
  md5cycle(state, tail);

  var hex = '';
  for (i = 0; i < 4; i++) {
    for (j = 0; j < 4; j++) {
      var byte = (state[i] >> (j * 8)) & 0xFF;
      hex += (byte < 16 ? '0' : '') + byte.toString(16);
    }
  }
  return hex;
}

function computeWorldHash(worldData) {
  // Prefix 't' means temporary (not a permanent map file)
  return 't' + md5hex(worldData);
}

// ── Player state ──────────────────────────────────────────────────────
class PlayerState {
  constructor(id) {
    this.id = id;
    this.type = PlayerType.Tank;
    this.team = TeamColor.Rogue;
    this.callSign = '';
    this.motto = '';
    this.wins = 0;
    this.losses = 0;
    this.tks = 0;
    this.isAlive = false;
    this.pos = [0, 0, 0];
    this.azimuth = 0;
    this.adapter = null;   // send function for this player's connection
    this.entered = false;
  }
}

// ── MockBZFlagServer ──────────────────────────────────────────────────
class MockBZFlagServer {
  constructor(options = {}) {
    this.players = new Map();       // playerId -> PlayerState
    this.nextPlayerId = 0;
    this.worldData = buildEmptyWorldDatabase();
    this.worldHash = computeWorldHash(this.worldData);
    this.worldSize = options.worldSize || 400.0;
    this.gameType = options.gameType ?? GameType.OpenFFA;
    this.maxShots = options.maxShots || 10;
    this.maxPlayers = options.maxPlayers || 20;
    this.gameOptions = 0;
    this.teamScores = [];
    for (let i = 0; i < CtfTeams; i++) {
      this.teamScores.push({ size: 0, wins: 0, losses: 0 });
    }
    this.log = options.debug ? console.log.bind(console, '[MockBZFS]') : () => {};
  }

  // ── Connection lifecycle ──────────────────────────────────────────

  /**
   * Called when a new "connection" is established.
   * @param {object} adapter - must have adapter.send(ArrayBuffer) and adapter.close()
   * @returns {number} playerId assigned, or -1 on failure
   */
  onConnection(adapter) {
    if (this.nextPlayerId >= this.maxPlayers) {
      this.log('Server full, rejecting connection');
      return -1;
    }
    const id = this.nextPlayerId++;
    const player = new PlayerState(id);
    player.adapter = adapter;
    this.players.set(id, player);
    // The connection is in the handshake phase; we wait for BZ_CONNECT_HEADER.
    // Store handshake state on the adapter.
    adapter._handshakePhase = 'waiting_header';
    adapter._handshakeBuf = new Uint8Array(0);
    adapter._playerId = id;
    this.log(`Connection accepted, assigned player ID ${id}`);
    return id;
  }

  /**
   * Called when a connection is closed.
   */
  onDisconnect(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    this.log(`Player ${playerId} (${player.callSign}) disconnected`);

    if (player.entered) {
      const teamIdx = player.team;
      if (teamIdx >= 0 && teamIdx < CtfTeams) {
        this.teamScores[teamIdx].size = Math.max(0, this.teamScores[teamIdx].size - 1);
      }
      // Broadcast MsgRemovePlayer to remaining players
      const payload = new ArrayBuffer(1);
      new DataView(payload).setUint8(0, playerId);
      this._broadcast(Msg.RemovePlayer, payload, playerId);
    }
    this.players.delete(playerId);
  }

  // ── Data ingress ──────────────────────────────────────────────────

  /**
   * Called when binary data arrives from a client.
   * @param {number} playerId
   * @param {ArrayBuffer|Uint8Array} data
   */
  onMessage(playerId, data) {
    const player = this.players.get(playerId);
    if (!player) return;
    const adapter = player.adapter;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    // ── Handshake phase ──
    if (adapter._handshakePhase === 'waiting_header') {
      // Emscripten's SOCKFS sends a UDP port header (0xFF 0xFF 0xFF 0xFF 'p' 'o' 'r' 't' + 2 bytes)
      // as the first message on datagram sockets. Silently ignore these.
      if (bytes.length === 10 && bytes[0] === 0xFF && bytes[1] === 0xFF &&
          bytes[2] === 0xFF && bytes[3] === 0xFF && bytes[4] === 0x70 /* 'p' */) {
        this.log(`Ignoring Emscripten UDP port header from player ${playerId}`);
        return;
      }

      // Accumulate bytes until we have 10 (BZ_CONNECT_HEADER length)
      const combined = new Uint8Array(adapter._handshakeBuf.length + bytes.length);
      combined.set(adapter._handshakeBuf);
      combined.set(bytes, adapter._handshakeBuf.length);
      adapter._handshakeBuf = combined;

      if (combined.length < 10) return; // need more data

      // Verify the header
      const headerStr = String.fromCharCode(...combined.slice(0, 10));
      if (headerStr !== BZ_CONNECT_HEADER) {
        this.log(`Bad connect header from player ${playerId}: ${JSON.stringify(headerStr)}`);
        adapter.close();
        return;
      }

      // Send version string (8 bytes)
      const versionBuf = new Uint8Array(8);
      for (let i = 0; i < 8; i++) versionBuf[i] = BZ_SERVER_VERSION.charCodeAt(i);
      adapter.send(versionBuf.buffer);

      // Send player ID (1 byte)
      const idBuf = new Uint8Array(1);
      idBuf[0] = playerId;
      adapter.send(idBuf.buffer);

      adapter._handshakePhase = 'done';
      this.log(`Handshake complete for player ${playerId}`);

      // If there were extra bytes after the header, process them as messages
      if (combined.length > 10) {
        const remainder = combined.slice(10);
        adapter._msgBuf = new Uint8Array(0);
        this._processMessageStream(playerId, remainder);
      } else {
        adapter._msgBuf = new Uint8Array(0);
      }
      return;
    }

    // ── Message phase — accumulate and parse framed messages ──
    this._processMessageStream(playerId, bytes);
  }

  /**
   * Accumulate bytes and extract complete [u16 len][u16 code][payload] messages.
   */
  _processMessageStream(playerId, bytes) {
    const player = this.players.get(playerId);
    if (!player) return;
    const adapter = player.adapter;

    // Append new bytes to the buffer
    const prev = adapter._msgBuf || new Uint8Array(0);
    const combined = new Uint8Array(prev.length + bytes.length);
    combined.set(prev);
    combined.set(bytes, prev.length);
    adapter._msgBuf = combined;

    // Parse as many complete messages as possible
    let offset = 0;
    while (offset + 4 <= combined.length) {
      const view = new DataView(combined.buffer, combined.byteOffset + offset, combined.length - offset);
      const payloadLen = view.getUint16(0);
      const code = view.getUint16(2);
      const totalLen = 4 + payloadLen;

      if (offset + totalLen > combined.length) break; // incomplete message

      const payload = combined.slice(offset + 4, offset + totalLen);
      this._handleMessage(playerId, code, payload);
      offset += totalLen;
    }

    // Keep unconsumed bytes
    adapter._msgBuf = combined.slice(offset);
  }

  // ── Message dispatch ──────────────────────────────────────────────

  _handleMessage(playerId, code, payload) {
    this.log(`Recv from ${playerId}: 0x${code.toString(16)} (${payload.length} bytes)`);

    switch (code) {
      case Msg.Enter:        return this._handleEnter(playerId, payload);
      case Msg.WantSettings: return this._handleWantSettings(playerId);
      case Msg.WantWHash:    return this._handleWantWHash(playerId);
      case Msg.NegotiateFlags: return this._handleNegotiateFlags(playerId, payload);
      case Msg.GetWorld:     return this._handleGetWorld(playerId, payload);
      case Msg.Alive:        return this._handleAlive(playerId);
      case Msg.PlayerUpdate:      return this._handlePlayerUpdate(playerId, code, payload);
      case Msg.PlayerUpdateSmall: return this._handlePlayerUpdate(playerId, code, payload);
      case Msg.ShotBegin:    return this._handleShotBegin(playerId, payload);
      case Msg.ShotEnd:      return this._handleShotEnd(playerId, payload);
      case Msg.Killed:       return this._handleKilled(playerId, payload);
      case Msg.GrabFlag:     return this._handleGrabFlag(playerId, payload);
      case Msg.DropFlag:     return this._handleDropFlag(playerId, payload);
      case Msg.Message:      return this._handleChatMessage(playerId, payload);
      case Msg.Teleport:     return this._handleTeleport(playerId, payload);
      case Msg.LagPing:      return this._handleLagPing(playerId, payload);
      case Msg.Exit:         return this.onDisconnect(playerId);
      case Msg.AutoPilot:    return this._broadcastRaw(code, playerId, payload);
      case Msg.GMUpdate:     return this._broadcastRaw(code, playerId, payload);
      case Msg.UDPLinkRequest:    return this._handleUDPLinkRequest(playerId);
      case Msg.UDPLinkEstablished: return; // silently ignore
      default:
        this.log(`Unhandled message 0x${code.toString(16)} from player ${playerId}`);
    }
  }

  // ── Handshake / setup message handlers ────────────────────────────

  _handleEnter(playerId, payload) {
    const player = this.players.get(playerId);
    if (!player || player.entered) return;

    // Parse: u16 type, i16 team, char[32] callSign, char[128] motto, char[22] token, char[60] version
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let off = 0;
    player.type = view.getUint16(off); off += 2;
    let team = view.getInt16(off);  off += 2;
    player.callSign = this._readFixedString(payload, off, CallSignLen); off += CallSignLen;
    player.motto    = this._readFixedString(payload, off, MottoLen);    off += MottoLen;
    // token and version not needed for mock

    // Resolve AutomaticTeam (-2) to a real team
    if (team === TeamColor.Automatic) {
      team = TeamColor.Rogue; // OpenFFA: everyone is Rogue
    }
    player.team = team;
    player.entered = true;

    this.log(`Player ${playerId} entered: "${player.callSign}" team=${player.team} type=${player.type}`);

    // Update team size
    const teamIdx = player.team;
    if (teamIdx >= 0 && teamIdx < CtfTeams) {
      this.teamScores[teamIdx].size++;
    }

    // 1) Send MsgAccept with the player ID
    const acceptPayload = new ArrayBuffer(1);
    new DataView(acceptPayload).setUint8(0, playerId);
    this._sendTo(playerId, Msg.Accept, acceptPayload);

    // Bot players (robots) don't download the world — they just need MsgAccept.
    // The real server skips sending game info to bots (see bzfs.cxx:2387).
    // But we DO need to broadcast MsgAddPlayer for the bot to other players
    // (so the main player knows about the robot).
    if (player.type === PlayerType.Computer) {
      // Broadcast MsgAddPlayer for this bot to all entered players
      this._broadcastAddPlayer(player);
      this._sendPlayerInfo(playerId, player);
      return;
    }

    // For human players: the client drives the join protocol after MsgAccept:
    //   negotiate flags → request settings → request world hash → download world
    // The client calls enteringServer() when it processes MsgAddPlayer-for-self,
    // which triggers addRobots(). This requires remotePlayers to be allocated
    // from the world object, which only happens after the world is downloaded.
    //
    // In our async mock server, all messages arrive almost instantly. If we
    // send MsgAddPlayer here, the client processes it before the world is
    // downloaded, causing remotePlayers to be NULL → crash.
    //
    // Fix: defer the state dump until after the world download completes
    // (last MsgGetWorld chunk with bytesLeft=0).
    player._needsStateDump = true;
  }

  _handleWantSettings(playerId) {
    this._sendGameSettings(playerId);
  }

  _handleWantWHash(playerId) {
    // Send the world hash: null-terminated string
    const hashStr = this.worldHash;
    const payload = new ArrayBuffer(hashStr.length + 1);
    const bytes = new Uint8Array(payload);
    for (let i = 0; i < hashStr.length; i++) bytes[i] = hashStr.charCodeAt(i);
    bytes[hashStr.length] = 0; // NUL terminator
    this._sendTo(playerId, Msg.WantWHash, payload);
  }

  _handleNegotiateFlags(playerId, payload) {
    // For an empty/simple game, respond with empty flag list
    this._sendTo(playerId, Msg.NegotiateFlags, new ArrayBuffer(0));
  }

  _handleGetWorld(playerId, payload) {
    // Client sends: u32 ptr (bytes read so far)
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const ptr = view.getUint32(0);

    // Send world chunk: [u32 bytesLeft][chunk data]
    const maxChunkSize = MaxPacketLen - 4 - 4; // minus header minus bytesLeft field
    let size = Math.min(maxChunkSize, this.worldData.length - ptr);
    let left = 0;
    if (ptr >= this.worldData.length) {
      size = 0;
      left = 0;
    } else {
      if (ptr + size >= this.worldData.length) {
        size = this.worldData.length - ptr;
        left = 0;
      } else {
        left = this.worldData.length - ptr - size;
      }
    }

    const respPayload = new ArrayBuffer(4 + size);
    const respView = new DataView(respPayload);
    respView.setUint32(0, left);
    if (size > 0) {
      new Uint8Array(respPayload).set(this.worldData.slice(ptr, ptr + size), 4);
    }
    this._sendTo(playerId, Msg.GetWorld, respPayload);

    // After the last world chunk is delivered, send the deferred state dump.
    // The client needs the world to be fully downloaded before it can process
    // MsgAddPlayer (which triggers enteringServer → addRobots, requiring
    // remotePlayers to be allocated from the world object).
    if (left === 0) {
      const player = this.players.get(playerId);
      if (player && player._needsStateDump) {
        player._needsStateDump = false;
        this.log(`Sending deferred state dump for player ${playerId}`);
        this._sendStateDump(playerId);
      }
    }
  }

  _handleUDPLinkRequest(playerId) {
    // The real server would set up a UDP channel. In our mock server,
    // just silently ignore — the client will fall back to TCP only.
    this.log(`Ignoring UDP link request from player ${playerId}`);
  }

  // ── Gameplay message handlers ─────────────────────────────────────

  _handleAlive(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    this.log(`_handleAlive for player ${playerId} "${player.callSign}"`);

    // Generate a spawn position (random within world bounds)
    const half = this.worldSize / 2 * 0.9;
    const x = (Math.random() * 2 - 1) * half;
    const y = (Math.random() * 2 - 1) * half;
    const z = 0;
    const azimuth = Math.random() * Math.PI * 2 - Math.PI;

    player.isAlive = true;
    player.pos = [x, y, z];
    player.azimuth = azimuth;

    // Broadcast MsgAlive: u8 playerId, float[3] pos, float azimuth
    const payload = new ArrayBuffer(1 + 12 + 4);
    const view = new DataView(payload);
    let off = 0;
    view.setUint8(off, playerId); off += 1;
    view.setFloat32(off, x);     off += 4;
    view.setFloat32(off, y);     off += 4;
    view.setFloat32(off, z);     off += 4;
    view.setFloat32(off, azimuth); off += 4;
    this._broadcast(Msg.Alive, payload);
  }

  _handlePlayerUpdate(playerId, code, payload) {
    // Relay player position updates to all other players
    this._broadcast(code, payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength), playerId);
  }

  _handleShotBegin(playerId, payload) {
    // Broadcast shot to all players
    this._broadcast(Msg.ShotBegin, payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
  }

  _handleShotEnd(playerId, payload) {
    // Broadcast shot end to all players
    this._broadcast(Msg.ShotEnd, payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
  }

  _handleKilled(playerId, payload) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.isAlive = false;

    // Update scores
    player.losses++;

    // Parse killer ID from payload: u8 killerId, i16 reason, i16 shotId, ...
    if (payload.length >= 1) {
      const killerView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const killerId = killerView.getUint8(0);
      const killer = this.players.get(killerId);
      if (killer && killerId !== playerId) {
        killer.wins++;
        // Send score update for killer
        this._sendScoreUpdate(killer);
      }
    }

    // Send score update for victim
    this._sendScoreUpdate(player);

    // Broadcast the kill
    this._broadcast(Msg.Killed, payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
  }

  _handleGrabFlag(playerId, payload) {
    this._broadcast(Msg.GrabFlag, payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
  }

  _handleDropFlag(playerId, payload) {
    this._broadcast(Msg.DropFlag, payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
  }

  _handleChatMessage(playerId, payload) {
    // Relay chat messages
    this._broadcast(Msg.Message, payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
  }

  _handleTeleport(playerId, payload) {
    this._broadcast(Msg.Teleport, payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
  }

  _handleLagPing(playerId, payload) {
    // Echo the lag ping right back to the sender
    this._sendTo(playerId, Msg.LagPing, payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
  }

  /**
   * Generic broadcast of a raw payload under a given code, skipping the sender.
   */
  _broadcastRaw(code, senderId, payload) {
    this._broadcast(code, payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength), senderId);
  }

  // ── Compound senders ──────────────────────────────────────────────

  _sendGameSettings(playerId) {
    // MsgGameSettings payload = WorldSettingsSize (30) bytes:
    //   float worldSize, u16 gameType, u16 gameOptions, u16 maxPlayers,
    //   u16 maxShots, u16 numFlags, float linearAccel, float angularAccel,
    //   u16 shakeTimeout, u16 shakeWins, u32 syncTime(unused)
    const payload = new ArrayBuffer(WorldSettingsSize);
    const view = new DataView(payload);
    let off = 0;
    view.setFloat32(off, this.worldSize);  off += 4;  // worldSize
    view.setUint16(off, this.gameType);    off += 2;  // gameType
    view.setUint16(off, this.gameOptions); off += 2;  // gameOptions
    view.setUint16(off, this.maxPlayers);  off += 2;  // maxPlayers (PlayerSlot)
    view.setUint16(off, this.maxShots);    off += 2;  // maxShots
    view.setUint16(off, 0);               off += 2;  // numFlags
    view.setFloat32(off, 100.0);           off += 4;  // linearAcceleration
    view.setFloat32(off, 100.0);           off += 4;  // angularAcceleration
    view.setUint16(off, 0);               off += 2;  // shakeTimeout
    view.setUint16(off, 0);               off += 2;  // shakeWins
    view.setUint32(off, 0);               off += 4;  // syncTime (unused)

    // The real server sends GameSettings with its own length+code header baked in.
    // But the client reads it via the normal [len][code][payload] framing, so
    // we send it as a regular message.
    this._sendTo(playerId, Msg.GameSettings, payload);
  }

  _sendTeamUpdate(playerId) {
    // MsgTeamUpdate: u8 numTeams, then per team: u16 teamIndex, u16 size, u16 wins, u16 losses
    const payload = new ArrayBuffer(1 + CtfTeams * 8);
    const view = new DataView(payload);
    let off = 0;
    view.setUint8(off, CtfTeams); off += 1;
    for (let t = 0; t < CtfTeams; t++) {
      view.setUint16(off, t);                       off += 2;
      view.setUint16(off, this.teamScores[t].size);  off += 2;
      view.setUint16(off, this.teamScores[t].wins);  off += 2;
      view.setUint16(off, this.teamScores[t].losses); off += 2;
    }
    this._sendTo(playerId, Msg.TeamUpdate, payload);
  }

  /**
   * Send MsgAddPlayer for `aboutPlayer` to `targetPlayerId`.
   * Format: u8 id, u16 type, u16 team, u16 wins, u16 losses, u16 tks, char[32] callSign, char[128] motto
   */
  _sendAddPlayer(targetPlayerId, aboutPlayer) {
    const payload = this._packAddPlayer(aboutPlayer);
    this._sendTo(targetPlayerId, Msg.AddPlayer, payload);
  }

  _broadcastAddPlayer(player) {
    const payload = this._packAddPlayer(player);
    this._broadcast(Msg.AddPlayer, payload);
  }

  _packAddPlayer(player) {
    const size = 1 + 2 + 2 + 2 + 2 + 2 + CallSignLen + MottoLen;
    const payload = new ArrayBuffer(size);
    const view = new DataView(payload);
    const bytes = new Uint8Array(payload);
    let off = 0;

    view.setUint8(off, player.id);    off += 1;
    view.setUint16(off, player.type); off += 2;
    view.setUint16(off, player.team); off += 2;
    view.setUint16(off, player.wins); off += 2;
    view.setUint16(off, player.losses); off += 2;
    view.setUint16(off, player.tks);  off += 2;
    this._writeFixedString(bytes, off, player.callSign, CallSignLen); off += CallSignLen;
    this._writeFixedString(bytes, off, player.motto, MottoLen);       off += MottoLen;

    return payload;
  }

  _sendPlayerInfo(targetPlayerId, player) {
    // MsgPlayerInfo: u8 count, then per player: u8 id, u8 attributes
    const payload = new ArrayBuffer(1 + 2);
    const view = new DataView(payload);
    view.setUint8(0, 1);            // count = 1
    view.setUint8(1, player.id);    // player id
    view.setUint8(2, 0);            // attributes (none)
    this._sendTo(targetPlayerId, Msg.PlayerInfo, payload);
  }

  /**
   * Send the deferred state dump to a player after world download completes.
   * This includes team updates, existing player info, and the player's own
   * MsgAddPlayer (which the client uses to trigger enteringServer()).
   */
  _sendStateDump(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    // 1) Send MsgTeamUpdate for all teams
    this._sendTeamUpdate(playerId);

    // 2) Send MsgAddPlayer for all existing players (not this one)
    for (const [id, other] of this.players) {
      if (id !== playerId && other.entered) {
        this._sendAddPlayer(playerId, other);
      }
    }

    // 3) Broadcast MsgAddPlayer for the new player to everyone
    this._broadcastAddPlayer(player);

    // 4) Send MsgPlayerInfo for the new player
    this._sendPlayerInfo(playerId, player);
  }

  _sendScoreUpdate(player) {
    // MsgScore: u8 numScores, then per score: u8 playerId, u16 wins, u16 losses, u16 tks
    const payload = new ArrayBuffer(1 + 1 + 6);
    const view = new DataView(payload);
    let off = 0;
    view.setUint8(off, 1); off += 1;          // numScores
    view.setUint8(off, player.id); off += 1;   // playerId
    view.setUint16(off, player.wins); off += 2;
    view.setUint16(off, player.losses); off += 2;
    view.setUint16(off, player.tks); off += 2;
    this._broadcast(Msg.Score, payload);
  }

  // ── Low-level send/broadcast ──────────────────────────────────────

  /**
   * Pack and send a message to a single player.
   * Wire format: [u16 payloadLength][u16 code][payload]
   */
  _sendTo(playerId, code, payload) {
    const player = this.players.get(playerId);
    if (!player || !player.adapter) return;

    const payloadBytes = payload instanceof ArrayBuffer
      ? new Uint8Array(payload)
      : new Uint8Array(payload.buffer || payload, payload.byteOffset || 0, payload.byteLength || payload.length || 0);

    const msg = new ArrayBuffer(4 + payloadBytes.length);
    const view = new DataView(msg);
    view.setUint16(0, payloadBytes.length);
    view.setUint16(2, code);
    if (payloadBytes.length > 0) {
      new Uint8Array(msg).set(payloadBytes, 4);
    }

    try {
      player.adapter.send(msg);
    } catch (e) {
      this.log(`Send error to player ${playerId}: ${e.message}`);
    }
  }

  /**
   * Broadcast a message to all connected players, optionally skipping one.
   */
  _broadcast(code, payload, skipPlayerId) {
    for (const [id, player] of this.players) {
      if (id === skipPlayerId) continue;
      if (!player.entered) continue;
      this._sendTo(id, code, payload);
    }
  }

  // ── String helpers ────────────────────────────────────────────────

  _readFixedString(buf, offset, len) {
    const bytes = buf.slice(offset, offset + len);
    let end = bytes.indexOf(0);
    if (end === -1) end = len;
    return new TextDecoder().decode(bytes.slice(0, end));
  }

  _writeFixedString(buf, offset, str, len) {
    const encoded = new TextEncoder().encode(str);
    const writeLen = Math.min(encoded.length, len - 1);
    buf.set(encoded.slice(0, writeLen), offset);
    // Rest is already zeroed in ArrayBuffer
  }

  // ── Utilities ─────────────────────────────────────────────────────

  /**
   * Get info about all connected players (for debugging / UI).
   */
  getPlayerList() {
    const list = [];
    for (const [id, player] of this.players) {
      if (!player.entered) continue;
      list.push({
        id,
        callSign: player.callSign,
        team: player.team,
        type: player.type,
        wins: player.wins,
        losses: player.losses,
        isAlive: player.isAlive,
      });
    }
    return list;
  }

  /**
   * Shut down the server, kicking all players.
   */
  shutdown() {
    for (const [id, player] of this.players) {
      this._sendTo(id, Msg.SuperKill, new ArrayBuffer(0));
      if (player.adapter) {
        try { player.adapter.close(); } catch (e) { /* ignore */ }
      }
    }
    this.players.clear();
    this.log('Server shut down');
  }
}

// Expose on global scope for <script> tag loading
if (typeof window !== 'undefined') {
  window.MockBZFlagServer = MockBZFlagServer;
  window.BZMsg = Msg;
  window.BZTeamColor = TeamColor;
  window.BZPlayerType = PlayerType;
  window.BZGameType = GameType;
}

// Also support ES module import
if (typeof exports !== 'undefined') {
  exports.MockBZFlagServer = MockBZFlagServer;
  exports.Msg = Msg;
  exports.TeamColor = TeamColor;
  exports.PlayerType = PlayerType;
  exports.GameType = GameType;
}
