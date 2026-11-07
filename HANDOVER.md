# Handover: BZFlag (pirvu/bzflag) — joc pe mobil, log server, statistici, notificări

Stare la 7 noiembrie 2026. Lucrul se face **doar pe fork-ul `pirvu/bzflag`**. Branch-urile noi și
PR-urile merg spre branch-urile noastre (în principal `emscripten-browser-port`), **niciodată spre
upstream** (BZFlag/bzflag).

## Ce a cerut utilizatorul (la început)

1. Joc pe mobil, cu overlay tactil și înclinarea telefonului.
2. Logul serverului într-o pagină web, cu istoric.
3. Statistici pe jucători.
4. Notificări (Chrome push) când cineva deschide un joc: primul jucător (nu observator) care intră
   pe un server gol. Regula „se mai ajustează”.

Toate patru sunt implementate, în două PR-uri deschise.

## Branch-uri și PR-uri

| Branch | Ce e | PR |
|---|---|---|
| `emscripten-browser-port` | Branch-ul principal: portarea în browser (Emscripten, WebGL, proxy WebSocket, Docker). | #1 spre `2.4` (al utilizatorului, deschis) |
| `claude/mobile-touch-controls` | Controale tactile pentru telefon/tabletă. | **#2** spre `emscripten-browser-port`, deschis |
| `claude/webstats-docker` | webStats (plugin + serviciu web) pus în imaginea Docker multiplayer, sub `/stats/`. | **#3** spre `emscripten-browser-port`, deschis |
| `claude/mobile-play-server-logs-qa23ih` | Varianta inițială webStats, pe baza `2.4`. Inclusă în #3 prin cherry-pick. | fără PR; poate fi ignorat |

La 7 nov.: #2 și #3 nu au comentarii. `emscripten-browser-port` a avansat (`8b33b34`, „Draw GLU
quadrics…”), dar #2 și #3 se unesc fără conflicte cu baza nouă și între ele (verificat cu
`git merge-tree`). CI (`.github/workflows/emscripten-build.yml`) rulează **doar la push pe
`emscripten-browser-port`**, deci PR-urile nu au verificări automate; primul build Docker real
se face după merge.

Linkuri: https://github.com/pirvu/bzflag/pull/2 · https://github.com/pirvu/bzflag/pull/3

## PR #2 — controale tactile (`claude/mobile-touch-controls`)

**Fișiere:**
- `src/platform/TouchJoystick.{h,cxx}`: joystick-ul jocului în browser (doar Emscripten).
  Învelește `SDLJoystick` (care e `final`), deci gamepad-urile reale merg în continuare.
  Exportă `bzf_touch_enable`, `bzf_touch_axes(x, y)` și `bzf_touch_buttons(mask)`.
- `src/platform/SDLPlatformFactory.cxx` creează `TouchJoystick` sub `__EMSCRIPTEN__`;
  `src/platform/CMakeLists.txt` îl adaugă doar pentru `EMSCRIPTEN`.
- `src/bzflag/bzflag.cxx`: `bindTouchButtons()` leagă „Joystick Button 1–5” de
  fire / jump / drop / toggle displayScore / restart, **doar dacă butonul nu e deja legat**
  (configurările salvate au prioritate).
- `src/bzflag/playing.cxx`:
  - exportă `bzf_menu_active()` și `bzf_waiting_to_start()` (aceeași condiție ca textul
    „Press … to start” din HUD);
  - scoate „Joystick Button 5” din textul de start, ca pe desktop să rămână `Right Mouse or "i"`.
- `web/touch-controls.js`: overlay-ul, un script de sine stătător inclus în `web/shell.html`
  (solo) și în pagina din `docker/server.mjs` (multiplayer). Ambele Dockerfile-uri îl copiază
  lângă `mock-server.js`.
  - Stick flotant în stânga; FIRE / JUMP / FLAG în dreapta; START; SCORE; TILT; ecran complet; ☰.
  - Cât e deschis un meniu, apare un pad (săgeți / OK / BACK) care trimite taste sintetice.
  - Un buton rămâne apăsat cel puțin 120 ms (`MIN_PRESS_MS`), altfel jocul ratează atingerile scurte.
  - Atingerile nu devin evenimente de mouse emulate (altfel jocul trece pe control cu mouse-ul
    și tancul merge singur).
  - Senzorii de înclinare cer permisiune prin `DeviceOrientationEvent.requestPermission`. Acum o
    au și Chrome-ul recent, nu doar iOS.
  - Implicit pornit pe ecrane tactile; `?touch=1` îl forțează, `?touch=0` îl oprește.
