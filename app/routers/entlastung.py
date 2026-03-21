"""Router: Entlastungsbudget-Uebersicht nach Paragraph 45b SGB XI.

Budget: 125 EUR/Monat pro Versichertem.
Uebertrag aus Vorjahr moeglich bis 30.06. des Folgejahres.
"""

import json
import sqlite3
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from app.auth import get_current_user, get_db

router = APIRouter(prefix="/entlastung", tags=["entlastung"])

MONATS_BUDGET = 125.00  # EUR pro Monat nach Paragraph 45b


def _berechne_budget(
    db: sqlite3.Connection,
    kunde_id: int,
    jahr: int,
) -> dict:
    """Berechnet das Entlastungsbudget fuer einen Kunden in einem Jahr."""
    # Rechnungen des laufenden Jahres
    rechnungen_laufend = db.execute(
        "SELECT monat, betrag_netto FROM rechnungen WHERE kunde_id = ? AND jahr = ? ORDER BY monat",
        (kunde_id, jahr),
    ).fetchall()

    # Rechnungen des Vorjahres
    rechnungen_vorjahr = db.execute(
        "SELECT monat, betrag_netto FROM rechnungen WHERE kunde_id = ? AND jahr = ? ORDER BY monat",
        (kunde_id, jahr - 1),
    ).fetchall()

    # Jahresbudget
    jahres_budget = MONATS_BUDGET * 12  # 1500 EUR

    # Vorjahr: abgerechneter Betrag
    vorjahr_abgerechnet = sum(r.get("betrag_netto") or 0 for r in rechnungen_vorjahr)
    vorjahr_rest = max(0, jahres_budget - vorjahr_abgerechnet)

    # Uebertrag verfuegbar bis 30.06.
    heute = date.today()
    stichtag = date(jahr, 6, 30)
    uebertrag_verfuegbar = vorjahr_rest if heute <= stichtag else 0.0

    # Laufendes Jahr: abgerechneter Betrag
    laufend_abgerechnet = sum(r.get("betrag_netto") or 0 for r in rechnungen_laufend)

    # Gesamtbudget = Jahresbudget + Uebertrag
    gesamt_budget = jahres_budget + uebertrag_verfuegbar
    verfuegbar = max(0, gesamt_budget - laufend_abgerechnet)

    # Monatsaufschluesselung
    vorjahr_monate = {str(r["monat"]): r.get("betrag_netto") or 0 for r in rechnungen_vorjahr}
    laufend_monate = {str(r["monat"]): r.get("betrag_netto") or 0 for r in rechnungen_laufend}

    return {
        "jahres_budget": jahres_budget,
        "vorjahr_abgerechnet": vorjahr_abgerechnet,
        "vorjahr_rest": vorjahr_rest,
        "uebertrag_verfuegbar": uebertrag_verfuegbar,
        "laufend_abgerechnet": laufend_abgerechnet,
        "gesamt_budget": gesamt_budget,
        "verfuegbar": verfuegbar,
        "vorjahr_monate": vorjahr_monate,
        "laufend_monate": laufend_monate,
    }


@router.get("")
async def entlastung_uebersicht(
    jahr: int | None = Query(None, description="Bezugsjahr (Standard: aktuelles Jahr)"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Budget-Uebersicht aller Pflege-Kunden (Paragraph 45b: 125 EUR/Monat)."""
    if not jahr:
        jahr = date.today().year

    kunden = db.execute(
        "SELECT id, name, pflegekasse FROM kunden WHERE kundentyp = 'pflege' AND aktiv = 1 ORDER BY name"
    ).fetchall()

    versicherte = {}
    for kunde in kunden:
        budget = _berechne_budget(db, kunde["id"], jahr)
        versicherte[kunde["name"]] = {
            "kunde_id": kunde["id"],
            "kasse": kunde.get("pflegekasse"),
            **budget,
        }

    return {
        "aktuelles_jahr": jahr,
        "vorjahr": jahr - 1,
        "monats_budget": MONATS_BUDGET,
        "versicherte": versicherte,
    }


@router.get("/{kunde_id}")
async def entlastung_detail(
    kunde_id: int,
    jahr: int | None = Query(None, description="Bezugsjahr (Standard: aktuelles Jahr)"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Detail-Ansicht: Entlastungsbudget fuer einen Kunden."""
    if not jahr:
        jahr = date.today().year

    kunde = db.execute("SELECT * FROM kunden WHERE id = ?", (kunde_id,)).fetchone()
    if not kunde:
        raise HTTPException(status_code=404, detail="Kunde nicht gefunden")

    budget = _berechne_budget(db, kunde_id, jahr)

    return {
        "kunde_id": kunde_id,
        "name": kunde["name"],
        "pflegekasse": kunde.get("pflegekasse"),
        "aktuelles_jahr": jahr,
        "vorjahr": jahr - 1,
        "monats_budget": MONATS_BUDGET,
        **budget,
    }
