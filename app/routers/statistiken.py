"""Router: Dashboard-Statistiken."""

import json
import sqlite3
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from app.auth import get_current_user, get_db

router = APIRouter(tags=["statistiken"])


@router.get("/statistiken")
async def get_statistiken(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    heute = date.today().isoformat()

    kunden = db.execute("SELECT COUNT(*) as c FROM kunden WHERE aktiv = 1").fetchone()["c"]
    leistungen = db.execute("SELECT COUNT(*) as c FROM leistungen").fetchone()["c"]
    offene_rechnungen = db.execute(
        "SELECT COUNT(*) as c FROM rechnungen WHERE status IN ('entwurf', 'offen')"
    ).fetchone()["c"]
    heute_termine = db.execute(
        "SELECT COUNT(*) as c FROM termine WHERE datum = ?", (heute,)
    ).fetchone()["c"]

    # Nicht abgerechnete Leistungen: Leistungen aus abgelaufenen Monaten
    # ohne zugehörige Rechnung. "Überfällig" = Monat ist vorbei.
    # Erster Tag des aktuellen Monats = Stichtag
    erster_des_monats = date.today().replace(day=1).isoformat()
    leistungen_nicht_abgerechnet = db.execute(
        "SELECT COUNT(DISTINCT l.kunde_id || '-' || substr(l.datum, 1, 7)) as c "
        "FROM leistungen l "
        "WHERE l.datum < ? "
        "AND NOT EXISTS ("
        "  SELECT 1 FROM rechnungen r "
        "  WHERE r.kunde_id = l.kunde_id "
        "  AND r.monat = CAST(substr(l.datum, 6, 2) AS INTEGER) "
        "  AND r.jahr = CAST(substr(l.datum, 1, 4) AS INTEGER)"
        ")",
        (erster_des_monats,),
    ).fetchone()["c"]

    rechnungen_ueberfaellig = db.execute(
        "SELECT COUNT(*) as c FROM rechnungen WHERE status='offen' "
        "AND datum < date('now', '-30 days')"
    ).fetchone()["c"]
    termine_diese_woche = db.execute(
        "SELECT COUNT(*) as c FROM termine WHERE datum BETWEEN date('now') AND date('now', '+7 days')"
    ).fetchone()["c"]

    # Unterschrift-Erinnerungen: wiederkehrende Termine heute,
    # deren naechster Termin (datum + intervall Wochen) in einem anderen Monat liegt
    heute_obj = date.today()
    alle_wdh = db.execute(
        "SELECT datum, wiederholungs_muster FROM termine WHERE wiederkehrend = 1"
    ).fetchall()
    unterschrift_count = 0
    heute_wochentag = heute_obj.isoweekday()  # 1=Mo, 7=So
    for t in alle_wdh:
        muster = json.loads(t["wiederholungs_muster"] or "{}")
        wochentag = muster.get("wochentag")
        if wochentag is None or wochentag != heute_wochentag:
            continue
        intervall = muster.get("intervall", 1)
        # Intervall pruefen: Wochen seit Startdatum muessen durch Intervall teilbar sein
        if intervall > 1 and t["datum"]:
            start = date.fromisoformat(t["datum"])
            diff_days = (heute_obj - start).days
            diff_wochen = round(diff_days / 7)
            if diff_wochen < 0 or diff_wochen % intervall != 0:
                continue
        naechster = heute_obj + timedelta(days=7 * intervall)
        if naechster.month != heute_obj.month:
            unterschrift_count += 1

    return {
        "kunden": kunden,
        "leistungen": leistungen,
        "offene_rechnungen": offene_rechnungen,
        "heute_termine": heute_termine,
        "leistungen_nicht_abgerechnet": leistungen_nicht_abgerechnet,
        "rechnungen_ueberfaellig": rechnungen_ueberfaellig,
        "termine_diese_woche": termine_diese_woche,
        "unterschrift_erinnerungen": unterschrift_count,
    }
