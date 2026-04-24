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
    // Google-Kalender im Hintergrund synchronisieren
    apiFetch('/termine/google-sync', { method: 'POST' }).catch(() => {});
    // URL-Parameter: ?kundeId=X → Fahrt zu diesem Kunden
    const params = new URLSearchParams(window.location.search);
    const kundeId = params.get('kundeId');
    const datum = params.get('datum');
    if (kundeId) {
      window.history.replaceState({}, '', window.location.pathname);
      this.neueFahrtAusTermin(parseInt(kundeId), datum);
    }
  },

  async wocheAnzeigen() {
    const container = document.getElementById('fahrtenContent');
    if (!container) return;

    const montag = this.currentWeekStart;
    const freitag = new Date(montag);
    freitag.setDate(freitag.getDate() + 4);

    const fahrten = await DB.fahrtenFuerWoche(App.localDateStr(montag));

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
      const datumStr = App.localDateStr(tag);
      const tagesFahrten = fahrten.filter(f => f.datum === datumStr);
      tage.push({ datum: datumStr, tag, fahrten: tagesFahrten });
    }

    // Heutige Termine als Fahrten-Vorschläge laden
    let heutigeTermineHtml = '';
    try {
      const heute = App.heute();
      const [termine, alleKunden] = await Promise.all([
        DB.termineFuerDatum(heute),
        DB.alleKunden()
      ]);
      const kundenMap = {};
      alleKunden.forEach(k => { kundenMap[k.id] = k; });

      // Heutige Fahrten (Zieladressen) zum Abgleich
      const heutigeFahrten = fahrten.filter(f => f.datum === heute);
      const bereitsErfassteZiele = new Set();
      heutigeFahrten.forEach(f => {
        (f.zielAdressen || []).forEach(z => bereitsErfassteZiele.add(z.toLowerCase().trim()));
      });

      // Termine mit Kunde + Adresse filtern
      const terminMitKunde = termine
        .filter(t => t.kundeId && kundenMap[t.kundeId])
        .map(t => {
          const kunde = kundenMap[t.kundeId];
          const adresse = [kunde.strasse, kunde.plz, kunde.ort].filter(Boolean).join(', ');
          if (!adresse) return null;
          const bereitsErfasst = bereitsErfassteZiele.has(adresse.toLowerCase().trim());
          return { termin: t, kunde, adresse, bereitsErfasst };
        })
        .filter(Boolean);

      // Deduplizieren nach Kunde (falls mehrere Termine beim selben Kunden)
      const gesehen = new Set();
      const eindeutig = terminMitKunde.filter(item => {
        if (gesehen.has(item.kunde.id)) return false;
        gesehen.add(item.kunde.id);
        return true;
      });

      if (eindeutig.length > 0) {
        // Termine nach Uhrzeit sortieren und in Touren gruppieren (≤15 Min. Pause)
        const nichtErfasst = eindeutig.filter(item => !item.bereitsErfasst);
        const sortiert = [...nichtErfasst].sort((a, b) => (a.termin.startzeit || '').localeCompare(b.termin.startzeit || ''));

        const touren = [];
        let aktuelleTour = [];
        for (const item of sortiert) {
          if (aktuelleTour.length === 0) {
            aktuelleTour.push(item);
          } else {
            // Prüfe ob ≤15 Min. zwischen Ende des letzten und Start des nächsten
            const letzter = aktuelleTour[aktuelleTour.length - 1];
            const letzteEnde = letzter.termin.endzeit || letzter.termin.startzeit || '00:00';
            const naechsterStart = item.termin.startzeit || '00:00';
            const eP = letzteEnde.split(':'), sP = naechsterStart.split(':');
            const endMin = parseInt(eP[0]) * 60 + parseInt(eP[1] || 0);
            const startMin = parseInt(sP[0]) * 60 + parseInt(sP[1] || 0);
            if (startMin - endMin <= 15) {
              aktuelleTour.push(item);
            } else {
              touren.push(aktuelleTour);
              aktuelleTour = [item];
            }
          }
        }
        if (aktuelleTour.length > 0) touren.push(aktuelleTour);

        // Tour-Buttons rendern
        let tourButtonHtml = '';
        for (let ti = 0; ti < touren.length; ti++) {
          const tour = touren[ti];
          if (tour.length >= 2) {
            const kundenNamen = tour.map(item => App.kundenName(item.kunde).split(',')[0].trim()).join(' → ');
            const kundenIds = tour.map(item => item.kunde.id).join(',');
            tourButtonHtml += `
              <div style="margin-bottom:8px;">
                <button class="btn btn-primary" style="width:100%;padding:10px 12px;font-size:0.9rem;"
                        onclick="FahrtenModule.tourErstellen([${kundenIds}])">
                  🚗 Tour ${touren.length > 1 ? (ti + 1) + ': ' : ''}${tour.length} Kunden
                </button>
                <div class="text-xs text-muted" style="margin-top:2px;">${kundenNamen}</div>
              </div>`;
          }
        }
        if (tourButtonHtml === '' && nichtErfasst.length >= 2) {
          // Fallback: alle als eine Tour wenn keine Gruppen gefunden
          const kundenNamen = nichtErfasst.map(item => App.kundenName(item.kunde).split(',')[0].trim()).join(', ');
          tourButtonHtml = `
            <div style="margin-bottom:8px;">
              <button class="btn btn-primary" style="width:100%;padding:10px 12px;font-size:0.95rem;"
                      onclick="FahrtenModule.tagestourErstellen()">
                🚗 Tagestour: ${nichtErfasst.length} Kunden
              </button>
              <div class="text-xs text-muted" style="margin-top:4px;text-align:center;">${KundenModule.escapeHtml(kundenNamen)}</div>
            </div>
            <hr style="border:none;border-top:1px solid #90caf9;margin:8px 0;">`;
        }

        const eintraege = eindeutig.map(item => {
          const btnDisabled = item.bereitsErfasst ? 'disabled style="opacity:0.5;"' : '';
          const btnLabel = item.bereitsErfasst ? '✓ erfasst' : '→ Fahrt';
          return `
            <div style="padding:6px 0;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-weight:500;">${KundenModule.escapeHtml(App.kundenName(item.kunde))}</div>
                <div class="text-xs text-muted">${KundenModule.escapeHtml(item.adresse)}</div>
              </div>
              <button class="btn btn-sm btn-primary" ${btnDisabled}
                      onclick="FahrtenModule.neueFahrtAusTermin(${item.kunde.id})">${btnLabel}</button>
            </div>`;
        }).join('');

        heutigeTermineHtml = `
          <div class="card" style="background:#e3f2fd;">
            <div style="font-weight:600;margin-bottom:8px;">📅 Heutige Kunden</div>
            ${tourButtonHtml}
            ${eintraege}
          </div>`;
      }
    } catch (err) {
      console.warn('Heutige Termine konnten nicht geladen werden:', err);
    }

    // Aktueller Monat für Monats-PDF
    const jetzt = new Date();
    const aktMonat = jetzt.getMonth() + 1;
    const aktJahr = jetzt.getFullYear();

    container.innerHTML = `
      ${heutigeTermineHtml}

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
          ${App.formatDatum(App.localDateStr(montag))} - ${App.formatDatum(App.localDateStr(freitag))}
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

    // Karte nur bei Tracking/manueller Fahrt, nicht in Wochenübersicht
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

    // Sicherheitsabfrage bei Zurück-Button / Seite verlassen
    this._beforeUnloadHandler = (e) => {
      if (this.trackingActive) {
        e.preventDefault();
        e.returnValue = 'Aufzeichnung läuft! Wirklich beenden?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', this._beforeUnloadHandler);

    // Auch Browser-History-Back abfangen
    history.pushState({ tracking: true }, '');
    this._popstateHandler = (e) => {
      if (this.trackingActive) {
        // Zurück gedrückt → Dialog zeigen statt navigieren
        history.pushState({ tracking: true }, '');
        this._zeigeTrackingWarnung();
      }
    };
    window.addEventListener('popstate', this._popstateHandler);

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
        <h3 id="trackingStatus">Aufzeichnung l\u00e4uft...</h3>
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
      </div>

      <div class="map-container" style="height: 300px; margin-bottom: 8px;">
        <div id="trackMap" style="height: 100%; width: 100%;"></div>
      </div>

      <button class="btn btn-lg" style="background: var(--danger); color: white; width: 100%; border-radius: 12px;"
              onclick="FahrtenModule.trackingStoppen()">
        \u23F9 Aufzeichnung beenden
      </button>
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

  // Warnung wenn Zurück-Button während Aufzeichnung
  _zeigeTrackingWarnung() {
    // Overlay mit Warnung
    const existing = document.getElementById('trackingWarnOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'trackingWarnOverlay';
    overlay.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;">
        <div style="background:#fff;border-radius:16px;padding:24px;max-width:340px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
          <h3 style="margin:0 0 12px;color:#dc2626;">Aufzeichnung l\u00e4uft!</h3>
          <p style="margin:0 0 16px;color:#555;line-height:1.5;">
            Wenn du zur\u00fcck gehst, geht die aktuelle Aufzeichnung verloren.
          </p>
          <p style="margin:0 0 20px;color:#555;font-size:0.9rem;line-height:1.5;">
            <strong>Tipp:</strong> Dr\u00fccke den <strong>Home-Button</strong> oder wechsle \u00fcber die <strong>Task-\u00dcbersicht</strong> zu einer anderen App \u2014 die Aufzeichnung l\u00e4uft im Hintergrund weiter.
          </p>
          <div style="display:flex;gap:10px;">
            <button onclick="document.getElementById('trackingWarnOverlay').remove()"
              style="flex:1;padding:12px;border:1px solid #ddd;border-radius:10px;background:#fff;font-size:1rem;cursor:pointer;">
              Weiter aufzeichnen
            </button>
            <button onclick="document.getElementById('trackingWarnOverlay').remove();FahrtenModule.trackingStoppen()"
              style="flex:1;padding:12px;border:none;border-radius:10px;background:#dc2626;color:#fff;font-size:1rem;cursor:pointer;">
              Beenden
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },

  // Event-Listener entfernen nach Tracking-Ende
  _trackingListenerEntfernen() {
    if (this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
    if (this._popstateHandler) {
      window.removeEventListener('popstate', this._popstateHandler);
      this._popstateHandler = null;
    }
  },

  async trackingStoppen() {
    this._trackingListenerEntfernen();

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
                 value="${this._trackEndAdresse || ((FIRMA||{}).startAdresse||'')}" placeholder="Startadresse eingeben">
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
          <button type="button" id="btnRouteBerechnen" class="btn btn-sm btn-outline" onclick="FahrtenModule.routeBerechnen()">
            &#x1F5FA;&#xFE0F; Route berechnen &amp; km ermitteln
          </button>
          <button type="button" class="btn btn-sm btn-primary" onclick="FahrtenModule.fahrtSpeichern('${datum}')">
            Speichern
          </button>
        </div>

        <div class="map-container" style="height: 250px;">
          <div id="routeMap" style="height: 100%; width: 100%;"></div>
        </div>
      </div>

      <div class="btn-group mt-2">
        <button class="btn btn-secondary btn-block" onclick="FahrtenModule.wocheAnzeigen()">
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

  async neueFahrtAusTermin(kundeId, terminDatum) {
    const kunden = await DB.alleKunden();
    const kunde = kunden.find(k => k.id === kundeId);
    if (!kunde) { App.toast('Kunde nicht gefunden', 'error'); return; }

    const adresse = [kunde.strasse, kunde.plz, kunde.ort].filter(Boolean).join(', ');
    if (!adresse) { App.toast('Keine Adresse beim Kunden hinterlegt', 'error'); return; }

    const datum = terminDatum || App.heute();
    const startAdresse = (FIRMA || {}).startAdresse || 'Kreisstraße 12, 45525 Hattingen';

    // Kassen rausfiltern (wie in neueFahrt)
    const kassenKw = ['aok','barmer','dak','techniker','knappschaft','bkk','novitas','energie','lbv','landesamt','krankenkasse','ersatzkasse','pflegekasse'];
    const echteKunden = kunden.filter(k => !kassenKw.some(kw => (k.name||'').toLowerCase().includes(kw)) && k.kundentyp !== 'inaktiv');

    const container = document.getElementById('fahrtenContent');

    container.innerHTML = `
      <div class="card">
        <h3 class="card-title mb-2">Neue Fahrt - ${App.wochentagName(datum)}, ${App.formatDatum(datum)}</h3>

        <div class="form-group">
          <label>Start</label>
          <input type="text" id="fahrtStart" class="form-control"
                 value="${KundenModule.escapeHtml(startAdresse)}" placeholder="Startadresse eingeben">
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
          <button type="button" id="btnRouteBerechnen" class="btn btn-sm btn-outline" onclick="FahrtenModule.routeBerechnen()" disabled>
            &#x1F5FA;&#xFE0F; Route berechnen &amp; km ermitteln
          </button>
          <button type="button" class="btn btn-sm btn-primary" onclick="FahrtenModule.fahrtSpeichern('${datum}')">
            Speichern
          </button>
        </div>

        <div class="map-container" style="height: 250px;">
          <div id="routeMap" style="height: 100%; width: 100%;"></div>
        </div>
      </div>

      <div class="btn-group mt-2">
        <button class="btn btn-secondary btn-block" onclick="FahrtenModule.wocheAnzeigen()">
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

      // Zieladresse vorausfüllen
      const zielInput = document.querySelector('.ziel-adresse');
      if (zielInput) zielInput.value = adresse;

      // Kunden-Dropdown vorauswählen
      const kundeSelect = document.querySelector('.ziel-kunde');
      if (kundeSelect) {
        kundeSelect.value = kundeId;
        const sucheInput = document.querySelector('.ziel-suche');
        if (sucheInput) {
          const option = kundeSelect.querySelector(`option[value="${kundeId}"]`);
          if (option) sucheInput.value = option.textContent;
        }
      }

      // Rückfahrt zur Firma als zweites Ziel (silent: Route-Button bleibt disabled)
      this.zielHinzufuegen(true);
      setTimeout(() => {
        const zielInputs = document.querySelectorAll('.ziel-adresse');
        if (zielInputs.length >= 2) {
          zielInputs[zielInputs.length - 1].value = startAdresse;
        }
        // Route berechnen
        this.routeBerechnen();
      }, 100);

      // Autocomplete für Start- und Ziel-Felder
      this.setupAutocomplete(document.getElementById('fahrtStart'));
      document.querySelectorAll('.ziel-adresse').forEach(el => this.setupAutocomplete(el));

      // Route direkt berechnen
      this.routeBerechnen();
    }, 100);
  },

  // ===== TAGESTOUR =====

  async tourErstellen(kundenIds) {
    // Tour mit bestimmten Kunden-IDs — nutzt tagestourErstellen mit Filter
    this._tourKundenIds = kundenIds;
    await this.tagestourErstellen();
    this._tourKundenIds = null;
  },

  async tagestourErstellen() {
    App.toast('Tagestour wird vorbereitet...', 'info');

    try {
      const heute = App.heute();
      const [termine, alleKunden] = await Promise.all([
        DB.termineFuerDatum(heute),
        DB.alleKunden()
      ]);
      const kundenMap = {};
      alleKunden.forEach(k => { kundenMap[k.id] = k; });

      // Heutige Fahrten zum Abgleich (bereits erfasste ausschliessen)
      const heutigeFahrten = await DB.fahrtenFuerWoche(App.localDateStr(App.getMontag(new Date())));
      const bereitsErfassteZiele = new Set();
      heutigeFahrten.filter(f => f.datum === heute).forEach(f => {
        (f.zielAdressen || []).forEach(z => bereitsErfassteZiele.add(z.toLowerCase().trim()));
      });

      // Termine mit Kunde + Adresse, sortiert nach Uhrzeit
      // Optional: nur bestimmte Kunden (für tourErstellen)
      const filterIds = this._tourKundenIds ? new Set(this._tourKundenIds) : null;
      const terminMitKunde = termine
        .filter(t => t.kundeId && kundenMap[t.kundeId] && (!filterIds || filterIds.has(t.kundeId)))
        .map(t => {
          const kunde = kundenMap[t.kundeId];
          const adresse = [kunde.strasse, kunde.plz, kunde.ort].filter(Boolean).join(', ');
          if (!adresse) return null;
          const bereitsErfasst = bereitsErfassteZiele.has(adresse.toLowerCase().trim());
          return { termin: t, kunde, adresse, bereitsErfasst };
        })
        .filter(item => item && !item.bereitsErfasst);

      // Deduplizieren nach Kunde
      const gesehen = new Set();
      const eindeutig = terminMitKunde.filter(item => {
        if (gesehen.has(item.kunde.id)) return false;
        gesehen.add(item.kunde.id);
        return true;
      });

      // Sortiert nach Termin-Uhrzeit (zeit Feld oder startzeit)
      eindeutig.sort((a, b) => {
        const zeitA = a.termin.zeit || a.termin.startzeit || '00:00';
        const zeitB = b.termin.zeit || b.termin.startzeit || '00:00';
        return zeitA.localeCompare(zeitB);
      });

      if (eindeutig.length < 2) {
        App.toast('Mindestens 2 Kunden-Termine noetig', 'info');
        return;
      }

      const startAdresse = (FIRMA || {}).startAdresse || 'Kreisstraße 12, 45525 Hattingen';
      const kundenNamen = eindeutig.map(item => App.kundenName(item.kunde).split(',')[0].trim());
      const notizText = 'Tagestour: ' + kundenNamen.join(' → ');

      // Alle Adressen fuer die Tour: Firma → Kunde1 → Kunde2 → ... → Firma
      const tourAdressen = [startAdresse, ...eindeutig.map(item => item.adresse), startAdresse];

      // Kassen rausfiltern fuer das Formular-Dropdown
      const kassenKw = ['aok','barmer','dak','techniker','knappschaft','bkk','novitas','energie','lbv','landesamt','krankenkasse','ersatzkasse','pflegekasse'];
      const echteKunden = alleKunden.filter(k => !kassenKw.some(kw => (k.name||'').toLowerCase().includes(kw)) && k.kundentyp !== 'inaktiv');

      const container = document.getElementById('fahrtenContent');

      // Ziel-Eintraege vorausgefuellt rendern
      const zieleHtml = eindeutig.map(item => {
        const kundenOptions = echteKunden.map(k => {
          const adresse = [k.strasse, k.plz, k.ort].filter(Boolean).join(', ');
          const selected = k.id === item.kunde.id ? ' selected' : '';
          return `<option value="${k.id}" data-adresse="${KundenModule.escapeHtml(adresse)}"${selected}>${KundenModule.escapeHtml(App.kundenName(k))}${adresse ? ' (' + KundenModule.escapeHtml(k.ort || '') + ')' : ''}</option>`;
        }).join('');

        return `
          <div class="ziel-entry mb-1">
            <input type="text" class="form-control ziel-suche" value="${KundenModule.escapeHtml(App.kundenName(item.kunde))}" placeholder="Ziel über Kunden suchen..." oninput="FahrtenModule.zielFiltern(this)" onfocus="FahrtenModule.zielFiltern(this)" style="margin-bottom: 4px;">
            <select class="form-control ziel-kunde" onchange="FahrtenModule.kundeGewaehlt(this)" size="1" style="margin-bottom: 4px;">
              <option value="">-- Ziel wählen --</option>
              ${kundenOptions}
            </select>
            <input type="text" class="form-control ziel-adresse" value="${KundenModule.escapeHtml(item.adresse)}" placeholder="Adresse">
          </div>`;
      }).join('');

      container.innerHTML = `
        <div class="card">
          <h3 class="card-title mb-2">🚗 Tagestour - ${App.wochentagName(heute)}, ${App.formatDatum(heute)}</h3>
          <div class="text-sm text-muted mb-2">${KundenModule.escapeHtml(notizText)}</div>

          <div class="form-group">
            <label>Start</label>
            <input type="text" id="fahrtStart" class="form-control"
                   value="${KundenModule.escapeHtml(startAdresse)}" placeholder="Startadresse eingeben">
          </div>

          <div class="form-group">
            <label>Ziele (${eindeutig.length} Kunden + Rückfahrt)</label>
            <div id="zieleListe">
              ${zieleHtml}
            </div>
            <button type="button" class="btn btn-sm btn-secondary mt-1" onclick="FahrtenModule.zielHinzufuegen()">
              + Weiteres Ziel
            </button>
          </div>

          <div class="form-group">
            <label for="fahrtNotiz">Notiz</label>
            <input type="text" id="fahrtNotiz" class="form-control" value="${KundenModule.escapeHtml(notizText)}">
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="fahrtKm">Kilometer</label>
              <input type="number" id="fahrtKm" class="form-control" step="0.1" min="0"
                     placeholder="wird berechnet..." oninput="FahrtenModule.kmAktualisieren()">
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
              🗺️ Route berechnen &amp; km ermitteln
            </button>
          </div>

          <div class="map-container" style="height: 250px;">
            <div id="routeMap" style="height: 100%; width: 100%;"></div>
          </div>
        </div>

        <div class="btn-group mt-2">
          <button class="btn btn-primary btn-block" onclick="FahrtenModule.fahrtSpeichern('${heute}')">
            Speichern
          </button>
          <button class="btn btn-secondary" onclick="FahrtenModule.wocheAnzeigen()">
            Abbrechen
          </button>
        </div>
      `;

      // Karte initialisieren und Route automatisch berechnen
      setTimeout(() => {
        if (this.map) this.map.remove();
        this.map = L.map('routeMap').setView([51.3993, 7.1859], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap', maxZoom: 19
        }).addTo(this.map);

        // Autocomplete
        this.setupAutocomplete(document.getElementById('fahrtStart'));
        document.querySelectorAll('.ziel-adresse').forEach(el => this.setupAutocomplete(el));

        // Route direkt berechnen
        this.routeBerechnen();
      }, 100);

    } catch (err) {
      console.error('Tagestour-Fehler:', err);
      App.toast('Fehler bei Tagestour-Erstellung', 'error');
    }
  },

  // Ziel-Eingabe: Suche + Dropdown + Freitext
  _zielKundenCache: null,

  zielEingabeRendern(kunden) {
    this._zielKundenCache = kunden;
    const kundenOptions = kunden.map(k => {
      const adresse = [k.strasse, k.plz, k.ort].filter(Boolean).join(', ');
      return `<option value="${k.id}" data-adresse="${KundenModule.escapeHtml(adresse)}">${KundenModule.escapeHtml(App.kundenName(k))}${adresse ? ' (' + KundenModule.escapeHtml(k.ort || '') + ')' : ''}</option>`;
    }).join('');

    return `
      <input type="text" class="form-control ziel-suche" placeholder="Ziel \u00fcber Kunden suchen..." oninput="FahrtenModule.zielFiltern(this)" onfocus="FahrtenModule.zielFiltern(this)" style="margin-bottom: 4px;">
      <select class="form-control ziel-kunde" onchange="FahrtenModule.kundeGewaehlt(this)" size="1" style="margin-bottom: 4px;">
        <option value="">-- Ziel w\u00e4hlen --</option>
        ${kundenOptions}
      </select>
      <input type="text" class="form-control ziel-adresse" placeholder="Adresse (wird automatisch ausgef\u00fcllt oder frei eingeben)">
    `;
  },

  zielFiltern(inputEl) {
    const query = (inputEl.value || '').toLowerCase().trim();
    const entry = inputEl.closest('.ziel-entry');
    const selectEl = entry.querySelector('.ziel-kunde');
    if (!selectEl || !this._zielKundenCache) return;

    const kunden = this._zielKundenCache;
    let html = '<option value="">-- Ziel w\u00e4hlen --</option>';
    for (const k of kunden) {
      const name = App.kundenName(k).toLowerCase();
      const adresse = [k.strasse, k.plz, k.ort].filter(Boolean).join(', ');
      const fullText = (name + ' ' + adresse).toLowerCase();
      if (!query || fullText.includes(query)) {
        html += `<option value="${k.id}" data-adresse="${KundenModule.escapeHtml(adresse)}">${KundenModule.escapeHtml(App.kundenName(k))}${adresse ? ' (' + KundenModule.escapeHtml(k.ort || '') + ')' : ''}</option>`;
      }
    }
    selectEl.innerHTML = html;
    // Bei Ergebnissen Dropdown aufklappen
    if (query && kunden.length > 0) {
      selectEl.size = Math.min(5, selectEl.options.length);
    } else {
      selectEl.size = 1;
    }
  },

  kundeGewaehlt(selectEl) {
    const option = selectEl.selectedOptions[0];
    const entry = selectEl.closest('.ziel-entry');
    const adresseInput = entry.querySelector('.ziel-adresse');
    const sucheInput = entry.querySelector('.ziel-suche');
    if (option.value && option.dataset.adresse) {
      adresseInput.value = option.dataset.adresse;
    }
    if (option.value && sucheInput) {
      sucheInput.value = option.textContent;
    }
    selectEl.size = 1;
  },

  async zielHinzufuegen(silent = false) {
    const kunden = await DB.alleKunden();
    const zieleListe = document.getElementById('zieleListe');
    const entry = document.createElement('div');
    entry.className = 'ziel-entry mb-1';
    entry.innerHTML = this.zielEingabeRendern(kunden);
    zieleListe.appendChild(entry);
    if (!silent) {
      document.getElementById('btnRouteBerechnen')?.removeAttribute('disabled');
    }
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
    // Rückfahrt nur hinzufügen wenn letztes Ziel nicht schon die Startadresse ist
    const letztesZiel = adressen[adressen.length - 1] || '';
    if (letztesZiel.toLowerCase() !== startAddr.toLowerCase()) {
      adressen.push(startAddr);
    }

    if (adressen.length < 2) {
      App.toast('Bitte mindestens ein Ziel eingeben', 'info');
      return;
    }

    App.toast('Route wird berechnet...', 'info');

    try {
      // Geocoding mit Deduplizierung + Rate-Limit (1 req/s für Nominatim)
      const geocodeCache = {};
      const coords = [];
      for (const addr of adressen) {
        if (geocodeCache[addr]) {
          coords.push(geocodeCache[addr]);
          continue;
        }
        await new Promise(r => setTimeout(r, 1100)); // Nominatim Rate-Limit
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`,
          { headers: { 'User-Agent': 'entlast.de/1.0' } }
        );
        const results = await response.json();
        if (results.length > 0) {
          const c = [parseFloat(results[0].lon), parseFloat(results[0].lat)];
          coords.push(c);
          geocodeCache[addr] = c;
        } else {
          App.toast(`Adresse nicht gefunden: ${addr}`, 'error', 8000);
        }
      }

      if (coords.length < 2) {
        App.toast('Zu wenige Adressen gefunden für Routenberechnung', 'error');
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

        // Teilstrecken in Notiz schreiben (wenn > 2 Wegpunkte)
        if (route.legs && route.legs.length > 1) {
          const adressenKurz = adressen.map(a => a.split(',')[0].trim());
          const teilstrecken = route.legs.map((leg, i) => {
            const km = (leg.distance / 1000).toFixed(1);
            return `${adressenKurz[i]} → ${adressenKurz[i+1]} (${km} km)`;
          });
          const tourNotiz = 'Tour: ' + teilstrecken.join(', ');
          const notizInput = document.getElementById('fahrtNotiz');
          if (notizInput) notizInput.value = tourNotiz;
        }

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
                    ${kunden.map(k => `<option value="${k.id}" data-adresse="${KundenModule.escapeHtml((k.strasse || '') + ', ' + (k.plz || '') + ' ' + (k.ort || ''))}">${KundenModule.escapeHtml(App.kundenName(k))}</option>`).join('')}
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
    const montagStr = App.localDateStr(montag);

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
      const montagStr = App.localDateStr(montag);

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
