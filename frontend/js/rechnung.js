/**
 * Rechnungs-Modul für Susi's Alltagshilfe
 */

const RechnungModule = {
  // Cache für Lexoffice-Rechnungsdetails
  _rechnungsDetails: {},

  async init() {
    await this.listeAnzeigen();
    // URL-Parameter: ?kunde=ID&monat=M&jahr=J → Felder vorauswählen
    const params = new URLSearchParams(window.location.search);
    if (params.get('detail')) {
      window.history.replaceState({}, '', window.location.pathname);
      this.detailAnzeigen(params.get('detail'));
    } else if (params.get('kunde')) {
      window.history.replaceState({}, '', window.location.pathname);
      const kundeId = params.get('kunde');
      const sel = document.getElementById('rechnungKunde');
      if (sel) sel.value = kundeId;
      // Suchfeld mit Kundennamen befüllen
      const k = (this._rechnungKunden || []).find(c => c.id == kundeId);
      const search = document.getElementById('rechnungKundeSearch');
      if (search && k) search.value = App.kundenName(k);
      this.kundeGewaehlt();
      if (params.get('monat')) {
        const mSel = document.getElementById('rechnungMonat');
        if (mSel) mSel.value = params.get('monat');
      }
      if (params.get('jahr')) {
        const jInput = document.getElementById('rechnungJahr');
        if (jInput) jInput.value = params.get('jahr');
      }
    }
  },

  async listeAnzeigen() {
    const container = document.getElementById('rechnungContent');
    if (!container) return;

    const kunden = await DB.alleKunden();
    this._rechnungKunden = App.echteKunden(kunden);

    container.innerHTML = `
      <!-- Rechnungsarchiv aus Lexoffice -->
      <div class="section-title">
        <span class="icon">📊</span> Rechnungsarchiv
        <span id="syncZeit" class="text-xs text-muted" style="margin-left:8px;"></span>
        <button class="btn btn-sm btn-outline" onclick="RechnungModule.lexofficeSync()" style="float:right;">
          🔄 Aktualisieren
        </button>
      </div>
      <div style="margin-bottom:8px;">
        <input type="text" id="rechnungSuche" class="form-control" placeholder="Suche (Name, Nummer...)"
               oninput="RechnungModule.filterAnwenden()" style="margin-bottom:8px;">
        <div class="btn-group" style="gap:4px;">
          <button class="btn btn-sm filter-btn active btn-primary" data-filter="alle" onclick="RechnungModule.statusFilter('alle')">Alle</button>
          <button class="btn btn-sm filter-btn btn-outline" data-filter="offen" onclick="RechnungModule.statusFilter('offen')">Offen</button>
          <button class="btn btn-sm filter-btn btn-outline" data-filter="bezahlt" onclick="RechnungModule.statusFilter('bezahlt')">Bezahlt</button>
        </div>
      </div>
      <div id="lexofficeRechnungen">
        <div class="card text-center"><div class="spinner"></div></div>
      </div>

      <!-- Detail-Ansicht (wird dynamisch befüllt) -->
      <div id="rechnungDetailOverlay" class="hidden" style="position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:500;overflow-y:auto;padding:16px;">
        <div id="rechnungDetailContent" style="max-width:600px;margin:0 auto;"></div>
      </div>
    `;

    // Gespeicherten Sync-Zeitstempel anzeigen
    const gespeicherteZeit = await DB.settingLesen('sync_zeit_rechnungen');
    if (gespeicherteZeit) {
      const zeitEl = document.getElementById('syncZeit');
      if (zeitEl) zeitEl.textContent = App.formatSyncZeit(gespeicherteZeit);
    }

    // Automatisch Lexoffice-Rechnungen laden
    this.lexofficeSync();
  },

  rechnungenRendern(rechnungen, kundenMap) {
    return rechnungen.map(r => {
      const kunde = kundenMap[r.kundeId];
      const statusInfo = this.statusInfo(r.status);

      return `
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">${kunde ? KundenModule.escapeHtml(App.kundenName(kunde)) : 'Unbekannt'}</div>
              <div class="text-sm text-muted">
                ${App.monatsName(r.monat)} ${r.jahr}
                ${r.rechnungsnummer ? ' | Nr. ' + r.rechnungsnummer : ''}
              </div>
            </div>
            <span class="badge ${statusInfo.badgeClass}">${statusInfo.label}</span>
          </div>

          <div class="d-flex justify-between align-center">
            <div class="text-sm">
              ${r.versandart ? '📤 ' + this.versandartLabel(r.versandart) : ''}
              ${r.versandDatum ? ' | ' + App.formatDatum(r.versandDatum) : ''}
            </div>
            <div class="fw-bold text-primary">${r.betrag ? App.formatBetrag(r.betrag) : '-'}</div>
          </div>

          <!-- Status-Timeline -->
          <div class="status-timeline">
            <div class="status-step ${r.status ? 'complete' : 'active'}"></div>
            <div class="status-step ${r.status === 'versendet' || r.status === 'eingegangen' || r.status === 'bezahlt' ? 'complete' : ''}"></div>
            <div class="status-step ${r.status === 'eingegangen' || r.status === 'bezahlt' ? 'complete' : ''}"></div>
            <div class="status-step ${r.status === 'bezahlt' ? 'complete' : ''}"></div>
          </div>
          <div class="d-flex justify-between text-xs text-muted mt-1">
            <span>Erstellt</span>
            <span>Versendet</span>
            <span>Eingegangen</span>
            <span>Bezahlt</span>
          </div>

          <div class="btn-group mt-2">
            ${r.status !== 'bezahlt' ? `
              <button class="btn btn-sm btn-outline" onclick="RechnungModule.statusAendern(${r.id}, '${this.naechsterStatus(r.status)}')">
                ${this.naechsterStatusLabel(r.status)}
              </button>
            ` : ''}
            ${!r.lexofficeInvoiceId && typeof LexofficeAPI !== 'undefined' ? `
              <button class="btn btn-sm btn-outline" onclick="RechnungModule.inLexofficeErstellen(${r.id})"
                      style="color: var(--primary); border-color: var(--primary);">
                📤 In Lexoffice erstellen
              </button>
            ` : ''}
            ${r.lexofficeInvoiceId ? `
              <button class="btn btn-sm btn-outline" onclick="RechnungModule.vorschauZeigen(${r.id})"
                      style="color: var(--success); border-color: var(--success);">
                👁 Vorschau
              </button>
            ` : ''}
            ${r.versandart === 'fax' && r.status === 'offen' && r.lexofficeInvoiceId ? `
              <button class="btn btn-sm btn-outline" onclick="RechnungModule.faxVersenden(${r.id})"
                      style="color: var(--primary); border-color: var(--primary);">
                📠 Fax senden
              </button>
            ` : ''}
            ${r.versandart === 'brief' && r.status === 'offen' && r.lexofficeInvoiceId ? `
              <button class="btn btn-sm btn-outline" onclick="RechnungModule.briefVersenden(${r.id})"
                      style="color: var(--primary); border-color: var(--primary);">
                ✉️ Brief senden
              </button>
            ` : ''}
            ${r.status === 'offen' && r.lexofficeInvoiceId && (r.versandart === 'fax' || r.versandart === 'brief') ? `
              <button class="btn btn-sm btn-primary" onclick="RechnungModule.kassenversand(${r.id})">
                📤 Kassenversand
              </button>
            ` : ''}
            ${r.status === 'offen' && r.lexofficeInvoiceId && kunde && kunde.email && !kunde.pflegekasse && !kunde.versichertennummer ? `
              <button class="btn btn-sm btn-outline" onclick="RechnungModule.emailVersenden(${r.id})"
                      style="color: var(--primary); border-color: var(--primary);">
                📧 Per E-Mail
              </button>
            ` : ''}
            <button class="btn btn-sm btn-secondary" onclick="RechnungModule.loeschen(${r.id})">
              Löschen
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  kundenFiltern(suchtext) {
    const results = document.getElementById('rechnungKundeResults');
    if (!results) return;
    const kunden = this._rechnungKunden || [];
    const begriff = (suchtext || '').toLowerCase().trim();

    const gefiltert = begriff
      ? kunden.filter(k => App.kundenName(k).toLowerCase().includes(begriff))
      : kunden;

    if (gefiltert.length === 0) {
      results.innerHTML = '<div style="padding:8px;color:var(--gray-500);font-size:0.9rem;">Keine Kunden gefunden</div>';
    } else {
      results.innerHTML = gefiltert.map(k =>
        `<div style="padding:8px 12px;cursor:pointer;font-size:0.9rem;border-bottom:1px solid var(--gray-100);"
              onmousedown="RechnungModule.kundeAuswaehlen(${k.id})"
              onmouseover="this.style.background='var(--primary-bg)'"
              onmouseout="this.style.background=''">${KundenModule.escapeHtml(App.kundenName(k))}${k.kundentyp === 'dienstleistung' ? ' (DL)' : ''}</div>`
      ).join('');
    }
    results.style.display = 'block';

    if (!this._rechnungClickHandler) {
      this._rechnungClickHandler = (e) => {
        if (!e.target.closest('#rechnungKundeSearch') && !e.target.closest('#rechnungKundeResults')) {
          results.style.display = 'none';
        }
      };
      document.addEventListener('click', this._rechnungClickHandler);
    }
  },

  kundeAuswaehlen(kundeId) {
    const kunden = this._rechnungKunden || [];
    const kunde = kunden.find(k => k.id === kundeId);
    if (!kunde) return;

    const searchInput = document.getElementById('rechnungKundeSearch');
    const select = document.getElementById('rechnungKunde');
    if (searchInput) searchInput.value = App.kundenName(kunde);
    if (select) select.value = kundeId;

    const results = document.getElementById('rechnungKundeResults');
    if (results) results.style.display = 'none';

    this.kundeGewaehlt();
  },

  async kundeGewaehlt() {
    const kundeId = parseInt(document.getElementById('rechnungKunde').value);
    const infoDiv = document.getElementById('rechnungKundeInfo');
    const empfWahl = document.getElementById('rechnungEmpfaengerWahl');

    if (!kundeId) {
      infoDiv.classList.add('hidden');
      empfWahl.classList.add('hidden');
      return;
    }

    const kunde = await DB.kundeById(kundeId);
    if (!kunde) return;

    infoDiv.classList.remove('hidden');

    // Empfänger-Auswahl: nur anzeigen wenn Pflegekasse vorhanden UND Pflegekunde
    const istPflegekunde = !kunde.kundentyp || kunde.kundentyp === 'pflege';
    if (kunde.pflegekasse && istPflegekunde) {
      empfWahl.classList.remove('hidden');
      document.getElementById('optKasse').textContent = `An ${kunde.pflegekasse}`;
    } else {
      empfWahl.classList.add('hidden');
      document.getElementById('rechnungEmpfaenger').value = 'direkt';
    }

    const besDiv = document.getElementById('rechnungBesonderheiten');
    if (kunde.besonderheiten) {
      besDiv.classList.remove('hidden');
      besDiv.innerHTML = `<strong>⚠️ Besonderheit:</strong> ${KundenModule.escapeHtml(kunde.besonderheiten)}`;
    } else {
      besDiv.classList.add('hidden');
    }
  },

  async rechnungErstellen() {
    const kundeId = parseInt(document.getElementById('rechnungKunde').value);
    if (!kundeId) {
      App.toast('Bitte einen Kunden wählen', 'error');
      return;
    }

    const monat = parseInt(document.getElementById('rechnungMonat').value);
    const jahr = parseInt(document.getElementById('rechnungJahr').value);
    const empfaenger = document.getElementById('rechnungEmpfaenger').value; // 'kasse' oder 'direkt'

    // Lexoffice initialisieren
    if (typeof LexofficeAPI === 'undefined' || !LexofficeAPI.istKonfiguriert()) {
      if (typeof LexofficeAPI !== 'undefined') await LexofficeAPI.init();
      if (!LexofficeAPI || !LexofficeAPI.istKonfiguriert()) {
        App.toast('Lexoffice API-Key fehlt', 'error');
        return;
      }
    }

    const kunde = await DB.kundeById(kundeId);
    if (!kunde) { App.toast('Kunde nicht gefunden', 'error'); return; }

    // Leistungen für diesen Monat laden
    const leistungen = await DB.leistungenFuerMonat(monat, jahr);
    const kundeLeistungen = leistungen.filter(l => l.kundeId === kundeId);

    if (kundeLeistungen.length === 0) {
      App.toast(`Keine Leistungen für ${App.monatsName(monat)} ${jahr}`, 'error');
      return;
    }

    let betrag = 0;
    kundeLeistungen.forEach(l => {
      const stunden = App.stundenBerechnen(l.startzeit, l.endzeit);
      betrag += App.betragBerechnen(stunden);
    });

    // Variante bestimmen: kasse, privat oder lbv
    let variante = 'privat';
    if (empfaenger === 'kasse' && kunde.pflegekasse) {
      variante = LexofficeAPI.varianteErmitteln(kunde);
    }

    // Duplikat-Prüfung: Existiert bereits eine Rechnung in Lexoffice?
    const bereitsVorhanden = (this._alleRechnungen || []).find(r => {
      if (!r.voucherDate || r.voucherStatus === 'voided') return false;
      const rDatum = new Date(r.voucherDate);
      const kundenName = App.kundenName ? App.kundenName(kunde) : kunde.name;
      return (r.contactName || '').includes(kundenName)
          && rDatum.getMonth() + 1 === monat && rDatum.getFullYear() === jahr;
    });
    if (bereitsVorhanden) {
      if (!await App.confirm(`Achtung: Für ${App.kundenName(kunde)} existiert bereits ${bereitsVorhanden.voucherNumber} (${App.monatsName(monat)} ${jahr}). Trotzdem erstellen?`)) return;
    }

    // Gesamtstunden berechnen
    let gesamtStunden = 0;
    kundeLeistungen.forEach(l => {
      gesamtStunden += App.stundenBerechnen(l.startzeit, l.endzeit);
    });

    // Empfänger-Info für Vorschau
    const empfName = variante === 'privat' ? App.kundenName(kunde) : (kunde.pflegekasse || 'Pflegekasse');

    // Vorschau im Detail-Overlay anzeigen
    const overlay = document.getElementById('rechnungDetailOverlay');
    const content = document.getElementById('rechnungDetailContent');
    overlay.classList.remove('hidden');

    content.innerHTML = `
      <div class="card" style="background:white;">
        <h3 style="margin:0 0 12px;font-size:1.1rem;">Rechnung prüfen</h3>

        <table style="width:100%;font-size:0.9rem;border-collapse:collapse;">
          <tr><td style="padding:4px 8px;color:var(--gray-600);">Empfänger</td><td style="padding:4px 8px;font-weight:600;">${empfName}</td></tr>
          ${variante !== 'privat' ? `<tr><td style="padding:4px 8px;color:var(--gray-600);">Versicherte/r</td><td style="padding:4px 8px;">${App.kundenName(kunde)}</td></tr>` : ''}
          <tr><td style="padding:4px 8px;color:var(--gray-600);">Variante</td><td style="padding:4px 8px;">${variante === 'kasse' ? 'Pflegekasse (§45b)' : variante === 'lbv' ? 'LBV-Splitting' : 'Privatrechnung'}</td></tr>
          <tr><td style="padding:4px 8px;color:var(--gray-600);">Zeitraum</td><td style="padding:4px 8px;">${App.monatsName(monat)} ${jahr}</td></tr>
          <tr><td style="padding:4px 8px;color:var(--gray-600);">Leistungen</td><td style="padding:4px 8px;">${kundeLeistungen.length} Einträge, ${gesamtStunden.toFixed(1)} Stunden</td></tr>
          <tr><td style="padding:4px 8px;color:var(--gray-600);">Stundensatz</td><td style="padding:4px 8px;">${((FIRMA || {}).stundensatz || 32.75).toFixed(2).replace('.', ',')} €</td></tr>
        </table>

        <div style="display:flex;justify-content:space-between;padding:12px 0;font-size:1.2rem;font-weight:700;border-top:2px solid var(--gray-200);margin-top:8px;">
          <span>Betrag</span>
          <span>${betrag.toFixed(2).replace('.', ',')} €</span>
        </div>

        <div class="btn-group mt-2" style="gap:8px;">
          <button class="btn btn-primary btn-block" onclick="RechnungModule._rechnungAbsenden()">
            In Lexoffice erstellen
          </button>
          <button class="btn btn-outline" onclick="RechnungModule.detailSchliessen()">
            Abbrechen
          </button>
        </div>
      </div>
    `;

    // Daten für Absenden zwischenspeichern
    this._pendingRechnung = { kundeId, monat, jahr, betrag, kunde, kundeLeistungen, variante };
  },

  async _rechnungAbsenden() {
    const { kundeId, monat, jahr, betrag, kunde, kundeLeistungen, variante } = this._pendingRechnung;
    this._pendingRechnung = null;

    const empfaenger = document.getElementById('rechnungEmpfaenger')?.value || 'kasse';
    const content = document.getElementById('rechnungDetailContent');
    content.innerHTML = '<div class="card" style="background:white;text-align:center;"><div class="spinner"></div> Rechnung wird in Lexoffice erstellt...</div>';

    try {
      const ergebnis = await apiFetch('/lexoffice/rechnung-erstellen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kunde_id: kundeId, monat, jahr, empfaenger }),
      });

      this.detailSchliessen();
      App.toast(`Rechnung erstellt: ${ergebnis.betrag.toFixed(2).replace('.', ',')} €`, 'success', 5000);
      this.lexofficeSync();
    } catch (err) {
      console.error('Lexoffice Fehler:', err);
      content.innerHTML = `
        <div class="card" style="background:white;">
          <p style="color:var(--danger);">Fehler: ${err.message}</p>
          <button class="btn btn-outline" onclick="RechnungModule.detailSchliessen()">Schließen</button>
        </div>
      `;
    }
  },

  async anschreibenErstellen() {
    const kundeId = parseInt(document.getElementById('rechnungKunde').value);
    if (!kundeId) {
      App.toast('Bitte einen Kunden wählen', 'error');
      return;
    }

    const monat = parseInt(document.getElementById('rechnungMonat').value);
    const jahr = parseInt(document.getElementById('rechnungJahr').value);

    try {
      const kunde = await DB.kundeById(kundeId);
      const leistungen = await DB.leistungenFuerMonat(monat, jahr);
      const kundeLeistungen = leistungen.filter(l => l.kundeId === kundeId);

      const rechnung = { monat, jahr };
      const doc = await PDFHelper.generateAnschreiben(rechnung, kunde, kundeLeistungen);
      const dateiname = `Anschreiben_${kunde.name.replace(/\s+/g, '_')}_${App.monatsName(monat)}_${jahr}.pdf`;
      PDFHelper.download(doc, dateiname);
      App.toast('Anschreiben-PDF erstellt', 'success');
    } catch (err) {
      console.error('PDF-Fehler:', err);
      App.toast('Fehler bei PDF-Erstellung', 'error');
    }
  },

  async statusAendern(id, neuerStatus) {
    try {
      const daten = { status: neuerStatus };
      if (neuerStatus === 'versendet') daten.versandDatum = new Date().toISOString();
      if (neuerStatus === 'bezahlt') daten.bezahltDatum = new Date().toISOString();

      await DB.rechnungAktualisieren(id, daten);
      App.toast(`Status: ${this.statusInfo(neuerStatus).label}`, 'success');
      this.listeAnzeigen();
    } catch (err) {
      App.toast('Fehler beim Aktualisieren', 'error');
    }
  },

  async loeschen(id) {
    if (!await App.confirm('Rechnung wirklich löschen?')) return;
    try {
      await DB.rechnungLoeschen(id);
      App.toast('Gelöscht', 'success');
      this.listeAnzeigen();
    } catch (err) {
      App.toast('Fehler', 'error');
    }
  },

  async stornoAusfuehren(lexofficeId, voucherNr) {
    const ok = await App.confirm(
      `Rechnung ${voucherNr || ''} wirklich stornieren?\n\nEs wird in Lexoffice eine Gutschrift mit Verweis auf diese Rechnung erzeugt. Beide Belege bleiben in Lex sichtbar und werden gegengebucht.`
    );
    if (!ok) return;
    try {
      App.toast('Storno wird erzeugt …', 'info');
      const res = await LexofficeAPI.cancelInvoice(lexofficeId);
      const nr = res && (res.gutschriftNummer || res.gutschrift_nummer);
      App.toast('Rechnung storniert' + (nr ? ` (Gutschrift ${nr})` : ''), 'success');
      this.detailSchliessen();
      this.listeAnzeigen();
    } catch (err) {
      console.error('Storno-Fehler:', err);
      const msg = err && err.message ? err.message : 'unbekannt';
      App.toast('Storno fehlgeschlagen: ' + msg, 'error');
    }
  },

  statusInfo(status) {
    const map = {
      'offen': { label: 'Offen', badgeClass: 'badge-warning' },
      'versendet': { label: 'Versendet', badgeClass: 'badge-info' },
      'eingegangen': { label: 'Eingegangen', badgeClass: 'badge-primary' },
      'bezahlt': { label: 'Bezahlt', badgeClass: 'badge-success' }
    };
    return map[status] || map['offen'];
  },

  naechsterStatus(status) {
    const flow = { 'offen': 'versendet', 'versendet': 'eingegangen', 'eingegangen': 'bezahlt' };
    return flow[status] || 'versendet';
  },

  naechsterStatusLabel(status) {
    const labels = {
      'offen': '📤 Als versendet markieren',
      'versendet': '📥 Als eingegangen markieren',
      'eingegangen': '✅ Als bezahlt markieren'
    };
    return labels[status] || '📤 Versenden';
  },

  versandartLabel(art) {
    const labels = { 'fax': 'Fax (Sipgate)', 'brief': 'Brief (LetterXpress)', 'webmail': 'Webmail', 'email': 'E-Mail' };
    return labels[art] || art;
  },

  // =============================================
  // E-Mail-Versand (Privatrechnungen)
  // =============================================

  /**
   * Rechnung per E-Mail versenden (nur Privatrechnungen ohne Kassenbezug).
   * Oeffnet mailto:-Link mit vorausgefuelltem Betreff/Text und bietet
   * die Lexoffice-PDF als Download an (Anhang muss manuell hinzugefuegt werden).
   *
   * DATENSCHUTZ: E-Mail-Versand ist NICHT erlaubt fuer Kassenleistungen
   * oder wenn Versichertendaten vorhanden sind.
   *
   * @param {number} rechnungId - Lokale Rechnungs-ID
   */
  async emailVersenden(rechnungId) {
    // Rechnung laden
    const rechnung = await DB.rechnungById(rechnungId);
    if (!rechnung) {
      App.toast('Rechnung nicht gefunden', 'error');
      return;
    }

    // Kunde laden
    const kunde = await DB.kundeById(rechnung.kundeId);
    if (!kunde) {
      App.toast('Kunde nicht gefunden', 'error');
      return;
    }

    // === DATENSCHUTZ-CHECKS ===

    // Check 1: Pflegekasse gesetzt → Abbruch
    if (kunde.pflegekasse) {
      App.toast('E-Mail-Versand bei Kassenleistungen nicht erlaubt (Datenschutz)', 'error', 5000);
      return;
    }

    // Check 2: Versichertennummer gesetzt → Abbruch
    if (kunde.versichertennummer) {
      App.toast('E-Mail-Versand nicht möglich: Versichertennummer beim Kunden hinterlegt (Datenschutz)', 'error', 5000);
      return;
    }

    // Check 3: E-Mail-Adresse vorhanden?
    if (!kunde.email) {
      App.toast('Keine E-Mail-Adresse beim Kunden hinterlegt', 'error');
      return;
    }

    // Lexoffice-PDF prüfen
    if (!rechnung.lexofficeInvoiceId) {
      App.toast('Bitte zuerst Rechnung in Lexoffice erstellen', 'error');
      return;
    }

    // Lexoffice initialisieren
    if (typeof LexofficeAPI === 'undefined') {
      App.toast('Lexoffice-Modul nicht geladen', 'error');
      return;
    }
    if (!LexofficeAPI.istKonfiguriert()) await LexofficeAPI.init();
    if (!LexofficeAPI.istKonfiguriert()) {
      App.toast('Lexoffice API-Key fehlt', 'error');
      return;
    }

    try {
      App.toast('PDF wird geladen...', 'info');

      // documentFileId abrufen falls nicht gespeichert
      let fileId = rechnung.lexofficeDocumentFileId;
      if (!fileId) {
        const dokument = await LexofficeAPI.finalizeInvoice(rechnung.lexofficeInvoiceId);
        fileId = dokument.documentFileId;
        if (fileId) {
          await DB.rechnungAktualisieren(rechnungId, { lexofficeDocumentFileId: fileId });
        }
      }

      if (!fileId) {
        App.toast('Rechnungs-PDF noch nicht verfügbar', 'error');
        return;
      }

      // PDF laden
      const pdfBlob = await LexofficeAPI.getInvoicePdf(fileId);

      // E-Mail-Daten vorbereiten
      const rechnungsnummer = rechnung.rechnungsnummer || `${App.monatsName(rechnung.monat)} ${rechnung.jahr}`;
      const betragFormatiert = rechnung.betrag ? rechnung.betrag.toFixed(2).replace('.', ',') : '0,00';
      const kundenName = kunde.name.replace(/\s+/g, '_');
      const dateiname = `Rechnung_${kundenName}_${rechnungsnummer.replace(/\s+/g, '_')}.pdf`;

      const betreff = `Rechnung ${rechnungsnummer} - ${(FIRMA || {}).name || 'Alltagshilfe'}`;
      const emailText = [
        'Sehr geehrte Damen und Herren,',
        '',
        `anbei erhalten Sie die Rechnung ${rechnungsnummer} über ${betragFormatiert} EUR.`,
        '',
        'Ich bitte um Überweisung innerhalb von 30 Tagen.',
        '',
        'Mit freundlichen Grüßen',
        `${(FIRMA || {}).inhaber || ''}`,
        `${(FIRMA || {}).name || 'Alltagshilfe'}`
      ].join('\n');

      // PDF als Download anbieten
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = pdfUrl;
      a.download = dateiname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 10000);

      // mailto:-Link öffnen
      const mailtoLink = `mailto:${encodeURIComponent(kunde.email)}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(emailText)}`;
      window.location.href = mailtoLink;

      // Status aktualisieren
      await DB.rechnungAktualisieren(rechnungId, {
        status: 'versendet',
        versandDatum: new Date().toISOString(),
        versandart: 'email'
      });

      App.toast('PDF heruntergeladen — bitte an die E-Mail anhängen', 'success', 5000);
      this.listeAnzeigen();

    } catch (err) {
      console.error('E-Mail-Versand fehlgeschlagen:', err);
      App.toast('E-Mail-Versand fehlgeschlagen: ' + err.message, 'error', 5000);
    }
  },

  // =============================================
  // PDF-Vorschau (Fullscreen-Modal)
  // =============================================

  /** Aktuelle Object-URL fuer die Vorschau (zum Aufraeumen) */
  _vorschauObjectUrl: null,

  /**
   * Zeigt ein PDF in einem Fullscreen-Modal zur Vorschau.
   * Der User kann bestaetigen ("Senden") oder abbrechen.
   *
   * @param {Blob} pdfBlob - Das PDF als Blob
   * @param {string} titel - Titel fuer die Vorschau-Leiste
   * @param {Function} onConfirm - Callback bei Klick auf "Senden"
   * @returns {Promise<void>}
   */
  /**
   * Zeigt ein PDF im Fullscreen-Modal (nur Vorschau, kein Versand)
   */
  pdfVorschau(pdfBlob, titel) {
    const overlay = document.getElementById('pdfVorschauOverlay');
    const frame = document.getElementById('pdfVorschauFrame');
    const titelEl = document.getElementById('pdfVorschauTitel');

    if (!overlay || !frame) {
      const url = URL.createObjectURL(pdfBlob);
      window.open(url, '_blank');
      return;
    }

    this._vorschauAufraeumen();
    this._vorschauObjectUrl = URL.createObjectURL(pdfBlob);
    frame.src = this._vorschauObjectUrl;
    if (titelEl) titelEl.textContent = titel || 'PDF-Vorschau';
    overlay.classList.add('active');
  },

  /**
   * Vorschau für eine Lexoffice-Rechnung (eigenständiger Button)
   */
  async vorschauZeigen(rechnungId) {
    if (typeof LexofficeAPI === 'undefined') return;
    if (!LexofficeAPI.istKonfiguriert()) await LexofficeAPI.init();

    const rechnung = await DB.rechnungById(rechnungId);
    if (!rechnung || !rechnung.lexofficeInvoiceId) {
      App.toast('Keine Lexoffice-Rechnung vorhanden', 'error');
      return;
    }

    const kunde = await DB.kundeById(rechnung.kundeId);
    App.toast('PDF wird geladen...', 'info');

    try {
      let fileId = rechnung.lexofficeDocumentFileId;
      if (!fileId) {
        const dok = await LexofficeAPI.finalizeInvoice(rechnung.lexofficeInvoiceId);
        fileId = dok.documentFileId;
        if (fileId) await DB.rechnungAktualisieren(rechnungId, { lexofficeDocumentFileId: fileId });
      }
      if (!fileId) { App.toast('PDF nicht verfügbar', 'error'); return; }

      const pdfBlob = await LexofficeAPI.getInvoicePdf(fileId);
      this.pdfVorschau(pdfBlob, `${kunde ? App.kundenName(kunde) : 'Rechnung'} — ${rechnung.rechnungsnummer || ''}`);
    } catch (err) {
      App.toast('PDF-Fehler: ' + err.message, 'error');
    }
  },

  /**
   * Schliesst das PDF-Vorschau-Modal und raeumt die Object-URL auf
   */
  pdfVorschauSchliessen() {
    const overlay = document.getElementById('pdfVorschauOverlay');
    const frame = document.getElementById('pdfVorschauFrame');

    if (overlay) overlay.classList.remove('active');
    if (frame) frame.src = 'about:blank';

    this._vorschauAufraeumen();
  },

  /**
   * Raeumt die aktuelle Vorschau-Object-URL auf
   */
  _vorschauAufraeumen() {
    if (this._vorschauObjectUrl) {
      URL.revokeObjectURL(this._vorschauObjectUrl);
      this._vorschauObjectUrl = null;
    }
  },

  // =============================================
  // Kassenversand-Workflow (Anschreiben + Rechnung kombiniert)
  // =============================================

  /**
   * Kassenversand: Anschreiben-PDF generieren, Lexoffice-Rechnung laden,
   * beide zusammenfügen und über den gewählten Kanal (Fax/Brief) versenden.
   * @param {number} rechnungId - Lokale Rechnungs-ID
   */
  async kassenversand(rechnungId) {
    // --- Rechnung und Kunde laden ---
    const rechnung = await DB.rechnungById(rechnungId);
    if (!rechnung) {
      App.toast('Rechnung nicht gefunden', 'error');
      return;
    }

    const kunde = await DB.kundeById(rechnung.kundeId);
    if (!kunde) {
      App.toast('Kunde nicht gefunden', 'error');
      return;
    }

    // Prüfen ob Kassenrechnung
    if (!kunde.pflegekasse) {
      App.toast('Keine Pflegekasse beim Kunden hinterlegt — kein Kassenversand möglich', 'error');
      return;
    }

    // Versandart prüfen
    const versandart = rechnung.versandart;
    if (versandart !== 'fax' && versandart !== 'brief') {
      App.toast('Kassenversand nur per Fax oder Brief möglich', 'error');
      return;
    }

    // Lexoffice-PDF prüfen
    if (!rechnung.lexofficeDocumentFileId) {
      App.toast('Keine Lexoffice-PDF vorhanden. Bitte zuerst Rechnung in Lexoffice erstellen.', 'error');
      return;
    }

    // API-Module prüfen und initialisieren
    if (typeof LexofficeAPI === 'undefined') {
      App.toast('Lexoffice-Modul nicht geladen', 'error');
      return;
    }
    if (!LexofficeAPI.istKonfiguriert()) await LexofficeAPI.init();
    if (!LexofficeAPI.istKonfiguriert()) {
      App.toast('Lexoffice API-Key fehlt', 'error');
      return;
    }

    if (versandart === 'fax') {
      if (typeof SipgateAPI === 'undefined') {
        App.toast('Sipgate-Modul nicht geladen', 'error');
        return;
      }
      if (!SipgateAPI.istKonfiguriert()) await SipgateAPI.init();
      if (!SipgateAPI.istKonfiguriert()) {
        App.toast('Sipgate Zugangsdaten fehlen — bitte in Einstellungen hinterlegen', 'error');
        return;
      }
      const faxNummer = SipgateAPI.faxNummerNormalisieren(kunde.faxKasse);
      if (!faxNummer) {
        App.toast('Keine Faxnummer beim Kunden hinterlegt (Feld "Fax Kasse")', 'error');
        return;
      }
    }

    if (versandart === 'brief') {
      if (typeof LetterXpressAPI === 'undefined') {
        App.toast('LetterXpress-Modul nicht geladen', 'error');
        return;
      }
      if (!LetterXpressAPI.istKonfiguriert()) await LetterXpressAPI.init();
      if (!LetterXpressAPI.istKonfiguriert()) {
        App.toast('LetterXpress Zugangsdaten fehlen — bitte in Einstellungen hinterlegen', 'error');
        return;
      }
    }

    // Bestätigung
    const kanalText = versandart === 'fax'
      ? `per Fax an ${SipgateAPI.faxNummerNormalisieren(kunde.faxKasse)}`
      : 'per Brief über LetterXpress';
    if (!await App.confirm(`Kassenversand ${kanalText}?\n\nAnschreiben + Rechnung werden zusammengefügt und versendet.`)) return;

    try {
      // --- Schritt 1: Anschreiben-PDF generieren ---
      App.toast('Anschreiben wird erstellt...', 'info');
      const leistungen = await DB.leistungenFuerMonat(rechnung.monat, rechnung.jahr);
      const kundeLeistungen = leistungen.filter(l => l.kundeId === rechnung.kundeId);
      const anschreibenDoc = await PDFHelper.generateAnschreiben(rechnung, kunde, kundeLeistungen);
      const anschreibenBlob = PDFHelper.toBlob(anschreibenDoc);
      const anschreibenBytes = new Uint8Array(await anschreibenBlob.arrayBuffer());

      // --- Schritt 2: Lexoffice-Rechnung laden ---
      App.toast('Lexoffice-Rechnung wird geladen...', 'info');
      const rechnungBlob = await LexofficeAPI.getInvoicePdf(rechnung.lexofficeDocumentFileId);
      const rechnungBytes = new Uint8Array(await rechnungBlob.arrayBuffer());

      // --- Schritt 3: PDFs zusammenfügen (pdf-lib) ---
      App.toast('PDFs werden zusammengefügt...', 'info');
      const { PDFDocument } = PDFLib;
      const kombiniert = await PDFDocument.create();

      const anschreibenPdf = await PDFDocument.load(anschreibenBytes);
      const rechnungPdf = await PDFDocument.load(rechnungBytes);

      const anschreibenSeiten = await kombiniert.copyPages(anschreibenPdf, anschreibenPdf.getPageIndices());
      for (const seite of anschreibenSeiten) {
        kombiniert.addPage(seite);
      }

      const rechnungSeiten = await kombiniert.copyPages(rechnungPdf, rechnungPdf.getPageIndices());
      for (const seite of rechnungSeiten) {
        kombiniert.addPage(seite);
      }

      const kombiniertBytes = await kombiniert.save();
      const kombiniertBlob = new Blob([kombiniertBytes], { type: 'application/pdf' });

      // --- Schritt 4: Versand ---
      const kundenName = kunde.name.replace(/\s+/g, '_');
      const dateiname = `Kassenversand_${kundenName}_${App.monatsName(rechnung.monat)}_${rechnung.jahr}.pdf`;
      const kombiniertBase64 = btoa(
        kombiniertBytes.reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      if (versandart === 'fax') {
        const faxNummer = SipgateAPI.faxNummerNormalisieren(kunde.faxKasse);
        App.toast(`Fax wird gesendet an ${faxNummer}...`, 'info');
        const ergebnis = await SipgateAPI.faxSenden(faxNummer, kombiniertBase64, dateiname);

        await DB.rechnungAktualisieren(rechnungId, {
          status: 'versendet',
          versandDatum: new Date().toISOString(),
          sipgateFaxSessionId: ergebnis.sessionId || null
        });
      } else {
        App.toast('Brief wird über LetterXpress gesendet...', 'info');
        const ergebnis = await LetterXpressAPI.briefSenden(kombiniertBase64, {
          farbe: false,
          duplex: true,
          versandart: 'national'
        });

        const updateDaten = {
          status: 'versendet',
          versandDatum: new Date().toISOString()
        };
        if (ergebnis.letter && ergebnis.letter.job_id) {
          updateDaten.letterxpressJobId = ergebnis.letter.job_id;
        } else if (ergebnis.id) {
          updateDaten.letterxpressJobId = ergebnis.id;
        }
        await DB.rechnungAktualisieren(rechnungId, updateDaten);
      }

      App.toast('Kassenversand erfolgreich abgeschlossen!', 'success');
      this.listeAnzeigen();

    } catch (err) {
      console.error('Kassenversand fehlgeschlagen:', err);
      App.toast('Kassenversand fehlgeschlagen: ' + err.message, 'error', 5000);
    }
  },

  // =============================================
  // Sipgate Faxversand
  // =============================================

  /**
   * Rechnung per Fax über Sipgate versenden
   * @param {number} rechnungId - Lokale Rechnungs-ID
   */
  async faxVersenden(rechnungId) {
    // Sipgate initialisieren
    if (typeof SipgateAPI === 'undefined') {
      App.toast('Sipgate-Modul nicht geladen', 'error');
      return;
    }

    if (!SipgateAPI.istKonfiguriert()) {
      await SipgateAPI.init();
    }
    if (!SipgateAPI.istKonfiguriert()) {
      App.toast('Sipgate Zugangsdaten fehlen — bitte in Einstellungen hinterlegen', 'error');
      return;
    }

    // Rechnung und Kunde laden
    const rechnung = await DB.rechnungById(rechnungId);
    if (!rechnung) {
      App.toast('Rechnung nicht gefunden', 'error');
      return;
    }

    const kunde = await DB.kundeById(rechnung.kundeId);
    if (!kunde) {
      App.toast('Kunde nicht gefunden', 'error');
      return;
    }

    // Faxnummer prüfen
    const faxNummer = SipgateAPI.faxNummerNormalisieren(kunde.faxKasse);
    if (!faxNummer) {
      App.toast('Keine Faxnummer beim Kunden hinterlegt (Feld "Fax Kasse")', 'error');
      return;
    }

    // PDF von Lexoffice laden
    if (!rechnung.lexofficeDocumentFileId) {
      App.toast('Keine Lexoffice-PDF vorhanden. Bitte zuerst Rechnung in Lexoffice erstellen.', 'error');
      return;
    }

    try {
      App.toast('PDF wird geladen...', 'info');

      // Lexoffice initialisieren falls noetig
      if (!LexofficeAPI.istKonfiguriert()) await LexofficeAPI.init();

      // PDF als Blob laden
      const pdfBlob = await LexofficeAPI.getInvoicePdf(rechnung.lexofficeDocumentFileId);

      // Base64 konvertieren
      const pdfBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(pdfBlob);
      });

      const kundenName = kunde.name.replace(/\s+/g, '_');
      const dateiname = `Rechnung_${kundenName}_${App.monatsName(rechnung.monat)}_${rechnung.jahr}.pdf`;

      App.toast('Fax wird gesendet...', 'info');
      const ergebnis = await SipgateAPI.faxSenden(faxNummer, pdfBase64, dateiname);

      await DB.rechnungAktualisieren(rechnungId, {
        status: 'versendet',
        versandDatum: new Date().toISOString(),
        sipgateFaxSessionId: ergebnis.sessionId || null
      });

      App.toast('Fax erfolgreich gesendet!', 'success');
      this.listeAnzeigen();

    } catch (err) {
      console.error('Faxversand fehlgeschlagen:', err);
      App.toast('Faxversand fehlgeschlagen: ' + err.message, 'error', 5000);
    }
  },

  // =============================================
  // LetterXpress Briefversand
  // =============================================

  /**
   * Rechnung per Brief über LetterXpress versenden
   * @param {number} rechnungId - Lokale Rechnungs-ID
   */
  async briefVersenden(rechnungId) {
    try {
      App.toast('Brief wird ueber LetterXpress gesendet...', 'info');
      const ergebnis = await DB.briefVersenden(rechnungId);

      App.toast('Brief erfolgreich an LetterXpress uebergeben!', 'success');
      this.listeAnzeigen();

    } catch (err) {
      console.error('Briefversand fehlgeschlagen:', err);
      App.toast('Briefversand fehlgeschlagen: ' + err.message, 'error', 5000);
    }
  },

  // =============================================
  // Lexoffice Rechnungs-Sync
  // =============================================

  // Aktueller Status-Filter (alle/offen/bezahlt)
  _aktuellerStatusFilter: 'alle',

  // Cache für alle Rechnungen
  _alleRechnungen: [],

  // Set der via App erstellten IDs
  _appErstellteIds: new Set(),

  async lexofficeSync() {
    if (typeof LexofficeAPI === 'undefined') {
      App.toast('Lexoffice-Modul nicht geladen', 'error');
      return;
    }
    if (!LexofficeAPI.istKonfiguriert()) await LexofficeAPI.init();
    if (!LexofficeAPI.istKonfiguriert()) {
      App.toast('Lexoffice API-Key fehlt', 'error');
      return;
    }

    const container = document.getElementById('lexofficeRechnungen');
    container.innerHTML = '<div class="card text-center"><div class="spinner"></div> Lade Rechnungen...</div>';

    try {
      const alle = await LexofficeAPI.getAlleRechnungen();

      // Nach Datum sortieren (neueste zuerst)
      alle.sort((a, b) => {
        const da = a.voucherDate ? new Date(a.voucherDate) : new Date(0);
        const db = b.voucherDate ? new Date(b.voucherDate) : new Date(0);
        return db - da;
      });

      this._alleRechnungen = alle;

      // Lokale Rechnungen laden um "via App" und Versandstatus zu erkennen
      const lokale = await DB.alleRechnungen();
      this._appErstellteIds = new Set(lokale.filter(r => r.lexofficeInvoiceId).map(r => r.lexofficeInvoiceId));
      this._versandMap = {};
      for (const r of lokale) {
        if (r.lexofficeId) {
          this._versandMap[r.lexofficeId] = { art: r.versandArt, datum: r.versandDatum };
        }
      }

      // Gefilterte Anzeige
      this.filterAnwenden();

      // Sync-Zeitstempel speichern und anzeigen
      const syncZeitIso = new Date().toISOString();
      await DB.settingSpeichern('sync_zeit_rechnungen', syncZeitIso);
      const zeitEl = document.getElementById('syncZeit');
      if (zeitEl) zeitEl.textContent = App.formatSyncZeit(syncZeitIso);

      // Fax-Status für Warteschlange-Einträge prüfen + Poll starten
      const hatWartende = Object.values(this._versandMap).some(v => v.art === 'fax_warteschlange' || v.art === 'faxWarteschlange');
      if (hatWartende) {
        apiFetch('/lexoffice/fax-status-pruefen', { method: 'POST' }).then(r => {
          if (r.aktualisiert > 0) this.lexofficeSync();
        }).catch(() => {});

        // Alle 30s prüfen bis keine wartenden mehr
        if (this._faxPollInterval) clearInterval(this._faxPollInterval);
        this._faxPollInterval = setInterval(async () => {
          try {
            const r = await apiFetch('/lexoffice/fax-status-pruefen', { method: 'POST' });
            if (r.aktualisiert > 0) this.lexofficeSync();
            const lokale = await DB.alleRechnungen();
            if (!lokale.some(l => (l.versandArt || l.versand_art) === 'fax_warteschlange')) {
              clearInterval(this._faxPollInterval);
              this._faxPollInterval = null;
            }
          } catch (e) {}
        }, 30000);
      }
    } catch (err) {
      console.error('Lexoffice-Rechnungssync fehlgeschlagen:', err);
      container.innerHTML = '<div class="card text-center" style="color:var(--danger);">Fehler: ' + err.message + '</div>';
    }
  },

  async manuellErstellt() {
    const kundeId = parseInt(document.getElementById('rechnungKunde').value);
    if (!kundeId) { App.toast('Bitte einen Kunden wählen', 'error'); return; }
    const monat = parseInt(document.getElementById('rechnungMonat').value);
    const jahr = parseInt(document.getElementById('rechnungJahr').value);

    if (!await App.confirm('✋ Rechnung wurde in Lexoffice manuell erstellt?')) return;

    try {
      // Prüfe Duplikat
      const rechnungen = await DB.alleRechnungen();
      const existing = rechnungen.find(r => r.kundeId === kundeId && r.monat === monat && r.jahr === jahr);
      if (existing) {
        await apiFetch(`/rechnungen/${existing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versand_art: 'manuell', versand_datum: App.heute(), status: 'versendet' }),
        });
      } else {
        await apiFetch('/rechnungen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kunde_id: kundeId, monat, jahr, status: 'versendet',
            versand_art: 'manuell', versand_datum: App.heute(), typ: 'kasse',
          }),
        });
        const neu = await DB.alleRechnungen();
        const re = neu.find(r => r.kundeId === kundeId && r.monat === monat && r.jahr === jahr);
        if (re) {
          await apiFetch(`/rechnungen/${re.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ versand_art: 'manuell', versand_datum: App.heute(), status: 'versendet' }),
          });
        }
      }
      App.toast('Als manuell erstellt markiert', 'success');
      this.lexofficeSync();
    } catch (err) {
      App.toast('Fehler: ' + err.message, 'error');
    }
  },

  async versandMarkieren(lexofficeId, art, frage) {
    if (!await App.confirm(frage)) return;
    try {
      const { kunde } = await this._ladeRechnungUndKunde(lexofficeId);
      await apiFetch('/lexoffice/versand-markieren', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lexoffice_id: lexofficeId, versand_art: art, kunde_id: kunde ? kunde.id : null }),
      });
      App.toast('Status aktualisiert', 'success');
      this.lexofficeSync();
      this.detailAnzeigen(lexofficeId);
    } catch (err) {
      App.toast('Fehler: ' + err.message, 'error');
    }
  },

  _versandStatus(lexofficeId) {
    const v = (this._versandMap || {})[lexofficeId];
    if (!v || !v.art) return '';
    const datum = v.datum ? App.formatDatum(v.datum) : '';
    if (v.art === 'fax') return ` | <span style="color:#2e7d32;">📠 gefaxt ${datum}</span>`;
    if (v.art === 'fax_warteschlange') return ` | <span style="color:#2196f3;">📠 Fax wird gesendet ${datum}</span>`;
    if (v.art === 'fax_fehler') return ` | <span style="color:#dc2626;">📠 Fax fehlgeschlagen</span>`;
    if (v.art === 'brief') return ` | <span style="color:#2e7d32;">✉️ Brief ${datum}</span>`;
    if (v.art === 'uebergabe') return ` | <span style="color:#2e7d32;">🤝 übergeben ${datum}</span>`;
    if (v.art === 'serviceportal') return ` | <span style="color:#2e7d32;">🌐 Portal ${datum}</span>`;
    if (v.art === 'manuell') return ` | <span style="color:#2e7d32;">✋ manuell ${datum}</span>`;
    return ` | <span style="color:#2e7d32;">✓ versendet ${datum}</span>`;
  },

  statusFilter(filter) {
    this._aktuellerStatusFilter = filter;
    // Button-Styling
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
      btn.classList.toggle('btn-primary', btn.dataset.filter === filter);
      btn.classList.toggle('btn-outline', btn.dataset.filter !== filter);
    });
    this.filterAnwenden();
  },

  filterAnwenden() {
    const suche = (document.getElementById('rechnungSuche')?.value || '').toLowerCase();
    const statusFilter = this._aktuellerStatusFilter;

    let gefiltert = (this._alleRechnungen || []).filter(r => r.voucherStatus !== 'voided');

    // Status-Filter
    if (statusFilter === 'offen') {
      gefiltert = gefiltert.filter(r => r.voucherStatus === 'open' || r.voucherStatus === 'overdue');
    } else if (statusFilter === 'bezahlt') {
      gefiltert = gefiltert.filter(r => r.voucherStatus === 'paidoff');
    }

    // Suchfilter
    if (suche) {
      gefiltert = gefiltert.filter(r =>
        (r.contactName || '').toLowerCase().includes(suche) ||
        (r.voucherNumber || '').toLowerCase().includes(suche)
      );
    }

    this._gefilterteAnzeigen(gefiltert);
  },

  _gefilterteAnzeigen(rechnungen) {
    const container = document.getElementById('lexofficeRechnungen');
    if (!container) return;

    if (rechnungen.length === 0) {
      container.innerHTML = '<div class="card text-center text-muted">Keine Rechnungen gefunden</div>';
      return;
    }

    // Summenzeile berechnen
    const alleGesamt = (this._alleRechnungen || []).filter(r => r.voucherStatus !== 'voided');
    const offeneRechnungen = alleGesamt.filter(r => r.voucherStatus === 'open' || r.voucherStatus === 'overdue');
    const bezahlteRechnungen = alleGesamt.filter(r => r.voucherStatus === 'paidoff');
    const summeOffen = offeneRechnungen.reduce((s, r) => s + (r.openAmount || r.totalAmount || 0), 0);

    container.innerHTML = `
      <div class="card" style="background: var(--gray-100); margin-bottom: 8px;">
        <div class="text-sm">
          ${alleGesamt.length} Rechnungen | ${offeneRechnungen.length} offen (${summeOffen.toFixed(2).replace('.', ',')} €) | ${bezahlteRechnungen.length} bezahlt
        </div>
      </div>
      ${rechnungen.map(r => {
        const istUeberfaellig = r.voucherStatus === 'overdue';
        const istBezahlt = r.voucherStatus === 'paidoff';
        const viaApp = this._appErstellteIds.has(r.id);
        const faellig = r.dueDate ? new Date(r.dueDate).toLocaleDateString('de-DE') : '-';
        const datum = r.voucherDate ? new Date(r.voucherDate).toLocaleDateString('de-DE') : '-';

        // Betrag: bei bezahlten totalAmount (openAmount ist 0), sonst openAmount
        const anzeigeBetrag = istBezahlt
          ? (r.totalAmount || 0)
          : (r.openAmount != null ? r.openAmount : r.totalAmount);
        const hatTeilzahlung = !istBezahlt && r.openAmount != null && r.totalAmount != null && r.openAmount < r.totalAmount;

        // Badge und Randfarbe je nach Status
        let badgeClass, badgeText, borderColor;
        if (istBezahlt) {
          badgeClass = 'badge-success';
          badgeText = 'Bezahlt';
          borderColor = 'var(--success)';
        } else if (istUeberfaellig) {
          badgeClass = 'badge-danger';
          badgeText = 'Überfällig';
          borderColor = 'var(--danger)';
        } else {
          badgeClass = 'badge-warning';
          badgeText = 'Offen';
          borderColor = 'var(--warning)';
        }

        return `
          <div class="card" style="border-left: 4px solid ${borderColor}; cursor:pointer;"
               onclick="RechnungModule.detailAnzeigen('${r.id}')">
            <div class="card-header">
              <div>
                <div class="card-title">${r.contactName || 'Unbekannt'}</div>
                <div class="text-sm text-muted">
                  ${r.voucherNumber || '-'} | ${datum}
                  ${viaApp ? ' | <span style="color:var(--primary);">via App</span>' : ''}
                  ${this._versandStatus(r.id)}
                </div>
              </div>
              <span class="badge ${badgeClass}">
                ${badgeText}
              </span>
            </div>
            <div class="d-flex justify-between align-center">
              <div class="text-sm">${istBezahlt ? '' : 'Fällig: ' + faellig}</div>
              <div style="text-align:right;">
                <div class="fw-bold text-primary">${anzeigeBetrag ? anzeigeBetrag.toFixed(2).replace('.', ',') + ' €' : '-'}</div>
                ${hatTeilzahlung ? `<div class="text-xs text-muted">von ${r.totalAmount.toFixed(2).replace('.', ',')} € (Teilzahlung)</div>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    `;
  },

  async _kundenAnreichern() {
    const alleKunden = await DB.alleKunden();
    const _delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    for (const r of this._alleRechnungen) {
      try {
        await _delay(500); // Rate-Limit: max 2 requests/sec
        const rechnung = await LexofficeAPI.getInvoice(r.id);
        const positionen = rechnung.lineItems || [];
        const addr = rechnung.address || {};

        for (const p of positionen) {
          if (!p.id || p.name === 'Alltagshilfe') continue;

          const matchKunde = alleKunden.find(k => k.name && p.name &&
            k.name.toLowerCase() === p.name.toLowerCase());
          if (!matchKunde) continue;

          const updates = {};

          // Artikelnummer = Versichertennummer
          if (!matchKunde.versichertennummer && p.id) {
            try {
              await _delay(500);
              const artikel = await LexofficeAPI.request('articles/' + p.id);
              if (artikel && artikel.articleNumber) {
                updates.versichertennummer = artikel.articleNumber;
              }
            } catch(e) {}
          }

          // Pflegekasse aus Empfänger
          if (!matchKunde.pflegekasse && addr.name) {
            updates.pflegekasse = addr.name;
          }

          // Faxnummer der Kasse
          if (!matchKunde.faxKasse && addr.contactId) {
            try {
              await _delay(500);
              const kontakt = await LexofficeAPI.getContact(addr.contactId);
              const fax = kontakt?.phoneNumbers?.fax?.[0];
              if (fax) updates.faxKasse = fax;
            } catch(e) {}
          }

          if (Object.keys(updates).length > 0) {
            await DB.kundeAktualisieren(matchKunde.id, updates);
            Object.assign(matchKunde, updates); // lokalen Cache aktualisieren
            console.log('Angereichert:', matchKunde.name, updates);
          }
        }
      } catch(e) { /* ignorieren */ }
    }
    App.toast('Kundendaten aktualisiert', 'success');
  },

  // =============================================
  // Rechnungs-Detail (HTML-Vorschau)
  // =============================================

  async detailAnzeigen(lexofficeId) {
    const overlay = document.getElementById('rechnungDetailOverlay');
    const content = document.getElementById('rechnungDetailContent');
    if (!overlay || !content) return;

    overlay.classList.remove('hidden');
    content.innerHTML = '<div class="card text-center"><div class="spinner"></div> Lade Rechnungsdetails...</div>';

    try {
      if (!LexofficeAPI.istKonfiguriert()) await LexofficeAPI.init();

      // Rechnungsdetails von Lexoffice laden
      const rechnung = await LexofficeAPI.getInvoice(lexofficeId);

      // Empfänger
      const addr = rechnung.address || {};
      const empfaenger = addr.name || addr.contactId || 'Unbekannt';
      const empfAdresse = [addr.street, addr.zip, addr.city].filter(Boolean).join(', ');

      // Positionen
      const positionen = rechnung.lineItems || [];

      // Leistungszeitraum
      const shipping = rechnung.shippingConditions || {};
      const von = shipping.shippingDate ? new Date(shipping.shippingDate).toLocaleDateString('de-DE') : '';
      const bis = shipping.shippingEndDate ? new Date(shipping.shippingEndDate).toLocaleDateString('de-DE') : '';
      const zeitraum = von && bis ? `${von} – ${bis}` : von || '-';

      // Rechnungsdatum
      const reDatum = rechnung.voucherDate ? new Date(rechnung.voucherDate).toLocaleDateString('de-DE') : '-';

      // Gesamtbetrag
      const total = rechnung.totalPrice || {};
      const betrag = total.totalNetAmount != null ? total.totalNetAmount.toFixed(2).replace('.', ',') : '-';

      // Prüfen ob via App erstellt + lokalen Kunden finden
      const lokale = await DB.alleRechnungen();
      const lokaleRechnung = lokale.find(r => r.lexofficeId === lexofficeId || r.lexofficeInvoiceId === lexofficeId);
      const viaApp = !!lokaleRechnung;
      // Storno-Status: lokal markiert ODER Lex-voucherStatus = "voided"
      const lokalStorniert = !!(lokaleRechnung && lokaleRechnung.stornoLexofficeId);
      const lexStorniert = (rechnung.voucherStatus || '').toLowerCase() === 'voided';
      const istStorniert = lokalStorniert || lexStorniert;
      const stornoNr = lokaleRechnung && (lokaleRechnung.stornoVoucherNumber || '');
      const stornoDatum = lokaleRechnung && lokaleRechnung.stornoDatum
        ? new Date(lokaleRechnung.stornoDatum).toLocaleDateString('de-DE') : '';

      // Lokalen Kunden über contactId finden (für Fax/E-Mail)
      const alleKunden = await DB.alleKunden();
      const kontaktId = addr.contactId || rechnung.address?.contactId;
      const lokalerKunde = alleKunden.find(k => k.lexofficeId === kontaktId);

      // Artikelnummern (= Versichertennummern) aus Lexoffice laden + lokal speichern
      this._artikelNummern = {};

      // Pflegekasse = Rechnungsempfänger, Faxnummer aus Lexoffice-Kontakt laden
      const pflegekasseName = addr.name || '';
      let faxKasseAusLexoffice = '';
      if (addr.contactId) {
        try {
          const kontakt = await LexofficeAPI.request(`contacts/${addr.contactId}`);
          if (kontakt && kontakt.phoneNumbers && kontakt.phoneNumbers.fax && kontakt.phoneNumbers.fax.length > 0) {
            faxKasseAusLexoffice = kontakt.phoneNumbers.fax[0];
          }
        } catch (e) { console.warn('Kontakt-Fax konnte nicht geladen werden:', e); }
      }

      for (const p of positionen) {
        if (p.id) {
          try {
            const artikel = await LexofficeAPI.request(`articles/${p.id}`);
            if (artikel && artikel.articleNumber) {
              this._artikelNummern[p.id] = artikel.articleNumber;
              // Kundendaten anreichern: Versichertennummer, Pflegekasse, Fax
              const matchKunde = alleKunden.find(k => k.name && p.name && k.name.toLowerCase() === p.name.toLowerCase());
              if (matchKunde) {
                const updates = {};
                if (!matchKunde.versichertennummer) {
                  updates.versichertennummer = artikel.articleNumber;
                  console.log(`Vers.-Nr. ${artikel.articleNumber} bei ${matchKunde.name} nachgetragen`);
                }
                if (!matchKunde.pflegekasse && pflegekasseName) {
                  updates.pflegekasse = pflegekasseName;
                  console.log(`Pflegekasse "${pflegekasseName}" bei ${matchKunde.name} nachgetragen`);
                }
                if (!matchKunde.faxKasse && faxKasseAusLexoffice) {
                  updates.faxKasse = faxKasseAusLexoffice;
                  console.log(`Fax-Nr. ${faxKasseAusLexoffice} bei ${matchKunde.name} nachgetragen`);
                }
                if (Object.keys(updates).length > 0) {
                  await DB.kundeAktualisieren(matchKunde.id, updates);
                }
              }
            }
          } catch (e) { /* ignorieren */ }
        }
      }

      // Versicherte Person (aus Positionsname bei Kassenrechnungen)
      const versichertePerson = positionen.length > 0 ? positionen[0].name : null;
      const istKassenrechnung = versichertePerson && versichertePerson !== 'Alltagshilfe';

      content.innerHTML = `
        <div class="card" style="background:white;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;">
            <h3 style="margin:0;font-size:1.1rem;">Rechnungsdetail</h3>
            <div style="display:flex;align-items:center;gap:8px;">
              ${!istStorniert ? `
                <button class="btn btn-sm" style="color:#dc2626;border:1px solid #dc2626;background:white;padding:4px 10px;font-size:0.85rem;"
                        onclick="RechnungModule.stornoAusfuehren('${lexofficeId}', '${(rechnung.voucherNumber || '').replace(/'/g, '')}')">
                  🚫 Stornieren
                </button>
              ` : `
                <span style="background:#fef2f2;color:#dc2626;padding:4px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;white-space:nowrap;">
                  🚫 Storniert
                </span>
              `}
              <button class="btn btn-sm" onclick="RechnungModule.detailSchliessen()" style="font-size:1.3rem;background:none;border:none;">✕</button>
            </div>
          </div>

          <table style="width:100%;font-size:0.9rem;border-collapse:collapse;">
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Empfänger</td><td style="padding:4px 8px;font-weight:600;">${empfaenger}</td></tr>
            ${empfAdresse ? `<tr><td style="padding:4px 8px;color:var(--gray-600);">Adresse</td><td style="padding:4px 8px;">${empfAdresse}</td></tr>` : ''}
            ${istKassenrechnung ? `<tr><td style="padding:4px 8px;color:var(--gray-600);">Versicherte/r</td><td style="padding:4px 8px;font-weight:500;">${versichertePerson}</td></tr>` : ''}
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Datum</td><td style="padding:4px 8px;">${reDatum}</td></tr>
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Zeitraum</td><td style="padding:4px 8px;">${zeitraum}</td></tr>
            ${viaApp ? '<tr><td style="padding:4px 8px;color:var(--gray-600);">Erstellt</td><td style="padding:4px 8px;color:var(--primary);">via App</td></tr>' : ''}
          </table>

          <hr style="margin:12px 0;border:none;border-top:1px solid var(--gray-200);">

          <div style="font-weight:600;margin-bottom:8px;">Positionen</div>
          ${positionen.map(p => {
            const artNr = p.id ? (this._artikelNummern[p.id] || null) : null;
            return `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);">
              <div>
                <div style="font-weight:500;">${p.name || '-'}</div>
                ${artNr ? `<div class="text-xs" style="color:var(--gray-500);">Vers.-Nr. ${artNr}</div>` : ''}
                ${p.description ? `<div class="text-sm text-muted">${p.description}</div>` : ''}
              </div>
              <div style="text-align:right;white-space:nowrap;">
                <div>${p.quantity || '-'} ${p.unitName || ''}</div>
                <div class="fw-bold">${p.lineItemAmount != null ? p.lineItemAmount.toFixed(2).replace('.', ',') + ' €' : ''}</div>
              </div>
            </div>
          `;}).join('')}

          <div style="display:flex;justify-content:space-between;padding:12px 0;font-size:1.1rem;font-weight:700;">
            <span>Gesamt</span>
            <span>${betrag} €</span>
          </div>

          ${rechnung.remark ? `<div style="padding:8px;background:var(--gray-100);border-radius:8px;font-size:0.85rem;margin-top:8px;">${rechnung.remark}</div>` : ''}
        </div>

        <div class="card" style="background:white;">
          ${(() => {
            const v = (this._versandMap || {})[lexofficeId];
            if (v && v.art) {
              const iconMap = {fax:'📠', fax_warteschlange:'📠', fax_fehler:'❌', brief:'✉️', uebergabe:'🤝', serviceportal:'🌐', manuell:'✋'};
              const labelMap = {fax:'Per Fax zugestellt', fax_warteschlange:'Fax wird gesendet', fax_fehler:'Fax fehlgeschlagen', brief:'Per Brief gesendet', uebergabe:'Persönlich übergeben', serviceportal:'Über Serviceportal eingereicht', manuell:'Manuell erstellt und versendet'};
              const icon = iconMap[v.art] || '✓';
              const label = labelMap[v.art] || 'Versendet';
              const boxColor = v.art === 'fax_warteschlange' ? '#e3f2fd;color:#1565c0' : v.art === 'fax_fehler' ? '#fce4ec;color:#c62828' : '#e8f5e9;color:#2e7d32';
              const datum = v.datum ? ' am ' + App.formatDatum(v.datum) : '';
              return `
                <div style="padding:12px;background:${boxColor};border-radius:8px;margin-bottom:12px;display:flex;align-items:center;gap:8px;">
                  <span style="font-size:1.5rem;">${icon}</span>
                  <div>
                    <div style="font-weight:600;color:#2e7d32;">${label}${datum}</div>
                  </div>
                </div>
                <details style="margin-bottom:8px;">
                  <summary style="cursor:pointer;font-size:0.85rem;color:var(--gray-500);">Erneut versenden...</summary>
                  <div class="btn-group mt-1" style="flex-wrap:wrap;gap:8px;">`;
            }
            return '<div style="font-weight:600;margin-bottom:8px;">Versand</div><div class="btn-group" style="flex-wrap:wrap;gap:8px;">';
          })()}
            <button class="btn btn-sm btn-outline" onclick="RechnungModule.pdfLaden('${lexofficeId}', '${(rechnung.contactName || '').replace(/'/g, '')}', '${rechnung.voucherNumber || ''}')">
              📄 PDF laden
            </button>
            <button class="btn btn-sm btn-outline" onclick="RechnungModule.faxDetail('${lexofficeId}')">
              📠 Fax
            </button>
            <button class="btn btn-sm btn-outline" onclick="RechnungModule.briefDetail('${lexofficeId}')">
              ✉️ Brief
            </button>
            ${lokalerKunde && lokalerKunde.email && !lokalerKunde.pflegekasse ? `
              <button class="btn btn-sm btn-outline" onclick="RechnungModule.emailDetail('${lexofficeId}')">
                📧 E-Mail
              </button>
            ` : ''}
            <button class="btn btn-sm btn-outline" onclick="RechnungModule.versandMarkieren('${lexofficeId}', 'uebergabe', '🤝 Als persönlich übergeben markieren?')">
              🤝 Übergabe
            </button>
            <button class="btn btn-sm btn-outline" onclick="RechnungModule.versandMarkieren('${lexofficeId}', 'serviceportal', '🌐 Als über Serviceportal eingereicht markieren?')">
              🌐 Serviceportal
            </button>
            <button class="btn btn-sm btn-outline" onclick="RechnungModule.versandMarkieren('${lexofficeId}', 'manuell', '✋ Als manuell erstellt und versendet markieren?')">
              ✋ Manuell
            </button>
            ${istStorniert && (stornoDatum || stornoNr) ? `
              <span class="badge" style="background:#fef2f2;color:#dc2626;padding:6px 10px;border-radius:4px;font-size:0.85rem;">
                🚫 Storniert${stornoDatum ? ' am ' + stornoDatum : ''}${stornoNr ? ' · Gutschrift ' + stornoNr : ''}
              </span>
            ` : ''}
          </div>
          ${(this._versandMap || {})[lexofficeId]?.art ? '</details>' : ''}
        </div>
      `;
    } catch (err) {
      console.error('Detail-Laden fehlgeschlagen:', err);
      content.innerHTML = `
        <div class="card" style="background:white;">
          <p style="color:var(--danger);">Fehler: ${err.message}</p>
          <button class="btn btn-sm btn-outline" onclick="RechnungModule.detailSchliessen()">Schließen</button>
        </div>
      `;
    }
  },

  detailSchliessen() {
    const overlay = document.getElementById('rechnungDetailOverlay');
    if (overlay) overlay.classList.add('hidden');
  },

  /**
   * Hilfsfunktion: Lexoffice-Rechnungsdaten + lokalen Kunden laden
   */
  async _ladeRechnungUndKunde(lexofficeId) {
    const rechnung = await LexofficeAPI.getInvoice(lexofficeId);
    const kontaktId = rechnung.address?.contactId;
    const alleKunden = await DB.alleKunden();
    let kunde = alleKunden.find(k => k.lexofficeId === kontaktId);
    // Bei Kassenrechnungen: contactId ist die Kasse, nicht der Pflegekunde
    // → Versicherten über Positionsname oder supplement finden
    if (!kunde || !kunde.pflegekasse) {
      const supplement = rechnung.address?.supplement || '';
      const posName = rechnung.lineItems?.[0]?.name || '';
      // "z. Hd. Leistungsabteilung – Vers.: Christel Tax" → "Christel Tax"
      const versMatch = supplement.match(/Vers\.?:\s*(.+)/i);
      const versName = versMatch ? versMatch[1].trim() : posName;
      if (versName) {
        const found = alleKunden.find(k => {
          const fullName = App.kundenName ? App.kundenName(k) : `${k.vorname || ''} ${k.name || ''}`.trim();
          return fullName === versName || k.name === versName;
        });
        if (found) kunde = found;
      }
    }
    const empfaenger = rechnung.address?.name || 'Unbekannt';
    return { rechnung, kunde, empfaenger };
  },

  /**
   * PDF von Lexoffice als Base64 laden
   */
  async _ladePdfBase64(lexofficeId) {
    const dok = await LexofficeAPI.finalizeInvoice(lexofficeId);
    if (!dok || !dok.documentFileId) throw new Error('PDF nicht verfügbar');
    const pdfBlob = await LexofficeAPI.getInvoicePdf(dok.documentFileId);
    const pdfBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(pdfBlob);
    });
    return { pdfBlob, pdfBase64 };
  },

  async faxDetail(lexofficeId) {
    try {
      const { kunde, empfaenger } = await this._ladeRechnungUndKunde(lexofficeId);
      let faxNr = kunde ? (kunde.faxKasse || kunde.pflegekasseFax || '') : '';
      // Fallback: Faxnummer aus Pflegekassen-Tabelle nachschlagen
      if (!faxNr && kunde && kunde.pflegekasse && window.PFLEGEKASSEN) {
        const pk = PFLEGEKASSEN.find(k => k.name === kunde.pflegekasse);
        if (pk && pk.fax) faxNr = pk.fax;
      }

      if (!SipgateAPI.istKonfiguriert()) await SipgateAPI.init();
      if (!SipgateAPI.istKonfiguriert()) { App.toast('Sipgate nicht konfiguriert', 'error'); return; }

      const faxNummer = faxNr ? SipgateAPI.faxNummerNormalisieren(faxNr) : '';
      const hinweis = faxNummer
        ? ''
        : '<p style="color:var(--warning-600);font-size:0.85rem;margin:0 0 8px;">Keine Faxnummer hinterlegt — bitte manuell eingeben.</p>';

      // Bestätigungs-Dialog im Overlay
      const content = document.getElementById('rechnungDetailContent');
      content.innerHTML = `
        <div class="card" style="background:white;">
          <h3 style="margin:0 0 12px;">Fax senden</h3>
          <table style="width:100%;font-size:0.9rem;">
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Empfänger</td><td style="padding:4px 8px;font-weight:600;">${empfaenger}</td></tr>
          </table>
          ${hinweis}
          <div class="form-group" style="margin-top:8px;">
            <label for="faxNummerInput">Faxnummer</label>
            <input type="tel" id="faxNummerInput" class="form-control" value="${faxNummer}" placeholder="z.B. +492324 12345">
          </div>
          <div class="btn-group mt-2" style="gap:8px;">
            <button class="btn btn-primary btn-block" onclick="RechnungModule._faxAbsenden('${lexofficeId}')">
              📠 Jetzt faxen
            </button>
            <button class="btn btn-outline" onclick="RechnungModule.detailAnzeigen('${lexofficeId}')">Zurück</button>
          </div>
        </div>
      `;
    } catch (err) {
      App.toast('Fehler: ' + err.message, 'error');
    }
  },

  async _faxAbsenden(lexofficeId) {
    const faxInput = document.getElementById('faxNummerInput');
    const faxNummer = faxInput ? faxInput.value.trim() : '';
    if (!faxNummer) { App.toast('Bitte Faxnummer eingeben', 'error'); return; }

    const content = document.getElementById('rechnungDetailContent');
    content.innerHTML = '<div class="card" style="background:white;text-align:center;"><div class="spinner"></div> Fax wird gesendet...</div>';
    try {
      const result = await apiFetch('/lexoffice/fax-senden', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lexoffice_id: lexofficeId, fax_nummer: faxNummer }),
      });
      this.detailSchliessen();
      App.toast(result.message || 'Fax gesendet!', 'success');
    } catch (err) {
      App.toast('Fax-Fehler: ' + err.message, 'error');
      this.detailAnzeigen(lexofficeId);
    }
  },

  async briefDetail(lexofficeId) {
    try {
      const { empfaenger } = await this._ladeRechnungUndKunde(lexofficeId);

      if (!LetterXpressAPI.istKonfiguriert()) await LetterXpressAPI.init();
      if (!LetterXpressAPI.istKonfiguriert()) { App.toast('LetterXpress nicht konfiguriert', 'error'); return; }

      const content = document.getElementById('rechnungDetailContent');
      content.innerHTML = `
        <div class="card" style="background:white;">
          <h3 style="margin:0 0 12px;">Brief senden</h3>
          <table style="width:100%;font-size:0.9rem;">
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Empfänger</td><td style="padding:4px 8px;font-weight:600;">${empfaenger}</td></tr>
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Versand</td><td style="padding:4px 8px;">LetterXpress, s/w, national</td></tr>
          </table>
          <div class="btn-group mt-2" style="gap:8px;">
            <button class="btn btn-primary btn-block" onclick="RechnungModule._briefAbsenden('${lexofficeId}')">
              ✉️ Jetzt als Brief senden
            </button>
            <button class="btn btn-outline" onclick="RechnungModule.detailAnzeigen('${lexofficeId}')">Zurück</button>
          </div>
        </div>
      `;
    } catch (err) {
      App.toast('Fehler: ' + err.message, 'error');
    }
  },

  async _briefAbsenden(lexofficeId) {
    const content = document.getElementById('rechnungDetailContent');
    content.innerHTML = '<div class="card" style="background:white;text-align:center;"><div class="spinner"></div> PDF wird geladen und als Brief gesendet...</div>';
    try {
      const { pdfBase64 } = await this._ladePdfBase64(lexofficeId);
      await LetterXpressAPI.briefSenden(pdfBase64, { farbe: false, duplex: true, versandart: 'national' });
      this.detailSchliessen();
      App.toast('Brief an LetterXpress übergeben!', 'success');
    } catch (err) {
      App.toast('Brief-Fehler: ' + err.message, 'error');
      this.detailAnzeigen(lexofficeId);
    }
  },

  async webmailDetail(lexofficeId) {
    try {
      const { kunde, empfaenger } = await this._ladeRechnungUndKunde(lexofficeId);
      const email = kunde ? kunde.email : '';

      const betreff = `Rechnung - ${(FIRMA || {}).name || 'Alltagshilfe'}`;
      const text = `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die Rechnung.\n\nIch bitte um Überweisung innerhalb von 30 Tagen.\n\nMit freundlichen Grüßen\n${(FIRMA || {}).inhaber || ''}\n${(FIRMA || {}).name || 'Alltagshilfe'}`;

      const content = document.getElementById('rechnungDetailContent');
      content.innerHTML = `
        <div class="card" style="background:white;">
          <h3 style="margin:0 0 12px;">Webmail-Versand</h3>
          <p class="text-sm text-muted">PDF wird heruntergeladen. Kopiere die Daten unten für dein Webmail:</p>

          <div class="form-group">
            <label>E-Mail-Adresse</label>
            <div style="display:flex;gap:4px;">
              <input type="text" id="webmailEmail" class="form-control" value="${email}" readonly style="flex:1;">
              <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText(document.getElementById('webmailEmail').value);App.toast('Kopiert!','success')">📋</button>
            </div>
          </div>
          <div class="form-group">
            <label>Betreff</label>
            <div style="display:flex;gap:4px;">
              <input type="text" id="webmailBetreff" class="form-control" value="${betreff}" readonly style="flex:1;">
              <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText(document.getElementById('webmailBetreff').value);App.toast('Kopiert!','success')">📋</button>
            </div>
          </div>
          <div class="form-group">
            <label>Text</label>
            <div style="display:flex;gap:4px;">
              <textarea id="webmailText" class="form-control" rows="4" readonly style="flex:1;font-size:0.85rem;">${text}</textarea>
              <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText(document.getElementById('webmailText').value);App.toast('Kopiert!','success')">📋</button>
            </div>
          </div>

          <div class="btn-group mt-2" style="gap:8px;">
            <button class="btn btn-primary btn-block" onclick="RechnungModule._webmailPdfLaden('${lexofficeId}')">
              📄 PDF herunterladen
            </button>
            <button class="btn btn-outline" onclick="RechnungModule.detailAnzeigen('${lexofficeId}')">Zurück</button>
          </div>
        </div>
      `;
    } catch (err) {
      App.toast('Fehler: ' + err.message, 'error');
    }
  },

  async _webmailPdfLaden(lexofficeId) {
    try {
      App.toast('PDF wird geladen...', 'info');
      const { pdfBlob } = await this._ladePdfBase64(lexofficeId);
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = pdfUrl;
      a.download = 'Rechnung.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 10000);
      App.toast('PDF heruntergeladen', 'success');
    } catch (err) {
      App.toast('Download-Fehler: ' + err.message, 'error');
    }
  },

  async emailDetail(lexofficeId) {
    try {
      const { kunde } = await this._ladeRechnungUndKunde(lexofficeId);
      if (!kunde || !kunde.email) { App.toast('Keine E-Mail-Adresse hinterlegt', 'error'); return; }
      if (kunde.pflegekasse) { App.toast('E-Mail bei Kassenleistungen nicht erlaubt (Datenschutz)', 'error'); return; }

      App.toast('PDF wird geladen...', 'info');
      const { pdfBlob } = await this._ladePdfBase64(lexofficeId);

      const pdfUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = pdfUrl;
      a.download = 'Rechnung.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 10000);

      const betreff = `Rechnung - ${(FIRMA || {}).name || 'Alltagshilfe'}`;
      const text = `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die Rechnung.\n\nIch bitte um Überweisung innerhalb von 30 Tagen.\n\nMit freundlichen Grüßen\n${(FIRMA || {}).inhaber || ''}\n${(FIRMA || {}).name || 'Alltagshilfe'}`;
      window.location.href = `mailto:${encodeURIComponent(kunde.email)}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`;
      App.toast('PDF geladen — bitte an E-Mail anhängen', 'success');
    } catch (err) {
      App.toast('E-Mail-Fehler: ' + err.message, 'error');
    }
  },

  async pdfLaden(lexofficeId, kontaktName, rechnungsNr) {
    try {
      App.toast('PDF wird geladen...', 'info');
      const dok = await LexofficeAPI.finalizeInvoice(lexofficeId);
      if (!dok || !dok.documentFileId) { App.toast('PDF nicht verfügbar', 'error'); return; }
      const pdfBlob = await LexofficeAPI.getInvoicePdf(dok.documentFileId);
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const name = (kontaktName || 'Rechnung').replace(/[^a-zA-ZäöüÄÖÜß0-9_-]/g, '_');
      const nr = (rechnungsNr || '').replace(/[^a-zA-Z0-9-]/g, '');
      const dateiname = nr ? `${nr}_${name}.pdf` : `Rechnung_${name}.pdf`;
      const a = document.createElement('a');
      a.href = pdfUrl;
      a.download = dateiname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 5000);
    } catch (err) {
      App.toast('PDF-Fehler: ' + err.message, 'error');
    }
  },

  // =============================================
  // Lexoffice-Integration
  // =============================================

  /**
   * Rechnung in Lexoffice erstellen und finalisieren
   * @param {number} rechnungId - Lokale Rechnungs-ID
   */
  async inLexofficeErstellen(rechnungId) {
    // Lexoffice initialisieren
    if (typeof LexofficeAPI === 'undefined') {
      App.toast('Lexoffice-Modul nicht geladen', 'error');
      return;
    }

    if (!LexofficeAPI.istKonfiguriert()) {
      await LexofficeAPI.init();
    }
    if (!LexofficeAPI.istKonfiguriert()) {
      App.toast('Lexoffice API-Key fehlt — bitte in Einstellungen hinterlegen', 'error');
      return;
    }

    // Rechnung und zugehörige Daten laden
    const rechnung = await DB.rechnungById(rechnungId);
    if (!rechnung) {
      App.toast('Rechnung nicht gefunden', 'error');
      return;
    }

    if (rechnung.lexofficeInvoiceId) {
      App.toast('Rechnung ist bereits in Lexoffice vorhanden', 'info');
      return;
    }

    const kunde = await DB.kundeById(rechnung.kundeId);
    if (!kunde) {
      App.toast('Kunde nicht gefunden', 'error');
      return;
    }

    const leistungen = await DB.leistungenFuerMonat(rechnung.monat, rechnung.jahr);
    const kundeLeistungen = leistungen.filter(l => l.kundeId === rechnung.kundeId);

    if (kundeLeistungen.length === 0) {
      App.toast('Keine Leistungen für diesen Monat gefunden', 'error');
      return;
    }

    try {
      App.toast('Rechnung wird in Lexoffice erstellt...', 'info');

      // 1. Rechnungsdaten im Lexoffice-Format aufbereiten
      const lexDaten = LexofficeAPI.rechnungZuLexoffice(rechnung, kunde, kundeLeistungen);

      // 2. Rechnung in Lexoffice erstellen
      const ergebnis = await LexofficeAPI.createInvoice(lexDaten);
      if (!ergebnis.id) {
        throw new Error('Keine Rechnungs-ID von Lexoffice erhalten');
      }

      console.log('Lexoffice Rechnung erstellt:', ergebnis.id);

      // 3. Rechnung finalisieren (Rechnungsnummer wird vergeben, PDF generiert)
      const dokument = await LexofficeAPI.finalizeInvoice(ergebnis.id);
      console.log('Lexoffice Rechnung finalisiert:', dokument);

      // 4. Lokale Rechnung mit Lexoffice-ID aktualisieren
      const updateDaten = {
        lexofficeInvoiceId: ergebnis.id
      };

      // documentFileId speichern falls vorhanden (für PDF-Download)
      if (dokument && dokument.documentFileId) {
        updateDaten.lexofficeDocumentFileId = dokument.documentFileId;
      }

      await DB.rechnungAktualisieren(rechnungId, updateDaten);

      App.toast('Rechnung erfolgreich in Lexoffice erstellt!', 'success');

      // 5. PDF automatisch herunterladen falls documentFileId vorhanden
      if (dokument && dokument.documentFileId) {
        await this._lexofficePdfAnzeigen(dokument.documentFileId, rechnung, kunde);
      }

      // Liste aktualisieren
      this.listeAnzeigen();

    } catch (err) {
      console.error('Lexoffice Rechnungserstellung fehlgeschlagen:', err);
      App.toast('Lexoffice-Fehler: ' + err.message, 'error', 5000);
    }
  },

  /**
   * PDF einer bestehenden Lexoffice-Rechnung laden und anzeigen
   * @param {number} rechnungId - Lokale Rechnungs-ID
   */
  async lexofficePdfLaden(rechnungId) {
    if (typeof LexofficeAPI === 'undefined') {
      App.toast('Lexoffice-Modul nicht geladen', 'error');
      return;
    }

    if (!LexofficeAPI.istKonfiguriert()) {
      await LexofficeAPI.init();
    }

    const rechnung = await DB.rechnungById(rechnungId);
    if (!rechnung || !rechnung.lexofficeInvoiceId) {
      App.toast('Keine Lexoffice-Rechnung vorhanden', 'error');
      return;
    }

    const kunde = await DB.kundeById(rechnung.kundeId);

    try {
      App.toast('PDF wird geladen...', 'info');

      // documentFileId abrufen falls nicht gespeichert
      let fileId = rechnung.lexofficeDocumentFileId;
      if (!fileId) {
        const dokument = await LexofficeAPI.finalizeInvoice(rechnung.lexofficeInvoiceId);
        fileId = dokument.documentFileId;
        if (fileId) {
          await DB.rechnungAktualisieren(rechnungId, { lexofficeDocumentFileId: fileId });
        }
      }

      if (!fileId) {
        App.toast('Rechnungs-PDF noch nicht verfügbar', 'error');
        return;
      }

      await this._lexofficePdfAnzeigen(fileId, rechnung, kunde);

    } catch (err) {
      console.error('PDF-Download fehlgeschlagen:', err);
      App.toast('PDF-Download fehlgeschlagen: ' + err.message, 'error');
    }
  },

  /**
   * Lexoffice-PDF in Vorschau anzeigen und Download anbieten
   */
  async _lexofficePdfAnzeigen(documentFileId, rechnung, kunde) {
    try {
      const pdfBlob = await LexofficeAPI.getInvoicePdf(documentFileId);
      const pdfUrl = URL.createObjectURL(pdfBlob);

      // PDF direkt herunterladen
      const kundenName = (kunde && kunde.name) ? kunde.name.replace(/\s+/g, '_') : 'Kunde';
      const dateiname = `Rechnung_Lexoffice_${kundenName}_${App.monatsName(rechnung.monat)}_${rechnung.jahr}.pdf`;

      const a = document.createElement('a');
      a.href = pdfUrl;
      a.download = dateiname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // URL nach kurzer Zeit freigeben
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 10000);

      App.toast('Lexoffice-PDF geladen', 'success');
    } catch (err) {
      console.error('PDF-Anzeige fehlgeschlagen:', err);
      App.toast('PDF konnte nicht angezeigt werden', 'error');
    }
  }
};

if (window._entlastReady && window.FIRMA) { RechnungModule.init(); }
else { document.addEventListener('entlast-ready', () => RechnungModule.init()); }
