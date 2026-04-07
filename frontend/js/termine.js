/**
 * Terminplaner-Modul für Susi's Alltagshilfe
 */

const TermineModule = {
  currentWeekStart: null,
  kundenFarben: {},
  farben: ['#E91E7B', '#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#00BCD4', '#FF5722', '#607D8B'],

  istLetzterImMonat(termin, displayDatum) {
    if (!termin.wiederkehrend) return false;
    const muster = termin.wiederholungsMuster || termin.wiederholungs_muster || {};
    const intervall = muster.intervall || 1;
    const datum = new Date((displayDatum || termin.datum) + 'T00:00:00');
    const naechster = new Date(datum);
    naechster.setDate(naechster.getDate() + 7 * intervall);
    return naechster.getMonth() !== datum.getMonth();
  },

  async init() {
    this.currentWeekStart = App.getMontag(new Date());
    const params = new URLSearchParams(window.location.search);
    this._preselectedKundeId = params.get('kundeId');
    if (this._preselectedKundeId) {
      window.history.replaceState({}, '', window.location.pathname);
      const kunden = await DB.alleKunden();
      this.terminFormAnzeigen(null, kunden, App.heute(), '09:00');
    } else {
      await this.kalenderAnzeigen();
    }
    // Google-Kalender im Hintergrund synchronisieren
    apiFetch('/termine/google-sync', { method: 'POST' }).then(r => {
      if (r.neu > 0) { App.toast(`${r.neu} neue Termine aus Google importiert`, 'success'); this.kalenderAnzeigen(); }
    }).catch(() => {});
  },

  async kalenderAnzeigen() {
    const container = document.getElementById('termineContent');
    if (!container) return;

    const montag = new Date(this.currentWeekStart);
    const freitag = new Date(montag);
    freitag.setDate(freitag.getDate() + 4);

    // Alle Termine + Leistungen + Fahrten laden
    const termine = await DB.alleTermine();
    const kunden = await DB.alleKunden();
    const leistungen = await DB.alleLeistungen();
    const fahrten = await DB.alleFahrten();
    const kundenMap = {};
    kunden.forEach(k => kundenMap[k.id] = k);

    // Sets für schnelle Prüfung: "kundeId-datum"
    const leistungSet = new Set(leistungen.map(l => `${l.kundeId}-${l.datum}`));
    const fahrtSet = new Set();
    fahrten.forEach(f => {
      if (f.zielAdressen && f.datum) {
        fahrtSet.add(f.datum);
      }
    });

    // Farben zuweisen
    kunden.forEach((k, i) => {
      this.kundenFarben[k.id] = this.farben[i % this.farben.length];
    });

    // Wochentage
    const tage = [];
    for (let i = 0; i < 5; i++) {
      const tag = new Date(montag);
      tag.setDate(tag.getDate() + i);
      tage.push(tag);
    }

    // Termine für diese Woche filtern (inkl. wiederkehrende + Geburtstage)
    const wochenTermine = this.termineFiltern(termine, tage);

    // Geburtstage dieser Woche einfügen
    kunden.forEach(k => {
      if (!k.geburtstag) return;
      const gbParts = k.geburtstag.split('-'); // YYYY-MM-DD
      if (gbParts.length < 3) return;
      const gbMD = `${gbParts[1]}-${gbParts[2]}`; // MM-DD
      tage.forEach(tag => {
        const tagStr = App.localDateStr(tag);
        if (tagStr.substring(5) === gbMD) {
          const alter = tag.getFullYear() - parseInt(gbParts[0]);
          wochenTermine.push({
            _geburtstag: true,
            _displayDatum: tagStr,
            kundeId: k.id,
            titel: `🎂 ${App.kundenName(k)} wird ${alter}`,
            startzeit: '00:00',
            endzeit: '',
            wiederkehrend: false
          });
        }
      });
    });

    // Zeitslots (8:00 - 18:00)
    const zeitSlots = [];
    for (let h = 8; h <= 18; h++) {
      zeitSlots.push(`${String(h).padStart(2, '0')}:00`);
    }

    container.innerHTML = `
      <!-- Wochennavigation -->
      <div class="week-nav">
        <button onclick="TermineModule.vorherigeWoche()">◀</button>
        <span class="week-label">
          ${App.formatDatum(App.localDateStr(montag))} - ${App.formatDatum(App.localDateStr(freitag))}
        </span>
        <button onclick="TermineModule.naechsteWoche()">▶</button>
      </div>

      <!-- Heute-Button -->
      <div class="text-center mb-2">
        <button class="btn btn-sm btn-outline" onclick="TermineModule.zuHeute()">
          Heute
        </button>
      </div>

      <!-- Kalender-Grid -->
      <div style="overflow-x: auto;">
        <div class="week-header">
          <div>Zeit</div>
          ${tage.map(t => {
            const tagDatum = App.localDateStr(t);
            const istHeute = tagDatum === App.heute();
            const feiertag = wochenTermine.find(te => (te._displayDatum || te.datum) === tagDatum && (te.notiz || '').toLowerCase().includes('feiertag'));
            const bgStyle = feiertag ? 'background:#dc2626;color:#fff;' : istHeute ? 'background: var(--primary-dark);' : '';
            return `<div style="${bgStyle}">${App.wochentagKurz(App.localDateStr(t))}<br><small>${t.getDate()}.${t.getMonth()+1}.</small>${feiertag ? '<br><small style=\"font-size:0.55rem;\">'+feiertag.titel+'</small>' : ''}</div>`;
          }).join('')}
        </div>

        <div class="week-grid">
          ${zeitSlots.map(zeit => {
            const stunde = parseInt(zeit);
            return `
              <div class="time-slot" style="font-weight: 600;">${zeit}</div>
              ${tage.map(tag => {
                const datumStr = App.localDateStr(tag);
                const istFeiertag = wochenTermine.some(te => (te._displayDatum || te.datum) === datumStr && (te.notiz || '').toLowerCase().includes('feiertag'));
                const slotTermine = wochenTermine.filter(t => {
                  const tDatum = t._displayDatum || t.datum;
                  const tStunde = parseInt(t.startzeit);
                  return tDatum === datumStr && tStunde === stunde;
                });
                return `
                  <div class="time-slot" style="${istFeiertag ? 'background:#fef2f2;opacity:0.5;' : ''}" onclick="TermineModule.neuerTermin('${datumStr}', '${zeit}')">
                    ${slotTermine.map(t => {
                      const kunde = kundenMap[t.kundeId];
                      const farbe = istFeiertag ? '#999' : (this.kundenFarben[t.kundeId] || '#E91E7B');
                      const unterschriftBadge = TermineModule.istLetzterImMonat(t, datumStr) ? ' <span style="background:#ea580c;color:#fff;font-size:0.6rem;padding:1px 3px;border-radius:3px;white-space:nowrap;">\u270D\uFE0F Unterschrift</span>' : '';
                      const hatLeistung = t.kundeId && leistungSet.has(`${t.kundeId}-${datumStr}`);
                      const hatFahrt = fahrtSet.has(datumStr);
                      const quickButtons = kunde && t.kundeId ? `
                          <div style="display:flex;gap:2px;margin-top:2px;">
                            ${hatLeistung
                              ? `<span style="font-size:0.7rem;background:#ccc;color:#fff;padding:4px 8px;border-radius:4px;min-height:28px;display:inline-flex;align-items:center;">✓L</span>`
                              : `<a href="leistung.html?kundeId=${t.kundeId}&datum=${datumStr}&von=${t.startzeit || ''}&bis=${t.endzeit || ''}"
                                 onclick="event.stopPropagation();"
                                 style="font-size:0.7rem;background:${farbe};color:#fff;padding:4px 8px;border-radius:4px;text-decoration:none;min-height:28px;display:inline-flex;align-items:center;">→L</a>`}
                            ${hatFahrt
                              ? `<span style="font-size:0.7rem;background:#ccc;color:#fff;padding:4px 8px;border-radius:4px;min-height:28px;display:inline-flex;align-items:center;">✓km</span>`
                              : `<a href="fahrten.html?kundeId=${t.kundeId}&datum=${datumStr}"
                                 onclick="event.stopPropagation();"
                                 style="font-size:0.7rem;background:#666;color:#fff;padding:4px 8px;border-radius:4px;text-decoration:none;min-height:28px;display:inline-flex;align-items:center;">→km</a>`}
                          </div>` : '';
                      return `
                        <div class="calendar-event" style="border-left-color: ${farbe}; background: ${farbe}15;"
                             onclick="event.stopPropagation(); TermineModule.terminBearbeiten(${t.id})">
                          <div class="event-title" style="color: ${farbe};">${kunde ? App.kundenName(kunde) : (t.titel || 'Termin')}${unterschriftBadge}</div>
                          <div class="event-time">${App.formatZeit(t.startzeit)}-${App.formatZeit(t.endzeit)}${quickButtons}</div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                `;
              }).join('')}
            `;
          }).join('')}
        </div>
      </div>

      <!-- Terminliste für schnellen Überblick -->
      <div class="section-title mt-3"><span class="icon">📋</span> Termine diese Woche</div>
      ${wochenTermine.length === 0
        ? '<div class="card text-center text-muted">Keine Termine in dieser Woche</div>'
        : wochenTermine.sort((a, b) => {
            const dA = a._displayDatum || a.datum;
            const dB = b._displayDatum || b.datum;
            return dA.localeCompare(dB) || a.startzeit.localeCompare(b.startzeit);
          }).map(t => {
            const kunde = kundenMap[t.kundeId];
            const istFeiertagTermin = (t.notiz || '').toLowerCase().includes('feiertag');
            const farbe = istFeiertagTermin ? '#999' : (this.kundenFarben[t.kundeId] || '#E91E7B');
            const displayDatum = t._displayDatum || t.datum;
            return `
              <div class="list-item" style="${istFeiertagTermin ? 'opacity:0.4;' : ''}" onclick="TermineModule.terminBearbeiten(${t.id})">
                <div class="item-avatar" style="background: ${farbe}20; color: ${farbe};">
                  ${kunde ? App.initialen(kunde.name, kunde.vorname) : '?'}
                </div>
                <div class="item-content">
                  <div class="item-title">${kunde ? App.kundenName(kunde) : (t.titel || 'Termin')}</div>
                  <div class="item-subtitle">
                    ${App.wochentagKurz(displayDatum)} ${App.formatDatum(displayDatum)} |
                    ${App.formatZeit(t.startzeit)} - ${App.formatZeit(t.endzeit)}
                    ${t.wiederkehrend ? ' | \uD83D\uDD04' : ''}
                    ${TermineModule.istLetzterImMonat(t, displayDatum) ? ' <span style="background:#ea580c;color:#fff;font-size:0.65rem;padding:1px 4px;border-radius:3px;">\u270D\uFE0F Unterschrift</span>' : ''}
                  </div>
                </div>
                <div class="item-action">›</div>
              </div>
            `;
          }).join('')
      }

      ${typeof GCalSync !== 'undefined' ? GCalSync.renderSyncBar() : ''}
    `;
  },

  termineFiltern(termine, tage) {
    const ergebnis = [];
    const tagStrings = tage.map(t => App.localDateStr(t));
    const wochentage = tage.map(t => t.getDay()); // 0=So, 1=Mo, ...

    for (const termin of termine) {
      if (termin.wiederkehrend) {
        // Wiederkehrende Termine
        const muster = termin.wiederholungsMuster || {};
        if (muster.wochentag !== undefined) {
          const idx = wochentage.indexOf(muster.wochentag);
          if (idx !== -1) {
            // Intervall pruefen (alle X Wochen ab Startdatum)
            const intervall = muster.intervall || 1;
            if (intervall > 1 && termin.datum) {
              const start = new Date(termin.datum);
              const zielTag = new Date(tagStrings[idx]);
              const diffMs = zielTag - start;
              const diffWochen = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
              if (diffWochen < 0 || diffWochen % intervall !== 0) continue;
            }
            const klon = { ...termin, _displayDatum: tagStrings[idx] };
            ergebnis.push(klon);
          }
        }
      } else {
        // Einmalige Termine in dieser Woche
        if (tagStrings.includes(termin.datum)) {
          ergebnis.push(termin);
        }
      }
    }

    return ergebnis;
  },

  async neuerTermin(datum, zeit) {
    const kunden = await DB.alleKunden();
    this.terminFormAnzeigen(null, kunden, datum, zeit);
  },

  async terminBearbeiten(id) {
    const termin = await DB.terminById(id);
    if (!termin) return;
    const kunden = await DB.alleKunden();
    this.terminFormAnzeigen(termin, kunden);
  },

  terminFormAnzeigen(termin = null, kunden = [], datum = '', zeit = '') {
    const container = document.getElementById('termineContent');
    if (!container) return;

    const preselect = this._preselectedKundeId ? parseInt(this._preselectedKundeId) : null;
    const echteKunden = App.echteKunden(kunden);
    const kundenOptions = echteKunden.map(k => {
      const selected = (termin && termin.kundeId === k.id) || (!termin && preselect === k.id);
      return `<option value="${k.id}" ${selected ? 'selected' : ''}>${KundenModule.escapeHtml(App.kundenName(k))}</option>`;
    }).join('');
    if (preselect) this._preselectedKundeId = null;

    const wochentagOptions = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
      .map((t, i) => {
        if (i === 0) return '<option value="">-- Wochentag wählen --</option>';
        const val = i; // 1=Mo, 2=Di, ...
        const selected = termin && termin.wiederholungsMuster && termin.wiederholungsMuster.wochentag === val;
        return `<option value="${val}" ${selected ? 'selected' : ''}>${t}</option>`;
      }).join('');

    container.innerHTML = `
      <div class="card">
        <h3 class="card-title mb-2">${termin ? 'Termin bearbeiten' : 'Neuer Termin'}</h3>

        <div class="form-group">
          <label for="terminKunde">Kunde</label>
          <select id="terminKunde" class="form-control">
            <option value="">-- Optional: Kunde wählen --</option>
            ${kundenOptions}
          </select>
        </div>

        <div class="form-group">
          <label for="terminTitel">Titel</label>
          <input type="text" id="terminTitel" class="form-control"
                 value="${termin ? KundenModule.escapeHtml(termin.titel || '') : ''}"
                 placeholder="Terminbezeichnung">
        </div>

        <div class="form-group">
          <label for="terminDatum">Datum</label>
          <input type="date" id="terminDatum" class="form-control"
                 value="${termin ? termin.datum : datum || App.heute()}">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="terminStart">Beginn</label>
            <input type="time" id="terminStart" class="form-control"
                   value="${termin ? termin.startzeit : zeit || '09:00'}">
          </div>
          <div class="form-group">
            <label for="terminEnde">Ende</label>
            <input type="time" id="terminEnde" class="form-control"
                   value="${termin ? termin.endzeit : ''}">
          </div>
        </div>

        <div class="form-check">
          <input type="checkbox" id="terminWiederkehrend"
                 ${termin && termin.wiederkehrend ? 'checked' : ''}
                 onchange="document.getElementById('wiederholungContainer').classList.toggle('hidden')">
          <label for="terminWiederkehrend">Wiederkehrender Termin</label>
        </div>

        <div id="wiederholungContainer" class="${termin && termin.wiederkehrend ? '' : 'hidden'}">
          <div class="form-group">
            <label for="terminWochentag">Jeden</label>
            <select id="terminWochentag" class="form-control">
              ${wochentagOptions}
            </select>
          </div>
          <div class="form-group">
            <label for="terminIntervall">Wiederholung</label>
            <select id="terminIntervall" class="form-control">
              <option value="1" ${termin && termin.wiederholungsMuster && termin.wiederholungsMuster.intervall === 1 ? 'selected' : ''}>Wöchentlich</option>
              <option value="2" ${termin && termin.wiederholungsMuster && termin.wiederholungsMuster.intervall === 2 ? 'selected' : ''}>Alle 2 Wochen</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label for="terminNotizen">Notizen</label>
          <textarea id="terminNotizen" class="form-control" rows="2"
                    placeholder="Optionale Notizen...">${termin ? KundenModule.escapeHtml(termin.notizen || '') : ''}</textarea>
        </div>
      </div>

      <div class="btn-group">
        <button class="btn btn-primary btn-block" onclick="TermineModule.terminSpeichern(${termin ? termin.id : 'null'})">
          Speichern
        </button>
        <button class="btn btn-secondary" onclick="TermineModule.kalenderAnzeigen()">
          Abbrechen
        </button>
        ${termin ? `
          <button class="btn btn-danger btn-sm" onclick="TermineModule.terminLoeschen(${termin.id})">
            Löschen
          </button>
        ` : ''}
      </div>
    `;
  },

  async terminSpeichern(id) {
    const wiederkehrend = document.getElementById('terminWiederkehrend').checked;
    const wochentag = parseInt(document.getElementById('terminWochentag').value) || 0;
    const intervall = parseInt(document.getElementById('terminIntervall').value) || 1;

    const daten = {
      kundeId: parseInt(document.getElementById('terminKunde').value) || null,
      titel: document.getElementById('terminTitel').value.trim(),
      datum: document.getElementById('terminDatum').value,
      startzeit: document.getElementById('terminStart').value,
      endzeit: document.getElementById('terminEnde').value,
      wiederkehrend: wiederkehrend ? 1 : 0,
      wiederholungsMuster: wiederkehrend ? { wochentag, intervall } : null,
      notizen: document.getElementById('terminNotizen').value.trim()
    };

    if (!daten.startzeit) {
      App.toast('Bitte eine Startzeit angeben', 'error');
      return;
    }

    try {
      if (id) {
        await DB.terminAktualisieren(id, daten);
        App.toast('Termin aktualisiert', 'success');
      } else {
        await DB.terminHinzufuegen(daten);
        App.toast('Termin gespeichert', 'success');
      }
      this.kalenderAnzeigen();
    } catch (err) {
      console.error('Fehler:', err);
      App.toast('Fehler beim Speichern', 'error');
    }
  },

  async terminLoeschen(id) {
    if (!await App.confirm('Termin wirklich löschen?')) return;
    try {
      await DB.terminLoeschen(id);
      App.toast('Termin gelöscht', 'success');
      this.kalenderAnzeigen();
    } catch (err) {
      App.toast('Fehler beim Löschen', 'error');
    }
  },

  vorherigeWoche() {
    this.currentWeekStart.setDate(this.currentWeekStart.getDate() - 7);
    this.kalenderAnzeigen();
  },

  naechsteWoche() {
    this.currentWeekStart.setDate(this.currentWeekStart.getDate() + 7);
    this.kalenderAnzeigen();
  },

  zuHeute() {
    this.currentWeekStart = App.getMontag(new Date());
    this.kalenderAnzeigen();
  }
};

if (window._entlastReady && window.FIRMA) { TermineModule.init(); }
else { document.addEventListener('entlast-ready', () => TermineModule.init()); }