- Config salvat și la `pagehide` (în `shell.html` și `server.mjs`).
- `docs/PORT_PROGRESS.md`: secțiunea „Phase 3”.

**Verificat** (Chromium headless, telefon simulat 844×390, evenimente tactile prin CDP; mesajele
clientului citite prin interceptarea `__bzMockServer.onMessage`):
- solo fără roboți, de 3 ori: START, mers, viraj, foc (în mers și cu atingeri simple),
  meniu (deschis, ▼, BACK) și viraj prin înclinare;
- multiplayer cu `bzfs` real: lobby → START → condus;
- desktop: fără overlay, text de start neschimbat.

**Neverificat:**
- pe un telefon real;
- sensul **înainte/înapoi** la înclinare: stabilit doar din calcul în `onOrientation`; stânga/dreapta
  e verificat. Reglaje în `TILT_FULL` / `TILT_DEAD`;
- imaginile Docker.

**Lipsește:** chat pe ecran tactil (pasul următor din `docs/PORT_PROGRESS.md`).

## PR #3 — webStats în Docker (`claude/webstats-docker`)

**Componente:**
- `plugins/webStats/webStats.cpp`: plugin bzfs. Trimite evenimente JSON la un URL (în loturi, la
  ~1 s) și le adaugă și într-un fișier `.jsonl`.
  - Evenimente: server-start/stop, join/part, game-open, game-empty, kill, capture, flag, chat,
    auth, match-start/end, log.
  - Chatul privat și de admin e exclus implicit, iar IP-urile sunt mascate în log.
  - `game-open` = primul jucător ne-observator pe un server gol.
  - Configurare: `plugins/webStats/webStats.cfg` (INI, secțiunea `[webStats]`) sau direct un URL
    ca parametru.
- `plugins/webStats/web/`: serviciu web Node ≥ 22.13, fără dependențe npm.
  - `lib/store.js`: SQLite (`node:sqlite`); statistici, sesiuni, abonați.
  - `lib/webpush.js`: VAPID + aes128gcm cu `node:crypto`; testat cu vectorul din RFC 8291.
  - `server.js`: API, logul live prin SSE (`/api/stream`), `import FILE.jsonl`.
  - `public/`: pagină în română (Live, Istoric, Jucători, pagină de jucător, Notificări),
    service worker, manifest. **Doar URL-uri relative**, deci merge și sub `/stats/`.
  - Regula de notificare: fără o nouă notificare dacă jocul anterior s-a terminat de mai puțin de
    `NOTIFY_COOLDOWN_MIN` minute (implicit 10); nimic pentru evenimente mai vechi de 5 minute.
  - Teste: `cd plugins/webStats/web && npm test` (5/5).
- `plugins/webStats/INSTALL.ro.md` + `plugins/webStats/deploy/`: instalare pe Linux cu systemd și
  Caddy (pentru server non-Docker).
- CMake construiește acum plugin-uri:
  - `plugins/CMakeLists.txt` (doar webStats deocamdată; autotools le construiește pe toate);
  - în `src/bzfs/CMakeLists.txt`, `ENABLE_EXPORTS ON` pentru bzfs când `ENABLE_PLUGINS`. Fără
    asta, plugin-urile nu găsesc `bz_*`.
- `docker/server.mjs`:
  - pornește serviciul pe `127.0.0.1:8081` înainte de bzfs și îl repornește dacă moare;
  - generează o cheie pe rulare și scrie config-ul plugin-ului în tmp; adaugă `-loadplugin`;
  - la pornire importă `/data/webstats.jsonl`;
  - face proxy pentru `/stats/…`, dar **niciodată** pentru `/stats/api/ingest` (404);
  - pune link în lobby; oprește curat la SIGTERM.
  - Variabile: `WEBSTATS_DIR` (gol = oprit), `WEBSTATS_PORT`, `WEBSTATS_PLUGIN`, `DATA_DIR`,
    `SERVER_NAME`, `VAPID_SUBJECT`, `NOTIFY_COOLDOWN_MIN`.
- `docker/Dockerfile.multiplayer`:
  - `-DENABLE_PLUGINS=ON`, `make bzfs webStats`;
  - runtime **`node:22-alpine`** (era 20);
  - `VOLUME /data`; copiază `webStats.so` în `/usr/local/lib/bzflag/` și serviciul în `/app/webstats`.

**Rulare:**
```bash
docker run -p 8080:80 -v bzflag-data:/data -e SERVER_NAME="Romania CTF" \
  -e VAPID_SUBJECT=mailto:... bzflag-multiplayer
# joc: :8080   statistici: :8080/stats/
```
Notificările au nevoie de HTTPS: un proxy cu certificat în fața containerului.

