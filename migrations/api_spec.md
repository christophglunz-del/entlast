# API-Spezifikation: Susi-App → entlast.de REST-API

> Generiert am 2026-03-21 aus vollständiger Analyse aller JS-Module der Susi-App.

## Zusammenfassung

- **DB.js Funktionen gesamt: 35**
- **REST-Endpoints gesamt: 46** (inkl. Auth, Firma, Services, Health)
- **Backend-Services (aus JS portiert): 3** (Lexoffice, Sipgate, LetterXpress)
- **Entfallende Module: 2** (gcal.js, sw.js Background Sync)

---

## 1. DB.js → REST-Endpoint Mapping (35 Funktionen)

### Kunden (6 Funktionen)

| # | db.js Funktion | HTTP Method | Endpoint | Request Body | Response |
|---|---|---|---|---|---|
| 1 | `DB.alleKunden()` | GET | `/api/v1/kunden` | - | `[{id, name, versichertennummer, pflegekasse, pflegegrad, strasse, plz, ort, telefon, email, faxKasse, geburtstag, besonderheiten, lexofficeId, kundentyp, pflegegradSeit, vorleistungen, uebertragVorvorjahr, erstellt, aktualisiert}]` |
| 2 | `DB.kundeById(id)` | GET | `/api/v1/kunden/{id}` | - | `{id, name, ...}` |
| 3 | `DB.kundeHinzufuegen(kunde)` | POST | `/api/v1/kunden` | `{name, strasse, plz, ort, telefon, email, versichertennummer, pflegekasse, faxKasse, pflegegrad, pflegegradSeit, geburtstag, besonderheiten, kundentyp}` | `{id, name, ..., erstellt, aktualisiert}` |
| 4 | `DB.kundeAktualisieren(id, daten)` | PUT | `/api/v1/kunden/{id}` | `{name?, strasse?, ...}` (partial update) | `{id, name, ..., aktualisiert}` |
| 5 | `DB.kundeLoeschen(id)` | DELETE | `/api/v1/kunden/{id}` | - | `{ok: true}` |
| 6 | `DB.kundenSuchen(suchbegriff)` | GET | `/api/v1/kunden?q={suchbegriff}` | - | `[{id, name, ...}]` |

### Leistungen (6 Funktionen)

| # | db.js Funktion | HTTP Method | Endpoint | Request Body | Response |
|---|---|---|---|---|---|
| 7 | `DB.alleLeistungen()` | GET | `/api/v1/leistungen` | - | `[{id, kundeId, datum, startzeit, endzeit, betreuung, alltagsbegleitung, pflegebegleitung, hauswirtschaft, objektInnen, objektAussen, freitext, notizen, unterschrift, unterschriftDatum, erstellt}]` |
| 8 | `DB.leistungenFuerKunde(kundeId)` | GET | `/api/v1/leistungen?kunde_id={kundeId}` | - | `[{...}]` |
| 9 | `DB.leistungenFuerMonat(monat, jahr)` | GET | `/api/v1/leistungen?monat={monat}&jahr={jahr}` | - | `[{...}]` |
| 10 | `DB.leistungHinzufuegen(leistung)` | POST | `/api/v1/leistungen` | `{kundeId, datum, startzeit, endzeit, betreuung, alltagsbegleitung, pflegebegleitung, hauswirtschaft, objektInnen, objektAussen, freitext, notizen}` | `{id, ...}` |
| 11 | `DB.leistungAktualisieren(id, daten)` | PUT | `/api/v1/leistungen/{id}` | `{...}` (partial update) | `{id, ...}` |
| 12 | `DB.leistungLoeschen(id)` | DELETE | `/api/v1/leistungen/{id}` | - | `{ok: true}` |

### Fahrten (5 Funktionen)

