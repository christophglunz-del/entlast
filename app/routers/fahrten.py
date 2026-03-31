"""Router: Fahrten-CRUD (Kilometeraufzeichnung)."""

import json
import sqlite3
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from app.auth import get_current_user, get_db
from app.models import FahrtCreate, FahrtUpdate, FahrtResponse

router = APIRouter(prefix="/fahrten", tags=["fahrten"])


def _row_to_response(row: dict) -> FahrtResponse:
    # ziel_adressen ist JSON-String in der DB
    ziel = row.get("ziel_adressen")
    if ziel and isinstance(ziel, str):
        try:
            ziel = json.loads(ziel)
        except (json.JSONDecodeError, TypeError):
            ziel = None

    return FahrtResponse(
        id=row["id"],
        kunde_id=row.get("kunde_id"),
        datum=row["datum"],
        wochentag=row.get("wochentag"),
        start_adresse=row.get("start_adresse"),
        ziel_adressen=ziel,
        gesamt_km=row.get("gesamt_km"),
        tracking_km=row.get("tracking_km"),
        betrag=row.get("betrag"),
        notiz=row.get("notiz"),
        gps_track=row.get("gps_track"),
        route_beschreibung=row.get("route_beschreibung"),
        # Legacy
        von_ort=row.get("von_ort"),
        nach_ort=row.get("nach_ort"),
        km=row.get("km"),
        created_at=row.get("created_at"),
    )


def _week_to_date_range(woche: str) -> tuple[str, str]:
    """Wandelt Wochenangabe in Start- und Enddatum um."""
    if "-W" in woche:
        year, week_num = woche.split("-W")
        start = datetime.strptime(f"{year}-W{int(week_num):02d}-1", "%Y-W%W-%w")
    else:
        start = datetime.strptime(woche, "%Y-%m-%d")
        start = start - timedelta(days=start.weekday())
    end = start + timedelta(days=6)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


@router.get("", response_model=list[FahrtResponse])
async def liste_fahrten(
    woche: str | None = Query(None, description="ISO-Woche oder Montag-Datum"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    if woche:
        try:
            start, end = _week_to_date_range(woche)
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="Ungueltiges Wochenformat")
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
    ziel_json = json.dumps(fahrt.ziel_adressen) if fahrt.ziel_adressen else None
    # gesamt_km hat Vorrang vor legacy km
    km_val = fahrt.gesamt_km if fahrt.gesamt_km is not None else fahrt.km

    cursor = db.execute(
        """INSERT INTO fahrten
           (kunde_id, datum, wochentag, start_adresse, ziel_adressen,
            gesamt_km, tracking_km, betrag, notiz, gps_track,
            von_ort, nach_ort, km)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (fahrt.kunde_id, fahrt.datum, fahrt.wochentag, fahrt.start_adresse, ziel_json,
         fahrt.gesamt_km, fahrt.tracking_km, fahrt.betrag, fahrt.notiz, fahrt.gps_track,
         fahrt.von_ort, fahrt.nach_ort, km_val),
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
    existing = db.execute("SELECT id FROM fahrten WHERE id = ?", (fahrt_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Fahrt nicht gefunden")

    data = fahrt.model_dump(exclude_unset=True)
    if "ziel_adressen" in data and data["ziel_adressen"] is not None:
        data["ziel_adressen"] = json.dumps(data["ziel_adressen"])
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
    existing = db.execute("SELECT id FROM fahrten WHERE id = ?", (fahrt_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Fahrt nicht gefunden")
    db.execute("DELETE FROM fahrten WHERE id = ?", (fahrt_id,))
    db.commit()
    return {"ok": True}
