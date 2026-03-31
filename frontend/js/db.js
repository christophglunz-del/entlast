/**
 * Datenbank-Modul fuer entlast.de (VPS-Version)
 * Ersetzt Dexie/IndexedDB durch REST-API-Aufrufe.
 * Oeffentliche API ist identisch zur alten db.js.
 */

// --- snake_case <-> camelCase Konverter ---

function snakeToCamel(obj) {
    if (Array.isArray(obj)) return obj.map(snakeToCamel);
    if (obj !== null && typeof obj === 'object') {
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
    if (obj !== null && typeof obj === 'object') {
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [
                k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()),
                camelToSnake(v)
            ])
        );
    }
    return obj;
}

// --- API-Fetch-Wrapper ---

const API_BASE = '/api/v1';

async function apiFetch(endpoint, options = {}) {
    // Request-Body: camelCase -> snake_case
    if (options.body && typeof options.body === 'string') {
        try {
            const parsed = JSON.parse(options.body);
            options.body = JSON.stringify(camelToSnake(parsed));
        } catch (e) {
            // Kein JSON, belassen (z.B. Export-String)
        }
    }

    const res = await fetch(API_BASE + endpoint, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    });

    if (res.status === 401) {
        window.location.href = '/login.html';
        throw new Error('Nicht angemeldet');
    }

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
    }

    if (res.status === 204) return null;

    const data = await res.json();
    return snakeToCamel(data);
}

// --- Firmendaten (werden dynamisch geladen) ---

var FIRMA = null;
var PFLEGEKASSEN = [];

// --- DB-Objekt mit identischer oeffentlicher API ---

