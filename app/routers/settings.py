"""Router: Key-Value Settings pro Mandant."""

import sqlite3
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.auth import get_current_user, get_db

router = APIRouter(prefix="/settings", tags=["settings"])

SENSITIVE_KEYS = {
    "lexoffice_api_key",
    "sipgate_token_id",
    "sipgate_token",
    "letterxpress_user",
    "letterxpress_key",
}


class SettingValue(BaseModel):
    value: str


@router.get("/{key}")
async def get_setting(
    key: str,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if key in SENSITIVE_KEYS:
        configured = bool(row and row["value"])
        return {"key": key, "value": None, "configured": configured}
    if not row:
        return {"key": key, "value": None}
    return {"key": key, "value": row["value"]}


@router.put("/{key}")
async def set_setting(
    key: str,
    body: SettingValue,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    # Leerer String = Key loeschen (dekonfigurieren)
    if not body.value:
        db.execute("DELETE FROM settings WHERE key = ?", (key,))
        db.commit()
        return {"key": key, "value": None, "configured": False}

    existing = db.execute("SELECT key FROM settings WHERE key = ?", (key,)).fetchone()
    if existing:
        db.execute("UPDATE settings SET value = ? WHERE key = ?", (body.value, key))
    else:
        db.execute("INSERT INTO settings (key, value) VALUES (?, ?)", (key, body.value))
    db.commit()
    return {"key": key, "value": body.value, "configured": True}
