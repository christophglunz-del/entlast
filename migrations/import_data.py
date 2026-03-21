#!/usr/bin/env python3
"""
Import-Script: Susi-App JSON-Export → entlast.de SQLite

Liest die JSON-Datei aus DB.exportAlles() und importiert sie in das neue
SQLite-Schema. Sensible Felder werden verschlüsselt (Fernet).

Usage:
  python import_data.py --json export.json --mandant "susi" --db data/susi.db
  python import_data.py --json export.json --mandant "susi" --db data/susi.db --auth-db data/auth.db

Optionen:
  --json       Pfad zur JSON-Export-Datei (aus Susi-App Einstellungen → Export)
  --mandant    Mandanten-Slug (z.B. "susi")
  --db         Pfad zur Mandanten-SQLite-DB (wird erstellt falls nicht vorhanden)
  --auth-db    Pfad zur zentralen Auth-DB (default: data/auth.db)
  --admin-user Admin-Username (default: "admin")
  --admin-pass Admin-Passwort (default: wird generiert)
  --key        Fernet-Verschlüsselungsschlüssel (Base64, oder via ENCRYPTION_KEY env var)
  --dry-run    Nur validieren, nichts schreiben
"""

import argparse
import json
import os
import secrets
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

try:
    from cryptography.fernet import Fernet
except ImportError:
    print("FEHLER: 'cryptography' Paket nicht installiert.")
    print("  pip install cryptography")
    sys.exit(1)

try:
    import bcrypt
except ImportError:
    print("FEHLER: 'bcrypt' Paket nicht installiert.")
    print("  pip install bcrypt")
    sys.exit(1)


# =============================================================================
# Hilfsfunktionen
# =============================================================================

def camel_to_snake(name: str) -> str:
    """camelCase → snake_case"""
    import re
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()


# Mapping: JS-Feldnamen (camelCase) → DB-Feldnamen (snake_case)
FIELD_MAP = {
    # Kunden
    'kundeId': 'kunde_id',
    'faxKasse': 'fax_kasse',
    'pflegegradSeit': 'pflegegrad_seit',
    'lexofficeId': 'lexoffice_id',
    'lexofficeVersion': 'lexoffice_version',
    'uebertragVorvorjahr': 'uebertrag_vorvorjahr',
    # Leistungen
    'objektInnen': 'objekt_innen',
    'objektAussen': 'objekt_aussen',
    'unterschriftDatum': 'unterschrift_datum',
    # Fahrten
    'startAdresse': 'start_adresse',
    'zielAdressen': 'ziel_adressen',
    'gesamtKm': 'gesamt_km',
    'trackingKm': 'tracking_km',
    'gpsTrack': 'gps_track',
    'routeBeschreibung': 'route_beschreibung',
    # Termine
    'wiederholungsMuster': 'wiederholungs_muster',
    # Abtretungen
    'pdfData': 'pdf_data',
    # Rechnungen
    'rechnungsnummer': 'rechnungsnummer',
    'versandDatum': 'versand_datum',
    'bezahltDatum': 'bezahlt_datum',
    'lexofficeInvoiceId': 'lexoffice_invoice_id',
    'lexofficeDocumentFileId': 'lexoffice_document_file_id',
}

# Felder die als JSON serialisiert werden müssen
JSON_FIELDS = {'ziel_adressen', 'strecken', 'gps_track', 'wiederholungs_muster', 'vorleistungen'}

# Felder die verschlüsselt werden
ENCRYPTED_FIELDS = {'versichertennummer'}  # IBAN ist in firma-Tabelle, nicht in Export

# Boolean-Felder (JS true/false → SQLite 0/1)
BOOL_FIELDS = {
    'betreuung', 'alltagsbegleitung', 'pflegebegleitung', 'hauswirtschaft',
    'objekt_innen', 'objekt_aussen', 'wiederkehrend', 'kleinunternehmer'
}


def map_field_name(js_name: str) -> str:
    """JS camelCase → DB snake_case"""
    if js_name in FIELD_MAP:
        return FIELD_MAP[js_name]
    return camel_to_snake(js_name)


