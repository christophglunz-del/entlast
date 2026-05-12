"""Google-OAuth-Setup für Calendar-Rückwärts-Sync.

Endpoints:
- POST /api/v1/gcal/credentials → Client-ID + Secret speichern
- GET  /api/v1/gcal/oauth/start → Redirect zur Google-Consent
- GET  /api/v1/gcal/oauth/callback → Tausch Code → Refresh-Token
- GET  /api/v1/gcal/status → Verbindungs-Status
- GET  /api/v1/gcal/calendars → Verfügbare Kalender (Auswahl)
- POST /api/v1/gcal/calendar → Aktiven Kalender setzen
- POST /api/v1/gcal/disconnect → Refresh-Token löschen
"""

import logging
import sqlite3
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.auth import get_current_user, get_db
from app.services import google_calendar

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gcal", tags=["gcal"])


def _redirect_uri(request: Request) -> str:
    """Robuste Redirect-URI aus Request bauen."""
    # Trust X-Forwarded-Proto/-Host (steht im nginx vor uns)
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.url.netloc
    return f"{proto}://{host}/api/v1/gcal/oauth/callback"


class CredentialsRequest(BaseModel):
    client_id: str
    client_secret: str


@router.post("/credentials")
async def set_credentials(
    req: CredentialsRequest,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Client-ID + Secret aus Google-Cloud-Console speichern."""
    if not req.client_id or not req.client_secret:
        raise HTTPException(400, "Client-ID und Secret erforderlich")
    google_calendar.set_credentials(db, req.client_id.strip(), req.client_secret.strip())
    return {"ok": True}


@router.get("/oauth/start")
async def oauth_start(
    request: Request,
    return_to: str | None = None,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Generiert Google-OAuth-Consent-URL und leitet dorthin um."""
    client_id = google_calendar.get_client_id(db)
    if not client_id:
        raise HTTPException(400, "Client-ID nicht konfiguriert (Einstellungen)")

    params = {
        "client_id": client_id,
        "redirect_uri": _redirect_uri(request),
        "response_type": "code",
        "scope": google_calendar.SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": return_to or "/pages/settings.html",
    }
    url = f"{google_calendar.GOOGLE_AUTH_URI}?{urlencode(params)}"
    return RedirectResponse(url, status_code=302)


@router.get("/oauth/callback")
async def oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: sqlite3.Connection = Depends(get_db),
):
    """Google ruft hier zurück mit ?code=... → Tausch gegen Refresh-Token."""
    if error:
        logger.warning("Google OAuth Fehler: %s", error)
        return RedirectResponse(f"/pages/settings.html?gcal_error={error}", status_code=302)
    if not code:
        raise HTTPException(400, "Kein code-Parameter")

    redirect_uri = _redirect_uri(request)
    try:
        token_data = await google_calendar.exchange_code_for_token(db, code, redirect_uri)
    except HTTPException as e:
        return RedirectResponse(
            f"/pages/settings.html?gcal_error={e.detail[:100]}", status_code=302
        )

    refresh_token = token_data.get("refresh_token")
    if not refresh_token:
        return RedirectResponse(
            "/pages/settings.html?gcal_error=Kein+refresh_token+erhalten+(eventuell+schon+autorisiert,+bei+Google+Zugriff+widerrufen+und+neu+verbinden)",
            status_code=302,
        )

    google_calendar.set_refresh_token(db, refresh_token)
    target = state if state and state.startswith("/") else "/pages/settings.html"
    return RedirectResponse(f"{target}?gcal_ok=1", status_code=302)


@router.get("/status")
async def status(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Verbindungs-Status für UI-Anzeige."""
    return {
        "client_id_gesetzt": bool(google_calendar.get_client_id(db)),
        "verbunden": google_calendar.ist_verbunden(db),
        "calendar_id": google_calendar.get_calendar_id(db),
    }


@router.get("/calendars")
async def calendars(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Verfügbare Google-Kalender — für Auswahl-Dropdown im Settings-UI."""
    if not google_calendar.ist_verbunden(db):
        raise HTTPException(400, "Nicht verbunden")
    return await google_calendar.list_calendars(db)


class CalendarSelectRequest(BaseModel):
    calendar_id: str


@router.post("/calendar")
async def set_calendar(
    req: CalendarSelectRequest,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Ziel-Kalender für Push setzen."""
    google_calendar.set_calendar_id(db, req.calendar_id)
    return {"ok": True}


@router.post("/disconnect")
async def disconnect(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Refresh-Token löschen — Verbindung trennen."""
    google_calendar.disconnect(db)
    return {"ok": True}


@router.post("/sync-fehlende")
async def sync_fehlende(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Alle entlast-Termine ab heute, die keine google_uid haben,
    nachträglich nach Google pushen. Best-effort, fail-soft."""
    if not google_calendar.ist_verbunden(db):
        raise HTTPException(400, "Nicht verbunden")

    rows = db.execute(
        """SELECT id, kunde_id, datum, von, bis, titel, notiz,
                  wiederkehrend, wiederholungs_muster
           FROM termine
           WHERE (google_uid IS NULL OR google_uid = '')
             AND datum >= date('now')
           ORDER BY datum, von""",
    ).fetchall()

    erfolg = 0
    fehler = 0
    for row in rows:
        row_dict = dict(row)
        # Kundenname holen
        kunde_name = None
        if row_dict.get("kunde_id"):
            k = db.execute(
                "SELECT name, vorname FROM kunden WHERE id = ?",
                (row_dict["kunde_id"],),
            ).fetchone()
            if k:
                kunde_name = " ".join(p for p in [k.get("vorname"), k.get("name")] if p) or None

        try:
            google_uid = await google_calendar.create_event(db, row_dict, kunde_name)
            db.execute("UPDATE termine SET google_uid = ? WHERE id = ?",
                       (google_uid, row_dict["id"]))
            db.commit()
            erfolg += 1
        except Exception as e:
            logger.warning("Sync-Fehlende: Termin %s fehlgeschlagen: %s",
                           row_dict["id"], e)
            fehler += 1

    return {
        "ok": True,
        "geprüft": len(rows),
        "erfolg": erfolg,
        "fehler": fehler,
    }
