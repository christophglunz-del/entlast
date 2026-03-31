"""LetterXpress REST-Client — Briefversand ueber letterxpress.de API v3.

API-Doku: http://api.letterxpress.de/v3/
Auth: JSON-Body mit auth-Objekt (username, apikey, mode).
"""

import base64
import hashlib
import logging
import sqlite3

import httpx
from fastapi import HTTPException

logger = logging.getLogger("entlast.letterxpress")

LETTERXPRESS_BASE = "https://api.letterxpress.de/v3"


def _get_credentials(db: sqlite3.Connection) -> tuple[str, str]:
    """LetterXpress User + API-Key aus Mandanten-Settings lesen."""
    row_user = db.execute(
        "SELECT value FROM settings WHERE key = ?", ("letterxpress_user",)
    ).fetchone()
    row_key = db.execute(
        "SELECT value FROM settings WHERE key = ?", ("letterxpress_key",)
    ).fetchone()

    user = row_user["value"] if row_user else None
    api_key = row_key["value"] if row_key else None

    if not user or not api_key:
        raise HTTPException(
            400,
            "LetterXpress Zugangsdaten nicht konfiguriert (Einstellungen: letterxpress_user / letterxpress_key)",
        )
    return user, api_key


def _auth_obj(user: str, api_key: str, mode: str = "live") -> dict:
    """Auth-Objekt fuer jeden LetterXpress-Request."""
    return {
        "username": user,
        "apikey": api_key,
        "mode": mode,
    }


async def _request(
    db: sqlite3.Connection,
    endpoint: str,
    method: str = "GET",
    body: dict | None = None,
    mode: str = "live",
) -> dict:
    """Basis-Request an LetterXpress API.

    LetterXpress erwartet immer einen JSON-Body mit auth-Objekt,
    auch bei GET-Requests.
    """
    user, api_key = _get_credentials(db)

    url = f"{LETTERXPRESS_BASE}/{endpoint}"
    request_body = {
        "auth": _auth_obj(user, api_key, mode),
        **(body or {}),
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.request(
            method,
            url,
            json=request_body,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

    try:
        data = response.json()
    except Exception:
        logger.error(f"LetterXpress: Keine JSON-Antwort ({response.status_code}): {response.text[:300]}")
        raise HTTPException(502, "LetterXpress: Ungueltige Antwort")

    # LetterXpress liefert status im Body (200 oder 'OK' = Erfolg)
    status = data.get("status")
    if status and status not in (200, "200", "OK"):
        msg = data.get("message", f"Fehler {status}")
        logger.error(f"LetterXpress API-Fehler: {msg}")
        raise HTTPException(502, f"LetterXpress: {msg}")

    return data


async def send_brief(
    db: sqlite3.Connection,
    pdf_bytes: bytes,
    opts: dict | None = None,
) -> dict:
    """Brief ueber LetterXpress versenden.

    Args:
        db: Datenbankverbindung (fuer Credentials aus settings)
        pdf_bytes: PDF-Inhalt als Bytes
        opts: Optionen:
            - farbe (bool): Farbdruck, Default False (s/w)
            - duplex (bool): Doppelseitig, Default True
            - versandart (str): 'national' oder 'international', Default 'national'
            - mode (str): 'test' oder 'live', Default 'live'

    Returns:
        LetterXpress API-Antwort mit Job-ID
    """
    if opts is None:
        opts = {}

    # PDF in Base64 kodieren
    pdf_base64 = base64.b64encode(pdf_bytes).decode("ascii")

    # MD5-Checksum des Base64-Strings (Pflichtfeld laut API-Doku)
    checksum = hashlib.md5(pdf_base64.encode("ascii")).hexdigest()

    letter = {
        "base64_file": pdf_base64,
        "base64_file_checksum": checksum,
        "specification": {
            "color": "4" if opts.get("farbe") else "1",
            "mode": "duplex" if opts.get("duplex", True) else "simplex",
            "shipping": opts.get("versandart", "national"),
        },
    }

    mode = opts.get("mode", "live")

    logger.info(f"LetterXpress: Sende Brief ({len(pdf_bytes)} Bytes, farbe={opts.get('farbe', False)}, duplex={opts.get('duplex', True)})")

    result = await _request(db, "printjobs", "POST", {"letter": letter}, mode)

    logger.info(f"LetterXpress: Brief gesendet, Antwort: {result.get('message', 'OK')}")
    return result


async def get_guthaben(db: sqlite3.Connection) -> dict:
    """Guthaben bei LetterXpress abfragen.

    Returns:
        API-Antwort mit Guthaben-Informationen
    """
    return await _request(db, "balance", "GET")


async def get_job_status(db: sqlite3.Connection, job_id: int) -> dict:
    """Status eines LetterXpress-Jobs abfragen.

    Args:
        job_id: LetterXpress Job-ID

    Returns:
        API-Antwort mit Job-Status
    """
    return await _request(db, f"printjobs/{job_id}", "GET")
