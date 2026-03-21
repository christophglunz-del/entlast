# db.js Mapping: IndexedDB → REST API

> Detailliertes Mapping jeder db.js-Funktion auf den neuen fetch()-Aufruf.
> Für den Frontend-Dev in Runde 2: Ersetze im neuen `db.js` jeden Dexie-Aufruf durch den entsprechenden fetch().

---

## Globale Konventionen

### Base URL
```javascript
const API_BASE = '/api/v1';
```

### Standard-Headers
```javascript
const headers = {
  'Content-Type': 'application/json'
};
// credentials: 'include' bei jedem Request (Session-Cookie)
```

### Error-Handling Pattern
```javascript
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    // Session abgelaufen → Login-Seite
    window.location.href = '/login.html';
    throw new Error('Nicht angemeldet');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}
```

### FIRMA-Objekt: Nicht mehr hardcoded

```javascript
// ALT (db.js):
const FIRMA = { name: "Susi's Alltagshilfe", stundensatz: 32.75, ... };

// NEU: Wird beim Login vom Server geladen und global gesetzt
let FIRMA = null;

async function initFirma() {
  const me = await apiFetch('/auth/me');
  FIRMA = me.firma;
  // Dynamisches Branding
  document.documentElement.style.setProperty('--primary', FIRMA.farbe_primary);
  document.documentElement.style.setProperty('--primary-dark', FIRMA.farbe_primary_dark);
}
```

### PFLEGEKASSEN: Nicht mehr hardcoded

```javascript
// ALT:
const PFLEGEKASSEN = [{ name: 'AOK Nordwest', fax: '' }, ...];

// NEU:
let PFLEGEKASSEN = [];
async function ladePflegekassen() {
  PFLEGEKASSEN = await apiFetch('/api/v1/pflegekassen');
}
```

---

## Kunden (6 Funktionen)

### 1. alleKunden()
```javascript
// ALT:
async alleKunden() { return db.kunden.orderBy('name').toArray(); }

// NEU:
async alleKunden() { return apiFetch(`${API_BASE}/kunden`); }
// Server liefert bereits nach name sortiert
```

### 2. kundeById(id)
```javascript
// ALT:
async kundeById(id) { return db.kunden.get(id); }

// NEU:
async kundeById(id) { return apiFetch(`${API_BASE}/kunden/${id}`); }
```

### 3. kundeHinzufuegen(kunde)
```javascript
// ALT:
async kundeHinzufuegen(kunde) {
  kunde.erstellt = new Date().toISOString();
  kunde.aktualisiert = new Date().toISOString();
  if (!kunde.kundentyp) kunde.kundentyp = 'pflege';
  return db.kunden.add(kunde);
}

// NEU:
async kundeHinzufuegen(kunde) {
  return apiFetch(`${API_BASE}/kunden`, {
    method: 'POST',
    body: JSON.stringify(kunde),
  });
  // Server setzt erstellt/aktualisiert/kundentyp-Default selbst
  // Rückgabe: vollständiges Kundenobjekt mit id
}
```

### 4. kundeAktualisieren(id, daten)
```javascript
// ALT:
async kundeAktualisieren(id, daten) {
  daten.aktualisiert = new Date().toISOString();
  return db.kunden.update(id, daten);
}

// NEU:
async kundeAktualisieren(id, daten) {
  return apiFetch(`${API_BASE}/kunden/${id}`, {
    method: 'PUT',
    body: JSON.stringify(daten),
  });
  // Server setzt aktualisiert-Timestamp selbst
}
```

### 5. kundeLoeschen(id)
```javascript
// ALT:
async kundeLoeschen(id) { return db.kunden.delete(id); }

// NEU:
async kundeLoeschen(id) {
  return apiFetch(`${API_BASE}/kunden/${id}`, { method: 'DELETE' });
}
```

### 6. kundenSuchen(suchbegriff)
```javascript
// ALT:
async kundenSuchen(suchbegriff) {
  const lower = suchbegriff.toLowerCase();
  return db.kunden.filter(k => k.name.toLowerCase().includes(lower) || ...).toArray();
}

// NEU:
async kundenSuchen(suchbegriff) {
  return apiFetch(`${API_BASE}/kunden?q=${encodeURIComponent(suchbegriff)}`);
  // Server führt Suche über name, ort, pflegekasse durch
}
```

