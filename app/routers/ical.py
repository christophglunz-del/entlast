"""Router: ICS-Kalender-Feed fuer Kalender-Apps."""

import sqlite3
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from app.database import get_auth_db, get_mandant_db

router = APIRouter(tags=["ical"])


@router.get("/ical/{mandant}")
async def ical_feed(mandant: str):
    """ICS-Feed fuer einen Mandanten (kein Login noetig, URL ist Secret).

    Liefert alle Termine als iCalendar-Datei.
    """
    # Mandant-DB ermitteln (exakter Match auf db_datei, kein LIKE)
    # Sonderzeichen in mandant werden nicht toleriert — nur alphanumerisch + Bindestrich + Unterstrich
    import re
    if not re.match(r'^[a-zA-Z0-9_-]+$', mandant):
        raise HTTPException(status_code=400, detail="Ungueltiger Mandant-Name")

    auth_db = get_auth_db()
    try:
        m = auth_db.execute(
            "SELECT db_datei FROM mandanten WHERE db_datei = ? AND aktiv = 1",
            (f"mandant_{mandant}.db",),
        ).fetchone()
        # Fallback: exakter Match auf db_datei direkt
        if not m:
            m = auth_db.execute(
                "SELECT db_datei FROM mandanten WHERE db_datei = ? AND aktiv = 1",
                (f"{mandant}.db",),
            ).fetchone()
    finally:
        auth_db.close()

    if not m:
        raise HTTPException(status_code=404, detail="Mandant nicht gefunden")

    db = get_mandant_db(m["db_datei"])
    try:
        termine = db.execute(
            "SELECT t.*, k.name as kunde_name FROM termine t LEFT JOIN kunden k ON t.kunde_id = k.id ORDER BY datum"
        ).fetchall()

        firma = db.execute("SELECT name FROM firma WHERE id = 1").fetchone()
        firma_name = firma["name"] if firma and firma.get("name") else "entlast.de"
    finally:
        db.close()

    # ICS generieren
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:-//{firma_name}//entlast.de//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{firma_name} Termine",
    ]

    for t in termine:
        uid = f"termin-{t['id']}@entlast.de"
        datum = t["datum"].replace("-", "")
        von = (t.get("von") or "0800").replace(":", "")
        bis = (t.get("bis") or "0900").replace(":", "")

        summary = t.get("titel") or "Termin"
        if t.get("kunde_name"):
            summary = f"{summary} - {t['kunde_name']}"

        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{uid}")
        lines.append(f"DTSTART:{datum}T{von}00")
        lines.append(f"DTEND:{datum}T{bis}00")
        lines.append(f"SUMMARY:{summary}")
        if t.get("notiz"):
            # Escape newlines in description
            desc = t["notiz"].replace("\n", "\\n")
            lines.append(f"DESCRIPTION:{desc}")
        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")

    ics_content = "\r\n".join(lines)
    return Response(
        content=ics_content,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{mandant}.ics"'},
    )
