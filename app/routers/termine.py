"""Router: Termine-CRUD."""

import json
import sqlite3
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from app.auth import get_current_user, get_db
from app.models import TerminCreate, TerminUpdate, TerminResponse

router = APIRouter(prefix="/termine", tags=["termine"])


def _row_to_response(row: dict) -> TerminResponse:
    # wiederholungs_muster: JSON-String aus DB -> dict fuer Response
    muster_raw = row.get("wiederholungs_muster")
    muster_dict = None
    if muster_raw:
        try:
            muster_dict = json.loads(muster_raw)
        except (json.JSONDecodeError, TypeError):
            muster_dict = None

    return TerminResponse(
        id=row["id"],
        kunde_id=row["kunde_id"],
        datum=row["datum"],
        von=row.get("von"),
        bis=row.get("bis"),
        startzeit=row.get("von"),
        endzeit=row.get("bis"),
        titel=row.get("titel"),
        notiz=row.get("notiz"),
        notizen=row.get("notiz"),
        erledigt=bool(row.get("erledigt", 0)),
        wiederkehrend=row.get("wiederkehrend", 0),
        wiederholungsMuster=muster_dict,
        created_at=row.get("created_at"),
    )


def _week_to_date_range(woche: str) -> tuple[str, str]:
    """Wandelt ISO-Woche (z.B. '2026-W12') in Start- und Enddatum um."""
    year, week_num = woche.split("-W")
    start = datetime.strptime(f"{year}-W{int(week_num):02d}-1", "%Y-W%W-%w")
    end = start + timedelta(days=6)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


@router.get("", response_model=list[TerminResponse])
async def liste_termine(
    datum: str | None = Query(None, description="Datum (YYYY-MM-DD)"),
    woche: str | None = Query(None, description="ISO-Woche, z.B. 2026-W12"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Alle Termine auflisten, optional gefiltert nach Datum oder Woche."""
    if datum:
        rows = db.execute(
            "SELECT * FROM termine WHERE datum = ? ORDER BY von",
            (datum,),
        ).fetchall()
    elif woche:
        try:
            start, end = _week_to_date_range(woche)
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="Ungueltiges Wochenformat. Erwartet: YYYY-Www")
        rows = db.execute(
            "SELECT * FROM termine WHERE datum BETWEEN ? AND ? ORDER BY datum, von",
            (start, end),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM termine ORDER BY datum DESC, von").fetchall()
    return [_row_to_response(r) for r in rows]


@router.get("/{termin_id}", response_model=TerminResponse)
async def get_termin(
    termin_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Einzelnen Termin laden."""
    row = db.execute("SELECT * FROM termine WHERE id = ?", (termin_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden")
    return _row_to_response(row)


@router.post("", response_model=TerminResponse, status_code=201)
async def create_termin(
    termin: TerminCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Neuen Termin anlegen."""
    # Kunde existiert?
    kunde = db.execute("SELECT id FROM kunden WHERE id = ?", (termin.kunde_id,)).fetchone()
    if not kunde:
        raise HTTPException(status_code=400, detail="Kunde nicht gefunden")

    # wiederholungs_muster: dict/str -> JSON-String fuer DB
    muster = termin.wiederholungs_muster
    if muster is not None and not isinstance(muster, str):
        muster = json.dumps(muster)

    cursor = db.execute(
        """INSERT INTO termine (kunde_id, datum, von, bis, titel, notiz, erledigt, wiederkehrend, wiederholungs_muster)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            termin.kunde_id,
            termin.datum,
            termin.von,
            termin.bis,
            termin.titel,
            termin.notiz,
            1 if termin.erledigt else 0,
            termin.wiederkehrend or 0,
            muster,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM termine WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_response(row)


@router.put("/{termin_id}", response_model=TerminResponse)
async def update_termin(
    termin_id: int,
    termin: TerminUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Termin aktualisieren (Partial Update)."""
    existing = db.execute("SELECT id FROM termine WHERE id = ?", (termin_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden")

    data = termin.model_dump(exclude_unset=True)
    if not data:
        row = db.execute("SELECT * FROM termine WHERE id = ?", (termin_id,)).fetchone()
        return _row_to_response(row)

    # Boolean-Feld umwandeln
    if "erledigt" in data:
        data["erledigt"] = 1 if data["erledigt"] else 0

    # wiederholungs_muster: dict/str -> JSON-String fuer DB
    if "wiederholungs_muster" in data and data["wiederholungs_muster"] is not None:
        if not isinstance(data["wiederholungs_muster"], str):
            data["wiederholungs_muster"] = json.dumps(data["wiederholungs_muster"])

    set_clause = ", ".join(f"{k} = ?" for k in data)
    values = list(data.values())
    values.append(termin_id)

    db.execute(f"UPDATE termine SET {set_clause} WHERE id = ?", values)
    db.commit()

    row = db.execute("SELECT * FROM termine WHERE id = ?", (termin_id,)).fetchone()
    return _row_to_response(row)


@router.delete("/{termin_id}")
async def delete_termin(
    termin_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Termin loeschen."""
    existing = db.execute("SELECT id FROM termine WHERE id = ?", (termin_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden")

    db.execute("DELETE FROM termine WHERE id = ?", (termin_id,))
    db.commit()
    return {"ok": True}
