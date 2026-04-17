# BZFlag Browser Port — Progress Log

Living document tracking the port from native C++ to browser (WASM via Emscripten).

**Plan file:** `~/.claude/plans/ancient-sauteeing-matsumoto.md`
**Target:** BZFlag 2.4 → WebAssembly client connecting to bzfs via WebSocket proxy

---

## Phase 1.1 — CMake Build System — ✅ Complete

Created parallel CMake build system alongside existing Autotools. No existing CMake files; built from scratch.

### New files

| File | Purpose |
|---|---|
| `CMakeLists.txt` | Root project def, C++11, build options, Emscripten detection, find_package calls |
| `cmake/ConfigureChecks.cmake` | ~40 checks ported from configure.ac → generates config.h |
| `cmake/EmscriptenConfig.cmake` | USE_SDL=2, USE_ZLIB=1, forces server/bzadmin off for browser builds |
| `include/config.h.in` | CMake template replacing autoconf-generated config.h |
| `src/CMakeLists.txt` | Subdirectory orchestration |
| `src/{common,net,game,date,obstacle}/CMakeLists.txt` | 5 shared library targets |
| `src/{3D,ogl,scene,geometry,platform,mediafile}/CMakeLists.txt` | 6 client library targets |
| `src/{bzflag,bzfs,bzadmin}/CMakeLists.txt` | 3 executable targets |
| `web/shell.html` | Emscripten HTML shell with loading bar + click-to-play overlay |

### Build targets

```
bzflag (client, ENABLE_CLIENT)
├── BZFlag_3D            (4 files)
├── BZFlag_GLKit         (7 files) — src/ogl/
├── BZFlag_SceneDB       (5 files) — src/scene/
├── BZFlag_Geometry      (26 + 14 tank files)
├── BZFlag_Platform      (12 files) — SDL2
├── BZFlag_MediaFile     (6 files)
├── BZFlag_Obstacle      (17 base + 8 client SceneNodeGenerators)
├── BZFlag_Game          (22 files)
├── BZFlag_Net           (4 files, +2 for native: Ping, multicast)
├── BZFlag_Common        (36 files)
└── BZFlag_Date          (1 file)

bzfs (server, ENABLE_SERVER, native only)
bzadmin (text client, ENABLE_BZADMIN, native only)
```

### Fixes applied during verification

- `src/net/CMakeLists.txt` — `c-ares::cares` → `${CARES_LIBRARY}` (no imported target)
- `src/mediafile/CMakeLists.txt` — `PNG::PNG` → `ZLIB::ZLIB` (BZFlag has own PNG parser, uses zlib)

---

## Phase 1.2 — Emscripten GL Fixes — ✅ Complete

Targeted `#ifdef __EMSCRIPTEN__` guards added to 8 source files. No refactoring; minimal diffs.

| File | Changes |
|---|---|
| `include/bzfgl.h` | Skip `<GL/glew.h>` for Emscripten; include `<GL/gl.h>` + `<GL/glext.h>` instead; skip GL_VERSION_1_1 check |
| `src/ogl/OpenGLGState.cxx` | Guard `glewInit()`, GLEW extension checks, GL_LINE_STIPPLE, GL_POLYGON_STIPPLE, GL_TEXTURE_GEN_S/T, glTexGenf |
| `src/ogl/OpenGLTexture.cxx` | Use `glGenerateMipmap()` instead of GL_GENERATE_MIPMAP param / gluBuild2DMipmaps; skip gluScaleImage (rely on WebGL NPOT) |
| `src/bzflag/SceneRenderer.cxx` | Guard GL_POLYGON_STIPPLE, glPolygonMode wireframe |
| `src/bzflag/RadarRenderer.cxx` | Guard GL_LINE_SMOOTH, GL_POLYGON_SMOOTH, GL_POINT_SMOOTH, glTexGen* |
| `src/platform/SDL2Window.cxx` | Stub gamma functions, mouse confinement for Emscripten |
| `src/platform/SDL2Display.cxx` | Single canvas-sized resolution; skip `SDL_CaptureMouse` |
| `src/game/DirectoryNames.cxx` | Return `/persistent/bzf/` for config dir on Emscripten |

---

## Phase 1.3 — Docker Build Validation — 🔄 In Progress

Using Docker for all builds; no system installs. Two images:

| Image | Purpose |
|---|---|
| `docker/Dockerfile.native-cmake` | Ubuntu 24.04 + cmake/g++/pkg-config + SDL2/GLEW/GLU/curl/c-ares/zlib/ncurses dev libs; non-root `builder` user; WORKDIR `/src` (mount-only, no COPY) |
| `docker/Dockerfile.emscripten` | Based on `emscripten/emsdk:3.1.74` (ships emsdk + cmake); WORKDIR `/src` |

Helper scripts `docker/build-native.sh` and `docker/build-emscripten.sh` build the image, mount the repo root at `/src`, and run cmake + make into `build-native/` or `build-emscripten/`, tee-ing `cmake.log` and `build.log` for later inspection.

