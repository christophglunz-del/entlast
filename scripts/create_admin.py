#!/usr/bin/env python3
"""Admin-User und Mandant anlegen fuer entlast.de.

Interaktives Script — fragt nach Mandant-Name, Username, Passwort.
Legt Mandant + User in auth.db an und erstellt leere Mandanten-DB.
"""

import getpass
import os
import sqlite3
import sys

# bcrypt importieren
try:
    import bcrypt
except ImportError:
    print("FEHLER: bcrypt nicht installiert. pip install bcrypt")
    sys.exit(1)


DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
AUTH_DB = os.path.join(DB_DIR, "auth.db")


def init_auth_db(conn: sqlite3.Connection) -> None:
    """Auth-DB Schema anlegen falls noch nicht vorhanden.

    WICHTIG: Schema muss identisch sein mit app/database.py init_auth_db()!
    """
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS mandanten (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            db_datei TEXT NOT NULL UNIQUE,
            aktiv INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS auth_benutzer (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            mandant_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            rolle TEXT NOT NULL DEFAULT 'user',
            aktiv INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (mandant_id) REFERENCES mandanten(id)
        );
    """)


def init_mandant_db(db_path: str) -> None:
    """Leere Mandanten-DB mit vollem Schema anlegen.

    WICHTIG: Schema muss identisch sein mit app/database.py init_mandant_db()!
    Aenderungen IMMER an beiden Stellen vornehmen.
    """
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS firma (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT,
            inhaber TEXT,
            strasse TEXT,
            plz TEXT,
            ort TEXT,
            telefon TEXT,
            email TEXT,
            steuernummer TEXT,
            iban TEXT,
            bic TEXT,
            bank TEXT,
            logo_datei TEXT,
            farbe_primary TEXT DEFAULT '#E91E7B',
            farbe_primary_dark TEXT DEFAULT '#C2185B',
            untertitel TEXT,
            kleinunternehmer INTEGER NOT NULL DEFAULT 1
        );

        INSERT OR IGNORE INTO firma (id) VALUES (1);

        CREATE TABLE IF NOT EXISTS kunden (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            vorname TEXT,
            strasse TEXT,
            plz TEXT,
            ort TEXT,
            telefon TEXT,
            email TEXT,
            geburtsdatum TEXT,
            pflegegrad INTEGER,
            versichertennummer_encrypted TEXT,
            pflegekasse TEXT,
            pflegekasse_fax TEXT,
            iban_encrypted TEXT,
            kundentyp TEXT NOT NULL DEFAULT 'pflege',
            aktiv INTEGER NOT NULL DEFAULT 1,
            besonderheiten TEXT,
            lexoffice_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS leistungen (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kunde_id INTEGER NOT NULL,
            datum TEXT NOT NULL,
            von TEXT,
            bis TEXT,
            dauer_std REAL,
            leistungsarten TEXT,
            betrag REAL,
            unterschrift_betreuer TEXT,
            unterschrift_versicherter TEXT,
            notiz TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (kunde_id) REFERENCES kunden(id)
        );

        CREATE TABLE IF NOT EXISTS fahrten (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kunde_id INTEGER,
            datum TEXT NOT NULL,
            wochentag TEXT,
            start_adresse TEXT,
            ziel_adressen TEXT,
            gesamt_km REAL,
            tracking_km REAL,
            betrag REAL,
            notiz TEXT,
            gps_track TEXT,
            von_ort TEXT,
            nach_ort TEXT,
            km REAL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (kunde_id) REFERENCES kunden(id)
        );

        CREATE TABLE IF NOT EXISTS termine (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kunde_id INTEGER NOT NULL,
            datum TEXT NOT NULL,
            von TEXT,
            bis TEXT,
            titel TEXT,
            notiz TEXT,
            erledigt INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (kunde_id) REFERENCES kunden(id)
        );

        CREATE TABLE IF NOT EXISTS abtretungen (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kunde_id INTEGER NOT NULL,
            datum TEXT NOT NULL,
            gueltig_ab TEXT,
            gueltig_bis TEXT,
            unterschrift TEXT,
            pflegekasse TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (kunde_id) REFERENCES kunden(id)
        );

        CREATE TABLE IF NOT EXISTS rechnungen (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kunde_id INTEGER NOT NULL,
            rechnungsnummer TEXT,
            datum TEXT,
            monat INTEGER,
            jahr INTEGER,
            typ TEXT NOT NULL DEFAULT 'kasse',
            positionen TEXT,
            betrag_netto REAL,
            betrag_brutto REAL,
            status TEXT NOT NULL DEFAULT 'entwurf',
            lexoffice_id TEXT,
            versand_art TEXT,
            versand_datum TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (kunde_id) REFERENCES kunden(id)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS pflegekassen (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            strasse TEXT,
            plz TEXT,
            ort TEXT,
            fax TEXT,
            ik_nummer TEXT
        );

        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            user_id INTEGER,
            action TEXT NOT NULL,
            resource_type TEXT,
            resource_id INTEGER,
            old_value TEXT,
            new_value TEXT,
            ip_address TEXT,
            status TEXT
        );

        -- Indizes
        CREATE INDEX IF NOT EXISTS idx_kunden_name ON kunden(name);
        CREATE INDEX IF NOT EXISTS idx_kunden_aktiv ON kunden(aktiv);
        CREATE INDEX IF NOT EXISTS idx_leistungen_kunde ON leistungen(kunde_id);
        CREATE INDEX IF NOT EXISTS idx_leistungen_datum ON leistungen(datum);
        CREATE INDEX IF NOT EXISTS idx_fahrten_kunde ON fahrten(kunde_id);
        CREATE INDEX IF NOT EXISTS idx_termine_kunde ON termine(kunde_id);
        CREATE INDEX IF NOT EXISTS idx_termine_datum ON termine(datum);
        CREATE INDEX IF NOT EXISTS idx_rechnungen_kunde ON rechnungen(kunde_id);
        CREATE INDEX IF NOT EXISTS idx_rechnungen_status ON rechnungen(status);
        CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
        CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
    """)
    conn.close()