def transform_value(db_field: str, value, fernet: Fernet):
    """Wert für DB transformieren: JSON, Bool, Verschlüsselung"""
    if value is None:
        return None

    if db_field in ENCRYPTED_FIELDS and value:
        return fernet.encrypt(str(value).encode()).decode()

    if db_field in JSON_FIELDS:
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        if isinstance(value, str):
            return value  # Bereits JSON-String
        return json.dumps(value)

    if db_field in BOOL_FIELDS:
        if isinstance(value, bool):
            return 1 if value else 0
        if isinstance(value, int):
            return 1 if value else 0
        return 0

    return value


def get_table_columns(conn: sqlite3.Connection, table: str) -> set:
    """Spalten einer Tabelle abfragen"""
    cursor = conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cursor.fetchall()}


# =============================================================================
# Schema erstellen
# =============================================================================

SCHEMA_PATH = Path(__file__).parent / 'schema.sql'


def create_schema(db_path: str, schema_type: str = 'mandant'):
    """SQLite-Schema erstellen"""
    conn = sqlite3.connect(db_path)

    if schema_type == 'auth':
        # Nur auth-relevante Tabellen
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS mandanten (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                db_datei TEXT NOT NULL,
                aktiv INTEGER NOT NULL DEFAULT 1,
                erstellt TEXT NOT NULL DEFAULT (datetime('now')),
                aktualisiert TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS auth_benutzer (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                mandant_id INTEGER NOT NULL REFERENCES mandanten(id),
                name TEXT NOT NULL,
                rolle TEXT NOT NULL DEFAULT 'user',
                aktiv INTEGER NOT NULL DEFAULT 1,
                letzter_login TEXT,
                fehlversuche INTEGER NOT NULL DEFAULT 0,
                gesperrt_bis TEXT,
                erstellt TEXT NOT NULL DEFAULT (datetime('now')),
                aktualisiert TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                benutzer_id INTEGER NOT NULL REFERENCES auth_benutzer(id),
                mandant_id INTEGER NOT NULL REFERENCES mandanten(id),
                erstellt TEXT NOT NULL DEFAULT (datetime('now')),
                laeuft_ab TEXT NOT NULL,
                ip_adresse TEXT,
                user_agent TEXT
            );
        """)
    else:
        # Mandanten-DB: Schema aus schema.sql laden (ohne auth-Tabellen)
        if SCHEMA_PATH.exists():
            schema_sql = SCHEMA_PATH.read_text(encoding='utf-8')
            # Nur Mandanten-Tabellen (alles nach "Mandanten-DB")
            marker = "-- Mandanten-DB"
            if marker in schema_sql:
                schema_sql = schema_sql[schema_sql.index(marker):]
            # Auth-Tabellen rausfiltern
            lines = []
            skip = False
            for line in schema_sql.split('\n'):
                if 'CREATE TABLE IF NOT EXISTS mandanten' in line:
                    skip = True
                if 'CREATE TABLE IF NOT EXISTS auth_benutzer' in line:
                    skip = True
                if 'CREATE TABLE IF NOT EXISTS sessions' in line:
                    skip = True
                if skip and line.strip() == ');':
                    skip = False
                    continue
                if not skip:
                    lines.append(line)
            conn.executescript('\n'.join(lines))
        else:
            print(f"  WARNUNG: {SCHEMA_PATH} nicht gefunden, verwende inline Schema")
            _create_mandant_schema_inline(conn)

    conn.commit()
    conn.close()


def _create_mandant_schema_inline(conn):
    """Fallback: Schema inline erstellen wenn schema.sql nicht gefunden"""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS firma (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT NOT NULL, inhaber TEXT NOT NULL, untertitel TEXT,
            strasse TEXT NOT NULL, plz TEXT NOT NULL, ort TEXT NOT NULL,
            telefon TEXT, email TEXT, steuernummer TEXT, ik_nummer TEXT,
            bank TEXT, iban TEXT, bic TEXT, angebots_id TEXT,
            stundensatz REAL NOT NULL DEFAULT 32.75,
            monats_budget REAL NOT NULL DEFAULT 131.00,
            km_satz REAL NOT NULL DEFAULT 0.30,
            kleinunternehmer INTEGER NOT NULL DEFAULT 1,
            start_adresse TEXT, logo_datei TEXT,
            farbe_primary TEXT DEFAULT '#E91E7B',
            farbe_primary_dark TEXT DEFAULT '#C2185B',
            erstellt TEXT NOT NULL DEFAULT (datetime('now')),
            aktualisiert TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS pflegekassen (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE, fax TEXT, adresse TEXT,
            erstellt TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS kunden (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, strasse TEXT, plz TEXT, ort TEXT,
            telefon TEXT, email TEXT, geburtstag TEXT,
            versichertennummer TEXT, pflegekasse TEXT, fax_kasse TEXT,
            pflegegrad TEXT, pflegegrad_seit TEXT, besonderheiten TEXT,
            kundentyp TEXT NOT NULL DEFAULT 'pflege',
            lexoffice_id TEXT, lexoffice_version INTEGER,
            vorleistungen TEXT, uebertrag_vorvorjahr REAL DEFAULT 0,
            erstellt TEXT NOT NULL DEFAULT (datetime('now')),
            aktualisiert TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS leistungen (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kunde_id INTEGER NOT NULL REFERENCES kunden(id),
            datum TEXT NOT NULL, startzeit TEXT NOT NULL, endzeit TEXT NOT NULL,
            betreuung INTEGER NOT NULL DEFAULT 0,
            alltagsbegleitung INTEGER NOT NULL DEFAULT 0,
            pflegebegleitung INTEGER NOT NULL DEFAULT 0,
            hauswirtschaft INTEGER NOT NULL DEFAULT 0,
            objekt_innen INTEGER NOT NULL DEFAULT 0,
            objekt_aussen INTEGER NOT NULL DEFAULT 0,
            freitext TEXT, notizen TEXT, unterschrift TEXT,
            unterschrift_datum TEXT,
            erstellt TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS fahrten (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            datum TEXT NOT NULL, wochentag TEXT, start_adresse TEXT,
            ziel_adressen TEXT, strecken TEXT,
            gesamt_km REAL NOT NULL DEFAULT 0,
            tracking_km REAL, betrag REAL NOT NULL DEFAULT 0,
            notiz TEXT, gps_track TEXT, route_beschreibung TEXT,
            erstellt TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS termine (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kunde_id INTEGER REFERENCES kunden(id),
            titel TEXT, datum TEXT NOT NULL, startzeit TEXT NOT NULL,
            endzeit TEXT, wiederkehrend INTEGER NOT NULL DEFAULT 0,
            wiederholungs_muster TEXT, farbe TEXT, notizen TEXT,
            erstellt TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS abtretungen (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kunde_id INTEGER NOT NULL REFERENCES kunden(id),
            datum TEXT NOT NULL, ort TEXT DEFAULT 'Hattingen',
            pflegekasse TEXT, unterschrift TEXT, pdf_data TEXT,
            erstellt TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS rechnungen (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kunde_id INTEGER NOT NULL REFERENCES kunden(id),
            rechnungsnummer TEXT, monat INTEGER NOT NULL, jahr INTEGER NOT NULL,
            betrag REAL, status TEXT NOT NULL DEFAULT 'offen',
            versandart TEXT, versand_datum TEXT, bezahlt_datum TEXT,
            lexoffice_invoice_id TEXT, lexoffice_document_file_id TEXT,
            notizen TEXT,
            erstellt TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            zeitstempel TEXT NOT NULL DEFAULT (datetime('now')),
            benutzer_id INTEGER, benutzer_name TEXT,
            aktion TEXT NOT NULL, ressource TEXT NOT NULL,
            ressource_id INTEGER, alte_werte TEXT, neue_werte TEXT,
            ip_adresse TEXT, user_agent TEXT
        );

        INSERT OR IGNORE INTO pflegekassen (name) VALUES
            ('AOK Nordwest'), ('Barmer'), ('DAK-Gesundheit'),
            ('Techniker Krankenkasse'), ('Knappschaft'), ('Novitas BKK'),
            ('energie-BKK'), ('IKK classic'), ('VIACTIV Krankenkasse'),
            ('BKK VBU'), ('Sonstige');
    """)


