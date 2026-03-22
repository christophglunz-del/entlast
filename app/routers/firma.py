"""Router: Firmendaten lesen/aktualisieren + Logo-Upload."""

import sqlite3
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from app.auth import get_current_user, get_db
from app.models import FirmaResponse, FirmaUpdate
from app.database import DATA_DIR

router = APIRouter(prefix="/firma", tags=["firma"])


def _row_to_response(row: dict) -> FirmaResponse:
    return FirmaResponse(
        name=row.get("name"),
        inhaber=row.get("inhaber"),
        strasse=row.get("strasse"),
        plz=row.get("plz"),
        ort=row.get("ort"),
        telefon=row.get("telefon"),
        email=row.get("email"),
        steuernummer=row.get("steuernummer"),
        iban=row.get("iban"),
        bic=row.get("bic"),
        bank=row.get("bank"),
        logo_datei=row.get("logo_datei"),
        farbe_primary=row.get("farbe_primary") or "#E91E7B",
        farbe_primary_dark=row.get("farbe_primary_dark") or "#C2185B",
        untertitel=row.get("untertitel"),
        kleinunternehmer=bool(row.get("kleinunternehmer", 1)),
        stundensatz=row.get("stundensatz", 32.5),
        km_satz=row.get("km_satz", 0.30),
        start_adresse=row.get("start_adresse"),
    )


@router.get("", response_model=FirmaResponse)
async def get_firma(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Firmendaten lesen."""
    row = db.execute("SELECT * FROM firma WHERE id = 1").fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Firmendaten nicht gefunden")
    return _row_to_response(row)


@router.put("", response_model=FirmaResponse)
async def update_firma(
    firma: FirmaUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Firmendaten aktualisieren (Partial Update)."""
    existing = db.execute("SELECT id FROM firma WHERE id = 1").fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Firmendaten nicht gefunden")

    data = firma.model_dump(exclude_unset=True)
    if not data:
        row = db.execute("SELECT * FROM firma WHERE id = 1").fetchone()
        return _row_to_response(row)

    # Boolean-Feld umwandeln
    if "kleinunternehmer" in data:
        data["kleinunternehmer"] = 1 if data["kleinunternehmer"] else 0

    set_clause = ", ".join(f"{k} = ?" for k in data)
    values = list(data.values())

    db.execute(f"UPDATE firma SET {set_clause} WHERE id = 1", values)
    db.commit()

    row = db.execute("SELECT * FROM firma WHERE id = 1").fetchone()
    return _row_to_response(row)


@router.get("/logo")
async def get_logo(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Logo-Datei ausliefern."""
    row = db.execute("SELECT logo_datei FROM firma WHERE id = 1").fetchone()
    if not row or not row.get("logo_datei"):
        raise HTTPException(status_code=404, detail="Kein Logo hinterlegt")

    logo_path = DATA_DIR / row["logo_datei"]
    if not logo_path.exists():
        raise HTTPException(status_code=404, detail="Logo-Datei nicht gefunden")

    return FileResponse(str(logo_path))


@router.post("/logo")
async def upload_logo(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Logo hochladen (PNG, JPG, SVG, max 2MB)."""
    # Validierung
    allowed = {"image/png", "image/jpeg", "image/svg+xml", "image/webp"}
    if file.content_type not in allowed:
        raise HTTPException(400, "Nur PNG, JPG, SVG oder WebP erlaubt")

    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(400, "Logo darf maximal 2 MB gross sein")

    # Dateiendung ableiten
    ext_map = {"image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg", "image/webp": ".webp"}
    ext = ext_map.get(file.content_type, ".png")
    filename = f"logo_{uuid.uuid4().hex[:8]}{ext}"
    logo_rel = f"logos/{filename}"
    logo_path = DATA_DIR / logo_rel

    # Altes Logo loeschen
    old = db.execute("SELECT logo_datei FROM firma WHERE id = 1").fetchone()
    if old and old.get("logo_datei"):
        old_path = DATA_DIR / old["logo_datei"]
        if old_path.exists():
            old_path.unlink()

    # Speichern
    logo_path.parent.mkdir(parents=True, exist_ok=True)
    logo_path.write_bytes(content)

    # DB aktualisieren
    db.execute("UPDATE firma SET logo_datei = ? WHERE id = 1", (logo_rel,))
    db.commit()

    return {"message": "Logo hochgeladen", "logo_datei": logo_rel}


@router.get("/lexoffice-import")
async def import_from_lexoffice(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Firmendaten von Lexoffice-Profil importieren."""
    from app.services.lexoffice import fetch_profile
    return await fetch_profile(db)
