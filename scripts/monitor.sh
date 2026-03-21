#!/bin/bash
set -e

# Health-Check + Alerting für entlast.de
# Cron: */5 * * * * entlast /opt/entlast/scripts/monitor.sh

LOG_TAG="[MONITOR $(date '+%Y-%m-%d %H:%M:%S')]"
ALERT_EMAIL="${ALERT_EMAIL:-admin@entlast.de}"
RESTART_COUNT_FILE="/tmp/entlast-restart-count"
MAX_RESTARTS=3
PROBLEMS=""

# --- Hilfsfunktionen ---

alert() {
    local subject="$1"
    local body="$2"
    echo "$LOG_TAG ALERT: $subject"
    echo "$body" | mail -s "[entlast.de] $subject" "$ALERT_EMAIL" 2>/dev/null || \
        echo "$LOG_TAG Mail-Versand fehlgeschlagen: $subject — $body"
}

add_problem() {
    PROBLEMS="${PROBLEMS}\n- $1"
}

# --- Checks ---

# 1. HTTP Health-Check
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://entlast.de/api/v1/health 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" != "200" ]; then
    add_problem "HTTP Health-Check fehlgeschlagen (Status: $HTTP_STATUS)"
    echo "$LOG_TAG WARN: HTTP Status $HTTP_STATUS"
else
    echo "$LOG_TAG OK: HTTP 200"
fi

# 2. Disk-Usage
DISK_PCT=$(df /opt/entlast | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_PCT" -ge 90 ]; then
    add_problem "KRITISCH: Disk ${DISK_PCT}% voll!"
    echo "$LOG_TAG CRITICAL: Disk ${DISK_PCT}%"
elif [ "$DISK_PCT" -ge 80 ]; then
    add_problem "Disk ${DISK_PCT}% voll (Warnung)"
    echo "$LOG_TAG WARN: Disk ${DISK_PCT}%"
else
    echo "$LOG_TAG OK: Disk ${DISK_PCT}%"
fi

# 3. SQLite Integrität
for DB in /opt/entlast/data/*.db; do
    if [ -f "$DB" ]; then
        DBNAME=$(basename "$DB")
        INTEGRITY=$(sqlite3 "$DB" "PRAGMA integrity_check;" 2>/dev/null || echo "FEHLER")
        if [ "$INTEGRITY" != "ok" ]; then
            add_problem "SQLite $DBNAME korrupt: $INTEGRITY"
            echo "$LOG_TAG WARN: $DBNAME integrity: $INTEGRITY"
        else
            echo "$LOG_TAG OK: $DBNAME intakt"
        fi
    fi
done

# 4. Systemd Service
if systemctl is-active --quiet entlast; then
    echo "$LOG_TAG OK: Service aktiv"
    # Reset restart counter
    echo "0" > "$RESTART_COUNT_FILE"
else
    echo "$LOG_TAG WARN: Service nicht aktiv!"

    # Restart-Zähler lesen
    COUNT=0
    [ -f "$RESTART_COUNT_FILE" ] && COUNT=$(cat "$RESTART_COUNT_FILE")

    if [ "$COUNT" -lt "$MAX_RESTARTS" ]; then
        echo "$LOG_TAG Auto-Restart Versuch $((COUNT+1))/$MAX_RESTARTS..."
        systemctl restart entlast 2>/dev/null || true
        sleep 3

        if systemctl is-active --quiet entlast; then
            echo "$LOG_TAG OK: Auto-Restart erfolgreich"
            alert "Service neu gestartet" "Auto-Restart #$((COUNT+1)) war erfolgreich."
        else
            echo "$LOG_TAG FEHLER: Auto-Restart gescheitert"
            add_problem "Service down — Auto-Restart #$((COUNT+1)) gescheitert"
        fi

        echo "$((COUNT+1))" > "$RESTART_COUNT_FILE"
    else
        add_problem "Service down — Max. Restarts ($MAX_RESTARTS) erreicht, manueller Eingriff nötig!"
    fi
fi

# 5. Letztes Backup nicht älter als 25h?
if command -v restic &> /dev/null && [ -f /etc/entlast/backup.env ]; then
    set -a
    source /etc/entlast/backup.env 2>/dev/null
    set +a

    LAST_BACKUP=$(restic snapshots --json --last 1 2>/dev/null | python3 -c "
import sys, json
from datetime import datetime, timezone
data = json.load(sys.stdin)
if data:
    ts = data[0]['time'][:19]
    dt = datetime.strptime(ts, '%Y-%m-%dT%H:%M:%S')
    age_h = (datetime.now() - dt).total_seconds() / 3600
    print(f'{age_h:.1f}')
else:
    print('999')
" 2>/dev/null || echo "999")

    if [ "$(echo "$LAST_BACKUP > 25" | bc 2>/dev/null || echo 1)" = "1" ]; then
        add_problem "Letztes Backup ist ${LAST_BACKUP}h alt (>25h Limit)"
        echo "$LOG_TAG WARN: Backup ${LAST_BACKUP}h alt"
    else
        echo "$LOG_TAG OK: Backup ${LAST_BACKUP}h alt"
    fi
fi

# --- Alert senden falls Probleme ---

if [ -n "$PROBLEMS" ]; then
    BODY="Probleme auf entlast.de ($(hostname)):\n${PROBLEMS}\n\nZeit: $(date)"
    alert "Monitoring-Alert" "$(echo -e "$BODY")"
fi