# =============================================================================
# Import-Logik
# =============================================================================

def import_table(conn: sqlite3.Connection, table_name: str, records: list,
                 fernet: Fernet, id_mapping: dict = None) -> dict:
    """
    Importiert Records in eine Tabelle.
    Gibt ein Mapping {alte_id: neue_id} zurück.
    """
    if not records:
        return {}

    db_columns = get_table_columns(conn, table_name)
    mapping = {}

    for record in records:
        # Felder transformieren
        row = {}
        for js_key, value in record.items():
            db_key = map_field_name(js_key)

            # 'id' übernehmen (für Foreign-Key-Konsistenz)
            if js_key == 'id':
                row['id'] = value
                continue

            # Nur Felder einfügen die in der DB existieren
            if db_key not in db_columns:
                continue

            row[db_key] = transform_value(db_key, value, fernet)

        if not row:
            continue

        # kunde_id Mapping anwenden (falls Kunden umgemappt wurden)
        if id_mapping and 'kunde_id' in row and row['kunde_id'] in id_mapping:
            row['kunde_id'] = id_mapping[row['kunde_id']]

        # ID mit einfügen (um Referenzen zu erhalten)
        old_id = record.get('id')
        if old_id is not None:
            row['id'] = old_id

        columns = list(row.keys())
        placeholders = ', '.join(['?' for _ in columns])
        col_str = ', '.join(columns)

        try:
            cursor = conn.execute(
                f"INSERT OR REPLACE INTO {table_name} ({col_str}) VALUES ({placeholders})",
                [row[c] for c in columns]
            )
            new_id = cursor.lastrowid
            if old_id is not None:
                mapping[old_id] = new_id
        except sqlite3.Error as e:
            print(f"  FEHLER bei {table_name} Record {old_id}: {e}")
            continue

    return mapping


