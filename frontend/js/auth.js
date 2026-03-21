/**
 * Authentifizierungs-Modul fuer entlast.de
 * Login/Logout + Session-Pruefung + Firmendaten laden
 */

const Auth = {

    async login(username, password) {
        const res = await fetch('/auth/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail || 'Login fehlgeschlagen');
        }

        return res.json();
    },

    async logout() {
        try {
            await fetch('/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
        } catch (e) {
            // Fehler ignorieren, trotzdem weiterleiten
        }
        window.location.href = '/login.html';
    },

    async me() {
        const res = await fetch('/auth/me', {
            credentials: 'include'
        });

        if (!res.ok) {
            throw new Error('Nicht angemeldet');
        }

        return res.json();
    },

    /**
     * Beim App-Start aufrufen.
     * Prueft Session, laedt Firmendaten + Pflegekassen, setzt Branding.
     * Bei 401 -> wirft Error (Aufrufer leitet auf Login weiter).
     */
    async init() {
        const data = await this.me();

        const user = data.user;
        const firma = data.firma;

        // Pflegekassen laden
        let pflegekassen = [];
        try {
            const pkRes = await fetch('/api/v1/pflegekassen', {
                credentials: 'include'
            });
            if (pkRes.ok) {
                pflegekassen = await pkRes.json();
            }
        } catch (e) {
            console.warn('Pflegekassen konnten nicht geladen werden:', e);
        }

        // Globale Variablen setzen
        window.FIRMA = firma;
        window.PFLEGEKASSEN = pflegekassen;
        // Auch die Modul-Variablen (fuer db.js Kompatibilitaet)
        FIRMA = firma;
        PFLEGEKASSEN = pflegekassen;

        // CSS-Variablen fuer dynamisches Branding
        if (firma.farbe_primary) {
            document.documentElement.style.setProperty('--primary', firma.farbe_primary);
        }
        if (firma.farbe_primary_dark) {
            document.documentElement.style.setProperty('--primary-dark', firma.farbe_primary_dark);
        }
        // primary-light und primary-bg ableiten (vereinfacht)
        if (firma.farbe_primary) {
            document.documentElement.style.setProperty('--primary-light', firma.farbe_primary + '80');
            document.documentElement.style.setProperty('--primary-bg', firma.farbe_primary + '1A');
        }

        // Theme-Color Meta-Tag aktualisieren
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme && firma.farbe_primary) {
            metaTheme.setAttribute('content', firma.farbe_primary);
        }

        // Logo setzen
        const logoEl = document.querySelector('.app-logo');
        if (logoEl) {
            logoEl.setAttribute('src', '/api/v1/firma/logo');
        }
        // Auch das Header-Logo (img im Header)
        const headerImg = document.querySelector('.app-header img');
        if (headerImg) {
            headerImg.setAttribute('src', '/api/v1/firma/logo');
        }

        // Firmenname im Header
        const titleEl = document.querySelector('.app-header h1');
        if (titleEl) {
            titleEl.textContent = firma.name;
        }

        // Seiten-Titel
        document.title = firma.name;

        return { user, firma, pflegekassen };
    }
};