---

## Leistungen (6 Funktionen)

### 7. alleLeistungen()
```javascript
// ALT:
async alleLeistungen() { return db.leistungen.orderBy('datum').reverse().toArray(); }

// NEU:
async alleLeistungen() { return apiFetch(`${API_BASE}/leistungen`); }
// Server liefert absteigend nach datum sortiert
```

### 8. leistungenFuerKunde(kundeId)
```javascript
// ALT:
async leistungenFuerKunde(kundeId) {
  return db.leistungen.where('kundeId').equals(kundeId).reverse().sortBy('datum');
}

// NEU:
async leistungenFuerKunde(kundeId) {
  return apiFetch(`${API_BASE}/leistungen?kunde_id=${kundeId}`);
}
```

### 9. leistungenFuerMonat(monat, jahr)
```javascript
// ALT:
async leistungenFuerMonat(monat, jahr) {
  const start = `${jahr}-${String(monat).padStart(2, '0')}-01`;
  // ... date range query
}

// NEU:
async leistungenFuerMonat(monat, jahr) {
  return apiFetch(`${API_BASE}/leistungen?monat=${monat}&jahr=${jahr}`);
}
```

### 10. leistungHinzufuegen(leistung)
```javascript
// ALT:
async leistungHinzufuegen(leistung) {
  leistung.erstellt = new Date().toISOString();
  return db.leistungen.add(leistung);
}

// NEU:
async leistungHinzufuegen(leistung) {
  return apiFetch(`${API_BASE}/leistungen`, {
    method: 'POST',
    body: JSON.stringify(leistung),
  });
}
```

### 11. leistungAktualisieren(id, daten)
```javascript
// ALT:
async leistungAktualisieren(id, daten) { return db.leistungen.update(id, daten); }

// NEU:
async leistungAktualisieren(id, daten) {
  return apiFetch(`${API_BASE}/leistungen/${id}`, {
    method: 'PUT',
    body: JSON.stringify(daten),
  });
}
```

### 12. leistungLoeschen(id)
```javascript
// ALT:
async leistungLoeschen(id) { return db.leistungen.delete(id); }

// NEU:
async leistungLoeschen(id) {
  return apiFetch(`${API_BASE}/leistungen/${id}`, { method: 'DELETE' });
}
```

---

## Fahrten (5 Funktionen)

### 13. alleFahrten()
```javascript
// NEU:
async alleFahrten() { return apiFetch(`${API_BASE}/fahrten`); }
```

### 14. fahrtenFuerWoche(startDatum)
```javascript
// ALT: Date range Berechnung clientseitig
// NEU:
async fahrtenFuerWoche(startDatum) {
  return apiFetch(`${API_BASE}/fahrten?woche=${startDatum}`);
  // Server berechnet startDatum bis +7 Tage
}
```

### 15. fahrtHinzufuegen(fahrt)
```javascript
// NEU:
async fahrtHinzufuegen(fahrt) {
  return apiFetch(`${API_BASE}/fahrten`, {
    method: 'POST',
    body: JSON.stringify(fahrt),
  });
}
// HINWEIS: zielAdressen ist ein Array, gpsTrack ist ein JSON-String
// Beides wird als JSON im Body gesendet, Server speichert als TEXT
```

### 16. fahrtAktualisieren(id, daten)
```javascript
// NEU:
async fahrtAktualisieren(id, daten) {
  return apiFetch(`${API_BASE}/fahrten/${id}`, {
    method: 'PUT',
    body: JSON.stringify(daten),
  });
}
```

### 17. fahrtLoeschen(id)
```javascript
// NEU:
async fahrtLoeschen(id) {
  return apiFetch(`${API_BASE}/fahrten/${id}`, { method: 'DELETE' });
}
```

---

## Termine (6 Funktionen)

### 18. alleTermine()
```javascript
// NEU:
async alleTermine() { return apiFetch(`${API_BASE}/termine`); }
```

### 19. termineFuerDatum(datum)
```javascript
// NEU:
async termineFuerDatum(datum) {
  return apiFetch(`${API_BASE}/termine?datum=${datum}`);
}
```

### 20. termineFuerWoche(startDatum)
```javascript
// ALT: Separate Abfrage für normale + wiederkehrende Termine
// NEU:
async termineFuerWoche(startDatum) {
  return apiFetch(`${API_BASE}/termine?woche=${startDatum}`);
  // Server liefert normale + expandierte wiederkehrende Termine
}
```

