"""Tests: Request-Body von POST /lexoffice/rechnung-erstellen.

Es geht kein einziger Aufruf an Lexoffice: Der gefaelschte HTTP-Client nimmt den
Body nur entgegen und bricht bei jeder unerwarteten Adresse ab. Es entsteht also
keine Rechnungsnummer.
"""

import copy

import httpx
import pytest

STEUER_NOTIZ = "Umsatzsteuer wird nicht berechnet (§ 19 Abs. 1 UStG)"

KASSEN_REMARK = (
    "Die Abrechnung erfolgt im Rahmen der Direktabrechnung gemäß der vorliegenden "
    "Abtretungserklärung. Die Leistungen wurden nach § 45b SGB XI (Entlastungsbetrag) als "
    "anerkanntes Angebot zur Unterstützung im Alltag gemäß § 45a SGB XI erbracht. "
    "Die Abtretung der Ansprüche erfolgte nach § 13 SGB V i. V. m. § 190 BGB. "
    "Ich bitte um Überweisung auf die in der Rechnung genannte Bankverbindung."
)
PRIVAT_REMARK = "Vielen Dank für die gute Zusammenarbeit."


class _FakeResponse:
    def __init__(self, status_code, data):
        self.status_code = status_code
        self._data = data
        self.text = str(data)
        self.content = b""

    def json(self):
        return self._data


class _FakeClient:
    """Ersetzt httpx.AsyncClient. Merkt sich jeden POST, ruft nie das Netz."""

    posts = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, **kwargs):
        if "/contacts/" in url:
            return _FakeResponse(200, {"addresses": {"billing": [
                {"street": "Kassenweg 1", "zip": "10000", "city": "Berlin"}
            ]}})
        raise AssertionError(f"Unerwarteter GET: {url}")

    async def post(self, url, json=None, **kwargs):
        if not url.endswith("/invoices?finalize=true"):
            raise AssertionError(f"Unerwarteter POST: {url}")
        _FakeClient.posts.append(copy.deepcopy(json))
        return _FakeResponse(201, {"id": "test-invoice-id", "documentFileId": "test-file-id"})


@pytest.fixture
def lex(auth_client, monkeypatch):
    """Eingeloggter Client mit API-Key und gefaelschtem Lexoffice."""
    _FakeClient.posts = []
    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    from app.database import get_mandant_db

    conn = get_mandant_db("test_mandant.db")
    try:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('lexoffice_api_key', 'test-key')"
        )
        conn.commit()
    finally:
        conn.close()
    return auth_client


def _kunde(client, **felder):
    daten = {
        "name": "Testmann",
        "vorname": "Till",
        "strasse": "Teststr. 2",
        "plz": "45525",
        "ort": "Hattingen",
        "kundentyp": "pflege",
        "aktiv": True,
    }
    daten.update(felder)
    resp = client.post("/api/v1/kunden", json=daten)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _leistung(client, kunde_id, tag, von="09:00", bis="10:30"):
    resp = client.post("/api/v1/leistungen", json={
        "kunde_id": kunde_id, "datum": f"2026-10-{tag:02d}", "von": von, "bis": bis,
    })
    assert resp.status_code == 201, resp.text


def _erstellen(client, kunde_id, empfaenger):
    return client.post("/api/v1/lexoffice/rechnung-erstellen", json={
        "kunde_id": kunde_id, "monat": 10, "jahr": 2026, "empfaenger": empfaenger,
    })


def _body_ohne_datum(body):
    """Tagesabhaengige Felder raus; der Rest muss exakt stimmen."""
    body = copy.deepcopy(body)
    body.pop("voucherDate")
    label = body["paymentConditions"].pop("paymentTermLabel")
    assert label.startswith("Ich bitte um umgehende Zahlung, spätestens jedoch bis zum ")
    body["_label_mit_sgb"] = "§ 36 Abs. 2 SGB XI" in label
    return body


def _erwartet(address, pos_name, pos_desc, remark, label_mit_sgb):
    return {
        "address": address,
        "lineItems": [{
            "type": "custom",
            "name": pos_name,
            "description": pos_desc,
            "quantity": 1.5,
            "unitName": "Stunde(n)",
            "unitPrice": {"currency": "EUR", "netAmount": 32.75, "taxRatePercentage": 0},
        }],
        "totalPrice": {"currency": "EUR"},
        "taxConditions": {"taxType": "vatfree", "taxTypeNote": STEUER_NOTIZ},
        "title": "Rechnung",
        "introduction": "Meine Leistungen stelle ich Ihnen wie folgt in Rechnung.",
        "remark": remark,
        "shippingConditions": {
            "shippingType": "serviceperiod",
            "shippingDate": "2026-10-05T00:00:00.000+01:00",
            "shippingEndDate": "2026-10-05T00:00:00.000+01:00",
        },
        "paymentConditions": {"paymentTermDuration": 30},
        "_label_mit_sgb": label_mit_sgb,
    }


KUNDE_ADRESSE = {
    "name": "Till Testmann",
    "street": "Teststr. 2",
    "zip": "45525",
    "city": "Hattingen",
    "countryCode": "DE",
}