def import_settings(conn: sqlite3.Connection, settings: list, fernet: Fernet):
    """Settings importieren (Key-Value Paare)"""
    # API-Keys NICHT importieren (werden serverseitig als Env-Vars verwaltet)
    skip_keys = {
        'lexoffice_api_key', 'lexoffice_proxy_url',
        'sipgate_token_id', 'sipgate_token', 'sipgate_faxline_id',
        'letterxpress_user', 'letterxpress_key',
        'gcal_client_id', 'gcal_access_token', 'gcal_token_expiry',
        'gcal_calendar_id', 'gcal_last_sync',
    }

    imported = 0
    for entry in settings:
        key = entry.get('key')
        value = entry.get('value')

        if key in skip_keys:
            print(f"  SKIP Setting '{key}' (API-Key, wird serverseitig verwaltet)")
            continue

        if value is not None and not isinstance(value, str):
            value = json.dumps(value)

        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value)
        )
        imported += 1

    return imported


def insert_firma(conn: sqlite3.Connection, fernet: Fernet):
    """Standard-Firmendaten einfügen (aus FIRMA-Konstante in db.js)"""
    # Verschlüsselte IBAN
    iban_encrypted = fernet.encrypt(b'DE73 1001 1001 2270 9718 12').decode()

    conn.execute("""
        INSERT OR REPLACE INTO firma (
            id, name, inhaber, untertitel, strasse, plz, ort,
            telefon, email, steuernummer, ik_nummer,
            bank, iban, bic, angebots_id,
            stundensatz, monats_budget, km_satz, kleinunternehmer,
            start_adresse, farbe_primary, farbe_primary_dark
        ) VALUES (
            1, "Susi's Alltagshilfe", 'Susanne Schlosser', 'Die freundliche Alltagshilfe',
            'Kreisstraße 12', '45525', 'Hattingen',
            '01556 0117030', 'hallo@susisalltagshilfe.de', '323/5096/5116', '462524110',
            'N26', ?, 'NTSBDEB1XXX', '080123F8M2',
            32.75, 131.00, 0.30, 1,
            'Kreisstraße 12, 45525 Hattingen', '#E91E7B', '#C2185B'
        )
    """, (iban_encrypted,))


