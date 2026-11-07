#!/usr/bin/env bash
# 1. glucmp: QuadricGeometry against the system libGLU, natively (skipped
#    without g++ and the libGLU development files).
# 2. gltest: the GL emulation pixel tests in headless Chromium. Needs emcc
#    (emsdk activated), node and playwright. No Emscripten ports are used,
#    so this works without network access to download them.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
OUT="${OUT:-$ROOT/build-gltest}"
mkdir -p "$OUT"
if command -v g++ > /dev/null && [ -f /usr/include/GL/glu.h ]; then
    g++ -std=c++17 -O1 -rdynamic -I"$ROOT/include" glucmp.cxx \
        "$ROOT/src/ogl/QuadricGeometry.cxx" -lGLU -lGL -o "$OUT/glucmp"
    "$OUT/glucmp" > "$OUT/glucmp.log" || { grep -v '^PASS' "$OUT/glucmp.log"; exit 1; }
    tail -1 "$OUT/glucmp.log"
else
    echo "glucmp skipped (needs g++ and libGLU headers)"
fi

# config.h for common.h, from a configure-only CMake run
if [ ! -f "$OUT/cmake/include/config.h" ]; then
    emcmake cmake -S "$ROOT" -B "$OUT/cmake" -DENABLE_CLIENT=ON \
        -DENABLE_SERVER=OFF -DENABLE_BZADMIN=OFF > "$OUT/cmake.log"
fi

em++ -std=c++17 -O2 -DHAVE_CONFIG_H -I"$ROOT/include" -I"$OUT/cmake/include" \
    gltest.cxx "$ROOT/src/ogl/OpenGLVertexBuffer.cxx" \
    "$ROOT/src/ogl/QuadricGeometry.cxx" "$ROOT/src/ogl/EmscriptenQuadrics.cxx" -lglut \
    -sLEGACY_GL_EMULATION=1 -sGL_UNSAFE_OPTS=0 \
    -sMIN_WEBGL_VERSION=1 -sMAX_WEBGL_VERSION=2 \
    -o "$OUT/gltest.html"

node run.mjs "$OUT" gltest.html DONE 120000 | tee "$OUT/gltest.log"
grep -q '^DONE failures=0' "$OUT/gltest.log"
