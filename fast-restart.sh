#!/bin/bash
# fast-restart.sh - One-click restart for OpenClaw Gateway on AWS

echo "🛑 Stopping OpenClaw Gateway..."

# 1. Kill by name (Graceful -> Force)
pkill -15 -f 'node dist/index.js gateway' || true
sleep 2
pkill -9 -f 'node dist/index.js gateway' || true

# 2. Force kill by ports (Cleanup stuck locks)
PORTS=(18789 18800 18801 18802 18803)
for PORT in "${PORTS[@]}"; do
    fuser -k -n tcp $PORT 2>/dev/null || true
done

# 3. Cleanup temp files (optional lock files if any)
# rm -f /tmp/openclaw.lock

# 4. Start Server
echo "🚀 Starting OpenClaw Gateway..."
export DISPLAY=:99
export HOME=/home/ubuntu
export NODE_ENV=production
export OPENCLAW_STATE_DIR=/home/ubuntu/.openclaw
export XDG_CONFIG_HOME=/home/ubuntu/.config

# Check Xvfb
if ! pgrep Xvfb > /dev/null; then
    echo "🖥️ Starting Xvfb..."
    nohup Xvfb :99 -screen 0 1280x800x24 -ac -nolisten tcp > /dev/null 2>&1 &
    sleep 2
else
    echo "🖥️ Xvfb already running."
fi

# Navigate to project directory
cd /home/ubuntu/my_bot


# Rotate logs
mv /tmp/openclaw.log /tmp/openclaw.log.old 2>/dev/null || true

# Run in background
nohup node dist/index.js gateway --bind lan --port 18789 > /tmp/openclaw.log 2>&1 &
PID=$!

echo "⏳ Waiting for startup (PID: $PID)..."

# Wait loop for service health
MAX_RETRIES=30
COUNT=0
URL="http://localhost:18803/register"

while [ $COUNT -lt $MAX_RETRIES ]; do
    if curl -s -I $URL | grep "200 OK" > /dev/null; then
        echo "✅ Service successfully started!"
        echo "   PID: $PID"
        echo "   Log: /tmp/openclaw.log"
        break
    fi
    sleep 1
    COUNT=$((COUNT+1))
    echo -n "."
done
echo ""

if [ $COUNT -eq $MAX_RETRIES ]; then
    echo "❌ Service failed to start (timeout). Last 20 lines of log:"
    tail -n 20 /tmp/openclaw.log
    # Check if process died
    if ! kill -0 $PID 2>/dev/null; then
         echo "Process $PID died."
    fi
    exit 1
fi

echo "   ✅ Custom App (Port 18803) is respondsive."

# 6. Start & Verify Browser
echo "🌐 Starting Browser Service..."
node dist/index.js browser start

echo "🔎 Verifying Browser Status..."
if node dist/index.js browser status | grep "running: true" > /dev/null; then
    echo "✅ Browser service is running."
else
    echo "⚠️ Browser service failed to start or is not running."
    # Optional: Print status for debugging
    node dist/index.js browser status
fi
