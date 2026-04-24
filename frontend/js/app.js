/**
 * Haupt-App-Modul für Susi's Alltagshilfe
 * Initialisierung, Navigation, globale Hilfsfunktionen
 */

const App = {
  isOnline: navigator.onLine,

  version: '1.5.0',

  // App initialisieren
  init() {
    this.registerServiceWorker();
    this.setupOnlineStatus();
    this.updateSyncStatus();
    this.showVersion();
    console.log("Susi's Alltagshilfe v" + this.version + " gestartet");
  },

  // Versionsnummer im Header anzeigen
  showVersion() {
    const el = document.getElementById('appVersion');
    if (el) {
      el.textContent = 'v' + this.version;
    } else {
      // Automatisch ans sync-status div anhängen
      const syncDiv = document.querySelector('.sync-status');
      if (syncDiv) {
        const span = document.createElement('span');
        span.id = 'appVersion';
        span.style.cssText = 'font-size: 0.6rem; opacity: 0.6; margin-left: 6px;';
        span.textContent = 'v' + this.version;
        syncDiv.appendChild(span);
      }
    }
  },

  // Service Worker registrieren
  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js?v=78', { updateViaCache: 'none' });
        console.log('Service Worker registriert:', registration.scope);

        // Auf Updates prüfen
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              // Neuer SW aktiv → Seite automatisch neu laden
              console.log('Neuer Service Worker aktiv — Seite wird aktualisiert');
              window.location.reload();
            }
          });
        });

        // Regelmäßig auf Updates prüfen (alle 60s)
        setInterval(() => registration.update(), 60000);
      } catch (err) {
        console.warn('Service Worker Registrierung fehlgeschlagen:', err);
      }
    }
  },

  // Online/Offline Status überwachen
  setupOnlineStatus() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.updateSyncStatus();
      App.toast('Wieder online', 'success');
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateSyncStatus();
      App.toast('Offline-Modus aktiv', 'info');
    });
  },

  // Sync-Anzeige aktualisieren
  updateSyncStatus() {
    const dot = document.querySelector('.sync-dot');
    const label = document.querySelector('.sync-label');
    if (dot) {
      dot.className = 'sync-dot' + (this.isOnline ? '' : ' offline');
    }
    if (label) {
      label.textContent = this.isOnline ? 'Online' : 'Offline';
    }
  },

  // Toast-Benachrichtigung
  toast(message, type = 'info', duration = 5000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: '\u2713', error: '\u2717', info: '\u2139' };
    toast.innerHTML = `<span>${icons[type] || '\u2139'}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  // Datum formatieren (deutsch)
  formatDatum(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  },

  // Datum für Input-Felder
  formatDatumInput(dateStr) {
    if (!dateStr) return this.localDateStr(new Date());
    return this.localDateStr(new Date(dateStr));
  },

  // Uhrzeit formatieren
  formatZeit(zeitStr) {
    if (!zeitStr) return '';
    return zeitStr.substring(0, 5);
  },

  // Wochentag-Name
  wochentagName(datum) {
    const tage = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    return tage[new Date(datum).getDay()];
  },

  // Wochentag-Kürzel
  wochentagKurz(datum) {
    const tage = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    return tage[new Date(datum).getDay()];
  },

  // Montag der aktuellen Woche berechnen
  getMontag(datum) {
    const d = new Date(datum || new Date());
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  },

  // Betrag formatieren
  formatBetrag(betrag) {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR'
    }).format(betrag || 0);
  },

  // Kundenname formatiert: "Vorname Nachname"
  kundenName(kunde) {
    if (!kunde) return 'Unbekannt';
    return [kunde.vorname, kunde.name].filter(Boolean).join(' ') || kunde.name || 'Unbekannt';
  },

  // Echte Versicherte filtern (keine Kassen, keine Firmen/Lieferanten, keine Inaktiven)
  echteKunden(kunden) {
    const kassenKw = ['aok','barmer','dak','techniker','knappschaft','bkk','novitas','energie','lbv','landesamt','krankenkasse','ersatzkasse','pflegekasse'];
    return kunden.filter(k => {
      if (k.kundentyp === 'inaktiv') return false;
      if (kassenKw.some(kw => (k.name||'').toLowerCase().includes(kw))) return false;
      // Nur Personen mit Vornamen (Firmen/Lieferanten haben keinen)
      if (!k.vorname) return false;
      return true;
    });
  },

  // Initialen aus Name (nutzt vorname + name)
  initialen(name, vorname) {
    if (!name && !vorname) return '?';
    if (vorname && name) {
      return (vorname[0] + name[0]).toUpperCase();
    }
    const fullName = name || vorname || '';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return fullName.substring(0, 2).toUpperCase();
  },

  // Modal öffnen
  openModal(modalId) {
    const overlay = document.getElementById(modalId);
    if (overlay) {
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  },

  // Modal schließen
  closeModal(modalId) {
    const overlay = document.getElementById(modalId);
    if (overlay) {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  },

  // Bestätigungsdialog
  async confirm(message) {
    return window.confirm(message);
  },

  // Monatsname
  monatsName(monat) {
    const monate = [
      'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
    ];
    return monate[(monat - 1) % 12];
  },

  // Date-Objekt als lokales YYYY-MM-DD (ohne UTC-Verschiebung)
  localDateStr(d) {
    if (!d) d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  // Aktuelles Datum als String
  heute() {
    return this.localDateStr(new Date());
  },

  // Aktuelle Uhrzeit als String
  jetztZeit() {
    return new Date().toTimeString().substring(0, 5);
  },

  // Debounce-Funktion
  debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },

  // Stunden berechnen aus Start-/Endzeit
  stundenBerechnen(startzeit, endzeit) {
    if (!startzeit || !endzeit) return 0;
    const [sh, sm] = startzeit.split(':').map(Number);
    const [eh, em] = endzeit.split(':').map(Number);
    const diffMinuten = (eh * 60 + em) - (sh * 60 + sm);
    return Math.max(0, diffMinuten / 60);
  },

  // Betrag berechnen
  betragBerechnen(stunden) {
    return Math.round(stunden * ((FIRMA || {}).stundensatz || 32.75) * 100) / 100;
  },

  // Sync-Zeitstempel relativ formatieren
  formatSyncZeit(datum) {
    if (!datum) return '';
    const d = datum instanceof Date ? datum : new Date(datum);
    if (isNaN(d.getTime())) return '';

    const jetzt = new Date();
    const heute = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
    const tag = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffTage = Math.floor((heute - tag) / (1000 * 60 * 60 * 24));
    const zeit = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    if (diffTage === 0) return 'heute ' + zeit;
    if (diffTage === 1) return 'gestern ' + zeit;
    if (diffTage === 2) return 'vorgestern';

    if (diffTage >= 3 && diffTage <= 7) {
      // Gleiche Kalenderwoche?
      const kwJetzt = this._kalenderwoche(jetzt);
      const kwDatum = this._kalenderwoche(d);
      if (kwJetzt[0] === kwDatum[0] && kwJetzt[1] === kwDatum[1]) {
        return 'diese Woche';
      }
      const tage = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
      return tage[d.getDay()];
    }

    if (diffTage > 7 && diffTage <= 14) return 'letzte Woche';

    if (d.getFullYear() === jetzt.getFullYear() && d.getMonth() === jetzt.getMonth()) {
      return 'diesen Monat';
    }

    // Vormonat
    const vormonat = new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 1);
    if (d.getFullYear() === vormonat.getFullYear() && d.getMonth() === vormonat.getMonth()) {
      return 'letzten Monat';
    }

    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },

  // Kalenderwoche berechnen (ISO 8601) — gibt [jahr, kw] zurück
  _kalenderwoche(datum) {
    const d = new Date(Date.UTC(datum.getFullYear(), datum.getMonth(), datum.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const jahresAnfang = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const kw = Math.ceil((((d - jahresAnfang) / 86400000) + 1) / 7);
    return [d.getUTCFullYear(), kw];
  },

  // Mini-Taschenrechner für Betragsfelder
  miniRechner(zielFeldId) {
    const alt = document.getElementById('miniRechnerOverlay');
    if (alt) alt.remove();

    const overlay = document.createElement('div');
    overlay.id = 'miniRechnerOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:600;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = `
      <div style="background:white;border-radius:12px;padding:20px;width:280px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <strong>Rechner</strong>
          <button onclick="document.getElementById('miniRechnerOverlay').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;">\u2715</button>
        </div>
        <input type="text" id="rechnerFormel" class="form-control" placeholder="z.B. 8 * 131"
               oninput="App._rechnerBerechnen()" style="font-size:1.1rem;margin-bottom:8px;">
        <div id="rechnerErgebnis" style="font-size:1.3rem;font-weight:700;text-align:right;padding:8px;background:var(--gray-100);border-radius:8px;margin-bottom:12px;">
          0,00 \u20ac
        </div>
        <button class="btn btn-primary btn-block" onclick="App._rechnerUebernehmen('${zielFeldId}')">
          \u00dcbernehmen
        </button>
      </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById('rechnerFormel').focus();
  },

  _rechnerBerechnen() {
    const formel = document.getElementById('rechnerFormel').value.trim();
    const ergebnisEl = document.getElementById('rechnerErgebnis');
    if (!formel) { ergebnisEl.textContent = '0,00 \u20ac'; return; }
    try {
      const bereinigt = formel.replace(/,/g, '.').replace(/[^0-9.+\-*/() ]/g, '');
      const result = new Function('return ' + bereinigt)();
      if (typeof result === 'number' && isFinite(result)) {
        ergebnisEl.textContent = result.toFixed(2).replace('.', ',') + ' \u20ac';
      } else {
        ergebnisEl.textContent = '?';
      }
    } catch (e) {
      ergebnisEl.textContent = '...';
    }
  },

  _rechnerUebernehmen(zielFeldId) {
    const formel = document.getElementById('rechnerFormel').value.trim();
    if (!formel) return;
    try {
      const bereinigt = formel.replace(/,/g, '.').replace(/[^0-9.+\-*/() ]/g, '');
      const result = new Function('return ' + bereinigt)();
      if (typeof result === 'number' && isFinite(result)) {
        document.getElementById(zielFeldId).value = result.toFixed(2);
        document.getElementById('miniRechnerOverlay').remove();
      }
    } catch (e) {
      // ignorieren
    }
  },

  // "Mehr"-Overlay-Menu initialisieren
  initMoreMenu() {
    const moreBtn = document.getElementById('navMoreBtn');
    if (!moreBtn) return;

    // Pfad-Prefix: Root oder pages/?
    const inPages = window.location.pathname.includes('/pages/');
    const prefix = inPages ? '' : 'pages/';
    const homeLink = inPages ? '../index.html' : 'index.html';

    // Overlay-HTML erzeugen
    const overlay = document.createElement('div');
    overlay.id = 'moreMenuOverlay';
    overlay.innerHTML = `
      <div class="more-menu-backdrop" id="moreMenuBackdrop"></div>
      <div class="more-menu-panel" id="moreMenuPanel">
        <a href="${prefix}termine.html" class="more-menu-item"><span class="more-menu-icon">\uD83D\uDCC5</span> Termine</a>
        <a href="${prefix}fahrten.html" class="more-menu-item"><span class="more-menu-icon">\uD83D\uDE97</span> Fahrten</a>
        <a href="${prefix}entlastung.html" class="more-menu-item"><span class="more-menu-icon">\u23F3</span> \u00A745b Budget</a>
        <a href="${prefix}abtretung.html" class="more-menu-item"><span class="more-menu-icon">\uD83D\uDCDD</span> Abtretung</a>
        <a href="${prefix}firma.html" class="more-menu-item"><span class="more-menu-icon">\uD83C\uDFE2</span> Firmendaten</a>
        <a href="${prefix}settings.html" class="more-menu-item"><span class="more-menu-icon">\u2699\uFE0F</span> Einstellungen</a>
      </div>
    `;
    document.body.appendChild(overlay);

    // CSS injizieren
    if (!document.getElementById('moreMenuStyles')) {
      const style = document.createElement('style');
      style.id = 'moreMenuStyles';
      style.textContent = `
        .more-menu-backdrop {
          display: none;
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 60px;
          background: rgba(0,0,0,0.4);
          z-index: 998;
        }
        .more-menu-backdrop.active {
          display: block;
        }
        .more-menu-panel {
          display: none;
          position: fixed;
          bottom: 64px;
          left: 12px;
          right: 12px;
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 -4px 24px rgba(0,0,0,0.18);
          z-index: 999;
          padding: 8px 0;
          max-width: 400px;
          margin: 0 auto;
        }
        .more-menu-panel.active {
          display: block;
        }
        .more-menu-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 20px;
          text-decoration: none;
          color: #1a2b32;
          font-size: 1rem;
          font-weight: 500;
          transition: background 0.15s;
        }
        .more-menu-item:hover, .more-menu-item:active {
          background: #f0f4f8;
        }
        .more-menu-icon {
          font-size: 1.25rem;
          width: 28px;
          text-align: center;
        }
      `;
      document.head.appendChild(style);
    }

    // Toggle-Logik
    const panel = document.getElementById('moreMenuPanel');
    const backdrop = document.getElementById('moreMenuBackdrop');
    let isOpen = false;

    function toggleMenu() {
      isOpen = !isOpen;
      panel.classList.toggle('active', isOpen);
      backdrop.classList.toggle('active', isOpen);
    }

    function closeMenu() {
      isOpen = false;
      panel.classList.remove('active');
      backdrop.classList.remove('active');
    }

    moreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleMenu();
    });

    backdrop.addEventListener('click', closeMenu);

    // Menu-Items schliessen das Menu automatisch (Navigation passiert via href)
  }
};

// App beim Laden initialisieren
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  App.initMoreMenu();
});
