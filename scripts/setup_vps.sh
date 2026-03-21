#!/bin/bash
set -e

# Erstinstallation entlast.de auf frischem Hetzner VPS (Debian 12)
# Usage: Als root ausführen: bash setup_vps.sh

echo "=== entlast.de VPS Setup ==="
echo "Debian 12 / Hetzner CX22"
echo ""

# Prüfe root
if [ "$(id -u)" -ne 0 ]; then
    echo "FEHLER: Als root ausführen!"
    exit 1
fi

# System-Updates
echo ">>> System-Updates..."
apt update && apt upgrade -y

# Basis-Pakete
echo ">>> Basis-Pakete..."
apt install -y \
    python3 python3-venv python3-pip \
    git curl wget sqlite3 bc \
    mailutils \
    ufw fail2ban

# Caddy installieren (offizielles Repo)
echo ">>> Caddy installieren..."
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Restic für Backups
echo ">>> Restic installieren..."
apt install -y restic

# Firewall
echo ">>> Firewall konfigurieren..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw --force enable

# Fail2Ban aktivieren
echo ">>> Fail2Ban aktivieren..."
systemctl enable fail2ban
systemctl start fail2ban

# Service-User anlegen
echo ">>> User 'entlast' anlegen..."
id entlast &>/dev/null || useradd -r -m -d /opt/entlast -s /bin/bash entlast

# Projekt klonen
echo ">>> Repository klonen..."
if [ -d /opt/entlast/.git ]; then
    echo "    Bereits geklont, git pull..."
    cd /opt/entlast && git pull origin main
else
    git clone https://github.com/christophglunz-del/entlast.git /opt/entlast
fi

cd /opt/entlast

# Python venv
echo ">>> Python venv einrichten..."
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Datenverzeichnis
echo ">>> Datenverzeichnis..."
mkdir -p data/logos

# Rechte setzen
chown -R entlast:entlast /opt/entlast

# Systemd Service
echo ">>> Systemd Service installieren..."
cp scripts/entlast.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable entlast

# Caddy Config
echo ">>> Caddy konfigurieren..."
mkdir -p /var/log/caddy
cp scripts/Caddyfile /etc/caddy/Caddyfile
systemctl enable caddy

# Cron-Jobs
echo ">>> Cron-Jobs installieren..."
cp scripts/crontab.entlast /etc/cron.d/entlast
chmod 644 /etc/cron.d/entlast

# Log-Verzeichnisse
echo ">>> Log-Verzeichnisse..."
touch /var/log/entlast-backup.log /var/log/entlast-monitor.log
chown entlast:entlast /var/log/entlast-backup.log /var/log/entlast-monitor.log

# Scripts ausführbar machen
chmod +x /opt/entlast/scripts/*.sh

# Env-Datei für Secrets
echo ">>> Environment-Datei anlegen..."
mkdir -p /etc/entlast

if [ ! -f /etc/entlast/env ]; then
    cat > /etc/entlast/env <<EOF
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
ENCRYPTION_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
EOF
    chmod 600 /etc/entlast/env
    echo "    /etc/entlast/env angelegt (neue Keys generiert)"
else
    echo "    /etc/entlast/env existiert bereits — nicht überschrieben"
fi

if [ ! -f /etc/entlast/backup.env ]; then
    cat > /etc/entlast/backup.env <<EOF
RESTIC_REPOSITORY=sftp:user@storagebox.de:/backups/entlast
RESTIC_PASSWORD=CHANGE-ME
ALERT_EMAIL=admin@entlast.de
EOF
    chmod 600 /etc/entlast/backup.env
    echo "    /etc/entlast/backup.env angelegt — BITTE ANPASSEN!"
else
    echo "    /etc/entlast/backup.env existiert bereits — nicht überschrieben"
fi

# Services starten
echo ">>> Services starten..."
systemctl start entlast
systemctl start caddy

echo ""
echo "=== Setup abgeschlossen ==="
echo ""
echo "Nächste Schritte:"
echo "  1. /etc/entlast/env prüfen"
echo "  2. /etc/entlast/backup.env anpassen (Storage Box Zugangsdaten)"
echo "  3. DNS für entlast.de auf $(curl -s ifconfig.me) setzen"
echo "  4. Admin-User anlegen:"
echo "     cd /opt/entlast && source venv/bin/activate"
echo "     python3 scripts/create_admin.py"
echo "  5. Backup testen: /opt/entlast/scripts/backup.sh"
echo ""