### 21. terminHinzufuegen(termin)
```javascript
// NEU:
async terminHinzufuegen(termin) {
  return apiFetch(`${API_BASE}/termine`, {
    method: 'POST',
    body: JSON.stringify(termin),
  });
}
// HINWEIS: wiederholungsMuster ist ein Objekt {"wochentag": 1}
// wird als JSON im Body gesendet
```

### 22. terminAktualisieren(id, daten)
```javascript
// NEU:
async terminAktualisieren(id, daten) {
  return apiFetch(`${API_BASE}/termine/${id}`, {
    method: 'PUT',
    body: JSON.stringify(daten),
  });
}
```

### 23. terminLoeschen(id)
```javascript
// NEU:
async terminLoeschen(id) {
  return apiFetch(`${API_BASE}/termine/${id}`, { method: 'DELETE' });
}
```

---

## Abtretungen (4 Funktionen)

### 24. alleAbtretungen()
```javascript
// NEU:
async alleAbtretungen() { return apiFetch(`${API_BASE}/abtretungen`); }
```

### 25. abtretungFuerKunde(kundeId)
```javascript
// NEU:
async abtretungFuerKunde(kundeId) {
  return apiFetch(`${API_BASE}/abtretungen?kunde_id=${kundeId}`);
}
```

### 26. abtretungHinzufuegen(abtretung)
```javascript
// NEU:
async abtretungHinzufuegen(abtretung) {
  return apiFetch(`${API_BASE}/abtretungen`, {
    method: 'POST',
    body: JSON.stringify(abtretung),
  });
}
// HINWEIS: unterschrift ist ein base64 PNG String (data:image/png;base64,...)
// Das kann mehrere hundert KB groß sein
```

### 27. abtretungLoeschen(id)
```javascript
// NEU:
async abtretungLoeschen(id) {
  return apiFetch(`${API_BASE}/abtretungen/${id}`, { method: 'DELETE' });
}
```

---

## Rechnungen (6 Funktionen)

### 28. alleRechnungen()
```javascript
// NEU:
async alleRechnungen() { return apiFetch(`${API_BASE}/rechnungen`); }
```

### 29. rechnungenFuerKunde(kundeId)
```javascript
// NEU:
async rechnungenFuerKunde(kundeId) {
  return apiFetch(`${API_BASE}/rechnungen?kunde_id=${kundeId}`);
}
```

### 30. rechnungHinzufuegen(rechnung)
```javascript
// NEU:
async rechnungHinzufuegen(rechnung) {
  return apiFetch(`${API_BASE}/rechnungen`, {
    method: 'POST',
    body: JSON.stringify(rechnung),
  });
}
```

### 31. rechnungAktualisieren(id, daten)
```javascript
// NEU:
async rechnungAktualisieren(id, daten) {
  return apiFetch(`${API_BASE}/rechnungen/${id}`, {
    method: 'PUT',
    body: JSON.stringify(daten),
  });
}
```

### 32. rechnungById(id)
```javascript
// NEU:
async rechnungById(id) { return apiFetch(`${API_BASE}/rechnungen/${id}`); }
```

### 33. rechnungLoeschen(id)
```javascript
// NEU:
async rechnungLoeschen(id) {
  return apiFetch(`${API_BASE}/rechnungen/${id}`, { method: 'DELETE' });
}
```

---

## Settings (3 Funktionen)

### 34. settingLesen(key)
```javascript
// ALT:
async settingLesen(key) {
  const entry = await db.settings.get(key);
  return entry ? entry.value : null;
}

// NEU:
async settingLesen(key) {
  try {
    const entry = await apiFetch(`${API_BASE}/settings/${key}`);
    return entry ? entry.value : null;
  } catch (e) {
    return null; // 404 = nicht gesetzt
  }
}
```

### 35. settingSpeichern(key, value)
```javascript
// ALT:
async settingSpeichern(key, value) { return db.settings.put({ key, value }); }

// NEU:
async settingSpeichern(key, value) {
  return apiFetch(`${API_BASE}/settings/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}
