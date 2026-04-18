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
- Full HUD: score, kills, radar, chat, scoreboard, altitude tape
- Main menu navigation with keyboard
- Settings persist via localStorage (auto-save on page close)
- Custom HTML shell (no overlay, loading bar)
- Tab key captured for jumping
- Safe spawn positions (avoid buildings)

### Architecture
```
Browser: [WASM Client] <-> [JS Mock Server (in-page)] <-> [MockWebSocketAdapter]
              |
    Emscripten SDL2 + LEGACY_GL_EMULATION -> WebGL 1.0
```

### Known limitations
- Robots spawn but don't move (AI needs proper server relay)
- Tank rendering has minor visual artifacts (GL emulation stride workaround)
- Some ground-level alignment issues
- Ricochet disabled (causes self-kill with simple geometry)
- No audio (muted for stability)
- Boundary walls visible but very tall

### Build
```bash
# Docker build (no host installs needed)
./docker/build-emscripten.sh

# Copy mock server to output
docker run --rm -v $(pwd):/src bzflag-emscripten \
  cp /src/web/mock-server.js /src/build-emscripten/src/bzflag/

# Serve locally
cd build-emscripten/src/bzflag && python3 -m http.server 8080
# Open http://localhost:8080/bzflag.html
```

### GitHub Actions
Push to `emscripten-browser-port` branch triggers:
1. **Build** — Emscripten compilation in Docker, uploads `bzflag-web` artifact
2. **Deploy** — Publishes to GitHub Pages (if enabled)

---

## Files created/modified

### New files (build system)
- `CMakeLists.txt` + 14 subdirectory CMakeLists
- `cmake/ConfigureChecks.cmake`, `cmake/EmscriptenConfig.cmake`
- `include/config.h.in`
- `docker/Dockerfile.native-cmake`, `docker/Dockerfile.emscripten`
- `docker/build-native.sh`, `docker/build-emscripten.sh`

### New files (web)
- `web/shell.html` — Custom Emscripten HTML shell
- `web/mock-server.js` — JS BZFlag server (~1100 lines)
- `tools/ws-proxy/proxy.mjs` — WebSocket-to-TCP proxy for real servers

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
- `src/bzflag/playing.cxx` — GL state before dialog
- `src/bzflag/ServerLink.cxx` — WebSocket transport, emscripten_sleep
- `src/bzflag/ServerStartMenu.cxx` — Skip fork/exec
- `src/3D/TextureFont.cxx` — Direct glyph render
- `src/geometry/TankGeometryMgr.cxx` — Direct render, consistent stride
- `src/geometry/TankSceneNode.cxx` — renderPart for Emscripten
- `src/geometry/MeshFragSceneNode.cxx`, `MeshDrawMgr.cxx` — Fallback paths
- `src/geometry/FlagSceneNode.cxx` — executeNoList
- `src/platform/SDL2Window.cxx`, `SDL2Display.cxx` — Platform stubs
- `src/game/DirectoryNames.cxx` — Browser paths

### CI/CD
- `.github/workflows/emscripten-build.yml` — Build + GitHub Pages deploy

---

## Phase 2 — Next steps

### High priority
1. **Robot AI movement** — Robots spawn but don't move. Client-side RobotPlayer AI runs but position updates need proper relay through mock server
2. **Ricochet** — Re-enable with proper shot-obstacle collision
3. **Audio** — Remove -mute flag, handle autoplay policy
4. **Ground texture** — Fix ground level alignment

### Medium priority
5. **emscripten_fetch for cURLManager** — Real HTTP for server browser, MOTD
6. **Optimize WASM size** — Release build with -O2 (~3-5MB vs current 11MB)
7. **Progressive asset loading** — Lazy-load non-essential sounds/textures
8. **Real server multiplayer** — WebSocket proxy already exists, needs testing

### Lower priority
9. **Mobile touch controls**
10. **Native WebSocket in bzfs** — Eliminate proxy for real servers
11. **WebRTC DataChannels** — Low-latency position updates
12. **HTML/CSS menu overlay** — Better than GL-rendered menus
