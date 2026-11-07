#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

# Build image
docker build -t bzflag-emscripten -f docker/Dockerfile.emscripten docker/

mkdir -p build-emscripten

docker run --rm -v "$REPO_ROOT:/src" -w /src bzflag-emscripten bash -c "
  cd build-emscripten &&
  emcmake cmake .. -DENABLE_CLIENT=ON -DENABLE_SERVER=OFF -DENABLE_BZADMIN=OFF 2>&1 | tee cmake.log &&
  emmake make -j\$(nproc) 2>&1 | tee build.log
"
