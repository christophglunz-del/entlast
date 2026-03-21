# Vertrag zur Auftragsverarbeitung (AVV)

gemäß Art. 28 Datenschutz-Grundverordnung (DSGVO)

---

## Vertragsparteien

**Verantwortlicher (Auftraggeber):**

[FIRMA]
[ANSCHRIFT]
[PLZ] [ORT]
Vertreten durch: [GESCHÄFTSFÜHRER/INHABER]
E-Mail: [E-MAIL]
Telefon: [TELEFON]

— nachfolgend **„Auftraggeber"** —

**Auftragsverarbeiter:**

Christoph Glunz
entlast.de
[ANSCHRIFT BETREIBER]
[PLZ] [ORT BETREIBER]
E-Mail: [E-MAIL BETREIBER]
Telefon: [TELEFON BETREIBER]

— nachfolgend **„Auftragnehmer"** —

gemeinsam **„Parteien"**

---

## § 1 Gegenstand und Dauer der Verarbeitung

(1) Der Auftragnehmer betreibt die Web-Anwendung **entlast.de**, mit der der Auftraggeber seine Geschäftsprozesse als Anbieter von Alltagshilfe nach § 45b SGB XI digital verwaltet. Der Auftragnehmer verarbeitet dabei personenbezogene Daten im Auftrag und nach Weisung des Auftraggebers.

(2) Der Gegenstand der Verarbeitung umfasst insbesondere:
- Verwaltung von Kundenstammdaten (Pflegebedürftige)
- Erfassung und Verwaltung von Leistungsnachweisen
- Erstellung und Verwaltung von Rechnungen
- Abrechnung gegenüber Pflegekassen

(3) Die Verarbeitung beginnt mit Unterzeichnung dieses Vertrags und läuft auf unbestimmte Zeit. Sie endet mit Kündigung des Nutzungsvertrags für entlast.de oder mit Kündigung dieses AVV, wobei § 10 (Löschung) zu beachten ist.

## § 2 Art der personenbezogenen Daten

Folgende Datenkategorien werden verarbeitet:

| Kategorie | Datenarten |
|-----------|------------|
| Stammdaten | Name, Vorname, Geburtsdatum, Anschrift, Telefonnummer |
| Versicherungsdaten | Versichertennummer, Pflegekasse, Pflegegrad |
| Gesundheitsdaten (Art. 9 DSGVO) | Pflegegrad, Art der Einschränkung (soweit erfasst) |
| Finanzdaten | IBAN, Rechnungsbeträge, Entlastungsbetrag-Kontingent |
| Leistungsdaten | Datum, Dauer und Art der erbrachten Leistungen |
| Abrechnungsdaten | Rechnungen, Abrechnungen mit Pflegekassen |
| Kontaktdaten Angehöriger | Name, Telefonnummer, E-Mail (soweit erfasst) |

## § 3 Kategorien betroffener Personen

- Pflegebedürftige (Kunden des Auftraggebers)
- Angehörige bzw. Bevollmächtigte der Pflegebedürftigen
- Mitarbeiter des Auftraggebers (soweit deren Daten in der Anwendung verarbeitet werden)

## § 4 Weisungsgebundenheit

(1) Der Auftragnehmer verarbeitet personenbezogene Daten ausschließlich auf dokumentierte Weisung des Auftraggebers — auch in Bezug auf die Übermittlung in ein Drittland — es sei denn, der Auftragnehmer ist nach dem Recht der Union oder der Mitgliedstaaten, dem er unterliegt, zur Verarbeitung verpflichtet. In einem solchen Fall teilt der Auftragnehmer dem Auftraggeber diese rechtlichen Anforderungen vor der Verarbeitung mit.

(2) Die im Rahmen dieses Vertrags erteilten Weisungen werden in der Anlage 1 (Weisungsprotokoll) dokumentiert. Einzelweisungen, die über die Hauptleistung hinausgehen, bedürfen der Schriftform.

(3) Ist der Auftragnehmer der Ansicht, dass eine Weisung des Auftraggebers gegen datenschutzrechtliche Vorschriften verstößt, hat er den Auftraggeber unverzüglich darauf hinzuweisen. Der Auftragnehmer ist berechtigt, die Durchführung der betreffenden Weisung so lange auszusetzen, bis diese durch den Auftraggeber bestätigt oder geändert wird.

## § 5 Technische und organisatorische Maßnahmen (TOMs)

