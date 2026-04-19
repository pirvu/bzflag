# BZFlag Browser Port — Progress Log

## Phase 1 — Solo Mode in Browser — ✅ Complete

BZFlag runs entirely in the browser with a self-contained JS mock server.
No external server or proxy needed for solo play.

### What works
- Player spawns, moves, turns, jumps
- Shooting (kills robots correctly, proper score tracking)
- 3 robot opponents visible and connected
- 15 buildings scattered across 800x800 map
- Boundary walls at map edges
- Ricochet — shots bounce off walls and buildings
- Full HUD: score, kills, radar, chat, scoreboard, altitude tape
- Main menu navigation with keyboard
- Settings persist via localStorage (auto-save on page close)
- Fullscreen canvas — resizes to fill browser window
- Clean exit with restart button (no memory leaks)
- Tab key captured for jumping
- Safe spawn positions (avoid buildings)

### Architecture
```
Browser: [WASM Client] <-> [JS Mock Server (in-page)] <-> [MockWebSocketAdapter]
              |
    Emscripten SDL2 + LEGACY_GL_EMULATION -> WebGL 1.0
```

### Known limitations
- Tank rendering has minor visual artifacts (GL emulation stride workaround)
- No audio (muted for stability)
- Boundary walls visible but very tall

---

## Phase 2 — Multiplayer — ✅ Complete

Multiple browser players connect to a real bzfs server via WebSocket proxy.
All packaged in a single Docker container.

### What works
- Real bzfs server bundled in Docker container
- WebSocket-to-TCP proxy on same port as HTTP (single port deployment)
- Web lobby with callsign entry, team selection, solo/multiplayer buttons
- Multiple players see each other, can shoot, kill, and score
- Callsign and team saved to localStorage
- `-noudp` flag added to bzfs — allows TCP-only WebSocket clients
- WASM optimized with -Oz: 12MB → 2.5MB
- No browser caching (Cache-Control: no-store + build ID cache busters)
- COOP/COEP headers for per-tab process isolation
- Works across different browsers (Chrome + Safari tested)

### Architecture
```
Browser ──HTTP──→ Node.js server (:8080) ──serves──→ Lobby HTML + WASM client
Browser ──WS────→ Node.js server (:8080) ──TCP────→ bzfs (:5154)
```

### Docker usage
```bash
# Solo mode only (no server)
docker build -f docker/Dockerfile.web -t bzflag-web .
docker run -p 8080:80 bzflag-web

# Multiplayer (bundled bzfs server)
docker build -f docker/Dockerfile.multiplayer -t bzflag-multiplayer .
docker run -p 8080:8080 bzflag-multiplayer
# Open http://localhost:8080
```

### Known limitations
- Two tabs in same Chrome window may crash (WebGL context limit per process)
  - Workaround: use incognito window or different browser for second player
- No UDP — all traffic over TCP/WebSocket (slightly higher latency)
- No server list or MOTD (cURLManager still stubbed)

---

## Files created/modified

### New files (build system)
- `CMakeLists.txt` + 14 subdirectory CMakeLists
- `cmake/ConfigureChecks.cmake`, `cmake/EmscriptenConfig.cmake`
- `include/config.h.in`
- `docker/Dockerfile.native-cmake`, `docker/Dockerfile.emscripten`
- `docker/build-native.sh`, `docker/build-emscripten.sh`

### New files (web)
- `web/shell.html` — Custom Emscripten HTML shell (solo mode)
- `web/mock-server.js` — JS BZFlag server (~1100 lines)
- `tools/ws-proxy/proxy.mjs` — WebSocket-to-TCP proxy for real servers

### New files (multiplayer)
- `docker/Dockerfile.multiplayer` — Multi-stage: WASM + native bzfs + Node.js
- `docker/server.mjs` — Node.js server: static files + WS proxy + bzfs manager + lobby HTML

### New files (Emscripten stubs)
- `src/ogl/EmscriptenStubs.cxx` — GL no-ops (display lists, GLU, texgen, etc.)
- `src/common/cURLManager_stub.cxx` — HTTP stub
- `src/net/AresHandler_stub.cxx`, `Ping_stub.cxx`, `multicast_stub.cxx`

### Modified source files (Emscripten guards)
- `include/bzfgl.h` — Skip GLEW
- `include/AresHandler.h`, `include/cURLManager.h` — Type shims
- `src/ogl/OpenGLGState.cxx` — GL state guards
- `src/ogl/OpenGLTexture.cxx` — GLU replacement
- `src/ogl/OpenGLLight.cxx`, `OpenGLMaterial.cxx` — Light/material guards
- `src/bzflag/SceneRenderer.cxx` — Stipple/wireframe/hint guards
- `src/bzflag/RadarRenderer.cxx` — Smooth/texgen guards
- `src/bzflag/BackgroundRenderer.cxx` — Direct render (9 methods)
- `src/bzflag/HUDRenderer.cxx`, `HUDuiControl.cxx` — GL state/alpha fixes
- `src/bzflag/WeatherRenderer.cxx` — Direct draw
- `src/bzflag/bzflag.cxx` — Fullscreen disable, lighting off, localStorage
- `src/bzflag/playing.cxx` — GL state before dialog, game exit handler, UDP skip
- `src/bzflag/ServerLink.cxx` — WebSocket transport, emscripten_sleep
- `src/bzflag/ServerStartMenu.cxx` — Skip fork/exec
- `src/3D/TextureFont.cxx` — Direct glyph render
- `src/geometry/TankGeometryMgr.cxx` — Direct render, consistent stride
- `src/geometry/TankSceneNode.cxx` — renderPart for Emscripten
- `src/geometry/MeshFragSceneNode.cxx`, `MeshDrawMgr.cxx` — Fallback paths
- `src/geometry/FlagSceneNode.cxx` — executeNoList
- `src/platform/SDL2Window.cxx`, `SDL2Display.cxx` — Platform stubs
- `src/game/DirectoryNames.cxx` — Browser paths

### Modified source files (server)
- `src/bzfs/bzfs.cxx` — `-noudp` flag support (skip UDP requirement for WebSocket clients)
- `src/bzfs/CmdLineOptions.h` — `requireUDP` option
- `src/bzfs/CmdLineOptions.cxx` — `-noudp` CLI parsing

### CI/CD
- `.github/workflows/emscripten-build.yml` — Docker image build + GHCR publish

---

## Next steps

### High priority
1. **emscripten_fetch for cURLManager** — Real HTTP for server browser, MOTD
2. **Audio** — Remove -mute flag, handle autoplay policy

### Medium priority
3. **Progressive asset loading** — Lazy-load non-essential sounds/textures
4. **Mobile touch controls**

### Lower priority
5. **Native WebSocket in bzfs** — Eliminate proxy for real servers
6. **WebRTC DataChannels** — Low-latency position updates
