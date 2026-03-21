# Löschkonzept

für die Web-Anwendung entlast.de

gemäß Art. 17 DSGVO, § 35 BDSG

---

## 1. Zweck und Geltungsbereich

Dieses Löschkonzept legt fest, wann und wie personenbezogene Daten in der Anwendung entlast.de gelöscht werden. Es dient der Einhaltung des Grundsatzes der Speicherbegrenzung nach Art. 5 Abs. 1 lit. e DSGVO.

Das Konzept gilt für alle Mandanten (Alltagshilfe-Firmen), die entlast.de nutzen, sowie für den Betreiber der Anwendung.

## 2. Aufbewahrungsfristen

### 2.1 Übersicht

| Datenkategorie | Aufbewahrungsfrist | Rechtsgrundlage | Fristbeginn |
|----------------|-------------------|-----------------|-------------|
| **Rechnungen und Abrechnungsdaten** | 10 Jahre | § 147 Abs. 1 Nr. 1, 4 AO; § 257 Abs. 1 Nr. 1, 4 HGB | Ende des Kalenderjahres der Rechnungsstellung |
| **Leistungsnachweise** | 5 Jahre | §§ 195, 199 BGB (regelmäßige Verjährungsfrist) | Ende des Kalenderjahres, in dem der Anspruch entstanden ist |
| **Kundenstammdaten** (Name, Adresse, Geburtsdatum) | Bis Vertragsende + Ablauf der längsten Aufbewahrungsfrist | Art. 17 DSGVO | Vertragsende mit dem Kunden |
| **Versicherungsdaten** (Versichertennr., Pflegekasse, Pflegegrad) | Wie Leistungsnachweise (5 Jahre) bzw. wie Rechnungen (10 Jahre), sofern in Rechnungen enthalten | § 147 AO, §§ 195, 199 BGB | Siehe jeweilige Datenkategorie |
| **Finanzdaten** (IBAN) | Wie Rechnungen (10 Jahre) | § 147 AO | Ende des Kalenderjahres der letzten Verwendung |
| **Kontaktdaten Angehöriger** | Bis Vertragsende + 1 Jahr | Art. 17 DSGVO | Vertragsende mit dem Kunden |
| **Einwilligungserklärungen** | 3 Jahre nach Widerruf bzw. Vertragsende | Art. 7 Abs. 1 DSGVO (Nachweispflicht), §§ 195, 199 BGB | Ende des Kalenderjahres des Widerrufs/Vertragsende |
| **Audit-Logs** | 7 Jahre | § 147 Abs. 1 Nr. 5 AO (Geschäftskorrespondenz), Nachweispflicht Art. 5 Abs. 2 DSGVO | Ende des Kalenderjahres der Protokollierung |
| **Backups** | 30 Tage (Rolling) | Technische Notwendigkeit | Erstellungsdatum des Backups |
| **Nutzer-Accounts** (Mitarbeiter-Logins) | Bis Deaktivierung + 90 Tage | Art. 17 DSGVO | Deaktivierungsdatum |

### 2.2 Erläuterungen zu den Fristen

**Rechnungen (10 Jahre):** Steuer- und handelsrechtliche Aufbewahrungspflicht. Die Frist beginnt am Ende des Kalenderjahres, in dem die Rechnung erstellt wurde. Beispiel: Rechnung vom 15. März 2026 muss bis zum 31. Dezember 2036 aufbewahrt werden.

**Leistungsnachweise (5 Jahre):** Die regelmäßige Verjährungsfrist für vertragliche Ansprüche beträgt 3 Jahre (§ 195 BGB), beginnt aber erst am Ende des Jahres der Entstehung (§ 199 BGB). Zur Sicherheit wird ein Puffer von 2 Jahren addiert, um auch verzögert geltend gemachte Ansprüche abzudecken.