class TestBodyJeVariante:
    def test_kasse(self, lex):
        kid = _kunde(lex, pflegekasse="Testkasse", versichertennummer="T123456789")
        _leistung(lex, kid, 5)
        assert _erstellen(lex, kid, "kasse").status_code == 200
        assert len(_FakeClient.posts) == 1
        assert _body_ohne_datum(_FakeClient.posts[0]) == _erwartet(
            {
                "name": "Testkasse",
                "supplement": "z. Hd. Leistungsabteilung – Vers.: Till Testmann",
                "countryCode": "DE",
            },
            "Till Testmann",
            "Vers.-Nr.: T123456789\nBetreuung im Alltag nach § 45b SGB XI",
            KASSEN_REMARK,
            True,
        )

    def test_privat_ohne_kasse(self, lex):
        kid = _kunde(lex)
        _leistung(lex, kid, 5)
        assert _erstellen(lex, kid, "direkt").status_code == 200
        assert _body_ohne_datum(_FakeClient.posts[0]) == _erwartet(
            KUNDE_ADRESSE, "Alltagshilfe", "Betreuung im Alltag", PRIVAT_REMARK, False
        )

    def test_direkt_trotz_kasse_geht_an_kunden(self, lex):
        kid = _kunde(lex, pflegekasse="Testkasse")
        _leistung(lex, kid, 5)
        assert _erstellen(lex, kid, "direkt").status_code == 200
        assert _body_ohne_datum(_FakeClient.posts[0]) == _erwartet(
            KUNDE_ADRESSE, "Alltagshilfe", "Betreuung im Alltag", PRIVAT_REMARK, False
        )

    def test_lbv_geht_an_kunden(self, lex):
        kid = _kunde(lex, pflegekasse="Testkasse", besonderheiten="50% LBV")
        _leistung(lex, kid, 5)
        resp = _erstellen(lex, kid, "kasse")
        assert resp.status_code == 200
        assert resp.json()["variante"] == "lbv"
        assert _body_ohne_datum(_FakeClient.posts[0]) == _erwartet(
            KUNDE_ADRESSE, "Alltagshilfe", "Betreuung im Alltag", PRIVAT_REMARK, False
        )


class TestKeineStilleUmleitung:
    @pytest.mark.parametrize("kasse", [None, "", "Sonstige"])
    def test_kasse_verlangt_aber_nicht_eingetragen(self, lex, kasse):
        """Kein Fallback auf den Kunden und vor allem kein POST an Lexoffice."""
        kid = _kunde(lex, pflegekasse=kasse)
        _leistung(lex, kid, 5)
        resp = _erstellen(lex, kid, "kasse")
        assert resp.status_code == 409
        assert "keine Pflegekasse" in resp.json()["detail"]
        assert _FakeClient.posts == []

    def test_fehlender_empfaenger_gilt_als_kasse(self, lex):
        kid = _kunde(lex)
        _leistung(lex, kid, 5)
        resp = lex.post("/api/v1/lexoffice/rechnung-erstellen", json={
            "kunde_id": kid, "monat": 10, "jahr": 2026,
        })
        assert resp.status_code == 409
        assert _FakeClient.posts == []


class TestRundung:
    def test_einzelbetrag_kaufmaennisch(self, lex):
        """1,5 Std. x 32,75 = 49,125 wird bei neuen Leistungen 49,13, nicht 49,12."""
        kid = _kunde(lex)
        resp = lex.post("/api/v1/leistungen", json={
            "kunde_id": kid, "datum": "2026-10-05", "von": "09:00", "bis": "10:30",
        })
        assert resp.json()["betrag"] == 49.13

    def test_mitgegebener_betrag_bleibt(self, lex):
        kid = _kunde(lex)
        resp = lex.post("/api/v1/leistungen", json={
            "kunde_id": kid, "datum": "2026-10-05", "von": "09:00", "bis": "10:30", "betrag": 49.12,
        })
        assert resp.json()["betrag"] == 49.12

    def test_neun_termine_ergeben_gesamtstunden_mal_satz(self, lex):
        kid = _kunde(lex)
        for tag in range(1, 10):
            _leistung(lex, kid, tag)
        resp = _erstellen(lex, kid, "direkt")
        assert resp.status_code == 200
        assert resp.json()["betrag"] == 442.13
        assert resp.json()["stunden"] == 13.5
        position = _FakeClient.posts[0]["lineItems"][0]
        assert position["quantity"] == 13.5
        assert position["unitPrice"]["netAmount"] == 32.75

    def test_lokaler_betrag_passt_zur_rechnungsposition(self, lex):
        """80 Minuten: Position 1,33 Std. x 32,75 = 43,56, nicht ungerundet 43,67."""
        kid = _kunde(lex)
        _leistung(lex, kid, 5, von="09:00", bis="10:20")
        resp = _erstellen(lex, kid, "direkt")
        assert _FakeClient.posts[0]["lineItems"][0]["quantity"] == 1.33
        assert resp.json()["betrag"] == 43.56
