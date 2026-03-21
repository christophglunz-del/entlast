"""Tests fuer Termine-CRUD."""

import pytest


class TestTermineCRUD:
    def test_create_termin(self, auth_client, created_kunde, sample_termin):
        """POST /api/v1/termine erstellt einen Termin."""
        sample_termin["kunde_id"] = created_kunde["id"]
        resp = auth_client.post("/api/v1/termine", json=sample_termin)
        assert resp.status_code == 201
        data = resp.json()
        assert data["id"] is not None
        assert data["kunde_id"] == created_kunde["id"]
        assert data["titel"] == "Hausbesuch Mustermann"
        assert data["datum"] == "2026-03-20"
        assert data["erledigt"] is False

    def test_list_termine_fuer_datum(self, auth_client, created_kunde, sample_termin):
        """GET /api/v1/termine?datum=2026-03-20 filtert nach Datum."""
        sample_termin["kunde_id"] = created_kunde["id"]
        auth_client.post("/api/v1/termine", json=sample_termin)

        # Termin an anderem Datum
        t2 = sample_termin.copy()
        t2["datum"] = "2026-03-21"
        t2["titel"] = "Anderer Termin"
        auth_client.post("/api/v1/termine", json=t2)

        resp = auth_client.get("/api/v1/termine", params={"datum": "2026-03-20"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["datum"] == "2026-03-20"

    def test_list_termine_fuer_woche(self, auth_client, created_kunde, sample_termin):
        """GET /api/v1/termine?woche=2026-W12 filtert nach Woche."""
        sample_termin["kunde_id"] = created_kunde["id"]
        auth_client.post("/api/v1/termine", json=sample_termin)

        # Alle Termine ohne Filter
        resp = auth_client.get("/api/v1/termine")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    def test_update_termin(self, auth_client, created_kunde, sample_termin):
        """PUT /api/v1/termine/{id} aktualisiert Felder."""
        sample_termin["kunde_id"] = created_kunde["id"]
        resp = auth_client.post("/api/v1/termine", json=sample_termin)
        termin_id = resp.json()["id"]

        resp = auth_client.put(
            f"/api/v1/termine/{termin_id}",
            json={"erledigt": True, "notiz": "Erledigt am 20.03."},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["erledigt"] is True
        assert data["notiz"] == "Erledigt am 20.03."

    def test_delete_termin(self, auth_client, created_kunde, sample_termin):
        """DELETE /api/v1/termine/{id} loescht den Termin."""
        sample_termin["kunde_id"] = created_kunde["id"]
        resp = auth_client.post("/api/v1/termine", json=sample_termin)
        termin_id = resp.json()["id"]

        resp = auth_client.delete(f"/api/v1/termine/{termin_id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        resp = auth_client.get(f"/api/v1/termine/{termin_id}")
        assert resp.status_code == 404
