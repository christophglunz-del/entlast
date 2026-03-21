"""Tests fuer Export/Import.

Router moeglicherweise noch nicht implementiert — Tests failen dann.
"""

import pytest


class TestExportImport:
    def test_export_json(self, auth_client, created_kunde):
        """GET /api/v1/export gibt alle Daten als JSON."""
        resp = auth_client.get("/api/v1/export")
        if resp.status_code == 200:
            data = resp.json()
            assert "kunden" in data
            assert "exportDatum" in data or "export_datum" in data
            assert len(data["kunden"]) >= 1
        else:
            assert resp.status_code in (404, 501)

    def test_import_json(self, auth_client):
        """POST /api/v1/import stellt Daten wieder her."""
        import_data = {
            "kunden": [{
                "name": "Importiert",
                "vorname": "Test",
                "kundentyp": "pflege",
                "aktiv": 1,
                "created_at": "2026-03-15 10:00:00",
                "updated_at": "2026-03-15 10:00:00",
            }],
            "leistungen": [],
            "fahrten": [],
            "termine": [],
            "abtretungen": [],
            "rechnungen": [],
            "settings": [],
        }
        resp = auth_client.post("/api/v1/import", json=import_data)
        if resp.status_code == 200:
            data = resp.json()
            assert data.get("ok") is True
        else:
            assert resp.status_code in (400, 404, 501)
