"""Lexoffice REST-Client — Firmenprofil + Kontakte."""

import httpx
import asyncio
import sqlite3
from fastapi import HTTPException

LEXOFFICE_BASE = "https://api.lexoffice.io/v1"


def _get_api_key(db: sqlite3.Connection) -> str:
    """API-Key aus Mandanten-Settings lesen."""
    row = db.execute(
        "SELECT value FROM settings WHERE key = ?", ("lexoffice_api_key",)
    ).fetchone()
    if not row or not row["value"]:
        raise HTTPException(400, "Lexoffice API-Key nicht konfiguriert (Einstellungen)")
    return row["value"]


async def fetch_profile(db: sqlite3.Connection) -> dict:
    """Firmenprofil von Lexoffice abrufen (GET /v1/profile)."""
    api_key = _get_api_key(db)

    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(
            f"{LEXOFFICE_BASE}/profile",
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
        )

    if res.status_code == 401:
        raise HTTPException(401, "Lexoffice API-Key ungueltig")
    if res.status_code == 429:
        raise HTTPException(429, "Lexoffice Rate-Limit erreicht, bitte kurz warten")
    if res.status_code != 200:
        raise HTTPException(502, f"Lexoffice-Fehler: {res.status_code}")

    profile = res.json()

    # Lexoffice-Profil auf unser Firma-Schema mappen
    firma = {}
    firma["name"] = profile.get("companyName", "")

    # Adresse
    addr = profile.get("businessAddress", {})
    firma["strasse"] = addr.get("street", "")
    firma["plz"] = addr.get("zip", "")
    firma["ort"] = addr.get("city", "")

    # Inhaber aus created.userName (falls vorhanden)
    created = profile.get("created", {})
    if created.get("userName"):
        firma["inhaber"] = created["userName"]

    # Kontakt
    firma["telefon"] = profile.get("phoneNumber", "")
    firma["email"] = profile.get("email") or created.get("userEmail", "")

    # Steuerdaten
    firma["steuernummer"] = profile.get("taxNumber", "")

    # Bankverbindung (erstes Konto)
    bank_accounts = profile.get("bankAccounts", [])
    if bank_accounts:
        ba = bank_accounts[0]
        firma["iban"] = ba.get("iban", "")
        firma["bic"] = ba.get("bic", "")
        firma["bank"] = ba.get("bankName", "")

    # Kleinunternehmer
    firma["kleinunternehmer"] = profile.get("smallBusiness", False)

    return firma


async def cancel_invoice(
    db: sqlite3.Connection,
    lexoffice_invoice_id: str,
    grund: str | None = None,
) -> dict:
    """Rechnung in Lex stornieren — über Gutschrift (POST /credit-notes?finalize=true).

    GoBD-konformer Weg: Original-Rechnung bleibt unverändert, eine Gutschrift mit
    Verweis auf die Original-UUID wird erzeugt. Lex bucht beide gegen.

    Returns dict mit credit-note-id, voucherNumber, voucherDate.
    """
    api_key = _get_api_key(db)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        # Original holen (Adresse, Posten, Steuer-/Versandbedingungen)
        orig_res = await client.get(
            f"{LEXOFFICE_BASE}/invoices/{lexoffice_invoice_id}",
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
        )
        if orig_res.status_code == 401:
            raise HTTPException(401, "Lexoffice API-Key ungueltig")
        if orig_res.status_code == 404:
            raise HTTPException(404, "Rechnung in Lexoffice nicht gefunden")
        if orig_res.status_code != 200:
            raise HTTPException(502, f"Lexoffice: Original nicht abrufbar ({orig_res.status_code})")
        orig = orig_res.json()

        orig_voucher_nr = orig.get("voucherNumber") or lexoffice_invoice_id
        introduction = f"Stornogutschrift zur Rechnung {orig_voucher_nr}"
        if grund:
            introduction += f". Grund: {grund}"

        # Gutschrift-Body — Posten und Konditionen 1:1 vom Original übernehmen
        from datetime import datetime, timezone
        voucher_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000+02:00")

        body = {
            "voucherDate": voucher_date,
            "address": orig.get("address", {}),
            "lineItems": orig.get("lineItems", []),
            "totalPrice": {"currency": (orig.get("totalPrice") or {}).get("currency", "EUR")},
            "taxConditions": orig.get("taxConditions", {"taxType": "net"}),
            "shippingConditions": orig.get("shippingConditions"),
            "title": "Stornorechnung",
            "introduction": introduction,
            "remark": orig.get("remark", ""),
            "relatedVouchers": [
                {"id": lexoffice_invoice_id, "voucherType": "invoice"}
            ],
        }
        # None-Werte raus (Lex meckert sonst)
        body = {k: v for k, v in body.items() if v is not None}

        res = await client.post(
            f"{LEXOFFICE_BASE}/credit-notes?finalize=true",
            headers=headers,
            json=body,
        )

        if res.status_code == 401:
            raise HTTPException(401, "Lexoffice API-Key ungueltig")
        if res.status_code == 429:
            raise HTTPException(429, "Lexoffice Rate-Limit, bitte kurz warten")
        if res.status_code not in (200, 201):
            try:
                detail = res.json()
            except Exception:
                detail = res.text[:500]
            raise HTTPException(502, f"Lexoffice-Storno fehlgeschlagen ({res.status_code}): {detail}")

        created = res.json()  # {"id":"...","resourceUri":"...","createdDate":"...","updatedDate":"...","version":0}
        credit_id = created.get("id")
        if not credit_id:
            raise HTTPException(502, "Lexoffice: Keine credit-note-ID in Antwort")

        # Voucher-Number nachladen (Lex liefert sie erst nach Finalisierung)
        nr_res = await client.get(
            f"{LEXOFFICE_BASE}/credit-notes/{credit_id}",
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
        )
        voucher_number = ""
        if nr_res.status_code == 200:
            voucher_number = nr_res.json().get("voucherNumber", "")

    return {
        "id": credit_id,
        "voucherNumber": voucher_number,
        "voucherDate": voucher_date,
    }


