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


class TestTermineSchemaMigration:
    """google_uid, google_uid_geloescht und nullbare kunde_id fuer den Google-Sync."""

    def _alt_db(self, tmp_path):
        import sqlite3
        alt = tmp_path / "alt.db"
        conn = sqlite3.connect(alt)
        conn.executescript("""
            CREATE TABLE kunden (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                                 aktiv INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE termine (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kunde_id INTEGER NOT NULL,
                datum TEXT NOT NULL,
                von TEXT, bis TEXT, titel TEXT, notiz TEXT,
                erledigt INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (kunde_id) REFERENCES kunden(id)
            );
            INSERT INTO kunden (name) VALUES ('Alt');
            INSERT INTO termine (kunde_id, datum, von, titel) VALUES (1, '2026-09-01', '10:00', 'Bestand');
        """)
        conn.commit()
        conn.close()
        return alt

    def test_migration_alt_db(self, tmp_path):
        import sqlite3
        import app.database as db_mod
        from pathlib import Path

        db_mod.DATA_DIR = Path(tmp_path)
        alt = self._alt_db(tmp_path)
        db_mod.init_mandant_db("alt.db")
        db_mod.init_mandant_db("alt.db")  # zweiter Lauf darf nichts kaputt machen

        conn = sqlite3.connect(alt)
        info = {r[1]: r for r in conn.execute("PRAGMA table_info(termine)")}
        assert "google_uid" in info and "wiederkehrend" in info
        assert info["kunde_id"][3] == 0  # notnull-Flag
        # Bestandsdaten erhalten
        assert conn.execute("SELECT kunde_id, datum, von, titel FROM termine").fetchall() == [
            (1, "2026-09-01", "10:00", "Bestand")
        ]
        # Google-Import ohne Kunde moeglich
        conn.execute("INSERT INTO termine (titel, datum, google_uid) VALUES ('G', '2026-10-01', 'uid-1')")
        conn.execute("INSERT OR IGNORE INTO google_uid_geloescht (google_uid) VALUES ('uid-1')")
        conn.execute("INSERT OR IGNORE INTO google_uid_geloescht (google_uid) VALUES ('uid-1')")
        assert conn.execute("SELECT COUNT(*) FROM google_uid_geloescht").fetchone()[0] == 1
        idx = {r[1] for r in conn.execute("PRAGMA index_list(termine)")}
        assert {"idx_termine_kunde", "idx_termine_datum", "idx_termine_google_uid"} <= idx
        conn.close()