Der Auftragnehmer gewährleistet folgende technische und organisatorische Maßnahmen gemäß Art. 32 DSGVO:

### 5.1 Vertraulichkeit

- **Transportverschlüsselung:** TLS 1.3 für sämtliche Datenübertragungen zwischen Client und Server
- **Feld-Verschlüsselung:** Gesundheitsbezogene Daten (Pflegegrad, Versichertennummer) werden mit AES-128 auf Feldebene in der Datenbank verschlüsselt
- **Zugriffskontrolle:** Mandantentrennung — jede Firma sieht ausschließlich eigene Daten
- **Authentifizierung:** Passwortgeschützter Zugang mit Session-Management
- **Session-Timeout:** Automatische Abmeldung nach 8 Stunden Inaktivität
- **Rate-Limiting:** Schutz gegen Brute-Force-Angriffe auf Login-Endpunkte

### 5.2 Integrität

- **Audit-Log:** Sämtliche Datenänderungen (Erstellen, Ändern, Löschen) werden mit Zeitstempel, Nutzer und Art der Änderung protokolliert
- **Eingabevalidierung:** Serverseitige Validierung aller Eingaben
- **CSRF-Schutz:** Token-basierter Schutz gegen Cross-Site-Request-Forgery

### 5.3 Verfügbarkeit und Belastbarkeit

- **Hosting:** Hetzner Online GmbH, Rechenzentren in Nürnberg/Falkenstein (Deutschland), ISO 27001 zertifiziert
- **Backups:** Tägliche verschlüsselte Backups, Aufbewahrung 30 Tage
- **Monitoring:** Überwachung der Server-Verfügbarkeit

### 5.4 Wiederherstellbarkeit

- **Backup-Restore:** Getestetes Verfahren zur Wiederherstellung aus Backups
- **Recovery Time Objective (RTO):** Maximal 24 Stunden

### 5.5 Regelmäßige Überprüfung

Die Wirksamkeit der technischen und organisatorischen Maßnahmen wird regelmäßig überprüft und bei Bedarf angepasst. Der Auftragnehmer informiert den Auftraggeber über wesentliche Änderungen.

## § 6 Unterauftragsverarbeiter

(1) Der Auftraggeber erteilt dem Auftragnehmer hiermit die allgemeine schriftliche Genehmigung, weitere Auftragsverarbeiter (Unterauftragnehmer) hinzuzuziehen, sofern die Bedingungen der Absätze 2 bis 4 erfüllt sind.

(2) Zum Zeitpunkt des Vertragsschlusses sind folgende Unterauftragsverarbeiter eingesetzt:

| Unterauftragnehmer | Zweck | Standort |
|---------------------|-------|----------|
| Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen | Server-Hosting (VPS) | Nürnberg/Falkenstein, Deutschland |
| [BUCHHALTUNGSSOFTWARE, z. B. Lexoffice / sevDesk] | Rechnungsstellung und Buchhaltung | Deutschland |

(3) Der Auftragnehmer informiert den Auftraggeber vorab über jede beabsichtigte Änderung in Bezug auf die Hinzuziehung oder Ersetzung von Unterauftragsverarbeitern. Der Auftraggeber kann gegen solche Änderungen innerhalb von **14 Tagen** nach Mitteilung Einspruch erheben.

(4) Der Auftragnehmer stellt vertraglich sicher, dass die Unterauftragsverarbeiter dieselben Datenschutzpflichten einhalten, die in diesem Vertrag festgelegt sind.

## § 7 Pflichten des Auftragnehmers

Der Auftragnehmer verpflichtet sich insbesondere:

a) Personenbezogene Daten ausschließlich gemäß den dokumentierten Weisungen des Auftraggebers zu verarbeiten.

b) Sicherzustellen, dass sich die zur Verarbeitung befugten Personen zur Vertraulichkeit verpflichtet haben oder einer angemessenen gesetzlichen Verschwiegenheitspflicht unterliegen.

c) Alle gemäß Art. 32 DSGVO erforderlichen Maßnahmen zu ergreifen (siehe § 5).

d) Den Auftraggeber bei der Erfüllung seiner Pflichten nach Art. 32 bis 36 DSGVO zu unterstützen (Sicherheit der Verarbeitung, Meldung von Datenschutzverletzungen, Datenschutz-Folgenabschätzung).

