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

    # Kontakt
    firma["telefon"] = profile.get("phoneNumber", "")
    firma["email"] = profile.get("email", "")

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