**Verificat** (local, ca în container: bzfs + plugin construite cu CMake, `server.mjs`, client WASM):
- proxy și redirect; ingest blocat din exterior; service worker cu scope `/stats/`;
- logul live arată intrarea și „a deschis un joc” fără reîncărcare; sesiunea se închide la ieșire;
- date păstrate la repornire; importul a recuperat un eveniment ratat; oprire curată.

**Neverificat:**
- build-ul Docker (nu există daemon în container): compilarea pe Alpine/musl și `node:22-alpine`;
- livrarea reală a notificărilor push (serviciile de push nu sunt accesibile din container).

## Ce urmează (idei, în ordinea propusă)

1. Utilizatorul testează pe telefon (#2) și pe server real cu HTTPS (#3); reparat ce iese.
   Probabil sensul înainte/înapoi la TILT.
2. După merge: urmărit primul build CI al imaginii Docker (musl + plugin, node:22).
3. Chat pe ecran tactil (tastatură virtuală + `send all`).
4. Ajustări webStats discutate, nefăcute:
   - regula de notificare: minimum N jucători, ore de liniște, preferințe pe abonat;
   - excluderea boților de la `game-open`;
   - parolă pentru pagina de statistici sau doar pentru log (acum e publică);
   - curățare automată (ex. log > 90 zile);
   - clasament doar pentru conturi verificate.
5. Fișierele MSVC pentru webStats lipsesc (contează doar pe Windows).

## Mediul de lucru — capcane

- Containerul se recreează între sesiuni: pachetele instalate dispar. Pentru `bzfs` nativ:
  `apt-get install -y libc-ares-dev libcurl4-openssl-dev zlib1g-dev`.
- **Emscripten:**
  - `git clone https://github.com/emscripten-core/emsdk.git /opt/emsdk && cd /opt/emsdk && ./emsdk install 3.1.74 && ./emsdk activate 3.1.74`,
    apoi `source /opt/emsdk/emsdk_env.sh`.
  - Descărcările de arhive GitHub (`codeload.github.com`) sunt blocate (403) de rețea, deci
    porturile Emscripten nu se descarcă singure. Soluția folosită: `git clone --depth 1` pentru
    SDL `release-2.30.9` și zlib `v1.2.13`, apoi:
    - SDL2 instalat o dată cu `EMCC_LOCAL_PORTS="sdl2=/opt/emports/SDL" embuilder build sdl2`;
    - zlib copiat în `/opt/emsdk/upstream/emscripten/cache/ports/zlib/zlib-1.2.13`;
    - fișierul `.emscripten_url` scris în `cache/ports/{sdl2,zlib}` cu URL-ul din `tools/ports/*.py`,
      ca să nu mai încerce descărcarea.
  - Build: `mkdir build-emscripten && cd build-emscripten && emcmake cmake .. -DENABLE_CLIENT=ON -DENABLE_SERVER=OFF -DENABLE_BZADMIN=OFF && emmake make -j$(nproc)`,
    apoi copiat `web/mock-server.js` (+ `web/touch-controls.js` pe #2) lângă `bzflag.html`
    și servit cu `python3 -m http.server`.
- **bzfs nativ cu plugin:** `cmake .. -DENABLE_CLIENT=OFF -DENABLE_SERVER=ON -DENABLE_BZADMIN=OFF -DENABLE_PLUGINS=ON && make bzfs webStats`
  (în `build-native/`).
- **Nu există daemon Docker** în container; imaginile nu pot fi construite.
- **Playwright** e global (`npm root -g`), cu Chromium în `/opt/pw-browsers`.
  - Lansare cu `--use-gl=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
  - Telefon: `isMobile: true, hasTouch: true`; atingeri multiple prin
    `Input.dispatchTouchEvent` (CDP).
  - Pentru TILT: `context.grantPermissions(['accelerometer','gyroscope'])`.
  - Teste deterministe: scoate `-solo 3` din `Module.arguments` (fără roboți), altfel roboții
    distrug tancul în timpul testului.
- **Atenție la `pkill -f <text>`:** omoară și shell-ul curent dacă textul apare în comandă
  (exit 144). Folosește `pgrep` + `kill PID`.

## Reguli pentru sesiunea următoare

- Branch-uri noi + PR-uri doar pe `pirvu/bzflag`, spre branch-urile noastre; niciodată spre upstream.
- Fără identificator de model în commit-uri sau PR-uri.
- Utilizatorul scrie în română; răspunsurile în română.
