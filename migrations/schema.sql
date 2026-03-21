-- =============================================================================
-- entlast.de SQLite Schema
-- Generiert am 2026-03-21 aus Susi-App Dexie/IndexedDB Schema (v5) + JS-Module
-- =============================================================================

-- ===========================
-- auth.db (zentrale Auth-DB)
-- ===========================

-- Mandanten (Firmen)
CREATE TABLE IF NOT EXISTS mandanten (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                -- z.B. "Susi's Alltagshilfe"
    slug TEXT NOT NULL UNIQUE,         -- z.B. "susi" (URL-safe, DB-Dateiname)
    db_datei TEXT NOT NULL,            -- z.B. "data/susi.db"
    aktiv INTEGER NOT NULL DEFAULT 1,  -- 1=aktiv, 0=deaktiviert
    erstellt TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Benutzer (Login-Accounts)
CREATE TABLE IF NOT EXISTS auth_benutzer (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,        -- bcrypt
    mandant_id INTEGER NOT NULL REFERENCES mandanten(id),
    name TEXT NOT NULL,                 -- Anzeigename
    rolle TEXT NOT NULL DEFAULT 'user', -- 'admin' | 'user'
    aktiv INTEGER NOT NULL DEFAULT 1,
    letzter_login TEXT,
    fehlversuche INTEGER NOT NULL DEFAULT 0,
    gesperrt_bis TEXT,                  -- Brute-Force-Schutz
    erstellt TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,                -- UUID Session-Token
    benutzer_id INTEGER NOT NULL REFERENCES auth_benutzer(id),
    mandant_id INTEGER NOT NULL REFERENCES mandanten(id),
    erstellt TEXT NOT NULL DEFAULT (datetime('now')),
    laeuft_ab TEXT NOT NULL,            -- erstellt + 8h
    ip_adresse TEXT,
    user_agent TEXT
);


-- ===========================
-- Mandanten-DB (z.B. susi.db)
-- ===========================

-- Firmendaten (genau 1 Zeile pro Mandant-DB)
-- Ersetzt das hardcoded FIRMA-Objekt aus db.js
CREATE TABLE IF NOT EXISTS firma (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- Immer genau 1 Zeile
    name TEXT NOT NULL,                      -- "Susi's Alltagshilfe"
    inhaber TEXT NOT NULL,                   -- "Susanne Schlosser"
    untertitel TEXT,                          -- "Die freundliche Alltagshilfe"
    strasse TEXT NOT NULL,
    plz TEXT NOT NULL,
    ort TEXT NOT NULL,
    telefon TEXT,
    email TEXT,
    steuernummer TEXT,
    ik_nummer TEXT,                           -- IK-Nummer (Institutionskennzeichen)
    bank TEXT,
    iban TEXT,                                -- VERSCHLUESSELT (Fernet)
    bic TEXT,
    angebots_id TEXT,                         -- z.B. "080123F8M2"
    stundensatz REAL NOT NULL DEFAULT 32.75,
    monats_budget REAL NOT NULL DEFAULT 131.00,
    km_satz REAL NOT NULL DEFAULT 0.30,
    kleinunternehmer INTEGER NOT NULL DEFAULT 1,  -- 1=ja (§19 UStG)
    start_adresse TEXT,                       -- Standard-Startadresse für Fahrten
    logo_datei TEXT,                           -- Pfad zu Logo-Datei
    farbe_primary TEXT DEFAULT '#E91E7B',      -- Mandanten-Farbe (Hex)
    farbe_primary_dark TEXT DEFAULT '#C2185B',  -- Dunklere Variante
    erstellt TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pflegekassen-Verzeichnis
-- Ersetzt das hardcoded PFLEGEKASSEN-Array aus db.js
CREATE TABLE IF NOT EXISTS pflegekassen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    fax TEXT,
    adresse TEXT,
    erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Kunden
-- Quelle: Dexie Schema v5 + tatsächliche Felder aus kunden.js
CREATE TABLE IF NOT EXISTS kunden (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    strasse TEXT,
    plz TEXT,
    ort TEXT,
    telefon TEXT,
    email TEXT,
    geburtstag TEXT,                          -- ISO date: "YYYY-MM-DD"
    versichertennummer TEXT,                   -- VERSCHLUESSELT (Fernet)
    pflegekasse TEXT,
    fax_kasse TEXT,
    pflegegrad TEXT,                           -- "1"-"5" als String
    pflegegrad_seit TEXT,                      -- ISO date: "YYYY-MM-DD"
    besonderheiten TEXT,
    kundentyp TEXT NOT NULL DEFAULT 'pflege',  -- 'pflege' | 'dienstleistung' | 'inaktiv'
    lexoffice_id TEXT,                         -- Lexoffice UUID
    lexoffice_version INTEGER,
    vorleistungen TEXT,                        -- JSON: {"2025": 500.00, "2026": 0}
    uebertrag_vorvorjahr REAL DEFAULT 0,       -- Manueller Übertrag aus Vorvorjahr
    erstellt TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kunden_name ON kunden(name);
CREATE INDEX IF NOT EXISTS idx_kunden_kundentyp ON kunden(kundentyp);
CREATE INDEX IF NOT EXISTS idx_kunden_lexoffice_id ON kunden(lexoffice_id);

-- Leistungen (Leistungsnachweise)
-- Quelle: Dexie Schema + leistung.js formular + monatsunterschrift
CREATE TABLE IF NOT EXISTS leistungen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kunde_id INTEGER NOT NULL REFERENCES kunden(id),
    datum TEXT NOT NULL,                       -- ISO date: "YYYY-MM-DD"
    startzeit TEXT NOT NULL,                   -- "HH:MM"
    endzeit TEXT NOT NULL,                     -- "HH:MM"
    betreuung INTEGER NOT NULL DEFAULT 0,      -- boolean 0/1
    alltagsbegleitung INTEGER NOT NULL DEFAULT 0,
    pflegebegleitung INTEGER NOT NULL DEFAULT 0,
    hauswirtschaft INTEGER NOT NULL DEFAULT 0,
    objekt_innen INTEGER NOT NULL DEFAULT 0,   -- Reinigung innen (Objekt)
    objekt_aussen INTEGER NOT NULL DEFAULT 0,  -- Reinigung außen (Objekt)
    freitext TEXT,                             -- Freitext-Leistungsbeschreibung
    notizen TEXT,
    unterschrift TEXT,                          -- base64 PNG (Monatsunterschrift)
    unterschrift_datum TEXT,                    -- Datum der Unterschrift
    erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leistungen_kunde_id ON leistungen(kunde_id);
CREATE INDEX IF NOT EXISTS idx_leistungen_datum ON leistungen(datum);

-- Fahrten (Kilometeraufzeichnung)
-- Quelle: Dexie Schema + fahrten.js
CREATE TABLE IF NOT EXISTS fahrten (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    datum TEXT NOT NULL,                        -- ISO date: "YYYY-MM-DD"
    wochentag TEXT,                             -- "Montag", "Dienstag", ...
    start_adresse TEXT,                         -- Standard: Firmenadresse
    ziel_adressen TEXT,                         -- JSON array: ["Adresse 1", "Adresse 2"]
    strecken TEXT,                              -- JSON (Routenabschnitte, optional)
    gesamt_km REAL NOT NULL DEFAULT 0,
    tracking_km REAL,                           -- GPS-gemessene km (optional)
    betrag REAL NOT NULL DEFAULT 0,             -- gesamt_km * km_satz
    notiz TEXT,
    gps_track TEXT,                             -- JSON array: [{lat, lng, time, accuracy}]
    route_beschreibung TEXT,                    -- Textuelle Routenbeschreibung
    erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fahrten_datum ON fahrten(datum);

-- Termine
-- Quelle: Dexie Schema + termine.js
CREATE TABLE IF NOT EXISTS termine (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kunde_id INTEGER REFERENCES kunden(id),     -- Optional (kann auch kundenlos sein)
    titel TEXT,
    datum TEXT NOT NULL,                         -- ISO date: "YYYY-MM-DD"
    startzeit TEXT NOT NULL,                     -- "HH:MM"
    endzeit TEXT,                                -- "HH:MM" (optional)
    wiederkehrend INTEGER NOT NULL DEFAULT 0,    -- 0/1
    wiederholungs_muster TEXT,                   -- JSON: {"wochentag": 1} (1=Mo, 2=Di, ...)
    farbe TEXT,                                  -- Hex-Farbcode (optional)
    notizen TEXT,
    erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_termine_datum ON termine(datum);
CREATE INDEX IF NOT EXISTS idx_termine_kunde_id ON termine(kunde_id);
CREATE INDEX IF NOT EXISTS idx_termine_wiederkehrend ON termine(wiederkehrend);

-- Abtretungserklärungen
-- Quelle: Dexie Schema + abtretung.js
CREATE TABLE IF NOT EXISTS abtretungen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kunde_id INTEGER NOT NULL REFERENCES kunden(id),
    datum TEXT NOT NULL,                         -- ISO date
    ort TEXT DEFAULT 'Hattingen',
    pflegekasse TEXT,                            -- Redundant (auch in Kunden), aber Snapshot
    unterschrift TEXT,                           -- base64 PNG
    pdf_data TEXT,                               -- base64 PDF (generiertes Dokument)
    erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_abtretungen_kunde_id ON abtretungen(kunde_id);

-- Rechnungen
-- Quelle: Dexie Schema v3 + rechnung.js
CREATE TABLE IF NOT EXISTS rechnungen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kunde_id INTEGER NOT NULL REFERENCES kunden(id),
    rechnungsnummer TEXT,                        -- z.B. "2026-001" (nach Finalisierung)
    monat INTEGER NOT NULL,                      -- 1-12
    jahr INTEGER NOT NULL,
    betrag REAL,
    status TEXT NOT NULL DEFAULT 'offen',         -- 'offen' | 'versendet' | 'eingegangen' | 'bezahlt'
    versandart TEXT,                              -- 'fax' | 'brief' | 'email' | 'webmail'
    versand_datum TEXT,
    bezahlt_datum TEXT,
    lexoffice_invoice_id TEXT,                    -- Lexoffice UUID (optional)
    lexoffice_document_file_id TEXT,              -- Lexoffice Document-File-ID (optional)
    notizen TEXT,
    erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rechnungen_kunde_id ON rechnungen(kunde_id);
CREATE INDEX IF NOT EXISTS idx_rechnungen_status ON rechnungen(status);
CREATE INDEX IF NOT EXISTS idx_rechnungen_monat_jahr ON rechnungen(monat, jahr);

-- Settings (Key-Value Store)
-- Quelle: Dexie Schema + settings.js
-- ACHTUNG: API-Keys werden NICHT mehr im Browser gespeichert!
-- Sie liegen als Umgebungsvariablen auf dem Server.
-- Dieses Settings-Tabelle ist nur noch für App-spezifische Einstellungen.
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT                                    -- JSON oder String
);

-- Audit-Log (immutable, 7 Jahre Aufbewahrung)
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zeitstempel TEXT NOT NULL DEFAULT (datetime('now')),
    benutzer_id INTEGER,                          -- Wer hat die Aktion ausgeführt
    benutzer_name TEXT,                            -- Snapshot des Namens
    aktion TEXT NOT NULL,                          -- 'create' | 'update' | 'delete' | 'read' | 'login' | 'export'
    ressource TEXT NOT NULL,                       -- 'kunden' | 'leistungen' | 'rechnungen' | ...
    ressource_id INTEGER,                          -- ID des betroffenen Datensatzes
    alte_werte TEXT,                                -- JSON Snapshot vor Änderung
    neue_werte TEXT,                                -- JSON Snapshot nach Änderung
    ip_adresse TEXT,
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_zeitstempel ON audit_log(zeitstempel);
CREATE INDEX IF NOT EXISTS idx_audit_ressource ON audit_log(ressource, ressource_id);
CREATE INDEX IF NOT EXISTS idx_audit_benutzer ON audit_log(benutzer_id);

-- =============================================================================
-- Initialdaten
-- =============================================================================

-- Standard-Pflegekassen (aus PFLEGEKASSEN-Array in db.js)
INSERT OR IGNORE INTO pflegekassen (name) VALUES
    ('AOK Nordwest'),
    ('Barmer'),
    ('DAK-Gesundheit'),
    ('Techniker Krankenkasse'),
    ('Knappschaft'),
    ('Novitas BKK'),
    ('energie-BKK'),
    ('IKK classic'),
    ('VIACTIV Krankenkasse'),
    ('BKK VBU'),
    ('Sonstige');

-- =============================================================================
-- Hinweise
-- =============================================================================

-- VERSCHLUESSELTE FELDER (Fernet/AES, Key als Env-Var ENCRYPTION_KEY):
--   - kunden.versichertennummer
--   - firma.iban
--
-- DATENTYPEN-MAPPING (IndexedDB → SQLite):
--   - Dexie ++id (autoincrement) → INTEGER PRIMARY KEY AUTOINCREMENT
--   - JS boolean (true/false) → INTEGER (0/1)
--   - JS Date.toISOString() → TEXT (ISO 8601)
--   - JS Array (zielAdressen) → TEXT (JSON serialized)
--   - JS Object (wiederholungsMuster) → TEXT (JSON serialized)
--   - JS base64 string (unterschrift) → TEXT
--   - JS number (betrag, km) → REAL
--
-- UMBENENNUNG camelCase → snake_case:
--   - kundeId → kunde_id
--   - faxKasse → fax_kasse
--   - pflegegradSeit → pflegegrad_seit
--   - gesamtKm → gesamt_km
--   - startAdresse → start_adresse
--   - zielAdressen → ziel_adressen
--   - gpsTrack → gps_track
--   - wiederholungsMuster → wiederholungs_muster
--   - pdfData → pdf_data
--   - versandDatum → versand_datum
--   - bezahltDatum → bezahlt_datum
--   - lexofficeInvoiceId → lexoffice_invoice_id
--   - lexofficeDocumentFileId → lexoffice_document_file_id
--   - objektInnen → objekt_innen
--   - objektAussen → objekt_aussen
--   - unterschriftDatum → unterschrift_datum
--   - trackingKm → tracking_km
--   - routeBeschreibung → route_beschreibung
--   - vorleistungen → vorleistungen (JSON bleibt)
--   - uebertragVorvorjahr → uebertrag_vorvorjahr
