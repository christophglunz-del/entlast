"""Pytest-Fixtures fuer entlast.de Tests.

Jeder Test bekommt eine eigene temporaere DB-Umgebung.
"""

import os
import tempfile
import shutil

import bcrypt
import pytest
from cryptography.fernet import Fernet

# --- Umgebungsvariablen MUESSEN vor dem Import der App gesetzt werden ---
# Wir generieren pro Session einmal einen Key.
_TEST_ENCRYPTION_KEY = Fernet.generate_key().decode()


def _setup_env(tmp_dir: str):
    """Setzt Umgebungsvariablen fuer die Test-App."""
    os.environ["ENTLAST_DATA_DIR"] = tmp_dir
    os.environ["SECRET_KEY"] = "test-secret-key-32-bytes-long!!"
    os.environ["ENCRYPTION_KEY"] = _TEST_ENCRYPTION_KEY
    os.environ["ENTLAST_ENV"] = "development"  # Cookie secure=False


@pytest.fixture(autouse=True)
def _isolate_env(tmp_path):
    """Stellt sicher, dass jeder Test eine saubere Umgebung hat.

    Setzt Env-Vars, erstellt temp-DBs, und raeumt hinterher auf.
    Muss autouse sein, damit die Env-Vars IMMER vor App-Import stehen.
    """
    tmp_dir = str(tmp_path / "data")
    os.makedirs(tmp_dir, exist_ok=True)
    _setup_env(tmp_dir)

    # Wichtig: Module muessen neu geladen werden, weil database.py DATA_DIR
    # beim Import cached. Wir patchen es direkt.
    import importlib
    import app.database as db_mod
    from pathlib import Path

    db_mod.DATA_DIR = Path(tmp_dir)
    db_mod.AUTH_DB_PATH = Path(tmp_dir) / "auth.db"

    # Auth-Modul: Session-Store + Brute-Force-Tracker leeren
    import app.auth as auth_mod
    auth_mod._sessions.clear()
    auth_mod._login_attempts.clear()

    yield

    # Cleanup: Sessions leeren
    auth_mod._sessions.clear()
    auth_mod._login_attempts.clear()


@pytest.fixture
def app(tmp_path):
    """Erstellt eine Test-App mit temporaeren DBs und eingehaengten Routern."""
    from fastapi.testclient import TestClient
    from app.database import init_auth_db, init_mandant_db, get_auth_db
    from app.main import app as fastapi_app

    # Router einhaengen (in main.py sind sie noch auskommentiert)
    # Wir pruefen ob sie schon registriert sind, um Doppel-Registrierung zu vermeiden.
    _ensure_routers(fastapi_app)

    # DBs initialisieren
    init_auth_db()
    init_mandant_db("test_mandant.db")

    # Testbenutzer + Mandant anlegen
    _create_test_user()

    return fastapi_app


def _ensure_routers(fastapi_app):
    """Haengt die CRUD-Router ein, falls sie noch nicht registriert sind."""
    existing_paths = set()
    for route in fastapi_app.routes:
        if hasattr(route, "path"):
            existing_paths.add(route.path)

    routers_to_add = []

    # Kunden-Router
    try:
        from app.routers.kunden import router as kunden_router
        if "/api/v1/kunden" not in existing_paths:
            routers_to_add.append(kunden_router)
    except ImportError:
        pass

    # Leistungen-Router
    try:
        from app.routers.leistungen import router as leistungen_router
        if "/api/v1/leistungen" not in existing_paths:
            routers_to_add.append(leistungen_router)
    except ImportError:
        pass

    # Fahrten-Router
    try:
        from app.routers.fahrten import router as fahrten_router
        if "/api/v1/fahrten" not in existing_paths:
            routers_to_add.append(fahrten_router)
    except ImportError:
        pass

    # Termine-Router
    try:
        from app.routers.termine import router as termine_router
        if "/api/v1/termine" not in existing_paths:
            routers_to_add.append(termine_router)
    except ImportError:
        pass

    # Abtretungen-Router
    try:
        from app.routers.abtretungen import router as abtretungen_router
        if "/api/v1/abtretungen" not in existing_paths:
            routers_to_add.append(abtretungen_router)
    except ImportError:
        pass

    # Rechnungen-Router
    try:
        from app.routers.rechnungen import router as rechnungen_router
        if "/api/v1/rechnungen" not in existing_paths:
            routers_to_add.append(rechnungen_router)
    except ImportError:
        pass

    # Firma-Router
    try:
        from app.routers.firma import router as firma_router
        if "/api/v1/firma" not in existing_paths:
            routers_to_add.append(firma_router)
    except ImportError:
        pass

    # Entlastung-Router
    try:
        from app.routers.entlastung import router as entlastung_router
        if "/api/v1/entlastung" not in existing_paths:
            routers_to_add.append(entlastung_router)
    except ImportError:
        pass

    # Export-Router
    try:
        from app.routers.export import router as export_router
        if "/api/v1/export" not in existing_paths:
            routers_to_add.append(export_router)
    except ImportError:
        pass

    for r in routers_to_add:
        fastapi_app.include_router(r, prefix="/api/v1")


