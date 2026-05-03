#!/usr/bin/env python3
"""Gezielter Nachtest fuer Mehr-Menue, Einstellungen, Kunden, Zurueck-Button."""

import sys
import os
import time
from playwright.sync_api import sync_playwright

SCREENSHOT_DIR = "/Users/cg/Projects/entlast/screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)
BASE_URL = "https://entlast.de"

results = []
def s(page, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=False)
    return path

def sf(page, name):
    """Full page screenshot."""
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=True)
    return path

def log(test_name, status, detail="", sp=""):
    results.append({"test": test_name, "status": status, "detail": detail, "screenshot": sp})
    print(f"[{status}] {test_name}: {detail}")

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
        print("=== LOGIN ===")
        page.goto(f"{BASE_URL}/login.html", wait_until="networkidle", timeout=15000)
        time.sleep(2)
        page.fill("input[placeholder='Benutzername eingeben']", "Susi")
        page.fill("input[placeholder='Passwort eingeben']", "Susi2026!")
        page.click("button:has-text('Anmelden')")
        time.sleep(3)
        page.wait_for_load_state("networkidle", timeout=10000)
        print(f"  Logged in: {page.url}")

        # ============================================================
        # TEST: MEHR-MENUE (from Start page, no overlay blocking)
        # ============================================================
        print("\n=== TEST: MEHR-MENUE ===")
        page.goto(f"{BASE_URL}/index.html", wait_until="networkidle", timeout=10000)
        time.sleep(1)

        # Click Mehr in bottom nav
        mehr_btn = page.locator("#navMoreBtn, a:has-text('Mehr')").first
        if mehr_btn.count() > 0 and mehr_btn.is_visible():
            mehr_btn.click()
            time.sleep(1)
            sp = s(page, "20_mehr_opened")
            log("Mehr-Menue: Oeffnen", "OK", f"Geoeffnet", sp)

            # Check which sub-items are visible
            more_menu = page.locator("#moreMenu, .more-menu, [class*='more-menu'], [class*='slide']").first
            if more_menu.count() > 0:
                text = more_menu.inner_text()
                print(f"  Menu content: {text}")

            # Check sub-pages
            sub_pages = {
                "Kunden": "pages/kunden.html",
                "Termine": "pages/termine.html",
                "Fahrten": "pages/fahrten.html",
                "Archiv": "pages/rechnung.html",
                "Budget": "pages/entlastung.html",
                "Abtretung": "pages/abtretung.html",
                "Firmendaten": "pages/firma.html",
                "Einstellungen": "pages/settings.html",
            }

            for name, expected_path in sub_pages.items():
                try:
                    link = page.locator(f"a:has-text('{name}')").first
                    if link.count() > 0 and link.is_visible():
                        href = link.get_attribute("href") or ""
                        link.click()
                        time.sleep(1.5)
                        page.wait_for_load_state("networkidle", timeout=5000)
                        sp = s(page, f"21_mehr_{name}")
                        log(f"Mehr->{name}", "OK", f"URL: {page.url}", sp)

                        # Go back to start and reopen Mehr
                        page.goto(f"{BASE_URL}/index.html", wait_until="networkidle", timeout=10000)
                        time.sleep(1)
                        mehr_btn2 = page.locator("#navMoreBtn, a:has-text('Mehr')").first
                        if mehr_btn2.count() > 0:
                            mehr_btn2.click()
                            time.sleep(0.5)
                    else:
                        log(f"Mehr->{name}", "FEHLER", f"Link nicht sichtbar im Menue")
                except Exception as e:
                    log(f"Mehr->{name}", "FEHLER", str(e))
                    # Try to recover
                    try:
                        page.goto(f"{BASE_URL}/index.html", wait_until="networkidle", timeout=10000)
                        time.sleep(1)
                        page.locator("#navMoreBtn, a:has-text('Mehr')").first.click()
                        time.sleep(0.5)
                    except:
                        pass
        else:
            log("Mehr-Menue: Oeffnen", "FEHLER", "Mehr-Button nicht gefunden")

        # ============================================================
        # TEST: KUNDEN-SEITE UND DETAIL
        # ============================================================
        print("\n=== TEST: KUNDEN ===")
        page.goto(f"{BASE_URL}/pages/kunden.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = s(page, "22_kunden_page")
        print(f"  Kunden URL: {page.url}")

        # Check if we're actually on the Kunden page
        page_text = page.text_content("body")
        print(f"  Page content (first 300): {page_text[:300]}")

        if "kunden" in page.url.lower() or "Kunden" in page_text:
            log("Kunden-Seite", "OK", f"URL: {page.url}")

            # Find and click on a customer
            # List all clickable elements
            clickables = page.locator("tr, .kunde, .list-item, .card, [class*='kunde'], [onclick]").all()
            print(f"  Clickable elements: {len(clickables)}")

            # Try to find customer links/rows
            links = page.locator("a[href*='kunden'], a[href*='kunde']").all()
            print(f"  Customer links: {len(links)}")
            for l in links[:5]:
                try:
                    txt = l.text_content().strip()[:40]
                    href = l.get_attribute("href")
                    print(f"    '{txt}' -> {href}")
                except:
                    pass

            # Also try table rows
            rows = page.locator("tbody tr, .customer-list .item, .kunden-list .item").all()
            print(f"  Table rows: {len(rows)}")

            # Try clicking the first customer item
            customer_clicked = False
            for sel in [
                "a[href*='kunden/']", "a[href*='kunde/']",
                "tbody tr:first-child", ".kunde:first-child",
                ".list-item:first-child", ".card:first-child",
                "tr:has(td):first-of-type",
            ]:
                try:
                    el = page.locator(sel).first
                    if el.count() > 0 and el.is_visible():
                        el.click()
                        time.sleep(2)
                        page.wait_for_load_state("networkidle", timeout=5000)
                        sp = s(page, "23_kunden_detail")
                        print(f"  After click URL: {page.url}")
                        customer_clicked = True
                        break
                except:
                    continue

            if not customer_clicked:
                # Maybe customers are shown as a list of divs
                all_visible = page.locator("div:visible, li:visible, span:visible").all()
                # Find any element containing a name
                for el in all_visible:
                    try:
                        text = el.text_content().strip()
                        cls = el.get_attribute("class") or ""
                        if "kunde" in cls.lower() or "customer" in cls.lower():
                            print(f"    Found customer element: '{text[:40]}' class='{cls}'")
                    except:
                        pass

            if customer_clicked:
                page_text = page.text_content("body").lower()

                # Pflegekasse dropdown
                pflegekasse_select = page.locator("select").all()
                print(f"  Select elements on detail page: {len(pflegekasse_select)}")
                for sel in pflegekasse_select:
                    try:
                        name = sel.get_attribute("name") or sel.get_attribute("id") or ""
                        opts = sel.locator("option").count()
                        print(f"    Select '{name}': {opts} options")
                    except:
                        pass

                found_pflegekasse = False
                for sel in pflegekasse_select:
                    try:
                        name = (sel.get_attribute("name") or "").lower()
                        sid = (sel.get_attribute("id") or "").lower()
                        if "kasse" in name or "kasse" in sid or "pflege" in name:
                            opts = sel.locator("option").count()
                            log("Kunden-Detail: Pflegekasse", "OK", f"Dropdown '{name}' mit {opts} Eintraegen")
                            found_pflegekasse = True
                            break
                    except:
                        pass

                if not found_pflegekasse:
                    if "pflegekasse" in page_text or "kasse" in page_text:
                        log("Kunden-Detail: Pflegekasse", "OK", "Kasse-Text gefunden")
                    else:
                        log("Kunden-Detail: Pflegekasse", "FEHLER", "Pflegekasse nicht gefunden", sp)

                # Geburtsdatum
                date_inputs = page.locator("input[type='date']").all()
                print(f"  Date inputs: {len(date_inputs)}")
                for di in date_inputs:
                    try:
                        name = di.get_attribute("name") or di.get_attribute("id") or ""
                        val = di.input_value()
                        print(f"    Date input '{name}': value='{val}'")
                    except:
                        pass

                found_geb = False
                for di in date_inputs:
                    try:
                        name = (di.get_attribute("name") or "").lower()
                        did = (di.get_attribute("id") or "").lower()
                        if "geb" in name or "geb" in did or "birth" in name:
                            log("Kunden-Detail: Geburtsdatum", "OK", f"Date-Input '{name}'")
                            found_geb = True
                            break
                    except:
                        pass

                if not found_geb:
                    if "geburt" in page_text or "geb.datum" in page_text:
                        log("Kunden-Detail: Geburtsdatum", "OK", "Geburtsdatum im Text")
                    else:
                        # Maybe it's a text input with label
                        labels = page.locator("label").all()
                        for lbl in labels:
                            try:
                                txt = lbl.text_content().strip().lower()
                                if "geburt" in txt or "geb" in txt:
                                    log("Kunden-Detail: Geburtsdatum", "OK", f"Label gefunden: '{lbl.text_content().strip()}'")
                                    found_geb = True
                                    break
                            except:
                                pass
                        if not found_geb:
                            log("Kunden-Detail: Geburtsdatum", "FEHLER", "Nicht gefunden", sp)
            else:
                log("Kunden-Detail", "FEHLER", "Konnte keinen Kunden anklicken", sp)
        else:
            log("Kunden-Seite", "FEHLER", f"Seite nicht geladen - URL: {page.url}", sp)

        # ============================================================
        # TEST: EINSTELLUNGEN
        # ============================================================
        print("\n=== TEST: EINSTELLUNGEN ===")
        page.goto(f"{BASE_URL}/pages/settings.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = s(page, "24_settings_page")
        sf(page, "24_settings_fullpage")
        print(f"  Settings URL: {page.url}")

        page_text = page.text_content("body")
        print(f"  Page content (first 500): {page_text[:500]}")

        if "settings" in page.url.lower() or "einstellung" in page.url.lower():
            log("Einstellungen: Seite", "OK", f"URL: {page.url}")
        elif "einstellung" in page_text.lower() or "cache" in page_text.lower():
            log("Einstellungen: Seite", "OK", f"Content hat Einstellungen-Text")
        else:
            log("Einstellungen: Seite", "FEHLER", f"Seite nicht geladen: {page.url}", sp)

        # Cache leeren
        cache_btn = page.locator("button:has-text('Cache'), button:has-text('cache'), button:has-text('leeren'), button:has-text('Leeren'), button:has-text('Daten')").first
        if cache_btn.count() > 0 and cache_btn.is_visible():
            log("Einstellungen: Cache-leeren", "OK", f"Button sichtbar: '{cache_btn.text_content().strip()}'")
        elif "cache" in page_text.lower():
            # Find all buttons
            btns = page.locator("button").all()
            for btn in btns:
                try:
                    txt = btn.text_content().strip()
                    print(f"    Button: '{txt}'")
                except:
                    pass
            log("Einstellungen: Cache-leeren", "OK", "Cache-Text vorhanden")
        else:
            log("Einstellungen: Cache-leeren", "FEHLER", "Kein Cache-Button/Text", sp)

        # Google Kalender URL
        all_inputs = page.locator("input, textarea").all()
        print(f"  Input elements: {len(all_inputs)}")
        for inp in all_inputs:
            try:
                name = inp.get_attribute("name") or ""
                iid = inp.get_attribute("id") or ""
                placeholder = inp.get_attribute("placeholder") or ""
                itype = inp.get_attribute("type") or ""
                val = inp.input_value()[:50] if itype != "password" else "***"
                print(f"    Input name='{name}' id='{iid}' type='{itype}' placeholder='{placeholder}' value='{val}'")
            except:
                pass

        gcal_found = False
        for inp in all_inputs:
            try:
                name = (inp.get_attribute("name") or "").lower()
                iid = (inp.get_attribute("id") or "").lower()
                placeholder = (inp.get_attribute("placeholder") or "").lower()
                if any(kw in name + iid + placeholder for kw in ["google", "kalender", "calendar", "gcal", "ical"]):
                    log("Einstellungen: Google-Kalender-URL", "OK", f"Input gefunden: name='{name}' id='{iid}'")
                    gcal_found = True
                    break
            except:
                pass

        if not gcal_found:
            if "google" in page_text.lower() or "kalender" in page_text.lower() or "calendar" in page_text.lower():
                log("Einstellungen: Google-Kalender-URL", "OK", "Kalender-Text auf Seite vorhanden")
            else:
                log("Einstellungen: Google-Kalender-URL", "FEHLER", "Weder Input noch Text gefunden", sp)

        # ============================================================
        # TEST: ZURUECK-BUTTON (Start -> Termine -> Termin-Detail -> <-)
        # ============================================================
        print("\n=== TEST: ZURUECK-BUTTON ===")
        # Go to Start first
        page.goto(f"{BASE_URL}/index.html", wait_until="networkidle", timeout=10000)
        time.sleep(1)

        # Click Termine in bottom nav
        page.locator("a[href='pages/termine.html'], a[href*='termine']").first.click()
        time.sleep(2)
        page.wait_for_load_state("networkidle", timeout=5000)
        print(f"  At Termine: {page.url}")
        sp = s(page, "25_at_termine")

        # Click on a calendar event
        event = page.locator(".calendar-event, .time-slot, [class*='event']").first
        if event.count() > 0 and event.is_visible():
            event.click()
            time.sleep(2)
            sp = s(page, "26_event_clicked")
            event_url = page.url
            print(f"  After event click: {event_url}")

            # Check if a modal/overlay appeared or if we navigated
            modal = page.locator(".modal:visible, .overlay:visible, [class*='modal']:visible, [class*='detail']:visible, [class*='popup']:visible").first
            if modal.count() > 0:
                print(f"  Modal/overlay is visible")
                # Look for close/back button in modal
                close = page.locator(".modal button:has-text('×'), .modal button:has-text('Schließen'), .close-btn, button:has-text('×'), button[class*='close']").first
                if close.count() > 0:
                    close.click()
                    time.sleep(1)
                    sp = s(page, "27_after_modal_close")
                    if "termine" in page.url.lower():
                        log("Zurueck-Button (Modal)", "OK", f"Zurueck bei Termine: {page.url}", sp)
                    else:
                        log("Zurueck-Button (Modal)", "FEHLER", f"URL nach Schliessen: {page.url}", sp)
                else:
                    log("Zurueck-Button (Modal)", "FEHLER", "Kein Schliessen-Button im Modal", sp)
            else:
                # We navigated - look for back button
                back = page.locator("button:has-text('←'), a:has-text('←'), .back-btn, [class*='back']").first
                if back.count() > 0 and back.is_visible():
                    back_text = back.text_content().strip()
                    print(f"  Found back button: '{back_text}'")
                    back.click()
                    time.sleep(1.5)
                    sp = s(page, "27_after_back")
                    after_url = page.url
                    print(f"  After back: {after_url}")

                    if "termine" in after_url.lower():
                        log("Zurueck-Button", "OK", f"Korrekt bei Termine: {after_url}", sp)
                    elif "index" in after_url.lower() or after_url == BASE_URL + "/":
                        log("Zurueck-Button", "FEHLER", f"FALSCH bei Start statt Termine: {after_url}", sp)
                    else:
                        log("Zurueck-Button", "OK", f"URL: {after_url}", sp)
                else:
                    log("Zurueck-Button", "FEHLER", "Kein Zurueck-Button gefunden", sp)
        else:
            # No calendar events visible - try clicking a different element
            log("Zurueck-Button", "FEHLER", "Kein Kalender-Event zum Klicken", sp)

        # ============================================================
        # TEST: Leistung Vorausfuellung pruefen (->L mit Parametern)
        # ============================================================
        print("\n=== TEST: LEISTUNG VORAUSFUELLUNG ===")
        # Navigate directly to leistung with parameters (like ->L does)
        page.goto(f"{BASE_URL}/pages/leistung.html?kundeId=22&datum=2026-04-16&von=08:45&bis=10:15",
                  wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = s(page, "28_leistung_prefilled")

        # Check if form is pre-filled
        try:
            kunde_field = page.locator("input[name*='kunde'], select[name*='kunde'], #kundeSelect, #kunde").first
            if kunde_field.count() > 0:
                val = kunde_field.input_value() if kunde_field.evaluate("el => el.tagName") == "INPUT" else kunde_field.locator("option:checked").text_content()
                print(f"  Kunde field: '{val}'")
                if val and len(val) > 0:
                    log("Leistung Vorausfuellung: Kunde", "OK", f"Wert: '{val}'")
                else:
                    log("Leistung Vorausfuellung: Kunde", "FEHLER", "Kunde-Feld leer", sp)

            datum_field = page.locator("input[name*='datum'], input[type='date']").first
            if datum_field.count() > 0:
                val = datum_field.input_value()
                print(f"  Datum field: '{val}'")
                if val and "2026" in val:
                    log("Leistung Vorausfuellung: Datum", "OK", f"Wert: '{val}'")
                else:
                    log("Leistung Vorausfuellung: Datum", "FEHLER", f"Datum nicht korrekt: '{val}'", sp)

            von_field = page.locator("input[name*='von'], input[name*='beginn'], input[name*='start']").first
            bis_field = page.locator("input[name*='bis'], input[name*='ende'], input[name*='end']").first
            if von_field.count() > 0 and bis_field.count() > 0:
                von_val = von_field.input_value()
                bis_val = bis_field.input_value()
                print(f"  Von: '{von_val}', Bis: '{bis_val}'")
                if von_val and bis_val:
                    log("Leistung Vorausfuellung: Zeiten", "OK", f"Von: {von_val}, Bis: {bis_val}")
                else:
                    log("Leistung Vorausfuellung: Zeiten", "FEHLER", f"Zeiten leer: von='{von_val}' bis='{bis_val}'", sp)
        except Exception as e:
            log("Leistung Vorausfuellung", "FEHLER", str(e), sp)

        # ============================================================
        # TEST: Fahrten Vorausfuellung pruefen (->km mit Parametern)
        # ============================================================
        print("\n=== TEST: FAHRTEN VORAUSFUELLUNG ===")
        page.goto(f"{BASE_URL}/pages/fahrten.html?kundeId=31&datum=2026-04-14",
                  wait_until="networkidle", timeout=10000)
        time.sleep(2)
        sp = s(page, "29_fahrten_prefilled")

        page_text = page.text_content("body")
        print(f"  Fahrten page content (300): {page_text[:300]}")

        # Check if address is pre-filled
        address_inputs = page.locator("input[name*='ziel'], input[name*='adresse'], input[name*='destination'], input[value*='Hattingen'], input[value*='Straße'], input[value*='straße']").all()
        if address_inputs:
            for ai in address_inputs:
                val = ai.input_value()
                print(f"  Address input: '{val}'")
            log("Fahrten Vorausfuellung: Adresse", "OK", "Adress-Input gefunden")
        elif any(kw in page_text for kw in ["Hattingen", "Straße", "straße"]):
            log("Fahrten Vorausfuellung: Adresse", "OK", "Adresse im Text")
        else:
            log("Fahrten Vorausfuellung: Adresse", "FEHLER", "Keine Adresse vorausgefuellt", sp)

        # ============================================================
        # TEST: Rechnungs-Overlay Details
        # ============================================================
        print("\n=== TEST: RECHNUNGS-OVERLAY DETAILS ===")
        page.goto(f"{BASE_URL}/pages/leistung.html", wait_until="networkidle", timeout=10000)
        time.sleep(2)

        re_btn = page.locator("button:has-text('RE erstellen'), a:has-text('RE erstellen')").first
        if re_btn.count() > 0 and re_btn.is_visible():
            re_btn.click()
            time.sleep(2)
            sp = s(page, "30_re_overlay")

            # Check overlay content
            overlay = page.locator("#rechnungDetailOverlay, .modal, [class*='overlay']").first
            if overlay.count() > 0:
                overlay_text = overlay.text_content()
                print(f"  Overlay content: {overlay_text[:500]}")

                # Check for key elements
                checks = {
                    "Empfaenger": "empfänger" in overlay_text.lower() or "rechnungsempfänger" in overlay_text.lower(),
                    "Betrag": "betrag" in overlay_text.lower() or "€" in overlay_text,
                    "Lexoffice-Button": "lexoffice" in overlay_text.lower(),
                    "Abbrechen-Button": "abbrechen" in overlay_text.lower(),
                }
                for check_name, result in checks.items():
                    log(f"RE-Overlay: {check_name}", "OK" if result else "FEHLER",
                        "Vorhanden" if result else "Nicht gefunden", sp)

                # Close overlay
                close_btn = page.locator("#rechnungDetailOverlay button:has-text('Abbrechen'), #rechnungDetailOverlay button:has-text('×'), #rechnungDetailOverlay .close, button:has-text('Abbrechen')").first
                if close_btn.count() > 0:
                    close_btn.click()
                    time.sleep(1)
                    print("  Overlay geschlossen")
            else:
                log("RE-Overlay", "FEHLER", "Overlay nicht gefunden nach Klick", sp)
        else:
            log("RE-Overlay", "FEHLER", "RE erstellen Button nicht gefunden")

        # ============================================================
        # TEST: Logout-Button
        # ============================================================
        print("\n=== TEST: LOGOUT-BUTTON ===")
        page.goto(f"{BASE_URL}/index.html", wait_until="networkidle", timeout=10000)
        time.sleep(1)
        logout_btn = page.locator("button:has-text('⏻'), button:has-text('Logout'), button:has-text('Abmelden'), .logout, #logoutBtn").first
        if logout_btn.count() > 0 and logout_btn.is_visible():
            log("Logout-Button", "OK", f"Button sichtbar: '{logout_btn.text_content().strip()}'")
        else:
            log("Logout-Button", "FEHLER", "Nicht gefunden")

        # ============================================================
        # TEST: Warning banner clickable
        # ============================================================
        print("\n=== TEST: WARNING-BANNER ===")
        warning = page.locator("a[href*='filter=offen'], [class*='warning'], [class*='alert'] a").first
        if warning.count() > 0 and warning.is_visible():
            warning.click()
            time.sleep(2)
            sp = s(page, "31_warning_link")
            log("Warning-Banner Link", "OK", f"URL: {page.url}", sp)
        else:
            log("Warning-Banner Link", "FEHLER", "Nicht gefunden/klickbar")

        # ============================================================
        # CONSOLE ERRORS
        # ============================================================
        unique_errors = list(set(console_errors))
        if unique_errors:
            print(f"\n=== UNIQUE CONSOLE ERRORS ({len(unique_errors)}) ===")
            for err in unique_errors:
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
