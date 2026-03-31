"""Router: LetterXpress Guthaben-Abfrage."""

import sqlite3
from fastapi import APIRouter, Depends
from app.auth import get_current_user, get_db
from app.services import letterxpress as lxp_service

router = APIRouter(prefix="/letterxpress", tags=["letterxpress"])


@router.get("/guthaben")
async def letterxpress_guthaben(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """LetterXpress Guthaben abfragen."""
    return await lxp_service.get_guthaben(db)
