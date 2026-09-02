"""Tests: serverseitiger Dubletten-Schutz fuer Leistungen (Fall Lieck 13.07.2026)."""


class TestLeistungenDublette:
    def test_exakte_dublette_wird_abgewiesen(self, auth_client, created_kunde, sample_leistung):
        """Zweiter POST mit gleichem Kunde/Datum/von/bis -> 409 (Doppelklick-Schutz)."""
        sample_leistung["kunde_id"] = created_kunde["id"]
        r1 = auth_client.post("/api/v1/leistungen", json=sample_leistung)
        assert r1.status_code == 201
        r2 = auth_client.post("/api/v1/leistungen", json=sample_leistung)
        assert r2.status_code == 409
        assert "existiert bereits" in r2.json()["detail"]
        resp = auth_client.get("/api/v1/leistungen", params={"kunde_id": created_kunde["id"]})
        assert len(resp.json()) == 1

    def test_zweiter_einsatz_am_selben_tag_erlaubt(self, auth_client, created_kunde, sample_leistung):
        """Gleicher Tag, andere Uhrzeit -> weiterhin erlaubt (zwei Einsaetze pro Tag)."""
        sample_leistung["kunde_id"] = created_kunde["id"]
        assert auth_client.post("/api/v1/leistungen", json=sample_leistung).status_code == 201
        l2 = dict(sample_leistung)
        l2["von"] = "15:00"
        l2["bis"] = "16:00"
        assert auth_client.post("/api/v1/leistungen", json=l2).status_code == 201
