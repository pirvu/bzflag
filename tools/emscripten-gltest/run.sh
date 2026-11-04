#!/usr/bin/env bash
# Build and run the GL emulation pixel tests in headless Chromium.
# Needs emcc (emsdk activated), node and playwright. No Emscripten ports
# are used, so this works without network access to download them.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
OUT="${OUT:-$ROOT/build-gltest}"
mkdir -p "$OUT"
# config.h for common.h, from a configure-only CMake run
if [ ! -f "$OUT/cmake/include/config.h" ]; then
    emcmake cmake -S "$ROOT" -B "$OUT/cmake" -DENABLE_CLIENT=ON \
        -DENABLE_SERVER=OFF -DENABLE_BZADMIN=OFF > "$OUT/cmake.log"
fi

em++ -std=c++17 -O2 -DHAVE_CONFIG_H -I"$ROOT/include" -I"$OUT/cmake/include" \
    gltest.cxx "$ROOT/src/ogl/OpenGLVertexBuffer.cxx" -lglut \
    -sLEGACY_GL_EMULATION=1 -sGL_UNSAFE_OPTS=0 \
    -sMIN_WEBGL_VERSION=1 -sMAX_WEBGL_VERSION=2 \
    -o "$OUT/gltest.html"

node run.mjs "$OUT" gltest.html DONE 120000 | tee "$OUT/gltest.log"
grep -q '^DONE failures=0' "$OUT/gltest.log"
