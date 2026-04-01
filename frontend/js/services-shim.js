/**
 * Kompatibilitaets-Shim fuer entlast.de
 *
 * Stellt LexofficeAPI, SipgateAPI, LetterXpressAPI als globale Objekte bereit,
 * die statt direkter API-Aufrufe die Backend-Endpoints ueber DB.* nutzen.
 *
 * So koennen rechnung.js, kunden.js, entlastung.js etc. zunaechst unveraendert bleiben.
 * Langfristig sollten die Module direkt DB.* aufrufen.
 */

// === LexofficeAPI Shim ===
const LexofficeAPI = {
    _configured: true,

    istKonfiguriert() {
        return this._configured;
    },

    async init() {
        // Nichts zu tun - Backend verwaltet den API-Key
        this._configured = true;
    },

    // Kontakt-Operationen (werden serverseitig abgewickelt)
    async getContacts(page, size) {
        // Sync laeuft komplett serverseitig
        console.warn('LexofficeAPI.getContacts: Bitte DB.syncMitLexoffice() verwenden');
        return { content: [], totalPages: 0, number: 0 };
    },

    async getContact(id) {
        // Einzelner Kontakt - wird serverseitig abgerufen
        console.warn('LexofficeAPI.getContact: Wird serverseitig abgewickelt');
        return null;
    },

    async searchContacts(name) {
        console.warn('LexofficeAPI.searchContacts: Bitte DB.kundenSuchen() verwenden');
        return { content: [] };
    },

    async createContact(data) {
        console.warn('LexofficeAPI.createContact: Wird ueber DB.syncMitLexoffice() abgewickelt');
        return {};
    },

    async updateContact(id, data) {
        console.warn('LexofficeAPI.updateContact: Wird ueber DB.syncMitLexoffice() abgewickelt');
        return {};
    },

    // Rechnungs-Operationen -> Backend-Endpoints
    async createInvoice(data) {
        // Wird jetzt ueber Backend-Endpoint abgewickelt
        console.warn('LexofficeAPI.createInvoice: Bitte DB.rechnungInLexoffice(rechnungId) verwenden');
        return {};
    },

    async getInvoice(id) {
        // Backend holt Invoice-Details
        return apiFetch(`/lexoffice/invoices/${id}`);
    },

    async finalizeInvoice(id) {
        return apiFetch(`/lexoffice/proxy/invoices/${id}/document`);
    },

    async getInvoicePdf(fileId) {
        const res = await fetch(`/api/v1/lexoffice/proxy/files/${fileId}`, {
            credentials: 'include'
        });
        if (!res.ok) throw new Error(`PDF-Download fehlgeschlagen: ${res.status}`);
        return res.blob();
    },

    async getOffeneRechnungen() {
        try {
            const data = await apiFetch('/lexoffice/offene-rechnungen');
            return data || [];
        } catch (e) {
            console.warn('Offene Rechnungen konnten nicht geladen werden:', e);
            return [];
        }
    },

    async getAlleRechnungen() {
        try {
            const data = await apiFetch('/lexoffice/alle-rechnungen');
            return data || [];
        } catch (e) {
            console.warn('Alle Rechnungen konnten nicht geladen werden:', e);
            return [];
        }
    },

    // Hilfsfunktionen die serverseitig laufen
    kundeZuKontakt(kunde) {
        // Wird serverseitig in services/lexoffice.py gemacht
        console.warn('LexofficeAPI.kundeZuKontakt: Wird serverseitig abgewickelt');
        return {};
    },

    kontaktZuKunde(kontakt) {
        console.warn('LexofficeAPI.kontaktZuKunde: Wird serverseitig abgewickelt');
        return {};
    },

    rechnungZuLexoffice(rechnung, kunde, leistungen, variante) {
        console.warn('LexofficeAPI.rechnungZuLexoffice: Wird serverseitig abgewickelt');
        return {};
    },

    varianteErmitteln(kunde) {
        const bes = (kunde.besonderheiten || '').toLowerCase();
        if (bes.includes('lbv')) return 'lbv';
        if (!kunde.pflegekasse || kunde.pflegekasse === 'Sonstige') return 'privat';
        return 'kasse';
    },

    async request(endpoint) {
        // Generischer Lexoffice-Request -> Backend-Proxy
        return apiFetch(`/lexoffice/proxy/${endpoint}`);
    },

    generateLBVAnschreiben() {
        console.warn('LexofficeAPI.generateLBVAnschreiben: Wird serverseitig abgewickelt');
        return null;
    }
};

// === SipgateAPI Shim ===
const SipgateAPI = {
    _configured: true,

    istKonfiguriert() {
        return this._configured;
    },

    async init() {
        this._configured = true;
    },

    faxNummerNormalisieren(nr) {
        if (!nr) return '';
        // Einfache Normalisierung: nur Ziffern und +
        return nr.replace(/[^\d+]/g, '');
    },

    async faxSenden(rechnungId) {
        // Fax-Versand ueber Backend-Endpoint
        return apiFetch(`/rechnungen/${rechnungId}/fax`, { method: 'POST' });
    },

    async faxStatus(sessionId) {
        console.warn('SipgateAPI.faxStatus: Noch nicht implementiert');
        return { type: 'UNKNOWN' };
    }
};

// === LetterXpressAPI Shim ===
const LetterXpressAPI = {
    _configured: true,

    istKonfiguriert() {
        return this._configured;
    },

    async init() {
        this._configured = true;
    },

    async briefSenden(pdfBase64, opts) {
        console.warn('LetterXpressAPI.briefSenden: Bitte DB.briefVersenden(rechnungId) verwenden');
        throw new Error('Brief-Versand laeuft jetzt ueber den Server. Bitte die neue Versand-Funktion nutzen.');
    },

    async briefStatus(jobId) {
        console.warn('LetterXpressAPI.briefStatus: Bitte DB.briefStatus(rechnungId) verwenden');
        return { status: 'unknown' };
    },

    async guthaben() {
        return DB.letterxpressGuthaben();
    }
};

// === GCalSync Shim (entfaellt komplett, nur Dummy) ===
const GCalSync = {
    renderSyncBar() {
        // Statt Google Calendar Sync: Hinweis auf ICS-Feed
        return `
            <div class="ical-link" onclick="GCalSync.zeigeIcalInfo()">
                <span>&#x1F4C5;</span>
                <span>Kalender abonnieren (ICS-Feed)</span>
            </div>
        `;
    },

    renderSettingsCard() {
        return `
            <div class="card mt-2">
                <div class="card-header">
                    <span class="card-title">Kalender-Abo</span>
                </div>
                <p class="text-sm text-muted mb-1">
                    Du kannst deine Termine als ICS-Feed in deiner Kalender-App abonnieren.
                </p>
                <div class="ical-link" onclick="GCalSync.zeigeIcalInfo()">
                    <span>&#x1F4C5;</span>
                    <span>ICS-Feed URL anzeigen</span>
                </div>
            </div>
        `;
    },

    zeigeIcalInfo() {
        const mandant = (window.FIRMA && window.FIRMA.mandant_id) || 'default';
        const url = window.location.origin + '/api/v1/ical/' + mandant;
        const info = `ICS-Feed URL:\n\n${url}\n\nDiese URL in deiner Kalender-App (Apple, Google, Outlook) als Abo hinzufuegen.`;

        if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(() => {
                App.toast('URL in Zwischenablage kopiert', 'success');
            });
        }

        alert(info);
    }
};