**Audit-Logs (7 Jahre):** Die Logs dienen dem Nachweis der ordnungsgemäßen Datenverarbeitung und der Rechenschaftspflicht nach Art. 5 Abs. 2 DSGVO. Die Frist orientiert sich an den steuerrechtlichen Aufbewahrungspflichten für Geschäftsunterlagen.

## 3. Löschverfahren

### 3.1 Regelmäßige Löschung (automatisiert)

Folgende Löschungen erfolgen automatisiert durch das System:

| Vorgang | Zeitpunkt | Methode |
|---------|-----------|---------|
| Backup-Rotation | Täglich | Backups älter als 30 Tage werden automatisch überschrieben/gelöscht |
| Session-Daten | Bei Timeout (8h) oder Logout | Automatische Invalidierung |

### 3.2 Regelmäßige Löschung (manuell ausgelöst)

Folgende Löschungen werden durch den Mandanten (Alltagshilfe-Firma) oder den Betreiber ausgelöst:

**Vierteljährliche Prüfung:**
Der Betreiber (entlast.de) prüft quartalsweise, ob Daten ihre Aufbewahrungsfrist überschritten haben. Die Prüfung wird im Audit-Log dokumentiert.

**Löschlauf:**
1. System identifiziert Datensätze mit abgelaufener Aufbewahrungsfrist
2. Der Mandant wird informiert und erhält 14 Tage zur Prüfung/zum Widerspruch
3. Nach Freigabe: Technische Löschung

### 3.3 Technische Löschung in SQLite

Die technische Löschung erfolgt in folgenden Schritten:

1. **DELETE-Statement:** Datensätze werden aus den Tabellen gelöscht
2. **VACUUM:** Nach der Löschung wird ein `VACUUM`-Befehl auf die SQLite-Datenbank ausgeführt, um den freigegebenen Speicherplatz tatsächlich zu überschreiben und eine forensische Wiederherstellung zu verhindern
3. **Verschlüsselte Felder:** Bei Löschung von Datensätzen mit Feld-Verschlüsselung (AES-128) werden sowohl der Datensatz als auch ggf. zugehörige Schlüsselfragmente gelöscht
4. **Audit-Log-Eintrag:** Jede Löschung wird im Audit-Log mit Zeitstempel, Löschgrund und durchführendem Nutzer dokumentiert

### 3.4 Löschung auf Antrag (Betroffenenrecht)

Bei einem Löschantrag einer betroffenen Person (Art. 17 DSGVO):

1. Der Mandant prüft den Antrag und informiert den Betreiber
2. Prüfung, ob gesetzliche Aufbewahrungspflichten der Löschung entgegenstehen
3. Falls ja: **Sperrung** statt Löschung (siehe Abschnitt 4)
4. Falls nein: Technische Löschung innerhalb von **30 Tagen**
5. Bestätigung an die betroffene Person
6. Dokumentation im Audit-Log

### 3.5 Löschung bei Vertragsende (Mandant kündigt entlast.de)

Bei Kündigung des Nutzungsvertrags durch einen Mandanten:

1. Mandant erhält **Datenexport** (CSV/JSON) auf Anfrage
2. **30 Tage Übergangsfrist** — Mandant kann den Export prüfen
3. Danach: Vollständige Löschung aller Mandantendaten
4. Ausnahme: Rechnungsdaten, deren Aufbewahrungsfrist noch läuft, werden **gesperrt** und erst nach Fristablauf gelöscht
5. Schriftliche Löschbestätigung an den Mandanten
6. Backups werden gemäß Backup-Rotation (30 Tage) bereinigt

## 4. Sperren statt Löschen

Wenn eine Löschung wegen gesetzlicher Aufbewahrungspflichten noch nicht möglich ist, werden die Daten **gesperrt**:

### 4.1 Was bedeutet Sperrung?

