"""Tests fuer Leistungen-CRUD."""

import pytest


class TestLeistungenCRUD:
    def test_create_leistung(self, auth_client, created_kunde, sample_leistung):
        """POST /api/v1/leistungen erstellt Leistung mit Kunde-Referenz."""
        sample_leistung["kunde_id"] = created_kunde["id"]
        resp = auth_client.post("/api/v1/leistungen", json=sample_leistung)
        assert resp.status_code == 201
        data = resp.json()
        assert data["id"] is not None
        assert data["kunde_id"] == created_kunde["id"]
        assert data["datum"] == "2026-03-15"
        assert data["betrag"] == 65.50

    def test_list_leistungen_fuer_kunde(self, auth_client, created_kunde, sample_leistung):
        """GET /api/v1/leistungen?kunde_id=X filtert nach Kunde."""
        sample_leistung["kunde_id"] = created_kunde["id"]
        auth_client.post("/api/v1/leistungen", json=sample_leistung)

        # Zweite Leistung fuer gleichen Kunden
        l2 = sample_leistung.copy()
        l2["datum"] = "2026-03-16"
        auth_client.post("/api/v1/leistungen", json=l2)

        resp = auth_client.get("/api/v1/leistungen", params={"kunde_id": created_kunde["id"]})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        for l in data:
            assert l["kunde_id"] == created_kunde["id"]

    def test_list_leistungen_fuer_monat(self, auth_client, created_kunde, sample_leistung):
        """GET /api/v1/leistungen?monat=3&jahr=2026 filtert nach Monat."""
        sample_leistung["kunde_id"] = created_kunde["id"]
        auth_client.post("/api/v1/leistungen", json=sample_leistung)

        # Leistung in anderem Monat
        l2 = sample_leistung.copy()
        l2["datum"] = "2026-02-10"
        auth_client.post("/api/v1/leistungen", json=l2)

        resp = auth_client.get("/api/v1/leistungen", params={"monat": 3, "jahr": 2026})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["datum"] == "2026-03-15"

    def test_update_leistung(self, auth_client, created_kunde, sample_leistung):
        """PUT /api/v1/leistungen/{id} aktualisiert Felder."""
        sample_leistung["kunde_id"] = created_kunde["id"]
        resp = auth_client.post("/api/v1/leistungen", json=sample_leistung)
        leistung_id = resp.json()["id"]

        resp = auth_client.put(
            f"/api/v1/leistungen/{leistung_id}",
            json={"betrag": 75.00, "notiz": "Erweitert"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["betrag"] == 75.00
        assert data["notiz"] == "Erweitert"

    def test_delete_leistung(self, auth_client, created_kunde, sample_leistung):
        """DELETE /api/v1/leistungen/{id} loescht die Leistung."""
        sample_leistung["kunde_id"] = created_kunde["id"]
        resp = auth_client.post("/api/v1/leistungen", json=sample_leistung)
        leistung_id = resp.json()["id"]

        resp = auth_client.delete(f"/api/v1/leistungen/{leistung_id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Pruefen dass weg
        resp = auth_client.get(f"/api/v1/leistungen/{leistung_id}")
        assert resp.status_code == 404

    def test_unterschrift_speichern(self, auth_client, created_kunde, sample_leistung):
        """POST /api/v1/leistungen/{id}/unterschrift speichert Unterschriften."""
        sample_leistung["kunde_id"] = created_kunde["id"]
        resp = auth_client.post("/api/v1/leistungen", json=sample_leistung)
        leistung_id = resp.json()["id"]

        # Unterschriften als base64 (vereinfacht)
        resp = auth_client.post(
            f"/api/v1/leistungen/{leistung_id}/unterschrift",
            params={
                "unterschrift_betreuer": "data:image/png;base64,iVBOR...",
                "unterschrift_versicherter": "data:image/png;base64,AAAA...",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["unterschrift_betreuer"] == "data:image/png;base64,iVBOR..."
        assert data["unterschrift_versicherter"] == "data:image/png;base64,AAAA..."