| # | db.js Funktion | HTTP Method | Endpoint | Request Body | Response |
|---|---|---|---|---|---|
| 13 | `DB.alleFahrten()` | GET | `/api/v1/fahrten` | - | `[{id, datum, wochentag, startAdresse, zielAdressen, strecken, gesamtKm, trackingKm, betrag, notiz, gpsTrack, erstellt}]` |
| 14 | `DB.fahrtenFuerWoche(startDatum)` | GET | `/api/v1/fahrten?woche={startDatum}` | - | `[{...}]` |
| 15 | `DB.fahrtHinzufuegen(fahrt)` | POST | `/api/v1/fahrten` | `{datum, wochentag, startAdresse, zielAdressen, gesamtKm, trackingKm, betrag, notiz, gpsTrack}` | `{id, ...}` |
| 16 | `DB.fahrtAktualisieren(id, daten)` | PUT | `/api/v1/fahrten/{id}` | `{...}` (partial update) | `{id, ...}` |
| 17 | `DB.fahrtLoeschen(id)` | DELETE | `/api/v1/fahrten/{id}` | - | `{ok: true}` |

### Termine (6 Funktionen)

| # | db.js Funktion | HTTP Method | Endpoint | Request Body | Response |
|---|---|---|---|---|---|
| 18 | `DB.alleTermine()` | GET | `/api/v1/termine` | - | `[{id, kundeId, titel, datum, startzeit, endzeit, wiederkehrend, wiederholungsMuster, farbe, notizen, erstellt}]` |
| 19 | `DB.termineFuerDatum(datum)` | GET | `/api/v1/termine?datum={datum}` | - | `[{...}]` |
| 20 | `DB.termineFuerWoche(startDatum)` | GET | `/api/v1/termine?woche={startDatum}` | - | `[{...}]` (inkl. wiederkehrende) |
| 21 | `DB.terminHinzufuegen(termin)` | POST | `/api/v1/termine` | `{kundeId, titel, datum, startzeit, endzeit, wiederkehrend, wiederholungsMuster, notizen}` | `{id, ...}` |
| 22 | `DB.terminAktualisieren(id, daten)` | PUT | `/api/v1/termine/{id}` | `{...}` (partial update) | `{id, ...}` |
| 23 | `DB.terminLoeschen(id)` | DELETE | `/api/v1/termine/{id}` | - | `{ok: true}` |

### Abtretungen (4 Funktionen)

| # | db.js Funktion | HTTP Method | Endpoint | Request Body | Response |
|---|---|---|---|---|---|
| 24 | `DB.alleAbtretungen()` | GET | `/api/v1/abtretungen` | - | `[{id, kundeId, datum, ort, pflegekasse, unterschrift, pdfData, erstellt}]` |
| 25 | `DB.abtretungFuerKunde(kundeId)` | GET | `/api/v1/abtretungen?kunde_id={kundeId}` | - | `[{...}]` |
| 26 | `DB.abtretungHinzufuegen(abtretung)` | POST | `/api/v1/abtretungen` | `{kundeId, datum, ort, unterschrift}` | `{id, ...}` |
| 27 | `DB.abtretungLoeschen(id)` | DELETE | `/api/v1/abtretungen/{id}` | - | `{ok: true}` |

### Rechnungen (6 Funktionen)

| # | db.js Funktion | HTTP Method | Endpoint | Request Body | Response |
|---|---|---|---|---|---|
| 28 | `DB.alleRechnungen()` | GET | `/api/v1/rechnungen` | - | `[{id, kundeId, rechnungsnummer, monat, jahr, betrag, status, versandart, versandDatum, bezahltDatum, lexofficeInvoiceId, lexofficeDocumentFileId, notizen, erstellt}]` |
| 29 | `DB.rechnungenFuerKunde(kundeId)` | GET | `/api/v1/rechnungen?kunde_id={kundeId}` | - | `[{...}]` |
| 30 | `DB.rechnungHinzufuegen(rechnung)` | POST | `/api/v1/rechnungen` | `{kundeId, monat, jahr, betrag, status, versandart, notizen}` | `{id, ...}` |
| 31 | `DB.rechnungAktualisieren(id, daten)` | PUT | `/api/v1/rechnungen/{id}` | `{...}` (partial update) | `{id, ...}` |
| 32 | `DB.rechnungById(id)` | GET | `/api/v1/rechnungen/{id}` | - | `{id, ...}` |
| 33 | `DB.rechnungLoeschen(id)` | DELETE | `/api/v1/rechnungen/{id}` | - | `{ok: true}` |