- Gesperrte Daten sind im normalen Betrieb **nicht mehr sichtbar** und **nicht mehr zugreifbar**
- Sie werden in der Datenbank mit einem Sperrvermerk versehen (`status = 'gesperrt'`, `gesperrt_am`, `gesperrt_grund`, `loeschbar_ab`)
- Zugriff nur noch durch den Betreiber bei berechtigtem Anlass (z. B. Steuerprüfung, gerichtliche Auseinandersetzung)

### 4.2 Wann wird gesperrt?

- Kunde beendet Vertragsverhältnis mit der Alltagshilfe-Firma, aber Rechnungen sind noch keine 10 Jahre alt
- Betroffene Person verlangt Löschung, aber Aufbewahrungspflicht läuft noch
- Widerruf der Einwilligung für Gesundheitsdaten bei noch laufenden Aufbewahrungsfristen

### 4.3 Überführung in Löschung

- Das System prüft quartalsweise, ob gesperrte Datensätze ihr `loeschbar_ab`-Datum erreicht haben
- Erreichte Datensätze werden in den regulären Löschlauf übernommen

## 5. Zuständigkeiten

| Aufgabe | Zuständig |
|---------|-----------|
| Löschung von Kundendaten im Tagesgeschäft | Mandant (Alltagshilfe-Firma) |
| Löschlauf für abgelaufene Fristen | Betreiber (entlast.de) |
| Prüfung von Löschanträgen betroffener Personen | Mandant (verantwortlich) mit Unterstützung des Betreibers |
| Technische Durchführung der Löschung | Betreiber (entlast.de) |
| Dokumentation im Audit-Log | Automatisch durch das System |
| Quartalsweise Prüfung der Fristen | Betreiber (entlast.de) |
| Jährliche Überprüfung dieses Löschkonzepts | Betreiber (entlast.de) |

## 6. Dokumentation und Nachweis

Jede Löschung wird wie folgt dokumentiert:

**Im Audit-Log:**
- Zeitpunkt der Löschung
- Art der gelöschten Daten (Kategorie, Anzahl Datensätze)
- Löschgrund (Fristablauf / Betroffenenantrag / Vertragsende)
- Durchführender Nutzer
- Mandant

**Löschprotokoll (jährlich):**
Der Betreiber erstellt jährlich ein zusammenfassendes Löschprotokoll mit:
- Anzahl der durchgeführten Löschungen pro Kategorie
- Anzahl offener Sperrungen und deren voraussichtliches Löschdatum
- Besondere Vorkommnisse (z. B. abgelehnte Löschanträge)

## 7. Sonderfälle

### 7.1 Datenpanne

Im Fall einer Datenpanne werden die betroffenen Daten **nicht** vorsorglich gelöscht, sondern es greift das Meldeverfahren nach Art. 33/34 DSGVO. Die Löschung erfolgt erst, wenn sichergestellt ist, dass sie nicht zur Aufklärung benötigt werden.

### 7.2 Behördliche Anfragen

Bei Anfragen von Steuerbehörden oder Aufsichtsbehörden wird die Löschung der betroffenen Daten ausgesetzt, bis die Anfrage abgeschlossen ist.

### 7.3 Insolvenz/Betriebsaufgabe des Mandanten

Gibt ein Mandant sein Geschäft auf und meldet sich nicht innerhalb von 90 Tagen nach Vertragsende, werden die Daten gemäß dem regulären Verfahren (Abschnitt 3.5) gelöscht.

### 7.4 Einstellung von entlast.de

Im Fall der Einstellung des Dienstes:
1. Alle Mandanten werden mindestens **3 Monate** vorher informiert
2. Datenexport wird allen Mandanten angeboten
3. Nach Ablauf der Frist: Vollständige Löschung aller Daten
4. Ausnahme: Steuerlich relevante Daten des Betreibers (eigene Aufbewahrungspflicht)

---

*Stand: [DATUM]*
*Nächste Überprüfung: [DATUM + 1 JAHR]*
*Verantwortlich: Christoph Glunz, entlast.de*
