#!/usr/bin/env python3
"""Systematischer E2E-Test von entlast.de im iPhone 14 Viewport - v2."""

import sys
import os
import time
from playwright.sync_api import sync_playwright, TimeoutError as PwTimeout

SCREENSHOT_DIR = "/Users/cg/Projects/entlast/screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

BASE_URL = "https://entlast.de"
results = []

def s(page, name):
    """Take screenshot and return path."""
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=False)
    return path

def log(test_name, status, detail="", sp=""):
    results.append({"test": test_name, "status": status, "detail": detail, "screenshot": sp})
    print(f"[{status}] {test_name}: {detail}")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"
        )
        page = context.new_page()

        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

        # ============================================================
        # LOGIN
        # ============================================================
        print("=== LOGIN ===")
        page.goto(f"{BASE_URL}/login.html", wait_until="networkidle", timeout=15000)
        time.sleep(2)
        s(page, "00_login_page")

        # Fill login
        page.fill("input[placeholder='Benutzername eingeben']", "Susi")
        page.fill("input[placeholder='Passwort eingeben']", "Susi2026!")
        s(page, "01_login_filled")

        # Click Anmelden
        page.click("button:has-text('Anmelden')")
        time.sleep(3)
        page.wait_for_load_state("networkidle", timeout=10000)
        sp = s(page, "02_after_login")

        current_url = page.url
        print(f"  After login URL: {current_url}")

        # Check if login was successful
        if "login" in current_url.lower() and page.locator("input[placeholder='Passwort eingeben']").count() > 0:
            log("Login", "FEHLER", f"Immer noch auf Login-Seite: {current_url}", sp)
            # Try looking at the page for error messages
            page_text = page.text_content("body")
            print(f"  Page text excerpt: {page_text[:500]}")
            browser.close()
            return 1
        else:
            log("Login", "OK", f"Erfolgreich. URL: {current_url}", sp)

        # Let's explore what pages exist - check the HTML structure
        print("\n=== PAGE EXPLORATION ===")
        html = page.content()
        print(f"  Page title: {page.title()}")
        print(f"  URL: {page.url}")

        # List all links
        all_links = page.locator("a[href]").all()
        print(f"  Links found: {len(all_links)}")
        for link in all_links[:30]:
            try:
                href = link.get_attribute("href") or ""
                text = link.text_content().strip()[:40]
                visible = link.is_visible()
                print(f"    {'[V]' if visible else '[H]'} '{text}' -> {href}")
            except:
                pass

        # List all buttons
        all_buttons = page.locator("button").all()
        print(f"  Buttons found: {len(all_buttons)}")
        for btn in all_buttons[:30]:
            try:
                text = btn.text_content().strip()[:40]
                visible = btn.is_visible()
                print(f"    {'[V]' if visible else '[H]'} '{text}'")
            except:
                pass

        # List nav elements
        nav_els = page.locator("nav, [class*='nav'], [class*='bottom'], [class*='tab']").all()
        print(f"  Nav/tab elements: {len(nav_els)}")
        for nav in nav_els[:10]:
            try:
                cls = nav.get_attribute("class") or ""
                inner = nav.inner_text()[:100]
                print(f"    class='{cls}': {inner}")
            except:
                pass

        # ============================================================
        # TEST 4: BOTTOM-NAV
        # ============================================================
        print("\n=== TEST 4: BOTTOM-NAV ===")

        # Try to find bottom nav by various selectors
        bottom_nav = page.locator(".bottom-nav, .tab-bar, nav.fixed, nav[class*='bottom'], [class*='tabbar'], [class*='footer-nav']").first
        if bottom_nav.count() > 0:
            print(f"  Bottom nav found: class='{bottom_nav.get_attribute('class')}'")
            bn_text = bottom_nav.inner_text()
            print(f"  Content: {bn_text}")

        nav_targets = ["Start", "Termine", "Leistung", "Kilometer", "Mehr"]
        for target in nav_targets:
            try:
                # Try various selectors
                el = None
                for selector in [
                    f"a:has-text('{target}')",
                    f"button:has-text('{target}')",
                    f"div:has-text('{target}'):not(:has(div:has-text('{target}')))",
                    f"span:has-text('{target}')",
                ]:
                    try:
                        loc = page.locator(selector).first
                        if loc.count() > 0 and loc.is_visible():
                            el = loc
                            break
                    except:
                        continue

                if el:
                    el.click()
                    time.sleep(1.5)
                    page.wait_for_load_state("networkidle", timeout=5000)
                    sp = s(page, f"04_nav_{target}")
                    log(f"Bottom-Nav: {target}", "OK", f"URL: {page.url}", sp)
                else:
                    log(f"Bottom-Nav: {target}", "FEHLER", "Element nicht gefunden/sichtbar")
            except Exception as e:
                log(f"Bottom-Nav: {target}", "FEHLER", str(e))

        # ============================================================
        # TEST 1: KALENDER -> LEISTUNG
        # ============================================================
        print("\n=== TEST 1: KALENDER -> LEISTUNG ===")
        try:
            # Navigate to Termine
            terme_link = page.locator("a:has-text('Termine'), a[href*='termine']").first
            if terme_link.count() > 0:
                terme_link.click()
            else:
                page.goto(f"{BASE_URL}/termine.html", wait_until="networkidle", timeout=10000)
            time.sleep(2)
            page.wait_for_load_state("networkidle", timeout=5000)
            sp = s(page, "05_termine_page")
            print(f"  Termine URL: {page.url}")

            # Debug: list all buttons/links on the page
            all_els = page.locator("button, a, [onclick], [class*='action']").all()
            for el in all_els[:30]:
                try:
                    tag = el.evaluate("el => el.tagName")
                    text = el.text_content().strip()[:30]
                    cls = el.get_attribute("class") or ""
                    href = el.get_attribute("href") or ""
                    title = el.get_attribute("title") or ""
                    visible = el.is_visible()
                    if visible and text:
                        print(f"    [{tag}] '{text}' class='{cls}' href='{href}' title='{title}'")
                except:
                    pass

            # Look for →L button (might use arrow character or icon)
            found_l = False
            for sel in [
                "button:has-text('→L')", "a:has-text('→L')",
                "button:has-text('→ L')", "a:has-text('→ L')",
                "[title*='Leistung']", "[aria-label*='Leistung']",
                ".btn-leistung", "[class*='leistung']",
                "button:has-text('L')", # single L button
            ]:
                try:
                    loc = page.locator(sel)
                    if loc.count() > 0:
                        first = loc.first
                        if first.is_visible():
                            text = first.text_content().strip()
                            print(f"  Found candidate: '{text}' via {sel}")
                            first.click()
                            time.sleep(2)
                            sp = s(page, "06_after_L_click")
                            log("Kalender->Leistung (->L)", "OK", f"URL: {page.url}", sp)
                            found_l = True
                            break
                except:
                    continue

            if not found_l:
                log("Kalender->Leistung (->L)", "FEHLER", "->L Button nicht gefunden auf Terminseite", sp)
        except Exception as e:
            log("Kalender->Leistung (->L)", "FEHLER", str(e))

        # ============================================================
        # TEST 2: KALENDER -> KILOMETER
        # ============================================================
        print("\n=== TEST 2: KALENDER -> KILOMETER ===")
        try:
            # Navigate back to Termine
            terme_link = page.locator("a:has-text('Termine'), a[href*='termine']").first
            if terme_link.count() > 0:
                terme_link.click()
            else:
                page.goto(f"{BASE_URL}/termine.html", wait_until="networkidle", timeout=10000)
            time.sleep(2)

            found_km = False
            for sel in [
                "button:has-text('→km')", "a:has-text('→km')",
                "button:has-text('→ km')", "a:has-text('→ km')",
                "[title*='Kilometer']", "[aria-label*='Kilometer']",
                "[title*='Fahrt']", "[aria-label*='Fahrt']",
                ".btn-km", "[class*='kilometer']",
                "button:has-text('km')",
            ]:
                try:
                    loc = page.locator(sel)
                    if loc.count() > 0:
                        first = loc.first
                        if first.is_visible():
                            text = first.text_content().strip()
                            print(f"  Found candidate: '{text}' via {sel}")
                            first.click()
                            time.sleep(2)
                            sp = s(page, "07_after_km_click")
                            log("Kalender->Kilometer (->km)", "OK", f"URL: {page.url}", sp)
                            found_km = True
                            break
                except:
                    continue

            if not found_km:
                sp = s(page, "07_termine_no_km")
                log("Kalender->Kilometer (->km)", "FEHLER", "->km Button nicht gefunden", sp)
        except Exception as e:
            log("Kalender->Kilometer (->km)", "FEHLER", str(e))

        # ============================================================
        # TEST 3: LEISTUNG -> RECHNUNG
        # ============================================================
        print("\n=== TEST 3: LEISTUNG -> RECHNUNG ===")
        try:
            # Navigate to Leistung
            leist_link = page.locator("a:has-text('Leistung'), a[href*='leistung']").first
            if leist_link.count() > 0:
                leist_link.click()
            else:
                page.goto(f"{BASE_URL}/leistung.html", wait_until="networkidle", timeout=10000)
            time.sleep(2)
            page.wait_for_load_state("networkidle", timeout=5000)
            sp = s(page, "08_leistung_page")
            print(f"  Leistung URL: {page.url}")

            # Debug: list all visible elements
            all_els = page.locator("button:visible, a:visible, [class*='btn']:visible").all()
            for el in all_els[:30]:
                try:
                    text = el.text_content().strip()[:40]
                    cls = el.get_attribute("class") or ""
                    if text:
                        print(f"    '{text}' class='{cls}'")
                except:
                    pass

            found_re = False
            for sel in [
                "button:has-text('RE erstellen')", "a:has-text('RE erstellen')",
                "button:has-text('RE')", "a:has-text('RE')",
                "button:has-text('Rechnung')", "a:has-text('Rechnung')",
                "[class*='rechnung']", "[class*='invoice']",
                ".btn-danger:has-text('RE')", ".btn-red",
                "button.text-red", "button.bg-red",
            ]:
                try:
                    loc = page.locator(sel)
                    if loc.count() > 0:
                        first = loc.first
                        if first.is_visible():
                            text = first.text_content().strip()
                            print(f"  Found RE candidate: '{text}' via {sel}")
                            first.click()
                            time.sleep(2)
                            sp = s(page, "09_after_RE_click")

                            # Check for overlay/modal
                            modal = page.locator(".modal:visible, .overlay:visible, [class*='modal']:visible, [class*='overlay']:visible, [class*='dialog']:visible, [class*='popup']:visible").first
                            if modal.count() > 0:
                                log("Leistung->Rechnung (RE)", "OK", "Rechnungs-Overlay/Modal geöffnet", sp)
                            else:
                                log("Leistung->Rechnung (RE)", "OK", f"Nach Klick: {page.url}", sp)
                            found_re = True
                            break
                except:
                    continue

            if not found_re:
                log("Leistung->Rechnung (RE)", "FEHLER", "RE erstellen Button nicht gefunden", sp)
        except Exception as e:
            log("Leistung->Rechnung (RE)", "FEHLER", str(e))

        # ============================================================
        # TEST 5: MEHR-MENUE
        # ============================================================
        print("\n=== TEST 5: MEHR-MENUE ===")
        try:
            mehr_el = None
            for sel in [
                "a:has-text('Mehr')", "button:has-text('Mehr')",
                "a[href*='mehr']", "[class*='more']",
            ]:
                try:
                    loc = page.locator(sel).first
                    if loc.count() > 0 and loc.is_visible():
                        mehr_el = loc
                        break
                except:
                    continue

            if mehr_el:
                mehr_el.click()
                time.sleep(1.5)
                sp = s(page, "10_mehr_menu")
                log("Mehr-Menue: Oeffnen", "OK", f"URL: {page.url}", sp)

                # List what's visible
                page_text = page.text_content("body")
                print(f"  Page text excerpt: {page_text[:500]}")

                sub_pages = ["Kunden", "Archiv", "Budget", "Abtretung", "Firma", "Einstellungen"]
                for sub in sub_pages:
                    try:
                        link = page.locator(f"a:has-text('{sub}'), button:has-text('{sub}')").first
                        if link.count() > 0 and link.is_visible():
                            link.click()
                            time.sleep(1.5)
                            page.wait_for_load_state("networkidle", timeout=5000)
                            sp = s(page, f"11_mehr_{sub}")
                            log(f"Mehr->{sub}", "OK", f"URL: {page.url}", sp)

                            # Navigate back
                            page.go_back()
                            time.sleep(1)
                        else:
                            log(f"Mehr->{sub}", "FEHLER", "Link nicht sichtbar")
                    except Exception as e:
                        log(f"Mehr->{sub}", "FEHLER", str(e))
                        try:
                            page.go_back()
                            time.sleep(1)
                        except:
                            pass
            else:
                log("Mehr-Menue: Oeffnen", "FEHLER", "Mehr-Button nicht gefunden")
        except Exception as e:
            log("Mehr-Menue", "FEHLER", str(e))

        # ============================================================
        # TEST 6: ZURUECK-BUTTON
        # ============================================================
        print("\n=== TEST 6: ZURUECK-BUTTON ===")
        try:
            # Go to Termine first
            page.locator("a:has-text('Termine'), a[href*='termine']").first.click()
            time.sleep(2)
            print(f"  At Termine: {page.url}")

            # Find and click on a termin/event
            # Look for any clickable item in the calendar/list
            clickable = page.locator(".termin, .event, .appointment, [class*='termin'], [class*='event'], tr[onclick], .list-item, .card").first
            if clickable.count() > 0:
                clickable.click()
                time.sleep(2)
                sp = s(page, "12_termin_detail")
                detail_url = page.url
                print(f"  At detail: {detail_url}")

                # Find back button
                back = page.locator("button:has-text('←'), a:has-text('←'), [class*='back'], button:has-text('Zurück'), a:has-text('Zurück'), .header button:first-child, header button:first-child").first
                if back.count() > 0 and back.is_visible():
                    back.click()
                    time.sleep(1.5)
                    sp = s(page, "13_after_back")
                    after_url = page.url
                    print(f"  After back: {after_url}")

                    if "termine" in after_url.lower() or "kalender" in after_url.lower():
                        log("Zurueck-Button", "OK", f"Korrekt bei Termine: {after_url}", sp)
                    else:
                        log("Zurueck-Button", "FEHLER", f"Falsche Seite: {after_url} (erwartet: Termine)", sp)
                else:
                    log("Zurueck-Button", "FEHLER", "Kein Zurueck-Button auf Detail-Seite", sp)
            else:
                log("Zurueck-Button", "FEHLER", "Kein Termin zum Klicken gefunden")
        except Exception as e:
            log("Zurueck-Button", "FEHLER", str(e))

        # ============================================================
        # TEST 7: EINSTELLUNGEN
        # ============================================================
        print("\n=== TEST 7: EINSTELLUNGEN ===")
        try:
            # Navigate via Mehr -> Einstellungen or directly
            for url in [f"{BASE_URL}/einstellungen.html", f"{BASE_URL}/settings.html", f"{BASE_URL}/einstellungen"]:
                try:
                    resp = page.goto(url, wait_until="networkidle", timeout=8000)
                    time.sleep(1)
                    if resp and resp.status < 400 and "login" not in page.url:
                        break
                except:
                    continue

            sp = s(page, "14_einstellungen")
            print(f"  Einstellungen URL: {page.url}")

            page_text = page.text_content("body").lower()
            print(f"  Page text: {page_text[:500]}")

            # Cache-leeren
            cache_btn = page.locator("button:has-text('Cache'), button:has-text('cache'), button:has-text('Leeren'), button:has-text('leeren')").first
            if cache_btn.count() > 0 and cache_btn.is_visible():
                log("Einstellungen: Cache-leeren", "OK", "Button sichtbar")
            elif "cache" in page_text:
                log("Einstellungen: Cache-leeren", "OK", "'Cache' im Text gefunden")
            else:
                log("Einstellungen: Cache-leeren", "FEHLER", "Button nicht gefunden", sp)

            # Google Calendar
            if "google" in page_text or "kalender" in page_text or "calendar" in page_text:
                gcal = page.locator("input[name*='google'], input[name*='calendar'], input[name*='kalender'], input[placeholder*='google'], input[placeholder*='kalender']").first
                if gcal.count() > 0:
                    log("Einstellungen: Google-Kalender-URL", "OK", "Input-Feld vorhanden")
                else:
                    log("Einstellungen: Google-Kalender-URL", "OK", "Kalender-Bezug im Text")
            else:
                log("Einstellungen: Google-Kalender-URL", "FEHLER", "Weder Feld noch Text gefunden", sp)
        except Exception as e:
            log("Einstellungen", "FEHLER", str(e))

        # ============================================================
        # TEST 8: KUNDEN-DETAIL
        # ============================================================
        print("\n=== TEST 8: KUNDEN-DETAIL ===")
        try:
            for url in [f"{BASE_URL}/kunden.html", f"{BASE_URL}/kunden"]:
                try:
                    resp = page.goto(url, wait_until="networkidle", timeout=8000)
                    time.sleep(2)
                    if resp and resp.status < 400 and "login" not in page.url:
                        break
                except:
                    continue

            sp = s(page, "15_kunden_liste")
            print(f"  Kunden URL: {page.url}")

            # Debug: show page structure
            page_text = page.text_content("body")
            print(f"  Page text: {page_text[:500]}")

            # Find clickable customer
            kunde = page.locator("a[href*='kund'], tr[onclick], .kunde, [class*='kunde'], .list-item, .card, tbody tr, .customer").first
            if kunde.count() > 0 and kunde.is_visible():
                kunde.click()
                time.sleep(2)
                page.wait_for_load_state("networkidle", timeout=5000)
                sp = s(page, "16_kunden_detail")
                print(f"  Kunden-Detail URL: {page.url}")

                page_text = page.text_content("body").lower()

                # Pflegekasse
                pflegekasse = page.locator("select[name*='pflegekasse'], select[name*='kasse'], select:has(option:has-text('Pflege')), select:has(option:has-text('AOK'))").first
                if pflegekasse.count() > 0:
                    opts = pflegekasse.locator("option").count()
                    log("Kunden-Detail: Pflegekasse", "OK", f"Dropdown mit {opts} Eintraegen")
                elif "pflegekasse" in page_text or "krankenkasse" in page_text:
                    log("Kunden-Detail: Pflegekasse", "OK", "Kasse im Text gefunden")
                else:
                    log("Kunden-Detail: Pflegekasse", "FEHLER", "Nicht gefunden", sp)

                # Geburtsdatum
                geb = page.locator("input[name*='geburt'], input[name*='birth'], input[name*='geb'], label:has-text('Geburt')").first
                if geb.count() > 0:
                    log("Kunden-Detail: Geburtsdatum", "OK", "Feld vorhanden")
                elif "geburt" in page_text or "geb.datum" in page_text:
                    log("Kunden-Detail: Geburtsdatum", "OK", "Geburtsdatum im Text")
                else:
                    log("Kunden-Detail: Geburtsdatum", "FEHLER", "Nicht gefunden", sp)
            else:
                log("Kunden-Detail", "FEHLER", "Kein Kunde zum Klicken gefunden", sp)
        except Exception as e:
            log("Kunden-Detail", "FEHLER", str(e))

        # ============================================================
        # CONSOLE ERRORS
        # ============================================================
        if console_errors:
            print(f"\n=== CONSOLE ERRORS ({len(console_errors)}) ===")
            unique_errors = list(set(console_errors))
            for err in unique_errors[:20]:
                print(f"  ERROR: {err}")

        # ============================================================
        # SUMMARY
        # ============================================================
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
