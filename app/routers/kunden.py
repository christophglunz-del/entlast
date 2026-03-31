"""Router: Kunden-CRUD mit Verschluesselung sensibler Felder."""

import json
import sqlite3
from fastapi import APIRouter, Depends, HTTPException, Query
from app.auth import get_current_user, get_db
from app.encryption import encrypt, decrypt
from app.models import KundeCreate, KundeUpdate, KundeResponse

router = APIRouter(prefix="/kunden", tags=["kunden"])


def _row_to_response(row: dict) -> KundeResponse:
    """Wandelt eine DB-Zeile in eine KundeResponse um (mit Entschluesselung)."""
    return KundeResponse(
        id=row["id"],
        name=row["name"],
        vorname=row.get("vorname"),
        strasse=row.get("strasse"),
        plz=row.get("plz"),
        ort=row.get("ort"),
        telefon=row.get("telefon"),
        email=row.get("email"),
        geburtsdatum=row.get("geburtsdatum"),
        pflegegrad=row.get("pflegegrad"),
        versichertennummer=decrypt(row.get("versichertennummer_encrypted")),
        pflegekasse=row.get("pflegekasse"),
        pflegekasse_fax=row.get("pflegekasse_fax"),
        faxKasse=row.get("pflegekasse_fax"),
        iban=decrypt(row.get("iban_encrypted")),
        kundentyp=row.get("kundentyp", "pflege"),
        aktiv=bool(row.get("aktiv", 1)),
        besonderheiten=row.get("besonderheiten"),
        lexoffice_id=row.get("lexoffice_id"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


@router.get("", response_model=list[KundeResponse])
async def liste_kunden(
    q: str | None = Query(None, description="Suchbegriff (Name)"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Alle Kunden auflisten (sortiert nach Name) oder nach Name suchen."""
    if q:
        rows = db.execute(
            "SELECT * FROM kunden WHERE name LIKE ? ORDER BY name",
            (f"%{q}%",),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM kunden ORDER BY name").fetchall()
    return [_row_to_response(r) for r in rows]


@router.get("/suche", response_model=list[KundeResponse])
async def suche_kunden(
    q: str = Query(..., description="Suchbegriff"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Kunden nach Name suchen."""
    rows = db.execute(
        "SELECT * FROM kunden WHERE name LIKE ? ORDER BY name",
        (f"%{q}%",),
    ).fetchall()
    return [_row_to_response(r) for r in rows]


@router.get("/{kunde_id}", response_model=KundeResponse)
async def get_kunde(
    kunde_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Einzelnen Kunden laden (mit entschluesselten Feldern)."""
    row = db.execute("SELECT * FROM kunden WHERE id = ?", (kunde_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Kunde nicht gefunden")
    return _row_to_response(row)


@router.post("", response_model=KundeResponse, status_code=201)
async def create_kunde(
    kunde: KundeCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Neuen Kunden anlegen (versichertennummer + iban werden verschluesselt)."""
    cursor = db.execute(
        """INSERT INTO kunden
           (name, vorname, strasse, plz, ort, telefon, email, geburtsdatum,
            pflegegrad, versichertennummer_encrypted, pflegekasse, pflegekasse_fax,
            iban_encrypted, kundentyp, aktiv, besonderheiten, lexoffice_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            kunde.name,
            kunde.vorname,
            kunde.strasse,
            kunde.plz,
            kunde.ort,
            kunde.telefon,
            kunde.email,
            kunde.geburtsdatum,
            kunde.pflegegrad,
            encrypt(kunde.versichertennummer),
            kunde.pflegekasse,
            kunde.get_fax(),
            encrypt(kunde.iban),
            kunde.kundentyp,
            1 if kunde.aktiv else 0,
            kunde.besonderheiten,
            kunde.lexoffice_id,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM kunden WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_response(row)


@router.put("/{kunde_id}", response_model=KundeResponse)
async def update_kunde(
    kunde_id: int,
    kunde: KundeUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Kunde aktualisieren (Partial Update)."""
    existing = db.execute("SELECT * FROM kunden WHERE id = ?", (kunde_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Kunde nicht gefunden")

    updates = {}
    data = kunde.model_dump(exclude_unset=True)

    # faxKasse → pflegekasse_fax mappen
    if "faxKasse" in data:
        fax_val = data.pop("faxKasse")
        if "pflegekasse_fax" not in data:
            data["pflegekasse_fax"] = fax_val

    # Verschluesselte Felder separat behandeln
    if "versichertennummer" in data:
        updates["versichertennummer_encrypted"] = encrypt(data.pop("versichertennummer"))
    if "iban" in data:
        updates["iban_encrypted"] = encrypt(data.pop("iban"))
    if "aktiv" in data:
        updates["aktiv"] = 1 if data.pop("aktiv") else 0

    updates.update(data)

    if not updates:
        return _row_to_response(existing)

    updates["updated_at"] = "datetime('now')"
    set_clause = ", ".join(
        f"{k} = datetime('now')" if k == "updated_at" else f"{k} = ?"
        for k in updates
    )
    values = [v for k, v in updates.items() if k != "updated_at"]
    values.append(kunde_id)

    db.execute(f"UPDATE kunden SET {set_clause} WHERE id = ?", values)
    db.commit()

    row = db.execute("SELECT * FROM kunden WHERE id = ?", (kunde_id,)).fetchone()
    return _row_to_response(row)


@router.delete("/{kunde_id}")
async def delete_kunde(
    kunde_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Kunde loeschen. Prueft ob offene Rechnungen existieren."""
    existing = db.execute("SELECT id FROM kunden WHERE id = ?", (kunde_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Kunde nicht gefunden")

    # Pruefen ob offene Rechnungen existieren
    offene = db.execute(
        "SELECT COUNT(*) as cnt FROM rechnungen WHERE kunde_id = ? AND status NOT IN ('bezahlt')",
        (kunde_id,),
    ).fetchone()
    if offene and offene["cnt"] > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Kunde hat {offene['cnt']} offene Rechnung(en). Bitte zuerst abschliessen.",
        )

    db.execute("DELETE FROM kunden WHERE id = ?", (kunde_id,))
    db.commit()
    return {"ok": True}
