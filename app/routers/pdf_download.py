"""
Kurzlebige PDF-Downloads über eine echte Server-URL.

Hintergrund: Manche Tablet-Browser (z. B. Huawei-Browser, Chromium 114)
können im Browser erzeugte PDFs (blob:-URLs) nicht herunterladen. Das
Frontend schickt das PDF deshalb kurz hierher und bekommt eine URL, die
der Download-Manager des Geräts normal abholen kann
(Content-Disposition: attachment). Dateien verfallen nach 15 Minuten.
"""

import re
import secrets
import time
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse

from app.auth import get_current_user
from app.database import DATA_DIR

router = APIRouter(prefix="/pdf-download", tags=["pdf-download"])

ABLAGE = DATA_DIR / "tmp_downloads"
LEBENSDAUER_S = 15 * 60
MAX_BYTES = 25 * 1024 * 1024
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")


def _aufraeumen() -> None:
    grenze = time.time() - LEBENSDAUER_S
    for f in ABLAGE.glob("*"):
        try:
            if f.stat().st_mtime < grenze:
                f.unlink()
        except OSError:
            pass


def _sauberer_name(name: str) -> str:
    sauber = re.sub(r"[^A-Za-z0-9ÄÖÜäöüß_.-]", "_", name or "")[:120]
    if not sauber.lower().endswith(".pdf"):
        sauber = (sauber or "Dokument") + ".pdf"
    return sauber


@router.post("")
async def pdf_ablegen(
    request: Request,
    dateiname: str = Query("Dokument.pdf"),
    user: dict = Depends(get_current_user),
):
    inhalt = await request.body()
    if len(inhalt) > MAX_BYTES:
        raise HTTPException(413, "PDF zu groß")
    if not inhalt.startswith(b"%PDF-"):
        raise HTTPException(400, "Keine PDF-Datei")
    ABLAGE.mkdir(parents=True, exist_ok=True)
    _aufraeumen()
    token = secrets.token_urlsafe(24)
    (ABLAGE / f"{token}.pdf").write_bytes(inhalt)
    (ABLAGE / f"{token}.name").write_text(_sauberer_name(dateiname), encoding="utf-8")
    return {"url": f"/api/v1/pdf-download/{token}"}


@router.get("/{token}")
async def pdf_abholen(token: str, user: dict = Depends(get_current_user)):
    if not _TOKEN_RE.match(token):
        raise HTTPException(404, "Nicht gefunden")
    pfad: Path = ABLAGE / f"{token}.pdf"
    if not pfad.exists() or pfad.stat().st_mtime < time.time() - LEBENSDAUER_S:
        raise HTTPException(404, "Download abgelaufen – bitte erneut erzeugen")
    namens_datei = ABLAGE / f"{token}.name"
    name = namens_datei.read_text(encoding="utf-8") if namens_datei.exists() else "Dokument.pdf"
    ascii_name = re.sub(r"[^A-Za-z0-9_.-]", "_", name)
    return FileResponse(
        pfad,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}",
            "Cache-Control": "no-store",
        },
    )
