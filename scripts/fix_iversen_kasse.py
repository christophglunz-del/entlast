#!/usr/bin/env python3
"""
Einmal-Korrektur: Pflegekasse des Kunden Iversen auf "BKK Novitas" setzen.

Läuft gegen die Live-API von entlast.de mit DEINEM Login — das Passwort wird
interaktiv abgefragt (getpass) und nirgends gespeichert. Vor dem Schreiben wird
der gefundene Kunde angezeigt und eine Bestätigung verlangt.

Aufruf:
    python3 scripts/fix_iversen_kasse.py
    # oder anderer Server / Suchbegriff:
    BASE_URL=https://entlast.de python3 scripts/fix_iversen_kasse.py
"""
import json
import os
import sys
import getpass
import urllib.request
import urllib.error
import http.cookiejar

BASE_URL = os.environ.get("BASE_URL", "https://entlast.de").rstrip("/")
KUNDE_SUCHE = os.environ.get("KUNDE", "iversen").lower()
KASSE_SUCHE = os.environ.get("KASSE", "novitas").lower()

_cj = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_cj))


def _req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE_URL + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with _opener.open(req, timeout=20) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, (json.loads(raw) if raw.startswith(("{", "[")) else raw)


def main():
    print(f"Server: {BASE_URL}")
    user = input("Benutzername: ").strip()
    pw = getpass.getpass("Passwort: ")

    status, _ = _req("POST", "/auth/login", {"username": user, "password": pw})
    if status != 200:
        print(f"❌ Login fehlgeschlagen (HTTP {status}).")
        sys.exit(1)
    print("✓ Eingeloggt.")

    # 1) Exakten Kassennamen aus den Stammdaten holen (damit Fax-Nachschlag etc. matcht)
    status, kassen = _req("GET", "/api/v1/pflegekassen")
    if status != 200 or not isinstance(kassen, list):
        print(f"❌ Pflegekassen konnten nicht geladen werden (HTTP {status}).")
        sys.exit(1)
    treffer = [k for k in kassen if KASSE_SUCHE in (k.get("name") or "").lower()]
    if not treffer:
        print(f"❌ Keine Kasse mit '{KASSE_SUCHE}' in den Stammdaten gefunden.")
        print("   Vorhandene Kassen:")
        for k in kassen:
            print(f"     - {k.get('name')}")
        print("   → Lege 'BKK Novitas' zuerst unter Einstellungen/Pflegekassen an, dann erneut starten.")
        sys.exit(1)
    if len(treffer) > 1:
        print("⚠ Mehrere passende Kassen — bitte genauer (KASSE=... setzen):")
        for k in treffer:
            print(f"     - {k.get('name')}")
        sys.exit(1)
    ziel_kasse = treffer[0]["name"]
    print(f"✓ Zielkasse aus Stammdaten: '{ziel_kasse}'")

    # 2) Kunden Iversen finden
    status, kunden = _req("GET", "/api/v1/kunden")
    if status != 200 or not isinstance(kunden, list):
        print(f"❌ Kunden konnten nicht geladen werden (HTTP {status}).")
        sys.exit(1)
    k_treffer = [k for k in kunden if KUNDE_SUCHE in (k.get("name") or "").lower()]
    if not k_treffer:
        print(f"❌ Kein Kunde mit '{KUNDE_SUCHE}' gefunden.")
        sys.exit(1)
    if len(k_treffer) > 1:
        print(f"⚠ Mehrere Kunden mit '{KUNDE_SUCHE}':")
        for k in k_treffer:
            print(f"     id={k['id']}  {k.get('vorname','')} {k.get('name','')}  (Kasse: {k.get('pflegekasse')})")
        print("   → Bitte KUNDE=... präziser setzen.")
        sys.exit(1)

    kunde = k_treffer[0]
    print("\nGefundener Kunde:")
    print(f"   id          : {kunde['id']}")
    print(f"   Name        : {kunde.get('vorname','')} {kunde.get('name','')}")
    print(f"   Kasse (alt) : {kunde.get('pflegekasse')}")
    print(f"   Kasse (neu) : {ziel_kasse}")

    if input("\nÄndern? [j/N]: ").strip().lower() not in ("j", "ja", "y", "yes"):
        print("Abgebrochen — nichts geändert.")
        sys.exit(0)

    status, resp = _req("PUT", f"/api/v1/kunden/{kunde['id']}", {"pflegekasse": ziel_kasse})
    if status == 200:
        print(f"✓ Erledigt. Kasse von {kunde.get('name')} ist jetzt '{resp.get('pflegekasse')}'.")
    else:
        print(f"❌ Fehler beim Speichern (HTTP {status}): {resp}")
        sys.exit(1)


if __name__ == "__main__":
    main()
