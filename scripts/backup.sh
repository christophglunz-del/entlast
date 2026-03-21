#!/bin/bash
set -e

# Verschlüsseltes Backup mit Restic auf Hetzner Storage Box
# Cron: 0 2 * * * entlast /opt/entlast/scripts/backup.sh

LOG_TAG="[BACKUP $(date '+%Y-%m-%d %H:%M:%S')]"

# Environment laden
if [ -f /etc/entlast/backup.env ]; then
    set -a
    source /etc/entlast/backup.env
    set +a
else
    echo "$LOG_TAG FEHLER: /etc/entlast/backup.env nicht gefunden!"
    exit 1
fi

# Prüfe ob Restic-Variablen gesetzt
if [ -z "$RESTIC_REPOSITORY" ] || [ -z "$RESTIC_PASSWORD" ]; then
    echo "$LOG_TAG FEHLER: RESTIC_REPOSITORY oder RESTIC_PASSWORD nicht gesetzt!"
    exit 1
fi

cd /opt/entlast

# Repository initialisieren (nur beim allerersten Mal)
restic snapshots > /dev/null 2>&1 || {
    echo "$LOG_TAG Repository wird initialisiert..."
    restic init
}

echo "$LOG_TAG Backup startet..."

# Backup: Datenbanken, Logos, App-Code
restic backup \
    data/*.db \
    data/logos/ \
    app/ \
    requirements.txt \
    --tag entlast \
    --exclude-caches

echo "$LOG_TAG Backup abgeschlossen."

# Alte Snapshots aufräumen: 30 daily, 12 monthly
echo "$LOG_TAG Retention Policy anwenden..."
restic forget \
    --keep-daily 30 \
    --keep-monthly 12 \
    --prune

# Integrität prüfen
echo "$LOG_TAG Verify..."
restic check

echo "$LOG_TAG Fertig. Letzte Snapshots:"
restic snapshots --last 3
