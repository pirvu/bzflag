#!/bin/bash
# Start a BZFlag server with websockify proxy for browser clients.
#
# Prerequisites:
#   - bzfs built natively (build-native/src/bzfs/bzfs)
#   - websockify installed: pip install websockify
#   - A web server to serve the WASM build (e.g., python3 -m http.server)
#
# Usage:
#   ./tools/ws-proxy/start-server.sh [bzfs-port] [ws-port]
#
# Default: bzfs on port 5154, websockify on port 5155
# The browser client should connect to localhost:5155

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BZFS_PORT="${1:-5154}"
WS_PORT="${2:-5155}"

BZFS="$REPO_ROOT/build-native/src/bzfs/bzfs"

if [ ! -x "$BZFS" ]; then
    echo "Error: bzfs not found at $BZFS"
    echo "Build it first: ./docker/build-native.sh"
    exit 1
fi

if ! command -v websockify &>/dev/null; then
    echo "Error: websockify not found. Install with: pip install websockify"
    exit 1
fi

echo "=== BZFlag WebSocket Proxy Setup ==="
echo "  bzfs port:      $BZFS_PORT"
echo "  WebSocket port: $WS_PORT"
echo ""
echo "  Browser client should connect to: localhost:$WS_PORT"
echo ""

# Start bzfs in the background with solo-friendly settings
echo "Starting bzfs..."
"$BZFS" -p "$BZFS_PORT" -c -b -ms 3 -mp 8 -j +r -public "BZFlag WASM Test" -nolist &
BZFS_PID=$!
echo "  bzfs PID: $BZFS_PID"

# Give bzfs a moment to start
sleep 1

if ! kill -0 "$BZFS_PID" 2>/dev/null; then
    echo "Error: bzfs failed to start"
    exit 1
fi

# Start websockify to bridge WebSocket -> TCP
echo "Starting websockify (ws:$WS_PORT -> tcp:$BZFS_PORT)..."
websockify "$WS_PORT" localhost:"$BZFS_PORT" &
WS_PID=$!
echo "  websockify PID: $WS_PID"

echo ""
echo "=== Ready ==="
echo "Serve the WASM build with:"
echo "  cd $REPO_ROOT/build-emscripten/src/bzflag && python3 -m http.server 8080"
echo ""
echo "Then open: http://localhost:8080/bzflag.html"
echo ""
echo "Press Ctrl+C to stop both processes."

# Trap Ctrl+C to clean up both processes
cleanup() {
    echo ""
    echo "Shutting down..."
    kill "$WS_PID" 2>/dev/null || true
    kill "$BZFS_PID" 2>/dev/null || true
    wait
    echo "Done."
}
trap cleanup INT TERM

# Wait for either process to exit
wait
