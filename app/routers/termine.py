"""Router: Termine-CRUD + Google-Kalender-Import."""

import json
import sqlite3
import httpx
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from app.auth import get_current_user, get_db
from app.models import TerminCreate, TerminUpdate, TerminResponse

logger = logging.getLogger("entlast.termine")

router = APIRouter(prefix="/termine", tags=["termine"])


def _row_to_response(row: dict) -> TerminResponse:
    # wiederholungs_muster: JSON-String aus DB -> dict fuer Response
    muster_raw = row.get("wiederholungs_muster")
    muster_dict = None
    if muster_raw:
        try:
            muster_dict = json.loads(muster_raw)
        except (json.JSONDecodeError, TypeError):
            muster_dict = None

    return TerminResponse(
        id=row["id"],
        kunde_id=row["kunde_id"],
        datum=row["datum"],
        von=row.get("von"),
        bis=row.get("bis"),
        startzeit=row.get("von"),
        endzeit=row.get("bis"),
        titel=row.get("titel"),
        notiz=row.get("notiz"),
        notizen=row.get("notiz"),
        erledigt=bool(row.get("erledigt", 0)),
        wiederkehrend=row.get("wiederkehrend", 0),
        wiederholungsMuster=muster_dict,
        created_at=row.get("created_at"),
    )


def _week_to_date_range(woche: str) -> tuple[str, str]:
    """Wandelt ISO-Woche (z.B. '2026-W12') in Start- und Enddatum um."""
    year, week_num = woche.split("-W")
    start = datetime.strptime(f"{year}-W{int(week_num):02d}-1", "%Y-W%W-%w")
    end = start + timedelta(days=6)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