# =============================================================================
# Hauptprogramm
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Susi-App JSON-Export → entlast.de SQLite importieren'
    )
    parser.add_argument('--json', required=True, help='Pfad zur JSON-Export-Datei')
    parser.add_argument('--mandant', required=True, help='Mandanten-Slug (z.B. "susi")')
    parser.add_argument('--db', required=True, help='Pfad zur Mandanten-SQLite-DB')
    parser.add_argument('--auth-db', default='data/auth.db', help='Pfad zur Auth-DB')
    parser.add_argument('--admin-user', default='admin', help='Admin-Username')
    parser.add_argument('--admin-pass', default=None, help='Admin-Passwort (wird generiert wenn leer)')
    parser.add_argument('--key', default=None, help='Fernet-Key (Base64) oder via ENCRYPTION_KEY env')
    parser.add_argument('--dry-run', action='store_true', help='Nur validieren')

    args = parser.parse_args()

    # === Fernet-Key ===
    encryption_key = args.key or os.environ.get('ENCRYPTION_KEY')
    if not encryption_key:
        encryption_key = Fernet.generate_key().decode()
        print(f"\n  NEUER ENCRYPTION_KEY generiert (sicher aufbewahren!):")
        print(f"  {encryption_key}\n")
    fernet = Fernet(encryption_key.encode() if isinstance(encryption_key, str) else encryption_key)

    # === JSON laden ===
    print(f"\n1. JSON-Export laden: {args.json}")
    with open(args.json, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Validierung
    expected_keys = {'kunden', 'leistungen', 'fahrten', 'termine', 'abtretungen', 'rechnungen', 'settings'}
    found_keys = set(data.keys()) & expected_keys
    print(f"   Gefundene Tabellen: {', '.join(sorted(found_keys))}")
    print(f"   Export-Datum: {data.get('exportDatum', 'unbekannt')}")
    print(f"   Version: {data.get('version', 'unbekannt')}")

    counts = {}
    for key in expected_keys:
        items = data.get(key, [])
        counts[key] = len(items)
        print(f"   {key}: {len(items)} Einträge")

    if args.dry_run:
        print("\n  DRY RUN — keine Änderungen geschrieben.")
        return

    # === Verzeichnisse erstellen ===
    Path(args.db).parent.mkdir(parents=True, exist_ok=True)
    Path(args.auth_db).parent.mkdir(parents=True, exist_ok=True)

    # === Auth-DB erstellen ===
    print(f"\n2. Auth-DB erstellen: {args.auth_db}")
    create_schema(args.auth_db, schema_type='auth')

    auth_conn = sqlite3.connect(args.auth_db)

    # Mandant anlegen
    auth_conn.execute(
        "INSERT OR IGNORE INTO mandanten (name, slug, db_datei) VALUES (?, ?, ?)",
        (f"Susi's Alltagshilfe", args.mandant, args.db)
    )
    mandant_row = auth_conn.execute(
        "SELECT id FROM mandanten WHERE slug = ?", (args.mandant,)
    ).fetchone()
    mandant_id = mandant_row[0]
    print(f"   Mandant '{args.mandant}' angelegt (ID: {mandant_id})")

    # Admin-User anlegen
    admin_pass = args.admin_pass or secrets.token_urlsafe(12)
    password_hash = bcrypt.hashpw(admin_pass.encode(), bcrypt.gensalt()).decode()

    auth_conn.execute(
        """INSERT OR IGNORE INTO auth_benutzer
           (username, password_hash, mandant_id, name, rolle)
           VALUES (?, ?, ?, ?, ?)""",
        (args.admin_user, password_hash, mandant_id, 'Administrator', 'admin')
    )
    auth_conn.commit()
    auth_conn.close()
    print(f"   Admin-User: {args.admin_user}")
    print(f"   Admin-Passwort: {admin_pass}")

    # === Mandanten-DB erstellen ===
    print(f"\n3. Mandanten-DB erstellen: {args.db}")
    create_schema(args.db, schema_type='mandant')

    conn = sqlite3.connect(args.db)

    # Firma-Daten einfügen
    print("   Firmendaten einfügen...")
    insert_firma(conn, fernet)

    # === Daten importieren ===
    print("\n4. Daten importieren...")

    # Kunden zuerst (für Foreign Keys)
    kunden = data.get('kunden', [])
    print(f"   Kunden: {len(kunden)} Einträge...")
    kunden_mapping = import_table(conn, 'kunden', kunden, fernet)
    print(f"   → {len(kunden_mapping)} importiert")

    # Leistungen
    leistungen = data.get('leistungen', [])
    print(f"   Leistungen: {len(leistungen)} Einträge...")
    import_table(conn, 'leistungen', leistungen, fernet, kunden_mapping)
    print(f"   → importiert")

    # Fahrten
    fahrten = data.get('fahrten', [])
    print(f"   Fahrten: {len(fahrten)} Einträge...")
    import_table(conn, 'fahrten', fahrten, fernet)
    print(f"   → importiert")

    # Termine
    termine = data.get('termine', [])
    print(f"   Termine: {len(termine)} Einträge...")
    import_table(conn, 'termine', termine, fernet, kunden_mapping)
    print(f"   → importiert")

    # Abtretungen
    abtretungen = data.get('abtretungen', [])
    print(f"   Abtretungen: {len(abtretungen)} Einträge...")
    import_table(conn, 'abtretungen', abtretungen, fernet, kunden_mapping)
    print(f"   → importiert")

    # Rechnungen
    rechnungen = data.get('rechnungen', [])
    print(f"   Rechnungen: {len(rechnungen)} Einträge...")
    import_table(conn, 'rechnungen', rechnungen, fernet, kunden_mapping)
    print(f"   → importiert")

    # Settings (ohne API-Keys)
    settings = data.get('settings', [])
    print(f"   Settings: {len(settings)} Einträge...")
    imported = import_settings(conn, settings, fernet)
    print(f"   → {imported} importiert (API-Keys übersprungen)")

    # Audit-Log: Import dokumentieren
    conn.execute(
        """INSERT INTO audit_log (benutzer_name, aktion, ressource, neue_werte)
           VALUES (?, ?, ?, ?)""",
        ('import_data.py', 'create', 'import',
         json.dumps({
             'kunden': counts.get('kunden', 0),
             'leistungen': counts.get('leistungen', 0),
             'fahrten': counts.get('fahrten', 0),
             'termine': counts.get('termine', 0),
             'abtretungen': counts.get('abtretungen', 0),
             'rechnungen': counts.get('rechnungen', 0),
             'export_datum': data.get('exportDatum', ''),
         }))
    )

    conn.commit()
    conn.close()

    # === Zusammenfassung ===
    print("\n" + "=" * 60)
    print("  IMPORT ABGESCHLOSSEN")
    print("=" * 60)
    print(f"  Mandanten-DB: {args.db}")
    print(f"  Auth-DB:      {args.auth_db}")
    print(f"  Mandant:      {args.mandant} (ID: {mandant_id})")
    print(f"  Admin-User:   {args.admin_user}")
    print(f"  Admin-Pass:   {admin_pass}")
    print(f"  ENCRYPTION_KEY: {encryption_key}")
    print()
    print("  WICHTIG: ENCRYPTION_KEY sicher aufbewahren!")
    print("  Ohne diesen Schlüssel können verschlüsselte Felder")
    print("  (Versichertennummer, IBAN) nicht entschlüsselt werden.")
    print()
    print("  Empfehlung: Als Umgebungsvariable setzen:")
    print(f'  export ENCRYPTION_KEY="{encryption_key}"')
    print("=" * 60)


if __name__ == '__main__':
    main()