### Settings (3 Funktionen)

| # | db.js Funktion | HTTP Method | Endpoint | Request Body | Response |
|---|---|---|---|---|---|
| 34 | `DB.settingLesen(key)` | GET | `/api/v1/settings/{key}` | - | `{key, value}` |
| 35 | `DB.settingSpeichern(key, value)` | PUT | `/api/v1/settings/{key}` | `{value}` | `{ok: true}` |
| - | `DB.alleSettings()` | GET | `/api/v1/settings` | - | `[{key, value}]` |

### Export/Import (2 Funktionen → Admin-Endpoints)

| # | db.js Funktion | HTTP Method | Endpoint | Request Body | Response |
|---|---|---|---|---|---|
| - | `DB.exportAlles()` | GET | `/api/v1/export` | - | `{kunden, leistungen, fahrten, termine, abtretungen, rechnungen, settings, exportDatum, version}` |
| - | `DB.importAlles(json)` | POST | `/api/v1/import` | `{kunden, leistungen, ...}` | `{ok: true, counts: {kunden: N, ...}}` |

### Statistiken (1 Funktion)

| # | db.js Funktion | HTTP Method | Endpoint | Request Body | Response |
|---|---|---|---|---|---|
| - | `DB.statistiken()` | GET | `/api/v1/statistiken` | - | `{kunden, leistungen, offeneRechnungen, heuteTermine}` |

---

## 2. Backend-Services (Frontend-JS → Python-Services)

### lexoffice.js → `services/lexoffice.py` (14 Funktionen)

Diese Funktionen werden **komplett ins Backend** verlagert. Das Frontend ruft nur noch Backend-Endpoints auf.

| JS-Funktion | Backend-Endpoint | Beschreibung |
|---|---|---|
| `LexofficeAPI.init()` | Intern (App-Start) | API-Key aus DB laden |
| `LexofficeAPI.getContacts(page, size)` | Intern (Sync) | Kontakte laden |
| `LexofficeAPI.getContact(id)` | Intern (Sync) | Einzelnen Kontakt laden |
| `LexofficeAPI.searchContacts(name)` | Intern (Sync) | Kontakt suchen |
| `LexofficeAPI.createContact(data)` | Intern (Sync) | Kontakt anlegen |
| `LexofficeAPI.updateContact(id, data)` | Intern (Sync) | Kontakt aktualisieren |
| `LexofficeAPI.createInvoice(data)` | POST `/api/v1/rechnungen/{id}/lexoffice` | Rechnung in Lexoffice erstellen |
| `LexofficeAPI.getInvoice(id)` | Intern | Rechnung abrufen |
| `LexofficeAPI.finalizeInvoice(id)` | Intern (Teil von Rechnungs-Workflow) | Rechnung finalisieren |
| `LexofficeAPI.getInvoicePdf(fileId)` | GET `/api/v1/rechnungen/{id}/pdf` | Rechnungs-PDF laden |
| `LexofficeAPI.getOffeneRechnungen()` | Intern (Entlastungsmodul) | Offene Rechnungen |
| `LexofficeAPI.getAlleRechnungen()` | Intern (Entlastungsmodul) | Alle Rechnungen |
| `LexofficeAPI.kundeZuKontakt(kunde)` | Intern (Sync) | Datenformat-Konvertierung |
| `LexofficeAPI.kontaktZuKunde(kontakt)` | Intern (Sync) | Datenformat-Konvertierung |
| `LexofficeAPI.rechnungZuLexoffice(...)` | Intern (Rechnungs-Workflow) | Rechnungsformat erstellen |
| `LexofficeAPI.generateLBVAnschreiben(...)` | Intern (PDF-Service) | LBV-Anschreiben generieren |

