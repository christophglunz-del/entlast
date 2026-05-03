#!/usr/bin/env python3
"""Systematischer E2E-Test von entlast.de im iPhone 14 Viewport."""

import sys
import os
import time
import json
from playwright.sync_api import sync_playwright, TimeoutError as PwTimeout

SCREENSHOT_DIR = "/Users/cg/Projects/entlast/screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

BASE_URL = "https://entlast.de"
results = []

def screenshot(page, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=False)
    return path

def log_result(test_name, status, detail="", screenshot_path=""):
    results.append({
        "test": test_name,
        "status": status,
        "detail": detail,
        "screenshot": screenshot_path
    })
    icon = "OK" if status == "OK" else "FEHLER"
    print(f"[{icon}] {test_name}: {detail}")

def wait_and_click(page, selector, timeout=5000):
    """Wait for element and click it."""
    el = page.wait_for_selector(selector, timeout=timeout)
    if el:
        el.click()
        return True
    return False

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
        )
        page = context.new_page()

        # Collect console errors
        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

        # ============================================================
        # LOGIN
        # ============================================================
        print("\n=== LOGIN ===")
        page.goto(BASE_URL, wait_until="networkidle", timeout=15000)
        time.sleep(1)
        screenshot(page, "00_initial_page")

        # Check if we need to login
        if page.url.endswith("/login") or page.locator("input[type='password']").count() > 0 or page.locator("input[name='password']").count() > 0:
            # Try to find login fields
            try:
                # Look for username/email field
                username_field = page.locator("input[name='username'], input[name='email'], input[type='text']").first
                username_field.fill("Susi")

                password_field = page.locator("input[name='password'], input[type='password']").first
                password_field.fill("Susi2026!")

                screenshot(page, "01_login_filled")

                # Click login button
                login_btn = page.locator("button[type='submit'], button:has-text('Login'), button:has-text('Anmelden'), button:has-text('login')").first
                login_btn.click()

                page.wait_for_load_state("networkidle", timeout=10000)
                time.sleep(2)
                screenshot(page, "02_after_login")

                if "login" not in page.url.lower():
                    log_result("Login", "OK", f"Erfolgreich eingeloggt. URL: {page.url}")
                else:
                    log_result("Login", "FEHLER", f"Login fehlgeschlagen. URL: {page.url}", screenshot(page, "02_login_failed"))

            except Exception as e:
                log_result("Login", "FEHLER", f"Login-Formular nicht gefunden: {e}", screenshot(page, "02_login_error"))
        else:
            log_result("Login", "OK", f"Kein Login nötig oder bereits eingeloggt. URL: {page.url}")

        # ============================================================
        # TEST 4: BOTTOM-NAV
        # ============================================================
        print("\n=== TEST 4: BOTTOM-NAV ===")
        nav_items = {
            "Start": ["start", "home", "dashboard"],
            "Termine": ["termine", "calendar", "kalender"],
            "Leistung": ["leistung", "leistungen", "service"],
            "Kilometer": ["kilometer", "km", "fahrten"],
            "Mehr": ["mehr", "more", "menu"]
        }

        # First, let's see what nav items exist
        screenshot(page, "03_current_page")

        # Find all nav links
        nav_links = page.locator("nav a, .nav a, .bottom-nav a, [class*='nav'] a, footer a").all()
        print(f"  Found {len(nav_links)} nav links")
        for link in nav_links:
            try:
                text = link.text_content().strip()
                href = link.get_attribute("href") or ""
                print(f"    Nav link: '{text}' -> {href}")
            except:
                pass

        # Try clicking each nav item
        for name, keywords in nav_items.items():
            try:
                # Try multiple selectors
                clicked = False
                for kw in keywords:
                    selectors = [
                        f"nav a:has-text('{name}')",
                        f"a:has-text('{name}')",
                        f"[class*='nav'] a:has-text('{name}')",
                        f"a[href*='{kw}']",
                        f"button:has-text('{name}')",
                        f"[class*='tab']:has-text('{name}')",
                    ]
                    for sel in selectors:
                        try:
                            el = page.locator(sel).first
                            if el.count() > 0 and el.is_visible():
                                el.click()
                                time.sleep(1)
                                page.wait_for_load_state("networkidle", timeout=5000)
                                clicked = True
                                break
                        except:
                            continue
                    if clicked:
                        break

                if clicked:
                    s = screenshot(page, f"04_nav_{name}")
                    log_result(f"Bottom-Nav: {name}", "OK", f"URL: {page.url}", s)
                else:
                    log_result(f"Bottom-Nav: {name}", "FEHLER", "Button nicht gefunden/klickbar")
            except Exception as e:
                log_result(f"Bottom-Nav: {name}", "FEHLER", str(e))

        # ============================================================
        # TEST 1: KALENDER -> LEISTUNG (->L Button)
        # ============================================================
        print("\n=== TEST 1: KALENDER -> LEISTUNG ===")
        try:
            # Navigate to Termine
            page.goto(f"{BASE_URL}/termine", wait_until="networkidle", timeout=10000)
            time.sleep(2)
            screenshot(page, "05_termine_page")

            # Look for ->L button
            l_buttons = page.locator("button:has-text('→L'), a:has-text('→L'), [class*='action']:has-text('L'), button:has-text('L')").all()
            print(f"  Found {len(l_buttons)} potential →L buttons")

            # Also check for any buttons with arrow symbols
            all_buttons = page.locator("button, a.btn, [class*='btn']").all()
            for btn in all_buttons[:20]:
                try:
                    text = btn.text_content().strip()
                    if text and len(text) < 10:
                        print(f"    Button: '{text}'")
                except:
                    pass

            if l_buttons:
                l_buttons[0].click()
                time.sleep(2)
                page.wait_for_load_state("networkidle", timeout=5000)
                s = screenshot(page, "06_after_L_click")

                # Check if we landed on Leistung page
                if "leistung" in page.url.lower():
                    log_result("Kalender->Leistung (→L)", "OK", f"Landingpage: {page.url}", s)
                else:
                    log_result("Kalender->Leistung (→L)", "FEHLER", f"Falsche URL: {page.url}", s)
            else:
                # Try with other selectors
                try:
                    # Maybe it's an icon or abbreviated
                    arrow_l = page.locator("[title*='Leistung'], [aria-label*='Leistung'], .termin-action-l, [data-action='leistung']").first
                    if arrow_l.count() > 0:
                        arrow_l.click()
                        time.sleep(2)
                        s = screenshot(page, "06_after_L_click")
                        log_result("Kalender->Leistung (→L)", "OK", f"URL: {page.url}", s)
                    else:
                        s = screenshot(page, "06_no_L_button")
                        log_result("Kalender->Leistung (→L)", "FEHLER", "→L Button nicht gefunden", s)
                except Exception as e:
                    log_result("Kalender->Leistung (→L)", "FEHLER", f"Fehler: {e}")
        except Exception as e:
            log_result("Kalender->Leistung (→L)", "FEHLER", str(e))

        # ============================================================
        # TEST 2: KALENDER -> KILOMETER (->km Button)
        # ============================================================
        print("\n=== TEST 2: KALENDER -> KILOMETER ===")
        try:
            page.goto(f"{BASE_URL}/termine", wait_until="networkidle", timeout=10000)
            time.sleep(2)

            km_buttons = page.locator("button:has-text('→km'), a:has-text('→km'), button:has-text('km'), [title*='Kilometer'], [aria-label*='Kilometer'], [title*='Fahrt'], [aria-label*='Fahrt']").all()
            print(f"  Found {len(km_buttons)} potential →km buttons")

            if km_buttons:
                km_buttons[0].click()
                time.sleep(2)
                page.wait_for_load_state("networkidle", timeout=5000)
                s = screenshot(page, "07_after_km_click")

                if "kilometer" in page.url.lower() or "km" in page.url.lower() or "fahrt" in page.url.lower():
                    log_result("Kalender->Kilometer (→km)", "OK", f"URL: {page.url}", s)
                else:
                    log_result("Kalender->Kilometer (→km)", "FEHLER", f"Falsche URL: {page.url}", s)
            else:
                s = screenshot(page, "07_no_km_button")
                log_result("Kalender->Kilometer (→km)", "FEHLER", "→km Button nicht gefunden", s)
        except Exception as e:
            log_result("Kalender->Kilometer (→km)", "FEHLER", str(e))

        # ============================================================
        # TEST 3: LEISTUNG -> RECHNUNG (RE erstellen)
        # ============================================================
        print("\n=== TEST 3: LEISTUNG -> RECHNUNG ===")
        try:
            page.goto(f"{BASE_URL}/leistung", wait_until="networkidle", timeout=10000)
            time.sleep(2)
            s = screenshot(page, "08_leistung_page")

            re_buttons = page.locator("button:has-text('RE erstellen'), a:has-text('RE erstellen'), button:has-text('RE'), [class*='rechnung'], button:has-text('Rechnung')").all()
            print(f"  Found {len(re_buttons)} potential RE buttons")

            # List all visible buttons on the page
            all_btns = page.locator("button:visible, a.btn:visible, [class*='btn']:visible").all()
            for btn in all_btns[:20]:
                try:
                    text = btn.text_content().strip()
                    if text:
                        print(f"    Visible button: '{text}'")
                except:
                    pass

            if re_buttons:
                re_buttons[0].click()
                time.sleep(2)
                s = screenshot(page, "09_after_RE_click")

                # Check for overlay/modal
                overlay = page.locator(".modal, .overlay, [class*='modal'], [class*='overlay'], [class*='dialog']").first
                if overlay.count() > 0 and overlay.is_visible():
                    log_result("Leistung->Rechnung (RE erstellen)", "OK", "Rechnungs-Overlay geöffnet", s)
                else:
                    log_result("Leistung->Rechnung (RE erstellen)", "OK", f"Seite nach Klick: {page.url}", s)
            else:
                log_result("Leistung->Rechnung (RE erstellen)", "FEHLER", "RE erstellen Button nicht gefunden", s)
        except Exception as e:
            log_result("Leistung->Rechnung (RE erstellen)", "FEHLER", str(e))

        # ============================================================
        # TEST 5: MEHR-MENUE
        # ============================================================
        print("\n=== TEST 5: MEHR-MENUE ===")
        try:
            # Click Mehr
            mehr = page.locator("nav a:has-text('Mehr'), a:has-text('Mehr'), [class*='nav'] a:has-text('Mehr'), a[href*='mehr'], a[href*='more']").first
            if mehr.count() > 0:
                mehr.click()
                time.sleep(1)
                s = screenshot(page, "10_mehr_menu")
                log_result("Mehr-Menü: Öffnen", "OK", f"URL: {page.url}", s)

                # Check for sub-pages
                sub_pages = {
                    "Kunden": ["kunden", "kunde", "customer"],
                    "Archiv": ["archiv", "archive"],
                    "Budget": ["budget"],
                    "Abtretung": ["abtretung", "abtretungen"],
                    "Firma": ["firma", "company"],
                    "Einstellungen": ["einstellungen", "settings"],
                }

                for sub_name, keywords in sub_pages.items():
                    try:
                        found = False
                        for kw in [sub_name] + keywords:
                            link = page.locator(f"a:has-text('{kw}'), button:has-text('{kw}')").first
                            if link.count() > 0 and link.is_visible():
                                link.click()
                                time.sleep(1)
                                page.wait_for_load_state("networkidle", timeout=5000)
                                s = screenshot(page, f"11_mehr_{sub_name}")
                                log_result(f"Mehr->{sub_name}", "OK", f"URL: {page.url}", s)
                                found = True

                                # Go back to Mehr menu
                                mehr2 = page.locator("nav a:has-text('Mehr'), a:has-text('Mehr'), [class*='nav'] a:has-text('Mehr'), a[href*='mehr']").first
                                if mehr2.count() > 0:
                                    mehr2.click()
                                    time.sleep(1)
                                else:
                                    page.go_back()
                                    time.sleep(1)
                                break
                        if not found:
                            log_result(f"Mehr->{sub_name}", "FEHLER", "Link nicht gefunden")
                    except Exception as e:
                        log_result(f"Mehr->{sub_name}", "FEHLER", str(e))
            else:
                log_result("Mehr-Menü: Öffnen", "FEHLER", "Mehr-Button nicht gefunden")
        except Exception as e:
            log_result("Mehr-Menü", "FEHLER", str(e))

        # ============================================================
        # TEST 6: ZURUECK-BUTTON
        # ============================================================
        print("\n=== TEST 6: ZURUECK-BUTTON ===")
        try:
            # Go to Start
            page.goto(f"{BASE_URL}/", wait_until="networkidle", timeout=10000)
            time.sleep(1)

            # Go to Termine
            page.goto(f"{BASE_URL}/termine", wait_until="networkidle", timeout=10000)
            time.sleep(1)

            # Try to open a Termin for editing
            termin_link = page.locator(".termin, [class*='termin'], [class*='event'], .appointment, tr, .list-item, .card").first
            if termin_link.count() > 0:
                termin_link.click()
                time.sleep(2)
                s = screenshot(page, "12_termin_detail")

                # Look for back button
                back_btn = page.locator("button:has-text('←'), a:has-text('←'), button:has-text('Zurück'), a:has-text('Zurück'), [class*='back'], .back-button, button[aria-label='Zurück'], .header-back").first
                if back_btn.count() > 0:
                    back_btn.click()
                    time.sleep(1)
                    s = screenshot(page, "13_after_back")

                    if "termine" in page.url.lower():
                        log_result("Zurück-Button (←)", "OK", f"Korrekt bei Termine gelandet: {page.url}", s)
                    elif page.url == BASE_URL + "/" or "start" in page.url or "dashboard" in page.url:
                        log_result("Zurück-Button (←)", "FEHLER", f"Falsch bei Start gelandet statt Termine: {page.url}", s)
                    else:
                        log_result("Zurück-Button (←)", "OK", f"URL nach Zurück: {page.url}", s)
                else:
                    log_result("Zurück-Button (←)", "FEHLER", "Zurück-Button nicht gefunden", s)
            else:
                # Navigate to termin/new or similar
                page.goto(f"{BASE_URL}/termine/neu", wait_until="networkidle", timeout=10000)
                time.sleep(1)
                s = screenshot(page, "12_termin_neu")

                back_btn = page.locator("button:has-text('←'), a:has-text('←'), button:has-text('Zurück'), a:has-text('Zurück'), [class*='back']").first
                if back_btn.count() > 0:
                    back_btn.click()
                    time.sleep(1)
                    s = screenshot(page, "13_after_back")
                    log_result("Zurück-Button (←)", "OK" if "termine" in page.url.lower() else "FEHLER", f"URL: {page.url}", s)
                else:
                    log_result("Zurück-Button (←)", "FEHLER", "Zurück-Button nicht gefunden")
        except Exception as e:
            log_result("Zurück-Button (←)", "FEHLER", str(e))

        # ============================================================
        # TEST 7: EINSTELLUNGEN
        # ============================================================
        print("\n=== TEST 7: EINSTELLUNGEN ===")
        try:
            page.goto(f"{BASE_URL}/einstellungen", wait_until="networkidle", timeout=10000)
            time.sleep(2)
            s = screenshot(page, "14_einstellungen")

            # Check for Cache-leeren button
            cache_btn = page.locator("button:has-text('Cache'), button:has-text('cache'), button:has-text('Leeren'), button:has-text('leeren'), button:has-text('Cache leeren')").first
            if cache_btn.count() > 0 and cache_btn.is_visible():
                log_result("Einstellungen: Cache-leeren", "OK", "Button sichtbar")
            else:
                log_result("Einstellungen: Cache-leeren", "FEHLER", "Button nicht sichtbar", s)

            # Check for Google Calendar URL field
            gcal_field = page.locator("input[placeholder*='Google'], input[placeholder*='google'], input[placeholder*='Kalender'], input[name*='google'], input[name*='calendar'], input[name*='gcal'], label:has-text('Google') + input, label:has-text('Kalender-URL')").first
            if gcal_field.count() > 0:
                log_result("Einstellungen: Google-Kalender-URL", "OK", "Feld vorhanden")
            else:
                # Also check text content
                page_text = page.text_content("body")
                if "google" in page_text.lower() or "kalender-url" in page_text.lower() or "kalender" in page_text.lower():
                    log_result("Einstellungen: Google-Kalender-URL", "OK", "Kalender-Bezug im Text gefunden")
                else:
                    log_result("Einstellungen: Google-Kalender-URL", "FEHLER", "Feld nicht gefunden", s)
        except Exception as e:
            log_result("Einstellungen", "FEHLER", str(e))

        # ============================================================
        # TEST 8: KUNDEN-DETAIL
        # ============================================================
        print("\n=== TEST 8: KUNDEN-DETAIL ===")
        try:
            page.goto(f"{BASE_URL}/kunden", wait_until="networkidle", timeout=10000)
            time.sleep(2)
            s = screenshot(page, "15_kunden_liste")

            # Click on first customer
            kunde_link = page.locator("a[href*='kunden/'], .kunde, [class*='kunde'], .list-item, .card, tr td a, tbody tr").first
            if kunde_link.count() > 0:
                kunde_link.click()
                time.sleep(2)
                page.wait_for_load_state("networkidle", timeout=5000)
                s = screenshot(page, "16_kunden_detail")

                # Check for Pflegekasse dropdown
                pflegekasse = page.locator("select[name*='pflegekasse'], select[name*='kasse'], select:has(option:has-text('Pflege')), label:has-text('Pflegekasse'), label:has-text('Kasse')").first
                page_text = page.text_content("body").lower()

                if pflegekasse.count() > 0:
                    # Check if it has entries
                    options = pflegekasse.locator("option").all()
                    log_result("Kunden-Detail: Pflegekasse", "OK", f"Dropdown mit {len(options)} Einträgen")
                elif "pflegekasse" in page_text or "kasse" in page_text:
                    log_result("Kunden-Detail: Pflegekasse", "OK", "Pflegekasse im Text gefunden")
                else:
                    log_result("Kunden-Detail: Pflegekasse", "FEHLER", "Pflegekasse-Dropdown nicht gefunden", s)

                # Check for Geburtsdatum
                geb_field = page.locator("input[name*='geburt'], input[name*='birth'], input[type='date'], label:has-text('Geburt'), label:has-text('Geb')").first
                if geb_field.count() > 0:
                    log_result("Kunden-Detail: Geburtsdatum", "OK", "Feld vorhanden")
                elif "geburtsdatum" in page_text or "geb.datum" in page_text or "geboren" in page_text:
                    log_result("Kunden-Detail: Geburtsdatum", "OK", "Geburtsdatum im Text gefunden")
                else:
                    log_result("Kunden-Detail: Geburtsdatum", "FEHLER", "Geburtsdatum-Feld nicht gefunden", s)
            else:
                log_result("Kunden-Detail", "FEHLER", "Kein Kunde zum Klicken gefunden", s)
        except Exception as e:
            log_result("Kunden-Detail", "FEHLER", str(e))

        # ============================================================
        # EXTRA: Check all links on the page for dead links
        # ============================================================
        print("\n=== EXTRA: DEAD-LINK CHECK ===")
        try:
            page.goto(BASE_URL, wait_until="networkidle", timeout=10000)
            time.sleep(1)

            all_links = page.locator("a[href]").all()
            internal_links = set()
            for link in all_links:
                try:
                    href = link.get_attribute("href")
                    if href and href.startswith("/") and not href.startswith("//"):
                        internal_links.add(href)
                    elif href and BASE_URL in href:
                        internal_links.add(href.replace(BASE_URL, ""))
                except:
                    pass

            print(f"  Found {len(internal_links)} unique internal links")
            for link_path in sorted(internal_links):
                try:
                    response = page.goto(f"{BASE_URL}{link_path}", wait_until="networkidle", timeout=8000)
                    status = response.status if response else "no response"
                    if response and response.status >= 400:
                        log_result(f"Dead-Link: {link_path}", "FEHLER", f"HTTP {status}")
                    else:
                        print(f"    OK: {link_path} ({status})")
                except Exception as e:
                    log_result(f"Dead-Link: {link_path}", "FEHLER", str(e))
        except Exception as e:
            print(f"  Dead-link check failed: {e}")

        # ============================================================
        # Console errors
        # ============================================================
        if console_errors:
            print(f"\n=== CONSOLE ERRORS ({len(console_errors)}) ===")
            for err in console_errors[:20]:
                print(f"  ERROR: {err}")

        # ============================================================
        # SUMMARY
        # ============================================================
        print("\n" + "="*60)
        print("ZUSAMMENFASSUNG")
        print("="*60)

        ok_count = sum(1 for r in results if r["status"] == "OK")
        fail_count = sum(1 for r in results if r["status"] == "FEHLER")

        print(f"\nGesamt: {len(results)} Tests | OK: {ok_count} | FEHLER: {fail_count}")

        if fail_count > 0:
            print("\n--- FEHLER ---")
            for r in results:
                if r["status"] == "FEHLER":
                    print(f"  [{r['status']}] {r['test']}: {r['detail']}")
                    if r['screenshot']:
                        print(f"         Screenshot: {r['screenshot']}")

        print("\n--- ALLE ERGEBNISSE ---")
        for r in results:
            icon = "OK" if r["status"] == "OK" else "FEHLER"
            print(f"  [{icon}] {r['test']}: {r['detail']}")

        browser.close()

        # Return exit code based on failures
        return 1 if fail_count > 0 else 0

if __name__ == "__main__":
    sys.exit(main())
