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
 * Unterschrift auf Bounding Box der tatsächlichen Striche zuschneiden.
 * Verhindert, dass ungenutzte Canvas-Bereiche (z.B. nach Orientierungswechsel
 * oder Safari-Adressbar-Resize) in der PDF als „halbe Unterschrift" erscheinen.
 * Padding in Pixeln drumherum, Rückgabe als PNG dataURL.
 */
async function trimSignature(dataUrl, padding = 10) {
  if (!dataUrl) return null;
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return dataUrl;

  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const sctx = src.getContext('2d');
  sctx.fillStyle = '#fff';
  sctx.fillRect(0, 0, w, h);
  sctx.drawImage(img, 0, 0);
  const pixels = sctx.getImageData(0, 0, w, h).data;

  let minX = w, minY = h, maxX = -1, maxY = -1;
  const threshold = 240;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (pixels[i] < threshold || pixels[i+1] < threshold || pixels[i+2] < threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return dataUrl;

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(w - 1, maxX + padding);
  maxY = Math.min(h - 1, maxY + padding);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;

  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  const octx = out.getContext('2d');
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, cw, ch);
  octx.drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);
  return out.toDataURL('image/png');
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
