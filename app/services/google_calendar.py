"""Google Calendar API v3 Client — Push entlast → Google.

Server-seitiger OAuth: Refresh-Token in settings (verschlüsselt).
Clients (Browser/PWA) machen keine Google-API-Calls — Push läuft via Backend.
"""

import time
import sqlite3
import logging
import httpx
from fastapi import HTTPException
from app.encryption import encrypt, decrypt

logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"
GOOGLE_AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
CAL_BASE = "https://www.googleapis.com/calendar/v3"
SCOPE = "https://www.googleapis.com/auth/calendar.events"

# Access-Token-Cache pro Mandant (in-memory)
_token_cache: dict[str, tuple[str, float]] = {}


# === Settings-Helper ===

def _settings_get(db: sqlite3.Connection, key: str) -> str | None:
    row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row and row["value"] else None


def _settings_set(db: sqlite3.Connection, key: str, value: str | None) -> None:
    if value is None:
        db.execute("DELETE FROM settings WHERE key = ?", (key,))
    else:
        db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
    db.commit()


def get_client_id(db: sqlite3.Connection) -> str | None:
    return _settings_get(db, "gcal_oauth_client_id")


def get_client_secret(db: sqlite3.Connection) -> str | None:
    enc = _settings_get(db, "gcal_oauth_client_secret_enc")
    return decrypt(enc) if enc else None


def get_refresh_token(db: sqlite3.Connection) -> str | None:
    enc = _settings_get(db, "gcal_oauth_refresh_token_enc")
    return decrypt(enc) if enc else None


def get_calendar_id(db: sqlite3.Connection) -> str:
    return _settings_get(db, "gcal_calendar_id") or "primary"


def set_credentials(db: sqlite3.Connection, client_id: str, client_secret: str) -> None:
    _settings_set(db, "gcal_oauth_client_id", client_id)
    _settings_set(db, "gcal_oauth_client_secret_enc", encrypt(client_secret))


def set_refresh_token(db: sqlite3.Connection, refresh_token: str) -> None:
    _settings_set(db, "gcal_oauth_refresh_token_enc", encrypt(refresh_token))
    _token_cache.clear()


def set_calendar_id(db: sqlite3.Connection, calendar_id: str) -> None:
    _settings_set(db, "gcal_calendar_id", calendar_id or "primary")


def disconnect(db: sqlite3.Connection) -> None:
    _settings_set(db, "gcal_oauth_refresh_token_enc", None)
    _token_cache.clear()


def ist_verbunden(db: sqlite3.Connection) -> bool:
    """True wenn alle drei Werte (Client-ID, Secret, Refresh-Token) gesetzt sind."""
    return bool(get_client_id(db) and get_client_secret(db) and get_refresh_token(db))


# === Token-Management ===

async def _get_access_token(db: sqlite3.Connection) -> str:
    """Frischen Access-Token holen (Refresh-Flow), mit 55-min-Cache."""
    cached = _token_cache.get("token")
    if cached and cached[1] > time.time():
        return cached[0]

    client_id = get_client_id(db)
    client_secret = get_client_secret(db)
    refresh_token = get_refresh_token(db)

    if not (client_id and client_secret and refresh_token):
        raise HTTPException(400, "Google Calendar nicht verbunden")

    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            GOOGLE_TOKEN_URI,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )

    if res.status_code != 200:
        logger.warning("Google Token-Refresh fehlgeschlagen: %s %s",
                       res.status_code, res.text[:200])
        raise HTTPException(
            500,
            "Google Calendar Autorisierung ungültig — bitte in Einstellungen neu verbinden.",
        )

    data = res.json()
    token = data["access_token"]
    # 55 min Cache (Google access_token läuft nach 60 min ab)
    _token_cache["token"] = (token, time.time() + 55 * 60)
    return token


# === OAuth-Code-Exchange (für initialen Setup) ===

async def exchange_code_for_token(
    db: sqlite3.Connection, code: str, redirect_uri: str
) -> dict:
    """Tauscht den OAuth-Code (vom Callback) gegen Access + Refresh Token."""
    client_id = get_client_id(db)
    client_secret = get_client_secret(db)
    if not (client_id and client_secret):
        raise HTTPException(400, "Client-ID/Secret nicht konfiguriert")

    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            GOOGLE_TOKEN_URI,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )

    if res.status_code != 200:
        logger.warning("Google Code-Exchange fehlgeschlagen: %s %s",
                       res.status_code, res.text[:300])
        raise HTTPException(
            400, f"Google Autorisierung fehlgeschlagen: {res.text[:200]}"
        )
    return res.json()


# === Termin → Event Mapping ===

_WT_MAP = {"Mo": "MO", "Di": "TU", "Mi": "WE", "Do": "TH",
           "Fr": "FR", "Sa": "SA", "So": "SU"}


