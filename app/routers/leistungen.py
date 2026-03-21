"""Router: Leistungen-CRUD (Leistungsnachweise)."""

import sqlite3
from fastapi import APIRouter, Depends, HTTPException, Query
from app.auth import get_current_user, get_db
from app.models import LeistungCreate, LeistungUpdate, LeistungResponse

router = APIRouter(prefix="/leistungen", tags=["leistungen"])


def _row_to_response(row: dict) -> LeistungResponse:
    return LeistungResponse(
        id=row["id"],
        kunde_id=row["kunde_id"],
        datum=row["datum"],
        von=row.get("von"),
        bis=row.get("bis"),
        dauer_std=row.get("dauer_std"),
        leistungsarten=row.get("leistungsarten"),
        betrag=row.get("betrag"),
        unterschrift_betreuer=row.get("unterschrift_betreuer"),
        unterschrift_versicherter=row.get("unterschrift_versicherter"),
        notiz=row.get("notiz"),
        created_at=row.get("created_at"),
    )


@router.get("", response_model=list[LeistungResponse])
async def liste_leistungen(
    kunde_id: int | None = Query(None, description="Filter nach Kunde"),
    monat: int | None = Query(None, ge=1, le=12, description="Monat (1-12)"),
    jahr: int | None = Query(None, description="Jahr"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Alle Leistungen auflisten, optional gefiltert nach Kunde oder Monat/Jahr."""
    if kunde_id:
        rows = db.execute(
            "SELECT * FROM leistungen WHERE kunde_id = ? ORDER BY datum DESC",
            (kunde_id,),
        ).fetchall()
    elif monat and jahr:
        # Monatsfilter: datum wie "2026-03-%" (YYYY-MM-DD)
        datum_prefix = f"{jahr:04d}-{monat:02d}-%"
        rows = db.execute(
            "SELECT * FROM leistungen WHERE datum LIKE ? ORDER BY datum DESC",
            (datum_prefix,),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM leistungen ORDER BY datum DESC").fetchall()
    return [_row_to_response(r) for r in rows]


@router.get("/{leistung_id}", response_model=LeistungResponse)
async def get_leistung(
    leistung_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Einzelne Leistung laden."""
    row = db.execute("SELECT * FROM leistungen WHERE id = ?", (leistung_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Leistung nicht gefunden")
    return _row_to_response(row)


@router.post("", response_model=LeistungResponse, status_code=201)
async def create_leistung(
    leistung: LeistungCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Neue Leistung anlegen."""
    # Kunde existiert?
    kunde = db.execute("SELECT id FROM kunden WHERE id = ?", (leistung.kunde_id,)).fetchone()
    if not kunde:
        raise HTTPException(status_code=400, detail="Kunde nicht gefunden")

    cursor = db.execute(
        """INSERT INTO leistungen
           (kunde_id, datum, von, bis, dauer_std, leistungsarten, betrag,
            unterschrift_betreuer, unterschrift_versicherter, notiz)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            leistung.kunde_id,
            leistung.datum,
            leistung.von,
            leistung.bis,
            leistung.dauer_std,
            leistung.leistungsarten,
            leistung.betrag,
            leistung.unterschrift_betreuer,
            leistung.unterschrift_versicherter,
            leistung.notiz,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM leistungen WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_response(row)


@router.put("/{leistung_id}", response_model=LeistungResponse)
async def update_leistung(
    leistung_id: int,
    leistung: LeistungUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Leistung aktualisieren (Partial Update)."""
    existing = db.execute("SELECT id FROM leistungen WHERE id = ?", (leistung_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Leistung nicht gefunden")

    data = leistung.model_dump(exclude_unset=True)
    if not data:
        row = db.execute("SELECT * FROM leistungen WHERE id = ?", (leistung_id,)).fetchone()
        return _row_to_response(row)

    set_clause = ", ".join(f"{k} = ?" for k in data)
    values = list(data.values())
    values.append(leistung_id)

    db.execute(f"UPDATE leistungen SET {set_clause} WHERE id = ?", values)
    db.commit()

    row = db.execute("SELECT * FROM leistungen WHERE id = ?", (leistung_id,)).fetchone()
    return _row_to_response(row)


@router.delete("/{leistung_id}")
async def delete_leistung(
    leistung_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Leistung loeschen."""
    existing = db.execute("SELECT id FROM leistungen WHERE id = ?", (leistung_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Leistung nicht gefunden")

    db.execute("DELETE FROM leistungen WHERE id = ?", (leistung_id,))
    db.commit()
    return {"ok": True}


@router.post("/{leistung_id}/unterschrift", response_model=LeistungResponse)
async def unterschrift_speichern(
    leistung_id: int,
    unterschrift_betreuer: str | None = None,
    unterschrift_versicherter: str | None = None,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Unterschriften (Betreuer + Versicherter) fuer eine Leistung speichern."""
    existing = db.execute("SELECT id FROM leistungen WHERE id = ?", (leistung_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Leistung nicht gefunden")

    updates = {}
    if unterschrift_betreuer is not None:
        updates["unterschrift_betreuer"] = unterschrift_betreuer
    if unterschrift_versicherter is not None:
        updates["unterschrift_versicherter"] = unterschrift_versicherter

    if not updates:
        raise HTTPException(status_code=400, detail="Keine Unterschrift angegeben")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values())
    values.append(leistung_id)

    db.execute(f"UPDATE leistungen SET {set_clause} WHERE id = ?", values)
    db.commit()

    row = db.execute("SELECT * FROM leistungen WHERE id = ?", (leistung_id,)).fetchone()
    return _row_to_response(row)
