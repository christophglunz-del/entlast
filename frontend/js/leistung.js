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
    if (this._preselectedKundeId) {
      // URL-Parameter verbrauchen, damit Reload nicht erneut triggert
      window.history.replaceState({}, '', window.location.pathname);
      await this.neueLeistung();
    } else {
      await this.listeAnzeigen();
    }
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

    if (leistungen.length === 0) {
      container.innerHTML = `
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

    const kunden = await DB.alleKunden();
    const kundenMap = {};
    kunden.forEach(k => kundenMap[k.id] = k);

    // Lokale Rechnungen laden für "Abgerechnet"-Badge
    const rechnungen = await DB.alleRechnungen();
    const rechnungMap = {};
    for (const r of rechnungen) {
      if (r.kundeId && r.monat && r.jahr) {
        rechnungMap[`${r.kundeId}-${r.monat}-${r.jahr}`] = r;
      }
    }

    let html = '';
    for (const [monat, eintraege] of Object.entries(grouped)) {
      const [j, m] = monat.split('-');
      const mi = parseInt(m);
      const ji = parseInt(j);

      html += `
        <div class="section-title">
          <span class="icon">📅</span> ${App.monatsName(mi)} ${j}
        </div>
      `;

      // Pro Kunde in diesem Monat: Karte anzeigen
      const kundenIds = [...new Set(eintraege.map(l => l.kundeId))];
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

        html += `
          <div class="list-item" onclick="LeistungModule.monatsUebersichtAnzeigen(${kid}, ${mi}, ${ji})">
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
              ${(() => {
                const re = rechnungMap[`${kid}-${mi}-${ji}`];
                if (re && re.lexofficeId) {
                  const versandt = re.versandArt === 'fax' ? '📠 gefaxt' : re.versandArt === 'brief' ? '✉️ Brief' : '';
                  return `<span class="badge" style="background:#e8f5e9;color:#2e7d32;">💰 Abgerechnet</span>
                    ${versandt ? `<span class="text-xs" style="color:#2e7d32;">${versandt}</span>` : ''}
                    <a href="rechnung.html" onclick="event.stopPropagation();" class="btn btn-sm btn-outline" style="font-size:0.7rem;">📄 Rechnung</a>`;
                }
                if (alleUnterschrieben) {
                  return `<span class="badge badge-success">\u2713 Unterschrieben</span>
                    <a href="rechnung.html?kunde=${kid}&monat=${mi}&jahr=${ji}" class="btn btn-sm btn-outline" onclick="event.stopPropagation();" style="font-size:0.7rem;">💰 Rechnung</a>`;
                }
                return '<span class="badge badge-warning">\u270D Unterschrift fehlt</span>';
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

    try {
      if (id) {
        await DB.leistungAktualisieren(id, daten);
        App.toast('Aktualisiert', 'success');
      } else {
        await DB.leistungHinzufuegen(daten);
        App.toast('Gespeichert', 'success');
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

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

if (window._entlastReady && window.FIRMA) { LeistungModule.init(); }
else { document.addEventListener('entlast-ready', () => LeistungModule.init()); }
