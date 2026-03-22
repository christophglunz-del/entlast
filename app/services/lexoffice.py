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

    return result
