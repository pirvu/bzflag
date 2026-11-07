# Handover: portul BZFlag în browser (Emscripten)

Documentul e scris ca să poți continua lucrul pe port într-o sesiune nouă. Detaliile tehnice despre port sunt în `docs/PORT_PROGRESS.md`; aici sunt starea curentă, deciziile luate și pașii următori.

## Unde suntem

- **Repo:** `pirvu/bzflag`.
- **Ramură:** `emscripten-browser-port`. PR-ul ei e [pirvu/bzflag#1](https://github.com/pirvu/bzflag/pull/1).
- **Ultimul commit:** `8b33b34`. CI-ul a trecut pe el ([run](https://github.com/pirvu/bzflag/actions/runs/41997331741)).
- **Ce face CI-ul (`Build Docker Web Image`, din `.github/workflows/emscripten-build.yml`):**
  - construiește `docker/Dockerfile.multiplayer`, adică WASM + bzfs nativ + server Node;
  - publică imaginea în `ghcr.io/pirvu/bzflag-web`.
- **Ce verifică CI-ul:** doar că build-ul trece. Nu rulează teste și nu pornește jocul.

### Commit-urile din sesiunea trecută, în ordine

1. **`335ec79`, fix-uri rapide din review:**
   - `ServerLink` nu mai doarme fix 50 ms la fiecare citire. Asta limita jocul la ~20 fps.
   - Handshake-ul citește versiunea și ID-ul jucătorului până le are complete.
   - Conexiunea închisă de server e detectată (recv() == 0), deci intrarea în joc nu mai poate rămâne agățată.
   - Cu tab-ul ascuns se sare doar peste randare; rețeaua continuă să meargă.
   - `gluProject` face proiecția reală.
   - WebSocket-ul ajunge la serverul mock doar în modul solo.
   - Pagina are ecran de eroare.
   - Proxy-urile setează TCP_NODELAY.
   - Fișierele `.wav` nu mai sunt incluse în pachet, cât timp jocul rulează cu `-mute`.
2. **`f25b8f9`, VBO-uri interleaved (`OpenGLVertexBuffer`):**
   - tancurile, `MeshFragSceneNode`, `MeshDrawMgr` și steagurile;
   - regula pentru client arrays: implicit e activ doar `GL_VERTEX_ARRAY`.
3. **`62de09a`, text:**
   - un singur apel de desenare per șir, de 7–10× mai rapid;
   - triangularea e comună, în `triangulatePrimitive`;
   - harness de teste în `tools/emscripten-gltest`.
4. **`8b33b34`, GLU quadrics:**
   - `QuadricGeometry` și `EmscriptenQuadrics`, cu VBO-uri în cache;
   - sferele (desenate cu `gluSphere`);
   - unda de șoc, inversată prin blending în loc de `glLogicOp`.

## Ce trebuie să știi înainte să modifici randarea

- **Emularea GL a Emscripten (`LEGACY_GL_EMULATION`)**, din `emsdk/upstream/emscripten/src/library_glemu.js`:
  - Are cale rapidă doar pentru client arrays care au același stride.
  - Array-urile separate trec printr-o copiere în JS. Copierea **suprascrie pointerii salvați**, deci la desenarea următoare ies date vechi. Bug-ul e reprodus în harness: cazul `INFO old separate arrays`.
  - `glDrawElements` acceptă doar `GL_UNSIGNED_SHORT`.
  - Nu suportă quads, quad strips sau poligoane indexate.
  - `glBegin` acceptă doar `GL_QUADS` dintre modurile non-ES. `GL_QUAD_STRIP` și `GL_POLYGON` aruncă excepție.
  - `glShadeModel` e no-op.
  - `glLogicOp`, `GL_RESCALE_NORMAL` și `GL_COLOR_LOGIC_OP` nu există în WebGL.
- **Regula din port:**
  - Orice desenare cu array-uri activează exact ce îi trebuie și revine apoi la starea implicită: doar `GL_VERTEX_ARRAY` activ, niciun `GL_ARRAY_BUFFER` legat.
  - `OpenGLVertexBuffer::bind()/unbind()` face asta.
  - Un VBO rămas legat strică orice `glBegin`/`glEnd` care urmează.
- **Display list-urile** sunt no-op în `src/ogl/EmscriptenStubs.cxx`. Orice cod care încă le folosește nu desenează nimic în browser. Caută `glCallList` fără o ramură `#ifdef __EMSCRIPTEN__`.
- **Codul nativ trebuie să rămână neschimbat.** Totul nou e sub `#ifdef __EMSCRIPTEN__`. Fișierele noi sunt adăugate doar în listele EMSCRIPTEN din `src/ogl/CMakeLists.txt`.
  - `QuadricGeometry.cxx` e intenționat lăsat în afara `Makefile.am`, pentru că include `<GL/gl.h>` direct.
  - `OpenGLVertexBuffer.cxx` e în `Makefile.am`, dar e gardat cu `#ifdef`.

## Cum se testează

**Testul pe care îl ai: `tools/emscripten-gltest/run.sh`.** Nu are nevoie de rețea sau de port-uri Emscripten. Rulează două lucruri:
1. `glucmp`, nativ: compară `QuadricGeometry` cu libGLU-ul sistemului. Sunt 136 de cazuri și ies identice bit cu bit. Îi trebuie `g++`, `libglu1-mesa-dev` și `libglew-dev`; fără ele pasul e sărit.
2. `gltest`, în Chromium headless prin Playwright: 14 teste de pixeli care compară căile noi cu cele vechi din immediate mode, plus timpi de randare.

Pregătirea într-un container nou:

```bash
# emsdk (storage.googleapis.com e permis)
git clone --depth 1 https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install 3.1.74 && ~/emsdk/emsdk activate 3.1.74
source ~/emsdk/emsdk_env.sh
apt-get update && apt-get install -y --no-install-recommends libglew-dev libglu1-mesa-dev
tools/emscripten-gltest/run.sh          # trebuie să se termine cu "DONE failures=0"
```

**Verificarea compilării pentru fișierele modificate.** Build-ul Emscripten complet nu merge aici (vezi limitarea de mai jos), dar fișierele se pot compila individual:
1. Rulează `emcmake cmake <repo> -DENABLE_CLIENT=ON -DENABLE_SERVER=OFF -DENABLE_BZADMIN=OFF -DCMAKE_EXPORT_COMPILE_COMMANDS=ON` într-un director de build. Pasul de configurare nu descarcă nimic.
2. Din `compile_commands.json`, ia comanda pentru fișier, scoate flag-urile `-sUSE_*` și înlocuiește ieșirea cu `-o /dev/null`.

Pentru verificarea nativă: `g++ -std=c++17 -fsyntax-only -DHAVE_CONFIG_H -I include -I <build>/include <fișier>`.

**Limitare de mediu: nu poți rula jocul complet aici.** Politica de rețea a mediului blochează:
- `github.com/<owner>/<repo>/archive/...`, de unde Emscripten își descarcă port-urile zlib și SDL2 la build;
- `pkg-containers.githubusercontent.com`, unde sunt straturile imaginii din GHCR. Manifestul se poate citi, dar descărcarea straturilor e blocată.

Fără cele două host-uri nu se poate face nici build complet, nici test cu jocul real. Utilizatorul le poate adăuga la *Allowed domains* în setările de rețea ale mediului: meniul mediului → Edit, pașii sunt la https://code.claude.com/docs/en/cloud-environments#network-access. Până atunci, utilizatorul testează manual imaginea Docker.

## Ce n-a fost testat încă în jocul real

Utilizatorul n-a confirmat încă vizual nimic din ce s-a schimbat:
- tancurile (inclusiv șenilele animate, mărimile obese/tiny și umbrele);
- mesh-urile din hărțile custom;
- steagurile și textul din HUD;
- marcatorii și numele din HUD;
- sferele și unda de șoc;
- laserele la calitatea 3 și bolt-urile;
- conectarea în multiplayer (handshake-ul nou și faptul că pauza de 500 ms a fost scoasă);
- FPS-ul în multiplayer.

Dacă apare ceva ciudat, cere un screenshot sau consola browserului.

## Ce rămâne, în ordinea propusă

### Randare
- [ ] **Restaurarea contextului WebGL.**
  - Azi listener-ul din JS doar apelează `preventDefault` (în `docker/server.mjs` și în `web/shell.html`).
  - La `webglcontextrestored` ar trebui chemată o funcție C exportată care apelează `OpenGLGState::initContext()`. Aceasta rulează callback-urile free/init.
  - VBO-urile (`release()` și reîncărcarea la `bind()`) și quadrics-urile sunt deja pregătite pentru asta.
  - De verificat și texturile, prin `TextureManager`.
- [ ] **Texturi NPOT** (`src/ogl/OpenGLTexture.cxx` ~152–236):
  - Contextul e WebGL1, iar `setFilter()` poate repune mipmap pe o textură NPOT, care iese neagră.
  - Fix-ul: re-eșantionare la putere a lui 2 sau o verificare în `setFilter`.
  - Același cod nu mai limitează nici dimensiunea texturilor la `maxTextureSize`.
- [ ] **`glPushAttrib`** salvează doar scissor-ul (`EmscriptenStubs.cxx`). Prin `GL_ALL_ATTRIB_BITS` se pierde starea de depth și blend în `playing.cxx:~5709`, `ScoreboardRenderer.cxx:~642` și `World.cxx:~1310`.
- [ ] **Alpha test lipsă:** texturile cu decupaj scriu depth și pe pixelii transparenți. Wireframe-ul (`glPolygonMode`) e un no-op care trebuie ascuns din meniu. Radarul folosește `GL_CLAMP` (invalid în WebGL) și n-are texgen, deci culorile de înălțime lipsesc.
- [ ] **`HUDRenderer.cxx:~1715`** dezactivează depth și lighting fără să treacă prin OpenGLGState.
- [ ] **Stipple-ul a fost scos**, dar `SceneRenderer.cxx:~825` și `~1191` încă au calea de rezervă cu `glRectf` opac, care poate acoperi tot ecranul. În browser ar trebui folosită mereu calea cu blending.
- Fundalul (cer, sol, munți, nori, soare, lună, stele) **rămâne intenționat în immediate mode**. Sunt ~13 desenări mici pe cadru, iar VBO-urile au ieșit în zgomotul măsurătorii (`TIME background` în gltest).

### Securitatea deploy-ului (`docker/server.mjs`, `docker/Dockerfile.multiplayer`)
- [ ] WebSocket-ul are nevoie de:
  - verificare de `Origin`;
  - o limită de conexiuni per IP;
  - `maxPayload` de 64 KB (acum e la valoarea implicită a ws, 100 MB);
  - backpressure, adică să țină cont de `bufferedAmount` și de evenimentul `drain`.
- [ ] Containerul rulează ca root pe portul 80. Trebuie `USER node`, portul 8080, `HEALTHCHECK` și `--init`/tini.
- [ ] Imaginea are nevoie de `.dockerignore` și de dependența `ws` fixată pe o versiune.
- [ ] `readFileSync` pe fișierele `.data` și `.wasm` la fiecare request blochează event loop-ul care transmite traficul de joc. Fișierele trebuie încărcate o dată la pornire sau servite cu stream-uri.
- [ ] Verificarea căii statice e doar un `startsWith` pe prefix (`server.mjs:~379`); comparația corectă e cu `STATIC_DIR + sep`.
- [ ] bzfs vede toți jucătorii ca 127.0.0.1, deci un ban pe IP îi scoate pe toți. Minimul e să fie logat IP-ul real (`remoteAddress` / `X-Forwarded-For`).

### Sunet
- [ ] Trebuie scos `-mute` din `web/shell.html` și din lobby-ul din `server.mjs`. Audio-ul trebuie pornit la primul click sau la prima tastă.
- [ ] Trebuie scos `--exclude-file *.wav` din `src/bzflag/CMakeLists.txt`.

### CI
- [ ] Workflow-ul are nevoie de un trigger `pull_request`. `:latest` trebuie publicat doar la tag-uri sau la rulări manuale.
- [ ] Trebuie adăugat un job care rulează `tools/emscripten-gltest/run.sh`. Pe runner-ele GitHub există rețea, deci se poate și build-ul complet.
- [ ] Trebuie adăugat un job care verifică build-ul nativ cu CMake.
- [ ] CodeQL și workflow-ul de formatare sunt dezactivate (`*.disabled`). Utilizatorul a ales asta explicit pentru această ramură; nu le reactiva fără să întrebi.

### Pagina web (`web/shell.html` și lobby-ul din `docker/server.mjs`)
- [ ] Imaginea e neclară pe ecrane HiDPI, pentru că `devicePixelRatio` e ignorat. Redimensionarea se face pe canvas, peste capul SDL.
- [ ] Lipsesc butoanele de pointer lock și fullscreen. Trebuie `preventDefault` pe săgeți, Space, F1–F12 și Backspace.
- [ ] Setările se salvează la `beforeunload`, care nu e fiabil pe mobil; mai bine `pagehide`/`visibilitychange`. Cheia din localStorage trebuie să aibă versiune.

### Pe termen lung
- [ ] **ASYNCIFY e aplicat pe tot programul** (`src/bzflag/CMakeLists.txt`). De obicei adaugă 30–50% la dimensiunea codului. Poate fi restrâns cu `ASYNCIFY_ONLY`/`ASYNCIFY_REMOVE`, sau eliminat cu socket-uri non-blocante și `emscripten_set_main_loop`.
- [ ] **Optimizarea build-ului:** `-Oz` e forțat pe toate configurațiile, deci nu se poate face build de debug. Lipsesc `-flto` și `--closure 1` pentru release.
- [ ] **Un renderer propriu cu shadere GLSL** în locul `LEGACY_GL_EMULATION` ar rezolva iluminarea, alpha test-ul și restul performanței.
- [ ] **UDP:** totul trece prin TCP peste WebSocket (bzfs pornit cu `-noudp`), deci pachetele de poziție pot fi întârziate de cele pierdute înaintea lor. E o limită a designului; WebRTC sau WebTransport ar fi alternativa.

## Convenții de lucru stabilite cu utilizatorul

- Utilizatorul scrie în română. Răspunde în română, cu termenii tehnici în engleză.
- Lucrează direct pe `emscripten-browser-port`: commit-uri clare și push după ce testele trec. Commit-urile se termină cu liniile de atribuire cerute de sesiune.
- **Testează ce schimbi.** Utilizatorul a cerut explicit ca lucrul să fie verificat, nu doar compilat. Pentru randare, adaugă cazuri în `tools/emscripten-gltest/gltest.cxx`, care compară calea veche cu cea nouă. Fă și o verificare inversă: introdu intenționat o eroare și confirmă că testul pică.
- **Când o optimizare nu se merită** (cum a fost fundalul), măsoară, spune și n-o face.
- Nu crea PR-uri noi. PR-ul pirvu/bzflag#1 există deja.