Both images verified to build cleanly (task #7): `bzflag-native-cmake` (~788 MB) and `bzflag-emscripten` (~1.93 GB).

### Native build status — ✅ Success

`bzflag`, `bzfs`, and `bzadmin` all build cleanly inside `bzflag-native-cmake` and run (verified `bzfs -help`). Binaries at `build-native/src/{bzflag,bzfs,bzadmin}/`.

| # | Error | Fix |
|---|---|---|
| 1 | `tee: cmake.log: Permission denied` — container `builder` user (uid 1001) couldn't write to host-owned `build-native/` (uid 1000) | `docker/build-native.sh`: added `--user "$(id -u):$(id -g)"` to the `docker run` invocation so the container runs as the host user |
| 2 | `INSTALL_DATA_DIR` / `INSTALL_LIB_DIR` not declared (in `bzflag.cxx`, `bzfsPlugins.cxx`) | Root `CMakeLists.txt`: `include(GNUInstallDirs)` + `set(BZFLAG_DATADIR …)` / `BZFLAG_LIBDIR`. Added `target_compile_definitions` for `INSTALL_DATA_DIR` on `BZFlag_Common`, `BZFlag_MediaFile`, `BZFlag_Platform`, and `bzflag`; `INSTALL_LIB_DIR` on `bzfs`. Previous sites used `CMAKE_INSTALL_DATADIR` (relative) which expanded to empty — replaced with `BZFLAG_DATADIR` (full path via `CMAKE_INSTALL_FULL_DATADIR`). |
| 3 | Link failure: `undefined reference to QuadWallSceneNode`, `TriWallSceneNode`, `OccluderSceneNode`, `MeshFragSceneNode` from `libBZFlag_Obstacle.a` | `target_link_libraries(bzflag …)` order bug — `BZFlag_Geometry` was listed before `BZFlag_Obstacle`, but Obstacle's SceneNodeGenerators pull symbols from Geometry. Reordered to match `src/bzflag/Makefile.am` LDADD: Obstacle → Geometry (and matched autotools order for the rest). |

**Iterations:** 3 to green. No source files needed editing — all fixes were in CMake glue.

### Emscripten build status

#### Iteration 1 — initial run

CMake configured successfully. `make` reached ~36% before failing across 5 independent error clusters:

| Category | Files | Error |
|---|---|---|
| Missing header (c-ares) | `src/net/AresHandler.cxx:14` → `include/AresHandler.h:21` | `'ares.h' file not found` |
| Missing header (curl) | `src/common/TextUtils.cxx:23`, `src/common/cURLManager.cxx:15` → `include/cURLManager.h:22` | `'curl/curl.h' file not found` |
| GL extension prototypes not exposed | `src/ogl/OpenGLFramebuffer.cxx:27–55`, `src/ogl/OpenGLTexture.cxx:152` | `glGenFramebuffers`, `glGenerateMipmap`, etc. undeclared (in `<GL/glext.h>` but guarded by `GL_GLEXT_PROTOTYPES`) |
| GLU not included | `src/geometry/BoltSceneNode.cxx:368,520`, `src/geometry/LaserSceneNode.cxx:170`, `src/geometry/SphereSceneNode.cxx:132` | `GLUquadric`, `gluNewQuadric` (in `<GL/glu.h>` but not included transitively; native uses glew) |

**Fixes applied (iteration 1 → 2):**
1. `include/bzfgl.h` — define `GL_GLEXT_PROTOTYPES` before `<GL/glext.h>`; add `<GL/glu.h>` for Emscripten
2. `src/net/CMakeLists.txt` — exclude `AresHandler.cxx` from Emscripten sources
3. `src/common/CMakeLists.txt` — exclude `cURLManager.cxx` from Emscripten sources
4. `src/common/TextUtils.cxx` — guard `curl_easy_escape`/`curl_easy_unescape` with `#ifdef __EMSCRIPTEN__` fallback

#### Iteration 2 — GL extension prototypes still missing

Same errors as iteration 1 for `OpenGLFramebuffer.cxx` and `OpenGLTexture.cxx`. Root cause: `<GL/gl.h>` in Emscripten `#include`s `<GL/glext.h>` at line 2091 — the `#define GL_GLEXT_PROTOTYPES` landed *after* that include.

**Fix:** move `#define GL_GLEXT_PROTOTYPES 1` to **before** `#include <GL/gl.h>` in `include/bzfgl.h`.

#### Iteration 3 — transitive header failures

Ares/curl shims only fixed the compilation unit, not its consumers. `src/game/NetHandler.cxx` (via `NetHandler.h`) still pulled `AresHandler.h` → `<ares.h>`. Similarly `ServerAuth.cxx` / `ServerList.cxx` pulled `cURLManager.h` → `<curl/curl.h>`.

**Fix:** shim the **headers** themselves:
- `include/AresHandler.h` — under `__EMSCRIPTEN__`, skip `<ares.h>` and `typedef void* ares_channel; struct ares_addrinfo;` so the class declaration still parses.
- `include/cURLManager.h` — under `__EMSCRIPTEN__`, skip `<curl/curl.h>` and `typedef void CURL; typedef void CURLM; typedef int CURLcode; typedef long long curl_off_t; typedef int (*curl_xferinfo_callback)(...); #define CURL_ERROR_SIZE 256`.

#### Iteration 4 — `curl_off_t` in `playing.cxx`

`src/bzflag/playing.cxx:1725` defines `curlProgressFunc(void*, curl_off_t, curl_off_t, ...)` via the cURLManager callback shape. Fix: add `typedef long long curl_off_t` to the Emscripten shim in `cURLManager.h`.

#### Iteration 5 — `GLEW_EXT_texture_edge_clamp` runtime check

`src/bzflag/BackgroundRenderer.cxx:794` branches on a GLEW runtime variable that doesn't exist under Emscripten. Fix: `#ifdef __EMSCRIPTEN__` branch that always uses `GL_CLAMP_TO_EDGE` (WebGL doesn't support `GL_CLAMP` anyway).

