"""Sipgate Fax-Versand Service."""

import base64
import re
import httpx
import sqlite3
from fastapi import HTTPException

SIPGATE_BASE = "https://api.sipgate.com/v2"


def _get_sipgate_credentials(db: sqlite3.Connection) -> tuple[str, str, str]:
    """Token-ID, Token und Faxline-ID aus Settings laden."""
    token_id_row = db.execute(
        "SELECT value FROM settings WHERE key = ?", ("sipgate_token_id",)
    ).fetchone()
    token_row = db.execute(
        "SELECT value FROM settings WHERE key = ?", ("sipgate_token",)
    ).fetchone()
    faxline_row = db.execute(
        "SELECT value FROM settings WHERE key = ?", ("sipgate_faxline_id",)
    ).fetchone()

    token_id = token_id_row["value"] if token_id_row else None
    token = token_row["value"] if token_row else None
    faxline_id = (faxline_row["value"] if faxline_row else None) or "f0"

    if not token_id or not token:
        raise HTTPException(
            400, "Sipgate Zugangsdaten nicht konfiguriert (Einstellungen)"
        )

    return token_id, token, faxline_id


def normalize_fax_number(nummer: str) -> str:
    """Faxnummer normalisieren: Leerzeichen/Bindestriche entfernen, +49 Prefix."""
    if not nummer:
        return ""
    # Leerzeichen, Bindestriche, Schraegstriche, Klammern entfernen
    clean = re.sub(r"[\s\-/()]", "", nummer)
    # 00 am Anfang -> +
    if clean.startswith("00"):
        clean = "+" + clean[2:]
    # 0 am Anfang -> +49
    if clean.startswith("0"):
        clean = "+49" + clean[1:]
    # Falls kein + am Anfang, +49 voranstellen
    if not clean.startswith("+"):
        clean = "+49" + clean
    return clean


async def send_fax(
    db: sqlite3.Connection,
    fax_nummer: str,
    pdf_bytes: bytes,
    dateiname: str = "Rechnung.pdf",
) -> dict:
    """Fax ueber Sipgate API versenden.

    Args:
        db: Datenbankverbindung (fuer Credentials aus settings)
        fax_nummer: Faxnummer (wird automatisch normalisiert)
        pdf_bytes: PDF-Datei als Bytes
        dateiname: Dateiname fuer das PDF

    Returns:
        dict mit sessionId und success=True
    """
    token_id, token, faxline_id = _get_sipgate_credentials(db)

    # Faxnummer normalisieren
    recipient = normalize_fax_number(fax_nummer)
    if not recipient:
        raise HTTPException(400, "Keine gueltige Faxnummer angegeben")

    # PDF zu Base64 kodieren
    pdf_base64 = base64.b64encode(pdf_bytes).decode("utf-8")

    # Auth-Header (HTTP Basic)
    auth_string = base64.b64encode(f"{token_id}:{token}".encode()).decode("utf-8")

    body = {
        "faxlineId": faxline_id,
        "recipient": recipient,
        "filename": dateiname,
        "base64Content": pdf_base64,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            f"{SIPGATE_BASE}/sessions/fax",
            json=body,
            headers={
                "Authorization": f"Basic {auth_string}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

    if res.status_code == 401:
        raise HTTPException(401, "Sipgate Zugangsdaten ungueltig")
    if res.status_code == 402:
        raise HTTPException(402, "Sipgate: Kein ausreichendes Guthaben")
    if res.status_code == 403:
        raise HTTPException(403, "Sipgate: Zugriff verweigert (Faxline-Berechtigung pruefen)")

    # Sipgate antwortet mit 200 oder 202 bei Erfolg
    if res.status_code in (200, 202):
        text = res.text
        if text:
            data = res.json()
            data["success"] = True
            return data
        return {"success": True, "status": res.status_code}

    # Fehlerfall
    fehler = f"HTTP {res.status_code}"
    try:
        err_body = res.json()
        if err_body.get("message"):
            fehler += f": {err_body['message']}"
    except Exception:
        fehler += f": {res.reason_phrase}"
    raise HTTPException(502, f"Sipgate API-Fehler: {fehler}")


async def fax_status(db: sqlite3.Connection, session_id: str) -> dict:
    """Fax-Status bei Sipgate abfragen.

    Args:
        db: Datenbankverbindung (fuer Credentials)
        session_id: Session-ID vom Fax-Versand

    Returns:
        dict mit Status-Informationen
    """
    token_id, token, _ = _get_sipgate_credentials(db)
    auth_string = base64.b64encode(f"{token_id}:{token}".encode()).decode("utf-8")

    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(
            f"{SIPGATE_BASE}/history/{session_id}",
            headers={
                "Authorization": f"Basic {auth_string}",
                "Accept": "application/json",
            },
        )

    if res.status_code == 401:
        raise HTTPException(401, "Sipgate Zugangsdaten ungueltig")
    if res.status_code == 404:
        raise HTTPException(404, "Fax-Session nicht gefunden")
    if res.status_code != 200:
        raise HTTPException(502, f"Sipgate API-Fehler: HTTP {res.status_code}")

    return res.json()
