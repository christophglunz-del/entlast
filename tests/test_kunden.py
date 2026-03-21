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
