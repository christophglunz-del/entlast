"""Router: Rechnungen-CRUD + Fax-Versand + Brief-Versand + Platzhalter fuer PDF, Lexoffice, DATEV."""

import logging
import sqlite3

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from app.auth import get_current_user, get_db
from app.models import RechnungCreate, RechnungUpdate, RechnungResponse
from app.services.sipgate import send_fax, normalize_fax_number
from app.services.lexoffice import _get_api_key, LEXOFFICE_BASE
from app.services import letterxpress as lxp_service

logger = logging.getLogger("entlast.rechnungen")

router = APIRouter(prefix="/rechnungen", tags=["rechnungen"])


def _row_to_response(row: dict) -> RechnungResponse:
    return RechnungResponse(
        id=row["id"],
        kunde_id=row["kunde_id"],
        rechnungsnummer=row.get("rechnungsnummer"),
        datum=row.get("datum"),
        monat=row.get("monat"),
        jahr=row.get("jahr"),
        typ=row.get("typ", "kasse"),
        positionen=row.get("positionen"),
        betrag_netto=row.get("betrag_netto"),
        betrag_brutto=row.get("betrag_brutto"),
        status=row.get("status", "entwurf"),
        lexoffice_id=row.get("lexoffice_id"),
        versand_art=row.get("versand_art"),
        versand_datum=row.get("versand_datum"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


@router.get("", response_model=list[RechnungResponse])
async def liste_rechnungen(
    kunde_id: int | None = Query(None, description="Filter nach Kunde"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Alle Rechnungen auflisten, optional nach Kunde gefiltert."""
    if kunde_id:
        rows = db.execute(
            "SELECT * FROM rechnungen WHERE kunde_id = ? ORDER BY jahr DESC, monat DESC",
            (kunde_id,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM rechnungen ORDER BY jahr DESC, monat DESC"
        ).fetchall()
    return [_row_to_response(r) for r in rows]


@router.get("/export/datev")
async def datev_export(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """DATEV-CSV-Export (Platzhalter, Phase 3)."""
    raise HTTPException(status_code=501, detail="Noch nicht implementiert")


@router.get("/{rechnung_id}", response_model=RechnungResponse)
async def get_rechnung(
    rechnung_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Einzelne Rechnung laden."""
    row = db.execute("SELECT * FROM rechnungen WHERE id = ?", (rechnung_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")
    return _row_to_response(row)


@router.post("", response_model=RechnungResponse, status_code=201)
async def create_rechnung(
    rechnung: RechnungCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Neue Rechnung anlegen."""
    # Kunde existiert?
    kunde = db.execute("SELECT id FROM kunden WHERE id = ?", (rechnung.kunde_id,)).fetchone()
    if not kunde:
        raise HTTPException(status_code=400, detail="Kunde nicht gefunden")

    cursor = db.execute(
        """INSERT INTO rechnungen
           (kunde_id, rechnungsnummer, datum, monat, jahr, typ, positionen,
            betrag_netto, betrag_brutto, status, lexoffice_id, versand_art, versand_datum)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            rechnung.kunde_id,
            rechnung.rechnungsnummer,
            rechnung.datum,
            rechnung.monat,
            rechnung.jahr,
            rechnung.typ,
            rechnung.positionen,
            rechnung.betrag_netto,
            rechnung.betrag_brutto,
            rechnung.status,
            rechnung.lexoffice_id,
            rechnung.versand_art,
            rechnung.versand_datum,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM rechnungen WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_response(row)


@router.put("/{rechnung_id}", response_model=RechnungResponse)
async def update_rechnung(
    rechnung_id: int,
    rechnung: RechnungUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Rechnung aktualisieren (Partial Update, z.B. Status aendern)."""
    existing = db.execute("SELECT id FROM rechnungen WHERE id = ?", (rechnung_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")

    data = rechnung.model_dump(exclude_unset=True)
    if not data:
        row = db.execute("SELECT * FROM rechnungen WHERE id = ?", (rechnung_id,)).fetchone()
        return _row_to_response(row)

    # updated_at automatisch setzen
    set_parts = [f"{k} = ?" for k in data]
    set_parts.append("updated_at = datetime('now')")
    set_clause = ", ".join(set_parts)
    values = list(data.values())
    values.append(rechnung_id)

    db.execute(f"UPDATE rechnungen SET {set_clause} WHERE id = ?", values)
    db.commit()

    row = db.execute("SELECT * FROM rechnungen WHERE id = ?", (rechnung_id,)).fetchone()
    return _row_to_response(row)


@router.delete("/{rechnung_id}")
async def delete_rechnung(
    rechnung_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Rechnung loeschen."""
    existing = db.execute("SELECT id FROM rechnungen WHERE id = ?", (rechnung_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")

    db.execute("DELETE FROM rechnungen WHERE id = ?", (rechnung_id,))
    db.commit()
    return {"ok": True}


# --- Platzhalter-Endpoints (Phase 3) ---

@router.get("/{rechnung_id}/pdf")
async def rechnung_pdf(
    rechnung_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Rechnungs-PDF generieren (Platzhalter, Phase 3)."""
    existing = db.execute("SELECT id FROM rechnungen WHERE id = ?", (rechnung_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")
    raise HTTPException(status_code=501, detail="Noch nicht implementiert")


@router.post("/{rechnung_id}/fax")
async def rechnung_fax(
    rechnung_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Rechnung per Fax an die Pflegekasse senden.

    1. Rechnung + Kunde laden
    2. PDF von Lexoffice holen (ueber documentFileId)
    3. Per Sipgate als Fax versenden
    4. Versand-Status in DB aktualisieren
    """
    # Rechnung laden
    rechnung = db.execute(
        "SELECT * FROM rechnungen WHERE id = ?", (rechnung_id,)
    ).fetchone()
    if not rechnung:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")

    lexoffice_id = rechnung.get("lexoffice_id")
    if not lexoffice_id:
        raise HTTPException(
            status_code=400,
            detail="Rechnung hat keine Lexoffice-ID. Bitte zuerst in Lexoffice exportieren.",
        )

    # Kunde laden (fuer Faxnummer)
    kunde = db.execute(
        "SELECT * FROM kunden WHERE id = ?", (rechnung["kunde_id"],)
    ).fetchone()
    if not kunde:
        raise HTTPException(status_code=400, detail="Zugehoeriger Kunde nicht gefunden")

    fax_nummer = kunde.get("pflegekasse_fax") or ""
    if not fax_nummer:
        raise HTTPException(
            status_code=400,
            detail="Keine Pflegekasse-Faxnummer beim Kunden hinterlegt",
        )

    # PDF von Lexoffice holen
    api_key = _get_api_key(db)
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}

    async with httpx.AsyncClient(timeout=30) as client:
        # Schritt 1: documentFileId holen
        doc_res = await client.get(
            f"{LEXOFFICE_BASE}/invoices/{lexoffice_id}/document",
            headers=headers,
        )
        if doc_res.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Lexoffice: Rechnungsdokument nicht abrufbar (HTTP {doc_res.status_code})",
            )
        document_file_id = doc_res.json().get("documentFileId")
        if not document_file_id:
            raise HTTPException(
                status_code=502,
                detail="Lexoffice: Keine documentFileId erhalten. Rechnung evtl. nicht finalisiert?",
            )

        # Schritt 2: PDF-Datei herunterladen
        pdf_res = await client.get(
            f"{LEXOFFICE_BASE}/files/{document_file_id}",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if pdf_res.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Lexoffice: PDF-Download fehlgeschlagen (HTTP {pdf_res.status_code})",
            )
        pdf_bytes = pdf_res.content

    # Fax versenden
    dateiname = f"Rechnung_{rechnung.get('rechnungsnummer', rechnung_id)}.pdf"
    result = await send_fax(db, fax_nummer, pdf_bytes, dateiname)

    # Versand-Status in DB aktualisieren
    db.execute(
        """UPDATE rechnungen
           SET versand_art = 'fax', versand_datum = datetime('now'), updated_at = datetime('now')
           WHERE id = ?""",
        (rechnung_id,),
    )
    db.commit()

    return {
        "ok": True,
        "versand": "fax",
        "fax_nummer": normalize_fax_number(fax_nummer),
        "session_id": result.get("sessionId"),
    }


@router.post("/{rechnung_id}/brief")
async def rechnung_brief(
    rechnung_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Rechnung per Brief ueber LetterXpress versenden.

    1. Rechnung laden, Lexoffice-ID pruefen
    2. PDF von Lexoffice holen (gleicher Weg wie beim Fax)
    3. Per LetterXpress als Brief versenden
    4. Versand-Status in DB aktualisieren
    """
    # Rechnung laden
    rechnung = db.execute(
        "SELECT * FROM rechnungen WHERE id = ?", (rechnung_id,)
    ).fetchone()
    if not rechnung:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")

    lexoffice_id = rechnung.get("lexoffice_id")
    if not lexoffice_id:
        raise HTTPException(
            status_code=400,
            detail="Rechnung hat keine Lexoffice-ID. Bitte zuerst in Lexoffice exportieren.",
        )

    # PDF von Lexoffice holen
    api_key = _get_api_key(db)
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}

    async with httpx.AsyncClient(timeout=30) as client:
        # Schritt 1: documentFileId holen
        doc_res = await client.get(
            f"{LEXOFFICE_BASE}/invoices/{lexoffice_id}/document",
            headers=headers,
        )
        if doc_res.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Lexoffice: Rechnungsdokument nicht abrufbar (HTTP {doc_res.status_code})",
            )
        document_file_id = doc_res.json().get("documentFileId")
        if not document_file_id:
            raise HTTPException(
                status_code=502,
                detail="Lexoffice: Keine documentFileId erhalten. Rechnung evtl. nicht finalisiert?",
            )

        # Schritt 2: PDF-Datei herunterladen
        pdf_res = await client.get(
            f"{LEXOFFICE_BASE}/files/{document_file_id}",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if pdf_res.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Lexoffice: PDF-Download fehlgeschlagen (HTTP {pdf_res.status_code})",
            )
        pdf_bytes = pdf_res.content

    # Brief per LetterXpress versenden
    logger.info(f"Briefversand Rechnung {rechnung_id} ({len(pdf_bytes)} Bytes)")
    result = await lxp_service.send_brief(db, pdf_bytes, {
        "farbe": False,
        "duplex": True,
        "versandart": "national",
    })

    # Job-ID aus Antwort extrahieren
    job_id = None
    if result.get("letter") and result["letter"].get("job_id"):
        job_id = result["letter"]["job_id"]
    elif result.get("id"):
        job_id = result["id"]

    # Versand-Status in DB aktualisieren
    db.execute(
        """UPDATE rechnungen
           SET versand_art = 'brief', versand_datum = datetime('now'),
               status = 'versendet', updated_at = datetime('now')
           WHERE id = ?""",
        (rechnung_id,),
    )
    db.commit()

    return {
        "ok": True,
        "versand": "brief",
        "job_id": job_id,
        "letter": result.get("letter"),
    }


@router.post("/{rechnung_id}/lexoffice")
async def rechnung_lexoffice(
    rechnung_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Rechnung in Lexoffice exportieren (Platzhalter, Phase 3)."""
    existing = db.execute("SELECT id FROM rechnungen WHERE id = ?", (rechnung_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")
    raise HTTPException(status_code=501, detail="Noch nicht implementiert")
