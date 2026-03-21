"""Feld-Verschluesselung fuer sensible Daten (Versichertennummer, IBAN).

Nutzt Fernet (AES-128-CBC + HMAC-SHA256) aus dem cryptography-Paket.
ENCRYPTION_KEY muss als Umgebungsvariable gesetzt sein (base64-encoded, 32 Byte).
Generieren mit: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

import os
from cryptography.fernet import Fernet, InvalidToken

_KEY = os.environ.get("ENCRYPTION_KEY")
if not _KEY:
    raise RuntimeError(
        "ENCRYPTION_KEY nicht gesetzt! "
        "Generieren: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
    )

_fernet = Fernet(_KEY.encode())


def encrypt(plaintext: str | None) -> str | None:
    """Verschluesselt einen Klartext-String. Gibt None zurueck wenn Eingabe None."""
    if plaintext is None:
        return None
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str | None) -> str | None:
    """Entschluesselt einen Ciphertext-String. Gibt None zurueck wenn Eingabe None."""
    if ciphertext is None:
        return None
    try:
        return _fernet.decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        return "[ENTSCHLUESSELUNG FEHLGESCHLAGEN]"