const DB = {

    // === KUNDEN (6 + 1 Funktionen) ===

    async alleKunden() {
        return apiFetch('/kunden');
    },

    async kundeById(id) {
        return apiFetch(`/kunden/${id}`);
    },

    async kundeHinzufuegen(kunde) {
        return apiFetch('/kunden', {
            method: 'POST',
            body: JSON.stringify(kunde)
        });
    },

    async kundeAktualisieren(id, daten) {
        return apiFetch(`/kunden/${id}`, {
            method: 'PUT',
            body: JSON.stringify(daten)
        });
    },

    async kundeLoeschen(id) {
        return apiFetch(`/kunden/${id}`, { method: 'DELETE' });
    },

    async kundenSuchen(suchbegriff) {
        return apiFetch(`/kunden?q=${encodeURIComponent(suchbegriff)}`);
    },

    // === LEISTUNGEN (6 + 1 Funktionen) ===

    async alleLeistungen() {
        return apiFetch('/leistungen');
    },

    async leistungById(id) {
        return apiFetch(`/leistungen/${id}`);
    },

    async leistungenFuerKunde(kundeId) {
        return apiFetch(`/leistungen?kunde_id=${kundeId}`);
    },

    async leistungenFuerMonat(monat, jahr) {
        return apiFetch(`/leistungen?monat=${monat}&jahr=${jahr}`);
    },

    async leistungHinzufuegen(leistung) {
        return apiFetch('/leistungen', {
            method: 'POST',
            body: JSON.stringify(leistung)
        });
    },

    async leistungAktualisieren(id, daten) {
        return apiFetch(`/leistungen/${id}`, {
            method: 'PUT',
            body: JSON.stringify(daten)
        });
    },

    async leistungLoeschen(id) {
        return apiFetch(`/leistungen/${id}`, { method: 'DELETE' });
    },

    // === FAHRTEN (5 Funktionen) ===

    async alleFahrten() {
        return apiFetch('/fahrten');
    },

    async fahrtById(id) {
        return apiFetch(`/fahrten/${id}`);
    },

    async fahrtenFuerWoche(startDatum) {
        return apiFetch(`/fahrten?woche=${startDatum}`);
    },

    async fahrtHinzufuegen(fahrt) {
        return apiFetch('/fahrten', {
            method: 'POST',
            body: JSON.stringify(fahrt)
        });
    },

    async fahrtAktualisieren(id, daten) {
        return apiFetch(`/fahrten/${id}`, {
            method: 'PUT',
            body: JSON.stringify(daten)
        });
    },

    async fahrtLoeschen(id) {
        return apiFetch(`/fahrten/${id}`, { method: 'DELETE' });
    },

    // === TERMINE (6 + 1 Funktionen) ===

    async alleTermine() {
        return apiFetch('/termine');
    },

    async terminById(id) {
        return apiFetch(`/termine/${id}`);
    },

    async termineFuerDatum(datum) {
        return apiFetch(`/termine?datum=${datum}`);
    },

    async termineFuerWoche(startDatum) {
        return apiFetch(`/termine?woche=${startDatum}`);
    },

    async terminHinzufuegen(termin) {
        return apiFetch('/termine', {
            method: 'POST',
            body: JSON.stringify(termin)
        });
    },

    async terminAktualisieren(id, daten) {
        return apiFetch(`/termine/${id}`, {
            method: 'PUT',
            body: JSON.stringify(daten)
        });
    },

    async terminLoeschen(id) {
        return apiFetch(`/termine/${id}`, { method: 'DELETE' });
    },

    // === ABTRETUNGEN (4 + 1 Funktionen) ===

    async alleAbtretungen() {
        return apiFetch('/abtretungen');
    },

    async abtretungById(id) {
        return apiFetch(`/abtretungen/${id}`);
    },

    async abtretungFuerKunde(kundeId) {
        return apiFetch(`/abtretungen?kunde_id=${kundeId}`);
    },

    async abtretungHinzufuegen(abtretung) {
        return apiFetch('/abtretungen', {
            method: 'POST',
            body: JSON.stringify(abtretung)
        });
    },

    async abtretungAktualisieren(id, daten) {
        return apiFetch(`/abtretungen/${id}`, {
            method: 'PUT',
            body: JSON.stringify(daten)
        });
    },

    async abtretungLoeschen(id) {
        return apiFetch(`/abtretungen/${id}`, { method: 'DELETE' });
    },

    // === RECHNUNGEN (6 Funktionen) ===

    async alleRechnungen() {
        return apiFetch('/rechnungen');
    },

    async rechnungById(id) {
        return apiFetch(`/rechnungen/${id}`);
    },

    async rechnungenFuerKunde(kundeId) {
        return apiFetch(`/rechnungen?kunde_id=${kundeId}`);
    },

    async rechnungHinzufuegen(rechnung) {
        return apiFetch('/rechnungen', {
            method: 'POST',
            body: JSON.stringify(rechnung)
        });
    },

    async rechnungAktualisieren(id, daten) {
        return apiFetch(`/rechnungen/${id}`, {
            method: 'PUT',
            body: JSON.stringify(daten)
        });
    },

    async rechnungLoeschen(id) {
        return apiFetch(`/rechnungen/${id}`, { method: 'DELETE' });
    },

    // === SETTINGS (3 Funktionen) ===

    async settingLesen(key) {
        try {
            const entry = await apiFetch(`/settings/${key}`);
            return entry ? entry.value : null;
        } catch (e) {
            // 404 = nicht gesetzt
            return null;
        }
    },

    async settingKonfiguriert(key) {
        try {
            const entry = await apiFetch(`/settings/${key}`);
            return entry ? !!entry.configured : false;
        } catch (e) {
            return false;
        }
    },

    async settingSpeichern(key, value) {
        return apiFetch(`/settings/${key}`, {
            method: 'PUT',
            body: JSON.stringify({ value })
        });
    },

    async alleSettings() {
        return apiFetch('/settings');
    },

    // === EXPORT/IMPORT (2 Funktionen) ===

    async exportAlles() {
        const data = await apiFetch('/export');
        return JSON.stringify(data, null, 2);
    },

    async importAlles(jsonString) {
        return apiFetch('/import', {
            method: 'POST',
            body: jsonString
        });
    },

    // === STATISTIKEN (1 Funktion) ===

    async statistiken() {
        return apiFetch('/statistiken');
    },

    // === BACKEND-SERVICES (ehemals eigene JS-Module) ===

    // Lexoffice
    async syncMitLexoffice() {
        return apiFetch('/lexoffice/sync-kunden', { method: 'POST' });
    },

    async rechnungInLexoffice(rechnungId) {
        return apiFetch(`/rechnungen/${rechnungId}/lexoffice`, { method: 'POST' });
    },

    async rechnungPdf(rechnungId) {
        const res = await fetch(`${API_BASE}/rechnungen/${rechnungId}/pdf`, {
            credentials: 'include'
        });
        if (res.status === 401) {
            window.location.href = '/login.html';
            throw new Error('Nicht angemeldet');
        }
        if (!res.ok) throw new Error(`PDF-Download fehlgeschlagen: ${res.status}`);
        return res.blob();
    },

    // Sipgate (Fax)
    async faxVersenden(rechnungId) {
        return apiFetch(`/rechnungen/${rechnungId}/fax`, { method: 'POST' });
    },

    async faxStatus(rechnungId) {
        return apiFetch(`/rechnungen/${rechnungId}/fax-status`);
    },

    // LetterXpress (Brief)
    async briefVersenden(rechnungId) {
        return apiFetch(`/rechnungen/${rechnungId}/brief`, { method: 'POST' });
    },

    async briefStatus(rechnungId) {
        return apiFetch(`/rechnungen/${rechnungId}/brief-status`);
    },

    async letterxpressGuthaben() {
        return apiFetch('/letterxpress/guthaben');
    },

    // Kassenversand (Anschreiben + Rechnung + Versand)
    async kassenversand(rechnungId) {
        return apiFetch(`/rechnungen/${rechnungId}/kassenversand`, { method: 'POST' });
    },

    // Entlastungsbetrag (Budget-Berechnung serverseitig)
    async entlastungDaten(bezugsjahr) {
        return apiFetch(`/entlastung?jahr=${bezugsjahr}`);
    },

    async entlastungDetail(kundeId) {
        return apiFetch(`/entlastung/${kundeId}`);
    },

    // Monatsunterschrift fuer Leistungsnachweise
    async monatsunterschrift(daten) {
        return apiFetch('/leistungen/monatsunterschrift', {
            method: 'POST',
            body: JSON.stringify(daten)
        });
    },

    // PDF-Generierung (serverseitig)
    async leistungsnachweisePdf(id) {
        const res = await fetch(`${API_BASE}/leistungen/${id}/pdf`, {
            credentials: 'include'
        });
        if (res.status === 401) {
            window.location.href = '/login.html';
            throw new Error('Nicht angemeldet');
        }
        if (!res.ok) throw new Error(`PDF-Download fehlgeschlagen: ${res.status}`);
        return res.blob();
    },

    async abtretungPdf(id) {
        const res = await fetch(`${API_BASE}/abtretungen/${id}/pdf`, {
            credentials: 'include'
        });
        if (res.status === 401) {
            window.location.href = '/login.html';
            throw new Error('Nicht angemeldet');
        }
        if (!res.ok) throw new Error(`PDF-Download fehlgeschlagen: ${res.status}`);
        return res.blob();
    },

    async fahrtenWochePdf(startDatum) {
        const res = await fetch(`${API_BASE}/fahrten/woche/${startDatum}/pdf`, {
            credentials: 'include'
        });
        if (res.status === 401) {
            window.location.href = '/login.html';
            throw new Error('Nicht angemeldet');
        }
        if (!res.ok) throw new Error(`PDF-Download fehlgeschlagen: ${res.status}`);
        return res.blob();
    },

    async fahrtenMonatPdf(monat, jahr) {
        const res = await fetch(`${API_BASE}/fahrten/monat/${monat}/${jahr}/pdf`, {
            credentials: 'include'
        });
        if (res.status === 401) {
            window.location.href = '/login.html';
            throw new Error('Nicht angemeldet');
        }
        if (!res.ok) throw new Error(`PDF-Download fehlgeschlagen: ${res.status}`);
        return res.blob();
    },

    // DATEV-Export
    async datevExport() {
        const res = await fetch(`${API_BASE}/rechnungen/export/datev`, {
            credentials: 'include'
        });
        if (res.status === 401) {
            window.location.href = '/login.html';
            throw new Error('Nicht angemeldet');
        }
        if (!res.ok) throw new Error(`DATEV-Export fehlgeschlagen: ${res.status}`);
        return res.blob();
    }
};
