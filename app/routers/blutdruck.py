"""Router: Blutdruck-Messwerte (CRUD) + Entwicklung/Verlauf.

Blutdruckwerte sind Gesundheitsdaten (Art. 9 DSGVO) und werden nur zur
Dokumentation der Betreuung erfasst. Die Bewertung folgt den Grenzwerten
der Deutschen Hochdruckliga bzw. ESC/ESH (Praxismessung).
"""

import sqlite3
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user, get_db
from app.models import (
    BlutdruckCreate,
    BlutdruckDurchschnitt,
    BlutdruckPeriode,
    BlutdruckResponse,
    BlutdruckTrend,
    BlutdruckUpdate,
    BlutdruckVerlaufResponse,
)

router = APIRouter(prefix="/blutdruck", tags=["blutdruck"])

# Kategorien nach Deutscher Hochdruckliga / ESC (Praxismessung, mmHg).
# Reihenfolge = Stufe: 0 = niedrig ... 6 = schwere Hypertonie.
KATEGORIEN = [
    ("hypotonie", "Hypotonie", "#2563eb"),
    ("optimal", "Optimal", "#16a34a"),
    ("normal", "Normal", "#65a30d"),
    ("hoch_normal", "Hochnormal", "#ca8a04"),
    ("hypertonie_1", "Hypertonie Grad 1", "#ea580c"),
    ("hypertonie_2", "Hypertonie Grad 2", "#dc2626"),
    ("hypertonie_3", "Hypertonie Grad 3", "#991b1b"),
]

# Ab hier gilt eine Messung als erhoeht (Hypertonie Grad 1)
GRENZE_SYS = 140
GRENZE_DIA = 90

# Ab diesen Werten ist eine aerztliche Abklaerung angezeigt
KRISE_SYS = 180
KRISE_DIA = 120

# Trend-Schwellen in mmHg: darunter gilt die Entwicklung als stabil
TREND_SCHWELLE_SYS = 5.0
TREND_SCHWELLE_DIA = 3.0


def _stufe(systolisch: float, diastolisch: float) -> int:
    """Kategorie-Stufe einer Messung. Der hoehere der beiden Werte entscheidet."""
    if systolisch >= 180 or diastolisch >= 110:
        return 6
    if systolisch >= 160 or diastolisch >= 100:
        return 5
    if systolisch >= GRENZE_SYS or diastolisch >= GRENZE_DIA:
        return 4
    if systolisch >= 130 or diastolisch >= 85:
        return 3
    if systolisch >= 120 or diastolisch >= 80:
        return 2
    if systolisch < 100 or diastolisch < 60:
        return 0
    return 1


def bewerten(systolisch: float, diastolisch: float) -> tuple[str, str, str]:
    """Gibt (Schluessel, Anzeigetext, Farbe) fuer ein Wertepaar zurueck."""
    return KATEGORIEN[_stufe(systolisch, diastolisch)]


def _row_to_response(row: dict) -> BlutdruckResponse:
    key, label, farbe = bewerten(row["systolisch"], row["diastolisch"])
    return BlutdruckResponse(
        id=row["id"],
        kunde_id=row["kunde_id"],
        datum=row["datum"],
        zeit=row.get("zeit"),
        systolisch=row["systolisch"],
        diastolisch=row["diastolisch"],
        puls=row.get("puls"),
        notiz=row.get("notiz"),
        kategorie=key,
        kategorie_label=label,
        kategorie_farbe=farbe,
        created_at=row.get("created_at"),
    )


def _kunde_pruefen(db: sqlite3.Connection, kunde_id: int) -> dict:
    kunde = db.execute(
        "SELECT id, name, vorname FROM kunden WHERE id = ?", (kunde_id,)
    ).fetchone()
    if not kunde:
        raise HTTPException(status_code=400, detail="Kunde nicht gefunden")
    return kunde


