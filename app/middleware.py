"""Middleware: Audit-Logging und Request-ID."""

import json
import uuid
import time
import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("entlast.audit")

# Sensible Endpunkte die bei GET geloggt werden
SENSITIVE_PATHS = {"/api/v1/kunden", "/api/v1/leistungen", "/api/v1/abtretungen"}
# Methoden die immer geloggt werden
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Fuegt jedem Request eine eindeutige ID hinzu."""

    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class AuditLogMiddleware(BaseHTTPMiddleware):
    """Loggt schreibende Requests und Lesezugriffe auf sensible Daten."""

    async def dispatch(self, request: Request, call_next):
        start = time.time()
        path = request.url.path
        method = request.method

        # Bestimmen ob dieser Request geloggt werden soll
        should_log = method in WRITE_METHODS
        if not should_log:
            # GET auf sensible Pfade loggen
            for sensitive in SENSITIVE_PATHS:
                if path.startswith(sensitive):
                    should_log = True
                    break

        response: Response = await call_next(request)
        duration_ms = round((time.time() - start) * 1000)

        if should_log:
            # User-ID aus Session extrahieren (wenn vorhanden)
            user_id = None
            session_id = request.cookies.get("session_id")
            if session_id:
                from app.auth import _get_session
                session = _get_session(session_id)
                if session:
                    user_id = session.get("user_id")

            client_ip = request.client.host if request.client else "unknown"
            request_id = getattr(request.state, "request_id", "?")

            log_entry = {
                "request_id": request_id,
                "method": method,
                "path": path,
                "user_id": user_id,
                "ip": client_ip,
                "status": response.status_code,
                "duration_ms": duration_ms,
            }
            logger.info(json.dumps(log_entry, ensure_ascii=False))

            # In Mandanten-DB loggen (wenn Session vorhanden)
            if session_id and user_id:
                try:
                    from app.auth import _get_session
                    session = _get_session(session_id)
                    if session:
                        from app.database import get_mandant_db, write_audit_log
                        db_datei = session.get("db_datei")
                        if db_datei:
                            conn = get_mandant_db(db_datei)
                            try:
                                write_audit_log(
                                    conn=conn,
                                    user_id=user_id,
                                    action=f"{method} {path}",
                                    ip_address=client_ip,
                                    status=str(response.status_code),
                                )
                            finally:
                                conn.close()
                except Exception as e:
                    logger.warning(f"Audit-DB-Log fehlgeschlagen: {e}")

        return response