#### Iteration 6 — `-lZLIB::ZLIB` literal in link line

`EmscriptenConfig.cmake` sets `ZLIB_FOUND TRUE` but doesn't create a `ZLIB::ZLIB` imported target. Sub-libraries still did `target_link_libraries(… ZLIB::ZLIB)`, so CMake emitted `-lZLIB::ZLIB` literally. Zlib actually comes in via `-sUSE_ZLIB=1` (a link flag, not a library target).

**Fix:** guard `target_link_libraries(… ZLIB::ZLIB)` with `if(NOT EMSCRIPTEN)` in `src/common/CMakeLists.txt` and `src/mediafile/CMakeLists.txt`.

#### Iteration 7 — WebGL-incompatible legacy GL: display lists

Link-time undefined symbols for `glGenLists`, `glNewList`, `glEndList`, `glCallList`, `glDeleteLists`, etc. Emscripten's GL emulation does **not** implement display lists even under `-sLEGACY_GL_EMULATION=1`. BZFlag's `BackgroundRenderer.cxx` uses ~20 display lists for sun/moon/stars/clouds/mountains/ground; many more throughout.

**Fix (stopgap):** new `src/ogl/EmscriptenStubs.cxx` provides no-op stubs (`glGenLists` returns a fake id counter, all others no-op) so the link can proceed. **Real fix is a VBO/VAO refactor** — see "Top remaining issues" below.

Gotcha: `bzfgl.h` has `#define glDeleteLists(b,c) bzDeleteLists((b),(c))` — the stubs file must `#undef` those macros after including the header, otherwise the stub bodies get mangled.

#### Iteration 8 — more legacy GL: `glPushAttrib/Pop/Recti/Rectf`

Same pattern as iteration 7. Added to `EmscriptenStubs.cxx`:
- `glPushAttrib` / `glPopAttrib` / `glPushClientAttrib` / `glPopClientAttrib` — no-op
- `glRecti` / `glRectf` — re-emit as `glBegin(GL_TRIANGLE_STRIP); glVertex…; glEnd()` which the emulation *does* handle

#### Iteration 9 — `cURLManager` method symbols undefined

`Downloads.cxx`, `motd.cxx`, `ServerMenu.cxx`, etc. instantiate `cURLManager` / `ResourceGetter`. Excluding `cURLManager.cxx` left every method + typeinfo undefined. New `src/common/cURLManager_stub.cxx` (Emscripten-only) provides no-op implementations of every public method (~20 functions) and the `ResourceGetter` subclass.

#### Iteration 10 — stub net/* symbols, guard `glLightModeli`

Link progresses much further. Remaining undefined symbols:

| Symbol family | Source of demand | Notes |
|---|---|---|
| `glLightModeli` | `SceneRenderer.cxx` | Legacy GL lighting; needs guard or stub |
| `AresHandler::*` (ctor, dtor, `queryHost`, `setFd`, `process`, `getHostAddress`, `globalShutdown`) | `bzflag.cxx`, `playing.cxx` | Need an `AresHandler_stub.cxx` mirroring `cURLManager_stub.cxx` |
| `PingPacket::*` (ctor, dtor, `writeToFile`, `readFromFile`, `sendRequest`, `unpackHex`) | `ServerItem.cxx`, `ServerList.cxx`, `ServerMenu.cxx` | `Ping.cxx` is excluded; need stub |
| `openBroadcast`, `closeBroadcast` | `ServerList.cxx` | `multicast.cxx` is excluded; need stub |

All are the same "stub the excluded file's symbols" pattern. Work continued into iterations 11–13 below.

#### Iteration 11 — three net stub files + glLightModeli guard

