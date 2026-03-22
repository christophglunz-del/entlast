"""Router: Lexoffice-Synchronisation (Kunden + Rechnungen)."""

import sqlite3
import logging
from fastapi import APIRouter, Depends
from app.auth import get_current_user, get_db

logger = logging.getLogger("entlast.lexoffice")

router = APIRouter(prefix="/lexoffice", tags=["lexoffice"])


@router.post("/sync-kunden")
async def sync_kunden(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Kunden von Lexoffice importieren/aktualisieren."""
    from app.services.lexoffice import fetch_contacts

    contacts = await fetch_contacts(db)

    neu = 0
    aktualisiert = 0
    unveraendert = 0

    for c in contacts:
        lex_id = c.get("lexoffice_id", "")
        if not lex_id:
            continue

        # Existiert der Kontakt schon?
        existing = db.execute(
            "SELECT id, name, vorname, strasse, plz, ort, telefon, email FROM kunden WHERE lexoffice_id = ?",
            (lex_id,),
        ).fetchone()

        if existing:
            # Pruefen ob sich etwas geaendert hat
            changed = False
            for field in ("name", "vorname", "strasse", "plz", "ort", "telefon", "email"):
                if c.get(field) and c[field] != (existing.get(field) or ""):
                    changed = True
                    break

            if changed:
                db.execute(
                    """UPDATE kunden SET name=?, vorname=?, strasse=?, plz=?, ort=?, telefon=?, email=?,
                       updated_at=datetime('now') WHERE lexoffice_id=?""",
                    (c.get("name", ""), c.get("vorname", ""), c.get("strasse", ""),
                     c.get("plz", ""), c.get("ort", ""), c.get("telefon", ""),
                     c.get("email", ""), lex_id),
                )
                aktualisiert += 1
            else:
                unveraendert += 1
        else:
            # Neuen Kunden anlegen
            db.execute(
                """INSERT INTO kunden (name, vorname, strasse, plz, ort, telefon, email, lexoffice_id, kundentyp)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pflege')""",
                (c.get("name", ""), c.get("vorname", ""), c.get("strasse", ""),
                 c.get("plz", ""), c.get("ort", ""), c.get("telefon", ""),
                 c.get("email", ""), lex_id),
            )
            neu += 1

    db.commit()

    msg = []
    if neu:
        msg.append(f"{neu} neu importiert")
    if aktualisiert:
        msg.append(f"{aktualisiert} aktualisiert")
    if unveraendert:
        msg.append(f"{unveraendert} unveraendert")

    summary = ", ".join(msg) if msg else "Keine Kontakte gefunden"
    logger.info(f"Lexoffice Kunden-Sync: {summary} (User: {user['username']})")

    return {
        "message": f"Lexoffice-Sync: {summary}",
        "neu": neu,
        "aktualisiert": aktualisiert,
        "unveraendert": unveraendert,
    }
