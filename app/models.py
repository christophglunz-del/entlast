"""Pydantic-Modelle fuer Request/Response-Validierung."""

from datetime import date, datetime
from pydantic import BaseModel, Field
from typing import Any, Optional


# --- Auth ---

class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    message: str = "Login erfolgreich"
    user: "UserResponse"
    firma: "FirmaResponse"


class UserResponse(BaseModel):
    id: int
    username: str
    name: str
    rolle: str
    mandant_id: int


# --- Firma ---

class FirmaResponse(BaseModel):
    name: str | None = None
    inhaber: str | None = None
    strasse: str | None = None
    plz: str | None = None
    ort: str | None = None
    telefon: str | None = None
    email: str | None = None
    steuernummer: str | None = None
    iban: str | None = None
    bic: str | None = None
    bank: str | None = None
    logo_datei: str | None = None
    farbe_primary: str | None = "#E91E7B"
    farbe_primary_dark: str | None = "#C2185B"
    untertitel: str | None = None
    kleinunternehmer: bool = True
    stundensatz: float | None = 32.75
    km_satz: float | None = 0.30
    start_adresse: str | None = None


class FirmaUpdate(BaseModel):
    name: str | None = None
    inhaber: str | None = None
    strasse: str | None = None
    plz: str | None = None
    ort: str | None = None
    telefon: str | None = None
    email: str | None = None
    steuernummer: str | None = None
    iban: str | None = None
    bic: str | None = None
    bank: str | None = None
    logo_datei: str | None = None
    farbe_primary: str | None = None
    farbe_primary_dark: str | None = None
    untertitel: str | None = None
    kleinunternehmer: bool | None = None
    stundensatz: float | None = None
    km_satz: float | None = None
    start_adresse: str | None = None


# --- Kunden ---

class KundeCreate(BaseModel):
    name: str
    vorname: str | None = None
    strasse: str | None = None
    plz: str | None = None
    ort: str | None = None
    telefon: str | None = None
    email: str | None = None
    geburtsdatum: str | None = None
    pflegegrad: int | None = None
    versichertennummer: str | None = None
    pflegekasse: str | None = None
    pflegekasse_fax: str | None = None
    iban: str | None = None
    kundentyp: str = "pflege"  # pflege oder dienstleistung
    aktiv: bool = True
    besonderheiten: str | None = None
    lexoffice_id: str | None = None


class KundeUpdate(BaseModel):
    name: str | None = None
    vorname: str | None = None
    strasse: str | None = None
    plz: str | None = None
    ort: str | None = None
    telefon: str | None = None
    email: str | None = None
    geburtsdatum: str | None = None
    pflegegrad: int | None = None
    versichertennummer: str | None = None
    pflegekasse: str | None = None
    pflegekasse_fax: str | None = None
    iban: str | None = None
    kundentyp: str | None = None
    aktiv: bool | None = None
    besonderheiten: str | None = None
    lexoffice_id: str | None = None


class KundeResponse(BaseModel):
    id: int
    name: str
    vorname: str | None = None
    strasse: str | None = None
    plz: str | None = None
    ort: str | None = None
    telefon: str | None = None
    email: str | None = None
    geburtsdatum: str | None = None
    pflegegrad: int | None = None
    versichertennummer: str | None = None
    pflegekasse: str | None = None
    pflegekasse_fax: str | None = None
    iban: str | None = None
    kundentyp: str = "pflege"
    aktiv: bool = True
    besonderheiten: str | None = None
    lexoffice_id: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


# --- Leistungen ---

class LeistungCreate(BaseModel):
    model_config = {"populate_by_name": True}
    kunde_id: int
    datum: str
    von: str | None = Field(None, alias="startzeit")
    bis: str | None = Field(None, alias="endzeit")
    dauer_std: float | None = None
    leistungsarten: str | None = None  # JSON-String
    betrag: float | None = None
    unterschrift_betreuer: str | None = None  # base64
    unterschrift_versicherter: str | None = None  # base64
    notiz: str | None = None