def _termin_to_event(termin: dict, kunde_name: str | None = None) -> dict:
    """Mapping entlast-Termin-Dict → Google-Event-Resource.

    termin: dict mit datum, von, bis, titel, notiz, wiederkehrend, wiederholungs_muster
    """
    summary = termin.get("titel") or kunde_name or "Termin"
    description = termin.get("notiz") or ""
    datum = termin["datum"]  # YYYY-MM-DD
    von = termin.get("von")
    bis = termin.get("bis")

    event: dict = {
        "summary": summary,
        "description": description,
    }

    if von and bis:
        event["start"] = {"dateTime": f"{datum}T{von}:00", "timeZone": "Europe/Berlin"}
        event["end"] = {"dateTime": f"{datum}T{bis}:00", "timeZone": "Europe/Berlin"}
    elif von:
        # Nur Startzeit: Endzeit als +1h annehmen
        h, m = von.split(":")
        end_h = (int(h) + 1) % 24
        event["start"] = {"dateTime": f"{datum}T{von}:00", "timeZone": "Europe/Berlin"}
        event["end"] = {"dateTime": f"{datum}T{end_h:02d}:{m}:00", "timeZone": "Europe/Berlin"}
    else:
        # Ganztägig
        event["start"] = {"date": datum}
        event["end"] = {"date": datum}

    # Wiederholungs-Muster → RRULE
    if termin.get("wiederkehrend"):
        muster = termin.get("wiederholungs_muster")
        if isinstance(muster, str):
            import json
            try:
                muster = json.loads(muster)
            except Exception:
                muster = None
        if isinstance(muster, dict):
            wt = muster.get("wochentag")
            intervall = muster.get("intervall", 1)
            byday = _WT_MAP.get(wt)
            if byday:
                rrule = f"RRULE:FREQ=WEEKLY;INTERVAL={intervall};BYDAY={byday}"
                event["recurrence"] = [rrule]

    return event


# === CRUD ===

async def create_event(
    db: sqlite3.Connection, termin: dict, kunde_name: str | None = None
) -> str:
    """Termin in Google Calendar anlegen. Liefert die google-event-id."""
    token = await _get_access_token(db)
    calendar_id = get_calendar_id(db)
    event = _termin_to_event(termin, kunde_name)

    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            f"{CAL_BASE}/calendars/{calendar_id}/events",
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": "application/json"},
            json=event,
        )

    if res.status_code not in (200, 201):
        logger.warning("Google create_event fehlgeschlagen: %s %s",
                       res.status_code, res.text[:300])
        raise HTTPException(502, f"Google Calendar Fehler: {res.text[:200]}")

    return res.json()["id"]


async def update_event(
    db: sqlite3.Connection, google_uid: str, termin: dict,
    kunde_name: str | None = None,
) -> None:
    """Termin in Google Calendar aktualisieren (PATCH)."""
    token = await _get_access_token(db)
    calendar_id = get_calendar_id(db)
    event = _termin_to_event(termin, kunde_name)

    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.patch(
            f"{CAL_BASE}/calendars/{calendar_id}/events/{google_uid}",
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": "application/json"},
            json=event,
        )

    if res.status_code == 404:
        logger.info("Google update_event: Event %s existiert nicht mehr — neu anlegen",
                    google_uid)
        # Neu anlegen als Ersatz
        new_uid = await create_event(db, termin, kunde_name)
        # Caller muss google_uid aktualisieren — wir geben es zurück via Exception
        raise EventRecreated(new_uid)

    if res.status_code != 200:
        logger.warning("Google update_event fehlgeschlagen: %s %s",
                       res.status_code, res.text[:300])
        raise HTTPException(502, f"Google Calendar Fehler: {res.text[:200]}")


async def delete_event(db: sqlite3.Connection, google_uid: str) -> None:
    """Termin in Google Calendar löschen."""
    token = await _get_access_token(db)
    calendar_id = get_calendar_id(db)

    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.delete(
            f"{CAL_BASE}/calendars/{calendar_id}/events/{google_uid}",
            headers={"Authorization": f"Bearer {token}"},
        )

    if res.status_code not in (200, 204, 404):
        # 404 = war eh schon weg → kein Fehler
        logger.warning("Google delete_event fehlgeschlagen: %s %s",
                       res.status_code, res.text[:300])
        raise HTTPException(502, f"Google Calendar Fehler: {res.text[:200]}")


async def list_calendars(db: sqlite3.Connection) -> list[dict]:
    """Verfügbare Kalender des Users — für Kalender-Auswahl im Settings-UI."""
    token = await _get_access_token(db)
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(
            f"{CAL_BASE}/users/me/calendarList",
            headers={"Authorization": f"Bearer {token}"},
        )
    if res.status_code != 200:
        return []
    return [
        {"id": c["id"], "summary": c["summary"], "primary": c.get("primary", False)}
        for c in res.json().get("items", [])
    ]


class EventRecreated(Exception):
    """Wird geworfen wenn ein update_event auf einen verlorenen Event-UID einen neuen anlegen musste.
    Caller fängt das ab und aktualisiert die google_uid in der DB."""

    def __init__(self, new_uid: str):
        self.new_uid = new_uid
