/**
 * Blutdruck-Modul fuer entlast.de
 *
 * Dokumentiert Blutdruckmessungen je Kunde und zeigt ihre Entwicklung:
 * Verlaufsdiagramm, Wochen-/Monatsmittel, Trend und Hinweise auf
 * auffällige Werte. Die Bewertung kommt vom Server (Deutsche
 * Hochdruckliga / ESC), damit Backend und Anzeige nicht auseinanderlaufen.
 */

const BlutdruckModule = {
  aktuellerKunde: null,
  zeitraumTage: 90,
  gruppierung: 'auto',
  _verlauf: null,

  async init() {
    const params = new URLSearchParams(window.location.search);
    const kundeId = params.get('kundeId') || params.get('kunde');
    if (kundeId) {
      await this.verlaufAnzeigen(parseInt(kundeId, 10));
    } else {
      await this.uebersichtAnzeigen();
    }
  },

  // Pflegekassen tauchen als "Kunden" auf, haben aber keine Messwerte
  _kassenKeywords: ['aok', 'barmer', 'dak', 'techniker', 'knappschaft', 'bkk', 'novitas',
                    'energie', 'lbv', 'landesamt', 'krankenkasse', 'ersatzkasse', 'pflegekasse'],

  _istKasse(kunde) {
    const name = (kunde.name || '').toLowerCase();
    return this._kassenKeywords.some(kw => name.includes(kw));
  },

  esc(text) {
    if (text === null || text === undefined) return '';
    if (typeof KundenModule !== 'undefined' && KundenModule.escapeHtml) {
      return KundenModule.escapeHtml(String(text));
    }
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  },

  // --- Übersicht: alle Kunden mit ihrem letzten Wert ---

  async uebersichtAnzeigen() {
    const container = document.getElementById('blutdruckContent');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

    let messungen = [];
    let alleKunden = [];
    try {
      [messungen, alleKunden] = await Promise.all([
        DB.alleBlutdruckwerte(),
        DB.alleKunden()
      ]);
    } catch (err) {
      container.innerHTML = `<div class="card text-center text-muted">Fehler beim Laden: ${this.esc(err.message)}</div>`;
      return;
    }

    this.aktuellerKunde = null;
    const kunden = alleKunden.filter(k => !this._istKasse(k) && k.kundentyp !== 'inaktiv');

    // Die Liste kommt absteigend nach Datum — der erste Treffer ist der juengste
    const letzteMessung = {};
    const anzahlProKunde = {};
    messungen.forEach(m => {
      if (!letzteMessung[m.kundeId]) letzteMessung[m.kundeId] = m;
      anzahlProKunde[m.kundeId] = (anzahlProKunde[m.kundeId] || 0) + 1;
    });

    // Kunden mit Messungen zuerst, danach absteigend nach Wert
    const mitWerten = kunden.filter(k => letzteMessung[k.id]);
    const ohneWerte = kunden.filter(k => !letzteMessung[k.id]);
    mitWerten.sort((a, b) => letzteMessung[b.id].systolisch - letzteMessung[a.id].systolisch);

    container.innerHTML = `
      <div class="section-title"><span class="icon">🫀</span> Blutdruck-Dokumentation</div>

      ${mitWerten.length === 0
        ? '<div class="card text-center text-muted">Noch keine Messwerte erfasst. Wähle unten einen Kunden aus.</div>'
        : mitWerten.map(k => {
            const m = letzteMessung[k.id];
            return `
              <div class="list-item" onclick="BlutdruckModule.verlaufAnzeigen(${k.id})">
                <div class="item-avatar" style="background:${m.kategorieFarbe}22; color:${m.kategorieFarbe};">
                  ${App.initialen(k.name, k.vorname)}
                </div>
                <div class="item-content">
                  <div class="item-title">${this.esc(App.kundenName(k))}</div>
                  <div class="item-subtitle">
                    <strong style="color:${m.kategorieFarbe};">${m.systolisch}/${m.diastolisch}</strong> mmHg
                    ${m.puls ? ' | ♥ ' + m.puls : ''}
                    | ${App.formatDatum(m.datum)}
                    | ${anzahlProKunde[k.id]} Messung${anzahlProKunde[k.id] === 1 ? '' : 'en'}
                  </div>
                </div>
                <div class="item-action">›</div>
              </div>
            `;
          }).join('')
      }

      <div class="section-title mt-3"><span class="icon">👥</span> Kunden ohne Messwerte</div>

      <input type="text" id="blutdruckSuche" class="form-control" placeholder="Kunde suchen..."
             oninput="BlutdruckModule.kundenFiltern()" style="margin-bottom:8px;">

      <div id="blutdruckKundenListe">
      ${ohneWerte.length === 0
        ? '<div class="card text-center text-muted">Für alle Kunden liegen Messwerte vor</div>'
        : ohneWerte.map(k => `
            <div class="list-item blutdruck-kunde-item" data-name="${this.esc(App.kundenName(k).toLowerCase())}"
                 onclick="BlutdruckModule.verlaufAnzeigen(${k.id})">
              <div class="item-avatar" style="background: var(--gray-100); color: var(--gray-600);">
                ${App.initialen(k.name, k.vorname)}
              </div>
              <div class="item-content">
                <div class="item-title">${this.esc(App.kundenName(k))}</div>
                <div class="item-subtitle">Noch keine Messung</div>
              </div>
              <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); BlutdruckModule.neueMessung(${k.id})">
                Erfassen
              </button>
            </div>
          `).join('')
      }
      </div>
    `;
  },

  kundenFiltern() {
    const suchfeld = document.getElementById('blutdruckSuche');
    if (!suchfeld) return;
    const begriff = suchfeld.value.toLowerCase().trim();
    document.querySelectorAll('.blutdruck-kunde-item').forEach(item => {
      const name = item.getAttribute('data-name') || '';
      item.style.display = name.includes(begriff) ? '' : 'none';
    });
  },

  // --- Verlauf eines Kunden ---

  async verlaufAnzeigen(kundeId) {
    const container = document.getElementById('blutdruckContent');
    if (!container) return;
    this.aktuellerKunde = kundeId;
    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

    let verlauf;
    try {
      verlauf = await DB.blutdruckVerlauf(kundeId, this.zeitraumTage, this.gruppierung);
    } catch (err) {
      container.innerHTML = `<div class="card text-center text-muted">Fehler beim Laden: ${this.esc(err.message)}</div>`;
      return;
    }
    this._verlauf = verlauf;

    const zeitraeume = [
      { tage: 30, label: '30 Tage' },
      { tage: 90, label: '3 Monate' },
      { tage: 365, label: '1 Jahr' },
      { tage: 3650, label: 'Alles' }
    ];

    container.innerHTML = `
      <div class="card" style="display:flex; align-items:center; gap:12px;">
        <button class="btn btn-sm btn-secondary" onclick="BlutdruckModule.uebersichtAnzeigen()">‹ Übersicht</button>
        <div style="flex:1; font-weight:600;">${this.esc(verlauf.kundeName || 'Kunde')}</div>
        <button class="btn btn-sm btn-primary" onclick="BlutdruckModule.neueMessung(${kundeId})">+ Messung</button>
      </div>

      <div class="btn-group" style="margin-bottom:12px;">
        ${zeitraeume.map(z => `
          <button class="btn btn-sm ${this.zeitraumTage === z.tage ? 'btn-primary' : 'btn-outline'}"
                  onclick="BlutdruckModule.zeitraumWechseln(${z.tage})">${z.label}</button>
        `).join('')}
      </div>

      ${verlauf.anzahl === 0
        ? `<div class="card text-center text-muted">
             Keine Messungen in diesem Zeitraum.
             <div class="mt-2"><button class="btn btn-primary btn-sm" onclick="BlutdruckModule.neueMessung(${kundeId})">Erste Messung erfassen</button></div>
           </div>`
        : this._verlaufHtml(verlauf)
      }
    `;
  },

  _verlaufHtml(v) {
    const d = v.durchschnitt;
    return `
      ${this._warnungenHtml(v.warnungen)}

      <div class="route-summary">
        <div class="summary-item">
          <div class="summary-value" style="color:${v.kategorieFarbe};">${d.systolisch}/${d.diastolisch}</div>
          <div class="summary-label">Mittelwert</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${this._trendPfeil(v.trend.richtung)}</div>
          <div class="summary-label">${this.esc(this._trendWort(v.trend.richtung))}</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${v.anzahl}</div>
          <div class="summary-label">Messungen</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Einstufung: <span style="color:${v.kategorieFarbe};">${this.esc(v.kategorieLabel)}</span></div>
        <div class="text-sm text-muted">
          ${this.esc(v.trend.label)}
          ${v.trend.sysProMonat !== null && v.trend.sysProMonat !== undefined
            ? ` &middot; Tendenz ${v.trend.sysProMonat > 0 ? '+' : ''}${v.trend.sysProMonat} mmHg systolisch pro Monat`
            : ''}
          <br>
          ${v.anteilErhoeht}% der Messungen lagen über 140/90 mmHg &middot;
          Spanne ${v.minSystolisch}–${v.maxSystolisch} systolisch,
          ${v.minDiastolisch}–${v.maxDiastolisch} diastolisch
          ${d.puls ? ' &middot; Puls im Mittel ' + d.puls : ''}
        </div>
      </div>

      <div class="section-title"><span class="icon">📈</span> Verlauf</div>
      <div class="card" style="padding:12px 8px;">
        ${this._chartSvg(v.messungen)}
        <div class="text-sm text-muted text-center" style="margin-top:6px;">
          <span style="color:#dc2626;">■</span> systolisch
          <span style="color:#2563eb; margin-left:10px;">■</span> diastolisch
          <span style="margin-left:10px;">— gestrichelt: Grenzwerte 140/90</span>
        </div>
      </div>

      ${this._periodenHtml(v.perioden)}

      <div class="section-title"><span class="icon">📋</span> Einzelmessungen</div>
      ${[...v.messungen].reverse().map(m => `
        <div class="list-item" onclick="BlutdruckModule.messungBearbeiten(${m.id})">
          <div class="item-avatar" style="background:${m.kategorieFarbe}22; color:${m.kategorieFarbe}; font-size:0.75rem;">
            ${m.systolisch}
          </div>
          <div class="item-content">
            <div class="item-title">${m.systolisch}/${m.diastolisch} mmHg${m.puls ? ' &middot; ♥ ' + m.puls : ''}</div>
            <div class="item-subtitle">
              ${App.formatDatum(m.datum)}${m.zeit ? ', ' + m.zeit + ' Uhr' : ''}
              &middot; <span style="color:${m.kategorieFarbe};">${this.esc(m.kategorieLabel)}</span>
              ${m.notiz ? ' &middot; ' + this.esc(m.notiz) : ''}
            </div>
          </div>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); BlutdruckModule.messungLoeschen(${m.id})">✕</button>
        </div>
      `).join('')}
    `;
  },

  _warnungenHtml(warnungen) {
    if (!warnungen || warnungen.length === 0) return '';
    return `
      <div class="card" style="background:#fef2f2; border-left:4px solid #dc2626;">
        <div style="font-weight:600; margin-bottom:4px;">⚠️ Auffällige Werte</div>
        <ul style="margin:0; padding-left:18px;" class="text-sm">
          ${warnungen.map(w => `<li>${this.esc(w)}</li>`).join('')}
        </ul>
      </div>
    `;
  },

  _trendWort(richtung) {
    const worte = { steigend: 'Steigend', fallend: 'Fallend', stabil: 'Stabil' };
    return worte[richtung] || 'Kein Trend';
  },

  _trendPfeil(richtung) {
    if (richtung === 'steigend') return '<span style="color:#dc2626;">↑</span>';
    if (richtung === 'fallend') return '<span style="color:#16a34a;">↓</span>';
    if (richtung === 'stabil') return '<span style="color:#65a30d;">→</span>';
    return '<span style="color:var(--gray-600);">–</span>';
  },

  _periodenHtml(perioden) {
    if (!perioden || perioden.length < 2) return '';
    return `
      <div class="section-title"><span class="icon">🗓️</span> Mittelwerte je Zeitraum</div>
      <div class="card" style="overflow-x:auto; padding:0;">
        <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
          <thead>
            <tr style="background:var(--gray-100); text-align:left;">
              <th style="padding:8px;">Zeitraum</th>
              <th style="padding:8px;">Mittel</th>
              <th style="padding:8px;">Puls</th>
              <th style="padding:8px;">n</th>
            </tr>
          </thead>
          <tbody>
            ${perioden.map(p => `
              <tr style="border-top:1px solid var(--gray-100);">
                <td style="padding:8px;">${this.esc(p.label)}</td>
                <td style="padding:8px;"><strong>${p.systolisch}/${p.diastolisch}</strong>
                    <span class="text-muted"> ${this.esc(p.kategorieLabel)}</span></td>
                <td style="padding:8px;">${p.puls || '–'}</td>
                <td style="padding:8px;">${p.anzahl}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  // --- Verlaufsdiagramm (inline SVG, keine Chart-Bibliothek noetig) ---

  _chartSvg(messungen) {
    if (!messungen || messungen.length === 0) return '';

    const B = 380, H = 200;                        // Zeichenflaeche (viewBox)
    const padL = 34, padR = 8, padT = 10, padB = 26;
    const innenB = B - padL - padR;
    const innenH = H - padT - padB;

    const werte = messungen.flatMap(m => [m.systolisch, m.diastolisch]);
    // Skala mit etwas Luft, aber immer so, dass 90 und 140 sichtbar bleiben
    const yMax = Math.max(...werte, 150) + 10;
    const yMin = Math.min(...werte, 80) - 10;

    const zeitpunkte = messungen.map(m => new Date(m.datum + 'T00:00:00').getTime());
    const tMin = Math.min(...zeitpunkte);
    const tMax = Math.max(...zeitpunkte);
    const spanne = tMax - tMin;

    const x = i => padL + (spanne === 0
      ? innenB / 2
      : innenB * (zeitpunkte[i] - tMin) / spanne);
    const y = wert => padT + innenH * (yMax - wert) / (yMax - yMin);

    const pfad = feld => messungen
      .map((m, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(m[feld]).toFixed(1)}`)
      .join(' ');

    const punkte = (feld, farbe) => messungen
      .map((m, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(m[feld]).toFixed(1)}" r="2.5" fill="${farbe}"><title>${m.datum}: ${m.systolisch}/${m.diastolisch}</title></circle>`)
      .join('');

    // Y-Achsenbeschriftung in 20er-Schritten
    const achsen = [];
    for (let wert = Math.ceil(yMin / 20) * 20; wert <= yMax; wert += 20) {
      achsen.push(`
        <line x1="${padL}" y1="${y(wert).toFixed(1)}" x2="${B - padR}" y2="${y(wert).toFixed(1)}"
              stroke="#e5e7eb" stroke-width="1"/>
        <text x="${padL - 5}" y="${(y(wert) + 3).toFixed(1)}" font-size="9" fill="#6b7280" text-anchor="end">${wert}</text>
      `);
    }

    const grenze = (wert, farbe) => `
      <line x1="${padL}" y1="${y(wert).toFixed(1)}" x2="${B - padR}" y2="${y(wert).toFixed(1)}"
            stroke="${farbe}" stroke-width="1" stroke-dasharray="4 3" opacity="0.7"/>`;

    const datumKurz = ts => {
      const d = new Date(ts);
      return `${d.getDate()}.${d.getMonth() + 1}.`;
    };

    return `
      <svg viewBox="0 0 ${B} ${H}" width="100%" height="${H}" role="img"
           aria-label="Verlauf der Blutdruckwerte" style="display:block;">
        ${achsen.join('')}
        ${grenze(140, '#dc2626')}
        ${grenze(90, '#2563eb')}
        <path d="${pfad('systolisch')}" fill="none" stroke="#dc2626" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${pfad('diastolisch')}" fill="none" stroke="#2563eb" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round"/>
        ${punkte('systolisch', '#dc2626')}
        ${punkte('diastolisch', '#2563eb')}
        <text x="${padL}" y="${H - 8}" font-size="9" fill="#6b7280">${datumKurz(tMin)}</text>
        <text x="${B - padR}" y="${H - 8}" font-size="9" fill="#6b7280" text-anchor="end">${datumKurz(tMax)}</text>
      </svg>
    `;
  },

  zeitraumWechseln(tage) {
    this.zeitraumTage = tage;
    if (this.aktuellerKunde) this.verlaufAnzeigen(this.aktuellerKunde);
  },

  // --- Formular ---

  // Fuer den Plus-Button: ohne ausgewaehlten Kunden zuerst in die Uebersicht
  async neueMessungFab() {
    if (this.aktuellerKunde) {
      await this.neueMessung(this.aktuellerKunde);
    } else {
      App.toast('Bitte zuerst einen Kunden auswählen', 'info');
      await this.uebersichtAnzeigen();
    }
  },

  async neueMessung(kundeId) {
    this.aktuellerKunde = kundeId;
    const kunde = await DB.kundeById(kundeId);
    this._formAnzeigen(null, kunde);
  },

  async messungBearbeiten(id) {
    const messung = await DB.blutdruckById(id);
    if (!messung) return;
    const kunde = await DB.kundeById(messung.kundeId);
    this._formAnzeigen(messung, kunde);
  },

  _formAnzeigen(messung, kunde) {
    const container = document.getElementById('blutdruckContent');
    if (!container) return;

    const jetzt = new Date();
    const uhrzeit = `${String(jetzt.getHours()).padStart(2, '0')}:${String(jetzt.getMinutes()).padStart(2, '0')}`;

    container.innerHTML = `
      <div class="card">
        <h3 class="card-title mb-2">${messung ? 'Messung bearbeiten' : 'Neue Messung'}</h3>
        <div class="text-sm text-muted" style="margin-bottom:12px;">
          ${this.esc(kunde ? App.kundenName(kunde) : '')}
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="bdSystolisch">Systolisch (oben) *</label>
            <input type="number" id="bdSystolisch" class="form-control" inputmode="numeric"
                   min="50" max="300" placeholder="z.B. 135"
                   value="${messung ? messung.systolisch : ''}">
          </div>
          <div class="form-group">
            <label for="bdDiastolisch">Diastolisch (unten) *</label>
            <input type="number" id="bdDiastolisch" class="form-control" inputmode="numeric"
                   min="20" max="200" placeholder="z.B. 85"
                   value="${messung ? messung.diastolisch : ''}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="bdPuls">Puls (optional)</label>
            <input type="number" id="bdPuls" class="form-control" inputmode="numeric"
                   min="20" max="250" placeholder="z.B. 72"
                   value="${messung && messung.puls ? messung.puls : ''}">
          </div>
          <div class="form-group">
            <label for="bdZeit">Uhrzeit</label>
            <input type="time" id="bdZeit" class="form-control"
                   value="${messung && messung.zeit ? messung.zeit : uhrzeit}">
          </div>
        </div>

        <div class="form-group">
          <label for="bdDatum">Datum</label>
          <input type="date" id="bdDatum" class="form-control"
                 value="${messung ? messung.datum : App.heute()}">
        </div>

        <div class="form-group">
          <label for="bdNotiz">Notiz</label>
          <textarea id="bdNotiz" class="form-control" rows="2"
                    placeholder="z.B. vor dem Frühstück, nach Ruhepause...">${messung ? this.esc(messung.notiz || '') : ''}</textarea>
        </div>

        <div class="form-hint">
          Gesundheitsdaten &ndash; nur mit Einwilligung des Versicherten erfassen.
        </div>
      </div>

      <div class="btn-group">
        <button class="btn btn-primary btn-block" onclick="BlutdruckModule.messungSpeichern(${messung ? messung.id : 'null'}, ${kunde ? kunde.id : 'null'})">
          Speichern
        </button>
        <button class="btn btn-secondary" onclick="BlutdruckModule.verlaufAnzeigen(${kunde ? kunde.id : 'null'})">
          Abbrechen
        </button>
      </div>
    `;
  },

  async messungSpeichern(id, kundeId) {
    const systolisch = parseInt(document.getElementById('bdSystolisch').value, 10);
    const diastolisch = parseInt(document.getElementById('bdDiastolisch').value, 10);
    const pulsRoh = document.getElementById('bdPuls').value;

    if (!systolisch || !diastolisch) {
      App.toast('Bitte systolischen und diastolischen Wert eingeben', 'error');
      return;
    }
    if (systolisch <= diastolisch) {
      App.toast('Der obere Wert muss größer als der untere sein', 'error');
      return;
    }

    const daten = {
      kundeId: kundeId,
      datum: document.getElementById('bdDatum').value,
      zeit: document.getElementById('bdZeit').value || null,
      systolisch: systolisch,
      diastolisch: diastolisch,
      puls: pulsRoh ? parseInt(pulsRoh, 10) : null,
      notiz: document.getElementById('bdNotiz').value.trim() || null
    };

    try {
      if (id) {
        await DB.blutdruckAktualisieren(id, daten);
      } else {
        await DB.blutdruckHinzufuegen(daten);
      }
      App.toast('Messung gespeichert', 'success');
      this.verlaufAnzeigen(kundeId);
    } catch (err) {
      App.toast(`Fehler beim Speichern: ${err.message}`, 'error');
    }
  },

  async messungLoeschen(id) {
    if (!await App.confirm('Messung wirklich löschen?')) return;
    try {
      await DB.blutdruckLoeschen(id);
      App.toast('Gelöscht', 'success');
      if (this.aktuellerKunde) this.verlaufAnzeigen(this.aktuellerKunde);
    } catch (err) {
      App.toast('Fehler beim Löschen', 'error');
    }
  }
};

if (window._entlastReady && window.FIRMA) { BlutdruckModule.init(); }
else { document.addEventListener('entlast-ready', () => BlutdruckModule.init()); }