class LeistungUpdate(BaseModel):
    model_config = {"populate_by_name": True}
    kunde_id: int | None = None
    datum: str | None = None
    von: str | None = Field(None, alias="startzeit")
    bis: str | None = Field(None, alias="endzeit")
    dauer_std: float | None = None
    leistungsarten: str | None = None
    betrag: float | None = None
    unterschrift_betreuer: str | None = None
    unterschrift_versicherter: str | None = None
    notiz: str | None = None


class LeistungResponse(BaseModel):
    id: int
    kunde_id: int
    datum: str
    von: str | None = None
    bis: str | None = None
    startzeit: str | None = None  # Alias fuer Frontend-Kompatibilitaet
    endzeit: str | None = None    # Alias fuer Frontend-Kompatibilitaet
    dauer_std: float | None = None
    leistungsarten: str | None = None
    betrag: float | None = None
    unterschrift_betreuer: str | None = None
    unterschrift_versicherter: str | None = None
    notiz: str | None = None
    created_at: str | None = None


# --- Fahrten ---

class FahrtCreate(BaseModel):
    model_config = {"populate_by_name": True}
    kunde_id: int | None = Field(None, alias="kundeId")
    datum: str
    wochentag: str | None = None
    start_adresse: str | None = Field(None, alias="startAdresse")
    ziel_adressen: list[str] | None = Field(None, alias="zielAdressen")
    gesamt_km: float | None = Field(None, alias="gesamtKm")
    tracking_km: float | None = Field(None, alias="trackingKm")
    betrag: float | None = None
    notiz: str | None = None
    gps_track: str | None = Field(None, alias="gpsTrack")
    # Legacy-Felder (altes Schema)
    von_ort: str | None = None
    nach_ort: str | None = None
    km: float | None = None


class FahrtUpdate(BaseModel):
    model_config = {"populate_by_name": True}
    kunde_id: int | None = Field(None, alias="kundeId")
    datum: str | None = None
    wochentag: str | None = None
    start_adresse: str | None = Field(None, alias="startAdresse")
    ziel_adressen: list[str] | None = Field(None, alias="zielAdressen")
    gesamt_km: float | None = Field(None, alias="gesamtKm")
    tracking_km: float | None = Field(None, alias="trackingKm")
    betrag: float | None = None
    notiz: str | None = None
    gps_track: str | None = Field(None, alias="gpsTrack")
    von_ort: str | None = None
    nach_ort: str | None = None
    km: float | None = None


class FahrtResponse(BaseModel):
    id: int
    kunde_id: int | None = None
    datum: str
    wochentag: str | None = None
    start_adresse: str | None = None
    ziel_adressen: list[str] | None = None
    gesamt_km: float | None = None
    tracking_km: float | None = None
    betrag: float | None = None
    notiz: str | None = None
    gps_track: str | None = None
    von_ort: str | None = None
    nach_ort: str | None = None
    km: float | None = None
    created_at: str | None = None


# --- Termine ---

class TerminCreate(BaseModel):
    model_config = {"populate_by_name": True}
    kunde_id: int = Field(..., alias="kundeId")
    datum: str
    von: str | None = Field(None, alias="startzeit")
    bis: str | None = Field(None, alias="endzeit")
    titel: str | None = None
    notiz: str | None = Field(None, alias="notizen")
    erledigt: bool = False
    wiederkehrend: int | None = 0
    wiederholungs_muster: Any | None = Field(None, alias="wiederholungsMuster")


class TerminUpdate(BaseModel):
    model_config = {"populate_by_name": True}
    kunde_id: int | None = Field(None, alias="kundeId")
    datum: str | None = None
    von: str | None = Field(None, alias="startzeit")
    bis: str | None = Field(None, alias="endzeit")
    titel: str | None = None
    notiz: str | None = Field(None, alias="notizen")
    erledigt: bool | None = None
    wiederkehrend: int | None = None
    wiederholungs_muster: Any | None = Field(None, alias="wiederholungsMuster")


