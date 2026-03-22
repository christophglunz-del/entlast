"""Authentication: Login, Logout, Session-Management, Brute-Force-Schutz.

Sessions werden in der auth.db gespeichert (ueberlebt Restarts).
"""

import os
import time
import uuid
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Request, Response, HTTPException, Depends, Cookie
import bcrypt as _bcrypt

from app.database import get_auth_db, get_mandant_db
from app.models import LoginRequest, LoginResponse, UserResponse, FirmaResponse

logger = logging.getLogger("entlast.auth")

router = APIRouter(prefix="/auth", tags=["auth"])

SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY nicht gesetzt! Generieren: python -c \"import secrets; print(secrets.token_hex(32))\"")

# Session-Konfiguration
SESSION_TIMEOUT_HOURS = 8
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15
COOKIE_SECURE = os.environ.get("ENTLAST_ENV", "production") == "production"

# Brute-Force-Tracker: {ip: {attempts: int, locked_until: float}}
_login_attempts: dict[str, dict] = {}


def _cleanup_sessions():
    """Entfernt abgelaufene Sessions aus der DB."""
    cutoff = time.time() - SESSION_TIMEOUT_HOURS * 3600
    conn = get_auth_db()
    try:
        conn.execute("DELETE FROM sessions WHERE created_at < ?", (cutoff,))
        conn.commit()
    finally:
        conn.close()


def _get_session(session_id: str) -> dict | None:
    """Liest eine Session aus der DB."""
    conn = get_auth_db()
    try:
        return conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
    finally:
        conn.close()


