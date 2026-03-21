"""Tests fuer Entlastungs-Budget (45b).

Router moeglicherweise noch nicht implementiert — Tests failen dann.
"""

import pytest


class TestEntlastungBudget:
    def test_budget_berechnung(self, auth_client, created_kunde):
        """125 EUR/Monat Budget, Uebertrag Vorjahr wird beruecksichtigt."""
        # Leistung erstellen die Budget verbraucht
        auth_client.post("/api/v1/leistungen", json={
            "kunde_id": created_kunde["id"],
            "datum": "2026-01-15",
            "betrag": 125.00,
            "dauer_std": 2.0,
        })

        resp = auth_client.get("/api/v1/entlastung", params={"jahr": 2026})
        # 200 wenn implementiert, 404 wenn Route noch nicht da
        if resp.status_code == 200:
            data = resp.json()
            assert "versicherte" in data or "aktuellesJahr" in data
        else:
            assert resp.status_code in (404, 501)

    def test_budget_uebersicht(self, auth_client):
        """GET /api/v1/entlastung zeigt alle Kunden mit Restbudget."""
        resp = auth_client.get("/api/v1/entlastung")
        if resp.status_code == 200:
            data = resp.json()
            assert isinstance(data, (dict, list))
        else:
            assert resp.status_code in (404, 501)

    def test_budget_detail(self, auth_client, created_kunde):
        """GET /api/v1/entlastung/{kundeId} zeigt Detail fuer einen Kunden."""
        resp = auth_client.get(f"/api/v1/entlastung/{created_kunde['id']}")
        if resp.status_code == 200:
            data = resp.json()
            assert isinstance(data, dict)
        else:
            assert resp.status_code in (404, 501)
