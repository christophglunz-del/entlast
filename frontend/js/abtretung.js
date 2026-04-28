/**
 * Abtretungserklärung-Modul für Susi's Alltagshilfe
 */

const AbtretungModule = {
  signaturePad: null,

  async init() {
    await this.listeAnzeigen();
  },

  // Keywords zur Erkennung von Pflegekassen (gleiche Liste wie KundenModule)
  _kassenKeywords: ['aok','barmer','dak','techniker','knappschaft','bkk','novitas','energie','lbv','landesamt','krankenkasse','ersatzkasse','pflegekasse'],

  _istKasse(kunde) {
    const name = (kunde.name || '').toLowerCase();
    return this._kassenKeywords.some(kw => name.includes(kw));
  },

  async listeAnzeigen() {
    const container = document.getElementById('abtretungContent');
    if (!container) return;

    const abtretungen = await DB.alleAbtretungen();
    const alleKunden = await DB.alleKunden();

    // Pflegekassen und inaktive Kunden rausfiltern
    const kunden = alleKunden.filter(k => !this._istKasse(k) && k.kundentyp !== 'inaktiv');

    const kundenMap = {};
    kunden.forEach(k => kundenMap[k.id] = k);

    // Kunden ohne Abtretung markieren
    const kundenMitAbtretung = new Set(abtretungen.map(a => a.kundeId));

    // Kunden ohne Abtretung (gefiltert)
    const kundenOhne = kunden.filter(k => !kundenMitAbtretung.has(k.id));

    container.innerHTML = `
      <div class="section-title"><span class="icon">📝</span> Bestehende Abtretungserklärungen</div>

      ${abtretungen.length === 0
        ? '<div class="card text-center text-muted">Noch keine Abtretungserklärungen vorhanden</div>'
        : abtretungen.map(a => {
            const kunde = kundenMap[a.kundeId];
            return `
              <div class="list-item" onclick="AbtretungModule.detailAnzeigen(${a.id})">
                <div class="item-avatar" style="background: var(--success-bg); color: var(--success);">
                  ${kunde ? App.initialen(kunde.name, kunde.vorname) : '?'}
                </div>
                <div class="item-content">
                  <div class="item-title">${kunde ? KundenModule.escapeHtml(App.kundenName(kunde)) : 'Unbekannt'}</div>
                  <div class="item-subtitle">
                    ${App.formatDatum(a.datum)} | ${a.ort || 'Hattingen'}
                    ${a.unterschrift ? ' | ✓ Unterschrieben' : ''}
                  </div>
                </div>
                <div class="item-action">›</div>
              </div>
            `;
          }).join('')
      }

      <div class="section-title mt-3"><span class="icon">👥</span> Kunden ohne Abtretung</div>

      <input type="text" id="abtretungSuche" class="form-control" placeholder="Kunde suchen..."
             oninput="AbtretungModule.kundenFiltern()" style="margin-bottom:8px;">

      <div id="abtretungKundenListe">
      ${kundenOhne.length === 0
        ? '<div class="card text-center text-muted">Alle Kunden haben eine Abtretungserklärung</div>'
        : kundenOhne.map(k => `
            <div class="list-item abtretung-kunde-item" data-name="${KundenModule.escapeHtml(App.kundenName(k).toLowerCase())}" onclick="AbtretungModule.neueAbtretung(${k.id})">
              <div class="item-avatar" style="background: var(--warning-bg); color: var(--warning);">
                ${App.initialen(k.name, k.vorname)}
              </div>
              <div class="item-content">
                <div class="item-title">${KundenModule.escapeHtml(App.kundenName(k))}</div>
                <div class="item-subtitle">${k.pflegekasse ? KundenModule.escapeHtml(k.pflegekasse) : 'Keine Kasse hinterlegt'}</div>
              </div>
              <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); AbtretungModule.neueAbtretung(${k.id})">
                Erstellen
              </button>
            </div>
          `).join('')
      }
      </div>
    `;
  },

  kundenFiltern() {
    const suchfeld = document.getElementById('abtretungSuche');
    if (!suchfeld) return;
    const begriff = suchfeld.value.toLowerCase().trim();
    const items = document.querySelectorAll('.abtretung-kunde-item');
    items.forEach(item => {
      const name = item.getAttribute('data-name') || '';
      item.style.display = name.includes(begriff) ? '' : 'none';
    });
  },

  async neueAbtretung(kundeId) {
    const kunde = await DB.kundeById(kundeId);
    if (!kunde) {
      App.toast('Kunde nicht gefunden', 'error');
      return;
    }

    // Pflegekasse + Versichertennummer aus Lexoffice nachtragen falls leer
    if (kunde.lexofficeId && (!kunde.pflegekasse || !kunde.versichertennummer)) {
      try {
        if (typeof LexofficeAPI !== 'undefined') {
          if (!LexofficeAPI.istKonfiguriert()) await LexofficeAPI.init();
          if (LexofficeAPI.istKonfiguriert()) {
            const kontakt = await LexofficeAPI.getContact(kunde.lexofficeId);
            const billing = (kontakt.addresses && kontakt.addresses.billing && kontakt.addresses.billing[0]) || {};
            const supplement = billing.supplement || '';
            const updates = {};

            if (!kunde.pflegekasse && supplement) {
              // Kassenname aus Supplement extrahieren (vor "Vers" oder vor der Nummer)
              const kassenMatch = supplement.match(/^(.+?)(?:\s*,?\s*(?:Vers|[A-Z]\s*\d{6}))/i);
              if (kassenMatch) updates.pflegekasse = kassenMatch[1].trim();
            }

            if (!kunde.versichertennummer && supplement) {
              const versNrMatch = supplement.match(/[A-Z]\s*\d{6,}/);
              if (versNrMatch) updates.versichertennummer = versNrMatch[0].replace(/\s/g, '');
            }

            // Faxnummer der Kasse aus Kontakt-Telefonnummern
            if (!kunde.faxKasse && kontakt.phoneNumbers && kontakt.phoneNumbers.fax) {
              updates.faxKasse = kontakt.phoneNumbers.fax[0];
            }

            if (Object.keys(updates).length > 0) {
              await DB.kundeAktualisieren(kunde.id, updates);
              Object.assign(kunde, updates);
              console.log('Abtretung: Kundendaten aus Lexoffice nachgetragen:', updates);
            }
          }
        }
      } catch (e) {
        console.warn('Lexoffice-Abgleich fehlgeschlagen:', e);
      }
    }

    this.formAnzeigen(null, kunde);
  },

  async detailAnzeigen(id) {
    const abtretung = await DB.abtretungById(id);
    if (!abtretung) return;
    const kunde = await DB.kundeById(abtretung.kundeId);

    const container = document.getElementById('abtretungContent');
    container.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="margin:0;">Abtretungserklärung</h3>
          <button class="btn btn-sm btn-outline" onclick="AbtretungModule.listeAnzeigen()">← Zurück</button>
        </div>

        <table style="width:100%;font-size:0.9rem;border-collapse:collapse;">
          <tr><td style="padding:6px 8px;color:var(--gray-600);width:40%;">Kunde</td><td style="padding:6px 8px;font-weight:600;">${kunde ? KundenModule.escapeHtml(App.kundenName(kunde)) : 'Unbekannt'}</td></tr>
          <tr><td style="padding:6px 8px;color:var(--gray-600);">Versichertennummer</td><td style="padding:6px 8px;">${kunde && kunde.versichertennummer ? KundenModule.escapeHtml(kunde.versichertennummer) : '-'}</td></tr>
          <tr><td style="padding:6px 8px;color:var(--gray-600);">Pflegekasse</td><td style="padding:6px 8px;">${KundenModule.escapeHtml(abtretung.pflegekasse || (kunde && kunde.pflegekasse ? kunde.pflegekasse : '') || '-')}</td></tr>
          <tr><td style="padding:6px 8px;color:var(--gray-600);">Ort</td><td style="padding:6px 8px;">${KundenModule.escapeHtml(abtretung.ort || '-')}</td></tr>
          <tr><td style="padding:6px 8px;color:var(--gray-600);">Datum</td><td style="padding:6px 8px;">${abtretung.datum ? new Date(abtretung.datum).toLocaleDateString('de-DE') : '-'}</td></tr>
        </table>

        ${abtretung.unterschrift ? `
          <div style="margin-top:16px;padding:12px;background:var(--gray-50);border-radius:8px;">
            <div class="text-sm text-muted" style="margin-bottom:4px;">Unterschrift</div>
            <img src="${abtretung.unterschrift}" style="max-width:100%;height:auto;border:1px solid var(--gray-200);border-radius:4px;" alt="Unterschrift">
          </div>
        ` : '<div class="text-sm text-muted" style="margin-top:12px;">Keine Unterschrift vorhanden</div>'}

        <div class="btn-group mt-2">
          <button class="btn btn-outline" onclick="AbtretungModule.alsPdfHerunterladen(${id})">
            📄 Als PDF
          </button>
          <button class="btn btn-outline" onclick="AbtretungModule.neueAbtretung(${kunde ? kunde.id : 0})">
            + Neue Abtretung
          </button>
        </div>
      </div>
    `;
  },

  async alsPdfHerunterladen(id) {
    const abtretung = await DB.abtretungById(id);
    if (!abtretung) return;
    const kunde = await DB.kundeById(abtretung.kundeId);
    try {
      if (abtretung.pdfData) {
        // PDF aus gespeicherten Daten
        const blob = new Blob([Uint8Array.from(atob(abtretung.pdfData), c => c.charCodeAt(0))], {type: 'application/pdf'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Abtretung_${kunde ? kunde.name.replace(/\s+/g, '_') : 'Kunde'}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else if (typeof PDFHelper !== 'undefined' && PDFHelper.generateAbtretung) {
        const doc = await PDFHelper.generateAbtretung(abtretung, kunde);
        PDFHelper.download(doc, `Abtretung_${kunde ? kunde.name.replace(/\s+/g, '_') : 'Kunde'}.pdf`);
      } else {
        App.toast('PDF-Erstellung nicht verfügbar', 'error');
        return;
      }
      App.toast('PDF erstellt', 'success');
    } catch (e) {
      App.toast('PDF-Fehler: ' + e.message, 'error');
    }
  },

  formAnzeigen(abtretung = null, kunde = {}) {
    const container = document.getElementById('abtretungContent');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <h3 class="card-title mb-2">
          Neue Abtretungserklärung
        </h3>

        <div class="form-row">
          <div class="form-group">
            <label>Versicherte/r</label>
            <input type="text" class="form-control" value="${KundenModule.escapeHtml(App.kundenName(kunde))}" readonly>
          </div>
          <div class="form-group">
            <label>Versichertennummer</label>
            <input type="text" class="form-control" value="${KundenModule.escapeHtml(kunde.versichertennummer || '')}" readonly>
          </div>
        </div>

        <div class="form-group">
          <label>Pflegekasse (Empfänger)</label>
          <input type="text" class="form-control" value="${KundenModule.escapeHtml(kunde.pflegekasse || '')}" readonly>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="abtretungOrt">Ort</label>
            <input type="text" id="abtretungOrt" class="form-control"
                   value="Hattingen">
          </div>
          <div class="form-group">
            <label for="abtretungDatum">Datum</label>
            <input type="date" id="abtretungDatum" class="form-control"
                   value="${App.heute()}">
          </div>
        </div>
      </div>

      <!-- Dokumentenvorschau -->
      <div class="doc-preview">
        <div class="doc-header">
          <h2>Vollmacht & Abtretungserklärung</h2>
          <p>zur Vertretung gegenüber der Pflegekasse sowie zur Direktabrechnung/Direktzahlung<br>
          (§&nbsp;39 SGB XI Verhinderungspflege und §&nbsp;45b SGB XI Entlastungsbetrag)</p>
        </div>

        <p style="margin: 8px 0; padding: 10px; background: var(--gray-50); border-radius: 8px;">
          <strong>Empfänger (Pflegekasse):</strong><br>
          ${KundenModule.escapeHtml(kunde.pflegekasse || '____________')}
        </p>

        <p><strong>1) Pflegebedürftige/versicherte Person</strong></p>
        <p style="margin: 8px 0; padding: 10px; background: var(--gray-50); border-radius: 8px;">
          Name, Vorname: <strong>${KundenModule.escapeHtml(App.kundenName(kunde))}</strong><br>
          Anschrift: ${KundenModule.escapeHtml([kunde.strasse, kunde.plz, kunde.ort].filter(Boolean).join(', ') || '____________')}<br>
          Versichertennummer: ${KundenModule.escapeHtml(kunde.versichertennummer || '____________')}
        </p>

        <p><strong>2) Bevollmächtigte / Abtretungsempfängerin</strong></p>
        <p style="margin: 8px 0; padding: 10px; background: var(--gray-50); border-radius: 8px;">
          ${(FIRMA||{}).name || ''} – ${(FIRMA||{}).inhaber || ''}<br>
          ${(FIRMA||{}).strasse || ''}, ${(FIRMA||{}).plz || ''} ${(FIRMA||{}).ort || ''}<br>
          IK-Nummer: ${(FIRMA||{}).ikNummer || ''} · Angebots-ID: ${(FIRMA||{}).angebotsId || '080123F8M2'}
        </p>

        <hr style="border: none; border-top: 1px solid var(--gray-200); margin: 12px 0;">

        <p><strong>A) VOLLMACHT</strong></p>
        <p>Hiermit bevollmächtige ich, ${KundenModule.escapeHtml(App.kundenName(kunde))}, die unter Ziffer 2 genannte Person, mich gegenüber meiner Pflegekasse in Angelegenheiten der Pflegeversicherung nach dem SGB XI zu vertreten, insbesondere für:</p>
        <ul style="margin: 4px 0; padding-left: 20px; font-size: 0.9em;">
          <li>Verhinderungspflege nach §&nbsp;39 SGB XI</li>
          <li>Entlastungsbetrag nach §&nbsp;45b SGB XI</li>
          <li>Entgegennahme von Schreiben/Bescheiden</li>
        </ul>
        <p style="font-size: 0.9em;">Diese Vollmacht umfasst ausdrücklich auch die Zustimmung zur Direktabrechnung und Direktzahlung. Sie gilt bis auf Widerruf.</p>

        <hr style="border: none; border-top: 1px solid var(--gray-200); margin: 12px 0;">

        <p><strong>B) ABTRETUNGSERKLÄRUNG (Direktzahlung)</strong></p>
        <p>Ich trete meinen Anspruch auf Erstattung/Auszahlung gegenüber meiner Pflegekasse aus §&nbsp;39 SGB XI und §&nbsp;45b SGB XI widerruflich und in voller Höhe an die Abtretungsempfängerin ab. Ich bitte die Pflegekasse, die Beträge direkt auf deren Bankverbindung zu überweisen.</p>

        <hr style="border: none; border-top: 1px solid var(--gray-200); margin: 12px 0;">

        <p><strong>C) EINWILLIGUNG ZUR AUSKUNFT / DATENÜBERMITTLUNG</strong></p>
        <p style="font-size: 0.9em;">Ich willige ein, dass meine Pflegekasse zur Bearbeitung der Abrechnungen die hierfür erforderlichen Informationen an die unter Ziffer 2 genannte Person übermitteln darf.</p>
      </div>

      <!-- Unterschrift -->
      <div class="card">
        <h3 class="card-title mb-2">Unterschrift Pflegebedürftige/r</h3>
        <div class="signature-wrapper">
          <canvas id="abtretungSignatur"></canvas>
          <div class="sig-placeholder">Hier unterschreiben</div>
        </div>
        <div id="abtretungSigActions" class="signature-actions"></div>
      </div>

      <div class="btn-group mt-2">
        <button class="btn btn-primary btn-block" onclick="AbtretungModule.speichern(null, ${kunde.id})">
          Speichern
        </button>
        <button class="btn btn-outline" onclick="AbtretungModule.pdfErstellen(null, ${kunde.id})">
          📄 PDF erstellen
        </button>
        <button class="btn btn-secondary" onclick="AbtretungModule.listeAnzeigen()">
          Abbrechen
        </button>
      </div>
    `;

    // Signatur initialisieren
    setTimeout(() => {
      this.signaturePad = initSignaturePad('abtretungSignatur', 'abtretungSigActions');
    }, 100);
  },

  async speichern(id, kundeId) {
    const rawSig = this.signaturePad ? this.signaturePad.toDataURL() : null;

    try {
      const daten = {
        kundeId,
        datum: document.getElementById('abtretungDatum').value,
        ort: document.getElementById('abtretungOrt').value.trim(),
        unterschrift: rawSig ? await trimSignature(rawSig) : null
      };

      if (id) {
        await DB.abtretungAktualisieren(id, daten);
        App.toast('Abtretungserklärung aktualisiert', 'success');
      } else {
        await DB.abtretungHinzufuegen(daten);
        App.toast('Abtretungserklärung gespeichert', 'success');
      }
      this.listeAnzeigen();
    } catch (err) {
      console.error('Abtretung speichern Fehler:', err);
      App.toast('Fehler beim Speichern: ' + (err && err.message ? err.message : 'unbekannt'), 'error');
    }
  },

  async pdfErstellen(id, kundeId) {
    try {
      let abtretung;
      if (id) {
        abtretung = await DB.abtretungById(id);
      } else {
        const rawSig = this.signaturePad ? this.signaturePad.toDataURL() : null;
        abtretung = {
          datum: document.getElementById('abtretungDatum').value,
          ort: document.getElementById('abtretungOrt').value.trim(),
          unterschrift: rawSig ? await trimSignature(rawSig) : null
        };
      }

      const kunde = await DB.kundeById(kundeId);
      if (!kunde) {
        App.toast('Kunde nicht gefunden', 'error');
        return;
      }

      const doc = await PDFHelper.generateAbtretung(abtretung, kunde);
      const dateiname = `Abtretungserklaerung_${kunde.name.replace(/\s+/g, '_')}.pdf`;
      PDFHelper.download(doc, dateiname);
      App.toast('PDF erstellt', 'success');
    } catch (err) {
      console.error('PDF-Fehler:', err);
      App.toast('Fehler bei PDF-Erstellung', 'error');
    }
  },

  async loeschen(id) {
    if (!await App.confirm('Abtretungserklärung wirklich löschen?')) return;
    try {
      await DB.abtretungLoeschen(id);
      App.toast('Gelöscht', 'success');
      this.listeAnzeigen();
    } catch (err) {
      App.toast('Fehler', 'error');
    }
  }
};

if (window._entlastReady && window.FIRMA) { AbtretungModule.init(); }
else { document.addEventListener('entlast-ready', () => AbtretungModule.init()); }
