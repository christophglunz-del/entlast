"""Tests fuer Audit-Logging."""

import pytest


class TestAuditLog:
    def test_audit_log_on_create(self, auth_client, sample_kunde):
        """POST Kunde erzeugt einen Audit-Eintrag in der Mandanten-DB."""
        resp = auth_client.post("/api/v1/kunden", json=sample_kunde)
        assert resp.status_code == 201

        # Audit-Log in der DB pruefen
        from app.database import get_mandant_db
        conn = get_mandant_db("test_mandant.db")
        try:
            logs = conn.execute(
                "SELECT * FROM audit_log WHERE action LIKE '%POST%kunden%'"
            ).fetchall()
            assert len(logs) >= 1, "Kein Audit-Eintrag fuer POST /kunden gefunden"
            log = logs[-1]
            assert log["user_id"] is not None
            assert "POST" in log["action"]
        finally:
            conn.close()

    def test_audit_log_on_delete(self, auth_client, created_kunde):
        """DELETE Kunde erzeugt einen Audit-Eintrag."""
        kunde_id = created_kunde["id"]
        auth_client.delete(f"/api/v1/kunden/{kunde_id}")

        from app.database import get_mandant_db
        conn = get_mandant_db("test_mandant.db")
        try:
            logs = conn.execute(
                "SELECT * FROM audit_log WHERE action LIKE '%DELETE%kunden%'"
            ).fetchall()
            assert len(logs) >= 1, "Kein Audit-Eintrag fuer DELETE /kunden gefunden"
        finally:
            conn.close()

    def test_audit_log_immutable(self, auth_client, sample_kunde):
        """Audit-Eintraege koennen nicht ueber die API geloescht werden.

        Die audit_log-Tabelle hat keinen DELETE-Endpoint.
        Wir pruefen, dass kein solcher Endpoint existiert.
        """
        # Erstmal einen Eintrag erzeugen
        auth_client.post("/api/v1/kunden", json=sample_kunde)

        # Versuch, Audit-Log zu loeschen (sollte 404 oder 405 geben)
        resp = auth_client.delete("/api/v1/audit_log/1")
        assert resp.status_code in (404, 405, 401)
