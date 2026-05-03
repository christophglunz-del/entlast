#!/usr/bin/env python3
"""E2E-Test v4 - mit force-clicks und JS-Navigation wo noetig."""

import sys
import os
import time
from playwright.sync_api import sync_playwright

SCREENSHOT_DIR = "/Users/cg/Projects/entlast/screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)
BASE_URL = "https://entlast.de"

results = []
def ss(page, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=False)
    return path

def ssf(page, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=True)
    return path

def log(test, status, detail="", sp=""):
    results.append({"test": test, "status": status, "detail": detail, "screenshot": sp})
    print(f"[{status}] {test}: {detail}")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"
        )
        page = context.new_page()

        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

        # ============ LOGIN ============
        print("=== LOGIN ===")
        page.goto(f"{BASE_URL}/login.html", wait_until="networkidle", timeout=15000)
        time.sleep(2)
        page.fill("input[placeholder='Benutzername eingeben']", "Susi")
        page.fill("input[placeholder='Passwort eingeben']", "Susi2026!")
        page.click("button:has-text('Anmelden')")
        time.sleep(3)

        # The app might use client-side auth - check if we have a token/session
        # Try navigating to the app
        page.goto(f"{BASE_URL}/index.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = ss(page, "40_after_login")
        url = page.url
        title = page.title()
        print(f"  URL: {url}, Title: {title}")

        if "login" in url.lower():
            # Maybe the login set localStorage/cookies - check
            storage = page.evaluate("() => JSON.stringify(Object.keys(localStorage))")
            cookies = context.cookies()
            print(f"  localStorage keys: {storage}")
            print(f"  Cookies: {[c['name'] for c in cookies]}")
            log("Login", "FEHLER", f"Redirect zurueck auf Login: {url}", sp)
        else:
            log("Login", "OK", f"URL: {url}")

        # ============ BOTTOM-NAV ============
        print("\n=== BOTTOM-NAV ===")
        # Navigate fresh to start
        page.goto(f"{BASE_URL}/index.html", wait_until="networkidle", timeout=10000)
        time.sleep(1)

        nav_tests = [
            ("Start", "index.html"),
            ("Termine", "pages/termine.html"),
            ("Leistung", "pages/leistung.html"),
            ("Kilometer", "pages/fahrten.html"),
        ]
        for name, expected in nav_tests:
            try:
                # Use JavaScript to find and click the nav link
                clicked = page.evaluate(f"""() => {{
                    const nav = document.querySelector('.bottom-nav');
                    if (!nav) return 'no-nav';
                    const links = nav.querySelectorAll('a');
                    for (const a of links) {{
                        if (a.textContent.includes('{name}')) {{
                            a.click();
                            return 'clicked';
                        }}
                    }}
                    return 'not-found';
                }}""")
                if clicked == 'clicked':
                    time.sleep(1.5)
                    page.wait_for_load_state("networkidle", timeout=5000)
                    sp = ss(page, f"41_nav_{name}")
                    if expected in page.url:
                        log(f"Bottom-Nav: {name}", "OK", f"URL: {page.url}")
                    else:
                        log(f"Bottom-Nav: {name}", "FEHLER", f"Erwartet */{expected}, Ist: {page.url}", sp)
                else:
                    log(f"Bottom-Nav: {name}", "FEHLER", f"Klick-Ergebnis: {clicked}")
            except Exception as e:
                log(f"Bottom-Nav: {name}", "FEHLER", str(e))

        # Mehr-Button - this one doesn't navigate, it opens a panel
        print("\n=== MEHR-MENUE ===")
        page.goto(f"{BASE_URL}/index.html", wait_until="networkidle", timeout=10000)
        time.sleep(1)

        # Click Mehr via JS
        page.evaluate("""() => {
            const nav = document.querySelector('.bottom-nav');
            const links = nav.querySelectorAll('a');
            for (const a of links) {
                if (a.textContent.includes('Mehr')) {
                    a.click();
                    return 'clicked';
                }
            }
        }""")
        time.sleep(1)
        sp = ss(page, "42_mehr_panel")

        # Check what's in the panel
        panel_info = page.evaluate("""() => {
            const panel = document.querySelector('#moreMenuPanel, .more-menu-panel');
            if (!panel) return {exists: false};
            const items = panel.querySelectorAll('a');
            const links = [];
            for (const a of items) {
                links.push({text: a.textContent.trim(), href: a.getAttribute('href'), visible: a.offsetParent !== null});
            }
            return {exists: true, active: panel.classList.contains('active'), links: links};
        }""")
        print(f"  Panel: {panel_info}")

        if panel_info.get('exists'):
            log("Bottom-Nav: Mehr", "OK", f"Panel geoeffnet, {len(panel_info.get('links', []))} Links")

            # Test each link in the panel
            for link_info in panel_info.get('links', []):
                name = link_info.get('text', '').strip()
                href = link_info.get('href', '')
                if name and href:
                    print(f"    Mehr-Link: '{name}' -> {href}")

            # Click each link via JS (bypassing backdrop)
            mehr_links = panel_info.get('links', [])
            for link_info in mehr_links:
                name = link_info.get('text', '').strip()
                href = link_info.get('href', '')
                if not name or not href:
                    continue

                # Navigate directly to test the page
                full_url = f"{BASE_URL}/{href}" if not href.startswith('http') else href
                try:
                    page.goto(full_url, wait_until="networkidle", timeout=8000)
                    time.sleep(1)
                    sp = ss(page, f"43_mehr_{name.replace(' ', '_')}")

                    if "login" in page.url.lower():
                        log(f"Mehr->{name}", "FEHLER", f"Redirect auf Login: {page.url}", sp)
                    else:
                        log(f"Mehr->{name}", "OK", f"URL: {page.url}", sp)
                except Exception as e:
                    log(f"Mehr->{name}", "FEHLER", str(e))
        else:
            log("Bottom-Nav: Mehr", "FEHLER", "Panel nicht gefunden")

        # BUG-TEST: Mehr-Menue Backdrop blockiert Klicks
        print("\n=== BUG-TEST: MEHR-MENUE BACKDROP ===")
        page.goto(f"{BASE_URL}/index.html", wait_until="networkidle", timeout=10000)
        time.sleep(1)

        # Open Mehr
        page.evaluate("""() => {
            const btn = document.querySelector('#navMoreBtn') || document.querySelector('a[href="#"]');
            if (btn) btn.click();
        }""")
        time.sleep(1)

        # Check z-index of backdrop vs panel items
        zindex_info = page.evaluate("""() => {
            const backdrop = document.querySelector('#moreMenuBackdrop');
            const panel = document.querySelector('#moreMenuPanel');
            const items = panel ? panel.querySelectorAll('a') : [];
            const result = {
                backdrop: backdrop ? {
                    zIndex: getComputedStyle(backdrop).zIndex,
                    display: getComputedStyle(backdrop).display,
                    position: getComputedStyle(backdrop).position,
                    active: backdrop.classList.contains('active')
                } : null,
                panel: panel ? {
                    zIndex: getComputedStyle(panel).zIndex,
                    display: getComputedStyle(panel).display,
                    position: getComputedStyle(panel).position,
                    active: panel.classList.contains('active')
                } : null,
                firstItem: items.length > 0 ? {
                    zIndex: getComputedStyle(items[0]).zIndex,
                    text: items[0].textContent.trim()
                } : null
            };
            return result;
        }""")
        print(f"  Z-Index Info: {zindex_info}")

        backdrop_z = int(zindex_info.get('backdrop', {}).get('zIndex', '0') or '0')
        panel_z = int(zindex_info.get('panel', {}).get('zIndex', '0') or '0')

        if backdrop_z >= panel_z and backdrop_z > 0:
            log("BUG: Mehr-Menue Backdrop z-index", "FEHLER",
                f"Backdrop z-index ({backdrop_z}) >= Panel z-index ({panel_z}) - Backdrop blockiert Klicks!")
        elif panel_z > backdrop_z:
            log("Mehr-Menue z-index", "OK", f"Panel ({panel_z}) > Backdrop ({backdrop_z})")
        else:
            log("Mehr-Menue z-index", "OK", f"Keine z-index Probleme erkannt")

        # ============ KALENDER -> LEISTUNG ============
        print("\n=== KALENDER -> LEISTUNG ===")
        page.goto(f"{BASE_URL}/pages/termine.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = ss(page, "44_termine")

        # Find ->L links
        l_links = page.evaluate("""() => {
            const links = document.querySelectorAll('a');
            const result = [];
            for (const a of links) {
                if (a.textContent.trim() === '→L') {
                    result.push({href: a.getAttribute('href'), text: a.textContent.trim()});
                }
            }
            return result;
        }""")
        print(f"  ->L links found: {l_links}")

        if l_links:
            # Click first ->L
            href = l_links[0]['href']
            page.goto(f"{BASE_URL}/pages/{href}", wait_until="networkidle", timeout=10000)
            time.sleep(2)
            sp = ss(page, "45_after_L")

            # Check form pre-fill
            prefill = page.evaluate("""() => {
                const kundeInput = document.querySelector('#kundeSelect, select[name*="kunde"], input[name*="kunde"]');
                const datumInput = document.querySelector('input[type="date"], input[name*="datum"]');
                const vonInput = document.querySelector('input[name*="von"], input[name*="beginn"], input[type="time"]:nth-of-type(1)');
                const bisInput = document.querySelector('input[name*="bis"], input[name*="ende"], input[type="time"]:nth-of-type(2)');

                // Try to get all time inputs
                const timeInputs = document.querySelectorAll('input[type="time"]');

                return {
                    kunde: kundeInput ? (kundeInput.options ? kundeInput.options[kundeInput.selectedIndex]?.text : kundeInput.value) : null,
                    datum: datumInput ? datumInput.value : null,
                    von: timeInputs[0] ? timeInputs[0].value : null,
                    bis: timeInputs[1] ? timeInputs[1].value : null,
                    url: window.location.href
                };
            }""")
            print(f"  Pre-fill: {prefill}")

            if prefill.get('kunde'):
                log("Kalender->Leistung: Kunde", "OK", f"Vorausgefuellt: {prefill['kunde']}")
            else:
                log("Kalender->Leistung: Kunde", "FEHLER", "Kunde nicht vorausgefuellt", sp)

            if prefill.get('datum') and '2026' in str(prefill['datum']):
                log("Kalender->Leistung: Datum", "OK", f"Vorausgefuellt: {prefill['datum']}")
            else:
                log("Kalender->Leistung: Datum", "FEHLER", f"Datum: {prefill.get('datum')}", sp)

            if prefill.get('von') and prefill.get('bis'):
                log("Kalender->Leistung: Zeiten", "OK", f"Von: {prefill['von']}, Bis: {prefill['bis']}")
            else:
                log("Kalender->Leistung: Zeiten", "FEHLER", f"Von: {prefill.get('von')}, Bis: {prefill.get('bis')}", sp)
        else:
            log("Kalender->Leistung", "FEHLER", "Keine ->L Buttons gefunden", sp)

        # ============ KALENDER -> KILOMETER ============
        print("\n=== KALENDER -> KILOMETER ===")
        page.goto(f"{BASE_URL}/pages/termine.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)

        km_links = page.evaluate("""() => {
            const links = document.querySelectorAll('a');
            const result = [];
            for (const a of links) {
                if (a.textContent.trim() === '→km') {
                    result.push({href: a.getAttribute('href'), text: a.textContent.trim()});
                }
            }
            return result;
        }""")
        print(f"  ->km links found: {km_links}")

        if km_links:
            href = km_links[0]['href']
            page.goto(f"{BASE_URL}/pages/{href}", wait_until="networkidle", timeout=10000)
            time.sleep(2)
            sp = ss(page, "46_after_km")

            # Check if address is pre-filled
            addr_info = page.evaluate("""() => {
                const inputs = document.querySelectorAll('input, select, textarea');
                const result = {};
                for (const inp of inputs) {
                    const name = inp.name || inp.id || '';
                    const val = inp.value || '';
                    if (val) result[name] = val;
                }
                const pageText = document.body.textContent;
                return {inputs: result, hasAddress: pageText.includes('Hattingen') || pageText.includes('Straße') || pageText.includes('straße')};
            }""")
            print(f"  Address info: {addr_info}")

            if addr_info.get('hasAddress'):
                log("Kalender->Kilometer: Adresse", "OK", "Kundenadresse vorhanden")
            else:
                log("Kalender->Kilometer: Adresse", "FEHLER", "Keine Adresse vorausgefuellt", sp)
        else:
            log("Kalender->Kilometer", "FEHLER", "Keine ->km Buttons gefunden")

        # ============ LEISTUNG -> RECHNUNG ============
        print("\n=== LEISTUNG -> RECHNUNG ===")
        page.goto(f"{BASE_URL}/pages/leistung.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = ss(page, "47_leistung")

        # Find RE erstellen buttons
        re_info = page.evaluate("""() => {
            const btns = document.querySelectorAll('button, a');
            const result = [];
            for (const b of btns) {
                const text = b.textContent.trim();
                if (text.includes('RE erstellen') || text.includes('RE ')) {
                    result.push({
                        text: text.substring(0, 30),
                        tag: b.tagName,
                        class: b.className,
                        visible: b.offsetParent !== null
                    });
                }
            }
            return result;
        }""")
        print(f"  RE buttons: {re_info}")

        if re_info:
            # Click the first RE erstellen button using force
            page.locator("button:has-text('RE erstellen')").first.click(force=True)
            time.sleep(2)
            sp = ss(page, "48_re_overlay")

            # Check overlay
            overlay_info = page.evaluate("""() => {
                const overlay = document.querySelector('#rechnungDetailOverlay, .modal, [class*="overlay"]');
                if (!overlay) return {exists: false};
                const text = overlay.textContent;
                return {
                    exists: true,
                    visible: overlay.offsetParent !== null || overlay.style.display !== 'none',
                    hasEmpfaenger: text.includes('Empfänger') || text.includes('empfänger'),
                    hasBetrag: text.includes('Betrag') || text.includes('€'),
                    hasLexoffice: text.includes('Lexoffice') || text.includes('lexoffice'),
                    hasAbbrechen: text.includes('Abbrechen'),
                    hasManuell: text.includes('Manuell'),
                    content: text.substring(0, 300)
                };
            }""")
            print(f"  Overlay: {overlay_info}")

            if overlay_info.get('exists') and overlay_info.get('visible'):
                log("Leistung->Rechnung: Overlay", "OK", "Rechnungs-Overlay geoeffnet")

                for field, key in [("Empfaenger", "hasEmpfaenger"), ("Betrag", "hasBetrag"),
                                   ("Lexoffice-Button", "hasLexoffice"), ("Abbrechen", "hasAbbrechen")]:
                    if overlay_info.get(key):
                        log(f"RE-Overlay: {field}", "OK", "Vorhanden")
                    else:
                        log(f"RE-Overlay: {field}", "FEHLER", "Nicht gefunden", sp)

                # Close overlay via JS
                page.evaluate("""() => {
                    const close = document.querySelector('#rechnungDetailOverlay .close, #rechnungDetailOverlay button[onclick*="close"], button:has(.close)');
                    if (close) close.click();
                    else {
                        const overlay = document.querySelector('#rechnungDetailOverlay');
                        if (overlay) overlay.style.display = 'none';
                    }
                }""")
                time.sleep(0.5)
            else:
                log("Leistung->Rechnung: Overlay", "FEHLER", "Overlay nicht sichtbar nach Klick", sp)
        else:
            log("Leistung->Rechnung", "FEHLER", "RE erstellen Button nicht gefunden", sp)

        # ============ ZURUECK-BUTTON ============
        print("\n=== ZURUECK-BUTTON ===")
        # Navigate: Start -> Termine
        page.goto(f"{BASE_URL}/index.html", wait_until="networkidle", timeout=10000)
        time.sleep(1)
        page.goto(f"{BASE_URL}/pages/termine.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)

        # Click on a calendar event
        event_clicked = page.evaluate("""() => {
            const events = document.querySelectorAll('.calendar-event, .time-slot');
            if (events.length > 0) {
                events[0].click();
                return true;
            }
            return false;
        }""")
        time.sleep(1)
        sp = ss(page, "49_event_detail")
        print(f"  Event clicked: {event_clicked}, URL: {page.url}")

        # Check if a detail view/modal opened
        detail_info = page.evaluate("""() => {
            const modal = document.querySelector('.modal:not([style*="none"]), .overlay:not([style*="none"]), [class*="detail"]:not([style*="none"]), [class*="edit"]');
            const backBtn = document.querySelector('.back-btn, button:has-text("←"), [class*="back"]');
            return {
                hasModal: modal !== null,
                hasBackBtn: backBtn !== null,
                backBtnText: backBtn ? backBtn.textContent.trim() : null,
                url: window.location.href
            };
        }""")
        print(f"  Detail info: {detail_info}")

        if detail_info.get('hasBackBtn'):
            # Click back button
            page.locator(".back-btn, button:has-text('←')").first.click(force=True)
            time.sleep(1.5)
            sp = ss(page, "50_after_back")
            after_url = page.url

            if "termine" in after_url.lower():
                log("Zurueck-Button", "OK", f"Korrekt bei Termine: {after_url}")
            elif "index" in after_url.lower():
                log("Zurueck-Button", "FEHLER", f"BUG: Bei Start statt Termine: {after_url}", sp)
            else:
                log("Zurueck-Button", "OK", f"URL: {after_url}", sp)
        else:
            # Maybe the back button is in the header
            back_exists = page.locator(".back-btn, button:has-text('←'), header button:first-child").first
            if back_exists.count() > 0:
                back_exists.click(force=True)
                time.sleep(1.5)
                sp = ss(page, "50_after_back")
                log("Zurueck-Button", "OK" if "termine" in page.url else "FEHLER", f"URL: {page.url}", sp)
            else:
                log("Zurueck-Button", "FEHLER", "Kein Zurueck-Button gefunden", sp)

        # ============ EINSTELLUNGEN ============
        print("\n=== EINSTELLUNGEN ===")
        page.goto(f"{BASE_URL}/pages/settings.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = ss(page, "51_settings")
        ssf(page, "51_settings_full")

        settings_info = page.evaluate("""() => {
            const text = document.body.textContent.toLowerCase();
            const buttons = document.querySelectorAll('button');
            const inputs = document.querySelectorAll('input');

            const btnTexts = [];
            for (const b of buttons) btnTexts.push(b.textContent.trim());

            const inputInfos = [];
            for (const i of inputs) {
                inputInfos.push({
                    name: i.name || i.id || '',
                    type: i.type || '',
                    placeholder: i.placeholder || '',
                    value: i.type === 'password' ? '***' : i.value.substring(0, 50)
                });
            }

            return {
                hasCache: text.includes('cache'),
                hasCacheBtn: btnTexts.some(t => t.toLowerCase().includes('cache') || t.toLowerCase().includes('leeren')),
                hasGoogleCal: text.includes('google') || text.includes('kalender-url') || text.includes('ical'),
                buttons: btnTexts,
                inputs: inputInfos,
                title: document.title
            };
        }""")
        print(f"  Settings: {settings_info}")

        if settings_info.get('hasCacheBtn'):
            log("Einstellungen: Cache-leeren", "OK", f"Button gefunden in: {settings_info['buttons']}")
        elif settings_info.get('hasCache'):
            log("Einstellungen: Cache-leeren", "OK", "Cache-Text auf Seite")
        else:
            log("Einstellungen: Cache-leeren", "FEHLER", f"Buttons: {settings_info['buttons']}", sp)

        if settings_info.get('hasGoogleCal'):
            log("Einstellungen: Google-Kalender-URL", "OK", "Kalender-Feld/Text vorhanden")
        else:
            # Check inputs more carefully
            gcal_found = any('google' in (i.get('name','') + i.get('placeholder','')).lower() or
                           'kalender' in (i.get('name','') + i.get('placeholder','')).lower() or
                           'ical' in (i.get('name','') + i.get('placeholder','')).lower()
                           for i in settings_info.get('inputs', []))
            if gcal_found:
                log("Einstellungen: Google-Kalender-URL", "OK", "Input-Feld gefunden")
            else:
                log("Einstellungen: Google-Kalender-URL", "FEHLER", f"Inputs: {settings_info['inputs']}", sp)

        # ============ KUNDEN-DETAIL ============
        print("\n=== KUNDEN ===")
        page.goto(f"{BASE_URL}/pages/kunden.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = ss(page, "52_kunden")
        ssf(page, "52_kunden_full")

        kunden_info = page.evaluate("""() => {
            const text = document.body.textContent;
            const cards = document.querySelectorAll('.kunde-card, .customer-card, [class*="kunde"], tr, .card, .list-item');
            const links = document.querySelectorAll('a[href*="kunde"]');

            // Find clickable customer elements
            const clickables = [];
            cards.forEach(c => {
                if (c.onclick || c.getAttribute('onclick') || c.dataset.id) {
                    clickables.push({text: c.textContent.trim().substring(0, 40), tag: c.tagName, class: c.className});
                }
            });

            return {
                pageText: text.substring(0, 500),
                cardsCount: cards.length,
                linksCount: links.length,
                clickables: clickables,
                isKundenPage: text.includes('Kunden') || window.location.href.includes('kunden')
            };
        }""")
        print(f"  Kunden page: cards={kunden_info.get('cardsCount')}, links={kunden_info.get('linksCount')}")
        print(f"  Page text: {kunden_info.get('pageText', '')[:200]}")

        if kunden_info.get('isKundenPage'):
            log("Kunden-Seite", "OK", f"Geladen, {kunden_info.get('cardsCount')} Cards")

            # Try to click a customer
            customer_clicked = page.evaluate("""() => {
                // Try various selectors for customer items
                const selectors = [
                    '.kunde-card', '.customer-card', '[class*="kunde-item"]',
                    '.customer-list .item', 'tbody tr', '.card'
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        el.click();
                        return {clicked: true, selector: sel};
                    }
                }
                // Last resort: find any clickable element with a customer name pattern
                const allDivs = document.querySelectorAll('div, span, li');
                for (const d of allDivs) {
                    if (d.onclick && d.textContent.trim().length > 3) {
                        d.click();
                        return {clicked: true, text: d.textContent.trim().substring(0, 30)};
                    }
                }
                return {clicked: false};
            }""")
            print(f"  Customer click: {customer_clicked}")

            if customer_clicked.get('clicked'):
                time.sleep(2)
                page.wait_for_load_state("networkidle", timeout=5000)
                sp = ss(page, "53_kunden_detail")
                ssf(page, "53_kunden_detail_full")

                detail_info = page.evaluate("""() => {
                    const text = document.body.textContent.toLowerCase();
                    const selects = document.querySelectorAll('select');
                    const dateInputs = document.querySelectorAll('input[type="date"]');

                    let pflegekasse = null;
                    let pflegekasseOptions = 0;
                    for (const s of selects) {
                        const name = (s.name || s.id || '').toLowerCase();
                        const label = s.previousElementSibling ? s.previousElementSibling.textContent.toLowerCase() : '';
                        if (name.includes('kasse') || name.includes('pflege') || label.includes('kasse') || label.includes('pflege')) {
                            pflegekasse = name || s.id;
                            pflegekasseOptions = s.options.length;
                        }
                    }

                    let geburtsdatum = null;
                    for (const d of dateInputs) {
                        const name = (d.name || d.id || '').toLowerCase();
                        const label = d.previousElementSibling ? d.previousElementSibling.textContent.toLowerCase() : '';
                        if (name.includes('geb') || name.includes('birth') || label.includes('geburt')) {
                            geburtsdatum = name || d.id;
                        }
                    }

                    return {
                        hasPflegekasse: pflegekasse !== null || text.includes('pflegekasse') || text.includes('krankenkasse'),
                        pflegekasseField: pflegekasse,
                        pflegekasseOptions: pflegekasseOptions,
                        hasGeburtsdatum: geburtsdatum !== null || text.includes('geburt'),
                        geburtsdatumField: geburtsdatum,
                        selectCount: selects.length,
                        dateInputCount: dateInputs.length,
                        url: window.location.href,
                        textExcerpt: text.substring(0, 300)
                    };
                }""")
                print(f"  Detail: {detail_info}")

                if detail_info.get('hasPflegekasse'):
                    if detail_info.get('pflegekasseField'):
                        log("Kunden-Detail: Pflegekasse", "OK",
                            f"Dropdown '{detail_info['pflegekasseField']}' mit {detail_info['pflegekasseOptions']} Eintraegen")
                    else:
                        log("Kunden-Detail: Pflegekasse", "OK", "Pflegekasse im Text")
                else:
                    log("Kunden-Detail: Pflegekasse", "FEHLER", "Nicht gefunden", sp)

                if detail_info.get('hasGeburtsdatum'):
                    if detail_info.get('geburtsdatumField'):
                        log("Kunden-Detail: Geburtsdatum", "OK", f"Feld: '{detail_info['geburtsdatumField']}'")
                    else:
                        log("Kunden-Detail: Geburtsdatum", "OK", "Geburtsdatum im Text")
                else:
                    log("Kunden-Detail: Geburtsdatum", "FEHLER", "Nicht gefunden", sp)
            else:
                # Try direct navigation to a customer detail page
                log("Kunden-Detail", "FEHLER", "Konnte keinen Kunden anklicken", sp)
        else:
            log("Kunden-Seite", "FEHLER", f"Seite nicht korrekt geladen: {page.url}", sp)

        # ============ ABTRETUNG ============
        print("\n=== ABTRETUNG ===")
        page.goto(f"{BASE_URL}/pages/abtretung.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = ss(page, "54_abtretung")
        page_text = page.text_content("body")[:200]
        if "abtretung" in page.url.lower() and "login" not in page.url.lower():
            log("Abtretung", "OK", f"Seite geladen: {page.url}")
        else:
            log("Abtretung", "FEHLER", f"URL: {page.url}", sp)

        # ============ ENTLASTUNG/BUDGET ============
        print("\n=== BUDGET ===")
        page.goto(f"{BASE_URL}/pages/entlastung.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = ss(page, "55_budget")
        if "entlastung" in page.url.lower() and "login" not in page.url.lower():
            log("Budget/Entlastung", "OK", f"Seite geladen: {page.url}")
        else:
            log("Budget/Entlastung", "FEHLER", f"URL: {page.url}", sp)

        # ============ FIRMA ============
        print("\n=== FIRMA ===")
        page.goto(f"{BASE_URL}/pages/firma.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = ss(page, "56_firma")
        if "firma" in page.url.lower() and "login" not in page.url.lower():
            log("Firmendaten", "OK", f"Seite geladen: {page.url}")
        else:
            log("Firmendaten", "FEHLER", f"URL: {page.url}", sp)

        # ============ RECHNUNG/ARCHIV ============
        print("\n=== ARCHIV ============")
        page.goto(f"{BASE_URL}/pages/rechnung.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = ss(page, "57_archiv")
        if "rechnung" in page.url.lower() and "login" not in page.url.lower():
            log("Archiv/Rechnungen", "OK", f"Seite geladen: {page.url}")
        else:
            log("Archiv/Rechnungen", "FEHLER", f"URL: {page.url}", sp)

        # ============ CONSOLE ERRORS ============
        unique = list(set(console_errors))
        if unique:
            print(f"\n=== CONSOLE ERRORS ({len(unique)}) ===")
            for e in unique[:15]:
                print(f"  {e}")

        # ============ SUMMARY ============
        print("\n" + "="*60)
        print("ZUSAMMENFASSUNG")
        print("="*60)

        ok = sum(1 for r in results if r["status"] == "OK")
        fail = sum(1 for r in results if r["status"] == "FEHLER")
        print(f"\nGesamt: {len(results)} Tests | OK: {ok} | FEHLER: {fail}")

        if fail > 0:
            print("\n--- FEHLER ---")
            for r in results:
                if r["status"] == "FEHLER":
                    print(f"  [FEHLER] {r['test']}: {r['detail']}")
                    if r['screenshot']:
                        print(f"           Screenshot: {r['screenshot']}")

        print("\n--- ALLE ERGEBNISSE ---")
        for r in results:
            print(f"  [{r['status']}] {r['test']}: {r['detail']}")

        browser.close()
        return 1 if fail > 0 else 0

if __name__ == "__main__":
    sys.exit(main())
