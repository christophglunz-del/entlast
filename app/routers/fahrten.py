"""Router: Fahrten-CRUD (Kilometeraufzeichnung)."""

import sqlite3
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from app.auth import get_current_user, get_db
from app.models import FahrtCreate, FahrtUpdate, FahrtResponse

router = APIRouter(prefix="/fahrten", tags=["fahrten"])


def _row_to_response(row: dict) -> FahrtResponse:
    return FahrtResponse(
        id=row["id"],
        kunde_id=row["kunde_id"],
        datum=row["datum"],
        von_ort=row.get("von_ort"),
        nach_ort=row.get("nach_ort"),
        km=row.get("km"),
        betrag=row.get("betrag"),
        created_at=row.get("created_at"),
    )


def _week_to_date_range(woche: str) -> tuple[str, str]:
    """Wandelt ISO-Woche (z.B. '2026-W12') in Start- und Enddatum um."""
    # Format: YYYY-Www
    year, week_num = woche.split("-W")
    # Montag der Woche
    start = datetime.strptime(f"{year}-W{int(week_num):02d}-1", "%Y-W%W-%w")
    end = start + timedelta(days=6)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


@router.get("", response_model=list[FahrtResponse])
async def liste_fahrten(
    woche: str | None = Query(None, description="ISO-Woche, z.B. 2026-W12"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Alle Fahrten auflisten, optional gefiltert nach Woche."""
    if woche:
        try:
            start, end = _week_to_date_range(woche)
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="Ungueltiges Wochenformat. Erwartet: YYYY-Www")
        rows = db.execute(
            "SELECT * FROM fahrten WHERE datum BETWEEN ? AND ? ORDER BY datum DESC",
            (start, end),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM fahrten ORDER BY datum DESC").fetchall()
    return [_row_to_response(r) for r in rows]


@router.get("/{fahrt_id}", response_model=FahrtResponse)
async def get_fahrt(
    fahrt_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Einzelne Fahrt laden."""
    row = db.execute("SELECT * FROM fahrten WHERE id = ?", (fahrt_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Fahrt nicht gefunden")
    return _row_to_response(row)


@router.post("", response_model=FahrtResponse, status_code=201)
async def create_fahrt(
    fahrt: FahrtCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Neue Fahrt anlegen."""
    # Kunde existiert?
    kunde = db.execute("SELECT id FROM kunden WHERE id = ?", (fahrt.kunde_id,)).fetchone()
    if not kunde:
        raise HTTPException(status_code=400, detail="Kunde nicht gefunden")

    cursor = db.execute(
        """INSERT INTO fahrten (kunde_id, datum, von_ort, nach_ort, km, betrag)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (fahrt.kunde_id, fahrt.datum, fahrt.von_ort, fahrt.nach_ort, fahrt.km, fahrt.betrag),
    )
    db.commit()
    row = db.execute("SELECT * FROM fahrten WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_response(row)


@router.put("/{fahrt_id}", response_model=FahrtResponse)
async def update_fahrt(
    fahrt_id: int,
    fahrt: FahrtUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Fahrt aktualisieren (Partial Update)."""
    existing = db.execute("SELECT id FROM fahrten WHERE id = ?", (fahrt_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Fahrt nicht gefunden")

    data = fahrt.model_dump(exclude_unset=True)
    if not data:
        row = db.execute("SELECT * FROM fahrten WHERE id = ?", (fahrt_id,)).fetchone()
        return _row_to_response(row)

    set_clause = ", ".join(f"{k} = ?" for k in data)
    values = list(data.values())
    values.append(fahrt_id)

    db.execute(f"UPDATE fahrten SET {set_clause} WHERE id = ?", values)
    db.commit()

    row = db.execute("SELECT * FROM fahrten WHERE id = ?", (fahrt_id,)).fetchone()
    return _row_to_response(row)


@router.delete("/{fahrt_id}")
async def delete_fahrt(
    fahrt_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Fahrt loeschen."""
    existing = db.execute("SELECT id FROM fahrten WHERE id = ?", (fahrt_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Fahrt nicht gefunden")

    db.execute("DELETE FROM fahrten WHERE id = ?", (fahrt_id,))
    db.commit()
    return {"ok": True}
