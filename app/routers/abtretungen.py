"""Router: Abtretungserklaerungen-CRUD."""

import sqlite3
from fastapi import APIRouter, Depends, HTTPException, Query
from app.auth import get_current_user, get_db
from app.models import AbtretungCreate, AbtretungUpdate, AbtretungResponse

router = APIRouter(prefix="/abtretungen", tags=["abtretungen"])


def _row_to_response(row: dict) -> AbtretungResponse:
    return AbtretungResponse(
        id=row["id"],
        kunde_id=row["kunde_id"],
        datum=row["datum"],
        gueltig_ab=row.get("gueltig_ab"),
        gueltig_bis=row.get("gueltig_bis"),
        unterschrift=row.get("unterschrift"),
        pflegekasse=row.get("pflegekasse"),
        created_at=row.get("created_at"),
    )


@router.get("", response_model=list[AbtretungResponse])
async def liste_abtretungen(
    kunde_id: int | None = Query(None, description="Filter nach Kunde"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Alle Abtretungserklaerungen auflisten, optional nach Kunde gefiltert."""
    if kunde_id:
        rows = db.execute(
            "SELECT * FROM abtretungen WHERE kunde_id = ? ORDER BY datum DESC",
            (kunde_id,),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM abtretungen ORDER BY datum DESC").fetchall()
    return [_row_to_response(r) for r in rows]


@router.get("/{abtretung_id}", response_model=AbtretungResponse)
async def get_abtretung(
    abtretung_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Einzelne Abtretungserklaerung laden."""
    row = db.execute("SELECT * FROM abtretungen WHERE id = ?", (abtretung_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Abtretung nicht gefunden")
    return _row_to_response(row)


@router.post("", response_model=AbtretungResponse, status_code=201)
async def create_abtretung(
    abtretung: AbtretungCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Neue Abtretungserklaerung anlegen."""
    # Kunde existiert?
    kunde = db.execute("SELECT id FROM kunden WHERE id = ?", (abtretung.kunde_id,)).fetchone()
    if not kunde:
        raise HTTPException(status_code=400, detail="Kunde nicht gefunden")

    cursor = db.execute(
        """INSERT INTO abtretungen (kunde_id, datum, gueltig_ab, gueltig_bis, unterschrift, pflegekasse)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            abtretung.kunde_id,
            abtretung.datum,
            abtretung.gueltig_ab,
            abtretung.gueltig_bis,
            abtretung.unterschrift,
            abtretung.pflegekasse,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM abtretungen WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_response(row)


@router.put("/{abtretung_id}", response_model=AbtretungResponse)
async def update_abtretung(
    abtretung_id: int,
    abtretung: AbtretungUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Abtretungserklaerung aktualisieren (Partial Update)."""
    existing = db.execute("SELECT id FROM abtretungen WHERE id = ?", (abtretung_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Abtretung nicht gefunden")

    data = abtretung.model_dump(exclude_unset=True)
    if not data:
        row = db.execute("SELECT * FROM abtretungen WHERE id = ?", (abtretung_id,)).fetchone()
        return _row_to_response(row)

    set_clause = ", ".join(f"{k} = ?" for k in data)
    values = list(data.values())
    values.append(abtretung_id)

    db.execute(f"UPDATE abtretungen SET {set_clause} WHERE id = ?", values)
    db.commit()

    row = db.execute("SELECT * FROM abtretungen WHERE id = ?", (abtretung_id,)).fetchone()
    return _row_to_response(row)


@router.delete("/{abtretung_id}")
async def delete_abtretung(
    abtretung_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Abtretungserklaerung loeschen."""
    existing = db.execute("SELECT id FROM abtretungen WHERE id = ?", (abtretung_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Abtretung nicht gefunden")

    db.execute("DELETE FROM abtretungen WHERE id = ?", (abtretung_id,))
    db.commit()
    return {"ok": True}