e) Den Auftraggeber bei der Beantwortung von Anträgen betroffener Personen nach Art. 15 bis 22 DSGVO zu unterstützen, insbesondere durch:
   - Export von Kundendaten auf Anfrage (Recht auf Auskunft/Datenübertragbarkeit)
   - Berichtigung von Daten
   - Löschung von Daten (soweit keine Aufbewahrungspflichten entgegenstehen)

f) Dem Auftraggeber alle Informationen zum Nachweis der Einhaltung der in Art. 28 DSGVO niedergelegten Pflichten zur Verfügung zu stellen und Überprüfungen — einschließlich Inspektionen — zu ermöglichen und dazu beizutragen.

## § 8 Meldepflicht bei Datenschutzverletzungen

(1) Der Auftragnehmer unterrichtet den Auftraggeber **unverzüglich, spätestens jedoch innerhalb von 24 Stunden** nach Bekanntwerden einer Verletzung des Schutzes personenbezogener Daten.

(2) Die Meldung enthält mindestens:
- Art der Verletzung
- Betroffene Datenkategorien und ungefähre Anzahl der betroffenen Personen
- Wahrscheinliche Folgen der Verletzung
- Ergriffene oder vorgeschlagene Maßnahmen zur Behebung und Abmilderung

(3) Der Auftraggeber ist verpflichtet, die Meldung an die zuständige Aufsichtsbehörde gemäß Art. 33 DSGVO innerhalb von **72 Stunden** nach Bekanntwerden vorzunehmen. Der Auftragnehmer unterstützt den Auftraggeber dabei.

## § 9 Kontrollrechte des Auftraggebers

(1) Der Auftraggeber hat das Recht, die Einhaltung der datenschutzrechtlichen Vorschriften und dieses Vertrags durch den Auftragnehmer zu überprüfen. Dies kann durch:
- Einholung von Auskünften
- Einsichtnahme in Nachweise und Dokumentationen
- Vor-Ort-Inspektionen (nach angemessener Vorankündigung)

(2) Der Auftragnehmer stellt dem Auftraggeber auf Anfrage folgende Nachweise zur Verfügung:
- Aktuelle TOMs
- Verzeichnis der Unterauftragsverarbeiter
- Audit-Logs (mandantenbezogen)
- Nachweis der Mitarbeiterverpflichtung auf Vertraulichkeit

## § 10 Löschung und Rückgabe von Daten

(1) Nach Beendigung der Auftragsverarbeitung löscht der Auftragnehmer sämtliche personenbezogenen Daten des Auftraggebers, es sei denn, eine gesetzliche Aufbewahrungspflicht steht dem entgegen.

(2) Vor der Löschung hat der Auftraggeber das Recht, einen vollständigen **Datenexport** in einem maschinenlesbaren Format (CSV oder JSON) zu verlangen.

(3) Die Löschung erfolgt innerhalb von **30 Tagen** nach Vertragsende und wird schriftlich bestätigt. Backups werden entsprechend der Backup-Rotation (30 Tage) gelöscht.

(4) Daten, die gesetzlichen Aufbewahrungspflichten unterliegen (insbesondere Rechnungen: 10 Jahre), werden gesperrt und nach Ablauf der Frist gelöscht. Das Löschkonzept (Anlage) regelt die Details.

## § 11 Schlussbestimmungen

(1) Änderungen und Ergänzungen dieses Vertrags bedürfen der Schriftform.

(2) Sollten einzelne Bestimmungen unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.

(3) Es gilt das Recht der Bundesrepublik Deutschland.

(4) Gerichtsstand ist [GERICHTSSTAND].

---

## Unterschriften

**Auftraggeber (Verantwortlicher):**

Ort, Datum: ____________________________

Unterschrift: ____________________________

Name: [GESCHÄFTSFÜHRER/INHABER]

Funktion: [FUNKTION]

&nbsp;

**Auftragnehmer (Auftragsverarbeiter):**

Ort, Datum: ____________________________

Unterschrift: ____________________________

Name: Christoph Glunz

Funktion: Betreiber entlast.de

---

## Anlage 1: Weisungsprotokoll

| Datum | Weisung | Erteilt durch | Bestätigt durch |
|-------|---------|---------------|-----------------|
| [DATUM] | Ersteinrichtung gemäß AVV | [NAME] | Christoph Glunz |
| | | | |

## Anlage 2: Aktuelle TOMs

Siehe § 5 dieses Vertrags. Stand: [DATUM]

## Anlage 3: Löschkonzept

Siehe separates Dokument `Loeschkonzept.md`.
