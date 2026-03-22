/**
 * Kilometeraufzeichnung für Susi's Alltagshilfe
 * GPS-Tracking, Routenberechnung (OSRM), Monatsauswertung
 */

const FahrtenModule = {
  map: null,
  routeLayer: null,
  currentWeekStart: null,
  markers: [],
  // GPS-Tracking State
  gpsWatchId: null,
  gpsMarker: null,
  gpsTrack: [],        // [{lat, lng, time}, ...]
  gpsTrackLine: null,
  trackingActive: false,
  trackingStartTime: null,

  async init() {
    this.currentWeekStart = App.getMontag(new Date());
    await this.wocheAnzeigen();
  },

  async wocheAnzeigen() {
    const container = document.getElementById('fahrtenContent');
    if (!container) return;

    const montag = this.currentWeekStart;
    const freitag = new Date(montag);
    freitag.setDate(freitag.getDate() + 4);

    const fahrten = await DB.fahrtenFuerWoche(montag.toISOString().split('T')[0]);

    let gesamtKm = 0;
    let gesamtBetrag = 0;
    fahrten.forEach(f => {
      gesamtKm += f.gesamtKm || 0;
      gesamtBetrag += (f.gesamtKm || 0) * ((FIRMA||{}).kmSatz||0.30);
    });

    // Wochentage Mo-Fr
    const tage = [];
    for (let i = 0; i < 5; i++) {
      const tag = new Date(montag);
      tag.setDate(tag.getDate() + i);
      const datumStr = tag.toISOString().split('T')[0];
      const tagesFahrten = fahrten.filter(f => f.datum === datumStr);
      tage.push({ datum: datumStr, tag, fahrten: tagesFahrten });
    }

    // Aktueller Monat für Monats-PDF
    const jetzt = new Date();
    const aktMonat = jetzt.getMonth() + 1;
    const aktJahr = jetzt.getFullYear();

    container.innerHTML = `
      <!-- GPS Quick-Start -->
      <div class="card" style="background: linear-gradient(135deg, var(--primary), var(--primary-dark)); color: white; text-align: center;">
        <button class="btn btn-lg" style="background: white; color: var(--primary); width: 100%;"
                onclick="FahrtenModule.trackingStarten()">
          📍 Aufzeichnung starten
        </button>
        <div class="text-sm mt-1" style="opacity: 0.8;">Losfahren — km werden automatisch erfasst</div>
      </div>

      <!-- Wochennavigation -->
      <div class="week-nav">
        <button onclick="FahrtenModule.vorherigeWoche()">◀</button>
        <span class="week-label">
          ${App.formatDatum(montag.toISOString())} - ${App.formatDatum(freitag.toISOString())}
        </span>
        <button onclick="FahrtenModule.naechsteWoche()">▶</button>
      </div>

      <!-- Zusammenfassung -->
      <div class="route-summary">
        <div class="summary-item">
          <div class="summary-value">${gesamtKm.toFixed(1)}</div>
          <div class="summary-label">Kilometer</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${fahrten.length}</div>
          <div class="summary-label">Fahrten</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${App.formatBetrag(gesamtBetrag)}</div>
          <div class="summary-label">Gesamt</div>
        </div>
      </div>

      <!-- Karte -->
      <div class="map-container">
        <div id="map"></div>
      </div>

      <!-- Tageseinträge -->
      <div id="tagesListe">
        ${tage.map(t => this.tagRendern(t)).join('')}
      </div>

      <!-- Auswertungen -->
      <div class="card mt-2">
        <h3 class="card-title mb-2">Auswertungen</h3>

        <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:12px;">
          <select id="auswertungKW" class="form-control" style="flex:1;">
            ${this.kwOptionsRendern()}
          </select>
          <button class="btn btn-outline" onclick="FahrtenModule.wochenVorschau()" style="white-space:nowrap;">
            📄 Woche
          </button>
        </div>

        <div style="display:flex;gap:8px;align-items:flex-end;">
          <select id="auswertungMonat" class="form-control" style="flex:1;">
            ${this.monatsOptionsRendern(aktMonat)}
          </select>
          <select id="auswertungJahr" class="form-control" style="flex:0;min-width:100px;">
            ${this.jahresOptionsRendern(aktJahr)}
          </select>
          <button class="btn btn-outline" onclick="FahrtenModule.monatsVorschau()" style="white-space:nowrap;">
            📊 Monat
          </button>
        </div>
      </div>
    `;

    setTimeout(() => this.karteInitialisieren(fahrten), 100);
  },

  tagRendern(tagData) {
    const tagName = App.wochentagName(tagData.datum);
    const istHeute = tagData.datum === App.heute();

    return `
      <div class="card ${istHeute ? 'border-primary' : ''}" style="${istHeute ? 'border-left: 3px solid var(--primary);' : ''}">
        <div class="card-header">
          <div>
            <span class="card-title">${tagName}</span>
            <span class="text-sm text-muted"> ${App.formatDatum(tagData.datum)}</span>
          </div>
          <button class="btn btn-sm btn-primary" onclick="FahrtenModule.neueFahrt('${tagData.datum}')">
            + Eintrag
          </button>
        </div>

        ${tagData.fahrten.length === 0
          ? '<div class="text-sm text-muted">Keine Fahrten</div>'
          : tagData.fahrten.map(f => `
            <div class="list-item" onclick="FahrtenModule.fahrtBearbeiten(${f.id})" style="margin: 4px 0;">
              <div class="item-content">
                <div class="item-title">${(f.zielAdressen || []).join(' → ') || f.notiz || 'Fahrt'}</div>
                <div class="item-subtitle">
                  ${f.gesamtKm ? f.gesamtKm.toFixed(1) + ' km' : '0 km'} |
                  ${App.formatBetrag((f.gesamtKm || 0) * ((FIRMA||{}).kmSatz||0.30))}
                  ${f.trackingKm ? ' | 📍 GPS' : ''}
                </div>
              </div>
              <div class="item-action">›</div>
            </div>
          `).join('')
        }
      </div>
    `;
  },

  karteInitialisieren(fahrten) {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    if (this.map) this.map.remove();

    this.map = L.map('map').setView([51.3993, 7.1859], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(this.map);

    const startAddr = (FIRMA || {}).startAdresse || 'Basis';
    const startMarker = L.marker([51.3993, 7.1859], { title: startAddr }).addTo(this.map);
    startMarker.bindPopup(`<b>Basis</b><br>${startAddr}`);
    this.markers = [startMarker];
  },

  // ===== GPS-TRACKING =====

  trackingStarten() {
    if (!navigator.geolocation) {
      App.toast('GPS nicht verfügbar', 'error');
      return;
    }

    this.gpsTrack = [];
    this.trackingActive = true;
    this.trackingStartTime = new Date();

    // Pulse-Animation CSS
    if (!document.getElementById('trackPulseStyle')) {
      const s = document.createElement('style');
      s.id = 'trackPulseStyle';
      s.textContent = '@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.3)}}';
      document.head.appendChild(s);
    }

    const container = document.getElementById('fahrtenContent');
    container.innerHTML = `
      <div class="card" style="background: var(--danger); color: white; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 8px;">📍</div>
        <h3 id="trackingStatus">Aufzeichnung läuft...</h3>
        <div class="route-summary" style="margin: 16px 0;">
          <div class="summary-item" style="background: rgba(255,255,255,0.2); color: white;">
            <div class="summary-value" id="trackKm" style="color: white;">0,0</div>
            <div class="summary-label" style="color: rgba(255,255,255,0.8);">km</div>
          </div>
          <div class="summary-item" style="background: rgba(255,255,255,0.2); color: white;">
            <div class="summary-value" id="trackDauer" style="color: white;">0:00</div>
            <div class="summary-label" style="color: rgba(255,255,255,0.8);">Dauer</div>
          </div>
          <div class="summary-item" style="background: rgba(255,255,255,0.2); color: white;">
            <div class="summary-value" id="trackStatus" style="color: white; font-size: 1.2rem;">
              <span style="display:inline-block;width:10px;height:10px;background:#4ade80;border-radius:50%;animation:pulse 1.5s infinite;"></span>
            </div>
            <div class="summary-label" style="color: rgba(255,255,255,0.8);">Aktiv</div>
          </div>
        </div>
        <button class="btn btn-lg" style="background: white; color: var(--danger); width: 100%;"
                onclick="FahrtenModule.trackingStoppen()">
          ⏹ Aufzeichnung beenden
        </button>
      </div>

      <div class="map-container" style="height: 350px;">
        <div id="trackMap"></div>
      </div>
    `;

    // Karte initialisieren
    setTimeout(() => {
      if (this.map) this.map.remove();
      this.map = L.map('trackMap').setView([51.3993, 7.1859], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap', maxZoom: 19
      }).addTo(this.map);

      // GPS starten
      this.gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => this.trackingPosition(pos),
        (err) => {
          console.warn('GPS-Fehler:', err);
          App.toast('GPS-Fehler: ' + err.message, 'error');
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
      );

      // Dauer-Timer
      this.trackingTimer = setInterval(() => this.trackingDauerUpdate(), 1000);
    }, 100);
  },

  trackingPosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    const punkt = { lat: latitude, lng: longitude, time: Date.now(), accuracy };
    this.gpsTrack.push(punkt);

    // Karte aktualisieren
    if (this.map) {
      if (this.gpsMarker) {
        this.gpsMarker.setLatLng([latitude, longitude]);
      } else {
        this.gpsMarker = L.circleMarker([latitude, longitude], {
          radius: 10, color: '#E91E7B', fillColor: '#E91E7B', fillOpacity: 0.9
        }).addTo(this.map);
      }

      // Track-Linie zeichnen
      const latlngs = this.gpsTrack.map(p => [p.lat, p.lng]);
      if (this.gpsTrackLine) {
        this.gpsTrackLine.setLatLngs(latlngs);
      } else {
        this.gpsTrackLine = L.polyline(latlngs, {
          color: '#E91E7B', weight: 4, opacity: 0.8
        }).addTo(this.map);
      }

      this.map.setView([latitude, longitude], this.map.getZoom());
    }

    // Anzeige aktualisieren
    const km = this.trackKmBerechnen();
    const kmEl = document.getElementById('trackKm');
    if (kmEl) kmEl.textContent = km.toFixed(1).replace('.', ',');
  },

  trackingDauerUpdate() {
    if (!this.trackingStartTime) return;
    const diff = Date.now() - this.trackingStartTime.getTime();
    const min = Math.floor(diff / 60000);
    const sek = Math.floor((diff % 60000) / 1000);
    const el = document.getElementById('trackDauer');
    if (el) el.textContent = `${min}:${String(sek).padStart(2, '0')}`;
  },

  trackKmBerechnen() {
    let total = 0;
    for (let i = 1; i < this.gpsTrack.length; i++) {
      total += this.haversine(
        this.gpsTrack[i - 1].lat, this.gpsTrack[i - 1].lng,
        this.gpsTrack[i].lat, this.gpsTrack[i].lng
      );
    }
    return total;
  },

  haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  async trackingStoppen() {
    // GPS stoppen
    if (this.gpsWatchId) {
      navigator.geolocation.clearWatch(this.gpsWatchId);
      this.gpsWatchId = null;
    }
    if (this.trackingTimer) {
      clearInterval(this.trackingTimer);
      this.trackingTimer = null;
    }
    this.trackingActive = false;

    const km = this.trackKmBerechnen();

    // Reverse Geocoding für Start und Ende
    let startAdresse = '';
    let endAdresse = '';
    if (this.gpsTrack.length >= 2) {
      const first = this.gpsTrack[0];
      const last = this.gpsTrack[this.gpsTrack.length - 1];
      [startAdresse, endAdresse] = await Promise.all([
        this.reverseGeocode(first.lat, first.lng),
        this.reverseGeocode(last.lat, last.lng),
      ]);
    }
    this._trackStartAdresse = startAdresse;
    this._trackEndAdresse = endAdresse;

    this.trackingSpeichernFormular(km);
  },

  async trackingSpeichernFormular(gpsKm) {
    const kunden = await DB.alleKunden();
    const container = document.getElementById('fahrtenContent');

    container.innerHTML = `
      <div class="card">
        <h3 class="card-title mb-2">Aufzeichnung abgeschlossen</h3>

        <div class="route-summary mb-2">
          <div class="summary-item">
            <div class="summary-value">${gpsKm.toFixed(1).replace('.', ',')}</div>
            <div class="summary-label">GPS km</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">${this.gpsTrack.length}</div>
            <div class="summary-label">Punkte</div>
          </div>
        </div>

        ${this._trackStartAdresse ? `
        <div class="form-group">
          <label>Start</label>
          <input type="text" id="trackStart" class="form-control" value="${this._trackStartAdresse}">
        </div>` : ''}

        ${this._trackEndAdresse ? `
        <div class="form-group">
          <label>Ziel</label>
          <input type="text" id="trackEnde" class="form-control" value="${this._trackEndAdresse}">
        </div>` : ''}

        <div class="form-group">
          <label for="trackDatum">Datum</label>
          <input type="date" id="trackDatum" class="form-control" value="${App.heute()}">
        </div>

        <div class="form-group">
          <label for="trackKmInput">Kilometer (ggf. korrigieren)</label>
          <input type="number" id="trackKmInput" class="form-control" step="0.1" min="0"
                 value="${gpsKm.toFixed(1)}" onchange="FahrtenModule.kmAktualisieren()">
        </div>

        <div class="form-group">
          <label>Ziele (optional, nachträglich ergänzen)</label>
          <div id="zieleListe">
            <div class="ziel-entry mb-1">
              ${this.zielEingabeRendern(kunden)}
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary mt-1" onclick="FahrtenModule.zielHinzufuegen()">
            + Weiteres Ziel
          </button>
        </div>

        <div class="form-group">
          <label for="trackNotiz">Notiz</label>
          <input type="text" id="trackNotiz" class="form-control" placeholder="z.B. Kundenbesuche Hattingen-Süd">
        </div>

        <div id="fahrtBetrag" class="card" style="background: var(--primary-bg); text-align: center;">
          <span class="fw-bold text-primary">${App.formatBetrag(gpsKm * ((FIRMA||{}).kmSatz||0.30))}</span>
          <span class="text-sm text-muted"> (${((FIRMA||{}).kmSatz||0.30).toFixed(2).replace('.', ',')} €/km)</span>
        </div>
      </div>

      <div class="btn-group mt-2">
        <button class="btn btn-primary btn-block" onclick="FahrtenModule.trackingFahrtSpeichern(${gpsKm})">
          Speichern
        </button>
        <button class="btn btn-secondary" onclick="FahrtenModule.wocheAnzeigen()">
          Verwerfen
        </button>
      </div>
    `;
  },

  async trackingFahrtSpeichern(gpsKm) {
    const datum = document.getElementById('trackDatum').value || App.heute();
    const km = parseFloat(document.getElementById('trackKmInput')?.value) || gpsKm;
    const notiz = document.getElementById('trackNotiz')?.value.trim() || '';
    const trackStart = document.getElementById('trackStart')?.value.trim() || '';

    const zielAdressen = [];
    document.querySelectorAll('.ziel-adresse').forEach(input => {
      if (input.value.trim()) zielAdressen.push(input.value.trim());
    });

    const fahrt = {
      datum,
      wochentag: App.wochentagName(datum),
      startAdresse: trackStart || ((FIRMA||{}).startAdresse||''),
      zielAdressen: zielAdressen.length > 0 ? zielAdressen : (document.getElementById('trackEnde')?.value.trim() ? [document.getElementById('trackEnde').value.trim()] : []),
      gesamtKm: km,
      trackingKm: gpsKm,
      betrag: km * ((FIRMA||{}).kmSatz||0.30),
      notiz,
      gpsTrack: this.gpsTrack.length > 0 ? JSON.stringify(this.gpsTrack) : null
    };

    try {
      await DB.fahrtHinzufuegen(fahrt);
      this.gpsTrack = [];
      this.gpsTrackLine = null;
      this.gpsMarker = null;
      App.toast('Fahrt gespeichert', 'success');
      this.wocheAnzeigen();
    } catch (err) {
      console.error('Fehler:', err);
      App.toast('Fehler beim Speichern', 'error');
    }
  },

  // ===== MANUELLE ERFASSUNG =====

  async neueFahrt(datum) {
    const kunden = await DB.alleKunden();
    const container = document.getElementById('fahrtenContent');

    // Kassen rausfiltern
    const kassenKw = ['aok','barmer','dak','techniker','knappschaft','bkk','novitas','energie','lbv','landesamt','krankenkasse','ersatzkasse','pflegekasse'];
    const echteKunden = kunden.filter(k => !kassenKw.some(kw => (k.name||'').toLowerCase().includes(kw)) && k.kundentyp !== 'inaktiv');

    container.innerHTML = `
      <div class="card">
        <h3 class="card-title mb-2">Neue Fahrt - ${App.wochentagName(datum)}, ${App.formatDatum(datum)}</h3>

        <div class="form-group">
          <label>Start</label>
          <input type="text" id="fahrtStart" class="form-control"
                 value="${((FIRMA||{}).startAdresse||'')}" placeholder="Startadresse eingeben">
        </div>

        <div class="form-group">
          <label>Ziel</label>
          <div id="zieleListe">
            <div class="ziel-entry mb-1">
              ${this.zielEingabeRendern(echteKunden)}
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary mt-1" onclick="FahrtenModule.zielHinzufuegen()">
            + Weiteres Ziel
          </button>
        </div>

        <div class="form-group">
          <label for="fahrtNotiz">Notiz</label>
          <input type="text" id="fahrtNotiz" class="form-control" placeholder="z.B. Einkauf, Arztbesuch">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="fahrtKm">Kilometer</label>
            <input type="number" id="fahrtKm" class="form-control" step="0.1" min="0"
                   placeholder="0.0" oninput="FahrtenModule.kmAktualisieren()">
          </div>
          <div class="form-group">
            <label>Betrag</label>
            <div id="fahrtBetrag" class="form-control" style="background: var(--gray-100); display: flex; align-items: center;">
              0,00 &euro;
            </div>
          </div>
        </div>

        <div class="btn-group mb-2">
          <button type="button" class="btn btn-sm btn-outline" onclick="FahrtenModule.routeBerechnen()">
            &#x1F5FA;&#xFE0F; Route berechnen &amp; km ermitteln
          </button>
        </div>

        <div class="map-container" style="height: 250px;">
          <div id="routeMap"></div>
        </div>
      </div>

      <div class="btn-group mt-2">
        <button class="btn btn-primary btn-block" onclick="FahrtenModule.fahrtSpeichern('${datum}')">
          Speichern
        </button>
        <button class="btn btn-secondary" onclick="FahrtenModule.wocheAnzeigen()">
          Abbrechen
        </button>
      </div>
    `;

    setTimeout(() => {
      if (this.map) this.map.remove();
      this.map = L.map('routeMap').setView([51.3993, 7.1859], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap', maxZoom: 19
      }).addTo(this.map);

      // Autocomplete für Start- und Ziel-Felder
      this.setupAutocomplete(document.getElementById('fahrtStart'));
      document.querySelectorAll('.ziel-adresse').forEach(el => this.setupAutocomplete(el));

      // GPS-Standort als Start (falls Startadresse leer)
      const startInput = document.getElementById('fahrtStart');
      if (startInput && !startInput.value && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (pos) => {
          const addr = await this.reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          if (addr && startInput && !startInput.value) {
            startInput.value = addr;
          }
        }, () => {}, { timeout: 5000 });
      }
    }, 100);
  },

  // Ziel-Eingabe: Kunde wählen oder Freitext
  zielEingabeRendern(kunden) {
    const kundenOptions = kunden.map(k => {
      const adresse = [k.strasse, k.plz, k.ort].filter(Boolean).join(', ');
      return `<option value="${k.id}" data-adresse="${KundenModule.escapeHtml(adresse)}" data-name="${KundenModule.escapeHtml(k.name)}">${KundenModule.escapeHtml(k.name)}${adresse ? ' (' + KundenModule.escapeHtml(k.ort || '') + ')' : ''}</option>`;
    }).join('');

    return `
      <select class="form-control ziel-kunde" onchange="FahrtenModule.kundeGewaehlt(this)" style="margin-bottom: 4px;">
        <option value="">-- Kunde wählen --</option>
        ${kundenOptions}
      </select>
      <input type="text" class="form-control ziel-adresse" placeholder="Adresse (wird automatisch ausgefüllt oder frei eingeben)">
    `;
  },

  kundeGewaehlt(selectEl) {
    const option = selectEl.selectedOptions[0];
    const entry = selectEl.closest('.ziel-entry');
    const adresseInput = entry.querySelector('.ziel-adresse');
    if (option.value && option.dataset.adresse) {
      adresseInput.value = option.dataset.adresse;
    }
  },

  async zielHinzufuegen() {
    const kunden = await DB.alleKunden();
    const zieleListe = document.getElementById('zieleListe');
    const entry = document.createElement('div');
    entry.className = 'ziel-entry mb-1';
    entry.innerHTML = this.zielEingabeRendern(kunden);
    zieleListe.appendChild(entry);
  },

  kmAktualisieren() {
    const km = parseFloat(document.getElementById('fahrtKm')?.value || document.getElementById('trackKmInput')?.value) || 0;
    const betrag = km * ((FIRMA||{}).kmSatz||0.30);
    const betragEl = document.getElementById('fahrtBetrag');
    if (betragEl) {
      if (betragEl.tagName === 'DIV' && betragEl.classList.contains('card')) {
        betragEl.innerHTML = `<span class="fw-bold text-primary">${App.formatBetrag(betrag)}</span><span class="text-sm text-muted"> (${((FIRMA||{}).kmSatz||0.30).toFixed(2).replace('.', ',')} €/km)</span>`;
      } else {
        betragEl.textContent = App.formatBetrag(betrag);
      }
    }
  },

  async routeBerechnen() {
    const startAddr = document.getElementById('fahrtStart')?.value.trim() || ((FIRMA||{}).startAdresse||'');
    const adressen = [startAddr];
    document.querySelectorAll('.ziel-adresse').forEach(input => {
      if (input.value.trim()) adressen.push(input.value.trim());
    });
    adressen.push(startAddr); // Rückfahrt

    if (adressen.length < 3) {
      App.toast('Bitte mindestens ein Ziel eingeben', 'info');
      return;
    }

    App.toast('Route wird berechnet...', 'info');

    try {
      const coords = [];
      for (const addr of adressen) {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`
        );
        const results = await response.json();
        if (results.length > 0) {
          coords.push([parseFloat(results[0].lon), parseFloat(results[0].lat)]);
        }
      }

      if (coords.length < 2) {
        App.toast('Adressen nicht gefunden', 'error');
        return;
      }

      const coordStr = coords.map(c => c.join(',')).join(';');
      const routeResponse = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`
      );
      const routeData = await routeResponse.json();

      if (routeData.code === 'Ok' && routeData.routes.length > 0) {
        const route = routeData.routes[0];
        const distKm = (route.distance / 1000).toFixed(1);

        const kmInput = document.getElementById('fahrtKm');
        if (kmInput) { kmInput.value = distKm; this.kmAktualisieren(); }

        if (this.map) {
          if (this.routeLayer) this.map.removeLayer(this.routeLayer);
          this.routeLayer = L.geoJSON(route.geometry, {
            style: { color: '#E91E7B', weight: 4, opacity: 0.8 }
          }).addTo(this.map);
          coords.forEach((coord, i) => {
            L.marker([coord[1], coord[0]]).addTo(this.map).bindPopup(adressen[i]);
          });
          this.map.fitBounds(this.routeLayer.getBounds(), { padding: [20, 20] });
        }

        App.toast(`Route: ${distKm} km`, 'success');
      } else {
        App.toast('Route nicht berechenbar', 'error');
      }
    } catch (err) {
      console.error('Routenfehler:', err);
      App.toast('Fehler bei Routenberechnung', 'error');
    }
  },

  async fahrtSpeichern(datum) {
    const zielAdressen = [];
    document.querySelectorAll('.ziel-adresse').forEach(input => {
      if (input.value.trim()) zielAdressen.push(input.value.trim());
    });

    const fahrt = {
      datum,
      wochentag: App.wochentagName(datum),
      startAdresse: document.getElementById('fahrtStart')?.value.trim() || ((FIRMA||{}).startAdresse||''),
      zielAdressen,
      gesamtKm: parseFloat(document.getElementById('fahrtKm')?.value) || 0,
      betrag: (parseFloat(document.getElementById('fahrtKm')?.value) || 0) * ((FIRMA||{}).kmSatz||0.30),
      notiz: document.getElementById('fahrtNotiz')?.value.trim() || ''
    };

    try {
      await DB.fahrtHinzufuegen(fahrt);
      App.toast('Gespeichert', 'success');
      this.wocheAnzeigen();
    } catch (err) {
      console.error('Fehler:', err);
      App.toast('Fehler beim Speichern', 'error');
    }
  },

  // ===== BEARBEITEN =====

  async fahrtBearbeiten(id) {
    const fahrt = await DB.fahrtById(id);
    if (!fahrt) return;

    const kunden = await DB.alleKunden();
    const container = document.getElementById('fahrtenContent');

    container.innerHTML = `
      <div class="card">
        <h3 class="card-title mb-2">Fahrt bearbeiten - ${App.wochentagName(fahrt.datum)}, ${App.formatDatum(fahrt.datum)}</h3>

        <div class="form-group">
          <label>Ziele</label>
          <div id="zieleListe">
            ${(fahrt.zielAdressen || []).map(addr => `
              <div class="ziel-entry mb-1">
                <div class="form-row" style="grid-template-columns: auto 1fr; gap: 8px;">
                  <select class="form-control ziel-kunde" onchange="FahrtenModule.kundeGewaehlt(this)" style="min-width: 120px;">
                    <option value="_frei" selected>✏️ Freie Eingabe</option>
                    ${kunden.map(k => `<option value="${k.id}" data-adresse="${KundenModule.escapeHtml((k.strasse || '') + ', ' + (k.plz || '') + ' ' + (k.ort || ''))}">${KundenModule.escapeHtml(k.name)}</option>`).join('')}
                  </select>
                  <input type="text" class="form-control ziel-adresse" value="${KundenModule.escapeHtml(addr)}">
                </div>
              </div>
            `).join('') || `<div class="ziel-entry mb-1">${this.zielEingabeRendern(kunden)}</div>`}
          </div>
          <button type="button" class="btn btn-sm btn-secondary mt-1" onclick="FahrtenModule.zielHinzufuegen()">
            + Weiteres Ziel
          </button>
        </div>

        <div class="form-group">
          <label for="editFahrtNotiz">Notiz</label>
          <input type="text" id="editFahrtNotiz" class="form-control" value="${KundenModule.escapeHtml(fahrt.notiz || '')}">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="editFahrtKm">Kilometer</label>
            <input type="number" id="editFahrtKm" class="form-control" step="0.1" min="0"
                   value="${fahrt.gesamtKm || 0}" onchange="FahrtenModule.editKmAktualisieren()">
          </div>
          <div class="form-group">
            <label>Betrag</label>
            <div id="editFahrtBetrag" class="form-control" style="background: var(--gray-100); display: flex; align-items: center;">
              ${App.formatBetrag((fahrt.gesamtKm || 0) * ((FIRMA||{}).kmSatz||0.30))}
            </div>
          </div>
        </div>
        ${fahrt.trackingKm ? `<div class="text-xs text-muted">GPS-Aufzeichnung: ${fahrt.trackingKm.toFixed(1)} km</div>` : ''}
      </div>

      <div class="btn-group mt-2">
        <button class="btn btn-primary btn-block" onclick="FahrtenModule.fahrtAktualisieren(${id})">
          Speichern
        </button>
        <button class="btn btn-danger" onclick="FahrtenModule.fahrtEntfernen(${id})">
          Löschen
        </button>
        <button class="btn btn-secondary" onclick="FahrtenModule.wocheAnzeigen()">
          Abbrechen
        </button>
      </div>
    `;
  },

  editKmAktualisieren() {
    const km = parseFloat(document.getElementById('editFahrtKm')?.value) || 0;
    const betragEl = document.getElementById('editFahrtBetrag');
    if (betragEl) betragEl.textContent = App.formatBetrag(km * ((FIRMA||{}).kmSatz||0.30));
  },

  async fahrtAktualisieren(id) {
    const km = parseFloat(document.getElementById('editFahrtKm')?.value) || 0;
    const notiz = document.getElementById('editFahrtNotiz')?.value.trim() || '';
    const zielAdressen = [];
    document.querySelectorAll('.ziel-adresse').forEach(input => {
      if (input.value.trim()) zielAdressen.push(input.value.trim());
    });

    try {
      await DB.fahrtAktualisieren(id, { gesamtKm: km, betrag: km * ((FIRMA||{}).kmSatz||0.30), notiz, zielAdressen });
      App.toast('Aktualisiert', 'success');
      this.wocheAnzeigen();
    } catch (err) {
      App.toast('Fehler', 'error');
    }
  },

  async fahrtEntfernen(id) {
    if (!await App.confirm('Fahrt wirklich löschen?')) return;
    await DB.fahrtLoeschen(id);
    App.toast('Gelöscht', 'success');
    this.wocheAnzeigen();
  },

  // ===== NAVIGATION =====

  vorherigeWoche() {
    this.currentWeekStart.setDate(this.currentWeekStart.getDate() - 7);
    this.wocheAnzeigen();
  },

  naechsteWoche() {
    this.currentWeekStart.setDate(this.currentWeekStart.getDate() + 7);
    this.wocheAnzeigen();
  },

  // ===== AUSWERTUNGS-DROPDOWNS =====

  kwOptionsRendern() {
    const aktuelleKW = this.getKW(new Date());
    let html = '';
    for (let kw = 1; kw <= 52; kw++) {
      html += `<option value="${kw}" ${kw === aktuelleKW ? 'selected' : ''}>KW ${kw}</option>`;
    }
    return html;
  },

  monatsOptionsRendern(aktuellerMonat) {
    let html = '';
    for (let m = 1; m <= 12; m++) {
      html += `<option value="${m}" ${m === aktuellerMonat ? 'selected' : ''}>${m}</option>`;
    }
    return html;
  },

  jahresOptionsRendern(aktuellesJahr) {
    let html = '';
    for (let j = 2024; j <= aktuellesJahr; j++) {
      html += `<option value="${j}" ${j === aktuellesJahr ? 'selected' : ''}>${j}</option>`;
    }
    return html;
  },

  montagFuerKW(kw, jahr) {
    // ISO 8601: KW 1 enthält den 4. Januar
    const jan4 = new Date(jahr, 0, 4);
    const montag1 = new Date(jan4);
    montag1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    const result = new Date(montag1);
    result.setDate(montag1.getDate() + (kw - 1) * 7);
    return result;
  },

  // ===== VORSCHAU =====

  async wochenVorschau() {
    const kw = parseInt(document.getElementById('auswertungKW').value);
    const jahr = new Date().getFullYear();
    const montag = this.montagFuerKW(kw, jahr);
    const montagStr = montag.toISOString().split('T')[0];

    const fahrten = await DB.fahrtenFuerWoche(montagStr);
    fahrten.sort((a, b) => a.datum.localeCompare(b.datum));

    let gesamtKm = 0;
    let gesamtBetrag = 0;

    const tageKurz = ['So','Mo','Di','Mi','Do','Fr','Sa'];

    let zeilen = '';
    fahrten.forEach(f => {
      const km = f.gesamtKm || 0;
      const betrag = km * ((FIRMA||{}).kmSatz||0.30);
      gesamtKm += km;
      gesamtBetrag += betrag;

      const d = new Date(f.datum + 'T00:00:00');
      const tagStr = tageKurz[d.getDay()] + ' ' + d.getDate().toString().padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.';
      const ziele = (f.zielAdressen || []).join(', ') || f.notiz || '–';

      zeilen += `
        <tr>
          <td style="padding:6px;">${tagStr}</td>
          <td style="padding:6px;">${ziele}</td>
          <td style="text-align:right;padding:6px;">${km.toFixed(1).replace('.',',')}</td>
          <td style="text-align:right;padding:6px;">${App.formatBetrag(betrag)}</td>
        </tr>`;
    });

    if (fahrten.length === 0) {
      zeilen = '<tr><td colspan="4" style="padding:6px;text-align:center;color:var(--gray-500);">Keine Fahrten in dieser Woche</td></tr>';
    }

    const content = document.getElementById('fahrtenVorschauContent');
    content.innerHTML = `
      <div class="card" style="background:white;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h3>Wochenauswertung KW ${kw} / ${jahr}</h3>
          <button class="btn btn-sm" onclick="FahrtenModule.vorschauSchliessen()" style="font-size:1.2rem;padding:4px 8px;">✕</button>
        </div>

        <table style="width:100%;font-size:0.85rem;border-collapse:collapse;margin-top:12px;">
          <thead>
            <tr style="border-bottom:2px solid var(--gray-300);">
              <th style="text-align:left;padding:6px;">Tag</th>
              <th style="text-align:left;padding:6px;">Ziele</th>
              <th style="text-align:right;padding:6px;">km</th>
              <th style="text-align:right;padding:6px;">Betrag</th>
            </tr>
          </thead>
          <tbody>
            ${zeilen}
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid var(--gray-300);font-weight:700;">
              <td colspan="2" style="padding:6px;">Gesamt</td>
              <td style="text-align:right;padding:6px;">${gesamtKm.toFixed(1).replace('.',',')} km</td>
              <td style="text-align:right;padding:6px;">${App.formatBetrag(gesamtBetrag)}</td>
            </tr>
          </tfoot>
        </table>

        <button class="btn btn-primary btn-block mt-2" onclick="FahrtenModule.wochenPdfErstellen()">
          📄 Als PDF herunterladen
        </button>
      </div>
    `;

    document.getElementById('fahrtenVorschauOverlay').classList.remove('hidden');
  },

  async monatsVorschau() {
    const monat = parseInt(document.getElementById('auswertungMonat').value);
    const jahr = parseInt(document.getElementById('auswertungJahr').value);
    const monatStr = `${jahr}-${String(monat).padStart(2, '0')}`;

    const alleFahrten = await DB.alleFahrten();
    const fahrten = alleFahrten.filter(f => f.datum && f.datum.startsWith(monatStr));
    fahrten.sort((a, b) => a.datum.localeCompare(b.datum));

    let gesamtKm = 0;
    let gesamtBetrag = 0;

    const tageKurz = ['So','Mo','Di','Mi','Do','Fr','Sa'];

    let zeilen = '';
    fahrten.forEach(f => {
      const km = f.gesamtKm || 0;
      const betrag = km * ((FIRMA||{}).kmSatz||0.30);
      gesamtKm += km;
      gesamtBetrag += betrag;

      const d = new Date(f.datum + 'T00:00:00');
      const tagStr = tageKurz[d.getDay()] + ' ' + d.getDate().toString().padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.';
      const ziele = (f.zielAdressen || []).join(', ') || f.notiz || '–';

      zeilen += `
        <tr>
          <td style="padding:6px;">${tagStr}</td>
          <td style="padding:6px;">${ziele}</td>
          <td style="text-align:right;padding:6px;">${km.toFixed(1).replace('.',',')}</td>
          <td style="text-align:right;padding:6px;">${App.formatBetrag(betrag)}</td>
        </tr>`;
    });

    if (fahrten.length === 0) {
      zeilen = '<tr><td colspan="4" style="padding:6px;text-align:center;color:var(--gray-500);">Keine Fahrten in diesem Monat</td></tr>';
    }

    const monatsNamen = ['','Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
    const content = document.getElementById('fahrtenVorschauContent');
    content.innerHTML = `
      <div class="card" style="background:white;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h3>Monatsauswertung ${monatsNamen[monat]} ${jahr}</h3>
          <button class="btn btn-sm" onclick="FahrtenModule.vorschauSchliessen()" style="font-size:1.2rem;padding:4px 8px;">✕</button>
        </div>

        <table style="width:100%;font-size:0.85rem;border-collapse:collapse;margin-top:12px;">
          <thead>
            <tr style="border-bottom:2px solid var(--gray-300);">
              <th style="text-align:left;padding:6px;">Tag</th>
              <th style="text-align:left;padding:6px;">Ziele</th>
              <th style="text-align:right;padding:6px;">km</th>
              <th style="text-align:right;padding:6px;">Betrag</th>
            </tr>
          </thead>
          <tbody>
            ${zeilen}
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid var(--gray-300);font-weight:700;">
              <td colspan="2" style="padding:6px;">Gesamt</td>
              <td style="text-align:right;padding:6px;">${gesamtKm.toFixed(1).replace('.',',')} km</td>
              <td style="text-align:right;padding:6px;">${App.formatBetrag(gesamtBetrag)}</td>
            </tr>
          </tfoot>
        </table>

        <button class="btn btn-primary btn-block mt-2" onclick="FahrtenModule.monatsPdfErstellen()">
          📊 Als PDF herunterladen
        </button>
      </div>
    `;

    document.getElementById('fahrtenVorschauOverlay').classList.remove('hidden');
  },

  vorschauSchliessen() {
    document.getElementById('fahrtenVorschauOverlay').classList.add('hidden');
  },

  // ===== PDFs =====

  async wochenPdfErstellen() {
    try {
      const kw = parseInt(document.getElementById('auswertungKW')?.value || this.getKW());
      const jahr = new Date().getFullYear();
      const montag = this.montagFuerKW(kw, jahr);
      const montagStr = montag.toISOString().split('T')[0];

      const fahrten = await DB.fahrtenFuerWoche(montagStr);
      const doc = await PDFHelper.generateKilometerWoche(fahrten, montagStr);
      const dateiname = `Kilometer_KW${kw}_${jahr}.pdf`;
      PDFHelper.download(doc, dateiname);
      App.toast('Wochen-PDF erstellt', 'success');
    } catch (err) {
      console.error('PDF-Fehler:', err);
      App.toast('Fehler bei PDF-Erstellung', 'error');
    }
  },

  async monatsPdfErstellen() {
    try {
      const monat = parseInt(document.getElementById('auswertungMonat')?.value || (new Date().getMonth() + 1));
      const jahr = parseInt(document.getElementById('auswertungJahr')?.value || new Date().getFullYear());

      const alleFahrten = await DB.alleFahrten();
      const monatStr = `${jahr}-${String(monat).padStart(2, '0')}`;
      const fahrten = alleFahrten.filter(f => f.datum && f.datum.startsWith(monatStr));

      if (fahrten.length === 0) {
        App.toast('Keine Fahrten in diesem Monat', 'info');
        return;
      }

      fahrten.sort((a, b) => a.datum.localeCompare(b.datum));
      const doc = await PDFHelper.generateKilometerMonat(fahrten, monat, jahr);
      const dateiname = `Kilometer_${App.monatsName(monat)}_${jahr}.pdf`;
      PDFHelper.download(doc, dateiname);
      App.toast('Monats-PDF erstellt', 'success');
    } catch (err) {
      console.error('PDF-Fehler:', err);
      App.toast('Fehler bei PDF-Erstellung', 'error');
    }
  },

  // Reverse Geocoding: Koordinaten → Adresse
  async reverseGeocode(lat, lng) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
      const data = await res.json();
      const a = data.address || {};
      const strasse = (a.road || '') + (a.house_number ? ' ' + a.house_number : '');
      const ort = a.city || a.town || a.village || '';
      return strasse ? `${strasse}, ${a.postcode || ''} ${ort}`.trim() : (data.display_name || '').split(',').slice(0, 3).join(',');
    } catch (e) {
      console.warn('Reverse Geocoding Fehler:', e);
      return '';
    }
  },

  // Adress-Autocomplete: Eingabe → Vorschläge
  _autocompleteTimer: null,
  setupAutocomplete(input) {
    if (!input || input._autocompleteInit) return;
    input._autocompleteInit = true;
    const list = document.createElement('div');
    list.className = 'address-suggestions';
    list.style.cssText = 'position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);z-index:100;max-height:200px;overflow-y:auto;display:none;';
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(list);

    input.addEventListener('input', () => {
      clearTimeout(this._autocompleteTimer);
      const q = input.value.trim();
      if (q.length < 3) { list.style.display = 'none'; return; }
      this._autocompleteTimer = setTimeout(async () => {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=de&limit=5`);
          const results = await res.json();
          if (results.length === 0) { list.style.display = 'none'; return; }
          list.innerHTML = results.map(r =>
            `<div style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:0.9rem;" class="ac-item">${r.display_name.split(',').slice(0, 3).join(',')}</div>`
          ).join('');
          list.style.display = 'block';
          list.querySelectorAll('.ac-item').forEach((item, i) => {
            item.addEventListener('click', () => {
              input.value = results[i].display_name.split(',').slice(0, 3).join(',').trim();
              list.style.display = 'none';
            });
          });
        } catch (e) { list.style.display = 'none'; }
      }, 500);
    });
    input.addEventListener('blur', () => setTimeout(() => list.style.display = 'none', 200));
  },

  getKW(datum) {
    const d = new Date(datum || new Date());
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  }
};

if (window._entlastReady && window.FIRMA) { FahrtenModule.init(); }
else { document.addEventListener('entlast-ready', () => FahrtenModule.init()); }
