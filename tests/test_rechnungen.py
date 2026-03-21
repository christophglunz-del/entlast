"""Tests fuer Rechnungen-CRUD.

Router moeglicherweise noch nicht implementiert — Tests failen dann
und werden in QA gefixt.
"""

import pytest


class TestRechnungenCRUD:
    def test_create_rechnung(self, auth_client, created_kunde):
        """POST /api/v1/rechnungen erstellt eine Rechnung."""
        data = {
            "kunde_id": created_kunde["id"],
            "rechnungsnummer": "RE-2026-001",
            "datum": "2026-03-15",
            "monat": 3,
            "jahr": 2026,
            "typ": "kasse",
            "betrag_netto": 131.00,
            "betrag_brutto": 131.00,
            "status": "entwurf",
        }
        resp = auth_client.post("/api/v1/rechnungen", json=data)
        assert resp.status_code == 201
        result = resp.json()
        assert result["id"] is not None
        assert result["rechnungsnummer"] == "RE-2026-001"
        assert result["status"] == "entwurf"

    def test_list_rechnungen_fuer_kunde(self, auth_client, created_kunde):
        """GET /api/v1/rechnungen?kunde_id=X filtert nach Kunde."""
        for monat in [1, 2, 3]:
            auth_client.post("/api/v1/rechnungen", json={
                "kunde_id": created_kunde["id"],
                "rechnungsnummer": f"RE-2026-{monat:03d}",
                "monat": monat,
                "jahr": 2026,
                "betrag_brutto": 131.00,
                "status": "entwurf",
            })

        resp = auth_client.get("/api/v1/rechnungen", params={"kunde_id": created_kunde["id"]})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 3

    def test_update_rechnung_status(self, auth_client, created_kunde):
        """PUT /api/v1/rechnungen/{id} kann Status aendern."""
        resp = auth_client.post("/api/v1/rechnungen", json={
            "kunde_id": created_kunde["id"],
            "rechnungsnummer": "RE-2026-010",
            "betrag_brutto": 131.00,
            "status": "entwurf",
        })
        rechnung_id = resp.json()["id"]

        resp = auth_client.put(
            f"/api/v1/rechnungen/{rechnung_id}",
            json={"status": "versendet", "versand_art": "fax", "versand_datum": "2026-03-16"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "versendet"
        assert data["versand_art"] == "fax"

    def test_delete_rechnung(self, auth_client, created_kunde):
        """DELETE /api/v1/rechnungen/{id} loescht die Rechnung."""
        resp = auth_client.post("/api/v1/rechnungen", json={
            "kunde_id": created_kunde["id"],
            "rechnungsnummer": "RE-2026-099",
            "status": "entwurf",
        })
        rechnung_id = resp.json()["id"]

        resp = auth_client.delete(f"/api/v1/rechnungen/{rechnung_id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_pdf_placeholder(self, auth_client, created_kunde):
        """GET /api/v1/rechnungen/{id}/pdf gibt 501 (noch nicht implementiert)."""
        resp = auth_client.post("/api/v1/rechnungen", json={
            "kunde_id": created_kunde["id"],
            "rechnungsnummer": "RE-2026-PDF",
            "status": "entwurf",
        })
        rechnung_id = resp.json()["id"]

        resp = auth_client.get(f"/api/v1/rechnungen/{rechnung_id}/pdf")
        # 501 (Not Implemented) oder 404 (Route nicht vorhanden)
        assert resp.status_code in (501, 404, 405)

    def test_datev_placeholder(self, auth_client):
        """GET /api/v1/rechnungen/export/datev gibt 501 (noch nicht implementiert)."""
        resp = auth_client.get("/api/v1/rechnungen/export/datev")
        # 501 oder 404 wenn Route noch nicht existiert
        assert resp.status_code in (501, 404, 405)