**Frontend-Aufruf wird zu:**
```
POST /api/v1/lexoffice/sync-kunden     → Kunden-Sync auslösen
POST /api/v1/rechnungen/{id}/lexoffice  → Rechnung in Lexoffice erstellen
```

### sipgate.js → `services/sipgate.py` (4 Funktionen)

| JS-Funktion | Backend-Endpoint | Beschreibung |
|---|---|---|
| `SipgateAPI.init()` | Intern (App-Start) | Token laden |
| `SipgateAPI.faxSenden(nummer, pdf, name)` | POST `/api/v1/rechnungen/{id}/fax` | Fax versenden |
| `SipgateAPI.faxStatus(sessionId)` | GET `/api/v1/rechnungen/{id}/fax-status` | Fax-Status prüfen |
| `SipgateAPI.faxNummerNormalisieren(nr)` | Intern (Hilfsfunktion) | Nummer normalisieren |

### letterxpress.js → `services/letterxpress.py` (5 Funktionen)

| JS-Funktion | Backend-Endpoint | Beschreibung |
|---|---|---|
| `LetterXpressAPI.init()` | Intern (App-Start) | Credentials laden |
| `LetterXpressAPI.briefSenden(pdf, opts)` | POST `/api/v1/rechnungen/{id}/brief` | Brief versenden |
| `LetterXpressAPI.briefStatus(jobId)` | GET `/api/v1/rechnungen/{id}/brief-status` | Brief-Status |
| `LetterXpressAPI.guthaben()` | GET `/api/v1/letterxpress/guthaben` | Guthaben abfragen |
| `LetterXpressAPI.alleJobs(filter)` | Intern (Admin) | Alle Jobs listen |

---

## 3. entlastung.js → Backend-Endpoint

Die Budget-Berechnung nach §45b wird ins Backend verlagert:

| Frontend-Funktion | Backend-Endpoint | Beschreibung |
|---|---|---|
| `EntlastungModule.datenLaden()` | GET `/api/v1/entlastung?jahr={bezugsjahr}` | Komplette Budget-Übersicht |
| `EntlastungModule.auswerten()` | Intern (Backend-Logik) | Berechnung pro Versichertem |
| `EntlastungModule.detailAnzeigen(name)` | GET `/api/v1/entlastung/{kundeId}` | Detail-Ansicht pro Kunde |

**Response-Format `/api/v1/entlastung`:**
```json
{
  "aktuellesJahr": 2026,
  "vorjahr": 2025,
  "versicherte": {
    "Erika Mustermann": {
      "kasse": "AOK Nordwest",
      "vorjahrAbgerechnet": 1310.00,
      "vorjahrRest": 262.00,
      "laufendAbgerechnet": 655.00,
      "ueberziehungGesamt": 0,
      "verfuegbarerUebertrag": 262.00,
      "vorjahr": {"0": 131.00, "1": 131.00, ...},
      "laufend": {"0": 131.00, ...}
    }
  }
}
```

---

## 4. Entfallende Module

| Modul | Grund | Ersatz |
|---|---|---|
| `gcal.js` (GCalSync) | Vollständig ersetzt durch ICS-Feed | GET `/api/v1/ical/{mandant}` |
| `sw.js` Background Sync | Kein Offline-First mehr nötig | Entfällt komplett oder reines Asset-Caching |
| `js/pdf.js` (PDFHelper) | **Teilweise erhalten** — Leistungsnachweis+Abtretung können clientseitig bleiben, Rechnung wird serverseitig | Backend: `services/rechnung_pdf.py` |

---

## 5. Zusätzliche Backend-Endpoints (nicht aus db.js)

