#!/bin/bash
set -e

# Setup display environment
export DISPLAY=:99
export HOME=${HOME:-/home/node}
export XDG_CONFIG_HOME="${HOME}/.config"
export XDG_CACHE_HOME="${HOME}/.cache"

# Create necessary directories
mkdir -p "${XDG_CONFIG_HOME}" "${XDG_CACHE_HOME}" "${HOME}/.chrome"

# Start D-Bus daemon if not running (best effort, may fail without root)
if [ ! -f /run/dbus/pid ] || ! kill -0 $(cat /run/dbus/pid 2>/dev/null) 2>/dev/null; then
    rm -f /run/dbus/pid
    dbus-daemon --system --fork 2>/dev/null || true
fi

# Clean up stale Xvfb lock files before starting
rm -f /tmp/.X99-lock 2>/dev/null || true

# Kill any existing Xvfb process on display :99
pkill -f "Xvfb :99" 2>/dev/null || true
sleep 0.5

# Start Xvfb virtual display (required for Chromium to run properly)
# Using display :99 with 1280x800 resolution and 24-bit color depth
Xvfb :99 -screen 0 1280x800x24 -ac -nolisten tcp &
XVFB_PID=$!

# Wait for Xvfb to start
sleep 1

# Verify Xvfb is running
if kill -0 $XVFB_PID 2>/dev/null; then
    echo "[entrypoint] Xvfb started on display :99 (pid $XVFB_PID)"
else
    echo "[entrypoint] WARNING: Xvfb failed to start"
fi

echo "[entrypoint] DISPLAY=$DISPLAY"

# Execute the main command
exec "$@"