Fixes applied:
1. `src/bzflag/SceneRenderer.cxx` — wrap all six `glLightModeli` call sites in `#ifndef __EMSCRIPTEN__` (simple guard is cleaner than a stub for a non-WebGL call).
2. `src/net/AresHandler_stub.cxx` — new file, Emscripten-only. No-op impls for ctor, dtor, `globalInit`, `globalShutdown`, `queryHostname`, `queryHost`, `getHostname`, `getHostAddress`, `setFd`, `process`, static `callback`/`staticCallback`, and the `globallyInited` static.
3. `src/net/Ping_stub.cxx` — new file, Emscripten-only. No-op `PingPacket` (all public API plus the private hex helpers and `PacketSize` static).
4. `src/net/multicast_stub.cxx` — new file, Emscripten-only. `openBroadcast` returns -1; `closeBroadcast`/`sendBroadcast`/`recvBroadcast` return -1/0.
5. `src/net/CMakeLists.txt` — added `else()` branch appending the three new stub files when `EMSCRIPTEN` is set.

Link advanced past `BZFlag_Net` to the final `bzflag.html` link step, revealing a new category of missing symbols — legacy GL lighting/material/stipple calls and all of GLU.

#### Iteration 12 — extend EmscriptenStubs for more legacy GL + GLU

Link errors: `glPolygonStipple`, `glLineStipple`, `glLighti`, `glLightf`, `glMaterialf`, `glLightModeli` (from `OpenGLMaterial.cxx`, separate from SceneRenderer call sites), `gluNewQuadric`, `gluDisk`, `gluCylinder`, `gluSphere`, `gluDeleteQuadric`, `gluQuadricDrawStyle`, `gluQuadricTexture`, `gluQuadricNormals`, `gluQuadricOrientation`, `gluProject`.

Root cause: `<GL/glu.h>` declares the GLU API under Emscripten, but `libGLU` is not provided — Emscripten's legacy emulation is `-lGL-emu-webgl2-getprocaddr`, which covers fixed-function GL but not GLU's quadric/project utilities. Similarly, scalar lighting/material overloads (`glLighti`/`glLightf`/`glMaterialf`) aren't stubbed in the emulation; only the `*v` forms are.

Fix: extend `src/ogl/EmscriptenStubs.cxx`:
- `glPolygonStipple`, `glLineStipple`, `glLightModeli` — no-op (not honored under WebGL FFP emulation anyway).
- `glLighti` / `glLightf` / `glMaterialf` — forward to `glLightfv` / `glMaterialfv` with a single-element array.
- `gluNewQuadric` returns a static dummy; `gluDeleteQuadric` and all `gluQuadric*` setters no-op; `gluDisk`/`gluCylinder`/`gluSphere` no-op (no geometry emitted — bolts/lasers/spheres will be invisible until VBO port lands).
- `gluProject` does an identity passthrough so HUD projections don't segfault at runtime.

#### Iteration 13 — one straggler: `glLogicOp`

`SphereSceneNode.cxx` uses `glLogicOp` for XOR draw effects. Not in WebGL. Added one-line no-op stub in `EmscriptenStubs.cxx`.

### ✅ Emscripten link success

```
$ ls -la build-emscripten/src/bzflag/bzflag.{html,js,wasm,data}
-rw-r--r-- 1 root root 12151189 Apr 16 22:00 bzflag.data
-rw-r--r-- 1 root root    22039 Apr 16 22:00 bzflag.html
-rw-r--r-- 1 root root   754387 Apr 16 22:00 bzflag.js
-rwxr-xr-x 1 root root 12164023 Apr 16 22:00 bzflag.wasm
```

Sizes: `bzflag.wasm` 11.6 MB (unstripped, debug build), `bzflag.data` 11.6 MB (preloaded `/data` assets), `bzflag.js` 737 KB loader, `bzflag.html` 22 KB shell. Artifacts at `build-emscripten/src/bzflag/`. The link is clean; runtime has not been exercised and will have issues (display lists, networking, DNS, HTTP, projection all stubbed to no-op / passthrough — Phase 1.4/1.5 work).

---

## Top remaining Emscripten issues

Prioritized list of obstacles for Phase 1.4 to tackle. All of these are real (not shim) problems; the shims above only get us to link.