@router.get("", response_model=list[BlutdruckResponse])
async def liste_blutdruck(
    kunde_id: int | None = Query(None, description="Filter nach Kunde"),
    von: str | None = Query(None, description="Ab Datum (YYYY-MM-DD)"),
    bis: str | None = Query(None, description="Bis Datum (YYYY-MM-DD)"),
    limit: int = Query(500, ge=1, le=5000, description="Maximale Anzahl Messungen"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Messwerte auflisten, neueste zuerst — optional nach Kunde und Zeitraum."""
    sql = "SELECT * FROM blutdruck"
    bedingungen = []
    werte: list = []

    if kunde_id:
        bedingungen.append("kunde_id = ?")
        werte.append(kunde_id)
    if von:
        bedingungen.append("datum >= ?")
        werte.append(von)
    if bis:
        bedingungen.append("datum <= ?")
        werte.append(bis)

    if bedingungen:
        sql += " WHERE " + " AND ".join(bedingungen)
    sql += " ORDER BY datum DESC, zeit DESC, id DESC LIMIT ?"
    werte.append(limit)

    rows = db.execute(sql, werte).fetchall()
    return [_row_to_response(r) for r in rows]


@router.get("/verlauf", response_model=BlutdruckVerlaufResponse)
async def blutdruck_verlauf(
    kunde_id: int = Query(..., description="Kunde, dessen Entwicklung berechnet wird"),
    tage: int = Query(90, ge=7, le=3650, description="Zeitraum in Tagen (ab heute rueckwaerts)"),
    gruppierung: str = Query("auto", description="auto | woche | monat"),
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Entwicklung der Blutdruckwerte eines Kunden: Mittelwerte, Trend, Perioden."""
    if gruppierung not in ("auto", "woche", "monat"):
        raise HTTPException(status_code=400, detail="Gruppierung muss auto, woche oder monat sein")

    kunde = _kunde_pruefen(db, kunde_id)
    kunde_name = " ".join(p for p in [kunde.get("vorname"), kunde.get("name")] if p) or None

    start = (date.today() - timedelta(days=tage)).isoformat()
    rows = db.execute(
        "SELECT * FROM blutdruck WHERE kunde_id = ? AND datum >= ? "
        "ORDER BY datum ASC, zeit ASC, id ASC",
        (kunde_id, start),
    ).fetchall()

    messungen = [_row_to_response(r) for r in rows]

    if not messungen:
        return BlutdruckVerlaufResponse(
            kunde_id=kunde_id,
            kunde_name=kunde_name,
            von=start,
            bis=date.today().isoformat(),
            trend=BlutdruckTrend(richtung="unbekannt", label="Noch keine Messungen im Zeitraum"),
        )

    sys_werte = [m.systolisch for m in messungen]
    dia_werte = [m.diastolisch for m in messungen]
    puls_werte = [m.puls for m in messungen if m.puls is not None]

    durchschnitt = BlutdruckDurchschnitt(
        systolisch=round(sum(sys_werte) / len(sys_werte), 1),
        diastolisch=round(sum(dia_werte) / len(dia_werte), 1),
        puls=round(sum(puls_werte) / len(puls_werte), 1) if puls_werte else None,
    )
    kat_key, kat_label, kat_farbe = bewerten(durchschnitt.systolisch, durchschnitt.diastolisch)

    verteilung: dict[str, int] = {}
    for m in messungen:
        verteilung[m.kategorie] = verteilung.get(m.kategorie, 0) + 1

    erhoeht = sum(
        1 for m in messungen if m.systolisch >= GRENZE_SYS or m.diastolisch >= GRENZE_DIA
    )

    return BlutdruckVerlaufResponse(
        kunde_id=kunde_id,
        kunde_name=kunde_name,
        von=messungen[0].datum,
        bis=messungen[-1].datum,
        anzahl=len(messungen),
        durchschnitt=durchschnitt,
        kategorie=kat_key,
        kategorie_label=kat_label,
        kategorie_farbe=kat_farbe,
        max_systolisch=max(sys_werte),
        min_systolisch=min(sys_werte),
        max_diastolisch=max(dia_werte),
        min_diastolisch=min(dia_werte),
        verteilung=verteilung,
        anteil_erhoeht=round(100 * erhoeht / len(messungen), 1),
        trend=_trend_berechnen(messungen),
        perioden=_perioden_berechnen(messungen, gruppierung),
        messungen=messungen,
        warnungen=_warnungen_sammeln(messungen),
    )


def _mittel(werte: list[float]) -> float:
    return round(sum(werte) / len(werte), 1)


def _trend_berechnen(messungen: list[BlutdruckResponse]) -> BlutdruckTrend:
    """Vergleicht die juengere mit der aelteren Haelfte und schaetzt die Steigung.

    Die Messungen muessen chronologisch aufsteigend sortiert sein.
    """
    if len(messungen) < 2:
        return BlutdruckTrend(
            richtung="unbekannt",
            label="Zu wenige Messungen fuer einen Trend",
        )

    mitte = len(messungen) // 2
    alt, neu = messungen[:mitte], messungen[mitte:]

    frueher = BlutdruckDurchschnitt(
        systolisch=_mittel([m.systolisch for m in alt]),
        diastolisch=_mittel([m.diastolisch for m in alt]),
        puls=_mittel([m.puls for m in alt if m.puls is not None]) if any(m.puls for m in alt) else None,
    )
    zuletzt = BlutdruckDurchschnitt(
        systolisch=_mittel([m.systolisch for m in neu]),
        diastolisch=_mittel([m.diastolisch for m in neu]),
        puls=_mittel([m.puls for m in neu if m.puls is not None]) if any(m.puls for m in neu) else None,
    )

    delta_sys = round(zuletzt.systolisch - frueher.systolisch, 1)
    delta_dia = round(zuletzt.diastolisch - frueher.diastolisch, 1)

    # Richtung: der systolische Wert entscheidet, solange er sich merklich
    # bewegt — sonst greift der diastolische.
    if abs(delta_sys) >= TREND_SCHWELLE_SYS:
        massgeblich = delta_sys
    elif abs(delta_dia) >= TREND_SCHWELLE_DIA:
        massgeblich = delta_dia
    else:
        massgeblich = 0.0

    if massgeblich > 0:
        richtung = "steigend"
        label = f"Steigend ({delta_sys:+.0f}/{delta_dia:+.0f} mmHg)"
    elif massgeblich < 0:
        richtung = "fallend"
        label = f"Fallend ({delta_sys:+.0f}/{delta_dia:+.0f} mmHg)"
    else:
        richtung = "stabil"
        label = f"Stabil ({delta_sys:+.0f}/{delta_dia:+.0f} mmHg)"

    sys_pro_monat, dia_pro_monat = _steigung_pro_monat(messungen)

    return BlutdruckTrend(
        richtung=richtung,
        label=label,
        delta_systolisch=delta_sys,
        delta_diastolisch=delta_dia,
        sys_pro_monat=sys_pro_monat,
        dia_pro_monat=dia_pro_monat,
        frueher=frueher,
        zuletzt=zuletzt,
    )


def _steigung_pro_monat(messungen: list[BlutdruckResponse]) -> tuple[float | None, float | None]:
    """Steigung der Regressionsgeraden in mmHg pro 30 Tage (kleinste Quadrate)."""
    tage = [date.fromisoformat(m.datum).toordinal() for m in messungen]
    n = len(tage)
    mittel_x = sum(tage) / n
    nenner = sum((x - mittel_x) ** 2 for x in tage)
    if nenner == 0:  # alle Messungen am selben Tag
        return None, None

    def steigung(werte: list[int]) -> float:
        mittel_y = sum(werte) / n
        zaehler = sum((x - mittel_x) * (y - mittel_y) for x, y in zip(tage, werte))
        return round(30 * zaehler / nenner, 1)

    return steigung([m.systolisch for m in messungen]), steigung([m.diastolisch for m in messungen])


MONATSNAMEN = [
    "Jan", "Feb", "Mrz", "Apr", "Mai", "Jun",
    "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
]


def _perioden_berechnen(
    messungen: list[BlutdruckResponse], gruppierung: str
) -> list[BlutdruckPeriode]:
    """Aggregiert die Messungen zu Wochen- oder Monatsmittelwerten."""
    erste = date.fromisoformat(messungen[0].datum)
    letzte = date.fromisoformat(messungen[-1].datum)

    if gruppierung == "auto":
        # Bis ca. 3 Monate ist die Wochenansicht aussagekraeftiger
        gruppierung = "woche" if (letzte - erste).days <= 92 else "monat"

    gruppen: dict[str, list[BlutdruckResponse]] = {}
    for m in messungen:
        d = date.fromisoformat(m.datum)
        if gruppierung == "woche":
            jahr, kw, _ = d.isocalendar()
            key = f"{jahr}-W{kw:02d}"
        else:
            key = f"{d.year}-{d.month:02d}"
        gruppen.setdefault(key, []).append(m)

    perioden = []
    for key in sorted(gruppen):
        gruppe = gruppen[key]
        daten = [date.fromisoformat(m.datum) for m in gruppe]
        sys_mittel = _mittel([m.systolisch for m in gruppe])
        dia_mittel = _mittel([m.diastolisch for m in gruppe])
        puls_liste = [m.puls for m in gruppe if m.puls is not None]
        kat_key, kat_label, _ = bewerten(sys_mittel, dia_mittel)

        if gruppierung == "woche":
            jahr, kw = key.split("-W")
            label = f"KW {int(kw)}"
        else:
            jahr, monat = key.split("-")
            label = f"{MONATSNAMEN[int(monat) - 1]} {jahr}"

        perioden.append(
            BlutdruckPeriode(
                periode=key,
                label=label,
                von=min(daten).isoformat(),
                bis=max(daten).isoformat(),
                anzahl=len(gruppe),
                systolisch=sys_mittel,
                diastolisch=dia_mittel,
                puls=_mittel(puls_liste) if puls_liste else None,
                kategorie=kat_key,
                kategorie_label=kat_label,
            )
        )
    return perioden


def _datum_de(iso_datum: str) -> str:
    """ISO-Datum als TT.MM.JJJJ — die Warnungen werden unveraendert angezeigt."""
    return date.fromisoformat(iso_datum).strftime("%d.%m.%Y")


def _warnungen_sammeln(messungen: list[BlutdruckResponse]) -> list[str]:
    """Klartext-Hinweise zu auffaelligen Werten im Zeitraum."""
    warnungen = []

    krisen = [m for m in messungen if m.systolisch >= KRISE_SYS or m.diastolisch >= KRISE_DIA]
    if krisen:
        juengste = krisen[-1]
        warnungen.append(
            f"{len(krisen)} Messung(en) ab {KRISE_SYS}/{KRISE_DIA} mmHg, zuletzt am "
            f"{_datum_de(juengste.datum)} ({juengste.systolisch}/{juengste.diastolisch}) — "
            "ärztliche Abklärung empfohlen."
        )

    niedrig = [m for m in messungen if m.systolisch < 90 or m.diastolisch < 50]
    if niedrig:
        juengste = niedrig[-1]
        warnungen.append(
            f"{len(niedrig)} sehr niedrige Messung(en), zuletzt am {_datum_de(juengste.datum)} "
            f"({juengste.systolisch}/{juengste.diastolisch}) — erhöhte Sturzgefahr."
        )

    letzte_drei = messungen[-3:]
    if len(letzte_drei) == 3 and all(
        m.systolisch >= GRENZE_SYS or m.diastolisch >= GRENZE_DIA for m in letzte_drei
    ):
        warnungen.append(
            "Die letzten drei Messungen lagen über 140/90 mmHg — dauerhaft erhöhte Werte."
        )

    return warnungen


@router.get("/{blutdruck_id}", response_model=BlutdruckResponse)
async def get_blutdruck(
    blutdruck_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Einzelne Messung laden."""
    row = db.execute("SELECT * FROM blutdruck WHERE id = ?", (blutdruck_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Messung nicht gefunden")
    return _row_to_response(row)


@router.post("", response_model=BlutdruckResponse, status_code=201)
async def create_blutdruck(
    messung: BlutdruckCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Neue Blutdruckmessung erfassen."""
    _kunde_pruefen(db, messung.kunde_id)

    if messung.systolisch <= messung.diastolisch:
        raise HTTPException(
            status_code=400,
            detail="Der systolische Wert muss größer als der diastolische sein",
        )

    cursor = db.execute(
        """INSERT INTO blutdruck (kunde_id, datum, zeit, systolisch, diastolisch, puls, notiz)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            messung.kunde_id,
            messung.datum,
            messung.zeit,
            messung.systolisch,
            messung.diastolisch,
            messung.puls,
            messung.notiz,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM blutdruck WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_response(row)


@router.put("/{blutdruck_id}", response_model=BlutdruckResponse)
async def update_blutdruck(
    blutdruck_id: int,
    messung: BlutdruckUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Messung aktualisieren (Partial Update)."""
    existing = db.execute("SELECT * FROM blutdruck WHERE id = ?", (blutdruck_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Messung nicht gefunden")

    data = messung.model_dump(exclude_unset=True)
    # Pflichtfelder duerfen nicht auf NULL gesetzt werden
    for pflichtfeld in ("kunde_id", "datum", "systolisch", "diastolisch"):
        if pflichtfeld in data and data[pflichtfeld] is None:
            del data[pflichtfeld]

    if not data:
        return _row_to_response(existing)

    if "kunde_id" in data:
        _kunde_pruefen(db, data["kunde_id"])

    neu_sys = data.get("systolisch", existing["systolisch"])
    neu_dia = data.get("diastolisch", existing["diastolisch"])
    if neu_sys <= neu_dia:
        raise HTTPException(
            status_code=400,
            detail="Der systolische Wert muss größer als der diastolische sein",
        )

    set_clause = ", ".join(f"{k} = ?" for k in data)
    values = list(data.values())
    values.append(blutdruck_id)
    db.execute(f"UPDATE blutdruck SET {set_clause} WHERE id = ?", values)
    db.commit()

    row = db.execute("SELECT * FROM blutdruck WHERE id = ?", (blutdruck_id,)).fetchone()
    return _row_to_response(row)


@router.delete("/{blutdruck_id}")
async def delete_blutdruck(
    blutdruck_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Messung loeschen."""
    existing = db.execute("SELECT id FROM blutdruck WHERE id = ?", (blutdruck_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Messung nicht gefunden")

    db.execute("DELETE FROM blutdruck WHERE id = ?", (blutdruck_id,))
    db.commit()
    return {"ok": True}
