/**
 * TagesabschlussModule — "Tag abschliessen" fuer entlast.de
 *
 * Fragt "War der Tag genauso wie geplant?" und erzeugt fuer alle Kunden-Termine
 * eines Tages Leistungsnachweise (Tabelle leistungen) + die Tagestour-Fahrt mit
 * km (Tabelle fahrten). Bei "Nein" oeffnet sich eine Bearbeitungsansicht.
 *
 * Abhaengig nur von DB, App und Geo (kein KundenModule/FahrtenModule) — laeuft
 * daher sowohl auf termine.html als auch auf der Startseite (index.html).
 */
const TagesabschlussModule = {
  _laeuft: false,

  // Eigener HTML-Escaper (KundenModule ist nicht auf allen Seiten geladen)
  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  },

  _istFeiertag(t) {
    return (t.notiz || '').toLowerCase().includes('feiertag');
  },

  // Kunden-Termine eines Tages laden (gefiltert: echter Kunde, kein Feiertag)
  async _ladenTag(datum) {
    const [termine, kunden] = await Promise.all([
      DB.termineFuerDatum(datum), DB.alleKunden()
    ]);
    const kundenMap = {};
    kunden.forEach(k => { kundenMap[k.id] = k; });
    const kundenTermine = (termine || []).filter(t =>
      t.kundeId && kundenMap[t.kundeId] && !this._istFeiertag(t)
    );
    return { kundenTermine, kunden, kundenMap };
  },

  // === Einstieg ===
  async starten(datum) {
    if (this._laeuft) return;
    let daten;
    try {
      daten = await this._ladenTag(datum);
    } catch (e) {
      App.toast('Tag konnte nicht geladen werden', 'error');
      return;
    }
    if (daten.kundenTermine.length === 0) {
      App.toast('Keine Kunden-Termine an diesem Tag', 'info');
      return;
    }
    this._dialogZeigen(datum, daten.kundenTermine, daten.kunden);
  },

  // === Drei-Knopf-Dialog ===
  _dialogZeigen(datum, termine, kunden) {
    this._overlayEntfernen();
    const overlay = document.createElement('div');
    overlay.id = 'tagesabschlussOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:600;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const datumLabel = App.wochentagName(datum) + ', ' + App.formatDatum(datum);
    overlay.innerHTML = `
      <div style="background:white;border-radius:12px;padding:20px;width:340px;max-width:100%;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
        <strong style="font-size:1.05rem;">Tag abschlie&szlig;en</strong>
        <p style="margin:10px 0 4px;">War der <b>${this._esc(datumLabel)}</b> genauso wie geplant?</p>
        <p class="text-sm text-muted" style="margin:0 0 16px;">${termine.length} Kunden-Termin(e) &rarr; Leistungsnachweise + Kilometer werden erstellt.</p>
        <button class="btn btn-primary btn-block" id="taJa" style="margin-bottom:8px;">&#x2713; Ja, alles wie geplant</button>
        <button class="btn btn-secondary btn-block" id="taNein" style="margin-bottom:8px;">&#x270E; Nein, bearbeiten</button>
        <button class="btn btn-block" id="taAbbruch" style="background:var(--gray-100);">Abbrechen</button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('taAbbruch').onclick = () => overlay.remove();
    document.getElementById('taJa').onclick = () => { overlay.remove(); this._abschliessenAuto(datum, termine, kunden); };
    document.getElementById('taNein').onclick = () => { overlay.remove(); this._bearbeitungsansicht(datum, termine, kunden); };
  },

  // === JA: vollautomatisch ===
  async _abschliessenAuto(datum, termine, kunden) {
    if (this._laeuft) return;
    this._laeuft = true;
    App.toast('Tag wird abgeschlossen – Kilometer werden berechnet …', 'info', 8000);
    try {
      const r = await this._erzeugen(datum, termine, kunden);
      this._ergebnisToast(r);
    } catch (e) {
      console.error('Tagesabschluss-Fehler:', e);
      App.toast('Fehler beim Tagesabschluss', 'error');
    } finally {
      this._laeuft = false;
    }
  },

  // === Gemeinsamer Kern: Leistungen + Fahrt erzeugen ===
  async _erzeugen(datum, termine, kunden) {
    const kundenMap = {};
    kunden.forEach(k => { kundenMap[k.id] = k; });

    // --- A) Leistungen (mit Duplikat-Check kundeId-datum) ---
    const vorhandene = await DB.alleLeistungen();
    const leistungSet = new Set((vorhandene || []).map(l => `${l.kundeId}-${l.datum}`));
    let leistungenNeu = 0, leistungenSkip = 0;
    const ohneZeit = [], fehler = [];
    for (const t of termine) {
      const key = `${t.kundeId}-${datum}`;
      if (leistungSet.has(key)) { leistungenSkip++; continue; }
      const von = t.startzeit || t.von;
      const bis = t.endzeit || t.bis;
      const name = kundenMap[t.kundeId] ? App.kundenName(kundenMap[t.kundeId]) : 'Termin';
      if (!von || !bis) { ohneZeit.push(name); continue; }
      try {
        await DB.leistungHinzufuegen({
          kundeId: t.kundeId, datum: datum,
          startzeit: von, endzeit: bis,
          notiz: t.titel || ''
        });
        leistungSet.add(key); // verhindert Selbst-Duplikat bei Doppel-Kunde
        leistungenNeu++;
      } catch (e) {
        console.warn('Leistung-Fehler:', name, e);
        fehler.push(name);
      }
    }

    // --- B) Fahrt (Tagestour, nur wenn fuer den Tag noch keine existiert) ---
    let fahrtNeu = false, fahrtSkip = false, km = null, kmFehlend = [];
    const alleFahrten = await DB.alleFahrten();
    if ((alleFahrten || []).some(f => f.datum === datum)) {
      fahrtSkip = true;
    } else {
      // Kunden nach Startzeit sortieren, dann pro Kunde deduplizieren
      const sortiert = termine
        .filter(t => kundenMap[t.kundeId])
        .map(t => ({ kunde: kundenMap[t.kundeId], von: t.startzeit || t.von || '99:99' }))
        .sort((a, b) => a.von.localeCompare(b.von));
      const gesehen = new Set();
      const eindeutig = sortiert.filter(x => {
        if (gesehen.has(x.kunde.id)) return false;
        gesehen.add(x.kunde.id); return true;
      });
      const startAdresse = (window.FIRMA || {}).startAdresse || 'Kreisstraße 12, 45525 Hattingen';
      const zielAdressen = eindeutig
        .map(x => [x.kunde.strasse, x.kunde.plz, x.kunde.ort].filter(Boolean).join(', '))
        .filter(Boolean);
      if (zielAdressen.length > 0) {
        const erg = await Geo.tourKm(startAdresse, zielAdressen);
        if (erg) {
          kmFehlend = erg.fehlend || [];
          if (erg.km > 0) {
            const kmSatz = (window.FIRMA || {}).kmSatz || 0.30;
            const namen = eindeutig.map(x => App.kundenName(x.kunde).split(',')[0].trim());
            try {
              await DB.fahrtHinzufuegen({
                datum: datum,
                wochentag: App.wochentagName(datum),
                startAdresse: startAdresse,
                zielAdressen: zielAdressen,
                gesamtKm: erg.km,
                betrag: Math.round(erg.km * kmSatz * 100) / 100,
                notiz: 'Tagestour: ' + namen.join(' → ')
              });
              fahrtNeu = true; km = erg.km;
            } catch (e) {
              console.warn('Fahrt-Fehler:', e);
              fehler.push('Fahrt');
            }
          }
        }
      }
    }

    return { leistungenNeu, leistungenSkip, ohneZeit, fahrtNeu, fahrtSkip, km, kmFehlend, fehler };
  },

  _ergebnisToast(r) {
    const teile = [`${r.leistungenNeu} Leistung(en)` + (r.leistungenSkip ? ` (${r.leistungenSkip} schon da)` : '')];
    if (r.fahrtNeu) teile.push(`Fahrt ${String(r.km).replace('.', ',')} km`);
    else if (r.fahrtSkip) teile.push('Fahrt bereits erfasst');
    App.toast('Tag abgeschlossen: ' + teile.join(', '), 'success');
    if (r.ohneZeit && r.ohneZeit.length) App.toast('Ohne Uhrzeit übersprungen: ' + r.ohneZeit.join(', '), 'info', 7000);
    if (r.kmFehlend && r.kmFehlend.length) App.toast('Adresse nicht gefunden (km evtl. zu niedrig): ' + r.kmFehlend.join(', '), 'info', 8000);
    if (r.fehler && r.fehler.length) App.toast('Fehler bei: ' + r.fehler.join(', '), 'error', 8000);
    // Seiten benachrichtigen (Termin-Ansicht refresht, Startseite reloaded)
    try { window.dispatchEvent(new CustomEvent('tagesabschluss-fertig')); } catch (e) { /* ignore */ }
  },

  // === NEIN: Bearbeitungsansicht ===
  _bearbeitungsansicht(datum, termine, kunden) {
    this._overlayEntfernen();
    const echteKunden = App.echteKunden(kunden);
    const overlay = document.createElement('div');
    overlay.id = 'tagesabschlussOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:600;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const datumLabel = App.wochentagName(datum) + ', ' + App.formatDatum(datum);
    const bloecke = termine.map((t, i) => {
      const von = t.startzeit || t.von || '';
      const bis = t.endzeit || t.bis || '';
      const kundenOptions = echteKunden.map(k =>
        `<option value="${k.id}" ${k.id === t.kundeId ? 'selected' : ''}>${this._esc(App.kundenName(k))}</option>`
      ).join('');
      return `
        <div class="ta-block" data-idx="${i}" style="border:1px solid var(--gray-200,#e0e0e0);border-radius:8px;padding:10px;margin-bottom:8px;">
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-weight:600;">
            <input type="checkbox" class="ta-statt" checked onchange="this.closest('.ta-block').style.opacity=this.checked?'1':'0.45'"> stattgefunden
          </label>
          <select class="ta-kunde form-control" style="margin-bottom:6px;">${kundenOptions}</select>
          <div style="display:flex;gap:6px;">
            <input type="time" class="ta-von form-control" value="${von}" style="flex:1;">
            <input type="time" class="ta-bis form-control" value="${bis}" style="flex:1;">
          </div>
        </div>
      `;
    }).join('');
    overlay.innerHTML = `
      <div style="background:white;border-radius:12px;padding:20px;width:440px;max-width:100%;margin:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="font-size:1.05rem;">Tag bearbeiten &ndash; ${this._esc(datumLabel)}</strong>
          <button type="button" id="taSchliessen" style="background:none;border:none;font-size:1.3rem;cursor:pointer;">&#x2715;</button>
        </div>
        <p class="text-sm text-muted" style="margin:0 0 12px;">Zeiten/Kunde anpassen oder Termine abw&auml;hlen, dann erzeugen.</p>
        ${bloecke}
        <button class="btn btn-primary btn-block" id="taErzeugen" style="margin-top:8px;">Leistungen + Fahrt erzeugen</button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('taSchliessen').onclick = () => overlay.remove();
    document.getElementById('taErzeugen').onclick = () => this._bearbeitenSpeichern(datum, kunden);
  },

  async _bearbeitenSpeichern(datum, kunden) {
    const bloecke = [...document.querySelectorAll('#tagesabschlussOverlay .ta-block')];
    const termine = [];
    for (const b of bloecke) {
      if (!b.querySelector('.ta-statt').checked) continue;
      const kundeId = parseInt(b.querySelector('.ta-kunde').value);
      const von = b.querySelector('.ta-von').value;
      const bis = b.querySelector('.ta-bis').value;
      if (!kundeId || !von || !bis) {
        App.toast('Bei allen aktiven Terminen Kunde, Start und Ende ausfüllen', 'error');
        return;
      }
      termine.push({ kundeId, startzeit: von, endzeit: bis, titel: '' });
    }
    if (termine.length === 0) { App.toast('Keine Termine ausgewählt', 'info'); return; }
    this._overlayEntfernen();
    if (this._laeuft) return;
    this._laeuft = true;
    App.toast('Wird erstellt – Kilometer werden berechnet …', 'info', 8000);
    try {
      const r = await this._erzeugen(datum, termine, kunden);
      this._ergebnisToast(r);
    } catch (e) {
      console.error('Tagesabschluss-Fehler:', e);
      App.toast('Fehler beim Erstellen', 'error');
    } finally {
      this._laeuft = false;
    }
  },

  _overlayEntfernen() {
    const alt = document.getElementById('tagesabschlussOverlay');
    if (alt) alt.remove();
  },

  // === Status fuer Button-Beschriftung: {gesamt, offen} ===
  async _status(datum) {
    try {
      const [termine, kunden, leistungen] = await Promise.all([
        DB.termineFuerDatum(datum), DB.alleKunden(), DB.alleLeistungen()
      ]);
      const kundenMap = {};
      kunden.forEach(k => { kundenMap[k.id] = k; });
      const kt = (termine || []).filter(t => t.kundeId && kundenMap[t.kundeId] && !this._istFeiertag(t));
      const leistungSet = new Set((leistungen || []).map(l => `${l.kundeId}-${l.datum}`));
      const kundenIds = new Set(kt.map(t => t.kundeId));
      let offen = 0;
      kundenIds.forEach(id => { if (!leistungSet.has(`${id}-${datum}`)) offen++; });
      return { gesamt: kundenIds.size, offen };
    } catch (e) {
      return { gesamt: 0, offen: 0 };
    }
  }
};