def _create_test_user():
    """Legt einen Test-Mandanten und -Benutzer in der Auth-DB an."""
    from app.database import get_auth_db

    pw_hash = bcrypt.hashpw(b"testpass123", bcrypt.gensalt()).decode()

    conn = get_auth_db()
    try:
        # Mandant
        conn.execute(
            "INSERT OR IGNORE INTO mandanten (id, name, db_datei, aktiv) VALUES (1, 'Test GmbH', 'test_mandant.db', 1)"
        )
        # Benutzer
        conn.execute(
            "INSERT OR IGNORE INTO auth_benutzer (id, username, password_hash, mandant_id, name, rolle, aktiv) "
            "VALUES (1, 'testuser', ?, 1, 'Test Benutzer', 'admin', 1)",
            (pw_hash,),
        )
        conn.commit()
    finally:
        conn.close()


@pytest.fixture
def client(app):
    """TestClient ohne Auth."""
    from fastapi.testclient import TestClient
    return TestClient(app)


@pytest.fixture
def auth_client(client):
    """TestClient MIT eingeloggtem User (Session-Cookie wird automatisch gehalten)."""
    resp = client.post("/auth/login", json={"username": "testuser", "password": "testpass123"})
    assert resp.status_code == 200, f"Login fehlgeschlagen: {resp.text}"
    return client


@pytest.fixture
def sample_kunde():
    """Test-Kundendaten."""
    return {
        "name": "Mustermann",
        "vorname": "Erika",
        "strasse": "Hauptstr. 1",
        "plz": "45525",
        "ort": "Hattingen",
        "pflegegrad": 2,
        "versichertennummer": "A123456789",
        "pflegekasse": "AOK Rheinland",
        "kundentyp": "pflege",
        "aktiv": True,
    }


@pytest.fixture
def sample_leistung():
    """Test-Leistungsdaten (kunde_id muss separat gesetzt werden)."""
    return {
        "datum": "2026-03-15",
        "von": "09:00",
        "bis": "11:00",
        "dauer_std": 2.0,
        "leistungsarten": '["Betreuung", "Hauswirtschaft"]',
        "betrag": 65.50,
        "notiz": "Einkauf + Kochen",
    }


@pytest.fixture
def sample_fahrt():
    """Test-Fahrtdaten (kunde_id muss separat gesetzt werden)."""
    return {
        "datum": "2026-03-15",
        "von_ort": "Hattingen",
        "nach_ort": "Bochum",
        "km": 18.5,
        "betrag": 5.55,
    }


@pytest.fixture
def sample_termin():
    """Test-Termindaten (kunde_id muss separat gesetzt werden)."""
    return {
        "datum": "2026-03-20",
        "von": "14:00",
        "bis": "15:30",
        "titel": "Hausbesuch Mustermann",
        "notiz": "Pflegeberatung",
        "erledigt": False,
    }


@pytest.fixture
def created_kunde(auth_client, sample_kunde):
    """Erstellt einen Kunden und gibt die Response zurueck."""
    resp = auth_client.post("/api/v1/kunden", json=sample_kunde)
    assert resp.status_code == 201, f"Kunde erstellen fehlgeschlagen: {resp.text}"
    return resp.json()
