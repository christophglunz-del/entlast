"""Tests fuer Firma-Endpoints.

Router moeglicherweise noch nicht implementiert — Tests failen dann.
"""

import pytest


class TestFirma:
    def test_get_firma(self, auth_client):
        """GET /api/v1/firma gibt Firmendaten zurueck."""
        resp = auth_client.get("/api/v1/firma")
        assert resp.status_code == 200
        data = resp.json()
        # Standard-Werte aus init_mandant_db
        assert "farbe_primary" in data or "name" in data

    def test_update_firma(self, auth_client):
        """PUT /api/v1/firma aendert Firmendaten."""
        resp = auth_client.put("/api/v1/firma", json={
            "name": "Susi's Alltagshilfe",
            "inhaber": "Susanne Muster",
            "strasse": "Teststr. 42",
            "plz": "45525",
            "ort": "Hattingen",
            "telefon": "02324-123456",
            "email": "info@test.de",
            "kleinunternehmer": True,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Susi's Alltagshilfe"
        assert data["inhaber"] == "Susanne Muster"

        # Gegenlesen
        resp = auth_client.get("/api/v1/firma")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Susi's Alltagshilfe"