| HTTP Method | Endpoint | Beschreibung | Herkunft |
|---|---|---|---|
| POST | `/auth/login` | Login → Session-Cookie | Neu |
| POST | `/auth/logout` | Logout | Neu |
| GET | `/auth/me` | Aktueller User + Firmendaten + Branding | Neu (ersetzt hardcoded FIRMA) |
| GET | `/api/v1/firma` | Firmendaten lesen | Ersetzt FIRMA-Konstante aus db.js |
| PUT | `/api/v1/firma` | Firmendaten ändern | Neu |
| GET | `/api/v1/firma/logo` | Mandanten-Logo (Bild) | Neu |
| GET | `/api/v1/pflegekassen` | Pflegekassen-Verzeichnis | Ersetzt PFLEGEKASSEN aus db.js |
| POST | `/api/v1/rechnungen/{id}/kassenversand` | Anschreiben+Rechnung+Versand | Aus rechnung.js kassenversand() |
| GET | `/api/v1/rechnungen/{id}/pdf` | Rechnungs-PDF (eigene Engine) | Neu |
| GET | `/api/v1/rechnungen/export/datev` | DATEV-CSV-Export | Neu |
| POST | `/api/v1/leistungen/monatsunterschrift` | Unterschrift für ganzen Monat | Aus leistung.js |
| GET | `/api/v1/leistungen/{id}/pdf` | Leistungsnachweis-PDF | Aus pdf.js |
| GET | `/api/v1/abtretungen/{id}/pdf` | Abtretungs-PDF | Aus pdf.js / abtretung.js |
| GET | `/api/v1/fahrten/woche/{startDatum}/pdf` | Kilometeraufzeichnung-PDF | Aus pdf.js |
| GET | `/api/v1/fahrten/monat/{monat}/{jahr}/pdf` | Monats-Kilometerübersicht-PDF | Aus fahrten.js |
| GET | `/api/v1/ical/{mandant}` | ICS-Kalender-Feed | Ersetzt gcal.js |
| GET | `/api/v1/health` | Health-Check | Neu |

---

## 6. FIRMA-Objekt: Was kommt vom Server

Das hardcoded `FIRMA`-Objekt in db.js enthält:

```javascript
const FIRMA = {
  name, inhaber, untertitel, strasse, plz, ort, telefon, email,
  steuernummer, ikNummer, bank, iban, bic, angebotsId,
  stundensatz, monatsBudget, kmSatz, kleinunternehmer, startAdresse
};
```

**Neu vom Server** (via `GET /auth/me` bzw. `GET /api/v1/firma`):
- Alle obigen Felder
- `logo_url` (Pfad zum Mandanten-Logo)
- `farbe_primary` (Hex-Farbe, z.B. `#E91E7B`)
- `farbe_primary_dark` (dunklere Variante)
- `mandant_id` (für Multi-Mandant)

Das `PFLEGEKASSEN`-Array kommt ebenfalls vom Server: `GET /api/v1/pflegekassen`.

---

## 7. Gesamtzählung

| Kategorie | Anzahl |
|---|---|
| DB.js Funktionen (CRUD + Suche + Export + Statistik) | 35 + 3 = 38 |
| REST-Endpoints Daten-CRUD | 33 |
| REST-Endpoints Auth | 3 |
| REST-Endpoints Firma/Settings | 5 |
| REST-Endpoints Services (Fax/Brief/Lexoffice) | 7 |
| REST-Endpoints PDF-Generierung | 4 |
| REST-Endpoints Sonstige (Entlastung, Export, Health, iCal) | 6 |
| **REST-Endpoints gesamt** | **~58** |
| Backend-Service-Funktionen (aus lexoffice+sipgate+letterxpress) | 23 |
| Entfallende Frontend-Module | 2 (gcal.js, sw.js sync) |
| Teilweise entfallende Module | 1 (pdf.js — Rechnungen ins Backend) |
