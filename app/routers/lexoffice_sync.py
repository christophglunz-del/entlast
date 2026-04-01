"""Router: Lexoffice-Synchronisation (Kunden + Rechnungen) + API-Proxy."""

import sqlite3
import asyncio
import logging
import time
import httpx
from datetime import datetime, timedelta
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from app.auth import get_current_user, get_db

logger = logging.getLogger("entlast.lexoffice")

router = APIRouter(prefix="/lexoffice", tags=["lexoffice"])


class RechnungErstellenRequest(BaseModel):
    kunde_id: int
    monat: int
    jahr: int
    empfaenger: str = "kasse"  # 'kasse' oder 'direkt'


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
            "SELECT id, name, vorname, strasse, plz, ort, telefon, email, pflegekasse_fax FROM kunden WHERE lexoffice_id = ?",
            (lex_id,),
        ).fetchone()

        if existing:
            # Pruefen ob sich etwas geaendert hat
            changed = False
            for field in ("name", "vorname", "strasse", "plz", "ort", "telefon", "email", "pflegekasse_fax"):
                if c.get(field) and c[field] != (existing.get(field) or ""):
                    changed = True
                    break

            if changed:
                db.execute(
                    """UPDATE kunden SET name=?, vorname=?, strasse=?, plz=?, ort=?, telefon=?, email=?,
                       pflegekasse_fax=COALESCE(?, pflegekasse_fax),
                       updated_at=datetime('now') WHERE lexoffice_id=?""",
                    (c.get("name", ""), c.get("vorname", ""), c.get("strasse", ""),
                     c.get("plz", ""), c.get("ort", ""), c.get("telefon", ""),
                     c.get("email", ""), c.get("pflegekasse_fax"), lex_id),
                )
                aktualisiert += 1
            else:
                unveraendert += 1
        else:
            # Neuen Kunden anlegen
            db.execute(
                """INSERT INTO kunden (name, vorname, strasse, plz, ort, telefon, email, pflegekasse_fax, lexoffice_id, kundentyp)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pflege')""",
                (c.get("name", ""), c.get("vorname", ""), c.get("strasse", ""),
                 c.get("plz", ""), c.get("ort", ""), c.get("telefon", ""),
                 c.get("email", ""), c.get("pflegekasse_fax"), lex_id),
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


@router.post("/rechnung-erstellen")
async def rechnung_erstellen(
    req: RechnungErstellenRequest,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Rechnung in Lexoffice erstellen: Leistungen laden, Invoice bauen, finalisieren."""
    from app.services.lexoffice import _get_api_key, LEXOFFICE_BASE

    api_key = _get_api_key(db)
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json",
               "Content-Type": "application/json"}

    # Kunde laden
    kunde = db.execute("SELECT * FROM kunden WHERE id = ?", (req.kunde_id,)).fetchone()
    if not kunde:
        raise HTTPException(404, "Kunde nicht gefunden")

    # Firma laden (für Stundensatz)
    firma = db.execute("SELECT * FROM firma WHERE id = 1").fetchone()
    stundensatz = firma["stundensatz"] if firma else 32.75

    # Leistungen für diesen Monat laden
    monat_str = f"{req.jahr}-{req.monat:02d}"
    leistungen = db.execute(
        "SELECT * FROM leistungen WHERE kunde_id = ? AND datum LIKE ?",
        (req.kunde_id, f"{monat_str}%"),
    ).fetchall()

    if not leistungen:
        raise HTTPException(400, f"Keine Leistungen für {monat_str}")

    # Gesamtstunden berechnen
    gesamt_stunden = 0.0
    for l in leistungen:
        start = l.get("von") or l.get("startzeit") or l.get("start_zeit") or ""
        ende = l.get("bis") or l.get("endzeit") or l.get("end_zeit") or ""
        if start and ende:
            sh, sm = map(int, start.split(":"))
            eh, em = map(int, ende.split(":"))
            diff = (eh * 60 + em) - (sh * 60 + sm)
            gesamt_stunden += max(0, diff / 60)

    betrag = round(gesamt_stunden * stundensatz, 2)

    # Variante ermitteln
    besonderheiten = (kunde.get("besonderheiten") or "").lower()
    pflegekasse = kunde.get("pflegekasse") or ""
    if req.empfaenger == "direkt" or not pflegekasse or pflegekasse == "Sonstige":
        variante = "privat"
    elif "lbv" in besonderheiten:
        variante = "lbv"
    else:
        variante = "kasse"

    # Leistungszeitraum
    daten = sorted([l["datum"] for l in leistungen if l.get("datum")])
    start_datum = daten[0] if daten else f"{monat_str}-01"
    end_datum = daten[-1] if daten else f"{monat_str}-28"

    # Fälligkeitsdatum (30 Tage)
    faelligkeit = datetime.now() + timedelta(days=30)
    faelligkeit_str = faelligkeit.strftime("%d.%m.%Y")

    # Adresse je nach Variante
    kunde_name = f"{kunde.get('vorname', '')} {kunde.get('name', '')}".strip()
    if variante == "kasse":
        address = {
            "name": pflegekasse,
            "supplement": f"z. Hd. Leistungsabteilung – Vers.: {kunde_name}",
            "countryCode": "DE",
        }
    else:
        address = {
            "name": kunde_name,
            "street": kunde.get("strasse") or "",
            "zip": kunde.get("plz") or "",
            "city": kunde.get("ort") or "",
            "countryCode": "DE",
        }

    if kunde.get("lexoffice_id"):
        address["contactId"] = kunde["lexoffice_id"]

    # Positionsname
    if variante == "kasse":
        pos_name = kunde_name
        pos_desc = "Betreuung im Alltag nach § 45b SGB XI"
    else:
        pos_name = "Alltagshilfe"
        pos_desc = "Betreuung im Alltag"

    # Remark
    if variante == "kasse":
        remark = (
            "Die Abrechnung erfolgt im Rahmen der Direktabrechnung gemäß der vorliegenden "
            "Abtretungserklärung. Die Leistungen wurden nach § 45b SGB XI (Entlastungsbetrag) als "
            "anerkanntes Angebot zur Unterstützung im Alltag gemäß § 45a SGB XI erbracht. "
            "Die Abtretung der Ansprüche erfolgte nach § 13 SGB V i.\u202fV.\u202fm. § 190 BGB. "
            "Ich bitte um Überweisung auf die in der Rechnung genannte Bankverbindung."
        )
        payment_label = f"Ich bitte um umgehende Zahlung, spätestens jedoch bis zum {faelligkeit_str} (§ 36 Abs. 2 SGB XI)."
    else:
        remark = "Vielen Dank für die gute Zusammenarbeit."
        payment_label = f"Ich bitte um umgehende Zahlung, spätestens jedoch bis zum {faelligkeit_str}."

    # Zeitzone: MESZ (+02:00) von April-Oktober, sonst MEZ (+01:00)
    tz_offset = "+02:00" if 4 <= datetime.now().month <= 10 else "+01:00"

    lex_rechnung = {
        "voucherDate": datetime.now().strftime(f"%Y-%m-%dT%H:%M:%S.000{tz_offset}"),
        "address": address,
        "lineItems": [{
            "type": "custom",  # custom = freie Position (nicht service, das braucht Produkt-ID)
            "name": pos_name,
            "description": pos_desc,
            "quantity": round(gesamt_stunden, 2),
            "unitName": "Stunde(n)",
            "unitPrice": {
                "currency": "EUR",
                "netAmount": stundensatz,
                "taxRatePercentage": 0,
            },
        }],
        "totalPrice": {"currency": "EUR"},
        "taxConditions": {
            "taxType": "vatfree",
            "taxTypeNote": "Umsatzsteuer wird nicht berechnet (§ 19 Abs. 1 UStG)",
        },
        "title": "Rechnung",
        "introduction": "Meine Leistungen stelle ich Ihnen wie folgt in Rechnung.",
        "remark": remark,
        "shippingConditions": {
            "shippingType": "serviceperiod",
            "shippingDate": f"{start_datum}T00:00:00.000+01:00",
            "shippingEndDate": f"{end_datum}T00:00:00.000+01:00",
        },
        "paymentConditions": {
            "paymentTermLabel": payment_label,
            "paymentTermDuration": 30,
        },
    }

    async with httpx.AsyncClient(timeout=30) as client:
        # Rechnung erstellen UND finalisieren in einem Schritt
        res = await client.post(
            f"{LEXOFFICE_BASE}/invoices?finalize=true",
            json=lex_rechnung,
            headers=headers,
        )
        if res.status_code not in (200, 201):
            logger.error(f"Lexoffice createInvoice: {res.status_code} {res.text}")
            raise HTTPException(502, f"Lexoffice-Fehler beim Erstellen: {res.text[:500]}")

        invoice = res.json()
        logger.info(f"Lexoffice createInvoice response: {invoice}")
        invoice_id = invoice.get("id")
        if not invoice_id:
            raise HTTPException(502, "Keine Rechnungs-ID von Lexoffice erhalten")

        # documentFileId aus der Finalize-Response holen
        document_file_id = invoice.get("documentFileId")

        # Falls nicht in der Response: kurz warten und per GET holen
        if not document_file_id:
            await asyncio.sleep(1)
            res2 = await client.get(
                f"{LEXOFFICE_BASE}/invoices/{invoice_id}/document",
                headers=headers,
            )
            if res2.status_code == 200:
                doc = res2.json()
                document_file_id = doc.get("documentFileId")

    # 3. Lokal in DB speichern
    db.execute(
        """INSERT INTO rechnungen (kunde_id, monat, jahr, betrag_brutto, status, lexoffice_id, datum)
           VALUES (?, ?, ?, ?, 'offen', ?, date('now'))""",
        (req.kunde_id, req.monat, req.jahr, betrag, invoice_id),
    )
    db.commit()

    logger.info(f"Rechnung erstellt: {invoice_id} für Kunde {req.kunde_id} ({variante})")

    return {
        "message": "Rechnung in Lexoffice erstellt",
        "lexoffice_id": invoice_id,
        "document_file_id": document_file_id,
        "betrag": betrag,
        "stunden": round(gesamt_stunden, 2),
        "variante": variante,
    }


@router.get("/invoices/{invoice_id}")
async def get_invoice(
    invoice_id: str,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Einzelne Rechnung aus Lexoffice abrufen."""
    from app.services.lexoffice import _get_api_key, LEXOFFICE_BASE

    api_key = _get_api_key(db)
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(
            f"{LEXOFFICE_BASE}/invoices/{invoice_id}",
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
        )
    if res.status_code != 200:
        raise HTTPException(res.status_code, f"Lexoffice: {res.text[:200]}")
    return res.json()


@router.get("/alle-rechnungen")
async def alle_rechnungen(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Alle Rechnungen aus Lexoffice abrufen (GET /v1/voucherlist, paginiert)."""
    from app.services.lexoffice import _get_api_key, LEXOFFICE_BASE

    api_key = _get_api_key(db)
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    rechnungen = []

    async with httpx.AsyncClient(timeout=30) as client:
        for status in ("open", "paid", "paidoff", "voided", "overdue"):
            page = 0
            while True:
                await asyncio.sleep(0.5)  # Rate-Limiting
                res = await client.get(
                    f"{LEXOFFICE_BASE}/voucherlist",
                    params={
                        "page": page,
                        "size": 100,
                        "voucherType": "invoice",
                        "voucherStatus": status,
                        "sort": "voucherDate,DESC",
                    },
                    headers=headers,
                )
                if res.status_code == 429:
                    await asyncio.sleep(2)
                    continue
                if res.status_code != 200:
                    logger.warning(f"Lexoffice voucherlist status={status}: {res.status_code}")
                    break

                data = res.json()
                rechnungen.extend(data.get("content", []))

                if data.get("last", True):
                    break
                page += 1

    # Deduplizieren nach ID (overdue erscheint auch unter open)
    seen = set()
    unique = []
    for r in rechnungen:
        rid = r.get("id")
        if rid and rid not in seen:
            seen.add(rid)
            unique.append(r)

    return unique


# Rate-Limiter: max 2 Requests/Sekunde an Lexoffice
_last_request_time = 0.0
_rate_lock = asyncio.Lock()


@router.get("/proxy/{endpoint:path}")
async def lexoffice_proxy(
    endpoint: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Proxy fuer Lexoffice-API mit Rate-Limiting + Retry."""
    from app.services.lexoffice import _get_api_key, LEXOFFICE_BASE
    global _last_request_time

    api_key = _get_api_key(db)
    params = dict(request.query_params)
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}

    max_retries = 3
    for attempt in range(max_retries):
        # Rate-Limiting: min 500ms zwischen Requests
        async with _rate_lock:
            now = time.time()
            wait = 0.5 - (now - _last_request_time)
            if wait > 0:
                await asyncio.sleep(wait)
            _last_request_time = time.time()

        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.get(
                f"{LEXOFFICE_BASE}/{endpoint}",
                params=params,
                headers=headers,
            )

        if res.status_code == 429:
            # Retry nach Wartezeit
            wait_secs = 2 ** attempt
            logger.warning(f"Lexoffice 429 fuer {endpoint}, warte {wait_secs}s (Versuch {attempt + 1})")
            await asyncio.sleep(wait_secs)
            continue

        if res.status_code == 401:
            raise HTTPException(401, "Lexoffice API-Key ungueltig")
        if res.status_code >= 400:
            raise HTTPException(res.status_code, f"Lexoffice: {res.text[:200]}")

        # PDF/Binary-Dateien direkt durchreichen (z.B. /files/{id})
        content_type = res.headers.get("content-type", "")
        if "application/json" in content_type:
            return res.json()
        elif "application/pdf" in content_type:
            return Response(
                content=res.content,
                media_type="application/pdf",
                headers={"Content-Disposition": res.headers.get("Content-Disposition", "")},
            )
        else:
            # Lexoffice gibt PDFs manchmal als Base64-String zurück
            import base64
            try:
                decoded = base64.b64decode(res.content)
                if decoded[:5] == b'%PDF-':
                    return Response(
                        content=decoded,
                        media_type="application/pdf",
                        headers={"Content-Disposition": 'attachment; filename="Rechnung.pdf"'},
                    )
            except Exception:
                pass
            return Response(
                content=res.content,
                media_type=content_type or "application/octet-stream",
            )

    raise HTTPException(429, "Lexoffice Rate-Limit nach 3 Versuchen")
