/**
 * App-Initialisierung fuer entlast.de
 * Wird am Anfang jeder Seite geladen (nach auth.js, vor app.js).
 * Prueft Authentifizierung, laedt Firmendaten, setzt Branding.
 */

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { user, firma, pflegekassen } = await Auth.init();

        // FIRMA-Defaults sicherstellen (verhindert null-Crashes)
        if (!window.FIRMA) window.FIRMA = {};
        const FIRMA_DEFAULTS = {
            name: '', inhaber: '', strasse: '', plz: '', ort: '',
            telefon: '', email: '', steuernummer: '', ikNummer: '',
            iban: '', bic: '', bank: '', stundensatz: 32.75, kmSatz: 0.30,
            startAdresse: '', kleinunternehmer: true
        };
        for (const [key, val] of Object.entries(FIRMA_DEFAULTS)) {
            if (window.FIRMA[key] === null || window.FIRMA[key] === undefined) {
                window.FIRMA[key] = val;
            }
        }

        // Begruessung anpassen (falls auf Dashboard)
        const grussEl = document.getElementById('grussFormel');
        if (grussEl && user) {
            const stunde = new Date().getHours();
            const vorname = (user.display_name || user.username || '').split(' ')[0];
            let gruss = `Hallo ${vorname}!`;
            if (stunde < 12) gruss = `Guten Morgen, ${vorname}!`;
            else if (stunde < 18) gruss = `Guten Nachmittag, ${vorname}!`;
            else gruss = `Guten Abend, ${vorname}!`;
            grussEl.textContent = gruss;
        }

        console.log(`entlast.de geladen: ${firma.name} (User: ${user.username})`);

        // Signal fuer Module dass Auth + FIRMA bereit sind
        window._entlastReady = true;
        document.dispatchEvent(new Event('entlast-ready'));
    } catch (e) {
        console.warn('Auth fehlgeschlagen, Weiterleitung zum Login:', e.message);
        // Endlos-Redirect verhindern: nur weiterleiten wenn nicht schon auf Login-Seite
        if (!window.location.pathname.includes('login')) {
            window.location.href = '/login.html';
        }
    }
});
