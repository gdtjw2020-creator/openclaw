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

# Rotate logs
mv /tmp/openclaw.log /tmp/openclaw.log.old 2>/dev/null || true

# Run in background
nohup node dist/index.js gateway --bind lan --port 18789 > /tmp/openclaw.log 2>&1 &
PID=$!

echo "⏳ Waiting for startup (PID: $PID)..."
sleep 5

# 5. Verification
if pgrep -f 'node dist/index.js gateway' > /dev/null; then
    echo "✅ Service successfully started!"
    echo "   PID: $PID"
    echo "   Log: /tmp/openclaw.log"
    echo "   Testing health..."
    sleep 2
    if curl -s -I http://localhost:18803/register | grep "200 OK" > /dev/null; then
        echo "   ✅ Custom App (Port 18803) is respondsive."
    else
        echo "   ⚠️ Custom App port 18803 not responding yet (check logs)."
    fi
else
    echo "❌ Service failed to start. Last 20 lines of log:"
    tail -n 20 /tmp/openclaw.log
    exit 1
fi
