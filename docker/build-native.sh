#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

# Build image if needed
docker build -t bzflag-native-cmake -f docker/Dockerfile.native-cmake docker/

# Ensure build dir exists
mkdir -p build-native

# Run cmake + make inside container
docker run --rm --user "$(id -u):$(id -g)" -v "$REPO_ROOT:/src" -w /src bzflag-native-cmake bash -c "
  cd build-native &&
  cmake .. -DENABLE_CLIENT=ON -DENABLE_SERVER=ON -DENABLE_BZADMIN=ON 2>&1 | tee cmake.log &&
  make -j\$(nproc) 2>&1 | tee build.log
"
