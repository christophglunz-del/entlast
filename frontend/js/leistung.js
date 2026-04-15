/**
 * Leistungsnachweis-Modul für Susi's Alltagshilfe
 * Einzelne Tage sammeln, einmal pro Monat unterschreiben
 */

const LeistungModule = {
  signaturePad: null,
  sigPadVersicherter: null,

  async init() {
    const params = new URLSearchParams(window.location.search);
    this._preselectedKundeId = params.get('kundeId');
    this._preselectedDatum = params.get('datum');
    this._preselectedVon = params.get('von');
    this._preselectedBis = params.get('bis');
    if (params.get('filter') === 'offen') {
      this._monatsFilter = 'alle';
      this._filterOffen = true;
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (this._preselectedKundeId) {
      // URL-Parameter verbrauchen, damit Reload nicht erneut triggert
      window.history.replaceState({}, '', window.location.pathname);
      await this.neueLeistung();
    } else {
      await this.listeAnzeigen();
    }
    // Google-Kalender im Hintergrund synchronisieren
    apiFetch('/termine/google-sync', { method: 'POST' }).catch(() => {});
  },

  _fabAktualisieren() {
    const fab = document.getElementById('leistungFab');
    if (fab) fab.style.display = this._ansicht === 'liste' ? '' : 'none';
  },

  async listeAnzeigen() {
    this._ansicht = 'liste';
    this._fabAktualisieren();
    const container = document.getElementById('leistungListe');
    if (!container) return;

    const leistungen = await DB.alleLeistungen();

    // Kunden laden (wird auch für Termine-Box benötigt)
    const kunden = await DB.alleKunden();
    const kundenMap = {};
    kunden.forEach(k => kundenMap[k.id] = k);

    // Heutige Termine laden und als Leistungs-Vorschläge rendern
    const heute = App.heute();
    let termineBoxHtml = '';
    try {
      const heuteTermine = await DB.termineFuerDatum(heute);
      if (heuteTermine && heuteTermine.length > 0) {
        // Prüfe welche Kunden heute schon eine Leistung haben
        const heuteLeistungen = leistungen.filter(l => l.datum === heute);
        const heuteKundenIds = new Set(heuteLeistungen.map(l => l.kundeId));

        let terminZeilen = '';
        for (const t of heuteTermine) {
          if (t._geburtstag) continue; // Geburtstage überspringen
          const zeitStr = `${App.formatZeit(t.startzeit)}${t.endzeit ? '-' + App.formatZeit(t.endzeit) : ''}`;
          const kunde = t.kundeId ? kundenMap[t.kundeId] : null;
          const name = kunde ? this.escapeHtml(App.kundenName(kunde)) : (t.titel ? this.escapeHtml(t.titel) : 'Termin');
          const bereitsErfasst = t.kundeId && heuteKundenIds.has(t.kundeId);

          terminZeilen += `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(0,0,0,0.06);">
              <span style="font-size:0.85rem;color:#555;min-width:90px;">${zeitStr}</span>
              <span style="font-weight:500;flex:1;">${name}</span>
              ${bereitsErfasst
                ? '<span style="color:#2e7d32;font-size:0.85rem;white-space:nowrap;">✓ erfasst</span>'
                : (t.kundeId
                  ? `<button class="btn btn-sm btn-primary" style="white-space:nowrap;" onclick="LeistungModule.neueLeistungAusTermin(${t.id})">→ Leistung</button>`
                  : '')
              }
            </div>`;
        }

        if (terminZeilen) {
          termineBoxHtml = `
            <div class="card" style="background:#e3f2fd;margin-bottom:12px;">
              <div style="font-weight:600;margin-bottom:8px;">📅 Heute</div>
              ${terminZeilen}
            </div>`;
        }
      }
    } catch (e) {
      console.warn('Heutige Termine laden fehlgeschlagen:', e);
    }

    if (leistungen.length === 0) {
      container.innerHTML = `
        ${termineBoxHtml}
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <p>Noch keine Leistungsnachweise</p>
          <button class="btn btn-primary" onclick="LeistungModule.neueLeistung()">
            + Neuer Eintrag
          </button>
        </div>
      `;
      return;
    }

    // Nach Monat gruppieren
    const grouped = {};
    for (const l of leistungen) {
      const key = l.datum ? l.datum.substring(0, 7) : 'unbekannt';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(l);
    }

    // Lokale Rechnungen laden für "Abgerechnet"-Badge
    const rechnungen = await DB.alleRechnungen();
    const rechnungMap = {};
    for (const r of rechnungen) {
      if (r.kundeId && r.monat && r.jahr) {
        rechnungMap[`${r.kundeId}-${r.monat}-${r.jahr}`] = r;
      }
    }

    // Fax-Status prüfen wenn wartende Faxe vorhanden
    const hatWartende = rechnungen.some(r => r.versandArt === 'fax_warteschlange' || r.versandArt === 'faxWarteschlange');
    if (hatWartende) {
      apiFetch('/lexoffice/fax-status-pruefen', { method: 'POST' }).then(r => {
        if (r.aktualisiert > 0) this.listeAnzeigen();
      }).catch(() => {});
      // Poll alle 30s
      if (this._faxPollLeistung) clearInterval(this._faxPollLeistung);
      this._faxPollLeistung = setInterval(async () => {
        try {
          const r = await apiFetch('/lexoffice/fax-status-pruefen', { method: 'POST' });
          if (r.aktualisiert > 0) { clearInterval(this._faxPollLeistung); this._faxPollLeistung = null; this.listeAnzeigen(); }
        } catch(e) {}
      }, 30000);
    }

    // Monatsfilter
    const monate = Object.keys(grouped).sort().reverse();
    const aktuellerFilter = this._monatsFilter || monate[0];
    if (!this._monatsFilter) this._monatsFilter = aktuellerFilter;

    let html = termineBoxHtml + `
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        ${monate.map(m => {
          const [j, mo] = m.split('-');
          const aktiv = m === aktuellerFilter;
          return `<button class="btn btn-sm ${aktiv ? 'btn-primary' : 'btn-outline'}"
            onclick="LeistungModule._monatsFilter='${m}'; LeistungModule.listeAnzeigen();">
            ${App.monatsName(parseInt(mo))} ${j}</button>`;
        }).join('')}
        <button class="btn btn-sm ${!this._monatsFilter || this._monatsFilter === 'alle' ? 'btn-primary' : 'btn-outline'}"
          onclick="LeistungModule._monatsFilter='alle'; LeistungModule._filterOffen=false; LeistungModule.listeAnzeigen();">
          Alle</button>
        <button class="btn btn-sm ${this._filterOffen ? 'btn-primary' : 'btn-outline'}" style="background:${this._filterOffen ? '#dc2626' : ''};border-color:${this._filterOffen ? '#dc2626' : ''};"
          onclick="LeistungModule._monatsFilter='alle'; LeistungModule._filterOffen=!LeistungModule._filterOffen; LeistungModule.listeAnzeigen();">
          Offen</button>
      </div>
    `;

    for (const [monat, eintraege] of Object.entries(grouped)) {
      if (aktuellerFilter !== 'alle' && monat !== aktuellerFilter) continue;
      const [j, m] = monat.split('-');
      const mi = parseInt(m);
      const ji = parseInt(j);

      html += `
        <div class="section-title">
          <span class="icon">📅</span> ${App.monatsName(mi)} ${j}
        </div>
      `;

      // Pro Kunde in diesem Monat: Karte anzeigen
      let kundenIds = [...new Set(eintraege.map(l => l.kundeId))];
      // "Offen"-Filter: nur Kunden ohne Rechnung/Versand
      if (this._filterOffen) {
        kundenIds = kundenIds.filter(kid => {
          const re = rechnungMap[`${kid}-${mi}-${ji}`];
          return !re || !re.versandArt;
        });
      }
      for (const kid of kundenIds) {
        const k = kundenMap[kid];
        if (!k) continue;
        const kundeEintraege = eintraege.filter(l => l.kundeId === kid);
        const anzahl = kundeEintraege.length;
        let gesamtStunden = 0;
        let gesamtBetrag = 0;
        for (const l of kundeEintraege) {
          const std = App.stundenBerechnen(l.startzeit, l.endzeit);
          gesamtStunden += std;
          gesamtBetrag += App.betragBerechnen(std);
        }
        const alleUnterschrieben = kundeEintraege.every(
          l => l.unterschriftVersicherter
        );

        const re = rechnungMap[`${kid}-${mi}-${ji}`];
        const versandArten = ['fax', 'brief', 'uebergabe', 'serviceportal', 'manuell'];
        const istVersendet = re && versandArten.includes(re.versandArt);
        const istWarteschlange = re && re.versandArt === 'fax_warteschlange';
        const istAbgerechnet = re && (re.lexofficeId || re.versandArt);
        const zeileFarbe = istVersendet ? 'border-left:4px solid #2e7d32;'
          : istWarteschlange ? 'border-left:4px solid #2196f3;'
          : istAbgerechnet ? 'border-left:4px solid #f59e0b;'
          : 'border-left:4px solid #dc2626;';

        html += `
          <div class="list-item" onclick="LeistungModule.monatsUebersichtAnzeigen(${kid}, ${mi}, ${ji})" style="${zeileFarbe}">
            <div class="item-avatar">${App.initialen(k.name, k.vorname)}</div>
            <div class="item-content">
              <div class="item-title">${this.escapeHtml(App.kundenName(k))}</div>
              <div class="item-subtitle">
                ${anzahl} ${anzahl === 1 ? 'Eintrag' : 'Einträge'} |
                ${gesamtStunden.toFixed(1).replace('.', ',')} Std. |
                ${App.formatBetrag(gesamtBetrag)}
              </div>
            </div>
            <div class="item-action" style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
              ${alleUnterschrieben
                ? '<span class="text-xs" style="color:#2e7d32;">✓ Unterschrieben</span>'
                : '<span class="text-xs" style="color:#f59e0b;">✍ Unterschrift fehlt</span>'
              }
              ${(() => {
                const re = rechnungMap[`${kid}-${mi}-${ji}`];
                const btn = (bg, label, onclick) =>
                  `<button onclick="event.stopPropagation(); ${onclick}" class="btn btn-sm" style="font-size:0.75rem;background:${bg};color:#fff;border:none;">${label}</button>`;
                const labels = {fax:'📠 RE gefaxt', fax_warteschlange:'📠 Fax wird gesendet', brief:'✉️ RE Brief', uebergabe:'🤝 RE übergeben', serviceportal:'🌐 RE Portal', manuell:'✋ RE manuell'};
                if (re && labels[re.versandArt]) {
                  const bg = re.versandArt === 'fax_warteschlange' ? '#2196f3' : '#2e7d32';
                  const onclick = re.lexofficeId ? `LeistungModule.rechnungDetailAnzeigen('${re.lexofficeId}')` : '';
                  return btn(bg, labels[re.versandArt], onclick);
                }
                if (re && re.lexofficeId) {
                  return btn('#f59e0b', '💰 RE erstellt', `LeistungModule.rechnungDetailAnzeigen('${re.lexofficeId}')`);
                }
                return btn('#dc2626', '💰 RE erstellen', `LeistungModule.rechnungErstellenOverlay(${kid}, ${mi}, ${ji})`);
              })()}
            </div>
          </div>
        `;
      }
    }

    container.innerHTML = html;
  },

  leistungsArtenKurz(l) {
    const arr = [];
    if (l.betreuung) arr.push('Betr.');
    if (l.alltagsbegleitung) arr.push('Alltag');
    if (l.pflegebegleitung) arr.push('Pflege');
    if (l.hauswirtschaft) arr.push('Hauswi.');
    if (l.objektInnen) arr.push('Obj.innen');
    if (l.objektAussen) arr.push('Obj.außen');
    if (l.freitext) arr.push(l.freitext.substring(0, 20));
    return arr.join(', ') || '-';
  },

  leistungsArtenLang(l) {
    const arr = [];
    if (l.betreuung) arr.push('Betreuung');
    if (l.alltagsbegleitung) arr.push('Alltagsbegleitung');
    if (l.pflegebegleitung) arr.push('Pflegebegleitung');
    if (l.hauswirtschaft) arr.push('Hauswirtschaft');
    if (l.objektInnen) arr.push('Reinigung innen (Objekt)');
    if (l.objektAussen) arr.push('Reinigung außen (Objekt)');
    if (l.freitext) arr.push(l.freitext);
    return arr;
  },

  async neueLeistung() {
    const kunden = await DB.alleKunden();
    if (kunden.length === 0) {
      App.toast('Bitte zuerst einen Kunden anlegen', 'error');
      return;
    }
    this.formAnzeigen(null, kunden);
    // URL-Parameter: Datum/Zeiten vorausfüllen
    if (this._preselectedDatum || this._preselectedVon || this._preselectedBis) {
      setTimeout(() => {
        if (this._preselectedDatum) {
          const d = document.getElementById('leistungDatum');
          if (d) d.value = this._preselectedDatum;
        }
        if (this._preselectedVon) {
          const s = document.getElementById('leistungStart');
          if (s) s.value = this._preselectedVon;
        }
        if (this._preselectedBis) {
          const e = document.getElementById('leistungEnde');
          if (e) e.value = this._preselectedBis;
        }
        this.zeitAktualisieren();
        this._preselectedDatum = null;
        this._preselectedVon = null;
        this._preselectedBis = null;
      }, 100);
    }
  },

  async neueLeistungAusTermin(terminId) {
    try {
      const termin = await DB.terminById(terminId);
      if (!termin) {
        App.toast('Termin nicht gefunden', 'error');
        return;
      }
      const kunden = await DB.alleKunden();
      if (kunden.length === 0) {
        App.toast('Bitte zuerst einen Kunden anlegen', 'error');
        return;
      }
      // Kunde vorauswählen und Formular als "Neuer Eintrag" öffnen
      this._preselectedKundeId = termin.kundeId ? String(termin.kundeId) : null;
      this.formAnzeigen(null, kunden);
      // Datum und Zeiten aus dem Termin übernehmen
      setTimeout(() => {
        const datumEl = document.getElementById('leistungDatum');
        const startEl = document.getElementById('leistungStart');
        const endeEl = document.getElementById('leistungEnde');
        if (datumEl && termin.datum) datumEl.value = termin.datum;
        if (startEl && termin.startzeit) startEl.value = termin.startzeit;
        if (endeEl && termin.endzeit) endeEl.value = termin.endzeit;
        this.zeitAktualisieren();
      }, 50);
    } catch (e) {
      console.error('neueLeistungAusTermin:', e);
      App.toast('Fehler beim Laden des Termins', 'error');
    }
  },

  async detailAnzeigen(id) {
    const leistung = await DB.leistungById(id);
    if (!leistung) {
      App.toast('Eintrag nicht gefunden', 'error');
      return;
    }
    const kunden = await DB.alleKunden();
    this.formAnzeigen(leistung, kunden);
  },

  formAnzeigen(leistung = null, kunden = []) {
    this._ansicht = 'formular'; this._fabAktualisieren();
    const container = document.getElementById('leistungContent');
    if (!container) return;

    const preselect = this._preselectedKundeId ? parseInt(this._preselectedKundeId) : null;
    const echteKunden = App.echteKunden(kunden);
    this._leistungKunden = echteKunden; // für Suchfilter merken
    const kundenOptions = echteKunden.map(k => {
      const selected = (leistung && leistung.kundeId === k.id) || (!leistung && preselect === k.id);
      return `<option value="${k.id}" ${selected ? 'selected' : ''}>${this.escapeHtml(App.kundenName(k))}</option>`;
    }).join('');
    if (preselect) this._preselectedKundeId = null; // einmalig verbrauchen

    // Vorgewählter Kundenname für Suchfeld
    let preselectedName = '';
    if (leistung) {
      const vk = echteKunden.find(k => k.id === leistung.kundeId);
      if (vk) preselectedName = App.kundenName(vk);
    } else if (preselect) {
      const vk = echteKunden.find(k => k.id === preselect);
      if (vk) preselectedName = App.kundenName(vk);
    }

    container.innerHTML = `
      <form id="leistungForm" onsubmit="event.preventDefault(); LeistungModule.speichern(${leistung ? leistung.id : 'null'});">
        <div class="card">
          <h3 class="card-title mb-2">${leistung ? 'Eintrag bearbeiten' : 'Neuer Leistungseintrag'}</h3>

          <div class="form-group">
            <label for="leistungKundeSearch">Kunde *</label>
            <input type="text" id="leistungKundeSearch" class="form-control" placeholder="Kunde suchen..."
                   value="${this.escapeHtml(preselectedName)}"
                   oninput="LeistungModule.kundenFiltern(this.value)"
                   onfocus="LeistungModule.kundenFiltern(this.value)"
                   autocomplete="off">
            <div id="leistungKundeResults" style="max-height:200px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:8px;display:none;background:#fff;margin-top:2px;"></div>
            <select id="leistungKunde" class="form-control" required style="display:none;">
              <option value="">-- Kunde wählen --</option>
              ${kundenOptions}
            </select>
          </div>

          <div class="form-group">
            <label for="leistungDatum">Datum *</label>
            <input type="date" id="leistungDatum" class="form-control" required
                   value="${leistung ? leistung.datum : App.heute()}">
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="leistungStart">Beginn *</label>
              <input type="time" id="leistungStart" class="form-control" required
                     value="${leistung ? leistung.startzeit : ''}"
                     onchange="LeistungModule.zeitAktualisieren()">
            </div>
            <div class="form-group">
              <label for="leistungEnde">Ende *</label>
              <input type="time" id="leistungEnde" class="form-control" required
                     value="${leistung ? leistung.endzeit : ''}"
                     onchange="LeistungModule.zeitAktualisieren()">
            </div>
          </div>

          <div id="leistungBerechnung" class="card" style="background: var(--primary-bg); margin: 8px 0;">
            <div class="d-flex justify-between">
              <span>Dauer: <strong id="leistungDauer">0,00 Std.</strong></span>
              <span>Betrag: <strong id="leistungBetrag">0,00 €</strong></span>
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-block mt-1">Speichern</button>
        </div>

        <div class="card">
          <div class="form-group">
            <label for="leistungFreitext">Leistung (optional)</label>
            <input type="text" id="leistungFreitext" class="form-control"
                   value="${leistung && leistung.freitext ? this.escapeHtml(leistung.freitext) : ''}"
                   placeholder="z.B. Betreuung, Hauswirtschaft, Gartenarbeit...">
          </div>
          <div class="form-group">
            <label for="leistungNotizen">Anmerkungen</label>
            <textarea id="leistungNotizen" class="form-control" rows="2"
                      placeholder="Optionale Anmerkungen...">${leistung ? (leistung.notizen || '') : ''}</textarea>
          </div>
        </div>

        <div class="btn-group mt-2">
          <button type="submit" class="btn btn-primary btn-block">
            Speichern
          </button>
          <button type="button" class="btn btn-secondary" onclick="LeistungModule.zurueck()">
            Zur\u00fcck
          </button>
          ${leistung ? `
            <button type="button" class="btn btn-danger btn-sm" onclick="LeistungModule.loeschen(${leistung.id})">
              Löschen
            </button>
          ` : ''}
        </div>
      </form>
    `;

    if (leistung) {
      setTimeout(() => this.zeitAktualisieren(), 50);
    }

    // GPS-Kunden-Vorschlag: nur bei neuer Leistung ohne Vorauswahl
    if (!leistung && !preselect && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&zoom=18&addressdetails=1`,
            { headers: { 'Accept-Language': 'de' } }
          );
          const data = await res.json();
          const strasse = (data.address?.road || '').toLowerCase();
          const plz = data.address?.postcode || '';

          // Kunden matchen: erst Strasse, dann PLZ
          let match = null;
          if (strasse) {
            match = echteKunden.find(k =>
              k.strasse && k.strasse.toLowerCase().includes(strasse)
            );
          }
          if (!match && plz) {
            match = echteKunden.find(k => k.plz && k.plz === plz);
          }

          if (match) {
            // Nur vorschlagen wenn User noch keinen Kunden manuell gewaehlt hat
            const select = document.getElementById('leistungKunde');
            if (select && !select.value) {
              LeistungModule.kundeAuswaehlen(match.id);
              App.toast('\uD83D\uDCCD ' + App.kundenName(match) + ' vorgeschlagen (Standort)', 'info', 3000);
            }
          }
        } catch (e) {
          console.warn('GPS-Vorschlag:', e);
        }
      }, () => {}, { timeout: 5000, enableHighAccuracy: false });
    }
  },

  // Monatsübersicht für einen Kunden anzeigen
  async monatsUebersichtAnzeigen(kundeId, monat, jahr) {
    this._ansicht = 'monatsuebersicht'; this._fabAktualisieren();
    this._letzteMonatsUebersicht = { kundeId, monat, jahr };
    const container = document.getElementById('leistungContent');
    if (!container) return;

    const kunde = await DB.kundeById(kundeId);
    if (!kunde) { App.toast('Kunde nicht gefunden', 'error'); return; }

    const alleLeistungen = await DB.leistungenFuerMonat(monat, jahr);
    const leistungen = alleLeistungen
      .filter(l => l.kundeId === kundeId)
      .sort((a, b) => a.datum.localeCompare(b.datum));

    if (leistungen.length === 0) {
      App.toast('Keine Leistungen in diesem Monat', 'info');
      return;
    }

    // Berechnung
    let gesamtStunden = 0;
    let gesamtBetrag = 0;
    let tabelleHtml = '';

    // Prüfe ob bereits unterschrieben
    const ersteMitUnterschrift = leistungen.find(l => l.unterschriftVersicherter);
    const alleUnterschrieben = !!ersteMitUnterschrift;

    for (let i = 0; i < leistungen.length; i++) {
      const l = leistungen[i];
      const std = App.stundenBerechnen(l.startzeit, l.endzeit);
      const betrag = App.betragBerechnen(std);
      gesamtStunden += std;
      gesamtBetrag += betrag;
      const arten = this.leistungsArtenKurz(l);
      const bgColor = i % 2 === 0 ? '#f8f9fa' : '#ffffff';
      // Wenn unterschrieben: nicht mehr bearbeitbar
      if (alleUnterschrieben) {
        tabelleHtml += `
          <tr style="background:${bgColor};">
            <td style="padding:10px 8px;">${App.formatDatum(l.datum)}</td>
            <td style="padding:10px 8px;">${App.formatZeit(l.startzeit)}</td>
            <td style="padding:10px 8px;">${App.formatZeit(l.endzeit)}</td>
            <td style="padding:10px 8px;">${std.toFixed(2).replace('.', ',')}</td>
            <td style="padding:10px 8px;">${App.formatBetrag(betrag)}</td>
            <td style="padding:10px 8px;">${arten}</td>
          </tr>
        `;
      } else {
        tabelleHtml += `
          <tr onclick="LeistungModule.detailAnzeigen(${l.id})" style="cursor:pointer;background:${bgColor};">
            <td style="padding:10px 8px;">${App.formatDatum(l.datum)}</td>
            <td style="padding:10px 8px;">${App.formatZeit(l.startzeit)}</td>
            <td style="padding:10px 8px;">${App.formatZeit(l.endzeit)}</td>
            <td style="padding:10px 8px;">${std.toFixed(2).replace('.', ',')}</td>
            <td style="padding:10px 8px;">${App.formatBetrag(betrag)}</td>
            <td style="padding:10px 8px;">${arten}</td>
            <td style="padding:10px 4px;color:var(--primary);font-size:1rem;">\u270E</td>
          </tr>
        `;
      }
    }

    container.innerHTML = `
      <div class="card">
        <h3 class="card-title mb-2">
          ${this.escapeHtml(App.kundenName(kunde))} \u2014 ${App.monatsName(monat)} ${jahr}
        </h3>
        <div class="text-sm text-muted" style="margin-bottom:8px;">
          ${kunde.versichertennummer ? 'VersNr: ' + this.escapeHtml(kunde.versichertennummer) + ' | ' : ''}${kunde.pflegekasse ? this.escapeHtml(kunde.pflegekasse) : ''}${kunde.pflegegrad ? ' | PG ' + kunde.pflegegrad : ''}
        </div>

        <div style="overflow-x: auto;">
          <table class="table" style="width:100%; border-collapse:collapse; font-size:0.9rem;">
            <thead>
              <tr style="background: var(--primary); color: #fff;">
                <th style="padding:8px;">Datum</th>
                <th style="padding:8px;">Von</th>
                <th style="padding:8px;">Bis</th>
                <th style="padding:8px;">Std.</th>
                <th style="padding:8px;">Betrag</th>
                <th style="padding:8px;">Leistung</th>
                ${!alleUnterschrieben ? '<th></th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${tabelleHtml}
              <tr style="font-weight:bold; border-top:2px solid var(--primary);">
                <td colspan="3" style="padding:10px 8px;">Gesamt</td>
                <td style="padding:10px 8px;">${gesamtStunden.toFixed(2).replace('.', ',')}</td>
                <td style="padding:10px 8px;">${App.formatBetrag(gesamtBetrag)}</td>
                <td colspan="${alleUnterschrieben ? 1 : 2}"></td>
              </tr>
            </tbody>
          </table>
        </div>
        ${!alleUnterschrieben ? '<p class="text-xs text-muted" style="margin-top:6px;">Eintr\u00e4ge antippen zum Bearbeiten oder L\u00f6schen</p>' : '<p class="text-xs text-muted" style="margin-top:6px;">\uD83D\uDD12 Unterschrieben \u2014 Eintr\u00e4ge k\u00f6nnen nicht mehr ge\u00e4ndert werden</p>'}
      </div>

      <div class="btn-group mt-2">
        <button class="btn btn-primary btn-block" onclick="LeistungModule.unterschriftenAnzeigen(${kundeId}, ${monat}, ${jahr})">
          ${alleUnterschrieben ? '\u2713 Unterschrift + PDF' : '\u270D Unterschrift'}
        </button>
        <button class="btn btn-secondary" onclick="LeistungModule.zurueckZurListe()">
          \u2190 Zur\u00fcck
        </button>
      </div>
    `;
  },

  // Separate Unterschriften-Ansicht
  async unterschriftenAnzeigen(kundeId, monat, jahr) {
    this._ansicht = 'unterschriften'; this._fabAktualisieren();
    this._letzteMonatsUebersicht = { kundeId, monat, jahr };
    const container = document.getElementById('leistungContent');
    if (!container) return;

    const kunde = await DB.kundeById(kundeId);
    const alleLeistungen = await DB.leistungenFuerMonat(monat, jahr);
    const leistungen = alleLeistungen.filter(l => l.kundeId === kundeId);

    const ersteMitUnterschrift = leistungen.find(l => l.unterschriftVersicherter);
    const alleUnterschrieben = !!ersteMitUnterschrift;

    container.innerHTML = `
      <div class="card">
        <h3 class="card-title mb-2">
          Unterschrift \u2014 ${this.escapeHtml(App.kundenName(kunde))}
        </h3>
        <p class="text-sm text-muted">${App.monatsName(monat)} ${jahr} | ${leistungen.length} Eintr\u00e4ge</p>
      </div>

      <div class="card">
        ${alleUnterschrieben ? `
          <div>
            <div class="text-sm text-muted mb-1"><strong>Unterschrift Versicherte/r (oder Bevollm\u00e4chtigte/r)</strong></div>
            <img src="${ersteMitUnterschrift.unterschriftVersicherter}" style="max-width:100%;height:100px;border:1px solid #ddd;border-radius:8px;background:#fff;">
          </div>
          <p class="text-xs text-muted mt-2">\uD83D\uDD12 Unterschrift gespeichert</p>
        ` : `
          <div class="form-group">
            <label><strong>Unterschrift Versicherte/r (oder Bevollm\u00e4chtigte/r)</strong></label>
            <div class="signature-wrapper">
              <canvas id="sigVersicherterCanvas"></canvas>
              <div class="sig-placeholder">Hier unterschreiben</div>
            </div>
            <div id="sigVersicherterActions" class="signature-actions"></div>
            <button class="btn btn-outline btn-sm mt-1" onclick="LeistungModule.vollbildUnterschrift(${kundeId}, ${monat}, ${jahr})">
              \u21F1 Vollbild
            </button>
          </div>
        `}
      </div>

      <div class="btn-group mt-2">
        ${!alleUnterschrieben ? `
          <button class="btn btn-primary btn-block" onclick="LeistungModule.unterschriftenSpeichern(${kundeId}, ${monat}, ${jahr})">
            Unterschrift speichern
          </button>
        ` : ''}
        <button class="btn btn-success btn-block ${!alleUnterschrieben ? 'btn-disabled' : ''}"
                onclick="LeistungModule.monatsPdfErstellen(${kundeId}, ${monat}, ${jahr})"
                ${!alleUnterschrieben ? 'disabled' : ''}>
          \uD83D\uDCC4 PDF erzeugen
        </button>
        ${alleUnterschrieben ? `
          <button class="btn btn-outline btn-block" onclick="LeistungModule.neuUnterschreiben(${kundeId}, ${monat}, ${jahr})">
            \u270D Neu unterschreiben
          </button>
        ` : ''}
        <button class="btn btn-secondary" onclick="LeistungModule.monatsUebersichtAnzeigen(${kundeId}, ${monat}, ${jahr})">
          \u2190 Zur\u00fcck zur \u00dcbersicht
        </button>
      </div>
    `;

    // Signature Pad initialisieren
    if (!alleUnterschrieben) {
      setTimeout(() => {
        this.sigPadVersicherter = initSignaturePad('sigVersicherterCanvas', 'sigVersicherterActions');
      }, 100);
    }
  },

  vollbildUnterschrift(kundeId, monat, jahr) {
    // Prüfe ob Querformat oder Hochformat
    const isPortrait = window.innerHeight > window.innerWidth;

    const overlay = document.createElement('div');
    overlay.id = 'sigFullscreenOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:9999;display:flex;flex-direction:column;';
    overlay.innerHTML = `
      <div style="padding:8px 16px;display:flex;justify-content:space-between;align-items:center;background:var(--primary);color:#fff;">
        <span style="font-weight:600;">Unterschrift Versicherte/r</span>
        <button onclick="LeistungModule.vollbildAbbrechen()" style="background:none;border:none;color:#fff;font-size:1.5rem;cursor:pointer;">✕</button>
      </div>
      <div style="flex:1;position:relative;margin:8px;overflow:hidden;">
        <canvas id="sigFullscreenCanvas" style="display:block;border:2px dashed #ccc;border-radius:8px;touch-action:none;${isPortrait ? 'transform:rotate(90deg);transform-origin:top left;position:absolute;top:0;left:0;' : 'width:100%;height:100%;'}"></canvas>
      </div>
      <div style="padding:8px 16px;display:flex;gap:8px;">
        <button class="btn btn-outline" onclick="LeistungModule.vollbildLoeschen()" style="flex:1;">Löschen</button>
        <button class="btn btn-primary" onclick="LeistungModule.vollbildSpeichern(${kundeId}, ${monat}, ${jahr})" style="flex:2;">✓ Übernehmen</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // Canvas initialisieren
    setTimeout(() => {
      const canvas = document.getElementById('sigFullscreenCanvas');
      const container = canvas.parentElement;

      if (isPortrait) {
        // Hochformat: Canvas rotieren (Breite = Containerhöhe, Höhe = Containerbreite)
        canvas.width = container.offsetHeight;
        canvas.height = container.offsetWidth;
        canvas.style.width = container.offsetHeight + 'px';
        canvas.style.height = container.offsetWidth + 'px';
      } else {
        canvas.width = container.offsetWidth;
        canvas.height = container.offsetHeight;
      }

      this._fullscreenIsPortrait = isPortrait;
      this._fullscreenSigPad = new SignaturePad(canvas, {
        backgroundColor: 'rgb(255,255,255)',
        penColor: 'rgb(0,0,0)',
      });
    }, 100);
  },

  vollbildLoeschen() {
    if (this._fullscreenSigPad) this._fullscreenSigPad.clear();
  },

  async vollbildSpeichern(kundeId, monat, jahr) {
    if (!this._fullscreenSigPad || this._fullscreenSigPad.isEmpty()) {
      App.toast('Bitte unterschreiben', 'error');
      return;
    }

    let sigData;
    if (this._fullscreenIsPortrait) {
      // Rotiertes Canvas: zurückdrehen für korrektes Bild
      const srcCanvas = document.getElementById('sigFullscreenCanvas');
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = srcCanvas.height;
      tmpCanvas.height = srcCanvas.width;
      const ctx = tmpCanvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, tmpCanvas.width, tmpCanvas.height);
      ctx.translate(0, tmpCanvas.height);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(srcCanvas, 0, 0);
      sigData = tmpCanvas.toDataURL();
    } else {
      sigData = this._fullscreenSigPad.toDataURL();
    }
    this._fullscreenSigPad = null;
    this._fullscreenIsPortrait = false;

    // Overlay entfernen
    const overlay = document.getElementById('sigFullscreenOverlay');
    if (overlay) overlay.remove();
    try { screen.orientation.unlock(); } catch(e) {}

    // Unterschrift für alle Leistungen speichern
    try {
      const alleLeistungen = await DB.leistungenFuerMonat(monat, jahr);
      const leistungen = alleLeistungen.filter(l => l.kundeId === kundeId);
      for (const l of leistungen) {
        await DB.leistungAktualisieren(l.id, { unterschriftVersicherter: sigData });
      }
      App.toast(`Unterschrift für ${leistungen.length} Einträge gespeichert`, 'success');
      this.unterschriftenAnzeigen(kundeId, monat, jahr);
    } catch (err) {
      App.toast('Fehler: ' + err.message, 'error');
    }
  },

  vollbildAbbrechen() {
    this._fullscreenSigPad = null;
    const overlay = document.getElementById('sigFullscreenOverlay');
    if (overlay) overlay.remove();
    try { screen.orientation.unlock(); } catch(e) {}
  },

  // Unterschrift für alle Leistungen eines Kunden im Monat speichern
  async unterschriftenSpeichern(kundeId, monat, jahr) {
    const sigVersicherter = this.sigPadVersicherter ? this.sigPadVersicherter.toDataURL() : null;

    if (!sigVersicherter) {
      App.toast('Bitte unterschreiben', 'error');
      return;
    }

    try {
      const alleLeistungen = await DB.leistungenFuerMonat(monat, jahr);
      const leistungen = alleLeistungen.filter(l => l.kundeId === kundeId);

      for (const l of leistungen) {
        await DB.leistungAktualisieren(l.id, { unterschriftVersicherter: sigVersicherter });
      }

      App.toast('Unterschrift gespeichert', 'success');
      await this.unterschriftenAnzeigen(kundeId, monat, jahr);
    } catch (err) {
      console.error('Fehler:', err);
      App.toast('Fehler beim Speichern', 'error');
    }
  },

  // Neu unterschreiben: Alte Unterschrift löschen, Canvas zeigen
  async neuUnterschreiben(kundeId, monat, jahr) {
    if (!await App.confirm('Neu unterschreiben? Die alte Unterschrift wird entfernt.')) return;

    try {
      const alleLeistungen = await DB.leistungenFuerMonat(monat, jahr);
      const leistungen = alleLeistungen.filter(l => l.kundeId === kundeId);

      for (const l of leistungen) {
        await DB.leistungAktualisieren(l.id, { unterschriftVersicherter: null });
      }

      App.toast('Bitte neu unterschreiben', 'info');
      await this.unterschriftenAnzeigen(kundeId, monat, jahr);
    } catch (err) {
      console.error('Fehler:', err);
      App.toast('Fehler', 'error');
    }
  },

  // Unterschrift löschen (Betreuer oder Versicherter) — nur intern, nicht in UI
  async unterschriftLoeschen(typ, kundeId, monat, jahr) {
    const label = typ === 'betreuer' ? 'Betreuer-Unterschrift' : 'Versicherten-Unterschrift';
    if (!await App.confirm(`${label} wirklich löschen?`)) return;

    try {
      const alleLeistungen = await DB.leistungenFuerMonat(monat, jahr);
      const leistungen = alleLeistungen.filter(l => l.kundeId === kundeId);

      const update = {};
      if (typ === 'betreuer') update.unterschriftBetreuer = null;
      else update.unterschriftVersicherter = null;

      for (const l of leistungen) {
        await DB.leistungAktualisieren(l.id, update);
      }

      App.toast(`${label} gelöscht`, 'success');
      await this.monatsUebersichtAnzeigen(kundeId, monat, jahr);
    } catch (err) {
      console.error('Fehler:', err);
      App.toast('Fehler beim Löschen', 'error');
    }
  },

  zeitAktualisieren() {
    const start = document.getElementById('leistungStart')?.value;
    const ende = document.getElementById('leistungEnde')?.value;
    const stunden = App.stundenBerechnen(start, ende);
    const betrag = App.betragBerechnen(stunden);

    const dauerEl = document.getElementById('leistungDauer');
    const betragEl = document.getElementById('leistungBetrag');
    if (dauerEl) dauerEl.textContent = stunden.toFixed(2).replace('.', ',') + ' Std.';
    if (betragEl) betragEl.textContent = App.formatBetrag(betrag);
  },

  async speichern(id = null) {
    const kundeId = parseInt(document.getElementById('leistungKunde').value);
    if (!kundeId) {
      App.toast('Bitte einen Kunden wählen', 'error');
      return;
    }

    const daten = {
      kundeId,
      datum: document.getElementById('leistungDatum').value,
      startzeit: document.getElementById('leistungStart').value,
      endzeit: document.getElementById('leistungEnde').value,
      freitext: document.getElementById('leistungFreitext').value.trim(),
      notizen: document.getElementById('leistungNotizen').value.trim()
    };

    if (!daten.datum || !daten.startzeit || !daten.endzeit) {
      App.toast('Bitte Datum und Zeiten ausfüllen', 'error');
      return;
    }

    // Warnung wenn für diesen Kunden/Monat schon eine Rechnung existiert
    if (!id) {
      const [j, m] = daten.datum.split('-');
      const rechnungen = await DB.alleRechnungen();
      const re = rechnungen.find(r => r.kundeId === kundeId && r.monat === parseInt(m) && r.jahr === parseInt(j));
      if (re) {
        if (!await App.confirm(`⚠️ Für diesen Kunden wurde im ${App.monatsName(parseInt(m))} ${j} bereits eine Rechnung erstellt. Trotzdem Leistung hinzufügen?`)) return;
      }
    }

    try {
      if (id) {
        await DB.leistungAktualisieren(id, daten);
        App.toast('Aktualisiert', 'success');
      } else {
        await DB.leistungHinzufuegen(daten);
        // Fahrt-Vorschlag nach Speichern
        const kunde = (await DB.alleKunden()).find(k => k.id === kundeId);
        if (kunde && kunde.strasse) {
          const name = App.kundenName ? App.kundenName(kunde) : kunde.name;
          App.toast(`Gespeichert — <a href="fahrten.html?kundeId=${kundeId}" style="color:#fff;text-decoration:underline;">Fahrt zu ${name}?</a>`, 'success', 8000);
        } else {
          App.toast('Gespeichert', 'success');
        }
      }
      this.zurueckZurListe();
    } catch (err) {
      console.error('Fehler:', err);
      App.toast('Fehler beim Speichern', 'error');
    }
  },

  async monatsPdfErstellen(kundeId, monat, jahr) {
    try {
      const kunde = await DB.kundeById(kundeId);
      if (!kunde) { App.toast('Kunde nicht gefunden', 'error'); return; }
      const leistungen = await DB.leistungenFuerMonat(monat, jahr);
      const kundeLeistungen = leistungen.filter(l => l.kundeId === kundeId);
      if (kundeLeistungen.length === 0) { App.toast('Keine Leistungen', 'info'); return; }
      kundeLeistungen.sort((a, b) => a.datum.localeCompare(b.datum));
      const doc = await PDFHelper.generateLeistungsnachweis(kundeLeistungen, kunde);
      PDFHelper.download(doc, `Leistungsnachweis_${kunde.name.replace(/\s+/g, '_')}_${App.monatsName(monat)}_${jahr}.pdf`);
      App.toast('PDF erstellt', 'success');
    } catch (err) {
      console.error('PDF-Fehler:', err);
      App.toast('Fehler bei PDF', 'error');
    }
  },

  async loeschen(id) {
    if (!await App.confirm('Diesen Eintrag wirklich löschen?')) return;
    try {
      await DB.leistungLoeschen(id);
      App.toast('Gelöscht', 'success');
      this.zurueckZurListe();
    } catch (err) {
      App.toast('Fehler', 'error');
    }
  },

  // Kontextabhängiger Zurück-Button (Header)
  zurueck() {
    if (this._ansicht === 'unterschriften' && this._letzteMonatsUebersicht) {
      const { kundeId, monat, jahr } = this._letzteMonatsUebersicht;
      this.monatsUebersichtAnzeigen(kundeId, monat, jahr);
    } else if (this._ansicht === 'formular' && this._letzteMonatsUebersicht) {
      const { kundeId, monat, jahr } = this._letzteMonatsUebersicht;
      this.monatsUebersichtAnzeigen(kundeId, monat, jahr);
    } else if (this._ansicht === 'monatsuebersicht') {
      this.zurueckZurListe();
    } else {
      window.location.href = '../index.html';
    }
  },

  zurueckZurListe() {
    if (this.signaturePad) {
      this.signaturePad.destroy?.();
      this.signaturePad = null;
    }
    if (this.sigPadVersicherter) {
      this.sigPadVersicherter.destroy?.();
      this.sigPadVersicherter = null;
    }
    const container = document.getElementById('leistungContent');
    if (container) {
      container.innerHTML = '<div id="leistungListe"></div>';
      this.init();
    }
  },

  kundenFiltern(suchtext) {
    const results = document.getElementById('leistungKundeResults');
    if (!results) return;
    const kunden = this._leistungKunden || [];
    const begriff = (suchtext || '').toLowerCase().trim();

    const gefiltert = begriff
      ? kunden.filter(k => App.kundenName(k).toLowerCase().includes(begriff))
      : kunden;

    if (gefiltert.length === 0) {
      results.innerHTML = '<div style="padding:8px;color:var(--gray-500);font-size:0.9rem;">Keine Kunden gefunden</div>';
    } else {
      results.innerHTML = gefiltert.map(k =>
        `<div style="padding:8px 12px;cursor:pointer;font-size:0.9rem;border-bottom:1px solid var(--gray-100);"
              onmousedown="LeistungModule.kundeAuswaehlen(${k.id})"
              onmouseover="this.style.background='var(--primary-bg)'"
              onmouseout="this.style.background=''">${this.escapeHtml(App.kundenName(k))}</div>`
      ).join('');
    }
    results.style.display = 'block';

    // Click-outside schliessen
    if (!this._kundenClickHandler) {
      this._kundenClickHandler = (e) => {
        if (!e.target.closest('#leistungKundeSearch') && !e.target.closest('#leistungKundeResults')) {
          results.style.display = 'none';
        }
      };
      document.addEventListener('click', this._kundenClickHandler);
    }
  },

  kundeAuswaehlen(kundeId) {
    const kunden = this._leistungKunden || [];
    const kunde = kunden.find(k => k.id === kundeId);
    if (!kunde) return;

    const searchInput = document.getElementById('leistungKundeSearch');
    const select = document.getElementById('leistungKunde');
    const results = document.getElementById('leistungKundeResults');

    if (searchInput) searchInput.value = App.kundenName(kunde);
    if (select) select.value = kundeId;
    if (results) results.style.display = 'none';
  },

  async manuellMarkieren(kundeId, monat, jahr) {
    if (!await App.confirm('✋ Rechnung wurde manuell erstellt und versendet?')) return;
    try {
      // Prüfe ob schon existiert
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
        // versand_art nachtragen
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
      App.toast('Als manuell markiert', 'success');
      this.listeAnzeigen();
    } catch (err) {
      App.toast('Fehler: ' + err.message, 'error');
    }
  },

  // =============================================
  // Rechnungs-Overlay (direkt auf der Leistungsseite)
  // =============================================

  // Cache für Versandstatus (lexofficeId -> {art, datum})
  _versandMap: {},
  _alleRechnungen: [],

  /**
   * Overlay zum Erstellen einer Rechnung (ersetzt Navigation zu rechnung.html)
   */
  async rechnungErstellenOverlay(kundeId, monat, jahr) {
    const overlay = document.getElementById('rechnungDetailOverlay');
    const content = document.getElementById('rechnungDetailContent');
    if (!overlay || !content) return;

    overlay.classList.remove('hidden');
    content.innerHTML = '<div class="card" style="background:white;text-align:center;"><div class="spinner"></div> Lade Daten...</div>';

    try {
      // Lexoffice initialisieren
      if (typeof LexofficeAPI === 'undefined' || !LexofficeAPI.istKonfiguriert()) {
        if (typeof LexofficeAPI !== 'undefined') await LexofficeAPI.init();
        if (!LexofficeAPI || !LexofficeAPI.istKonfiguriert()) {
          content.innerHTML = `<div class="card" style="background:white;"><p style="color:var(--danger);">Lexoffice API-Key fehlt</p><button class="btn btn-outline" onclick="LeistungModule.rechnungOverlaySchliessen()">Schließen</button></div>`;
          return;
        }
      }

      const kunde = await DB.kundeById(kundeId);
      if (!kunde) { App.toast('Kunde nicht gefunden', 'error'); this.rechnungOverlaySchliessen(); return; }

      // Leistungen laden
      const leistungen = await DB.leistungenFuerMonat(monat, jahr);
      const kundeLeistungen = leistungen.filter(l => l.kundeId === kundeId);
      if (kundeLeistungen.length === 0) {
        App.toast(`Keine Leistungen für ${App.monatsName(monat)} ${jahr}`, 'error');
        this.rechnungOverlaySchliessen();
        return;
      }

      let betrag = 0;
      let gesamtStunden = 0;
      kundeLeistungen.forEach(l => {
        const stunden = App.stundenBerechnen(l.startzeit, l.endzeit);
        gesamtStunden += stunden;
        betrag += App.betragBerechnen(stunden);
      });

      // Variante bestimmen
      const istPflegekunde = !kunde.kundentyp || kunde.kundentyp === 'pflege';
      let variante = 'privat';
      if (kunde.pflegekasse && istPflegekunde) {
        variante = LexofficeAPI.varianteErmitteln(kunde);
      }

      const empfName = variante === 'privat' ? App.kundenName(kunde) : (kunde.pflegekasse || 'Pflegekasse');

      // Empfänger-Auswahl bei Pflegekunden
      const empfaengerWahl = (kunde.pflegekasse && istPflegekunde) ? `
        <div class="form-group" style="margin-bottom:12px;">
          <label>Rechnungsempfänger</label>
          <select id="overlayEmpfaenger" class="form-control" onchange="LeistungModule._empfaengerOverlayGeaendert(this.value, ${kundeId})">
            <option value="kasse">An ${this.escapeHtml(kunde.pflegekasse)}</option>
            <option value="direkt">Direkt an Kunden</option>
          </select>
        </div>
      ` : '<input type="hidden" id="overlayEmpfaenger" value="direkt">';

      content.innerHTML = `
        <div class="card" style="background:white;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="margin:0;font-size:1.1rem;">Rechnung erstellen</h3>
            <button class="btn btn-sm" onclick="LeistungModule.rechnungOverlaySchliessen()" style="font-size:1.3rem;background:none;border:none;">✕</button>
          </div>

          ${empfaengerWahl}

          ${kunde.besonderheiten ? `<div style="padding:8px;background:var(--warning-bg);border-radius:8px;margin-bottom:12px;"><strong>⚠️</strong> ${this.escapeHtml(kunde.besonderheiten)}</div>` : ''}

          <table style="width:100%;font-size:0.9rem;border-collapse:collapse;">
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Empfänger</td><td id="overlayEmpfName" style="padding:4px 8px;font-weight:600;">${empfName}</td></tr>
            ${variante !== 'privat' ? `<tr><td style="padding:4px 8px;color:var(--gray-600);">Versicherte/r</td><td style="padding:4px 8px;">${App.kundenName(kunde)}</td></tr>` : ''}
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Variante</td><td id="overlayVariante" style="padding:4px 8px;">${variante === 'kasse' ? 'Pflegekasse (§45b)' : variante === 'lbv' ? 'LBV-Splitting' : 'Privatrechnung'}</td></tr>
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Zeitraum</td><td style="padding:4px 8px;">${App.monatsName(monat)} ${jahr}</td></tr>
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Leistungen</td><td style="padding:4px 8px;">${kundeLeistungen.length} Einträge, ${gesamtStunden.toFixed(1)} Stunden</td></tr>
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Stundensatz</td><td style="padding:4px 8px;">${((FIRMA || {}).stundensatz || 32.75).toFixed(2).replace('.', ',')} €</td></tr>
          </table>

          <div style="display:flex;justify-content:space-between;padding:12px 0;font-size:1.2rem;font-weight:700;border-top:2px solid var(--gray-200);margin-top:8px;">
            <span>Betrag</span>
            <span>${betrag.toFixed(2).replace('.', ',')} €</span>
          </div>

          <div class="btn-group mt-2" style="gap:8px;">
            <button class="btn btn-primary btn-block" onclick="LeistungModule._rechnungAbsenden()">
              In Lexoffice erstellen
            </button>
            <button class="btn btn-outline" onclick="LeistungModule._manuellErstelltOverlay()">
              ✋ Manuell erstellt
            </button>
            <button class="btn btn-outline" onclick="LeistungModule.rechnungOverlaySchliessen()">
              Abbrechen
            </button>
          </div>
        </div>
      `;

      // Daten zwischenspeichern
      this._pendingRechnung = { kundeId, monat, jahr, betrag, kunde, kundeLeistungen, variante };

    } catch (err) {
      console.error('Fehler:', err);
      content.innerHTML = `<div class="card" style="background:white;"><p style="color:var(--danger);">Fehler: ${err.message}</p><button class="btn btn-outline" onclick="LeistungModule.rechnungOverlaySchliessen()">Schließen</button></div>`;
    }
  },

  _empfaengerOverlayGeaendert(wert, kundeId) {
    // Empfänger-Name und Variante im Overlay aktualisieren
    const empfNameEl = document.getElementById('overlayEmpfName');
    const varianteEl = document.getElementById('overlayVariante');
    if (!this._pendingRechnung) return;
    const kunde = this._pendingRechnung.kunde;
    if (wert === 'kasse' && kunde.pflegekasse) {
      if (empfNameEl) empfNameEl.textContent = kunde.pflegekasse;
      this._pendingRechnung.variante = LexofficeAPI.varianteErmitteln(kunde);
      if (varianteEl) varianteEl.textContent = this._pendingRechnung.variante === 'kasse' ? 'Pflegekasse (§45b)' : this._pendingRechnung.variante === 'lbv' ? 'LBV-Splitting' : 'Privatrechnung';
    } else {
      if (empfNameEl) empfNameEl.textContent = App.kundenName(kunde);
      this._pendingRechnung.variante = 'privat';
      if (varianteEl) varianteEl.textContent = 'Privatrechnung';
    }
  },

  async _rechnungAbsenden() {
    if (!this._pendingRechnung) return;
    const { kundeId, monat, jahr } = this._pendingRechnung;
    this._pendingRechnung = null;

    const empfaenger = document.getElementById('overlayEmpfaenger')?.value || 'kasse';
    const content = document.getElementById('rechnungDetailContent');
    content.innerHTML = '<div class="card" style="background:white;text-align:center;"><div class="spinner"></div> Rechnung wird in Lexoffice erstellt...</div>';

    try {
      const ergebnis = await apiFetch('/lexoffice/rechnung-erstellen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kunde_id: kundeId, monat, jahr, empfaenger }),
      });

      // Nach Erstellung: Versandoptionen anzeigen
      const lexofficeId = ergebnis.lexoffice_id || ergebnis.lexofficeId;
      if (lexofficeId) {
        App.toast(`Rechnung erstellt: ${ergebnis.betrag.toFixed(2).replace('.', ',')} €`, 'success', 3000);
        // Versandstatus laden und Detail-Overlay zeigen
        await this._versandMapAktualisieren();
        await this.rechnungDetailAnzeigen(lexofficeId);
      } else {
        App.toast(`Rechnung erstellt: ${ergebnis.betrag.toFixed(2).replace('.', ',')} €`, 'success', 5000);
        this.rechnungOverlaySchliessen();
      }
      // Liste im Hintergrund aktualisieren
      this.listeAnzeigen();
    } catch (err) {
      console.error('Lexoffice Fehler:', err);
      content.innerHTML = `
        <div class="card" style="background:white;">
          <p style="color:var(--danger);">Fehler: ${err.message}</p>
          <button class="btn btn-outline" onclick="LeistungModule.rechnungOverlaySchliessen()">Schließen</button>
        </div>
      `;
    }
  },

  async _manuellErstelltOverlay() {
    if (!this._pendingRechnung) return;
    const { kundeId, monat, jahr } = this._pendingRechnung;

    if (!await App.confirm('✋ Rechnung wurde in Lexoffice manuell erstellt?')) return;

    const content = document.getElementById('rechnungDetailContent');
    content.innerHTML = '<div class="card" style="background:white;text-align:center;"><div class="spinner"></div></div>';

    try {
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
      this._pendingRechnung = null;
      this.rechnungOverlaySchliessen();
      this.listeAnzeigen();
    } catch (err) {
      App.toast('Fehler: ' + err.message, 'error');
    }
  },

  /**
   * Rechnungsdetail-Overlay (ersetzt Navigation zu rechnung.html?detail=LEXID)
   */
  async rechnungDetailAnzeigen(lexofficeId) {
    const overlay = document.getElementById('rechnungDetailOverlay');
    const content = document.getElementById('rechnungDetailContent');
    if (!overlay || !content) return;

    overlay.classList.remove('hidden');
    content.innerHTML = '<div class="card" style="background:white;text-align:center;"><div class="spinner"></div> Lade Rechnungsdetails...</div>';

    try {
      if (typeof LexofficeAPI === 'undefined') { App.toast('Lexoffice-Modul nicht geladen', 'error'); return; }
      if (!LexofficeAPI.istKonfiguriert()) await LexofficeAPI.init();

      const rechnung = await LexofficeAPI.getInvoice(lexofficeId);

      // Empfaenger
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

      const reDatum = rechnung.voucherDate ? new Date(rechnung.voucherDate).toLocaleDateString('de-DE') : '-';
      const total = rechnung.totalPrice || {};
      const betrag = total.totalNetAmount != null ? total.totalNetAmount.toFixed(2).replace('.', ',') : '-';

      const lokale = await DB.alleRechnungen();
      const viaApp = lokale.some(r => r.lexofficeInvoiceId === lexofficeId);

      // Lokalen Kunden finden
      const alleKunden = await DB.alleKunden();
      const kontaktId = addr.contactId;
      let lokalerKunde = alleKunden.find(k => k.lexofficeId === kontaktId);

      // Versicherten-Person finden bei Kassenrechnungen
      const versichertePerson = positionen.length > 0 ? positionen[0].name : null;
      const istKassenrechnung = versichertePerson && versichertePerson !== 'Alltagshilfe';

      // Versandstatus laden
      await this._versandMapAktualisieren();

      content.innerHTML = `
        <div class="card" style="background:white;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="margin:0;font-size:1.1rem;">Rechnungsdetail</h3>
            <button class="btn btn-sm" onclick="LeistungModule.rechnungOverlaySchliessen()" style="font-size:1.3rem;background:none;border:none;">✕</button>
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
          ${positionen.map(p => `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-100);">
              <div>
                <div style="font-weight:500;">${p.name || '-'}</div>
                ${p.description ? `<div class="text-sm text-muted">${p.description}</div>` : ''}
              </div>
              <div style="text-align:right;white-space:nowrap;">
                <div>${p.quantity || '-'} ${p.unitName || ''}</div>
                <div class="fw-bold">${p.lineItemAmount != null ? p.lineItemAmount.toFixed(2).replace('.', ',') + ' €' : ''}</div>
              </div>
            </div>
          `).join('')}

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
                  <div><div style="font-weight:600;color:#2e7d32;">${label}${datum}</div></div>
                </div>
                <details style="margin-bottom:8px;">
                  <summary style="cursor:pointer;font-size:0.85rem;color:var(--gray-500);">Erneut versenden...</summary>
                  <div class="btn-group mt-1" style="flex-wrap:wrap;gap:8px;">`;
            }
            return '<div style="font-weight:600;margin-bottom:8px;">Versand</div><div class="btn-group" style="flex-wrap:wrap;gap:8px;">';
          })()}
            <button class="btn btn-sm btn-outline" onclick="LeistungModule._pdfLaden('${lexofficeId}', '${(empfaenger || '').replace(/'/g, '')}', '${rechnung.voucherNumber || ''}')">
              📄 PDF laden
            </button>
            <button class="btn btn-sm btn-outline" onclick="LeistungModule._faxDetail('${lexofficeId}')">
              📠 Fax
            </button>
            <button class="btn btn-sm btn-outline" onclick="LeistungModule._briefDetail('${lexofficeId}')">
              ✉️ Brief
            </button>
            <button class="btn btn-sm btn-outline" onclick="LeistungModule._versandMarkieren('${lexofficeId}', 'uebergabe', '🤝 Als persönlich übergeben markieren?')">
              🤝 Übergabe
            </button>
            <button class="btn btn-sm btn-outline" onclick="LeistungModule._versandMarkieren('${lexofficeId}', 'serviceportal', '🌐 Als über Serviceportal eingereicht markieren?')">
              🌐 Serviceportal
            </button>
            <button class="btn btn-sm btn-outline" onclick="LeistungModule._versandMarkieren('${lexofficeId}', 'manuell', '✋ Als manuell erstellt und versendet markieren?')">
              ✋ Manuell
            </button>
          </div>
          ${(this._versandMap || {})[lexofficeId]?.art ? '</details>' : ''}
        </div>
      `;
    } catch (err) {
      console.error('Detail-Laden fehlgeschlagen:', err);
      content.innerHTML = `
        <div class="card" style="background:white;">
          <p style="color:var(--danger);">Fehler: ${err.message}</p>
          <button class="btn btn-sm btn-outline" onclick="LeistungModule.rechnungOverlaySchliessen()">Schließen</button>
        </div>
      `;
    }
  },

  rechnungOverlaySchliessen() {
    const overlay = document.getElementById('rechnungDetailOverlay');
    if (overlay) overlay.classList.add('hidden');
  },

  /**
   * Versandstatus aus lokaler DB laden
   */
  async _versandMapAktualisieren() {
    const lokale = await DB.alleRechnungen();
    this._versandMap = {};
    for (const r of lokale) {
      if (r.lexofficeId) {
        this._versandMap[r.lexofficeId] = { art: r.versandArt, datum: r.versandDatum };
      }
    }
  },

  /**
   * Lexoffice-Rechnungsdaten + lokalen Kunden laden
   */
  async _ladeRechnungUndKunde(lexofficeId) {
    const rechnung = await LexofficeAPI.getInvoice(lexofficeId);
    const kontaktId = rechnung.address?.contactId;
    const alleKunden = await DB.alleKunden();
    let kunde = alleKunden.find(k => k.lexofficeId === kontaktId);
    if (!kunde || !kunde.pflegekasse) {
      const supplement = rechnung.address?.supplement || '';
      const posName = rechnung.lineItems?.[0]?.name || '';
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

  async _pdfLaden(lexofficeId, kontaktName, rechnungsNr) {
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

  async _faxDetail(lexofficeId) {
    try {
      const { kunde, empfaenger } = await this._ladeRechnungUndKunde(lexofficeId);
      let faxNr = kunde ? (kunde.faxKasse || kunde.pflegekasseFax || '') : '';
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
            <button class="btn btn-primary btn-block" onclick="LeistungModule._faxAbsenden('${lexofficeId}')">
              📠 Jetzt faxen
            </button>
            <button class="btn btn-outline" onclick="LeistungModule.rechnungDetailAnzeigen('${lexofficeId}')">Zurück</button>
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
      App.toast(result.message || 'Fax gesendet!', 'success');
      await this._versandMapAktualisieren();
      this.rechnungDetailAnzeigen(lexofficeId);
      this.listeAnzeigen();
    } catch (err) {
      App.toast('Fax-Fehler: ' + err.message, 'error');
      this.rechnungDetailAnzeigen(lexofficeId);
    }
  },

  async _briefDetail(lexofficeId) {
    try {
      const { empfaenger } = await this._ladeRechnungUndKunde(lexofficeId);

      if (typeof LetterXpressAPI !== 'undefined') {
        if (!LetterXpressAPI.istKonfiguriert()) await LetterXpressAPI.init();
        if (!LetterXpressAPI.istKonfiguriert()) { App.toast('LetterXpress nicht konfiguriert', 'error'); return; }
      }

      const content = document.getElementById('rechnungDetailContent');
      content.innerHTML = `
        <div class="card" style="background:white;">
          <h3 style="margin:0 0 12px;">Brief senden</h3>
          <table style="width:100%;font-size:0.9rem;">
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Empfänger</td><td style="padding:4px 8px;font-weight:600;">${empfaenger}</td></tr>
            <tr><td style="padding:4px 8px;color:var(--gray-600);">Versand</td><td style="padding:4px 8px;">LetterXpress, s/w, national</td></tr>
          </table>
          <div class="btn-group mt-2" style="gap:8px;">
            <button class="btn btn-primary btn-block" onclick="LeistungModule._briefAbsenden('${lexofficeId}')">
              ✉️ Jetzt als Brief senden
            </button>
            <button class="btn btn-outline" onclick="LeistungModule.rechnungDetailAnzeigen('${lexofficeId}')">Zurück</button>
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
      App.toast('Brief an LetterXpress übergeben!', 'success');
      await this._versandMapAktualisieren();
      this.rechnungDetailAnzeigen(lexofficeId);
      this.listeAnzeigen();
    } catch (err) {
      App.toast('Brief-Fehler: ' + err.message, 'error');
      this.rechnungDetailAnzeigen(lexofficeId);
    }
  },

  async _versandMarkieren(lexofficeId, art, frage) {
    if (!await App.confirm(frage)) return;
    try {
      const { kunde } = await this._ladeRechnungUndKunde(lexofficeId);
      await apiFetch('/lexoffice/versand-markieren', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lexoffice_id: lexofficeId, versand_art: art, kunde_id: kunde ? kunde.id : null }),
      });
      App.toast('Status aktualisiert', 'success');
      await this._versandMapAktualisieren();
      this.rechnungDetailAnzeigen(lexofficeId);
      this.listeAnzeigen();
    } catch (err) {
      App.toast('Fehler: ' + err.message, 'error');
    }
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

if (window._entlastReady && window.FIRMA) { LeistungModule.init(); }
else { document.addEventListener('entlast-ready', () => LeistungModule.init()); }
