"""Router: Lexoffice-Synchronisation (Kunden + Rechnungen) + API-Proxy."""

import sqlite3
import asyncio
import logging
import time
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from app.auth import get_current_user, get_db

logger = logging.getLogger("entlast.lexoffice")

router = APIRouter(prefix="/lexoffice", tags=["lexoffice"])


@router.post("/sync-kunden")
async def sync_kunden(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Kunden von Lexoffice importieren/aktualisieren."""
    from app.services.lexoffice import fetch_contacts

    contacts = await fetch_contacts(db)

    neu = 0
    aktualisiert = 0
    unveraendert = 0

    for c in contacts:
        lex_id = c.get("lexoffice_id", "")
        if not lex_id:
            continue

        # Existiert der Kontakt schon?
        existing = db.execute(
            "SELECT id, name, vorname, strasse, plz, ort, telefon, email, pflegekasse_fax FROM kunden WHERE lexoffice_id = ?",
            (lex_id,),
        ).fetchone()

        if existing:
            # Pruefen ob sich etwas geaendert hat
            changed = False
            for field in ("name", "vorname", "strasse", "plz", "ort", "telefon", "email", "pflegekasse_fax"):
                if c.get(field) and c[field] != (existing.get(field) or ""):
                    changed = True
                    break

            if changed:
                db.execute(
                    """UPDATE kunden SET name=?, vorname=?, strasse=?, plz=?, ort=?, telefon=?, email=?,
                       pflegekasse_fax=COALESCE(?, pflegekasse_fax),
                       updated_at=datetime('now') WHERE lexoffice_id=?""",
                    (c.get("name", ""), c.get("vorname", ""), c.get("strasse", ""),
                     c.get("plz", ""), c.get("ort", ""), c.get("telefon", ""),
                     c.get("email", ""), c.get("pflegekasse_fax"), lex_id),
                )
                aktualisiert += 1
            else:
                unveraendert += 1
        else:
            # Neuen Kunden anlegen
            db.execute(
                """INSERT INTO kunden (name, vorname, strasse, plz, ort, telefon, email, pflegekasse_fax, lexoffice_id, kundentyp)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pflege')""",
                (c.get("name", ""), c.get("vorname", ""), c.get("strasse", ""),
                 c.get("plz", ""), c.get("ort", ""), c.get("telefon", ""),
                 c.get("email", ""), c.get("pflegekasse_fax"), lex_id),
            )
            neu += 1

    db.commit()

    msg = []
    if neu:
        msg.append(f"{neu} neu importiert")
    if aktualisiert:
        msg.append(f"{aktualisiert} aktualisiert")
    if unveraendert:
        msg.append(f"{unveraendert} unveraendert")

    summary = ", ".join(msg) if msg else "Keine Kontakte gefunden"
    logger.info(f"Lexoffice Kunden-Sync: {summary} (User: {user['username']})")

    return {
        "message": f"Lexoffice-Sync: {summary}",
        "neu": neu,
        "aktualisiert": aktualisiert,
        "unveraendert": unveraendert,
    }


# Rate-Limiter: max 2 Requests/Sekunde an Lexoffice
_last_request_time = 0.0
_rate_lock = asyncio.Lock()


@router.get("/proxy/{endpoint:path}")
async def lexoffice_proxy(
    endpoint: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Proxy fuer Lexoffice-API mit Rate-Limiting + Retry."""
    from app.services.lexoffice import _get_api_key, LEXOFFICE_BASE
    global _last_request_time

    api_key = _get_api_key(db)
    params = dict(request.query_params)
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}

    max_retries = 3
    for attempt in range(max_retries):
        # Rate-Limiting: min 500ms zwischen Requests
        async with _rate_lock:
            now = time.time()
            wait = 0.5 - (now - _last_request_time)
            if wait > 0:
                await asyncio.sleep(wait)
            _last_request_time = time.time()

        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.get(
                f"{LEXOFFICE_BASE}/{endpoint}",
                params=params,
                headers=headers,
            )

        if res.status_code == 429:
            # Retry nach Wartezeit
            wait_secs = 2 ** attempt
            logger.warning(f"Lexoffice 429 fuer {endpoint}, warte {wait_secs}s (Versuch {attempt + 1})")
            await asyncio.sleep(wait_secs)
            continue

        if res.status_code == 401:
            raise HTTPException(401, "Lexoffice API-Key ungueltig")
        if res.status_code >= 400:
            raise HTTPException(res.status_code, f"Lexoffice: {res.text[:200]}")

        return res.json()

    raise HTTPException(429, "Lexoffice Rate-Limit nach 3 Versuchen")
