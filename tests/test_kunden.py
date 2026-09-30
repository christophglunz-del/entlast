"""Tests fuer Kunden-CRUD mit Verschluesselung."""

import pytest


class TestKundenCRUD:
    def test_create_kunde(self, auth_client, sample_kunde):
        """POST /api/v1/kunden erstellt Kunden und gibt 201 zurueck."""
        resp = auth_client.post("/api/v1/kunden", json=sample_kunde)
        assert resp.status_code == 201
        data = resp.json()
        assert data["id"] is not None
        assert data["name"] == "Mustermann"
        assert data["vorname"] == "Erika"
        assert data["ort"] == "Hattingen"
        assert data["pflegegrad"] == 2
        assert data["kundentyp"] == "pflege"
        assert data["aktiv"] is True

    def test_list_kunden(self, auth_client, sample_kunde):
        """GET /api/v1/kunden listet alle Kunden."""
        # Zwei Kunden erstellen
        auth_client.post("/api/v1/kunden", json=sample_kunde)
        kunde2 = sample_kunde.copy()
        kunde2["name"] = "Schmidt"
        kunde2["vorname"] = "Hans"
        auth_client.post("/api/v1/kunden", json=kunde2)

        resp = auth_client.get("/api/v1/kunden")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        # Alphabetisch sortiert
        assert data[0]["name"] == "Mustermann"
        assert data[1]["name"] == "Schmidt"

    def test_get_kunde(self, auth_client, created_kunde):
        """GET /api/v1/kunden/{id} gibt Kunden mit entschluesselter Versichertennr."""
        kunde_id = created_kunde["id"]
        resp = auth_client.get(f"/api/v1/kunden/{kunde_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == kunde_id
        assert data["versichertennummer"] == "A123456789"

    def test_update_kunde(self, auth_client, created_kunde):
        """PUT /api/v1/kunden/{id} aktualisiert Daten."""
        kunde_id = created_kunde["id"]
        resp = auth_client.put(
            f"/api/v1/kunden/{kunde_id}",
            json={"vorname": "Maria", "plz": "44787"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["vorname"] == "Maria"
        assert data["plz"] == "44787"
        # Name bleibt unveraendert
        assert data["name"] == "Mustermann"

    def test_delete_kunde(self, auth_client, created_kunde):
        """DELETE /api/v1/kunden/{id} loescht den Kunden."""
        kunde_id = created_kunde["id"]
        resp = auth_client.delete(f"/api/v1/kunden/{kunde_id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Pruefen dass er weg ist
        resp = auth_client.get(f"/api/v1/kunden/{kunde_id}")
        assert resp.status_code == 404

    def test_delete_kunde_not_found(self, auth_client):
        """DELETE auf nicht-existenten Kunden gibt 404."""
        resp = auth_client.delete("/api/v1/kunden/999")
        assert resp.status_code == 404

    def test_suche_kunden(self, auth_client, sample_kunde):
        """GET /api/v1/kunden/suche?q=Muster findet passende Kunden."""
        auth_client.post("/api/v1/kunden", json=sample_kunde)
        kunde2 = sample_kunde.copy()
        kunde2["name"] = "Schmidt"
        auth_client.post("/api/v1/kunden", json=kunde2)

        resp = auth_client.get("/api/v1/kunden/suche", params={"q": "Muster"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Mustermann"


class TestKundenEncryption:
    def test_versichertennummer_encrypted(self, auth_client, sample_kunde):
        """Versichertennummer ist in der DB verschluesselt, in API entschluesselt."""
        resp = auth_client.post("/api/v1/kunden", json=sample_kunde)
        assert resp.status_code == 201
        data = resp.json()
        # API gibt Klartext zurueck
        assert data["versichertennummer"] == "A123456789"

        # In der DB direkt pruefen: verschluesselt
        from app.database import get_mandant_db
        conn = get_mandant_db("test_mandant.db")
        try:
            row = conn.execute(
                "SELECT versichertennummer_encrypted FROM kunden WHERE id = ?",
                (data["id"],),
            ).fetchone()
            encrypted_val = row["versichertennummer_encrypted"]
            # Muss verschluesselt sein (nicht der Klartext)
            assert encrypted_val is not None
            assert encrypted_val != "A123456789"
            # Entschluesseln und pruefen
            from app.encryption import decrypt
            assert decrypt(encrypted_val) == "A123456789"
        finally:
            conn.close()

    def test_iban_encrypted(self, auth_client):
        """IBAN ist in der DB verschluesselt, in API entschluesselt."""
        kunde = {
            "name": "Testperson",
            "iban": "DE89370400440532013000",
            "kundentyp": "pflege",
        }
        resp = auth_client.post("/api/v1/kunden", json=kunde)
        assert resp.status_code == 201
        data = resp.json()
        assert data["iban"] == "DE89370400440532013000"

        # DB-Check
        from app.database import get_mandant_db
        conn = get_mandant_db("test_mandant.db")
        try:
            row = conn.execute(
                "SELECT iban_encrypted FROM kunden WHERE id = ?",
                (data["id"],),
            ).fetchone()
            assert row["iban_encrypted"] != "DE89370400440532013000"
        finally:
            conn.close()


class TestEntlastungsAnpassungen:
    """Anpassungsfelder aus dem Entlastungsmodul (pflegegradSeit, uebertragVorvorjahr,
    vorleistungen) muessen gespeichert und wieder ausgeliefert werden."""

    def test_update_und_reload(self, auth_client, created_kunde):
        kunde_id = created_kunde["id"]
        # So kommt es vom Frontend an (camelToSnake in db.js)
        resp = auth_client.put(
            f"/api/v1/kunden/{kunde_id}",
            json={
                "pflegegrad_seit": "2026-03-15",
                "uebertrag_vorvorjahr": 42.5,
                "vorleistungen": '{"2025": 100.0, "2026": 0}',
            },
        )
        assert resp.status_code == 200
        data = auth_client.get(f"/api/v1/kunden/{kunde_id}").json()
        assert data["pflegegrad_seit"] == "2026-03-15"
        assert data["uebertrag_vorvorjahr"] == 42.5
        assert data["vorleistungen"] == '{"2025": 100.0, "2026": 0}'
        # andere Felder bleiben unberuehrt
        assert data["pflegegrad"] == created_kunde["pflegegrad"]

    def test_defaults_neuer_kunde(self, auth_client, created_kunde):
        assert created_kunde["pflegegrad_seit"] is None
        assert created_kunde["uebertrag_vorvorjahr"] == 0
        assert created_kunde["vorleistungen"] is None

    def test_migration_bestehende_db(self, tmp_path):
        """Alte kunden-Tabelle ohne die Spalten wird beim Start ergaenzt, Daten bleiben."""
        import sqlite3
        import app.database as db_mod
        from pathlib import Path

        db_mod.DATA_DIR = Path(tmp_path)
        alt = tmp_path / "alt.db"
        conn = sqlite3.connect(alt)
        conn.execute("CREATE TABLE kunden (id INTEGER PRIMARY KEY, name TEXT NOT NULL, "
                     "pflegegrad INTEGER, kundentyp TEXT NOT NULL DEFAULT 'pflege', "
                     "aktiv INTEGER NOT NULL DEFAULT 1)")
        conn.execute("INSERT INTO kunden (name, pflegegrad) VALUES ('Alt', 3)")
        conn.commit()
        conn.close()

        db_mod.init_mandant_db("alt.db")

        conn = sqlite3.connect(alt)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(kunden)")}
        assert {"pflegegrad_seit", "uebertrag_vorvorjahr", "vorleistungen"} <= cols
        assert conn.execute("SELECT name, pflegegrad FROM kunden").fetchone() == ("Alt", 3)
        conn.close()
