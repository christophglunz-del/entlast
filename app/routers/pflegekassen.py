"""Router: Pflegekassen-Stammdaten (Name, Fax, Adresse)."""

import sqlite3
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.auth import get_current_user, get_db

router = APIRouter(prefix="/pflegekassen", tags=["pflegekassen"])


class PflegekasseCreate(BaseModel):
    name: str
    strasse: str | None = None
    plz: str | None = None
    ort: str | None = None
    fax: str | None = None
    ik_nummer: str | None = None


@router.get("")
async def liste(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    return db.execute("SELECT * FROM pflegekassen ORDER BY name").fetchall()


@router.get("/{pk_id}")
async def detail(
    pk_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    row = db.execute("SELECT * FROM pflegekassen WHERE id = ?", (pk_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Pflegekasse nicht gefunden")
    return row


@router.post("", status_code=201)
async def erstellen(
    data: PflegekasseCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    cur = db.execute(
        "INSERT INTO pflegekassen (name, strasse, plz, ort, fax, ik_nummer) VALUES (?, ?, ?, ?, ?, ?)",
        (data.name, data.strasse, data.plz, data.ort, data.fax, data.ik_nummer),
    )
    db.commit()
    return db.execute("SELECT * FROM pflegekassen WHERE id = ?", (cur.lastrowid,)).fetchone()


@router.put("/{pk_id}")
async def aktualisieren(
    pk_id: int,
    data: PflegekasseCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    existing = db.execute("SELECT id FROM pflegekassen WHERE id = ?", (pk_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Pflegekasse nicht gefunden")
    db.execute(
        "UPDATE pflegekassen SET name=?, strasse=?, plz=?, ort=?, fax=?, ik_nummer=? WHERE id=?",
        (data.name, data.strasse, data.plz, data.ort, data.fax, data.ik_nummer, pk_id),
    )
    db.commit()
    return db.execute("SELECT * FROM pflegekassen WHERE id = ?", (pk_id,)).fetchone()


@router.delete("/{pk_id}")
async def loeschen(
    pk_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    existing = db.execute("SELECT id FROM pflegekassen WHERE id = ?", (pk_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Pflegekasse nicht gefunden")
    db.execute("DELETE FROM pflegekassen WHERE id = ?", (pk_id,))
    db.commit()
    return {"message": "Geloescht"}
