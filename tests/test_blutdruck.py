"""Tests fuer Blutdruck-CRUD und die Verlaufs-/Entwicklungsberechnung."""

from datetime import date, timedelta

import pytest


def _messung(kunde_id, tage_zurueck, sys_wert, dia_wert, puls=None):
    """Baut eine Messung, die `tage_zurueck` Tage in der Vergangenheit liegt."""
    return {
        "kunde_id": kunde_id,
        "datum": (date.today() - timedelta(days=tage_zurueck)).isoformat(),
        "zeit": "08:00",
        "systolisch": sys_wert,
        "diastolisch": dia_wert,
        "puls": puls,
    }


class TestBlutdruckCRUD:
    def test_create_blutdruck(self, auth_client, created_kunde, sample_blutdruck):
        """POST /api/v1/blutdruck legt eine Messung an und bewertet sie."""
        sample_blutdruck["kunde_id"] = created_kunde["id"]
        resp = auth_client.post("/api/v1/blutdruck", json=sample_blutdruck)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["id"] is not None
        assert data["kunde_id"] == created_kunde["id"]
        assert data["systolisch"] == 148
        assert data["diastolisch"] == 92
        assert data["puls"] == 76
        assert data["kategorie"] == "hypertonie_1"
        assert data["kategorie_label"] == "Hypertonie Grad 1"

    def test_create_unbekannter_kunde(self, auth_client, sample_blutdruck):
        """Eine Messung fuer einen nicht existierenden Kunden wird abgelehnt."""
        sample_blutdruck["kunde_id"] = 9999
        resp = auth_client.post("/api/v1/blutdruck", json=sample_blutdruck)
        assert resp.status_code == 400

    def test_create_unplausible_werte(self, auth_client, created_kunde, sample_blutdruck):
        """Systolisch <= diastolisch wird abgelehnt."""
        sample_blutdruck["kunde_id"] = created_kunde["id"]
        sample_blutdruck["systolisch"] = 80
        sample_blutdruck["diastolisch"] = 95
        resp = auth_client.post("/api/v1/blutdruck", json=sample_blutdruck)
        assert resp.status_code == 400

    def test_create_wert_ausserhalb_bereich(self, auth_client, created_kunde, sample_blutdruck):
        """Werte ausserhalb des plausiblen Bereichs scheitern an der Validierung."""
        sample_blutdruck["kunde_id"] = created_kunde["id"]
        sample_blutdruck["systolisch"] = 400
        resp = auth_client.post("/api/v1/blutdruck", json=sample_blutdruck)
        assert resp.status_code == 422

    def test_liste_filter_kunde_und_zeitraum(self, auth_client, created_kunde):
        """GET /api/v1/blutdruck filtert nach Kunde und Datum."""
        kunde_id = created_kunde["id"]
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 40, 150, 95))
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 2, 130, 82))

        resp = auth_client.get("/api/v1/blutdruck", params={"kunde_id": kunde_id})
        assert resp.status_code == 200
        assert len(resp.json()) == 2

        von = (date.today() - timedelta(days=10)).isoformat()
        resp = auth_client.get("/api/v1/blutdruck", params={"kunde_id": kunde_id, "von": von})
        assert len(resp.json()) == 1
        assert resp.json()[0]["systolisch"] == 130

    def test_liste_ist_absteigend_sortiert(self, auth_client, created_kunde):
        """Die neueste Messung steht in der Liste zuerst."""
        kunde_id = created_kunde["id"]
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 30, 150, 95))
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 1, 120, 78))

        data = auth_client.get("/api/v1/blutdruck", params={"kunde_id": kunde_id}).json()
        assert [m["systolisch"] for m in data] == [120, 150]

    def test_update_blutdruck(self, auth_client, created_kunde, sample_blutdruck):
        """PUT /api/v1/blutdruck/{id} aktualisiert Werte und Bewertung."""
        sample_blutdruck["kunde_id"] = created_kunde["id"]
        messung_id = auth_client.post("/api/v1/blutdruck", json=sample_blutdruck).json()["id"]

        resp = auth_client.put(
            f"/api/v1/blutdruck/{messung_id}",
            json={"systolisch": 118, "diastolisch": 76, "notiz": "nach Ruhepause"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["systolisch"] == 118
        assert data["kategorie"] == "optimal"
        assert data["notiz"] == "nach Ruhepause"

    def test_update_unplausible_werte(self, auth_client, created_kunde, sample_blutdruck):
        """Auch beim Update muss systolisch > diastolisch bleiben."""
        sample_blutdruck["kunde_id"] = created_kunde["id"]
        messung_id = auth_client.post("/api/v1/blutdruck", json=sample_blutdruck).json()["id"]

        resp = auth_client.put(f"/api/v1/blutdruck/{messung_id}", json={"systolisch": 85})
        assert resp.status_code == 400

    def test_delete_blutdruck(self, auth_client, created_kunde, sample_blutdruck):
        """DELETE /api/v1/blutdruck/{id} loescht die Messung."""
        sample_blutdruck["kunde_id"] = created_kunde["id"]
        messung_id = auth_client.post("/api/v1/blutdruck", json=sample_blutdruck).json()["id"]

        assert auth_client.delete(f"/api/v1/blutdruck/{messung_id}").json()["ok"] is True
        assert auth_client.get(f"/api/v1/blutdruck/{messung_id}").status_code == 404

    def test_ohne_login_401(self, client):
        """Ohne Session gibt es keine Gesundheitsdaten."""
        assert client.get("/api/v1/blutdruck").status_code == 401


class TestBewertung:
    @pytest.mark.parametrize(
        "sys_wert,dia_wert,kategorie",
        [
            (95, 58, "hypotonie"),
            (115, 75, "optimal"),
            (125, 82, "normal"),
            (135, 86, "hoch_normal"),
            (145, 92, "hypertonie_1"),
            (165, 102, "hypertonie_2"),
            (185, 115, "hypertonie_3"),
            (150, 70, "hypertonie_1"),   # isoliert systolisch: hoeherer Wert entscheidet
            (125, 95, "hypertonie_1"),   # isoliert diastolisch
        ],
    )
    def test_kategorien(self, auth_client, created_kunde, sys_wert, dia_wert, kategorie):
        """Die Einstufung folgt dem hoeheren der beiden Werte."""
        resp = auth_client.post(
            "/api/v1/blutdruck", json=_messung(created_kunde["id"], 1, sys_wert, dia_wert)
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["kategorie"] == kategorie


class TestVerlauf:
    def test_verlauf_ohne_messungen(self, auth_client, created_kunde):
        """Ohne Messungen liefert der Verlauf einen leeren, aber gueltigen Datensatz."""
        resp = auth_client.get("/api/v1/blutdruck/verlauf", params={"kunde_id": created_kunde["id"]})
        assert resp.status_code == 200
        data = resp.json()
        assert data["anzahl"] == 0
        assert data["messungen"] == []
        assert data["trend"]["richtung"] == "unbekannt"

    def test_verlauf_unbekannter_kunde(self, auth_client):
        resp = auth_client.get("/api/v1/blutdruck/verlauf", params={"kunde_id": 9999})
        assert resp.status_code == 400

    def test_verlauf_kennzahlen(self, auth_client, created_kunde):
        """Durchschnitt, Extremwerte und Verteilung werden korrekt berechnet."""
        kunde_id = created_kunde["id"]
        for tage, sys_wert, dia_wert, puls in [
            (30, 140, 90, 70),
            (20, 150, 95, 72),
            (10, 130, 85, 68),
            (2, 160, 100, 74),
        ]:
            auth_client.post(
                "/api/v1/blutdruck", json=_messung(kunde_id, tage, sys_wert, dia_wert, puls)
            )

        data = auth_client.get(
            "/api/v1/blutdruck/verlauf", params={"kunde_id": kunde_id}
        ).json()

        assert data["anzahl"] == 4
        assert data["durchschnitt"]["systolisch"] == 145.0
        assert data["durchschnitt"]["diastolisch"] == 92.5
        assert data["durchschnitt"]["puls"] == 71.0
        assert data["max_systolisch"] == 160
        assert data["min_systolisch"] == 130
        assert data["kategorie"] == "hypertonie_1"
        assert data["anteil_erhoeht"] == 75.0
        assert data["verteilung"]["hypertonie_1"] == 2
        assert data["kunde_name"] == "Erika Mustermann"

    def test_verlauf_messungen_chronologisch(self, auth_client, created_kunde):
        """Im Verlauf stehen die Messungen aufsteigend — passend zur Zeitachse."""
        kunde_id = created_kunde["id"]
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 5, 120, 80))
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 50, 150, 95))

        data = auth_client.get(
            "/api/v1/blutdruck/verlauf", params={"kunde_id": kunde_id}
        ).json()
        assert [m["systolisch"] for m in data["messungen"]] == [150, 120]

    def test_trend_steigend(self, auth_client, created_kunde):
        """Steigende Werte werden als steigender Trend erkannt."""
        kunde_id = created_kunde["id"]
        for tage, sys_wert, dia_wert in [(60, 125, 80), (45, 130, 82), (20, 150, 92), (5, 155, 95)]:
            auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, tage, sys_wert, dia_wert))

        trend = auth_client.get(
            "/api/v1/blutdruck/verlauf", params={"kunde_id": kunde_id}
        ).json()["trend"]

        assert trend["richtung"] == "steigend"
        assert trend["delta_systolisch"] == 25.0
        assert trend["delta_diastolisch"] == 12.5
        assert trend["sys_pro_monat"] > 0

    def test_trend_fallend(self, auth_client, created_kunde):
        """Sinkende Werte (z.B. nach Medikamentenumstellung) ergeben einen fallenden Trend."""
        kunde_id = created_kunde["id"]
        for tage, sys_wert, dia_wert in [(60, 165, 100), (45, 160, 98), (20, 138, 86), (5, 132, 84)]:
            auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, tage, sys_wert, dia_wert))

        trend = auth_client.get(
            "/api/v1/blutdruck/verlauf", params={"kunde_id": kunde_id}
        ).json()["trend"]

        assert trend["richtung"] == "fallend"
        assert trend["delta_systolisch"] < 0
        assert trend["sys_pro_monat"] < 0

    def test_trend_stabil(self, auth_client, created_kunde):
        """Kleine Schwankungen gelten als stabil."""
        kunde_id = created_kunde["id"]
        for tage, sys_wert, dia_wert in [(60, 138, 86), (45, 140, 88), (20, 139, 87), (5, 141, 88)]:
            auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, tage, sys_wert, dia_wert))

        trend = auth_client.get(
            "/api/v1/blutdruck/verlauf", params={"kunde_id": kunde_id}
        ).json()["trend"]

        assert trend["richtung"] == "stabil"

    def test_trend_bei_einer_messung_unbekannt(self, auth_client, created_kunde):
        auth_client.post("/api/v1/blutdruck", json=_messung(created_kunde["id"], 3, 140, 90))
        trend = auth_client.get(
            "/api/v1/blutdruck/verlauf", params={"kunde_id": created_kunde["id"]}
        ).json()["trend"]
        assert trend["richtung"] == "unbekannt"

    def test_perioden_wochenweise(self, auth_client, created_kunde):
        """Kurze Zeitraeume werden zu Wochenmittelwerten zusammengefasst."""
        kunde_id = created_kunde["id"]
        # Zwei Messungen in derselben Woche, eine deutlich frueher
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 1, 150, 90))
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 2, 140, 88))
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 30, 120, 80))

        perioden = auth_client.get(
            "/api/v1/blutdruck/verlauf", params={"kunde_id": kunde_id, "gruppierung": "woche"}
        ).json()["perioden"]

        assert len(perioden) >= 2
        assert all(p["periode"].count("-W") == 1 for p in perioden)
        assert sum(p["anzahl"] for p in perioden) == 3
        # Perioden sind chronologisch sortiert
        assert perioden == sorted(perioden, key=lambda p: p["periode"])

    def test_perioden_monatsweise(self, auth_client, created_kunde):
        """Mit Gruppierung 'monat' entstehen Monatsmittelwerte."""
        kunde_id = created_kunde["id"]
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 1, 150, 90))
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 200, 130, 85))

        perioden = auth_client.get(
            "/api/v1/blutdruck/verlauf",
            params={"kunde_id": kunde_id, "tage": 365, "gruppierung": "monat"},
        ).json()["perioden"]

        assert len(perioden) == 2
        assert all("-W" not in p["periode"] for p in perioden)

    def test_ungueltige_gruppierung(self, auth_client, created_kunde):
        resp = auth_client.get(
            "/api/v1/blutdruck/verlauf",
            params={"kunde_id": created_kunde["id"], "gruppierung": "quartal"},
        )
        assert resp.status_code == 400

    def test_zeitraum_begrenzt_messungen(self, auth_client, created_kunde):
        """Der Parameter `tage` schneidet aeltere Messungen ab."""
        kunde_id = created_kunde["id"]
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 200, 170, 105))
        auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, 5, 125, 80))

        data = auth_client.get(
            "/api/v1/blutdruck/verlauf", params={"kunde_id": kunde_id, "tage": 30}
        ).json()
        assert data["anzahl"] == 1
        assert data["max_systolisch"] == 125

    def test_warnung_bei_krisenwert(self, auth_client, created_kunde):
        """Werte ab 180/120 erzeugen einen Hinweis auf ärztliche Abklärung."""
        auth_client.post("/api/v1/blutdruck", json=_messung(created_kunde["id"], 3, 185, 122))
        auth_client.post("/api/v1/blutdruck", json=_messung(created_kunde["id"], 1, 130, 85))

        warnungen = auth_client.get(
            "/api/v1/blutdruck/verlauf", params={"kunde_id": created_kunde["id"]}
        ).json()["warnungen"]

        assert any("ärztliche Abklärung" in w for w in warnungen)

    def test_warnung_bei_dauerhaft_erhoeht(self, auth_client, created_kunde):
        """Drei erhoehte Messungen in Folge werden gemeldet."""
        kunde_id = created_kunde["id"]
        for tage in (15, 10, 5):
            auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, tage, 152, 94))

        warnungen = auth_client.get(
            "/api/v1/blutdruck/verlauf", params={"kunde_id": kunde_id}
        ).json()["warnungen"]

        assert any("letzten drei Messungen" in w for w in warnungen)

    def test_keine_warnung_bei_normalen_werten(self, auth_client, created_kunde):
        kunde_id = created_kunde["id"]
        for tage in (15, 10, 5):
            auth_client.post("/api/v1/blutdruck", json=_messung(kunde_id, tage, 122, 78))

        warnungen = auth_client.get(
            "/api/v1/blutdruck/verlauf", params={"kunde_id": kunde_id}
        ).json()["warnungen"]

        assert warnungen == []

    def test_verlauf_ignoriert_andere_kunden(self, auth_client, created_kunde, sample_kunde):
        """Der Verlauf enthaelt nur die Messungen des angefragten Kunden."""
        zweiter = auth_client.post(
            "/api/v1/kunden", json={**sample_kunde, "name": "Zweitkunde", "vorname": "Otto"}
        ).json()

        auth_client.post("/api/v1/blutdruck", json=_messung(created_kunde["id"], 5, 120, 80))
        auth_client.post("/api/v1/blutdruck", json=_messung(zweiter["id"], 5, 180, 110))

        data = auth_client.get(
            "/api/v1/blutdruck/verlauf", params={"kunde_id": created_kunde["id"]}
        ).json()
        assert data["anzahl"] == 1
        assert data["max_systolisch"] == 120


class TestBlutdruckExport:
    def test_export_enthaelt_blutdruck(self, auth_client, created_kunde, sample_blutdruck):
        """Das JSON-Backup nimmt die Messwerte mit."""
        sample_blutdruck["kunde_id"] = created_kunde["id"]
        auth_client.post("/api/v1/blutdruck", json=sample_blutdruck)

        data = auth_client.get("/api/v1/export").json()
        assert data["counts"]["blutdruck"] == 1
        assert data["blutdruck"][0]["systolisch"] == 148

    def test_import_stellt_blutdruck_wieder_her(self, auth_client, created_kunde, sample_blutdruck):
        """Restore spielt die Messwerte zurueck."""
        sample_blutdruck["kunde_id"] = created_kunde["id"]
        auth_client.post("/api/v1/blutdruck", json=sample_blutdruck)
        backup = auth_client.get("/api/v1/export").json()

        resp = auth_client.post("/api/v1/import", json=backup)
        assert resp.status_code == 200, resp.text
        assert resp.json()["counts"]["blutdruck"] == 1

        messungen = auth_client.get("/api/v1/blutdruck").json()
        assert len(messungen) == 1
        assert messungen[0]["systolisch"] == 148
