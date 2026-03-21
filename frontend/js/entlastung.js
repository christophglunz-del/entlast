/**
 * Entlastungsbetrag-Modul fuer Susi's Alltagshilfe
 * Berechnung und Anzeige des Entlastungsbetrags nach Paragraph 45b SGB XI
 *
 * - 131 Euro/Monat (= 1.572 Euro/Jahr) pro Versichertem
 * - Nicht genutzte Betraege aus dem Vorjahr verfallen am 30.06. des Folgejahres
 * - Ueberziehungen im laufenden Jahr werden vom Vorjahres-Uebertrag abgezogen
 */

const EntlastungModule = {
  MONATLICH: 131.00,
  daten: null,
  bezugsjahr: null,
  aktuellerFilter: 'alle',
  _apiCache: null,

  async init() {
    const container = document.getElementById('entlastungContent');
    if (!container) return;

    container.innerHTML = `
      <div class="card" style="background: linear-gradient(135deg, var(--primary), var(--primary-dark)); color: white;">
        <h2 style="font-size: 1.1rem;">Entlastungsbetrag</h2>
        <p class="text-sm" style="opacity: 0.9;">Budget nach &sect; 45b SGB XI &mdash; 131,00 &euro;/Monat</p>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button class="btn btn-primary" onclick="EntlastungModule.datenLaden()" style="flex:1;">
          Daten aktualisieren
        </button>
      </div>

      <div id="entlastungInfo" class="text-sm text-muted" style="margin-bottom:8px;"></div>

      <div id="entlBezugsjahrContainer" class="hidden">
        <div class="form-group" style="margin-bottom:8px;">
          <label>Bezugsjahr</label>
          <select id="entlBezugsjahr" class="form-control" onchange="EntlastungModule.bezugsjahrGeaendert()">
            <option value="2025">2025</option>
            <option value="2026">2026</option>
            <option value="2027">2027 (Prognose)</option>
          </select>
        </div>

        <div class="btn-group" style="gap:4px;margin-bottom:8px;">
          <button class="btn btn-sm btn-primary entl-filter-btn" data-filter="alle" onclick="EntlastungModule.filterAnwenden('alle')">Alle</button>
          <button class="btn btn-sm btn-outline entl-filter-btn" data-filter="uebertrag" onclick="EntlastungModule.filterAnwenden('uebertrag')">Mit Übertrag</button>
          <button class="btn btn-sm btn-outline entl-filter-btn" data-filter="ausgeschoepft" onclick="EntlastungModule.filterAnwenden('ausgeschoepft')">Ausgeschöpft</button>
        </div>
      </div>

      <div id="entlastungListe"></div>

      <!-- Detail-Overlay -->
      <div id="entlastungDetailOverlay" class="hidden" style="position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:500;overflow-y:auto;padding:16px;">
        <div id="entlastungDetailContent" style="max-width:600px;margin:0 auto;"></div>
      </div>
    `;

    // Default-Bezugsjahr setzen
    this.bezugsjahr = new Date().getFullYear();
    const selectEl = document.getElementById('entlBezugsjahr');
    if (selectEl) selectEl.value = String(this.bezugsjahr);

    // Gecachte Daten laden falls vorhanden
    await this.ausCacheLaden();
  },

  /**
   * Gecachte Ergebnisdaten aus IndexedDB laden und anzeigen
   */
  async ausCacheLaden() {
    try {
      const cached = await DB.settingLesen('entlastung_cache');
      if (cached) {
        this.daten = JSON.parse(cached);
        const zeitstempel = await DB.settingLesen('entlastung_cache_zeit');
        const detailCacheRaw = await DB.settingLesen('entlastung_details_cache');
        const detailCache = detailCacheRaw ? JSON.parse(detailCacheRaw) : {};
        const anzahlImCache = Object.keys(detailCache).length;

        // API-Cache aus gespeicherten Details rekonstruieren fuer Bezugsjahr-Wechsel
        if (detailCacheRaw && !this._apiCache) {
          // Voucher-Liste aus dem Detail-Cache rekonstruieren
          const vouchers = Object.entries(detailCache).map(([id, detail]) => ({
            id,
            voucherDate: detail.voucherDate,
            _voucherStatus: 'paid'
          }));
          this._apiCache = { relevanteRechnungen: vouchers, cache: detailCache };
        }
        const infoEl = document.getElementById('entlastungInfo');
        if (infoEl && zeitstempel) {
          infoEl.textContent = 'Stand: ' + new Date(zeitstempel).toLocaleString('de-DE') + ' | ' + anzahlImCache + ' Rechnungen im Cache';
        }
        const bjContainer = document.getElementById('entlBezugsjahrContainer');
        if (bjContainer) bjContainer.classList.remove('hidden');
        this.uebersichtAnzeigen(this.daten);
      } else {
        const listeEl = document.getElementById('entlastungListe');
        if (listeEl) {
          listeEl.innerHTML = '<div class="card text-center text-muted text-sm">Noch keine Daten. Bitte "Daten aktualisieren" klicken.</div>';
        }
      }
    } catch (e) {
      console.warn('Entlastung Cache-Fehler:', e);
    }
  },

  /**
   * Rechnungen aus Lexoffice laden mit inkrementellem Cache.
   * Nur fuer neue Rechnungen werden Details per API geholt,
   * bereits gecachte Rechnungen werden uebersprungen.
   */
  async datenLaden() {
    const listeEl = document.getElementById('entlastungListe');
    const infoEl = document.getElementById('entlastungInfo');

    // Lexoffice initialisieren
    if (!LexofficeAPI.istKonfiguriert()) {
      await LexofficeAPI.init();
    }
    if (!LexofficeAPI.istKonfiguriert()) {
      App.toast('Lexoffice nicht konfiguriert. Bitte API-Key in Einstellungen hinterlegen.', 'error');
      return;
    }

    listeEl.innerHTML = '<div class="card text-center"><div class="spinner"></div> Lade Rechnungsliste...</div>';
    App.toast('Lade Rechnungsliste aus Lexoffice...', 'info');

    try {
      const jetzt = new Date();
      const aktuellesJahr = jetzt.getFullYear();
      const vorjahr = aktuellesJahr - 1;

      // 1. Voucherlist laden (schnell, nur 2-4 Calls fuer open + paid)
      const alleVouchers = [];

      for (const status of ['open', 'paid']) {
        let page = 0;
        let totalPages = 1;
        while (page < totalPages) {
          const result = await LexofficeAPI.request(
            `voucherlist?page=${page}&size=250&voucherType=invoice&voucherStatus=${status}`
          );
          if (result.content) {
            // Status mitspeichern fuer Cache-Invalidierung
            result.content.forEach(v => v._voucherStatus = status);
            alleVouchers.push(...result.content);
          }
          totalPages = result.totalPages || 1;
          page++;
        }
      }

      // 2. Nur relevante Rechnungen — breiter filtern um alle Bezugsjahre abzudecken
      const bezugsjahr = this.bezugsjahr || aktuellesJahr;
      const jahrMin = Math.min(vorjahr, bezugsjahr) - 2;
      const jahrMax = Math.max(aktuellesJahr, bezugsjahr);
      const relevanteRechnungen = alleVouchers.filter(r => {
        if (!r.voucherDate) return false;
        const jahr = new Date(r.voucherDate).getFullYear();
        return jahr >= jahrMin && jahr <= jahrMax;
      });

      App.toast(`${relevanteRechnungen.length} relevante Rechnungen gefunden`, 'info', 2000);

      // 3. Details-Cache laden
      const cacheRaw = await DB.settingLesen('entlastung_details_cache');
      const cache = cacheRaw ? JSON.parse(cacheRaw) : {};

      // 4. Nur neue Rechnungen Details holen (gecachte ueberspringen)
      // Offene Rechnungen immer neu laden (koennten sich geaendert haben)
      let neuGeladen = 0;
      const total = relevanteRechnungen.length;

      for (let i = 0; i < relevanteRechnungen.length; i++) {
        const r = relevanteRechnungen[i];
        const istOffen = r._voucherStatus === 'open';
        const imCache = !!cache[r.id];

        if (!imCache || istOffen) {
          // Detail per API laden
          try {
            const detail = await LexofficeAPI.request(`invoices/${r.id}`);
            if (detail && detail.lineItems) {
              cache[r.id] = {
                lineItems: detail.lineItems,
                address: detail.address || {},
                shippingConditions: detail.shippingConditions || {},
                voucherDate: detail.voucherDate || r.voucherDate
              };
              neuGeladen++;
            }
          } catch (e) {
            console.warn('Detail-Fehler fuer', r.id, e);
          }

          // Fortschritt anzeigen
          if (neuGeladen % 10 === 0) {
            listeEl.innerHTML = `<div class="card text-center"><div class="spinner"></div> Lade neue Details... ${neuGeladen} geladen</div>`;
          }
        }
      }

      // 5. Cache speichern
      await DB.settingSpeichern('entlastung_details_cache', JSON.stringify(cache));

      const anzahlImCache = Object.keys(cache).length;
      if (neuGeladen > 0) {
        App.toast(`${anzahlImCache} Rechnungen im Cache, ${neuGeladen} neu geladen`, 'success');
      } else {
        App.toast(`Alle ${anzahlImCache} Rechnungen aus Cache`, 'success');
      }

      // 6. API-Cache merken fuer Neuauswertung bei Jahreswechsel
      this._apiCache = { relevanteRechnungen, cache };

      // 7. Auswertung berechnen
      const ergebnis = await this.auswerten(this._apiCache, bezugsjahr);

      // Ergebnis-Cache speichern
      await DB.settingSpeichern('entlastung_cache', JSON.stringify(ergebnis));
      await DB.settingSpeichern('entlastung_cache_zeit', new Date().toISOString());

      this.daten = ergebnis;
      if (infoEl) {
        infoEl.textContent = 'Stand: ' + new Date().toLocaleString('de-DE') + ' | ' + anzahlImCache + ' Rechnungen im Cache, ' + neuGeladen + ' neu';
      }
      const bjContainer = document.getElementById('entlBezugsjahrContainer');
      if (bjContainer) bjContainer.classList.remove('hidden');
      this.uebersichtAnzeigen(ergebnis);

    } catch (e) {
      console.error('Fehler beim Laden der Entlastungsdaten:', e);
      App.toast('Fehler: ' + e.message, 'error', 5000);
      listeEl.innerHTML = `<div class="card text-center text-muted text-sm">Fehler beim Laden: ${this._escapeHtml(e.message)}</div>`;
    }
  },

  /**
   * Uebersichtsliste der Versicherten anzeigen
   */
  async uebersichtAnzeigen(daten) {
    const listeEl = document.getElementById('entlastungListe');
    if (!listeEl || !daten || !daten.versicherte) return;

    // Inaktive und Dienstleistungs-Kunden ausblenden (nur 'pflege' anzeigen)
    const lokaleKunden = await DB.alleKunden();
    const kundenTypMap = {};
    for (const k of lokaleKunden) {
      kundenTypMap[k.name.toLowerCase()] = k.kundentyp || 'pflege';
    }

    const namen = Object.keys(daten.versicherte)
      .filter(name => {
        const typ = kundenTypMap[name.toLowerCase()];
        // Nur explizit als 'pflege' bekannte Kunden anzeigen
        if (typ !== 'pflege') return false;
        // Sachbegriffe rausfiltern (keine echten Personen)
        const lower = name.toLowerCase();
        if (lower.includes('reinigung') || lower.includes('außenanlagen') || lower.includes('pflege von') || lower.startsWith('erläuterung')) return false;
        // Filter anwenden
        const v = daten.versicherte[name];
        if (this.aktuellerFilter === 'uebertrag' && v.verfuegbarerUebertrag <= 0) return false;
        if (this.aktuellerFilter === 'ausgeschoepft' && v.verfuegbarerUebertrag > 0) return false;
        return true;
      })
      .sort((a, b) => {
        const ua = daten.versicherte[a].verfuegbarerUebertrag;
        const ub = daten.versicherte[b].verfuegbarerUebertrag;
        // Versicherte mit 0 Uebertrag ans Ende
        if (ua === 0 && ub === 0) return a.localeCompare(b);
        if (ua === 0) return 1;
        if (ub === 0) return -1;
        // Sonst absteigend nach Uebertrag
        return ub - ua;
      });

    if (namen.length === 0) {
      listeEl.innerHTML = '<div class="card text-center text-muted text-sm">Keine Kassenrechnungen gefunden.</div>';
      return;
    }

    listeEl.innerHTML = namen.map(name => {
      const v = daten.versicherte[name];
      return `
        <div class="card" onclick="EntlastungModule.detailAnzeigen('${this._escapeHtml(name)}')" style="cursor:pointer;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-weight:600;">${this._escapeHtml(name)}</div>
              <div class="text-sm text-muted">${this._escapeHtml(v.kasse || 'Pflegekasse')}</div>
            </div>
            <div style="text-align:right;">
              <div class="text-xs" style="color:var(--danger);">Verfall 30.06.?</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  /**
   * Auswertung aus API-Cache-Daten berechnen fuer ein gegebenes Bezugsjahr.
   * Wird sowohl von datenLaden() als auch von bezugsjahrGeaendert() aufgerufen.
   */
  async auswerten(apiCache, bezugsjahr) {
    const aktuellesJahr = bezugsjahr;
    const vorjahr = bezugsjahr - 1;

    const versicherteDaten = {};

    for (const voucher of apiCache.relevanteRechnungen) {
      const detail = apiCache.cache[voucher.id];
      if (!detail || !detail.lineItems || !detail.lineItems.length) continue;

      const shipping = detail.shippingConditions || {};
      const leistungsEnde = shipping.shippingEndDate
        ? new Date(shipping.shippingEndDate)
        : new Date(detail.voucherDate || voucher.voucherDate);
      const rechnungsJahr = leistungsEnde.getFullYear();
      const rechnungsMonat = leistungsEnde.getMonth();

      for (const item of detail.lineItems) {
        const name = (item.name || '').trim();
        const nameLower = name.toLowerCase();
        if (!name || nameLower === 'alltagshilfe'
            || nameLower.includes('reinigung') || nameLower.includes('außenanlagen')
            || nameLower.includes('pflege von') || nameLower.startsWith('erläuterung')) continue;

        const betrag = item.lineItemAmount || 0;
        if (betrag <= 0) continue;

        if (!versicherteDaten[name]) {
          versicherteDaten[name] = {
            vorjahr: {},
            laufend: {},
            kasse: ''
          };
        }

        if (detail.address && detail.address.name) {
          versicherteDaten[name].kasse = detail.address.name;
        }

        if (rechnungsJahr === vorjahr) {
          versicherteDaten[name].vorjahr[rechnungsMonat] =
            (versicherteDaten[name].vorjahr[rechnungsMonat] || 0) + betrag;
        } else if (rechnungsJahr === aktuellesJahr) {
          versicherteDaten[name].laufend[rechnungsMonat] =
            (versicherteDaten[name].laufend[rechnungsMonat] || 0) + betrag;
        }
      }
    }

    const lokaleKunden = await DB.alleKunden();

    // Kundentyp-Map: nur 'pflege' (oder Default) soll in die Berechnung
    const kundenTypMap = {};
    for (const k of lokaleKunden) {
      kundenTypMap[k.name.toLowerCase()] = k.kundentyp || 'pflege';
    }

    const ergebnis = {
      aktuellesJahr,
      vorjahr,
      versicherte: {}
    };

    for (const [name, daten] of Object.entries(versicherteDaten)) {
      // Nur explizit als 'pflege' bekannte Kunden in die Berechnung aufnehmen
      const typ = kundenTypMap[name.toLowerCase()];
      if (typ !== 'pflege') continue;

      const kunde = lokaleKunden.find(k => k.name.toLowerCase() === name.toLowerCase());

      let startMonat = 0;
      if (kunde && kunde.pflegegradSeit) {
        const seit = new Date(kunde.pflegegradSeit);
        if (seit.getFullYear() === vorjahr) startMonat = seit.getMonth();
        if (seit.getFullYear() > vorjahr) startMonat = 12;
      }
      const monateVorjahr = Math.max(0, 12 - startMonat);

      let vorjahrAbgerechnet = 0;
      for (const betrag of Object.values(daten.vorjahr)) {
        vorjahrAbgerechnet += betrag;
      }
      const vorjahrAnspruch = monateVorjahr * this.MONATLICH;

      const kundeVorleistungen = kunde ? JSON.parse(kunde.vorleistungen || '{}') : {};
      const vorleistungVorjahr = kundeVorleistungen[vorjahr] || 0;

      const uebertragVVJ = (kunde && kunde.uebertragVorvorjahr) || 0;

      const vorjahrRest = Math.max(0, vorjahrAnspruch + uebertragVVJ - vorleistungVorjahr - vorjahrAbgerechnet);

      let laufendAbgerechnet = 0;
      let ueberziehungGesamt = 0;
      for (const betrag of Object.values(daten.laufend)) {
        laufendAbgerechnet += betrag;
        if (betrag > this.MONATLICH) {
          ueberziehungGesamt += betrag - this.MONATLICH;
        }
      }
      const laufendAnspruch = Object.keys(daten.laufend).length > 0
        ? (Math.max(...Object.keys(daten.laufend).map(Number)) + 1) * this.MONATLICH
        : 0;

      const verfuegbarerUebertrag = Math.max(0, vorjahrRest - ueberziehungGesamt);

      ergebnis.versicherte[name] = {
        kasse: daten.kasse,
        vorjahr: daten.vorjahr,
        laufend: daten.laufend,
        vorjahrAbgerechnet,
        vorjahrRest,
        laufendAbgerechnet,
        ueberziehungGesamt,
        verfuegbarerUebertrag
      };
    }

    return ergebnis;
  },

  /**
   * Bezugsjahr geaendert: Auswertung mit neuem Jahr neu berechnen (ohne API-Reload)
   */
  async bezugsjahrGeaendert() {
    const selectEl = document.getElementById('entlBezugsjahr');
    if (!selectEl) return;
    this.bezugsjahr = parseInt(selectEl.value, 10);

    if (!this._apiCache) {
      App.toast('Bitte zuerst Daten aktualisieren', 'info');
      return;
    }

    const ergebnis = await this.auswerten(this._apiCache, this.bezugsjahr);

    await DB.settingSpeichern('entlastung_cache', JSON.stringify(ergebnis));

    this.daten = ergebnis;
    this.uebersichtAnzeigen(ergebnis);
  },

  /**
   * Filter auf die Versichertenliste anwenden
   */
  filterAnwenden(filter) {
    this.aktuellerFilter = filter;
    // Button-Styling aktualisieren
    document.querySelectorAll('.entl-filter-btn').forEach(btn => {
      if (btn.dataset.filter === filter) {
        btn.className = 'btn btn-sm btn-primary entl-filter-btn';
      } else {
        btn.className = 'btn btn-sm btn-outline entl-filter-btn';
      }
    });
    if (this.daten) {
      this.uebersichtAnzeigen(this.daten);
    }
  },

  /**
   * Monatsdetails fuer einen Versicherten im Overlay anzeigen
   */
  async detailAnzeigen(name) {
    const overlay = document.getElementById('entlastungDetailOverlay');
    const content = document.getElementById('entlastungDetailContent');
    if (!overlay || !content || !this.daten) return;

    const v = this.daten.versicherte[name];
    if (!v) return;

    overlay.classList.remove('hidden');

    // Lokalen Kunden fuer Anpassungsfelder laden
    const lokaleKunden = await DB.alleKunden();
    const kunde = lokaleKunden.find(k => k.name.toLowerCase() === name.toLowerCase());
    const pflegegradSeit = (kunde && kunde.pflegegradSeit) || '';
    const uebertragVorvorjahr = (kunde && kunde.uebertragVorvorjahr) || 0;
    const vorleistungenObj = kunde ? JSON.parse(kunde.vorleistungen || '{}') : {};
    const aktJahr = this.daten.aktuellesJahr;
    const vjahr = this.daten.vorjahr;
    const vorleistungenVorjahr = vorleistungenObj[vjahr] || 0;
    const vorleistungenAktuell = vorleistungenObj[aktJahr] || 0;

    const monatsNamen = ['Jan', 'Feb', 'M\u00e4r', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    const vorjahr = this.daten.vorjahr;
    const aktuellesJahr = this.daten.aktuellesJahr;

    // Vorjahr-Tabelle — Anspruch ab pflegegradSeit beruecksichtigen
    let startMonatVorjahr = 0; // 0-basiert, Default: ab Januar
    if (kunde && kunde.pflegegradSeit) {
      const seit = new Date(kunde.pflegegradSeit);
      if (seit.getFullYear() === vorjahr) startMonatVorjahr = seit.getMonth();
      if (seit.getFullYear() > vorjahr) startMonatVorjahr = 12; // kein Anspruch im Vorjahr
    }

    let vorjahrRows = '';
    let vorjahrAnspruchSumme = 0;
    let vorjahrAbgerechnetSumme = 0;
    for (let m = 0; m < 12; m++) {
      const hatAnspruch = m >= startMonatVorjahr;
      const monatsAnspruch = hatAnspruch ? this.MONATLICH : 0;
      const abgerechnet = v.vorjahr[m] || 0;
      const rest = monatsAnspruch - abgerechnet;
      vorjahrAnspruchSumme += monatsAnspruch;
      vorjahrAbgerechnetSumme += abgerechnet;
      const restStyle = rest < 0 ? 'color:var(--danger);font-weight:600;' : '';
      const anspruchStyle = !hatAnspruch ? 'color:var(--gray-400);' : '';
      vorjahrRows += `
        <tr>
          <td>${monatsNamen[m]} ${vorjahr}</td>
          <td style="text-align:right;${anspruchStyle}">${this._betrag(monatsAnspruch)}</td>
          <td style="text-align:right;">${this._betrag(abgerechnet)}</td>
          <td style="text-align:right;${restStyle}">${this._betrag(rest)}</td>
        </tr>
      `;
    }
    const vorjahrRestSumme = vorjahrAnspruchSumme - vorjahrAbgerechnetSumme;

    // Laufendes Jahr Tabelle — Anspruch ab pflegegradSeit beruecksichtigen
    let startMonatAktuell = 0;
    if (kunde && kunde.pflegegradSeit) {
      const seit = new Date(kunde.pflegegradSeit);
      if (seit.getFullYear() === aktuellesJahr) startMonatAktuell = seit.getMonth();
      if (seit.getFullYear() > aktuellesJahr) startMonatAktuell = 12;
    }

    let laufendRows = '';
    let laufendAnspruchSumme = 0;
    let laufendAbgerechnetSumme = 0;
    const bisMonat = new Date().getFullYear() === aktuellesJahr ? new Date().getMonth() : 11;
    // Bei Prognose-Jahren (Zukunft): alle 12 Monate anzeigen (bisMonat = 11 durch obige Logik)
    for (let m = 0; m <= bisMonat; m++) {
      const hatAnspruch = m >= startMonatAktuell;
      const monatsAnspruch = hatAnspruch ? this.MONATLICH : 0;
      const abgerechnet = v.laufend[m] || 0;
      const rest = monatsAnspruch - abgerechnet;
      laufendAnspruchSumme += monatsAnspruch;
      laufendAbgerechnetSumme += abgerechnet;
      const restStyle = rest < 0 ? 'color:var(--danger);font-weight:600;' : '';
      const anspruchStyle = !hatAnspruch ? 'color:var(--gray-400);' : '';
      laufendRows += `
        <tr>
          <td>${monatsNamen[m]} ${aktuellesJahr}</td>
          <td style="text-align:right;${anspruchStyle}">${this._betrag(monatsAnspruch)}</td>
          <td style="text-align:right;">${this._betrag(abgerechnet)}</td>
          <td style="text-align:right;${restStyle}">${this._betrag(rest)}</td>
        </tr>
      `;
    }
    const laufendRestSumme = laufendAnspruchSumme - laufendAbgerechnetSumme;

    // Ergebnis-Bereich
    let ergebnisHtml = '';
    if (v.ueberziehungGesamt > 0 && v.vorjahrRest > 0) {
      ergebnisHtml += `
        <div class="text-sm" style="color:var(--danger);margin-bottom:8px;">
          \u00dcberziehung ${this._betrag(v.ueberziehungGesamt)} vom Vorjahres-\u00dcbertrag abgezogen
        </div>
      `;
    }

    const verfallDatum = `30.06.${aktuellesJahr}`;
    const uebertragStyle = v.verfuegbarerUebertrag > 0 ? 'color:var(--success);' : '';

    // Anpassungen-Info-Zeilen im Ergebnis
    let anpassungenInfo = '';
    if (uebertragVorvorjahr > 0) {
      anpassungenInfo += `<div class="text-sm" style="margin-top:4px;">\u00dcbertrag Vorvorjahr: +${this._betrag(uebertragVorvorjahr)}</div>`;
    }
    if (vorleistungenVorjahr > 0) {
      anpassungenInfo += `<div class="text-sm" style="margin-top:4px;">Vorleistungen ${vorjahr}: -${this._betrag(vorleistungenVorjahr)}</div>`;
    }
    if (vorleistungenAktuell > 0) {
      anpassungenInfo += `<div class="text-sm" style="margin-top:4px;">Vorleistungen ${aktuellesJahr}: -${this._betrag(vorleistungenAktuell)}</div>`;
    }

    const escapedName = this._escapeHtml(name).replace(/'/g, "\\'");

    content.innerHTML = `
      <div class="card" style="background:white;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div>
            <h3 style="margin:0;font-size:1.1rem;">${this._escapeHtml(name)}</h3>
            <div class="text-sm text-muted">${this._escapeHtml(v.kasse || 'Pflegekasse')}</div>
          </div>
          <button class="btn btn-secondary" onclick="EntlastungModule.detailSchliessen()" style="padding:6px 12px;">
            Schlie\u00dfen
          </button>
        </div>

        <!-- Vorjahr -->
        <h4 style="margin:12px 0 8px;font-size:0.9rem;color:var(--gray-600);">VORJAHR ${vorjahr}</h4>
        <div style="overflow-x:auto;">
          <table style="width:100%;font-size:0.8rem;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:2px solid var(--gray-200);">
                <th style="text-align:left;padding:4px;">Monat</th>
                <th style="text-align:right;padding:4px;">Anspruch</th>
                <th style="text-align:right;padding:4px;">Abgerechnet</th>
                <th style="text-align:right;padding:4px;">Rest</th>
              </tr>
            </thead>
            <tbody>
              ${vorjahrRows}
              <tr style="border-top:2px solid var(--gray-300);font-weight:700;">
                <td style="padding:4px;">Summe</td>
                <td style="text-align:right;padding:4px;">${this._betrag(vorjahrAnspruchSumme)}</td>
                <td style="text-align:right;padding:4px;">${this._betrag(vorjahrAbgerechnetSumme)}</td>
                <td style="text-align:right;padding:4px;">${this._betrag(vorjahrRestSumme)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        ${v.vorjahrRest > 0 ? `
          <div class="text-sm" style="margin:8px 0;padding:6px;background:var(--gray-50);border-radius:6px;">
            \u00dcbertrag &rarr; verf\u00e4llt ${verfallDatum}: <strong>${this._betrag(v.vorjahrRest)}</strong>
          </div>
        ` : ''}

        <!-- Laufendes Jahr -->
        <h4 style="margin:16px 0 8px;font-size:0.9rem;color:var(--gray-600);">LAUFENDES JAHR ${aktuellesJahr}</h4>
        <div style="overflow-x:auto;">
          <table style="width:100%;font-size:0.8rem;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:2px solid var(--gray-200);">
                <th style="text-align:left;padding:4px;">Monat</th>
                <th style="text-align:right;padding:4px;">Anspruch</th>
                <th style="text-align:right;padding:4px;">Abgerechnet</th>
                <th style="text-align:right;padding:4px;">Rest</th>
              </tr>
            </thead>
            <tbody>
              ${laufendRows}
              <tr style="border-top:2px solid var(--gray-300);font-weight:700;">
                <td style="padding:4px;">Summe</td>
                <td style="text-align:right;padding:4px;">${this._betrag(laufendAnspruchSumme)}</td>
                <td style="text-align:right;padding:4px;">${this._betrag(laufendAbgerechnetSumme)}</td>
                <td style="text-align:right;padding:4px;${laufendRestSumme < 0 ? 'color:var(--danger);' : ''}">${this._betrag(laufendRestSumme)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        ${ergebnisHtml}

        <!-- Ergebnis -->
        <div style="margin-top:16px;padding:12px;background:var(--gray-50);border-radius:8px;border-left:4px solid var(--primary);">
          <h4 style="margin:0 0 8px;font-size:0.9rem;">ERGEBNIS</h4>
          <div style="${uebertragStyle}font-weight:600;">
            \u00dcbertrag ${vorjahr} verf\u00fcgbar: ${this._betrag(v.verfuegbarerUebertrag)}
            ${v.verfuegbarerUebertrag > 0 ? `<span class="text-xs" style="color:var(--danger);"> (verf\u00e4llt ${verfallDatum})</span>` : ''}
          </div>
          ${anpassungenInfo}
        </div>
      </div>

      <!-- Anpassungsfelder -->
      <div class="card" style="background:white;margin-top:12px;">
        <div style="font-weight:600;margin-bottom:8px;">Anpassungen</div>

        <div class="form-group">
          <label>Pflegegrad seit</label>
          <input type="date" id="entlPflegegradSeit" class="form-control" value="${pflegegradSeit}">
        </div>

        <div class="form-group">
          <label>\u00dcbertrag aus VORVORJAHR (z.B. aus ${vorjahr - 1}, verf\u00fcgbar Jan\u2013Jun ${vorjahr})</label>
          <div style="display:flex;gap:4px;align-items:flex-end;">
            <input type="number" id="entlUebertragVorvorjahr" class="form-control" style="flex:1;" step="0.01" value="${uebertragVorvorjahr}" placeholder="0,00">
            <button class="btn btn-sm btn-outline" onclick="App.miniRechner('entlUebertragVorvorjahr')" style="padding:8px;">🔢</button>
          </div>
        </div>

        <div class="form-group">
          <label>Vorleistungen anderer Anbieter VORJAHR (${vorjahr})</label>
          <div style="display:flex;gap:4px;align-items:flex-end;">
            <input type="number" id="entlVorleistungenVorjahr" class="form-control" style="flex:1;" step="0.01" value="${vorleistungenVorjahr}" placeholder="0,00">
            <button class="btn btn-sm btn-outline" onclick="App.miniRechner('entlVorleistungenVorjahr')" style="padding:8px;">🔢</button>
          </div>
        </div>

        <div class="form-group">
          <label>Vorleistungen anderer Anbieter AKTUELLES JAHR (${aktuellesJahr})</label>
          <div style="display:flex;gap:4px;align-items:flex-end;">
            <input type="number" id="entlVorleistungenAktuell" class="form-control" style="flex:1;" step="0.01" value="${vorleistungenAktuell}" placeholder="0,00">
            <button class="btn btn-sm btn-outline" onclick="App.miniRechner('entlVorleistungenAktuell')" style="padding:8px;">🔢</button>
          </div>
        </div>

        <button class="btn btn-primary btn-block" onclick="EntlastungModule.anpassungenSpeichern('${escapedName}')">
          Speichern & neu berechnen
        </button>
      </div>
    `;
  },

  /**
   * Anpassungsfelder speichern und Entlastungsdaten neu berechnen
   */
  async anpassungenSpeichern(versicherterName) {
    const alleKunden = await DB.alleKunden();
    const kunde = alleKunden.find(k => k.name.toLowerCase() === versicherterName.toLowerCase());
    if (!kunde) { App.toast('Kunde nicht gefunden', 'error'); return; }

    const pflegegradSeit = document.getElementById('entlPflegegradSeit').value || null;
    const uebertragVorvorjahr = parseFloat(document.getElementById('entlUebertragVorvorjahr').value) || 0;
    const vorleistungenVorjahr = parseFloat(document.getElementById('entlVorleistungenVorjahr').value) || 0;
    const vorleistungenAktuell = parseFloat(document.getElementById('entlVorleistungenAktuell').value) || 0;

    const aktJahr = this.daten.aktuellesJahr;
    const vorjahr = this.daten.vorjahr;
    const vorleistungen = JSON.parse(kunde.vorleistungen || '{}');
    vorleistungen[vorjahr] = vorleistungenVorjahr;
    vorleistungen[aktJahr] = vorleistungenAktuell;

    await DB.kundeAktualisieren(kunde.id, {
      pflegegradSeit,
      uebertragVorvorjahr,
      vorleistungen: JSON.stringify(vorleistungen)
    });

    App.toast('Anpassungen gespeichert', 'success');
    // Neu berechnen — Cache invalidieren und neu laden
    await DB.settingSpeichern('entlastung_cache', null);
    this.detailSchliessen();
    await this.datenLaden();
  },

  /**
   * Detail-Overlay schliessen
   */
  detailSchliessen() {
    const overlay = document.getElementById('entlastungDetailOverlay');
    if (overlay) overlay.classList.add('hidden');
  },

  // --- Hilfsfunktionen ---

  /**
   * Betrag formatieren mit Komma und Euro-Zeichen
   */
  _betrag(wert) {
    const prefix = wert < 0 ? '-' : '';
    return prefix + Math.abs(wert).toFixed(2).replace('.', ',') + ' \u20ac';
  },

  /**
   * HTML escapen
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
};

// Initialisierung
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  EntlastungModule.init();
});
