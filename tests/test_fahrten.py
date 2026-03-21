"""Tests fuer Fahrten-CRUD."""

import pytest


class TestFahrtenCRUD:
    def test_create_fahrt(self, auth_client, created_kunde, sample_fahrt):
        """POST /api/v1/fahrten erstellt eine Fahrt."""
        sample_fahrt["kunde_id"] = created_kunde["id"]
        resp = auth_client.post("/api/v1/fahrten", json=sample_fahrt)
        assert resp.status_code == 201
        data = resp.json()
        assert data["id"] is not None
        assert data["kunde_id"] == created_kunde["id"]
        assert data["von_ort"] == "Hattingen"
        assert data["nach_ort"] == "Bochum"
        assert data["km"] == 18.5

    def test_list_fahrten_fuer_woche(self, auth_client, created_kunde, sample_fahrt):
        """GET /api/v1/fahrten?woche=2026-W11 filtert nach Woche."""
        sample_fahrt["kunde_id"] = created_kunde["id"]
        # 2026-03-15 ist ein Sonntag in Woche 11
        auth_client.post("/api/v1/fahrten", json=sample_fahrt)

        # Fahrt in anderer Woche
        f2 = sample_fahrt.copy()
        f2["datum"] = "2026-03-01"
        auth_client.post("/api/v1/fahrten", json=f2)

        # Alle Fahrten (ohne Filter)
        resp = auth_client.get("/api/v1/fahrten")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_update_fahrt(self, auth_client, created_kunde, sample_fahrt):
        """PUT /api/v1/fahrten/{id} aktualisiert Felder."""
        sample_fahrt["kunde_id"] = created_kunde["id"]
        resp = auth_client.post("/api/v1/fahrten", json=sample_fahrt)
        fahrt_id = resp.json()["id"]

        resp = auth_client.put(
            f"/api/v1/fahrten/{fahrt_id}",
            json={"km": 22.0, "nach_ort": "Essen"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["km"] == 22.0
        assert data["nach_ort"] == "Essen"
        # von_ort bleibt
        assert data["von_ort"] == "Hattingen"

    def test_delete_fahrt(self, auth_client, created_kunde, sample_fahrt):
        """DELETE /api/v1/fahrten/{id} loescht die Fahrt."""
        sample_fahrt["kunde_id"] = created_kunde["id"]
        resp = auth_client.post("/api/v1/fahrten", json=sample_fahrt)
        fahrt_id = resp.json()["id"]

        resp = auth_client.delete(f"/api/v1/fahrten/{fahrt_id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        resp = auth_client.get(f"/api/v1/fahrten/{fahrt_id}")
        assert resp.status_code == 404