def _create_session(session_id: str, data: dict):
    """Speichert eine neue Session in der DB."""
    conn = get_auth_db()
    try:
        conn.execute(
            """INSERT INTO sessions (session_id, user_id, username, mandant_id, db_datei, name, rolle, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (session_id, data["user_id"], data["username"], data["mandant_id"],
             data["db_datei"], data["name"], data["rolle"], data["created_at"]),
        )
        conn.commit()
    finally:
        conn.close()


def _delete_session(session_id: str):
    """Loescht eine Session aus der DB."""
    conn = get_auth_db()
    try:
        conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        conn.commit()
    finally:
        conn.close()


def _check_brute_force(ip: str):
    """Prueft ob eine IP gesperrt ist."""
    info = _login_attempts.get(ip)
    if not info:
        return
    if info.get("locked_until") and time.time() < info["locked_until"]:
        remaining = int(info["locked_until"] - time.time())
        raise HTTPException(
            status_code=429,
            detail=f"Zu viele Fehlversuche. Gesperrt fuer {remaining} Sekunden."
        )
    # Sperre abgelaufen → zuruecksetzen
    if info.get("locked_until") and time.time() >= info["locked_until"]:
        del _login_attempts[ip]


def _record_failed_login(ip: str):
    """Zaehlt fehlgeschlagene Login-Versuche."""
    if ip not in _login_attempts:
        _login_attempts[ip] = {"attempts": 0, "locked_until": None}
    _login_attempts[ip]["attempts"] += 1
    if _login_attempts[ip]["attempts"] >= MAX_LOGIN_ATTEMPTS:
        _login_attempts[ip]["locked_until"] = time.time() + LOCKOUT_MINUTES * 60
        logger.warning(f"IP {ip} gesperrt nach {MAX_LOGIN_ATTEMPTS} Fehlversuchen")


def _clear_failed_logins(ip: str):
    """Setzt Fehlversuche nach erfolgreichem Login zurueck."""
    _login_attempts.pop(ip, None)


def get_current_user(request: Request) -> dict:
    """Dependency: Gibt den aktuellen User zurueck oder wirft 401."""
    session_id = request.cookies.get("session_id")
    if not session_id:
        raise HTTPException(status_code=401, detail="Nicht angemeldet")

    _cleanup_sessions()
    session = _get_session(session_id)
    if not session:
        raise HTTPException(status_code=401, detail="Session abgelaufen")

    return session


def get_db(request: Request):
    """Dependency: Gibt die richtige Mandanten-SQLite-DB zurueck."""
    user = get_current_user(request)
    conn = get_mandant_db(user["db_datei"])
    try:
        yield conn
    finally:
        conn.close()


@router.post("/login", response_model=LoginResponse)
async def login(data: LoginRequest, request: Request, response: Response):
    """Login mit Username/Passwort → Session-Cookie."""
    client_ip = request.client.host if request.client else "unknown"
    _check_brute_force(client_ip)

    conn = get_auth_db()
    try:
        user = conn.execute(
            """SELECT b.id, b.username, b.password_hash, b.mandant_id, b.name, b.rolle,
                      m.db_datei, m.aktiv as mandant_aktiv
               FROM auth_benutzer b
               JOIN mandanten m ON b.mandant_id = m.id
               WHERE b.username = ? AND b.aktiv = 1""",
            (data.username,),
        ).fetchone()
    finally:
        conn.close()

    if not user or not _bcrypt.checkpw(data.password.encode(), user["password_hash"].encode()):
        _record_failed_login(client_ip)
        raise HTTPException(status_code=401, detail="Benutzername oder Passwort falsch")

    if not user["mandant_aktiv"]:
        raise HTTPException(status_code=403, detail="Mandant deaktiviert")

    _clear_failed_logins(client_ip)

    # Session erstellen
    session_id = str(uuid.uuid4())
    _create_session(session_id, {
        "user_id": user["id"],
        "username": user["username"],
        "mandant_id": user["mandant_id"],
        "db_datei": user["db_datei"],
        "name": user["name"],
        "rolle": user["rolle"],
        "created_at": time.time(),
    })

    # Cookie setzen
    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=SESSION_TIMEOUT_HOURS * 3600,
    )

    # Firmendaten laden
    firma_data = _get_firma_data(user["db_datei"])

    logger.info(f"Login: {user['username']} (Mandant {user['mandant_id']}) von {client_ip}")

    return LoginResponse(
        user=UserResponse(
            id=user["id"],
            username=user["username"],
            name=user["name"],
            rolle=user["rolle"],
            mandant_id=user["mandant_id"],
        ),
        firma=firma_data,
    )


@router.post("/logout")
async def logout(request: Request, response: Response):
    """Logout: Session invalidieren."""
    session_id = request.cookies.get("session_id")
    if session_id:
        session = _get_session(session_id)
        if session:
            logger.info(f"Logout: {session['username']}")
            _delete_session(session_id)

    response.delete_cookie("session_id")
    return {"message": "Abgemeldet"}


@router.get("/me")
async def me(request: Request):
    """Aktueller User + Firmendaten (Logo, Farbe, Untertitel)."""
    user = get_current_user(request)
    firma_data = _get_firma_data(user["db_datei"])

    return {
        "user": UserResponse(
            id=user["user_id"],
            username=user["username"],
            name=user["name"],
            rolle=user["rolle"],
            mandant_id=user["mandant_id"],
        ),
        "firma": firma_data,
    }


def _get_firma_data(db_datei: str) -> FirmaResponse:
    """Laedt Firmendaten aus der Mandanten-DB."""
    conn = get_mandant_db(db_datei)
    try:
        row = conn.execute("SELECT * FROM firma WHERE id = 1").fetchone()
        if not row:
            return FirmaResponse()
        return FirmaResponse(
            name=row.get("name"),
            inhaber=row.get("inhaber"),
            strasse=row.get("strasse"),
            plz=row.get("plz"),
            ort=row.get("ort"),
            telefon=row.get("telefon"),
            email=row.get("email"),
            steuernummer=row.get("steuernummer"),
            iban=row.get("iban"),
            bic=row.get("bic"),
            bank=row.get("bank"),
            logo_datei=row.get("logo_datei"),
            farbe_primary=row.get("farbe_primary") or "#E91E7B",
            farbe_primary_dark=row.get("farbe_primary_dark") or "#C2185B",
            untertitel=row.get("untertitel"),
            kleinunternehmer=bool(row.get("kleinunternehmer", 1)),
        )
    finally:
        conn.close()
