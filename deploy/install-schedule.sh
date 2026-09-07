#!/bin/sh
# Installs the 15-minute ingest+summarise cycle as a launchd agent.
# Run from the project root:  sh deploy/install-schedule.sh
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.smartnews.cycle.plist"
mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s#__PROJECT_DIR__#$DIR#g" \
    -e "s#__NPM__#$(command -v npm)#g" \
    -e "s#__PATH__#$PATH#g" \
    "$DIR/deploy/com.smartnews.cycle.plist" > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "loaded — runs every 15 minutes, logs to $DIR/data/cycle.log"
echo "stop with:  launchctl unload $PLIST"
