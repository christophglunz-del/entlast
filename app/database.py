"""Datenbank-Schicht: SQLite-Verbindung pro Mandant + Schema-Initialisierung.

Jeder Mandant hat seine eigene SQLite-Datei.
Die zentrale auth.db verwaltet Mandanten und Benutzer.
"""

import os
import sqlite3
from pathlib import Path

# Basis-Pfad fuer Datenbank-Dateien
DATA_DIR = Path(os.environ.get("ENTLAST_DATA_DIR", Path(__file__).parent.parent / "data"))
AUTH_DB_PATH = DATA_DIR / "auth.db"


def dict_factory(cursor: sqlite3.Cursor, row: tuple) -> dict:
    """Row-Factory: Gibt Zeilen als dict zurueck."""
    fields = [column[0] for column in cursor.description]
    return dict(zip(fields, row))


def get_auth_db() -> sqlite3.Connection:
    """Verbindung zur zentralen Auth-DB."""
    conn = sqlite3.connect(str(AUTH_DB_PATH), check_same_thread=False)
    conn.row_factory = dict_factory
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def get_mandant_db(db_datei: str) -> sqlite3.Connection:
    """Verbindung zur Mandanten-DB."""
    db_path = DATA_DIR / db_datei
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = dict_factory
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_auth_db():
    """Erstellt die zentrale Auth-DB mit Mandanten- und Benutzer-Tabelle."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_auth_db()
    try:
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
        conn.commit()
    finally:
        conn.close()


def init_mandant_db(db_datei: str):
    """Erstellt alle Tabellen in einer Mandanten-DB."""
    conn = get_mandant_db(db_datei)
    try:
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

            -- Firma: genau 1 Zeile sicherstellen
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
                kunde_id INTEGER NOT NULL,
                datum TEXT NOT NULL,
                von_ort TEXT,
                nach_ort TEXT,
                km REAL,
                betrag REAL,
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

            -- Indizes fuer haeufige Abfragen
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
        conn.commit()
    finally:
        conn.close()


def write_audit_log(
    conn: sqlite3.Connection,
    user_id: int | None,
    action: str,
    resource_type: str | None = None,
    resource_id: int | None = None,
    old_value: str | None = None,
    new_value: str | None = None,
    ip_address: str | None = None,
    status: str | None = None,
):
    """Schreibt einen Eintrag ins Audit-Log der Mandanten-DB."""
    conn.execute(
        """INSERT INTO audit_log
           (user_id, action, resource_type, resource_id, old_value, new_value, ip_address, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (user_id, action, resource_type, resource_id, old_value, new_value, ip_address, status),
    )
    conn.commit()
