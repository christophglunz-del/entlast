"""Router: JSON-Backup Export/Import."""

import json
import sqlite3
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from app.auth import get_current_user, get_db

router = APIRouter(tags=["export"])


@router.get("/export")
async def export_alles(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Komplettes JSON-Backup aller Daten des Mandanten."""
    kunden = db.execute("SELECT * FROM kunden ORDER BY id").fetchall()
    leistungen = db.execute("SELECT * FROM leistungen ORDER BY id").fetchall()
    fahrten = db.execute("SELECT * FROM fahrten ORDER BY id").fetchall()
    termine = db.execute("SELECT * FROM termine ORDER BY id").fetchall()
    abtretungen = db.execute("SELECT * FROM abtretungen ORDER BY id").fetchall()
    rechnungen = db.execute("SELECT * FROM rechnungen ORDER BY id").fetchall()
    settings = db.execute("SELECT * FROM settings ORDER BY key").fetchall()
    firma = db.execute("SELECT * FROM firma WHERE id = 1").fetchone()

    return {
        "export_datum": datetime.now().isoformat(),
        "version": "1.0",
        "firma": firma,
        "kunden": kunden,
        "leistungen": leistungen,
        "fahrten": fahrten,
        "termine": termine,
        "abtretungen": abtretungen,
        "rechnungen": rechnungen,
        "settings": settings,
        "counts": {
            "kunden": len(kunden),
            "leistungen": len(leistungen),
            "fahrten": len(fahrten),
            "termine": len(termine),
            "abtretungen": len(abtretungen),
            "rechnungen": len(rechnungen),
            "settings": len(settings),
        },
    }


@router.post("/import")
async def import_alles(
    data: dict,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """JSON-Restore: Importiert alle Daten (ACHTUNG: ueberschreibt bestehende Daten)."""
    if user.get("rolle") != "admin":
        raise HTTPException(status_code=403, detail="Nur Admins duerfen importieren")

    counts = {}

    try:
        # Reihenfolge beachten wegen Foreign Keys
        tables = ["rechnungen", "abtretungen", "termine", "fahrten", "leistungen", "kunden"]

        # Bestehende Daten loeschen (in umgekehrter FK-Reihenfolge)
        for table in tables:
            db.execute(f"DELETE FROM {table}")

        # Settings loeschen
        db.execute("DELETE FROM settings")

        # Firma aktualisieren (nicht loeschen, da CHECK id=1)
        if "firma" in data and data["firma"]:
            firma = data["firma"]
            # Nur bekannte Spalten aktualisieren
            firma_cols = [
                "name", "inhaber", "strasse", "plz", "ort", "telefon", "email",
                "steuernummer", "iban", "bic", "bank", "logo_datei",
                "farbe_primary", "farbe_primary_dark", "untertitel", "kleinunternehmer",
            ]
            for col in firma_cols:
                if col in firma:
                    db.execute(f"UPDATE firma SET {col} = ? WHERE id = 1", (firma[col],))

        # Kunden importieren
        if "kunden" in data:
            for row in data["kunden"]:
                db.execute(
                    """INSERT INTO kunden
                       (id, name, vorname, strasse, plz, ort, telefon, email, geburtsdatum,
                        pflegegrad, versichertennummer_encrypted, pflegekasse, pflegekasse_fax,
                        iban_encrypted, kundentyp, aktiv, besonderheiten, lexoffice_id,
                        created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        row.get("id"), row.get("name"), row.get("vorname"),
                        row.get("strasse"), row.get("plz"), row.get("ort"),
                        row.get("telefon"), row.get("email"), row.get("geburtsdatum"),
                        row.get("pflegegrad"), row.get("versichertennummer_encrypted"),
                        row.get("pflegekasse"), row.get("pflegekasse_fax"),
                        row.get("iban_encrypted"), row.get("kundentyp", "pflege"),
                        row.get("aktiv", 1), row.get("besonderheiten"),
                        row.get("lexoffice_id"), row.get("created_at"), row.get("updated_at"),
                    ),
                )
            counts["kunden"] = len(data["kunden"])

        # Leistungen importieren
        if "leistungen" in data:
            for row in data["leistungen"]:
                db.execute(
                    """INSERT INTO leistungen
                       (id, kunde_id, datum, von, bis, dauer_std, leistungsarten, betrag,
                        unterschrift_betreuer, unterschrift_versicherter, notiz, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        row.get("id"), row.get("kunde_id"), row.get("datum"),
                        row.get("von"), row.get("bis"), row.get("dauer_std"),
                        row.get("leistungsarten"), row.get("betrag"),
                        row.get("unterschrift_betreuer"), row.get("unterschrift_versicherter"),
                        row.get("notiz"), row.get("created_at"),
                    ),
                )
            counts["leistungen"] = len(data["leistungen"])

        # Fahrten importieren
        if "fahrten" in data:
            for row in data["fahrten"]:
                db.execute(
                    """INSERT INTO fahrten
                       (id, kunde_id, datum, von_ort, nach_ort, km, betrag, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        row.get("id"), row.get("kunde_id"), row.get("datum"),
                        row.get("von_ort"), row.get("nach_ort"), row.get("km"),
                        row.get("betrag"), row.get("created_at"),
                    ),
                )
            counts["fahrten"] = len(data["fahrten"])

        # Termine importieren
        if "termine" in data:
            for row in data["termine"]:
                db.execute(
                    """INSERT INTO termine
                       (id, kunde_id, datum, von, bis, titel, notiz, erledigt, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        row.get("id"), row.get("kunde_id"), row.get("datum"),
                        row.get("von"), row.get("bis"), row.get("titel"),
                        row.get("notiz"), row.get("erledigt", 0), row.get("created_at"),
                    ),
                )
            counts["termine"] = len(data["termine"])

        # Abtretungen importieren
        if "abtretungen" in data:
            for row in data["abtretungen"]:
                db.execute(
                    """INSERT INTO abtretungen
                       (id, kunde_id, datum, gueltig_ab, gueltig_bis, unterschrift, pflegekasse, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        row.get("id"), row.get("kunde_id"), row.get("datum"),
                        row.get("gueltig_ab"), row.get("gueltig_bis"),
                        row.get("unterschrift"), row.get("pflegekasse"), row.get("created_at"),
                    ),
                )
            counts["abtretungen"] = len(data["abtretungen"])

        # Rechnungen importieren
        if "rechnungen" in data:
            for row in data["rechnungen"]:
                db.execute(
                    """INSERT INTO rechnungen
                       (id, kunde_id, rechnungsnummer, datum, monat, jahr, typ, positionen,
                        betrag_netto, betrag_brutto, status, lexoffice_id, versand_art,
                        versand_datum, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        row.get("id"), row.get("kunde_id"), row.get("rechnungsnummer"),
                        row.get("datum"), row.get("monat"), row.get("jahr"),
                        row.get("typ", "kasse"), row.get("positionen"),
                        row.get("betrag_netto"), row.get("betrag_brutto"),
                        row.get("status", "entwurf"), row.get("lexoffice_id"),
                        row.get("versand_art"), row.get("versand_datum"),
                        row.get("created_at"), row.get("updated_at"),
                    ),
                )
            counts["rechnungen"] = len(data["rechnungen"])

        # Settings importieren
        if "settings" in data:
            for row in data["settings"]:
                db.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?)",
                    (row.get("key"), row.get("value")),
                )
            counts["settings"] = len(data["settings"])

        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Import fehlgeschlagen: {str(e)}")

    return {"ok": True, "counts": counts}
