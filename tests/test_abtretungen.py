"""Tests fuer Abtretungen-CRUD.

Router moeglicherweise noch nicht implementiert — Tests failen dann
und werden in QA gefixt.
"""

import pytest


class TestAbtretungenCRUD:
    def test_create_abtretung(self, auth_client, created_kunde):
        """POST /api/v1/abtretungen erstellt eine Abtretung."""
        data = {
            "kunde_id": created_kunde["id"],
            "datum": "2026-03-15",
            "gueltig_ab": "2026-04-01",
            "gueltig_bis": "2027-03-31",
            "unterschrift": "data:image/png;base64,ABCD...",
            "pflegekasse": "AOK Rheinland",
        }
        resp = auth_client.post("/api/v1/abtretungen", json=data)
        assert resp.status_code == 201
        result = resp.json()
        assert result["id"] is not None
        assert result["kunde_id"] == created_kunde["id"]
        assert result["pflegekasse"] == "AOK Rheinland"

    def test_list_abtretungen_fuer_kunde(self, auth_client, created_kunde):
        """GET /api/v1/abtretungen?kunde_id=X filtert nach Kunde."""
        # Zwei Abtretungen
        for datum in ["2026-03-15", "2026-03-16"]:
            auth_client.post("/api/v1/abtretungen", json={
                "kunde_id": created_kunde["id"],
                "datum": datum,
                "pflegekasse": "AOK Rheinland",
            })

        resp = auth_client.get("/api/v1/abtretungen", params={"kunde_id": created_kunde["id"]})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    def test_delete_abtretung(self, auth_client, created_kunde):
        """DELETE /api/v1/abtretungen/{id} loescht die Abtretung."""
        resp = auth_client.post("/api/v1/abtretungen", json={
            "kunde_id": created_kunde["id"],
            "datum": "2026-03-15",
            "pflegekasse": "AOK Rheinland",
        })
        abtretung_id = resp.json()["id"]

        resp = auth_client.delete(f"/api/v1/abtretungen/{abtretung_id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