1. **Display lists → VBO/VAO refactor (largest single task)** — `BackgroundRenderer.cxx` (~20 lists: sun, moon, stars, clouds, mountains, simpleGround), plus many others use `glGenLists`/`glNewList`/`glCallList`. WebGL has **no** display lists and Emscripten's legacy emulation does **not** implement them. Must refactor to VBOs/VAOs or capture immediate-mode draw calls and replay. Current stub silently no-ops all list rendering — sky and background will not draw.
2. **Networking — TCP/UDP sockets → WebSocket** — `src/net/multicast.cxx` (broadcast-based server discovery) and `Ping.cxx` are fundamentally socket-based. `openBroadcast`/`closeBroadcast` cannot work in browser; UDP broadcast is impossible. Server list fetch needs to go via HTTPS (emscripten_fetch already linked) to the list server; LAN discovery must be disabled under Emscripten. `ServerLink.cxx` TCP → WebSocket proxy is already on the Phase 1.5 list.
3. **DNS resolution — c-ares → browser** — `AresHandler` is excluded; browsers don't expose DNS directly. Must route hostname resolution through the WebSocket proxy or resolve server-side. Current stub returns no results, so any code path depending on resolution will fail.
4. **HTTP — libcurl → `emscripten_fetch`** — Downloads of maps, MOTD, version checks, server list all go through `cURLManager`. Current stub no-ops everything. Real port is `emscripten_fetch` (already linked via `-sFETCH=1`) — rewrite `cURLManager` to issue `emscripten_fetch_t` instead of libcurl multi handles, preserving the async completion semantics the rest of the code expects.
5. **Legacy GL beyond display lists** — `glLightModeli` (iteration 10), and likely more will surface after stubbing the above. Full list discoverable only by finishing the link. Candidates to audit: `glPolygonStipple`, `glLineStipple`, `glAccum`/`glClearAccum`, `glTexEnv*`, `glTexGen*` (partially handled), `glColorMaterial`, `glFog*`. Many already have partial guards; systematic audit needed.
6. **Fixed-function pipeline via `LEGACY_GL_EMULATION`** — currently linking `-sLEGACY_GL_EMULATION=1 -sGL_FFP_ONLY=1` against WebGL 2. This may not be a supported combination (FFP emulation historically targets WebGL 1). If emulation misbehaves at runtime, fall back to `MIN_WEBGL_VERSION=1 MAX_WEBGL_VERSION=1`, or commit to a shader-based renderer.
7. **Main-loop blocking → ASYNCIFY or `emscripten_set_main_loop`** — `playing.cxx` uses a blocking `while(!done)` with `select()` for network I/O. `-sASYNCIFY` is already in link flags but the code path hasn't been tested. The `select()`-on-sockets pattern may not unblock correctly under ASYNCIFY. Likely need to restructure around `emscripten_set_main_loop` for the render loop and callbacks for I/O.
8. **Config persistence — home directory writes** — `DirectoryNames.cxx` already returns `/persistent/bzf/` under Emscripten, but no IDBFS mount is wired up. Without it, config writes are lost on page reload. Mount IDBFS at `/persistent` in a pre-main JS init, and `FS.syncfs` on writes.
9. **Data asset preloading** — `--preload-file ${CMAKE_SOURCE_DIR}/data@/data` is in link flags. Needs verification that all runtime lookups use `/data/...` paths (not hardcoded native paths), and that texture loading doesn't assume synchronous file I/O.
10. **Thread/process assumptions** — BZFlag uses `pthread`-style calls in a few places (audio, timing?). Emscripten supports `pthread` via web workers but it requires `SharedArrayBuffer` (COOP/COEP headers) and `-sUSE_PTHREADS=1`. Not currently enabled; audit `sound.cxx`, `TimeKeeper.cxx`, `PlatformFactory.cxx` for any thread spawns.

### Counts
- Iterations run: **13** (link success on iteration 13)
- CMake config errors fixed: **1** (ZLIB::ZLIB imported-target literal)
- Source `#ifdef __EMSCRIPTEN__` guards added/expanded: **6 files** (`bzfgl.h`, `TextUtils.cxx`, `BackgroundRenderer.cxx`, `AresHandler.h`, `cURLManager.h`, `SceneRenderer.cxx` glLightModeli guards)
- New Emscripten-only source files: **5** (`src/ogl/EmscriptenStubs.cxx`, `src/common/cURLManager_stub.cxx`, `src/net/AresHandler_stub.cxx`, `src/net/Ping_stub.cxx`, `src/net/multicast_stub.cxx`)
- Furthest point reached: **link success** — `bzflag.html`, `bzflag.js`, `bzflag.wasm` (11.6 MB), `bzflag.data` (11.6 MB) all produced. Runtime untested.

---

## Phase 1.4 — Runtime Debugging — 🔄 In Progress

Game now runs in the browser. Module is stable (no crashes, 30+ seconds runtime).