class TerminResponse(BaseModel):
    id: int
    kunde_id: int
    datum: str
    von: str | None = None
    bis: str | None = None
    startzeit: str | None = None
    endzeit: str | None = None
    titel: str | None = None
    notiz: str | None = None
    notizen: str | None = None
    erledigt: bool = False
    wiederkehrend: int = 0
    wiederholungsMuster: dict | None = None
    created_at: str | None = None


# --- Abtretungen ---

class AbtretungCreate(BaseModel):
    kunde_id: int
    datum: str
    gueltig_ab: str | None = None
    gueltig_bis: str | None = None
    unterschrift: str | None = None  # base64
    pflegekasse: str | None = None


class AbtretungUpdate(BaseModel):
    kunde_id: int | None = None
    datum: str | None = None
    gueltig_ab: str | None = None
    gueltig_bis: str | None = None
    unterschrift: str | None = None
    pflegekasse: str | None = None


class AbtretungResponse(BaseModel):
    id: int
    kunde_id: int
    datum: str
    gueltig_ab: str | None = None
    gueltig_bis: str | None = None
    unterschrift: str | None = None
    pflegekasse: str | None = None
    created_at: str | None = None


# --- Rechnungen ---

class RechnungCreate(BaseModel):
    kunde_id: int
    rechnungsnummer: str | None = None
    datum: str | None = None
    monat: int | None = None
    jahr: int | None = None
    typ: str = "kasse"  # kasse, privat, lbv
    positionen: str | None = None  # JSON-String
    betrag_netto: float | None = None
    betrag_brutto: float | None = None
    status: str = "entwurf"  # entwurf, versendet, bezahlt
    lexoffice_id: str | None = None
    versand_art: str | None = None
    versand_datum: str | None = None


class RechnungUpdate(BaseModel):
    kunde_id: int | None = None
    rechnungsnummer: str | None = None
    datum: str | None = None
    monat: int | None = None
    jahr: int | None = None
    typ: str | None = None
    positionen: str | None = None
    betrag_netto: float | None = None
    betrag_brutto: float | None = None
    status: str | None = None
    lexoffice_id: str | None = None
    versand_art: str | None = None
    versand_datum: str | None = None


class RechnungResponse(BaseModel):
    id: int
    kunde_id: int
    rechnungsnummer: str | None = None
    datum: str | None = None
    monat: int | None = None
    jahr: int | None = None
    typ: str = "kasse"
    positionen: str | None = None
    betrag_netto: float | None = None
    betrag_brutto: float | None = None
    status: str = "entwurf"
    lexoffice_id: str | None = None
    versand_art: str | None = None
    versand_datum: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


# --- Pflegekassen ---

class PflegekasseCreate(BaseModel):
    name: str
    strasse: str | None = None
    plz: str | None = None
    ort: str | None = None
    fax: str | None = None
    ik_nummer: str | None = None


class PflegekasseUpdate(BaseModel):
    name: str | None = None
    strasse: str | None = None
    plz: str | None = None
    ort: str | None = None
    fax: str | None = None
    ik_nummer: str | None = None


class PflegekasseResponse(BaseModel):
    id: int
    name: str
    strasse: str | None = None
    plz: str | None = None
    ort: str | None = None
    fax: str | None = None
    ik_nummer: str | None = None


# --- Audit Log ---

class AuditLogEntry(BaseModel):
    id: int
    timestamp: str
    user_id: int | None = None
    action: str
    resource_type: str | None = None
    resource_id: int | None = None
    old_value: str | None = None  # JSON
    new_value: str | None = None  # JSON
    ip_address: str | None = None
    status: str | None = None
