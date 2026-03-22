"""Router: Dashboard-Statistiken."""

import sqlite3
from datetime import date
from fastapi import APIRouter, Depends
from app.auth import get_current_user, get_db

router = APIRouter(tags=["statistiken"])


@router.get("/statistiken")
async def get_statistiken(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    heute = date.today().isoformat()

    kunden = db.execute("SELECT COUNT(*) as c FROM kunden WHERE aktiv = 1").fetchone()["c"]
    leistungen = db.execute("SELECT COUNT(*) as c FROM leistungen").fetchone()["c"]
    offene_rechnungen = db.execute(
        "SELECT COUNT(*) as c FROM rechnungen WHERE status IN ('entwurf', 'offen')"
    ).fetchone()["c"]
    heute_termine = db.execute(
        "SELECT COUNT(*) as c FROM termine WHERE datum = ?", (heute,)
    ).fetchone()["c"]

    return {
        "kunden": kunden,
        "leistungen": leistungen,
        "offene_rechnungen": offene_rechnungen,
        "heute_termine": heute_termine,
    }