```

### alleSettings()
```javascript
// NEU:
async alleSettings() { return apiFetch(`${API_BASE}/settings`); }
```

---

## Export/Import (2 Funktionen)

### exportAlles()
```javascript
// ALT: Sammelt alle Tabellen clientseitig und gibt JSON-String zurück
// NEU:
async exportAlles() {
  const data = await apiFetch(`${API_BASE}/export`);
  return JSON.stringify(data, null, 2);
}
```

### importAlles(jsonString)
```javascript
// ALT: Löscht alle Daten clientseitig und fügt neue ein
// NEU:
async importAlles(jsonString) {
  return apiFetch(`${API_BASE}/import`, {
    method: 'POST',
    body: jsonString, // Server erwartet das komplette JSON
  });
}
```

---

## Statistiken (1 Funktion)

### statistiken()
```javascript
// ALT: Zählt clientseitig Kunden, Leistungen, offene Rechnungen, Termine heute
// NEU:
async statistiken() { return apiFetch(`${API_BASE}/statistiken`); }
// Response: { kunden: number, leistungen: number, offeneRechnungen: number, heuteTermine: number }
```

---

## Entfallende Frontend-Funktionen

### LexofficeAPI (lexoffice.js) → Backend
```javascript
// ALT: Frontend ruft Lexoffice-API direkt auf (mit CORS-Proxy)
// NEU: Frontend ruft Backend-Endpoints auf

// Kunden-Sync auslösen:
async syncMitLexoffice() {
  return apiFetch(`${API_BASE}/lexoffice/sync-kunden`, { method: 'POST' });
}

// Rechnung in Lexoffice erstellen:
async rechnungInLexoffice(rechnungId) {
  return apiFetch(`${API_BASE}/rechnungen/${rechnungId}/lexoffice`, { method: 'POST' });
}

// Rechnungs-PDF laden:
async rechnungPdf(rechnungId) {
  const res = await fetch(`${API_BASE}/rechnungen/${rechnungId}/pdf`, {
    credentials: 'include'
  });
  return res.blob();
}
```

### SipgateAPI (sipgate.js) → Backend
```javascript
// NEU:
async faxVersenden(rechnungId) {
  return apiFetch(`${API_BASE}/rechnungen/${rechnungId}/fax`, { method: 'POST' });
}
```

### LetterXpressAPI (letterxpress.js) → Backend
```javascript
// NEU:
async briefVersenden(rechnungId) {
  return apiFetch(`${API_BASE}/rechnungen/${rechnungId}/brief`, { method: 'POST' });
}
```

### EntlastungModule (entlastung.js) → Backend
```javascript
// ALT: Lädt alle Rechnungen aus Lexoffice und berechnet Budget clientseitig
// NEU:
async entlastungDaten(bezugsjahr) {
  return apiFetch(`${API_BASE}/entlastung?jahr=${bezugsjahr}`);
  // Server berechnet alles serverseitig (inkl. Lexoffice-Daten)
}
```

### GCalSync (gcal.js) → Entfällt komplett
```javascript
// ALT: Google Calendar OAuth2 + bidirektionaler Sync im Browser
// NEU: ICS-Feed zum Abonnieren in Standard-Kalender-Apps
// URL: https://entlast.de/api/v1/ical/{mandant}/
// Kein JS-Code mehr nötig
```

---

## Feld-Namensänderungen (camelCase → snake_case)

Die API liefert Felder in **snake_case**. Das Frontend muss angepasst werden:

| JS/Frontend (alt) | API-Response (neu) |
|---|---|
| `kundeId` | `kunde_id` |
| `faxKasse` | `fax_kasse` |
| `pflegegradSeit` | `pflegegrad_seit` |
| `lexofficeId` | `lexoffice_id` |
| `lexofficeVersion` | `lexoffice_version` |
| `uebertragVorvorjahr` | `uebertrag_vorvorjahr` |
| `objektInnen` | `objekt_innen` |
| `objektAussen` | `objekt_aussen` |
| `unterschriftDatum` | `unterschrift_datum` |
| `startAdresse` | `start_adresse` |
| `zielAdressen` | `ziel_adressen` |
| `gesamtKm` | `gesamt_km` |
| `trackingKm` | `tracking_km` |
| `gpsTrack` | `gps_track` |
| `routeBeschreibung` | `route_beschreibung` |
| `wiederholungsMuster` | `wiederholungs_muster` |
| `pdfData` | `pdf_data` |
| `versandDatum` | `versand_datum` |
| `bezahltDatum` | `bezahlt_datum` |
| `lexofficeInvoiceId` | `lexoffice_invoice_id` |
| `lexofficeDocumentFileId` | `lexoffice_document_file_id` |
| `ikNummer` | `ik_nummer` |
| `kmSatz` | `km_satz` |
| `monatsBudget` | `monats_budget` |

**Tipp:** Im neuen `db.js` kannst du einen Response-Transformer einbauen, der snake_case automatisch in camelCase umwandelt, damit die bestehenden Frontend-Module (kunden.js, leistung.js etc.) zunächst unverändert bleiben:

```javascript
function snakeToCamel(obj) {
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        snakeToCamel(v)
      ])
    );
  }
  return obj;
}

