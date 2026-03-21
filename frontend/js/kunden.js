/**
 * Kundenverwaltung für Susi's Alltagshilfe
 */

const KundenModule = {
  currentKunde: null,
  _kundenFilter: 'alle',

  // Kassen-Keywords zur Erkennung von Pflegekassen/Firmen
  _kassenKeywords: ['aok','barmer','dak','techniker','knappschaft','bkk','novitas','energie','lbv','landesamt','krankenkasse','ersatzkasse','pflegekasse'],

  istKasse(kunde) {
    const name = (kunde.name || '').toLowerCase();
    return this._kassenKeywords.some(kw => name.includes(kw));
  },

  async init() {
    await this.listeAnzeigen();
    this.setupEventListeners();
  },

  setupEventListeners() {
    // Suche
    const searchInput = document.getElementById('kundenSuche');
    if (searchInput) {
      searchInput.addEventListener('input', App.debounce((e) => {
        this.listeAnzeigen(e.target.value);
      }));
    }

    // Formular
    const form = document.getElementById('kundeForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.speichern();
      });
    }
  },

  async listeAnzeigen(suchbegriff = '') {
    const container = document.getElementById('kundenListe');
    if (!container) return;

    let kunden;
    if (suchbegriff) {
      kunden = await DB.kundenSuchen(suchbegriff);
    } else {
      kunden = await DB.alleKunden();
    }

    if (kunden.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">👥</div>
          <p>${suchbegriff ? 'Keine Kunden gefunden' : 'Noch keine Kunden angelegt'}</p>
          <button class="btn btn-primary" onclick="KundenModule.neuerKunde()">
            + Neuer Kunde
          </button>
        </div>
      `;
      return;
    }

    // Filterleiste
    const filterLeiste = `
      <div class="btn-group" style="gap:4px;margin-bottom:8px;">
        <button class="btn btn-sm ${this._kundenFilter === 'alle' ? 'btn-primary' : 'btn-outline'} kunden-filter-btn" data-filter="alle" onclick="KundenModule.filterKunden('alle')">Alle</button>
        <button class="btn btn-sm ${this._kundenFilter === 'personen' ? 'btn-primary' : 'btn-outline'} kunden-filter-btn" data-filter="personen" onclick="KundenModule.filterKunden('personen')">Personen</button>
        <button class="btn btn-sm ${this._kundenFilter === 'kassen' ? 'btn-primary' : 'btn-outline'} kunden-filter-btn" data-filter="kassen" onclick="KundenModule.filterKunden('kassen')">Pflegekassen</button>
      </div>
    `;

    // Lexoffice-Sync-Button oben in der Liste (nur wenn API vorhanden)
    const syncButton = (typeof LexofficeAPI !== 'undefined')
      ? `<div style="margin-bottom: 12px; display:flex; justify-content:flex-end; align-items:center; gap:8px;">
           <span id="kundenSyncZeit" class="text-xs text-muted"></span>
           <button class="btn btn-sm btn-outline" onclick="KundenModule.syncMitLexoffice()" title="Kunden mit Lexoffice synchronisieren">
             🔄 Sync
           </button>
         </div>`
      : '';

    // Gespeicherten Sync-Zeitstempel laden
    const gespeicherteSyncZeit = await DB.settingLesen('sync_zeit_kunden');

    // Inaktive Kunden ans Ende sortieren
    kunden.sort((a, b) => {
      const aInaktiv = a.kundentyp === 'inaktiv' ? 1 : 0;
      const bInaktiv = b.kundentyp === 'inaktiv' ? 1 : 0;
      if (aInaktiv !== bInaktiv) return aInaktiv - bInaktiv;
      return (a.name || '').localeCompare(b.name || '');
    });

    // Filter anwenden
    if (this._kundenFilter === 'personen') {
      kunden = kunden.filter(k => !this.istKasse(k));
    } else if (this._kundenFilter === 'kassen') {
      kunden = kunden.filter(k => this.istKasse(k));
    }

    if (kunden.length === 0) {
      container.innerHTML = filterLeiste + syncButton + `
        <div class="empty-state">
          <div class="empty-icon">👥</div>
          <p>Keine Kunden in dieser Kategorie</p>
        </div>
      `;
      // Sync-Zeitstempel trotzdem anzeigen
      if (gespeicherteSyncZeit) {
        const syncZeitEl = document.getElementById('kundenSyncZeit');
        if (syncZeitEl) syncZeitEl.textContent = App.formatSyncZeit(gespeicherteSyncZeit);
      }
      return;
    }

    container.innerHTML = filterLeiste + syncButton + kunden.map(kunde => {
      const istInaktiv = kunde.kundentyp === 'inaktiv';
      const istDL = kunde.kundentyp === 'dienstleistung';
      const badge = istInaktiv
        ? '<span style="display:inline-block;font-size:0.65rem;padding:1px 6px;border-radius:8px;background:var(--gray-200);color:var(--gray-500);margin-left:6px;vertical-align:middle;">inaktiv</span>'
        : istDL
          ? '<span style="display:inline-block;font-size:0.65rem;padding:1px 6px;border-radius:8px;background:#e0f2fe;color:#0369a1;margin-left:6px;vertical-align:middle;">DL</span>'
          : '';
      const itemStyle = istInaktiv ? 'opacity:0.5;' : '';

      return `
      <div class="list-item" onclick="KundenModule.detailAnzeigen(${kunde.id})" style="${itemStyle}">
        <div class="item-avatar">${App.initialen(kunde.name)}</div>
        <div class="item-content">
          <div class="item-title">${this.escapeHtml(kunde.name)}${badge}</div>
          <div class="item-subtitle">
            ${kunde.pflegekasse || ''} ${kunde.pflegegrad ? '| PG ' + kunde.pflegegrad : ''}
            ${kunde.besonderheiten ? '| ' + this.escapeHtml(kunde.besonderheiten) : ''}
          </div>
        </div>
        <div class="item-action">›</div>
      </div>
    `;
    }).join('');

    // Gespeicherten Sync-Zeitstempel anzeigen
    if (gespeicherteSyncZeit) {
      const syncZeitEl = document.getElementById('kundenSyncZeit');
      if (syncZeitEl) syncZeitEl.textContent = App.formatSyncZeit(gespeicherteSyncZeit);
    }
  },

  filterKunden(filter) {
    this._kundenFilter = filter;
    const suchbegriff = document.getElementById('kundenSuche')?.value || '';
    this.listeAnzeigen(suchbegriff);
  },

  neuerKunde() {
    this.currentKunde = null;
    this.formAnzeigen();
  },

  async detailAnzeigen(id) {
    const kunde = await DB.kundeById(id);
    if (!kunde) {
      App.toast('Kunde nicht gefunden', 'error');
      return;
    }
    this.currentKunde = kunde;
    this.formAnzeigen(kunde);
  },

  formAnzeigen(kunde = null) {
    const container = document.getElementById('kundenContent');
    if (!container) return;

    const kassenOptions = PFLEGEKASSEN.map(k =>
      `<option value="${k.name}" ${kunde && kunde.pflegekasse === k.name ? 'selected' : ''}>${k.name}</option>`
    ).join('');

    container.innerHTML = `
      <form id="kundeForm" onsubmit="event.preventDefault(); KundenModule.speichern();">
        <div class="card">
          <h3 class="card-title mb-2">${kunde ? 'Kunde bearbeiten' : 'Neuer Kunde'}</h3>

          <div class="form-group">
            <label for="kundeName">Name *</label>
            <input type="text" id="kundeName" class="form-control" required
                   value="${kunde ? this.escapeHtml(kunde.name) : ''}"
                   placeholder="Vor- und Nachname">
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="kundeStrasse">Straße</label>
              <input type="text" id="kundeStrasse" class="form-control"
                     value="${kunde ? this.escapeHtml(kunde.strasse || '') : ''}"
                     placeholder="Straße und Hausnr.">
            </div>
            <div class="form-group">
              <label for="kundePlz">PLZ</label>
              <input type="text" id="kundePlz" class="form-control"
                     value="${kunde ? this.escapeHtml(kunde.plz || '') : ''}"
                     placeholder="45525" maxlength="5">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="kundeOrt">Ort</label>
              <input type="text" id="kundeOrt" class="form-control"
                     value="${kunde ? this.escapeHtml(kunde.ort || '') : ''}"
                     placeholder="Hattingen">
            </div>
            <div class="form-group">
              <label for="kundeGeburtstag">Geburtstag</label>
              <input type="date" id="kundeGeburtstag" class="form-control"
                     value="${kunde ? (kunde.geburtstag || '') : ''}">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="kundeTelefon">Telefon</label>
              <input type="tel" id="kundeTelefon" class="form-control"
                     value="${kunde ? this.escapeHtml(kunde.telefon || '') : ''}"
                     placeholder="02324 ...">
            </div>
            <div class="form-group">
              <label for="kundeEmail">E-Mail</label>
              <input type="email" id="kundeEmail" class="form-control"
                     value="${kunde ? this.escapeHtml(kunde.email || '') : ''}">
            </div>
          </div>
        </div>

        <div class="card">
          <h3 class="card-title mb-2">Versicherungsdaten</h3>

          <div class="form-group">
            <label for="kundeVersNr">Versichertennummer</label>
            <input type="text" id="kundeVersNr" class="form-control"
                   value="${kunde ? this.escapeHtml(kunde.versichertennummer || '') : ''}"
                   placeholder="Versichertennummer">
          </div>

          <div class="form-group">
            <label for="kundePflegekasse">Pflegekasse</label>
            <select id="kundePflegekasse" class="form-control">
              <option value="">-- Bitte wählen --</option>
              ${kassenOptions}
            </select>
          </div>

          <div class="form-group">
            <label for="kundeFaxKasse">Faxnummer der Kasse</label>
            <input type="tel" id="kundeFaxKasse" class="form-control"
                   value="${kunde ? this.escapeHtml(kunde.faxKasse || '') : ''}"
                   placeholder="Faxnummer">
          </div>

          <div class="form-row">
            <div class="form-group" style="flex:1;">
              <label for="kundePflegegrad">Pflegegrad</label>
              <select id="kundePflegegrad" class="form-control">
                <option value="">-- Bitte wählen --</option>
                ${[1,2,3,4,5].map(pg =>
                  `<option value="${pg}" ${kunde && kunde.pflegegrad == pg ? 'selected' : ''}>Pflegegrad ${pg}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label for="kundePflegegradSeit">seit</label>
              <input type="date" id="kundePflegegradSeit" class="form-control"
                     value="${kunde ? (kunde.pflegegradSeit || '') : ''}">
            </div>
          </div>

          <div class="form-group">
            <label for="kundeBesonderheiten">Besonderheiten</label>
            <textarea id="kundeBesonderheiten" class="form-control" rows="3"
                      placeholder="z.B. 50% LBV, besondere Hinweise...">${kunde ? this.escapeHtml(kunde.besonderheiten || '') : ''}</textarea>
          </div>

          <div class="form-group">
            <label for="kundeKundentyp">Kundentyp</label>
            <select id="kundeKundentyp" class="form-control">
              <option value="pflege" ${!kunde || !kunde.kundentyp || kunde.kundentyp === 'pflege' ? 'selected' : ''}>Pflegekunde (Entlastungsbetrag)</option>
              <option value="dienstleistung" ${kunde && kunde.kundentyp === 'dienstleistung' ? 'selected' : ''}>Dienstleistung (ohne Pflege)</option>
              <option value="inaktiv" ${kunde && kunde.kundentyp === 'inaktiv' ? 'selected' : ''}>Inaktiv</option>
            </select>
          </div>
        </div>

        <div class="btn-group">
          <button type="submit" class="btn btn-primary btn-block">
            ${kunde ? 'Speichern' : 'Anlegen'}
          </button>
          <button type="button" class="btn btn-secondary" onclick="KundenModule.zurueckZurListe()">
            Abbrechen
          </button>
          ${kunde ? `
            <button type="button" class="btn btn-danger" onclick="KundenModule.loeschen(${kunde.id})">
              Löschen
            </button>
          ` : ''}
        </div>
      </form>
    `;
  },

  async speichern() {
    const daten = {
      name: document.getElementById('kundeName').value.trim(),
      strasse: document.getElementById('kundeStrasse').value.trim(),
      plz: document.getElementById('kundePlz').value.trim(),
      ort: document.getElementById('kundeOrt').value.trim(),
      telefon: document.getElementById('kundeTelefon').value.trim(),
      email: document.getElementById('kundeEmail').value.trim(),
      versichertennummer: document.getElementById('kundeVersNr').value.trim(),
      pflegekasse: document.getElementById('kundePflegekasse').value,
      faxKasse: document.getElementById('kundeFaxKasse').value.trim(),
      pflegegrad: document.getElementById('kundePflegegrad').value,
      pflegegradSeit: document.getElementById('kundePflegegradSeit').value || null,
      geburtstag: document.getElementById('kundeGeburtstag').value || null,
      besonderheiten: document.getElementById('kundeBesonderheiten').value.trim(),
      kundentyp: document.getElementById('kundeKundentyp').value || 'pflege'
    };

    if (!daten.name) {
      App.toast('Bitte einen Namen eingeben', 'error');
      return;
    }

    try {
      if (this.currentKunde) {
        await DB.kundeAktualisieren(this.currentKunde.id, daten);
        App.toast('Kunde aktualisiert', 'success');
      } else {
        await DB.kundeHinzufuegen(daten);
        App.toast('Kunde angelegt', 'success');
      }
      this.zurueckZurListe();
    } catch (err) {
      console.error('Fehler beim Speichern:', err);
      App.toast('Fehler beim Speichern', 'error');
    }
  },

  async loeschen(id) {
    if (!await App.confirm('Diesen Kunden wirklich löschen? Alle zugehörigen Daten bleiben erhalten.')) return;

    try {
      await DB.kundeLoeschen(id);
      App.toast('Kunde gelöscht', 'success');
      this.zurueckZurListe();
    } catch (err) {
      console.error('Fehler beim Löschen:', err);
      App.toast('Fehler beim Löschen', 'error');
    }
  },

  zurueckZurListe() {
    this.currentKunde = null;
    const container = document.getElementById('kundenContent');
    if (container) {
      container.innerHTML = `
        <div class="search-bar">
          <span class="search-icon">🔍</span>
          <input type="text" id="kundenSuche" placeholder="Kunden suchen..." class="form-control"
                 style="padding-left: 44px; border-radius: 25px;">
        </div>
        <div id="kundenListe"></div>
      `;
      this.init();
    }
  },

  // HTML-Escape-Hilfsfunktion
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // =============================================
  // Lexoffice-Synchronisation
  // =============================================

  /**
   * Bidirektionale Synchronisation aller Kunden mit Lexoffice
   * - Lokale Kunden ohne lexofficeId: In Lexoffice suchen oder anlegen
   * - Lexoffice-Kontakte mit neueren Daten: Lokal aktualisieren
   */
  async syncMitLexoffice() {
    if (!LexofficeAPI.istKonfiguriert()) {
      await LexofficeAPI.init();
    }
    if (!LexofficeAPI.istKonfiguriert()) {
      App.toast('Lexoffice API-Key fehlt — bitte in Einstellungen hinterlegen', 'error');
      return;
    }

    App.toast('Lexoffice-Sync gestartet...', 'info');
    let angelegt = 0, verknuepft = 0, aktualisiert = 0, fehler = 0;

    try {
      // 1. Alle lokalen Kunden laden
      const lokaleKunden = await DB.alleKunden();

      // 2. Alle Lexoffice-Kontakte laden (paginiert)
      const lexKontakte = [];
      let page = 0;
      let totalPages = 1;
      while (page < totalPages) {
        const result = await LexofficeAPI.getContacts(page, 250);
        if (result.content) {
          lexKontakte.push(...result.content);
        }
        totalPages = result.totalPages || 1;
        page++;
      }

      // 3. Lokale Kunden ohne lexofficeId verarbeiten
      for (const kunde of lokaleKunden) {
        if (kunde.lexofficeId) continue; // Bereits verknüpft

        try {
          // Nach Name in Lexoffice suchen
          const gefunden = lexKontakte.find(k => {
            const person = k.person || {};
            const lexName = [person.firstName, person.lastName].filter(Boolean).join(' ');
            return lexName.toLowerCase() === kunde.name.toLowerCase();
          });

          if (gefunden) {
            // Vorhandenen Kontakt verknüpfen
            await DB.kundeAktualisieren(kunde.id, {
              lexofficeId: gefunden.id,
              lexofficeVersion: gefunden.version
            });
            verknuepft++;
          } else {
            // Neuen Kontakt in Lexoffice anlegen
            const kontaktDaten = LexofficeAPI.kundeZuKontakt(kunde);
            const result = await LexofficeAPI.createContact(kontaktDaten);
            if (result.id) {
              await DB.kundeAktualisieren(kunde.id, {
                lexofficeId: result.id,
                lexofficeVersion: result.version || 0
              });
              angelegt++;
            }
          }
        } catch (err) {
          console.error(`Sync-Fehler für Kunde "${kunde.name}":`, err);
          fehler++;
        }
      }

      // 4. Lexoffice-Kontakte importieren, die lokal noch nicht existieren
      const verknuepfteIds = new Set(
        (await DB.alleKunden()).filter(k => k.lexofficeId).map(k => k.lexofficeId)
      );
      for (const lexKontakt of lexKontakte) {
        if (verknuepfteIds.has(lexKontakt.id)) continue;
        // Nur Kunden-Kontakte importieren (keine Lieferanten etc.)
        if (!lexKontakt.roles || !lexKontakt.roles.customer) continue;

        try {
          const neueDaten = LexofficeAPI.kontaktZuKunde(lexKontakt);
          // Firmen-Kontakte: Name aus company.name
          if (!neueDaten.name && lexKontakt.company) {
            neueDaten.name = lexKontakt.company.name;
          }
          if (!neueDaten.name) continue;

          neueDaten.lexofficeId = lexKontakt.id;
          neueDaten.lexofficeVersion = lexKontakt.version;
          await DB.kundeHinzufuegen(neueDaten);
          angelegt++;
        } catch (err) {
          console.error(`Import-Fehler für Lexoffice-Kontakt "${lexKontakt.id}":`, err);
          fehler++;
        }
      }

      // 5. Lexoffice-Kontakte prüfen: Gibt es neuere Daten?
      const aktuelleKunden = await DB.alleKunden();
      for (const kunde of aktuelleKunden) {
        if (!kunde.lexofficeId) continue;

        try {
          const lexKontakt = await LexofficeAPI.getContact(kunde.lexofficeId);
          if (!lexKontakt) continue;

          // Aktualisierungszeitpunkt vergleichen
          const lexUpdated = new Date(lexKontakt.updatedDate || 0);
          const lokalUpdated = new Date(kunde.aktualisiert || 0);

          if (lexUpdated > lokalUpdated) {
            // Lexoffice-Daten sind neuer → lokal aktualisieren
            const neueDaten = LexofficeAPI.kontaktZuKunde(lexKontakt);
            // Nur Adress-/Kontaktdaten übernehmen, keine Pflege-spezifischen Felder
            await DB.kundeAktualisieren(kunde.id, {
              strasse: neueDaten.strasse || kunde.strasse,
              plz: neueDaten.plz || kunde.plz,
              ort: neueDaten.ort || kunde.ort,
              telefon: neueDaten.telefon || kunde.telefon,
              email: neueDaten.email || kunde.email,
              lexofficeVersion: lexKontakt.version
            });
            aktualisiert++;
          }
        } catch (err) {
          console.error(`Update-Fehler für Kunde "${kunde.name}":`, err);
          fehler++;
        }
      }

      // Ergebniszusammenfassung
      const teile = [];
      if (angelegt > 0) teile.push(`${angelegt} angelegt`);
      if (verknuepft > 0) teile.push(`${verknuepft} verknüpft`);
      if (aktualisiert > 0) teile.push(`${aktualisiert} aktualisiert`);
      if (fehler > 0) teile.push(`${fehler} Fehler`);

      const nachricht = teile.length > 0
        ? `Lexoffice-Sync: ${teile.join(', ')}`
        : 'Lexoffice-Sync: Alles aktuell';
      App.toast(nachricht, fehler > 0 ? 'error' : 'success', 5000);

      // Sync-Zeitstempel speichern und anzeigen
      const syncZeitIso = new Date().toISOString();
      await DB.settingSpeichern('sync_zeit_kunden', syncZeitIso);
      const zeitEl = document.getElementById('kundenSyncZeit');
      if (zeitEl) zeitEl.textContent = App.formatSyncZeit(syncZeitIso);

      // Liste neu laden
      await this.listeAnzeigen();

    } catch (err) {
      console.error('Lexoffice-Sync Gesamtfehler:', err);
      App.toast('Lexoffice-Sync fehlgeschlagen: ' + err.message, 'error', 5000);
    }
  }
};

// Initialisierung wenn Seite geladen
document.addEventListener('DOMContentLoaded', () => {
  KundenModule.init();
});
