/**
 * Wiederverwendbare Unterschrift-Komponente
 * Nutzt signature_pad Library
 */

class SignaturePadWrapper {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      console.error('Canvas nicht gefunden:', canvasId);
      return;
    }

    // Canvas-Größe korrekt setzen
    this.resizeCanvas();

    // SignaturePad initialisieren
    this.pad = new SignaturePad(this.canvas, {
      minWidth: 1,
      maxWidth: 3,
      penColor: '#1a1a1a',
      backgroundColor: 'rgba(255, 255, 255, 0)',
      ...options
    });

    // Platzhalter-Text verwalten
    this.placeholder = this.canvas.parentElement?.querySelector('.sig-placeholder');
    this.pad.addEventListener('beginStroke', () => {
      if (this.placeholder) this.placeholder.style.display = 'none';
    });

    // Resize-Handler
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * ratio;
    this.canvas.height = rect.height * ratio;
    const ctx = this.canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    // Daten nach Resize wiederherstellen, wenn vorhanden
    if (this.pad && !this.pad.isEmpty()) {
      const data = this.pad.toData();
      this.pad.clear();
      this.pad.fromData(data);
    }
  }

  // Unterschrift als Base64 PNG
  toDataURL() {
    if (this.pad.isEmpty()) return null;
    return this.pad.toDataURL('image/png');
  }

  // Unterschrift als Blob
  toBlob() {
    return new Promise((resolve) => {
      if (this.pad.isEmpty()) {
        resolve(null);
        return;
      }
      this.canvas.toBlob(resolve, 'image/png');
    });
  }

  // Unterschrift laden (Base64)
  fromDataURL(dataUrl) {
    if (!dataUrl) return;
    this.pad.fromDataURL(dataUrl);
    if (this.placeholder) this.placeholder.style.display = 'none';
  }

  // Unterschrift leeren
  clear() {
    this.pad.clear();
    if (this.placeholder) this.placeholder.style.display = '';
  }

  // Prüfen ob leer
  isEmpty() {
    return this.pad.isEmpty();
  }

  // Pad aktivieren/deaktivieren
  setReadOnly(readOnly) {
    if (readOnly) {
      this.pad.off();
    } else {
      this.pad.on();
    }
  }

  // Aufräumen
  destroy() {
    window.removeEventListener('resize', this.resizeCanvas);
    if (this.pad) {
      this.pad.off();
    }
  }
}

/**
 * Einfache Initialisierung für Seiten mit Unterschrift
 * Erstellt automatisch Clear- und Undo-Buttons
 */
function initSignaturePad(canvasId, actionsContainerId) {
  const sigPad = new SignaturePadWrapper(canvasId);

  const actionsContainer = document.getElementById(actionsContainerId);
  if (actionsContainer) {
    actionsContainer.innerHTML = `
      <button type="button" class="btn btn-sm btn-secondary" onclick="window._sigPad_${canvasId}.clear()">
        Löschen
      </button>
      <button type="button" class="btn btn-sm btn-secondary" onclick="window._sigPad_${canvasId}.pad.undo()">
        Rückgängig
      </button>
    `;
  }

  // Global verfügbar machen für Button-Handler
  window[`_sigPad_${canvasId}`] = sigPad;

  return sigPad;
}