async def fetch_contacts(db: sqlite3.Connection) -> list[dict]:
    """Alle Kontakte von Lexoffice abrufen (GET /v1/contacts, paginiert)."""
    api_key = _get_api_key(db)
    contacts = []
    page = 0

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            res = await client.get(
                f"{LEXOFFICE_BASE}/contacts",
                params={"page": page, "size": 100, "customer": "true"},
                headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            )
            if res.status_code == 401:
                raise HTTPException(401, "Lexoffice API-Key ungueltig")
            if res.status_code == 429:
                raise HTTPException(429, "Lexoffice Rate-Limit erreicht, bitte kurz warten")
            if res.status_code != 200:
                raise HTTPException(502, f"Lexoffice-Fehler: {res.status_code}")

            data = res.json()
            for c in data.get("content", []):
                contact = _map_contact(c)
                if contact:
                    contacts.append(contact)

            if data.get("last", True):
                break
            page += 1

    return contacts


def _map_contact(c: dict) -> dict | None:
    """Lexoffice-Kontakt auf Kunden-Schema mappen."""
    # Firma oder Person?
    person = c.get("person") or {}
    company = c.get("company") or {}

    if person:
        name = f"{person.get('lastName', '')}".strip()
        vorname = f"{person.get('firstName', '')}".strip()
        if not name:
            return None
    elif company:
        name = company.get("name", "").strip()
        vorname = company.get("contactPersons", [{}])[0].get("firstName", "") if company.get("contactPersons") else ""
        if not name:
            return None
    else:
        return None

    result = {
        "lexoffice_id": c.get("id", ""),
        "name": name,
        "vorname": vorname,
    }

    # Adressen (erste Rechnungsadresse oder Lieferadresse)
    addresses = c.get("addresses", {})
    addr_list = addresses.get("billing", []) or addresses.get("shipping", [])
    if addr_list:
        addr = addr_list[0]
        result["strasse"] = addr.get("street", "")
        result["plz"] = addr.get("zip", "")
        result["ort"] = addr.get("city", "")

    # Kontaktdaten
    emails = c.get("emailAddresses", {})
    if emails.get("business"):
        result["email"] = emails["business"][0]
    elif emails.get("private"):
        result["email"] = emails["private"][0]

    phones = c.get("phoneNumbers", {})
    if phones.get("mobile"):
        result["telefon"] = phones["mobile"][0]
    elif phones.get("business"):
        result["telefon"] = phones["business"][0]
    elif phones.get("private"):
        result["telefon"] = phones["private"][0]

    if phones.get("fax"):
        result["pflegekasse_fax"] = phones["fax"][0]

    return result
