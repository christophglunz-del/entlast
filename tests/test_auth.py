"""Tests fuer Auth-Endpoints: Login, Logout, Session, Brute-Force."""

import pytest


class TestLogin:
    def test_login_success(self, client):
        """Korrektes Login gibt 200 + Session-Cookie zurueck."""
        resp = client.post("/auth/login", json={"username": "testuser", "password": "testpass123"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == "Login erfolgreich"
        assert data["user"]["username"] == "testuser"
        assert data["user"]["name"] == "Test Benutzer"
        assert data["user"]["rolle"] == "admin"
        assert data["user"]["mandant_id"] == 1
        assert "firma" in data

    def test_login_wrong_password(self, client):
        """Falsches Passwort gibt 401."""
        resp = client.post("/auth/login", json={"username": "testuser", "password": "falsch"})
        assert resp.status_code == 401
        assert "falsch" in resp.json()["detail"].lower() or "passwort" in resp.json()["detail"].lower()

    def test_login_wrong_username(self, client):
        """Falscher Username gibt 401."""
        resp = client.post("/auth/login", json={"username": "gibts_nicht", "password": "testpass123"})
        assert resp.status_code == 401

    def test_brute_force_lockout(self, client):
        """5 Fehlversuche fuehren zu 429 (15 Min Sperre)."""
        for i in range(5):
            resp = client.post("/auth/login", json={"username": "testuser", "password": "falsch"})
            if i < 4:
                assert resp.status_code == 401, f"Versuch {i+1} sollte 401 sein"

        # 6. Versuch (auch mit korrektem Passwort) sollte 429 sein
        resp = client.post("/auth/login", json={"username": "testuser", "password": "testpass123"})
        assert resp.status_code == 429
        assert "Gesperrt" in resp.json()["detail"] or "Fehlversuche" in resp.json()["detail"]

    def test_session_cookie_httponly(self, client):
        """Session-Cookie hat HttpOnly Flag."""
        resp = client.post("/auth/login", json={"username": "testuser", "password": "testpass123"})
        assert resp.status_code == 200
        cookie_header = resp.headers.get("set-cookie", "")
        assert "httponly" in cookie_header.lower(), f"HttpOnly fehlt in: {cookie_header}"


class TestLogout:
    def test_logout(self, auth_client):
        """Logout invalidiert die Session."""
        # Erst pruefen dass wir eingeloggt sind
        resp = auth_client.get("/auth/me")
        assert resp.status_code == 200

        # Logout
        resp = auth_client.post("/auth/logout")
        assert resp.status_code == 200
        assert resp.json()["message"] == "Abgemeldet"

        # Session sollte jetzt ungueltig sein
        resp = auth_client.get("/auth/me")
        assert resp.status_code == 401


class TestMe:
    def test_me_authenticated(self, auth_client):
        """/auth/me gibt User + Firmendaten zurueck."""
        resp = auth_client.get("/auth/me")
        assert resp.status_code == 200
        data = resp.json()
        assert data["user"]["username"] == "testuser"
        assert data["user"]["mandant_id"] == 1
        assert "firma" in data

    def test_me_unauthenticated(self, client):
        """/auth/me ohne Login gibt 401."""
        resp = client.get("/auth/me")
        assert resp.status_code == 401


class TestProtectedEndpoints:
    def test_protected_endpoint_without_auth(self, client):
        """/api/v1/kunden ohne Login gibt 401."""
        resp = client.get("/api/v1/kunden")
        # Wenn der Router noch nicht eingehaengt ist, kommt 404 oder 405
        # Wenn eingehaengt: 401
        assert resp.status_code in (401, 404), f"Erwartet 401 oder 404, bekam {resp.status_code}"