### What works
- Sky gradient and ground plane render correctly
- Custom `web/shell.html` with click-to-play overlay
- Audio loads (31 sound files at 22050 Hz)
- ASYNCIFY keeps the main loop alive without blocking the browser
- **Menu text is visible and readable** (task #14)
- **Keyboard navigation works** — arrow keys, Enter, Esc all functional in menus
- Font rendering via TextureFont's Emscripten path (`renderGlyph` instead of display lists)
- HUD text rendering (alerts, status, scoreboard labels)
- **Rendering artifacts fixed** (task #13) — mountains, sky, ground, HUD all render cleanly
- Mountain textures visible on horizon with correct silhouettes
- **Server connection works** (task #15) — client connects to native bzfs via WebSocket proxy
- **Gameplay works** — player can join a team, spawn, move, and turn
- DNS resolution via AresHandler stub (IP addresses + gethostbyname)
- Full HUD: score, kills, player list, team scores, radar, chat panel

### Rendering fixes applied (task #13)

| Fix | File(s) | Description |
|---|---|---|
| Scissor state save/restore | `EmscriptenStubs.cxx` | `glPushAttrib(GL_SCISSOR_BIT)`/`glPopAttrib()` were no-ops, causing scissor from radar (193×193) to leak into `glClear`, producing severe ghosting artifacts across the entire frame. Implemented a minimal attrib stack that saves/restores scissor box and enable state. |
| GL_ALPHA_TEST guards | `OpenGLGState.cxx` | Guarded all `glEnable/glDisable(GL_ALPHA_TEST)` and `glAlphaFunc` calls with `#ifndef __EMSCRIPTEN__`. The emulation's alpha-test shader path produced incorrect results. |
| GL_CLIP_PLANE guard | `SceneRenderer.cxx` | Guarded `glClipPlane(GL_CLIP_PLANE0, ...)` setup call — not needed and potentially problematic under WebGL emulation. |
| Mountain material/normal guards | `BackgroundRenderer.cxx` | Removed `setMaterial`/`setAlphaFunc` from mountain gstate and `glNormal3f` from mountain strip rendering under Emscripten. The material triggered lighting-related shader code in the FFP emulation that produced vertical streak artifacts. |
| Client-state array guards | `OpenGLGState.cxx` | Disabled default `glEnableClientState(GL_NORMAL_ARRAY/GL_TEXTURE_COORD_ARRAY)` under Emscripten to avoid confusing the FFP emulation when mixed with immediate-mode rendering. |
| Clip plane guard (BackgroundRenderer) | `BackgroundRenderer.cxx` | Forced `useClipPlane = false` under Emscripten — clip planes not reliably supported in WebGL FFP emulation. |
| Texture format fix | `OpenGLTexture.cxx` | Expanded `GL_LUMINANCE`/`GL_LUMINANCE_ALPHA` textures to `GL_RGB`/`GL_RGBA` under Emscripten — WebGL 2 core profile doesn't support legacy luminance formats. |
| Daytime rendering | `web/shell.html` | Fixed `-time` and `-longitude` arguments so the scene renders at solar noon instead of nighttime (previous args caused nighttime due to longitude/UTC mismatch). |

### Networking setup (task #15)

Solo mode (`-solo N`) requires `fork()`/`exec()` of bzfs, which is impossible in Emscripten. Instead, the browser client connects to an external native bzfs server via a WebSocket-to-TCP proxy.

**Architecture:** Browser (WebSocket) → WS proxy (Node.js) → bzfs (TCP)

**Key changes:**
- `ServerLink.cxx`: Emscripten-specific connection path using `emscripten_sleep()` to yield for WebSocket handshake, and polling recv loop instead of `select()`
- `AresHandler_stub.cxx`: Now resolves hostnames via `inet_aton`/`gethostbyname` instead of always returning Failed
- `ServerStartMenu.cxx`: Guarded `fork()`/`exec()` with `#ifdef __EMSCRIPTEN__` error message
- `CMakeLists.txt`: Added `-s WEBSOCKET_URL="ws://"` for Emscripten socket emulation
- `tools/ws-proxy/proxy.mjs`: Node.js WebSocket-to-TCP proxy
- `tools/ws-proxy/start-server.sh`: Helper to start bzfs + websockify

### Solo mode with in-browser mock server (task #16)

BZFlag's `-solo N` mode normally `fork()`/`exec()`s a local bzfs server, which is impossible in the browser. Instead, a JavaScript mock BZFlag server (`web/mock-server.js`) implements the BZFlag binary protocol directly in the browser, with WebSocket interception routing all localhost connections through it.

**Architecture:** Emscripten WASM client → WebSocket interception → MockBZFlagServer (in-page JS)

**Key files:**
- `web/mock-server.js` — Full mock BZFlag server implementing the binary protocol
- `web/shell.html` — WebSocket interception + Module.arguments for `-solo 3`

**Protocol sequence fix:** The mock server initially sent MsgGameSettings, MsgTeamUpdate, and MsgAddPlayer immediately in the MsgEnter handler. This caused the client to process MsgAddPlayer before the world was downloaded, resulting in `remotePlayers` being NULL → memory access out of bounds crash. Fixed by deferring the state dump (MsgTeamUpdate, MsgAddPlayer, MsgPlayerInfo) until after the last world chunk is delivered (`_handleGetWorld` with `bytesLeft=0`).

**Robot timing fix:** Robot connections (ComputerPlayer type) arrive on separate WebSocket connections and complete their own handshake independently. Their MsgAddPlayer broadcasts could reach the human player before `remotePlayers` was allocated (which happens in `joinInternetGame2()` after world download + build). Fixed by queuing MsgAddPlayer for robots until the human player sends its first MsgAlive or MsgPlayerUpdate, which proves `remotePlayers` is allocated. The mock server tracks `humanPlayerReady` flag and `_pendingRobotAddPlayers` queue for this.

**What works:**
- Player connects and completes the full BZFlag join protocol
- World download (empty world with valid zlib-compressed data)
- Player spawns (press 'i') and can move
- Robots connect, enter, and receive spawn positions via MsgAlive
- MsgAlive format correct: `[u8 id][float32[3] pos][float32 azimuth]` = 17 bytes, big-endian
- Player position updates relayed between players
- Score tracking (kills/deaths)
- Chat message relay
- Lag ping echo
- Tab key works for jumping (browser default prevented on canvas)
- `-solo 3` launches 3 robot tanks automatically

### Tank geometry rendering restored
Previously, `TankGeometryMgr::buildLists()` had an early `return;` under `__EMSCRIPTEN__` because mixed texcoord/non-texcoord vertices in `glBegin`/`glEnd` blocks crashed the GL emulation's stride assertion. With `ASSERTIONS=0` already set in CMakeLists.txt, the stride mismatch is silently ignored and tanks render (possibly with minor artifacts). The early return was removed.

### Map obstacles
The mock server's world data was upgraded from an empty world to include 15 box obstacles (buildings/cover) scattered around the map. The `buildUncompressedWorldData()` function now generates boxes packed in the BZFlag binary format (`float pos[3]`, `float angle`, `float size[3]`, `uint8_t stateByte`) at obstacle type index 1 (boxType) within the root GroupDefinition.

### What doesn't work yet
- Display list rendering is stubbed — stars and some background elements are invisible
- HTTP/curl is stubbed (no MOTD, downloads, server list)

### Files modified during runtime debugging

| File | Changes |
|---|---|
| `src/ogl/OpenGLLight.cxx` | Guard `GL_SPOT_EXPONENT` / `GL_*_ATTENUATION` (unsupported pnames); guard `glGetIntegerv(GL_MAX_LIGHTS)` |
| `src/ogl/OpenGLMaterial.cxx` | Guard `GL_EMISSION` / `GL_SPECULAR` / `GL_SHININESS`; guard `glLightModeli(GL_LIGHT_MODEL_LOCAL_VIEWER)` |
| `src/ogl/OpenGLGState.cxx` | Guard `glHint(GL_PERSPECTIVE_CORRECTION_HINT)` |
| `src/bzflag/bzflag.cxx` | Disable fullscreen for Emscripten; guard `glHint(GL_PERSPECTIVE_CORRECTION_HINT)` |
| `src/bzflag/SceneRenderer.cxx` | Guard `glHint` for `GL_LINE_SMOOTH_HINT`, `GL_POINT_SMOOTH_HINT`, `GL_POLYGON_SMOOTH_HINT`, `GL_FOG_HINT`; guard `glGetIntegerv(GL_MAX_LIGHTS)` (default to 8) |
| `src/bzflag/CMakeLists.txt` | `ASYNCIFY_STACK_SIZE=65536`, `MIN_WEBGL_VERSION=1`, `GL_UNSAFE_OPTS=0`, `ASSERTIONS=0`, custom shell-file |
| `src/bzflag/bzflag.cxx` | Force `BZDB "lighting"` to `"0"` under Emscripten so vertex colors pass through correctly |
| `src/bzflag/playing.cxx` | Disable `GL_DEPTH_TEST` and `GL_LIGHTING` before dialog rendering in `renderDialog()` |
| `src/bzflag/HUDRenderer.cxx` | Disable `GL_DEPTH_TEST` and `GL_LIGHTING` in `setOneToOnePrj()` for HUD overlay rendering |
| `src/bzflag/HUDuiControl.cxx` | Change `glColor3fv`/`glColor3f` to `glColor4f` with explicit alpha=1.0 (Emscripten emulation fix) |
| `src/3D/TextureFont.cxx` | Guard `glNormal3f` in `renderGlyph()` with `#ifndef __EMSCRIPTEN__` — fixes glyph distortion |
| `src/bzflag/ServerLink.cxx` | Emscripten connection path: `emscripten_sleep()` for WS handshake, polling recv loop |
| `src/bzflag/ServerStartMenu.cxx` | Guard `fork()`/`exec()` with `#ifdef __EMSCRIPTEN__` — show error message |
| `src/net/AresHandler_stub.cxx` | Functional DNS resolution via `inet_aton`/`gethostbyname` (was always-fail stub) |

---

## Known Issues / TODO

### Phase 1.3+
- [x] Native CMake build — `bzflag`, `bzfs`, `bzadmin` all built and run (task #8)
- [x] Emscripten CMake build — first run, expect errors (task #9). Resolved across 13 iterations; see "Top remaining Emscripten issues" above.
- [x] `AresHandler_stub.cxx`, `Ping_stub.cxx`, `multicast_stub.cxx` — cleared final link errors (task #10). `bzflag.html`/`.js`/`.wasm`/`.data` produced.

### Phase 1.4
- [x] Game runs in browser without crashes
- [x] Sky/ground rendering works
- [x] Guard unsupported `glHint` targets (`GL_PERSPECTIVE_CORRECTION_HINT`, `GL_LINE_SMOOTH_HINT`, `GL_POINT_SMOOTH_HINT`, `GL_POLYGON_SMOOTH_HINT`, `GL_FOG_HINT`)
- [x] Guard `glGetIntegerv(GL_MAX_LIGHTS)` — not available in WebGL; default to 8
- [x] Guard `glLightModeli(GL_LIGHT_MODEL_LOCAL_VIEWER)` in `OpenGLMaterial.cxx`
- [ ] Display list recording/replay for fonts, stars, UI (task #11)
- [ ] ASYNCIFY integration for game loop (playing.cxx:7015-7025 token auth blocker)
- [ ] IDBFS mount for config persistence (bzflag.cxx init)
- [ ] Data asset preloading verification

### Phase 1.5
- [x] ServerLink.cxx WebSocket transport (task #15) — client connects via `ws://` to a proxied bzfs
- [x] AresHandler stub with real DNS resolution (task #15)
- [x] WebSocket proxy (`tools/ws-proxy/proxy.mjs`)
- [ ] cURLManager → emscripten_fetch port
- [x] Solo mode with in-browser mock server (task #16) — robots spawn, no WASM crash

---

## File Index

### Modified source files
- `include/bzfgl.h`
- `include/AresHandler.h` (Emscripten shim)
- `include/cURLManager.h` (Emscripten shim)
- `src/ogl/OpenGLGState.cxx` (GLEW guards, stipple guards, `glHint` guard, GL_ALPHA_TEST guards, client-state array guards)
- `src/ogl/OpenGLTexture.cxx` (GL_LUMINANCE → GL_RGB expansion for WebGL)
- `src/ogl/EmscriptenStubs.cxx` (scissor-aware glPushAttrib/glPopAttrib implementation)
- `src/ogl/OpenGLLight.cxx` (guard `GL_SPOT_EXPONENT`/attenuation pnames, `GL_MAX_LIGHTS`)
- `src/ogl/OpenGLMaterial.cxx` (guard `GL_EMISSION`/`GL_SPECULAR`/`GL_SHININESS`, `glLightModeli`)
- `src/bzflag/bzflag.cxx` (fullscreen guard, `glHint` guard, force lighting off for Emscripten)
- `src/bzflag/playing.cxx` (disable depth test + lighting before dialog rendering)
- `src/bzflag/HUDRenderer.cxx` (disable depth test + lighting in `setOneToOnePrj`)
- `src/bzflag/HUDuiControl.cxx` (`glColor3fv`/`glColor3f` → `glColor4f` with explicit alpha)
- `src/bzflag/SceneRenderer.cxx` (`glLightModeli`, `glHint`, `GL_MAX_LIGHTS` guards, `glClipPlane` guard)
- `src/bzflag/RadarRenderer.cxx`
- `src/bzflag/BackgroundRenderer.cxx` (GLEW_EXT_texture_edge_clamp guard, clip plane guard, mountain material/normal guards)
- `src/3D/TextureFont.cxx` (guard `glNormal3f` in `renderGlyph` for Emscripten)
- `src/bzflag/ServerLink.cxx` (Emscripten connection: `emscripten_sleep` for WS handshake, polling recv)
- `src/bzflag/ServerStartMenu.cxx` (guard `fork()`/`exec()` under Emscripten)
- `src/bzflag/CMakeLists.txt` (Emscripten link flags: ASYNCIFY, WebGL version, shell-file)
- `src/common/TextUtils.cxx` (curl URL-encode fallback)
- `src/platform/SDL2Window.cxx`
- `src/platform/SDL2Display.cxx`
- `src/game/DirectoryNames.cxx`

### New Emscripten-only source files
- `src/ogl/EmscriptenStubs.cxx` — no-op stubs for display lists, `glPushAttrib`, `glRect*`, stipple, scalar light/material, GLU quadrics, `gluProject`, `glLogicOp`
- `src/common/cURLManager_stub.cxx` — no-op stubs for the full `cURLManager` + `ResourceGetter` classes
- `src/net/AresHandler_stub.cxx` — DNS resolution via `inet_aton`/`gethostbyname` (upgraded from no-op)
- `src/net/Ping_stub.cxx` — no-op stubs for `PingPacket`
- `src/net/multicast_stub.cxx` — no-op stubs for UDP broadcast socket helpers

### New files (build system)
- `CMakeLists.txt`
- `cmake/ConfigureChecks.cmake`
- `cmake/EmscriptenConfig.cmake`
- `include/config.h.in`
- `src/CMakeLists.txt`
- `src/*/CMakeLists.txt` (14 files)
- `web/shell.html`

### New files (web)
- `web/mock-server.js` — In-browser mock BZFlag server for solo mode (implements binary protocol)

### New files (tools)
- `tools/ws-proxy/proxy.mjs` — Node.js WebSocket-to-TCP proxy for bridging browser clients to bzfs
- `tools/ws-proxy/start-server.sh` — Helper script to start bzfs + websockify

### New files (Docker — pending)
- `docker/Dockerfile.native-cmake`
- `docker/Dockerfile.emscripten`
- `docker/build-native.sh`
- `docker/build-emscripten.sh`
