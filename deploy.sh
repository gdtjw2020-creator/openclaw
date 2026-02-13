#!/bin/bash
# OpenClaw Deploy Script - /home/ubuntu/deploy.sh
# Usage: bash deploy.sh [branch] [--skip-install]
# Example: bash deploy.sh prod
#          bash deploy.sh prod --skip-install

BRANCH="${1:-prod}"
SKIP_INSTALL="${2:-}"

cd /home/ubuntu/my_bot

echo ""
echo "========================================"
echo "  OpenClaw Deploy Script"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
echo ""

# Record old build timestamp
OLD_BUILD_TS=$(stat -c %Y dist/index.js 2>/dev/null || echo 0)

# Step 1: Pull latest code
echo "[deploy] [1/5] Pulling latest code from $BRANCH..."
PULL_START=$(date +%s)
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
PULL_END=$(date +%s)
COMMIT=$(git log -1 --format='%h %s')
echo "[deploy] [1/5] Done. ($(( PULL_END - PULL_START ))s) Commit: $COMMIT"
echo ""

# Step 2: Check if dependencies changed
LOCKFILE_CHANGED=$(git diff HEAD~1 --name-only 2>/dev/null | grep -c "pnpm-lock.yaml" || true)
if [ "$SKIP_INSTALL" = "--skip-install" ]; then
    echo "[deploy] [2/5] Skipping pnpm install (--skip-install flag)"
elif [ "$LOCKFILE_CHANGED" = "0" ]; then
    echo "[deploy] [2/5] Skipping pnpm install (lockfile unchanged)"
else
    echo "[deploy] [2/5] Installing dependencies..."
    INSTALL_START=$(date +%s)
    pnpm install --frozen-lockfile 2>&1
    INSTALL_END=$(date +%s)
    echo "[deploy] [2/5] Done. ($(( INSTALL_END - INSTALL_START ))s)"
fi
echo ""

# Step 3: Stop service to free memory for build
echo "[deploy] [3/5] Stopping service to free memory..."
sudo systemctl stop openclaw-gateway 2>/dev/null || true
sleep 1
echo "[deploy] [3/5] Done. Memory free: $(free -h | awk '/Mem:/{print $4}')"
echo ""

# Step 4: Build
echo "[deploy] [4/5] Building (tsdown + post-build scripts)..."
BUILD_START=$(date +%s)
pnpm build 2>&1 || true
BUILD_END=$(date +%s)
BUILD_TIME=$(( BUILD_END - BUILD_START ))

# Check if dist/index.js was actually rebuilt
NEW_BUILD_TS=$(stat -c %Y dist/index.js 2>/dev/null || echo 0)
if [ "$NEW_BUILD_TS" -gt "$OLD_BUILD_TS" ]; then
    echo "[deploy] [4/5] Done. Build took ${BUILD_TIME}s (dist/index.js updated)"
else
    echo "[deploy] [4/5] FAILED! dist/index.js was NOT updated. Restarting with old code..."
    sudo systemctl start openclaw-gateway
    exit 1
fi
echo ""

# Step 5: Restart service
echo "[deploy] [5/5] Restarting openclaw-gateway..."
sudo systemctl restart openclaw-gateway
sleep 3
echo "[deploy] [5/5] Done."
echo ""

# Final status
SERVICE_STATUS=$(systemctl is-active openclaw-gateway)
BUILD_TS=$(ls -l --time-style=long-iso dist/index.js | awk '{print $6, $7}')
echo "========================================"
echo "  DEPLOYMENT COMPLETE"
echo "  Service: $SERVICE_STATUS"
echo "  Commit:  $COMMIT"
echo "  Built:   $BUILD_TS"
echo "  Time:    $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
echo ""
