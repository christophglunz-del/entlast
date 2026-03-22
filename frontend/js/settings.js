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

    // Statistiken
    const stats = await DB.statistiken();

    container.innerHTML = `
      <!-- Firmendaten -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Firmendaten</span>
          <span class="card-icon pink">🏠</span>
        </div>
        <div class="text-sm">
          <p><strong>${F.name || 'Nicht konfiguriert'}</strong></p>
          <p>${F.inhaber || '-'}</p>
          <p>${F.strasse || '-'}, ${F.plz || ''} ${F.ort || ''}</p>
          <p>Tel: ${F.telefon || '-'}</p>
          <p>E-Mail: ${F.email || '-'}</p>
          <p>StNr: ${F.steuernummer || '-'}</p>
          <p>IK: ${F.ikNummer || '-'}</p>
          <p>IBAN: ${F.iban || '-'} (${F.bank || '-'})</p>
          <p>Stundensatz: ${App.formatBetrag(F.stundensatz || 0)}</p>
          <p>km-Satz: ${(F.kmSatz || 0).toFixed(2).replace('.', ',')} €/km</p>
          ${F.kleinunternehmer ? '<p class="text-muted mt-1">Kleinunternehmer gem. § 19 Abs. 1 UStG</p>' : ''}
        </div>
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

      <!-- Google Calendar -->
      <div id="gcalSettingsPlaceholder"></div>

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

      <!-- Gefahrenzone -->
      <div class="card" style="border: 2px solid var(--danger);">
        <div class="card-header">
          <span class="card-title" style="color: var(--danger);">Gefahrenzone</span>
        </div>
        <button class="btn btn-danger btn-block" onclick="SettingsModule.alleDatenLoeschen()">
          🗑️ Alle Daten löschen
        </button>
        <div class="form-hint mt-1">Diese Aktion kann nicht rückgängig gemacht werden!</div>
      </div>

      <!-- App-Info -->
      <div class="card text-center text-sm text-muted">
        <p><strong>Susi's Alltagshilfe</strong></p>
        <p>Version 1.1.2</p>
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
  },

  async alleDatenLoeschen() {
    if (!await App.confirm('ALLE Daten unwiderruflich löschen? Diese Aktion kann NICHT rückgängig gemacht werden!')) return;
    if (!await App.confirm('Wirklich ALLE Daten löschen? Letzte Chance!')) return;

    try {
      // Daten-Reset ueber den Server (Import mit leeren Daten)
      await DB.importAlles(JSON.stringify({
        kunden: [], leistungen: [], fahrten: [],
        termine: [], abtretungen: [], rechnungen: [], settings: []
      }));
      App.toast('Alle Daten gelöscht', 'info');
      this.anzeigen();
    } catch (err) {
      App.toast('Fehler beim Löschen', 'error');
    }
  }
};

// Init: Event kann bereits gefeuert sein bevor dieses Script geladen wird
if (window._entlastReady && window.FIRMA) {
  SettingsModule.init();
} else {
  document.addEventListener('entlast-ready', () => SettingsModule.init());
}