@router.get("", response_model=list[TerminResponse])
async def liste_termine(
    datum: str | None = Query(None, description="Datum (YYYY-MM-DD)"),
    woche: str | None = Query(None, description="ISO-Woche, z.B. 2026-W12"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Alle Termine auflisten, optional gefiltert nach Datum oder Woche."""
    if datum:
        rows = db.execute(
            "SELECT * FROM termine WHERE datum = ? ORDER BY von",
            (datum,),
        ).fetchall()
    elif woche:
        try:
            start, end = _week_to_date_range(woche)
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="Ungueltiges Wochenformat. Erwartet: YYYY-Www")
        rows = db.execute(
            "SELECT * FROM termine WHERE datum BETWEEN ? AND ? ORDER BY datum, von",
            (start, end),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM termine ORDER BY datum DESC, von").fetchall()
    return [_row_to_response(r) for r in rows]


@router.get("/{termin_id}", response_model=TerminResponse)
async def get_termin(
    termin_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Einzelnen Termin laden."""
    row = db.execute("SELECT * FROM termine WHERE id = ?", (termin_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden")
    return _row_to_response(row)


@router.post("", response_model=TerminResponse, status_code=201)
async def create_termin(
    termin: TerminCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Neuen Termin anlegen."""
    # Kunde existiert?
    kunde = db.execute("SELECT id FROM kunden WHERE id = ?", (termin.kunde_id,)).fetchone()
    if not kunde:
        raise HTTPException(status_code=400, detail="Kunde nicht gefunden")

    # wiederholungs_muster: dict/str -> JSON-String fuer DB
    muster = termin.wiederholungs_muster
    if muster is not None and not isinstance(muster, str):
        muster = json.dumps(muster)

    cursor = db.execute(
        """INSERT INTO termine (kunde_id, datum, von, bis, titel, notiz, erledigt, wiederkehrend, wiederholungs_muster)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            termin.kunde_id,
            termin.datum,
            termin.von,
            termin.bis,
            termin.titel,
            termin.notiz,
            1 if termin.erledigt else 0,
            termin.wiederkehrend or 0,
            muster,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM termine WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_response(row)


@router.put("/{termin_id}", response_model=TerminResponse)
async def update_termin(
    termin_id: int,
    termin: TerminUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Termin aktualisieren (Partial Update)."""
    existing = db.execute("SELECT id FROM termine WHERE id = ?", (termin_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden")

    data = termin.model_dump(exclude_unset=True)
    if not data:
        row = db.execute("SELECT * FROM termine WHERE id = ?", (termin_id,)).fetchone()
        return _row_to_response(row)

    # Boolean-Feld umwandeln
    if "erledigt" in data:
        data["erledigt"] = 1 if data["erledigt"] else 0

    # wiederholungs_muster: dict/str -> JSON-String fuer DB
    if "wiederholungs_muster" in data and data["wiederholungs_muster"] is not None:
        if not isinstance(data["wiederholungs_muster"], str):
            data["wiederholungs_muster"] = json.dumps(data["wiederholungs_muster"])

    set_clause = ", ".join(f"{k} = ?" for k in data)
    values = list(data.values())
    values.append(termin_id)

    db.execute(f"UPDATE termine SET {set_clause} WHERE id = ?", values)
    db.commit()

    row = db.execute("SELECT * FROM termine WHERE id = ?", (termin_id,)).fetchone()
    return _row_to_response(row)


@router.delete("/{termin_id}")
async def delete_termin(
    termin_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Termin loeschen."""
    existing = db.execute("SELECT id FROM termine WHERE id = ?", (termin_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden")

    db.execute("DELETE FROM termine WHERE id = ?", (termin_id,))
    db.commit()
    return {"ok": True}


@router.post("/google-sync")
async def google_sync(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Google-Kalender via iCal-URL importieren."""
    url_row = db.execute("SELECT value FROM settings WHERE key = 'gcal_ical_url'").fetchone()
    url = url_row["value"] if url_row else None
    if not url:
        raise HTTPException(400, "Keine Google Kalender-URL konfiguriert (Einstellungen)")

    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(url)
    if res.status_code != 200:
        raise HTTPException(502, f"Google Kalender nicht erreichbar: HTTP {res.status_code}")

    ical_text = res.text
    neu = 0
    aktualisiert = 0

    # Einfacher iCal-Parser (VEVENT-Blöcke)
    events = ical_text.split("BEGIN:VEVENT")
    for event_block in events[1:]:  # Erstes Element ist Header
        lines = {}
        for line in event_block.split("\n"):
            line = line.strip()
            if ":" in line:
                key, _, val = line.partition(":")
                # Entferne Parameter wie DTSTART;VALUE=DATE
                key = key.split(";")[0]
                lines[key] = val

        uid = lines.get("UID", "")
        summary = lines.get("SUMMARY", "").replace("\\,", ",").replace("\\n", " ")
        if not summary:
            continue

        # Datum parsen
        dtstart = lines.get("DTSTART", "")
        dtend = lines.get("DTEND", "")
        # Ganztägig: 20260407 oder mit Zeit: 20260407T090000Z
        if len(dtstart) == 8:
            datum = f"{dtstart[:4]}-{dtstart[4:6]}-{dtstart[6:8]}"
            startzeit = None
            endzeit = None
        elif "T" in dtstart:
            datum = f"{dtstart[:4]}-{dtstart[4:6]}-{dtstart[6:8]}"
            startzeit = f"{dtstart[9:11]}:{dtstart[11:13]}"
            endzeit = f"{dtend[9:11]}:{dtend[11:13]}" if dtend and "T" in dtend else None
        else:
            continue

        location = lines.get("LOCATION", "").replace("\\,", ",")
        description = lines.get("DESCRIPTION", "").replace("\\n", "\n").replace("\\,", ",")

        # Prüfe ob Termin schon existiert (über google_uid)
        existing = db.execute(
            "SELECT id FROM termine WHERE google_uid = ?", (uid,)
        ).fetchone()

        if existing:
            db.execute(
                "UPDATE termine SET titel=?, datum=?, von=?, bis=?, notiz=? WHERE id=?",
                (summary, datum, startzeit, endzeit, description or location or None, existing["id"]),
            )
            aktualisiert += 1
        else:
            db.execute(
                "INSERT INTO termine (titel, datum, von, bis, notiz, google_uid) VALUES (?, ?, ?, ?, ?, ?)",
                (summary, datum, startzeit, endzeit, description or location or None, uid),
            )
            neu += 1

    db.commit()
    logger.info(f"Google-Sync: {neu} neu, {aktualisiert} aktualisiert")
    return {"message": f"Google-Sync: {neu} neu, {aktualisiert} aktualisiert", "neu": neu, "aktualisiert": aktualisiert}
