#!/usr/bin/env python3
"""E2E-Test v5 - Nachtest Zurueck-Button, Einstellungen, Kunden-Detail."""

import sys, os, time
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

        # LOGIN
        page.goto(f"{BASE_URL}/login.html", wait_until="networkidle", timeout=15000)
        time.sleep(2)
        page.fill("input[placeholder='Benutzername eingeben']", "Susi")
        page.fill("input[placeholder='Passwort eingeben']", "Susi2026!")
        page.click("button:has-text('Anmelden')")
        time.sleep(3)
        page.goto(f"{BASE_URL}/index.html", wait_until="networkidle", timeout=10000)
        time.sleep(1)
        print(f"Login OK: {page.url}")

        # ============ TEST: ZURUECK-BUTTON ============
        print("\n=== ZURUECK-BUTTON ===")

        # Step 1: Go to Termine
        page.goto(f"{BASE_URL}/pages/termine.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        print(f"  At Termine: {page.url}")

        # Step 2: Click on a calendar event to open edit/detail
        event_result = page.evaluate("""() => {
            const events = document.querySelectorAll('.calendar-event, .time-slot');
            if (events.length > 0) {
                events[0].click();
                return {clicked: true, text: events[0].textContent.trim().substring(0,30)};
            }
            return {clicked: false};
        }""")
        time.sleep(2)
        sp = ss(page, "60_event_clicked")
        print(f"  Event: {event_result}, URL: {page.url}")

        # Check what happened - modal or new page?
        state = page.evaluate("""() => {
            // Check for modals/overlays
            const modals = document.querySelectorAll('.modal, .overlay, [class*="detail-overlay"], [class*="edit-overlay"]');
            let visibleModal = null;
            modals.forEach(m => {
                const style = getComputedStyle(m);
                if (style.display !== 'none' && style.visibility !== 'hidden' && m.offsetParent !== null) {
                    visibleModal = m.className;
                }
            });

            // Check for back button
            const backBtns = document.querySelectorAll('.back-btn, [class*="back"], button');
            let backBtnInfo = null;
            backBtns.forEach(b => {
                const text = b.textContent.trim();
                if (text === '←' || text === 'Zurück' || b.classList.contains('back-btn')) {
                    backBtnInfo = {text: text, class: b.className, tag: b.tagName};
                }
            });

            return {
                url: window.location.href,
                visibleModal: visibleModal,
                backBtn: backBtnInfo,
                title: document.querySelector('.header-title, h1, h2')?.textContent?.trim()
            };
        }""")
        print(f"  State: {state}")

        if state.get('visibleModal'):
            print(f"  Modal visible: {state['visibleModal']}")
            # Close modal and check we stay on Termine
            page.evaluate("""() => {
                const closeBtn = document.querySelector('.close-btn, .modal .close, button[class*="close"]');
                if (closeBtn) closeBtn.click();
                // Also try clicking backdrop
                const backdrop = document.querySelector('.backdrop, .modal-backdrop');
                if (backdrop) backdrop.click();
            }""")
            time.sleep(1)
            if "termine" in page.url.lower():
                log("Zurueck-Button (Modal close)", "OK", f"Bei Termine geblieben: {page.url}")
            else:
                log("Zurueck-Button (Modal close)", "FEHLER", f"URL: {page.url}")

        if state.get('backBtn'):
            back_text = state['backBtn']['text']
            print(f"  Back button: '{back_text}'")
            # Click back
            page.locator(".back-btn").first.click(force=True)
            time.sleep(1.5)
            sp = ss(page, "61_after_back")
            after_url = page.url
            print(f"  After back: {after_url}")

            if "termine" in after_url.lower():
                log("Zurueck-Button", "OK", f"Korrekt bei Termine: {after_url}")
            elif "index" in after_url.lower() or after_url.rstrip('/') == BASE_URL:
                log("Zurueck-Button", "FEHLER", f"BUG: Bei Start statt Termine: {after_url}", sp)
            else:
                log("Zurueck-Button", "OK", f"URL: {after_url}")
        else:
            # The back button might be at the top header
            back_btn = page.locator("button:has-text('←'), .back-btn").first
            if back_btn.count() > 0:
                back_btn.click(force=True)
                time.sleep(1.5)
                sp = ss(page, "61_after_back")
                print(f"  After back (fallback): {page.url}")
                if "termine" in page.url.lower():
                    log("Zurueck-Button", "OK", f"Korrekt bei Termine: {page.url}")
                else:
                    log("Zurueck-Button", "FEHLER", f"URL: {page.url}", sp)
            else:
                log("Zurueck-Button", "FEHLER", "Kein Zurueck-Button gefunden")

        # Separate test: Termine page back button goes to...
        print("\n  --- Termine-Seite Zurueck-Button ---")
        page.goto(f"{BASE_URL}/pages/termine.html", wait_until="networkidle", timeout=10000)
        time.sleep(1)
        back = page.locator(".back-btn, button:has-text('←')").first
        if back.count() > 0:
            # This is the header back button on the Termine page itself
            back_text = back.text_content().strip()
            print(f"  Termine header back button: '{back_text}'")
            back.click(force=True)
            time.sleep(1.5)
            sp = ss(page, "62_termine_back")
            print(f"  After Termine back: {page.url}")
            if "index" in page.url or page.url.rstrip('/') == BASE_URL:
                log("Termine: Zurueck -> Start", "OK", f"Korrekt bei Start: {page.url}")
            else:
                log("Termine: Zurueck -> Start", "FEHLER", f"URL: {page.url}", sp)

        # ============ EINSTELLUNGEN ============
        print("\n=== EINSTELLUNGEN ===")
        page.goto(f"{BASE_URL}/pages/settings.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = ss(page, "63_settings")
        ssf(page, "63_settings_full")

        # Dump complete page content and UI elements
        settings = page.evaluate("""() => {
            const text = document.body.textContent;
            const buttons = [];
            document.querySelectorAll('button').forEach(b => {
                buttons.push({text: b.textContent.trim(), class: b.className, visible: b.offsetParent !== null});
            });
            const inputs = [];
            document.querySelectorAll('input, textarea, select').forEach(i => {
                inputs.push({
                    tag: i.tagName,
                    name: i.name || '',
                    id: i.id || '',
                    type: i.type || '',
                    placeholder: i.placeholder || '',
                    value: i.type === 'password' ? '***' : (i.value || '').substring(0, 60),
                    label: i.previousElementSibling ? i.previousElementSibling.textContent.trim().substring(0,30) : '',
                    visible: i.offsetParent !== null
                });
            });
            const labels = [];
            document.querySelectorAll('label, h2, h3, h4, .section-title').forEach(l => {
                labels.push(l.textContent.trim().substring(0, 50));
            });
            return {
                url: window.location.href,
                buttons: buttons,
                inputs: inputs,
                labels: labels,
                pageText: text.substring(0, 1000)
            };
        }""")
        print(f"  URL: {settings['url']}")
        print(f"  Labels: {settings['labels']}")
        print(f"  Buttons: {settings['buttons']}")
        print(f"  Inputs: {settings['inputs']}")

        # Cache-leeren check
        cache_btns = [b for b in settings['buttons'] if 'cache' in b['text'].lower() or 'leeren' in b['text'].lower() or 'lösch' in b['text'].lower() or 'daten' in b['text'].lower()]
        if cache_btns:
            log("Einstellungen: Cache-leeren", "OK", f"Buttons: {[b['text'] for b in cache_btns]}")
        elif 'cache' in settings.get('pageText', '').lower():
            log("Einstellungen: Cache-leeren", "OK", "Cache-Text auf Seite")
        else:
            log("Einstellungen: Cache-leeren", "FEHLER", f"Nicht gefunden. Buttons: {[b['text'] for b in settings['buttons']]}", sp)

        # Google Kalender URL check
        gcal_inputs = [i for i in settings['inputs'] if
                       any(kw in (i['name'] + i['id'] + i['placeholder'] + i.get('label','')).lower()
                           for kw in ['google', 'kalender', 'calendar', 'gcal', 'ical', 'url'])]
        if gcal_inputs:
            log("Einstellungen: Google-Kalender-URL", "OK", f"Input: {gcal_inputs[0]}")
        elif any(kw in settings.get('pageText', '').lower() for kw in ['google', 'kalender-url', 'ical', 'google calendar']):
            log("Einstellungen: Google-Kalender-URL", "OK", "Kalender-Text auf Seite")
        else:
            log("Einstellungen: Google-Kalender-URL", "FEHLER", "Nicht gefunden", sp)

        # ============ KUNDEN-DETAIL ============
        print("\n=== KUNDEN-DETAIL ===")
        page.goto(f"{BASE_URL}/pages/kunden.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = ss(page, "64_kunden_liste")
        ssf(page, "64_kunden_liste_full")

        # Check page structure
        kunden_page = page.evaluate("""() => {
            const url = window.location.href;
            const text = document.body.textContent;

            // Find all potential customer clickable items
            const items = [];
            document.querySelectorAll('.kunde-card, .customer, [class*="kunde"], .list-item, .card, li, tr').forEach(el => {
                const onClick = el.getAttribute('onclick') || '';
                const text = el.textContent.trim().substring(0, 40);
                if (text.length > 2 && (onClick || el.style.cursor === 'pointer' || el.tagName === 'A')) {
                    items.push({text: text, tag: el.tagName, class: el.className, onclick: onClick.substring(0, 50)});
                }
            });

            // Check for search input
            const searchInput = document.querySelector('input[type="search"], input[placeholder*="such"], input[placeholder*="Such"]');

            return {
                url: url,
                itemCount: items.length,
                items: items.slice(0, 5),
                hasSearch: searchInput !== null,
                bodyExcerpt: text.substring(0, 500)
            };
        }""")
        print(f"  Kunden page: {kunden_page['itemCount']} clickable items")
        print(f"  Items: {kunden_page['items']}")
        print(f"  Body: {kunden_page['bodyExcerpt'][:200]}")

        # Try clicking a customer
        click_result = page.evaluate("""() => {
            // Strategy: find .kunde-card or similar elements
            const selectors = ['.kunde-card', '[class*="kunde-item"]', '.list-group-item', '.card-body', 'li[onclick]', 'div[onclick]'];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) {
                    el.click();
                    return {clicked: true, selector: sel, text: el.textContent.trim().substring(0, 30)};
                }
            }

            // Try finding any element with onclick containing 'kunde' or 'detail' or 'edit'
            const allEls = document.querySelectorAll('[onclick]');
            for (const el of allEls) {
                const oc = el.getAttribute('onclick');
                if (oc && (oc.includes('kunde') || oc.includes('detail') || oc.includes('edit') || oc.includes('select'))) {
                    el.click();
                    return {clicked: true, onclick: oc.substring(0, 50), text: el.textContent.trim().substring(0, 30)};
                }
            }

            // Try clicking anything that looks like a customer name
            const divs = document.querySelectorAll('div, span, p');
            for (const d of divs) {
                if (d.children.length === 0 && d.textContent.trim().match(/^[A-Z][a-zäöü]+ [A-Z][a-zäöü]+$/)) {
                    d.click();
                    return {clicked: true, text: d.textContent.trim(), strategy: 'name-pattern'};
                }
            }

            return {clicked: false};
        }""")
        print(f"  Click result: {click_result}")

        if click_result.get('clicked'):
            time.sleep(2)
            page.wait_for_load_state("networkidle", timeout=5000)
            sp = ss(page, "65_kunden_detail")
            ssf(page, "65_kunden_detail_full")
            print(f"  Detail URL: {page.url}")

            detail = page.evaluate("""() => {
                const text = document.body.textContent.toLowerCase();
                const selects = [];
                document.querySelectorAll('select').forEach(s => {
                    const name = s.name || s.id || '';
                    const label = s.previousElementSibling ? s.previousElementSibling.textContent.trim() : '';
                    const options = [];
                    s.querySelectorAll('option').forEach(o => options.push(o.textContent.trim().substring(0, 30)));
                    selects.push({name: name, label: label, optionCount: s.options.length, firstOptions: options.slice(0, 5)});
                });

                const dateInputs = [];
                document.querySelectorAll('input[type="date"]').forEach(d => {
                    const name = d.name || d.id || '';
                    const label = d.labels && d.labels[0] ? d.labels[0].textContent.trim() : '';
                    const prevLabel = d.previousElementSibling ? d.previousElementSibling.textContent.trim() : '';
                    dateInputs.push({name: name, label: label || prevLabel, value: d.value});
                });

                const allLabels = [];
                document.querySelectorAll('label, .form-label, .label').forEach(l => {
                    allLabels.push(l.textContent.trim().substring(0, 30));
                });

                return {
                    url: window.location.href,
                    selects: selects,
                    dateInputs: dateInputs,
                    labels: allLabels,
                    hasPflegekasse: text.includes('pflegekasse') || text.includes('krankenkasse'),
                    hasGeburtsdatum: text.includes('geburtsdatum') || text.includes('geb.datum') || text.includes('geboren'),
                    bodyExcerpt: text.substring(0, 500)
                };
            }""")
            print(f"  Selects: {detail['selects']}")
            print(f"  Date inputs: {detail['dateInputs']}")
            print(f"  Labels: {detail['labels']}")
            print(f"  Body: {detail['bodyExcerpt'][:200]}")

            # Pflegekasse
            pflegekasse_found = False
            for sel in detail['selects']:
                if any(kw in (sel['name'] + sel.get('label', '')).lower() for kw in ['kasse', 'pflege']):
                    log("Kunden-Detail: Pflegekasse", "OK",
                        f"Dropdown '{sel['name']}' mit {sel['optionCount']} Eintraegen, z.B.: {sel['firstOptions'][:3]}")
                    pflegekasse_found = True
                    break
            if not pflegekasse_found and detail['hasPflegekasse']:
                log("Kunden-Detail: Pflegekasse", "OK", "Text 'Pflegekasse' auf Seite")
                pflegekasse_found = True
            if not pflegekasse_found:
                # Check all selects
                for sel in detail['selects']:
                    # Some might have Pflegekasse options
                    if any('aok' in o.lower() or 'barmer' in o.lower() or 'dak' in o.lower() or 'tkk' in o.lower() or 'knappschaft' in o.lower()
                           for o in sel.get('firstOptions', [])):
                        log("Kunden-Detail: Pflegekasse", "OK",
                            f"Dropdown '{sel['name']}' hat Kassen-Optionen: {sel['firstOptions'][:3]}")
                        pflegekasse_found = True
                        break
            if not pflegekasse_found:
                log("Kunden-Detail: Pflegekasse", "FEHLER", f"Nicht gefunden. Selects: {detail['selects']}", sp)

            # Geburtsdatum
            geb_found = False
            for di in detail['dateInputs']:
                if any(kw in (di['name'] + di.get('label', '')).lower() for kw in ['geb', 'birth', 'geboren']):
                    log("Kunden-Detail: Geburtsdatum", "OK", f"Date-Input '{di['name']}' label='{di['label']}' value='{di['value']}'")
                    geb_found = True
                    break
            if not geb_found and detail['hasGeburtsdatum']:
                log("Kunden-Detail: Geburtsdatum", "OK", "Text 'Geburtsdatum' auf Seite")
                geb_found = True
            if not geb_found:
                # Check labels
                for lbl in detail['labels']:
                    if 'geburt' in lbl.lower() or 'geb' in lbl.lower():
                        log("Kunden-Detail: Geburtsdatum", "OK", f"Label gefunden: '{lbl}'")
                        geb_found = True
                        break
            if not geb_found:
                log("Kunden-Detail: Geburtsdatum", "FEHLER", f"Nicht gefunden. Labels: {detail['labels']}", sp)
        else:
            # Last try: navigate directly to a customer page
            log("Kunden-Detail", "FEHLER", "Kein Kunde klickbar", sp)

        # ============ TEST: Leistung ->L Kunde-Feld pruefen ============
        print("\n=== LEISTUNG KUNDE-FELD PRUEFEN ===")
        page.goto(f"{BASE_URL}/pages/leistung.html?kundeId=22&datum=2026-04-16&von=08:45&bis=10:15",
                  wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = ss(page, "66_leistung_prefilled")

        kunde_info = page.evaluate("""() => {
            // Check all form elements for customer data
            const allElements = {};
            document.querySelectorAll('input, select, textarea').forEach(el => {
                const name = el.name || el.id || el.className;
                let val;
                if (el.tagName === 'SELECT' && el.selectedIndex >= 0) {
                    val = el.options[el.selectedIndex].text;
                } else {
                    val = el.value;
                }
                allElements[name] = {value: val, tag: el.tagName, visible: el.offsetParent !== null};
            });

            // Also check readonly text displays
            const text = document.body.textContent;
            const hasCustomerName = text.includes('Dietrich') || text.includes('Lieck');

            return {elements: allElements, hasCustomerName: hasCustomerName, bodyStart: text.substring(0, 300)};
        }""")
        print(f"  Form elements: {kunde_info['elements']}")
        print(f"  Customer name visible: {kunde_info['hasCustomerName']}")

        if kunde_info.get('hasCustomerName'):
            log("Leistung ->L: Kundenname", "OK", "Dietrich Lieck sichtbar")
        else:
            # Check if any field has the customer
            has_customer = any('dietrich' in str(v.get('value','')).lower() or 'lieck' in str(v.get('value','')).lower()
                              for v in kunde_info.get('elements', {}).values())
            if has_customer:
                log("Leistung ->L: Kundenname", "OK", "Kunde in Formularfeld")
            else:
                log("Leistung ->L: Kundenname", "FEHLER", "Kundenname nicht gefunden", sp)

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

        print("\n--- ALLE ERGEBNISSE ---")
        for r in results:
            print(f"  [{r['status']}] {r['test']}: {r['detail']}")

        browser.close()
        return 1 if fail > 0 else 0

if __name__ == "__main__":
    sys.exit(main())