def slugify(name: str) -> str:
    """Einfache Slug-Generierung aus Firmenname."""
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[äÄ]", "ae", slug)
    slug = re.sub(r"[öÖ]", "oe", slug)
    slug = re.sub(r"[üÜ]", "ue", slug)
    slug = re.sub(r"[ß]", "ss", slug)
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug


def main() -> None:
    print("=== entlast.de — Admin-User anlegen ===\n")

    # Mandant
    mandant_name = input("Firmenname (Mandant): ").strip()
    if not mandant_name:
        print("FEHLER: Firmenname darf nicht leer sein.")
        sys.exit(1)

    slug = slugify(mandant_name)
    db_datei = f"mandant_{slug}.db"
    print(f"  Slug: {slug}")
    print(f"  DB:   {db_datei}")

    # Admin-User
    username = input("\nAdmin-Username: ").strip()
    if not username:
        print("FEHLER: Username darf nicht leer sein.")
        sys.exit(1)

    display_name = input("Anzeigename: ").strip() or username

    password = getpass.getpass("Passwort: ")
    password2 = getpass.getpass("Passwort (Wiederholung): ")
    if password != password2:
        print("FEHLER: Passwörter stimmen nicht überein.")
        sys.exit(1)
    if len(password) < 8:
        print("FEHLER: Passwort muss mindestens 8 Zeichen lang sein.")
        sys.exit(1)

    # Passwort hashen
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    # Auth-DB
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(AUTH_DB)
    init_auth_db(conn)

    # Mandant anlegen
    try:
        cursor = conn.execute(
            "INSERT INTO mandanten (name, db_datei, aktiv) VALUES (?, ?, 1)",
            (mandant_name, db_datei),
        )
        mandant_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        print(f"FEHLER: Mandant mit DB '{db_datei}' existiert bereits.")
        conn.close()
        sys.exit(1)

    # User anlegen
    try:
        conn.execute(
            "INSERT INTO auth_benutzer (username, password_hash, mandant_id, name, rolle, aktiv) "
            "VALUES (?, ?, ?, ?, 'admin', 1)",
            (username, password_hash, mandant_id, display_name),
        )
    except sqlite3.IntegrityError:
        print(f"FEHLER: Username '{username}' existiert bereits.")
        conn.rollback()
        conn.close()
        sys.exit(1)

    conn.commit()
    conn.close()

    # Mandanten-DB anlegen
    mandant_db_path = os.path.join(DB_DIR, db_datei)
    if os.path.exists(mandant_db_path):
        print(f"WARNUNG: {db_datei} existiert bereits — Schema wird ergaenzt.")
    init_mandant_db(mandant_db_path)

    print(f"\nErfolgreich angelegt:")
    print(f"  Mandant:  {mandant_name} (ID {mandant_id})")
    print(f"  User:     {username} (admin)")
    print(f"  DB:       data/{db_datei}")


if __name__ == "__main__":
    main()
