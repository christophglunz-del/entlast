"""entlast.de — FastAPI Entry Point.

Multi-Mandant Web-App fuer Alltagshilfe-Betriebe.
Start: uvicorn app.main:app --reload
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.auth import router as auth_router
from app.database import init_auth_db, init_mandant_db, get_auth_db, DATA_DIR
from app.middleware import AuditLogMiddleware, RequestIDMiddleware
from app.routers import kunden, leistungen, fahrten, termine, abtretungen, rechnungen, firma, entlastung, export, ical, settings, statistiken, pflegekassen

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("entlast")

# Rate-Limiter: 100 Requests pro Minute pro IP
limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialisiert Datenbanken beim Start."""
    logger.info("Initialisiere Datenbanken...")
    init_auth_db()

    # Alle aktiven Mandanten-DBs initialisieren
    conn = get_auth_db()
    try:
        mandanten = conn.execute("SELECT db_datei FROM mandanten WHERE aktiv = 1").fetchall()
        for m in mandanten:
            init_mandant_db(m["db_datei"])
            logger.info(f"Mandanten-DB initialisiert: {m['db_datei']}")
    finally:
        conn.close()

    logger.info(f"entlast.de gestartet — {len(mandanten)} aktive Mandanten")
    yield
    logger.info("entlast.de wird beendet")


app = FastAPI(
    title="entlast.de",
    description="Multi-Mandant Web-App fuer Alltagshilfe-Betriebe",
    version="0.1.0",
    lifespan=lifespan,
)

# Rate-Limiter einhaengen
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Middleware (Reihenfolge: zuerst registriert = zuletzt ausgefuehrt)
app.add_middleware(AuditLogMiddleware)
app.add_middleware(RequestIDMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://entlast.de", "http://localhost:8000", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth-Router
app.include_router(auth_router)

# CRUD-Router (Phase 2)
app.include_router(kunden.router, prefix="/api/v1")
app.include_router(leistungen.router, prefix="/api/v1")
app.include_router(fahrten.router, prefix="/api/v1")
app.include_router(termine.router, prefix="/api/v1")
app.include_router(abtretungen.router, prefix="/api/v1")
app.include_router(rechnungen.router, prefix="/api/v1")
app.include_router(firma.router, prefix="/api/v1")
app.include_router(entlastung.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")
app.include_router(ical.router, prefix="/api/v1")
app.include_router(settings.router, prefix="/api/v1")
app.include_router(statistiken.router, prefix="/api/v1")
app.include_router(pflegekassen.router, prefix="/api/v1")


# --- Health-Endpoint ---

@app.get("/api/v1/health")
async def health():
    """Health-Check fuer Monitoring."""
    return {
        "status": "ok",
        "service": "entlast.de",
        "version": "0.1.0",
    }


# --- Exception-Handler ---

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Faengt unbehandelte Exceptions und gibt 500 zurueck."""
    logger.error(f"Unbehandelte Exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Interner Serverfehler"},
    )


# Static Files fuer Frontend (muss nach allen API-Routes kommen)
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
