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
- Vertex arrays: Emscripten's GL emulation only has a fast path for
  arrays that share one stride; separate arrays are re-strided in JS and
  their saved pointers overwritten. Static geometry (tanks, meshes) now
  lives in interleaved vertex buffers (`OpenGLVertexBuffer`), and only
  `GL_VERTEX_ARRAY` is enabled by default: every array draw enables what
  it needs and restores that default.
- GLU quadrics (lasers at quality 3, bolts, spheres and shock waves) are
  generated like libGLU does and drawn from cached vertex buffers. The
  shock wave's `GL_INVERT` logic op, which WebGL lacks, is done by blending
  white with `GL_ONE_MINUS_DST_COLOR, GL_ZERO`.
- `tools/emscripten-gltest/run.sh` checks the quadric geometry against
  the system libGLU, and these paths pixel for pixel against immediate
  mode in headless Chromium (no Emscripten ports or network needed).
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

## Phase 3 — Mobile Touch Controls — ✅ Complete

Phones and tablets get on screen controls over the game, in solo and
multiplayer. They are on by default on touch screens; `?touch=1` forces them
on, `?touch=0` off.

### What works
- Floating stick on the left half: drive and turn, analog
- FIRE, JUMP and FLAG (drop) buttons on the right, usable while driving
- START button while the HUD asks the player to start (after joining or dying)
- SCORE toggles the scoreboard
- TILT: steer and drive by tilting the device, calibrated to the way it is
  held when TILT is turned on; remembered between visits (iOS asks again)
- Menu button opens the game menu; a pad (arrows, OK, BACK) replaces the
  driving controls while a menu is up
- Full screen button, with landscape lock where the browser allows it
- Touches never reach the game as emulated mouse events, so the tank does
  not switch to mouse steering
- The config is also saved on `pagehide`, which mobile browsers fire when
  `beforeunload` is skipped

### Architecture
```
web/touch-controls.js ── stick / tilt / buttons ──→ _bzf_touch_axes / _bzf_touch_buttons
                                                      │
                                    TouchJoystick (src/platform) — the game's joystick
                                                      │
                          existing joystick input path in playing.cxx (analog driving,
                          "Joystick Button N" bindings: fire, jump, drop, score, restart)
web/touch-controls.js ── menu pad ──→ synthetic key events (Escape, arrows, Enter)
web/touch-controls.js ←── _bzf_menu_active / _bzf_waiting_to_start ── playing.cxx
```

`TouchJoystick` wraps the SDL joystick, so a real gamepad still works. The
touch buttons are bound in `bindTouchButtons()` (bzflag.cxx) only when the
player has not bound those joystick buttons already.

### Known limitations
- No chat input on touch screens yet
- Tilt directions are verified in an emulator; real devices may need
  tuning of `TILT_FULL` / `TILT_DEAD` in `web/touch-controls.js`

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
- `web/touch-controls.js` — Touch controls for phones and tablets

### New files (multiplayer)
- `docker/Dockerfile.multiplayer` — Multi-stage: WASM + native bzfs + Node.js
- `docker/server.mjs` — Node.js server: static files + WS proxy + bzfs manager + lobby HTML

### New files (Emscripten stubs)
- `src/ogl/EmscriptenStubs.cxx` — GL no-ops (display lists, texgen, etc.), gluProject
- `src/ogl/QuadricGeometry.cxx`, `EmscriptenQuadrics.cxx` — GLU quadrics (spheres,
  cylinders, disks) with libGLU's geometry, cached in vertex buffers
- `src/ogl/OpenGLVertexBuffer.cxx` — Interleaved static vertex buffers (display list replacement)
- `src/common/cURLManager_stub.cxx` — HTTP stub
- `src/net/AresHandler_stub.cxx`, `Ping_stub.cxx`, `multicast_stub.cxx`
- `src/platform/TouchJoystick.cxx` — Joystick fed by the touch controls

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
- `src/3D/TextureFont.cxx` — Whole string in one batched draw
- `src/geometry/TankGeometryMgr.cxx` — Parts recorded once into vertex buffers
- `src/geometry/TankSceneNode.cxx` — renderPart for Emscripten
- `src/geometry/MeshFragSceneNode.cxx`, `MeshDrawMgr.cxx` — Vertex buffers, 16-bit triangle indices
- `src/geometry/FlagSceneNode.cxx` — executeNoList with interleaved arrays
- `src/geometry/SphereSceneNode.cxx` — gluSphere per LOD, shock wave inversion by blending
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
4. **Chat on touch screens** — On screen keyboard for messages

### Lower priority
5. **Native WebSocket in bzfs** — Eliminate proxy for real servers
6. **WebRTC DataChannels** — Low-latency position updates
