/**
 * Leistungsnachweis-Modul für Susi's Alltagshilfe
 * Einzelne Tage sammeln, einmal pro Monat unterschreiben
 */

const LeistungModule = {
  signaturePad: null,

  async init() {
    await this.listeAnzeigen();
  },

  async listeAnzeigen() {
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

    let html = '';
    for (const [monat, eintraege] of Object.entries(grouped)) {
      const [j, m] = monat.split('-');
      const mi = parseInt(m);
      const ji = parseInt(j);

      // Pro Kunde in diesem Monat: Unterschrift-Status prüfen
      const kundenIds = [...new Set(eintraege.map(l => l.kundeId))];
      const hatUnterschrift = eintraege.some(l => l.unterschrift);

      html += `
        <div class="section-title">
          <span class="icon">📅</span> ${App.monatsName(mi)} ${j}
        </div>
        <div class="d-flex gap-1 mb-1" style="flex-wrap: wrap;">
          ${kundenIds.map(kid => {
            const k = kundenMap[kid];
            if (!k) return '';
            return `
              <button class="btn btn-sm btn-outline" onclick="LeistungModule.monatsPdfErstellen(${kid}, ${mi}, ${ji})">
                📄 PDF ${this.escapeHtml(k.name)}
              </button>
            `;
          }).join('')}
          ${!hatUnterschrift ? `
            <button class="btn btn-sm btn-primary" onclick="LeistungModule.monatsUnterschrift('${monat}')">
              ✍️ Monat unterschreiben
            </button>
          ` : `
            <span class="badge badge-success" style="padding: 6px 12px;">✓ Unterschrieben</span>
          `}
        </div>
      `;

      for (const l of eintraege) {
        const kunde = kundenMap[l.kundeId];
        const stunden = App.stundenBerechnen(l.startzeit, l.endzeit);
        const betrag = App.betragBerechnen(stunden);
        const arten = this.leistungsArtenKurz(l);

        html += `
          <div class="list-item" onclick="LeistungModule.detailAnzeigen(${l.id})">
            <div class="item-avatar">${kunde ? App.initialen(kunde.name) : '?'}</div>
            <div class="item-content">
              <div class="item-title">${kunde ? this.escapeHtml(kunde.name) : 'Unbekannt'}</div>
              <div class="item-subtitle">
                ${App.formatDatum(l.datum)} | ${App.formatZeit(l.startzeit)}-${App.formatZeit(l.endzeit)} |
                ${stunden.toFixed(1)} Std. | ${App.formatBetrag(betrag)}
              </div>
              <div class="text-xs text-muted mt-1">${arten}</div>
            </div>
            <div class="item-action">›</div>
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
    const container = document.getElementById('leistungContent');
    if (!container) return;

    const kundenOptions = kunden.map(k =>
      `<option value="${k.id}" ${leistung && leistung.kundeId === k.id ? 'selected' : ''}>${this.escapeHtml(k.name)}</option>`
    ).join('');

    container.innerHTML = `
      <form id="leistungForm" onsubmit="event.preventDefault(); LeistungModule.speichern(${leistung ? leistung.id : 'null'});">
        <div class="card">
          <h3 class="card-title mb-2">${leistung ? 'Eintrag bearbeiten' : 'Neuer Leistungseintrag'}</h3>

          <div class="form-group">
            <label for="leistungKunde">Kunde *</label>
            <select id="leistungKunde" class="form-control" required>
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
        </div>

        <div class="card">
          <h3 class="card-title mb-2">Art der Leistung</h3>

          <!-- Hauptleistungen in einer Zeile -->
          <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;">
            <label class="chip-check">
              <input type="checkbox" id="leistungBetreuung" ${leistung && leistung.betreuung ? 'checked' : ''}>
              <span>Betreuung</span>
            </label>
            <label class="chip-check">
              <input type="checkbox" id="leistungAlltagsbegleitung" ${leistung && leistung.alltagsbegleitung ? 'checked' : ''}>
              <span>Alltagsbegl.</span>
            </label>
            <label class="chip-check">
              <input type="checkbox" id="leistungPflegebegleitung" ${leistung && leistung.pflegebegleitung ? 'checked' : ''}>
              <span>Pflegebegl.</span>
            </label>
            <label class="chip-check">
              <input type="checkbox" id="leistungHauswirtschaft" ${leistung && leistung.hauswirtschaft ? 'checked' : ''}>
              <span>Hauswirtschaft</span>
            </label>
          </div>

          <!-- Objekt-Leistungen -->
          <div class="form-hint mb-1">Leistungen an Objekten (Reinigung):</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;">
            <label class="chip-check">
              <input type="checkbox" id="leistungObjektInnen" ${leistung && leistung.objektInnen ? 'checked' : ''}>
              <span>Innen</span>
            </label>
            <label class="chip-check">
              <input type="checkbox" id="leistungObjektAussen" ${leistung && leistung.objektAussen ? 'checked' : ''}>
              <span>Außen</span>
            </label>
          </div>

          <!-- Freitext -->
          <div class="form-group">
            <label for="leistungFreitext">Weitere Leistung (Freitext)</label>
            <input type="text" id="leistungFreitext" class="form-control"
                   value="${leistung && leistung.freitext ? this.escapeHtml(leistung.freitext) : ''}"
                   placeholder="z.B. Gartenarbeit, Begleitung zum Arzt...">
          </div>
        </div>

        <div class="card">
          <h3 class="card-title mb-2">Anmerkungen</h3>
          <div class="form-group">
            <textarea id="leistungNotizen" class="form-control" rows="2"
                      placeholder="Optionale Anmerkungen...">${leistung ? (leistung.notizen || '') : ''}</textarea>
          </div>
        </div>

        <div class="btn-group mt-2">
          <button type="submit" class="btn btn-primary btn-block">
            Speichern
          </button>
          <button type="button" class="btn btn-secondary" onclick="LeistungModule.zurueckZurListe()">
            Abbrechen
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
  },

  // Monats-Unterschrift: Eine Unterschrift für alle Einträge eines Monats
  async monatsUnterschrift(monatKey) {
    const [j, m] = monatKey.split('-');
    const container = document.getElementById('leistungContent');

    container.innerHTML = `
      <div class="card">
        <h3 class="card-title mb-2">Monatsunterschrift — ${App.monatsName(parseInt(m))} ${j}</h3>
        <p class="text-sm text-muted mb-2">
          Die Unterschrift gilt für alle Leistungseinträge dieses Monats.
        </p>

        <div class="form-group">
          <label for="unterschriftDatum">Datum der Unterschrift</label>
          <input type="date" id="unterschriftDatum" class="form-control" value="${App.heute()}">
        </div>

        <div class="signature-wrapper">
          <canvas id="monatsSignatur"></canvas>
          <div class="sig-placeholder">Hier unterschreiben</div>
        </div>
        <div id="monatsSigActions" class="signature-actions"></div>
      </div>

      <div class="btn-group mt-2">
        <button class="btn btn-primary btn-block" onclick="LeistungModule.monatsUnterschriftSpeichern('${monatKey}')">
          Unterschrift speichern
        </button>
        <button class="btn btn-secondary" onclick="LeistungModule.zurueckZurListe()">
          Abbrechen
        </button>
      </div>
    `;

    setTimeout(() => {
      this.signaturePad = initSignaturePad('monatsSignatur', 'monatsSigActions');
    }, 100);
  },

  async monatsUnterschriftSpeichern(monatKey) {
    if (!this.signaturePad || this.signaturePad.isEmpty()) {
      App.toast('Bitte unterschreiben', 'error');
      return;
    }

    const unterschrift = this.signaturePad.toDataURL();
    const unterschriftDatum = document.getElementById('unterschriftDatum').value || App.heute();
    const [j, m] = monatKey.split('-');

    try {
      const leistungen = await DB.leistungenFuerMonat(parseInt(m), parseInt(j));
      // Unterschrift auf alle Einträge dieses Monats setzen
      for (const l of leistungen) {
        await DB.leistungAktualisieren(l.id, { unterschrift, unterschriftDatum });
      }
      App.toast(`Unterschrift für ${App.monatsName(parseInt(m))} gespeichert`, 'success');
      this.zurueckZurListe();
    } catch (err) {
      console.error('Fehler:', err);
      App.toast('Fehler beim Speichern', 'error');
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
      betreuung: document.getElementById('leistungBetreuung').checked,
      alltagsbegleitung: document.getElementById('leistungAlltagsbegleitung').checked,
      pflegebegleitung: document.getElementById('leistungPflegebegleitung').checked,
      hauswirtschaft: document.getElementById('leistungHauswirtschaft').checked,
      objektInnen: document.getElementById('leistungObjektInnen').checked,
      objektAussen: document.getElementById('leistungObjektAussen').checked,
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

  zurueckZurListe() {
    if (this.signaturePad) {
      this.signaturePad.destroy?.();
      this.signaturePad = null;
    }
    const container = document.getElementById('leistungContent');
    if (container) {
      container.innerHTML = '<div id="leistungListe"></div>';
      this.init();
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
