/**
 * Einstellungen-Modul für Susi's Alltagshilfe
 */

const SettingsModule = {
  async init() {
    try {
      await this.anzeigen();
    } catch (e) {
      console.error('Settings init Fehler:', e);
      const c = document.getElementById('settingsContent');
      if (c) c.innerHTML = '<div class="card"><p>Einstellungen konnten nicht geladen werden: ' + e.message + '</p></div>';
    }
  },

  async anzeigen() {
    const container = document.getElementById('settingsContent');
    if (!container) return;
    if (!window.FIRMA) window.FIRMA = {};
    const F = Object.assign({}, window.FIRMA);

    // Konfigurationsstatus der sensiblen Keys pruefen (Werte werden NIE geladen)
    const lexofficeKeyOk = await DB.settingKonfiguriert('lexoffice_api_key');
    const sipgateTokenIdOk = await DB.settingKonfiguriert('sipgate_token_id');
    const sipgateTokenOk = await DB.settingKonfiguriert('sipgate_token');
    const letterxpressUserOk = await DB.settingKonfiguriert('letterxpress_user');
    const letterxpressKeyOk = await DB.settingKonfiguriert('letterxpress_key');

    // Google Kalender URL
    const gcalUrl = await DB.settingLesen('gcal_ical_url');

    // Statistiken
    const stats = await DB.statistiken();

    container.innerHTML = `
      <!-- Firmendaten -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Firmendaten</span>
          <span class="card-icon pink">🏠</span>
        </div>
        <p class="text-sm text-muted">${F.name || 'Noch nicht konfiguriert'}</p>
        <a href="../pages/firma.html" class="btn btn-sm btn-outline mt-1">Firmendaten bearbeiten →</a>
      </div>

      <!-- Statistiken -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Statistiken</span>
          <span class="card-icon blue">📊</span>
        </div>
        <div class="route-summary" style="margin-bottom: 0;">
          <div class="summary-item">
            <div class="summary-value">${stats.kunden}</div>
            <div class="summary-label">Kunden</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">${stats.leistungen}</div>
            <div class="summary-label">Leistungen</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">${stats.offeneRechnungen}</div>
            <div class="summary-label">Offene Rechnungen</div>
          </div>
        </div>
      </div>

      <!-- API-Schlüssel -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">API-Einstellungen</span>
          <span class="card-icon orange">🔑</span>
        </div>

        <div class="form-group">
          <label>Lexoffice API-Key</label>
          <div class="api-key-status" id="statusLexoffice">
            ${lexofficeKeyOk
              ? '<span style="color: var(--success);">&#10003; konfiguriert</span>'
              : '<span style="color: var(--text-muted);">&#10007; nicht gesetzt</span>'}
            <button class="btn btn-sm btn-outline" onclick="SettingsModule.keyAendern('settLexoffice', 'Lexoffice API-Key', 'API-Schlüssel eingeben')">Ändern</button>
          </div>
          <div id="editLexoffice" style="display:none;" class="mt-1">
            <input type="password" id="settLexoffice" class="form-control" placeholder="API-Schlüssel eingeben">
            <div class="btn-group mt-1">
              <button class="btn btn-sm btn-primary" onclick="SettingsModule.keySpeichern('lexoffice_api_key', 'settLexoffice', 'statusLexoffice', 'editLexoffice')">Speichern</button>
              <button class="btn btn-sm btn-outline" onclick="SettingsModule.keyAbbrechen('editLexoffice')">Abbrechen</button>
            </div>
          </div>
          <div class="form-hint">Für automatische Rechnungserstellung</div>
          ${lexofficeKeyOk ? '<div class="btn-group mt-1"><button class="btn btn-sm btn-outline" onclick="SettingsModule.lexofficeTesten()" id="lexofficeTestenBtn">🔗 Verbindung testen</button><button class="btn btn-sm btn-outline" onclick="SettingsModule.lexofficeUebernehmen()" id="lexofficeUebernehmenBtn">Daten von Lexoffice übernehmen</button></div>' : ''}
        </div>

        <div class="form-group">
          <label>Sipgate Token-ID</label>
          <div class="api-key-status" id="statusSipgateTokenId">
            ${sipgateTokenIdOk
              ? '<span style="color: var(--success);">&#10003; konfiguriert</span>'
              : '<span style="color: var(--text-muted);">&#10007; nicht gesetzt</span>'}
            <button class="btn btn-sm btn-outline" onclick="SettingsModule.keyAendern('settSipgateTokenId', 'Sipgate Token-ID', 'Token-ID')">Ändern</button>
          </div>
          <div id="editSipgateTokenId" style="display:none;" class="mt-1">
            <input type="text" id="settSipgateTokenId" class="form-control" placeholder="Token-ID">
            <div class="btn-group mt-1">
              <button class="btn btn-sm btn-primary" onclick="SettingsModule.keySpeichern('sipgate_token_id', 'settSipgateTokenId', 'statusSipgateTokenId', 'editSipgateTokenId')">Speichern</button>
              <button class="btn btn-sm btn-outline" onclick="SettingsModule.keyAbbrechen('editSipgateTokenId')">Abbrechen</button>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>Sipgate Token</label>
          <div class="api-key-status" id="statusSipgateToken">
            ${sipgateTokenOk
              ? '<span style="color: var(--success);">&#10003; konfiguriert</span>'
              : '<span style="color: var(--text-muted);">&#10007; nicht gesetzt</span>'}
            <button class="btn btn-sm btn-outline" onclick="SettingsModule.keyAendern('settSipgateToken', 'Sipgate Token', 'Token')">Ändern</button>
          </div>
          <div id="editSipgateToken" style="display:none;" class="mt-1">
            <input type="password" id="settSipgateToken" class="form-control" placeholder="Token">
            <div class="btn-group mt-1">
              <button class="btn btn-sm btn-primary" onclick="SettingsModule.keySpeichern('sipgate_token', 'settSipgateToken', 'statusSipgateToken', 'editSipgateToken')">Speichern</button>
              <button class="btn btn-sm btn-outline" onclick="SettingsModule.keyAbbrechen('editSipgateToken')">Abbrechen</button>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>LetterXpress Benutzername</label>
          <div class="api-key-status" id="statusLetterxpressUser">
            ${letterxpressUserOk
              ? '<span style="color: var(--success);">&#10003; konfiguriert</span>'
              : '<span style="color: var(--text-muted);">&#10007; nicht gesetzt</span>'}
            <button class="btn btn-sm btn-outline" onclick="SettingsModule.keyAendern('settLetterxpressUser', 'LetterXpress Benutzername', 'Benutzername')">Ändern</button>
          </div>
          <div id="editLetterxpressUser" style="display:none;" class="mt-1">
            <input type="text" id="settLetterxpressUser" class="form-control" placeholder="Benutzername">
            <div class="btn-group mt-1">
              <button class="btn btn-sm btn-primary" onclick="SettingsModule.keySpeichern('letterxpress_user', 'settLetterxpressUser', 'statusLetterxpressUser', 'editLetterxpressUser')">Speichern</button>
              <button class="btn btn-sm btn-outline" onclick="SettingsModule.keyAbbrechen('editLetterxpressUser')">Abbrechen</button>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>LetterXpress API-Key</label>
          <div class="api-key-status" id="statusLetterxpressKey">
            ${letterxpressKeyOk
              ? '<span style="color: var(--success);">&#10003; konfiguriert</span>'
              : '<span style="color: var(--text-muted);">&#10007; nicht gesetzt</span>'}
            <button class="btn btn-sm btn-outline" onclick="SettingsModule.keyAendern('settLetterxpressKey', 'LetterXpress API-Key', 'API-Key')">Ändern</button>
          </div>
          <div id="editLetterxpressKey" style="display:none;" class="mt-1">
            <input type="password" id="settLetterxpressKey" class="form-control" placeholder="API-Key">
            <div class="btn-group mt-1">
              <button class="btn btn-sm btn-primary" onclick="SettingsModule.keySpeichern('letterxpress_key', 'settLetterxpressKey', 'statusLetterxpressKey', 'editLetterxpressKey')">Speichern</button>
              <button class="btn btn-sm btn-outline" onclick="SettingsModule.keyAbbrechen('editLetterxpressKey')">Abbrechen</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Kalender-Abo -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Kalender abonnieren</span>
          <span class="card-icon blue">📅</span>
        </div>
        <p class="text-sm text-muted">Alle Termine aus entlast.de in Ihrer Kalender-App anzeigen (Google, Apple, Outlook).</p>
        <div class="form-group mt-1">
          <label>Abo-URL (zum Kopieren)</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="icalUrl" class="form-control" readonly
                   value="https://entlast.de/api/v1/ical/susi" style="font-size:0.8rem;">
            <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText(document.getElementById('icalUrl').value).then(()=>App.toast('URL kopiert','success'))">Kopieren</button>
          </div>
          <div class="form-hint mt-1">Kalender-App &rarr; Kalender hinzuf&uuml;gen &rarr; Per URL abonnieren &rarr; URL einf&uuml;gen</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Google Kalender importieren</span>
          <span class="card-icon pink">📅</span>
        </div>
        <p class="text-sm text-muted">Google-Termine in entlast.de anzeigen. Die iCal-URL finden Sie in den Google-Kalender-Einstellungen unter "Adresse im iCal-Format" (geheime Adresse).</p>
        <div class="form-group mt-1">
          <label>Google iCal-URL</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="settGcalUrl" class="form-control" placeholder="https://calendar.google.com/calendar/ical/...basic.ics" style="font-size:0.8rem;"
                   value="${gcalUrl || ''}">
            <button class="btn btn-sm btn-primary" onclick="SettingsModule.gcalUrlSpeichern()">Speichern</button>
          </div>
          <div id="gcalSyncStatus" class="form-hint mt-1"></div>
        </div>
      </div>

      <!-- Google Kalender Rückwärts-Sync (OAuth) -->
      <div class="card" id="gcalOAuthCard">
        <div class="card-header">
          <span class="card-title">Google Kalender — Rückwärts-Sync</span>
          <span class="card-icon pink">📤</span>
        </div>
        <p class="text-sm text-muted">
          Wenn aktiviert: In entlast erstellte/geänderte/gelöschte Termine werden in den Google Kalender übertragen.
          Setup erfordert einmalig Client-ID und Client-Secret aus der
          <a href="https://console.cloud.google.com/" target="_blank">Google Cloud Console</a>
          (Calendar API aktivieren · OAuth-Client „Web application" · Redirect-URI:
          <code style="font-size:0.7rem;background:#f5f5f5;padding:2px 4px;border-radius:3px;">https://entlast.de/api/v1/gcal/oauth/callback</code>).
        </p>
        <div id="gcalOAuthInhalt" style="margin-top:8px;">
          <div class="loading-spinner"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Datensicherung -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Datensicherung</span>
          <span class="card-icon pink">💾</span>
        </div>

        <div class="btn-group">
          <button class="btn btn-primary btn-block" onclick="SettingsModule.exportJSON()">
            📤 Alle Daten exportieren (JSON)
          </button>
        </div>

        <div class="form-group mt-2">
          <label for="importFile">Daten importieren</label>
          <input type="file" id="importFile" accept=".json"
                 class="form-control" onchange="SettingsModule.importJSON(event)">
          <div class="form-hint">⚠️ Überschreibt alle vorhandenen Daten!</div>
        </div>

        <button class="btn btn-outline btn-block mt-2" disabled>
          ☁️ Backup auf Google Drive (in Planung)
        </button>
      </div>

      <!-- Cache leeren -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">App-Cache</span>
          <span class="card-icon pink">🔄</span>
        </div>
        <p class="text-sm text-muted">Falls die App veraltete Daten anzeigt.</p>
        <button class="btn btn-outline btn-block" onclick="(async()=>{
          if(navigator.serviceWorker){const r=await navigator.serviceWorker.getRegistration();if(r)await r.unregister();}
          const keys=await caches.keys();for(const k of keys)await caches.delete(k);
          App.toast('Cache geleert — Seite wird neu geladen','success');
          setTimeout(()=>window.location.reload(),1500);
        })()">
          🗑️ Cache leeren &amp; neu laden
        </button>
      </div>

      <!-- App-Info -->
      <div class="card text-center text-sm text-muted">
        <p><strong>Susi's Alltagshilfe</strong></p>
        <p>Version ${App.version}</p>
        <p>PWA für Entlastungsleistungen nach § 45b SGB XI</p>
        <p class="mt-1">Made with ♥ für Susanne</p>
      </div>
    `;

    // Google Calendar Einstellungen dynamisch laden
    if (typeof GCalSync !== 'undefined') {
      const gcalCard = await GCalSync.renderSettingsCard();
      const placeholder = document.getElementById('gcalSettingsPlaceholder');
      if (placeholder) placeholder.innerHTML = gcalCard;
    }

    // Google OAuth Rückwärts-Sync laden
    await this.gcalOAuthRender();

    // Query-Param-Feedback aus OAuth-Callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('gcal_ok')) {
      App.toast('✓ Google Kalender verbunden', 'success');
      history.replaceState({}, '', window.location.pathname);
    } else if (params.get('gcal_error')) {
      App.toast('Google: ' + params.get('gcal_error'), 'error');
      history.replaceState({}, '', window.location.pathname);
    }
  },

  async gcalOAuthRender() {
    const c = document.getElementById('gcalOAuthInhalt');
    if (!c) return;
    let status;
    try {
      const r = await fetch('/api/v1/gcal/status', { credentials: 'include' });
      status = await r.json();
    } catch (e) {
      c.innerHTML = '<div class="form-hint">Status konnte nicht geladen werden.</div>';
      return;
    }

    if (!status.client_id_gesetzt) {
      // Phase 1: Client-ID/Secret eintragen
      c.innerHTML = `
        <div class="form-group">
          <label>Client-ID</label>
          <input type="text" id="gcalClientId" class="form-control" placeholder="123...apps.googleusercontent.com" style="font-size:0.8rem;">
        </div>
        <div class="form-group">
          <label>Client-Secret</label>
          <input type="password" id="gcalClientSecret" class="form-control" placeholder="GOCSPX-..." style="font-size:0.8rem;">
        </div>
        <button class="btn btn-primary btn-block" onclick="SettingsModule.gcalCredentialsSpeichern()">
          Credentials speichern
        </button>
      `;
      return;
    }

    if (!status.verbunden) {
      // Phase 2: Verbinden
      c.innerHTML = `
        <div class="form-hint mb-1">Client-ID gespeichert. Jetzt mit Google verbinden:</div>
        <button class="btn btn-primary btn-block" onclick="SettingsModule.gcalVerbinden()">
          🔗 Mit Google verbinden
        </button>
        <button class="btn btn-outline btn-sm mt-1" onclick="SettingsModule.gcalCredentialsReset()">
          Client-ID/Secret ändern
        </button>
      `;
      return;
    }

    // Phase 3: Verbunden — Kalender-Auswahl + Trennen
    let calendarsHtml = '';
    try {
      const r = await fetch('/api/v1/gcal/calendars', { credentials: 'include' });
      if (r.ok) {
        const cals = await r.json();
        const opts = cals.map(cal =>
          `<option value="${cal.id}" ${cal.id === status.calendar_id ? 'selected' : ''}>
            ${cal.summary}${cal.primary ? ' (Hauptkalender)' : ''}
          </option>`
        ).join('');
        calendarsHtml = `
          <div class="form-group">
            <label>Ziel-Kalender</label>
            <select id="gcalCalSelect" class="form-control" onchange="SettingsModule.gcalCalendarWaehlen(this.value)">
              ${opts}
            </select>
          </div>
        `;
      }
    } catch (e) {}

    c.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;color:#2e7d32;font-weight:600;margin-bottom:12px;">
        <span style="font-size:1.3rem;">✓</span> Verbunden
      </div>
      ${calendarsHtml}
      <button class="btn btn-outline btn-block" style="color:#dc2626;border-color:#dc2626;" onclick="SettingsModule.gcalTrennen()">
        Verbindung trennen
      </button>
    `;
  },

  async gcalCredentialsSpeichern() {
    const id = document.getElementById('gcalClientId').value.trim();
    const secret = document.getElementById('gcalClientSecret').value.trim();
    if (!id || !secret) { App.toast('Beide Felder ausfüllen', 'error'); return; }
    try {
      const r = await fetch('/api/v1/gcal/credentials', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: id, client_secret: secret }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
      App.toast('Credentials gespeichert', 'success');
      await this.gcalOAuthRender();
    } catch (e) {
      App.toast('Fehler: ' + e.message, 'error');
    }
  },

  gcalVerbinden() {
    // Browser-Redirect zu Google Consent
    const returnTo = '/pages/settings.html';
    window.location.href = `/api/v1/gcal/oauth/start?return_to=${encodeURIComponent(returnTo)}`;
  },

  async gcalCredentialsReset() {
    if (!confirm('Client-ID/Secret löschen?')) return;
    try {
      await fetch('/api/v1/gcal/credentials', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: '', client_secret: '' }),
      });
    } catch (e) {}
    // Trick: leerer POST schlägt fehl wegen 400, also direkt disconnect + manuelle Eingabe
    await fetch('/api/v1/gcal/disconnect', { method: 'POST', credentials: 'include' });
    await this.gcalOAuthRender();
  },

  async gcalCalendarWaehlen(calendarId) {
    try {
      await fetch('/api/v1/gcal/calendar', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendar_id: calendarId }),
      });
      App.toast('Kalender ausgewählt', 'success');
    } catch (e) {
      App.toast('Fehler: ' + e.message, 'error');
    }
  },

  async gcalTrennen() {
    if (!confirm('Verbindung zu Google trennen? Bestehende synchronisierte Termine bleiben in beiden Kalendern, aber neue werden nicht mehr gepusht.')) return;
    try {
      await fetch('/api/v1/gcal/disconnect', { method: 'POST', credentials: 'include' });
      App.toast('Verbindung getrennt', 'success');
      await this.gcalOAuthRender();
    } catch (e) {
      App.toast('Fehler: ' + e.message, 'error');
    }
  },

  async lexofficeTesten() {
    const btn = document.getElementById('lexofficeTestenBtn');
    if (!btn) return;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Teste\u2026';
    try {
      const res = await fetch('/api/v1/firma/lexoffice-import', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        App.toast('\u2713 Lexoffice verbunden \u2014 Firma: ' + (data.name || 'OK'), 'success');
      } else if (res.status === 400) {
        App.toast('\u2717 API-Key nicht konfiguriert', 'error');
      } else if (res.status === 401) {
        App.toast('\u2717 API-Key ung\u00fcltig', 'error');
      } else {
        const err = await res.json().catch(() => ({}));
        App.toast('\u2717 Fehler: ' + (err.detail || res.statusText), 'error');
      }
    } catch (err) {
      App.toast('\u2717 Verbindungsfehler: ' + err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = origText;
  },

  async lexofficeUebernehmen() {
    const btn = document.getElementById('lexofficeUebernehmenBtn');
    if (!btn) return;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Wird importiert\u2026';
    try {
      // Firmendaten importieren
      const firmaRes = await fetch('/api/v1/firma/lexoffice-import', { credentials: 'include' });
      if (!firmaRes.ok) throw new Error('Firmendaten-Import fehlgeschlagen');
      // Kunden synchronisieren
      const kundenRes = await DB.syncMitLexoffice();
      App.toast('Lexoffice-Daten übernommen (Firma + Kunden)', 'success');
    } catch (err) {
      console.error('Lexoffice-Import:', err);
      App.toast('Fehler: ' + err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = origText;
  },

  keyAendern(inputId, label, placeholder) {
    const editDiv = document.getElementById('edit' + inputId.replace('sett', ''));
    if (editDiv) editDiv.style.display = 'block';
  },

  keyAbbrechen(editDivId) {
    const editDiv = document.getElementById(editDivId);
    if (editDiv) {
      editDiv.style.display = 'none';
      const input = editDiv.querySelector('input');
      if (input) input.value = '';
    }
  },

  async gcalUrlSpeichern() {
    try {
      const url = (document.getElementById('settGcalUrl')?.value || '').trim();
      if (url && !url.includes('calendar.google.com') && !url.endsWith('.ics')) {
        App.toast('Bitte eine gültige Google iCal-URL eingeben', 'error');
        return;
      }
      await DB.settingSpeichern('gcal_ical_url', url);
      const status = document.getElementById('gcalSyncStatus');
      if (url) {
        App.toast('Google Kalender-URL gespeichert', 'success');
        if (status) status.innerHTML = '✓ URL gespeichert — Termine werden beim nächsten Sync importiert';
      } else {
        App.toast('Google Kalender-URL entfernt', 'info');
        if (status) status.innerHTML = '';
      }
    } catch (err) {
      App.toast('Fehler: ' + err.message, 'error');
    }
  },

  async keySpeichern(settingKey, inputId, statusId, editDivId) {
    try {
      const input = document.getElementById(inputId);
      const value = input ? input.value.trim() : '';
      await DB.settingSpeichern(settingKey, value);
      // Status aktualisieren
      const statusDiv = document.getElementById(statusId);
      if (statusDiv) {
        const configured = !!value;
        const statusSpan = statusDiv.querySelector('span');
        if (statusSpan) {
          if (configured) {
            statusSpan.style.color = 'var(--success)';
            statusSpan.innerHTML = '&#10003; konfiguriert';
          } else {
            statusSpan.style.color = 'var(--text-muted)';
            statusSpan.innerHTML = '&#10007; nicht gesetzt';
          }
        }
      }
      // Edit-Bereich ausblenden
      this.keyAbbrechen(editDivId);
      App.toast('Einstellung gespeichert', 'success');
    } catch (err) {
      console.error('Fehler:', err);
      App.toast('Fehler beim Speichern', 'error');
    }
  },

  async exportJSON() {
    try {
      const jsonStr = await DB.exportAlles();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `susi_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      App.toast('Export erfolgreich', 'success');
    } catch (err) {
      console.error('Export-Fehler:', err);
      App.toast('Fehler beim Export', 'error');
    }
  },

  async importJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!await App.confirm('ACHTUNG: Alle vorhandenen Daten werden überschrieben! Fortfahren?')) {
      event.target.value = '';
      return;
    }

    try {
      const text = await file.text();
      await DB.importAlles(text);
      App.toast('Import erfolgreich', 'success');
      this.anzeigen();
    } catch (err) {
      console.error('Import-Fehler:', err);
      App.toast('Fehler beim Import: ' + err.message, 'error');
    }
  }
};

// Init: Event kann bereits gefeuert sein bevor dieses Script geladen wird
if (window._entlastReady && window.FIRMA) {
  SettingsModule.init();
} else {
  document.addEventListener('entlast-ready', () => SettingsModule.init());
}
