#!/bin/bash
set -e

# Deployment auf dem VPS: git pull, venv update, restart
# Usage: ./deploy.sh

LOG_TAG="[DEPLOY $(date '+%Y-%m-%d %H:%M:%S')]"
echo "$LOG_TAG Start"

cd /opt/entlast

# Git pull
echo "$LOG_TAG Git pull..."
git pull origin main

# Python venv update
echo "$LOG_TAG pip install..."
source venv/bin/activate
pip install -r requirements.txt --quiet

# DB-Migrationen (falls vorhanden)
echo "$LOG_TAG Migrationen..."
python -m app.migrate 2>/dev/null || true

# Restart
echo "$LOG_TAG Restart Service..."
systemctl restart entlast

# Warten bis Service läuft
sleep 2
if systemctl is-active --quiet entlast; then
    echo "$LOG_TAG OK — Service läuft"
else
    echo "$LOG_TAG FEHLER — Service nicht gestartet!"
    systemctl status entlast --no-pager
    exit 1
fi

echo "$LOG_TAG Deploy done: $(git log --oneline -1)"