function camelToSnake(obj) {
  if (Array.isArray(obj)) return obj.map(camelToSnake);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()),
        camelToSnake(v)
      ])
    );
  }
  return obj;
}

// Alle API-Responses automatisch umwandeln:
async function apiFetch(url, options = {}) {
  // Request-Body: camelCase → snake_case
  if (options.body && typeof options.body === 'string') {
    try {
      const parsed = JSON.parse(options.body);
      options.body = JSON.stringify(camelToSnake(parsed));
    } catch (e) { /* nicht JSON, belassen */ }
  }

  const res = await fetch(url, { credentials: 'include', ...options });
  // ... error handling ...
  const data = await res.json();

  // Response: snake_case → camelCase
  return snakeToCamel(data);
}
```

---

## Direkte db.*-Zugriffe in anderen Modulen

Einige Module greifen DIREKT auf `db.*` (das Dexie-Objekt) zu statt über das `DB`-Wrapper-Objekt. Diese muessen ebenfalls auf `DB.*` umgestellt werden:

| Modul | Zeile | Direktzugriff | Ersetzen durch |
|---|---|---|---|
| `leistung.js` | `detailAnzeigen()` | `db.leistungen.get(id)` | `DB.leistungenById(id)` (neuer Endpoint GET `/api/v1/leistungen/{id}`) |
| `termine.js` | `terminBearbeiten()` | `db.termine.get(id)` | `DB.terminById(id)` (neuer Endpoint GET `/api/v1/termine/{id}`) |
| `abtretung.js` | `detailAnzeigen()` | `db.abtretungen.get(id)` | `DB.abtretungById(id)` (neuer Endpoint GET `/api/v1/abtretungen/{id}`) |
| `abtretung.js` | `speichern()` | `db.abtretungen.update(id, daten)` | `DB.abtretungAktualisieren(id, daten)` |
| `abtretung.js` | `alsPdfHerunterladen()` | `db.abtretungen.get(id)` | `DB.abtretungById(id)` |
| `settings.js` | `alleDatenLoeschen()` | `db.kunden.clear()` etc. | Nicht mehr nötig (Admin-Funktion serverseitig) |
| `gcal.js` | `sync()` | `db.termine.add(termin)` | `DB.terminHinzufuegen(termin)` |

**Erforderliche neue DB-Funktionen** (Einzelabruf per ID, aktuell nicht in DB-Wrapper):

```javascript
async leistungById(id) { return apiFetch(`${API_BASE}/leistungen/${id}`); }
async terminById(id)    { return apiFetch(`${API_BASE}/termine/${id}`); }
async abtretungById(id) { return apiFetch(`${API_BASE}/abtretungen/${id}`); }
```

---

## Zusammenfassung der neuen db.js

Die neue `db.js` hat exakt dieselbe Signatur wie die alte, ruft aber REST statt IndexedDB auf:

- **38 bestehende Funktionen** (35 DB + 3 Extra) → werden zu fetch()-Aufrufen
- **3 neue Funktionen** (leistungById, terminById, abtretungById) — werden gebraucht wegen Direktzugriffen
- **FIRMA** → wird vom Server geladen statt hardcoded
- **PFLEGEKASSEN** → wird vom Server geladen statt hardcoded
- **Dexie-Import und db.open()** → entfallen komplett
- **Alle Schema-Versionen (v1-v5)** → entfallen (Server verwaltet Schema)
- **Testdaten-Anlage** → entfällt
- **Kundentyp-Migration** → entfällt (Server hat korrektes Schema)
