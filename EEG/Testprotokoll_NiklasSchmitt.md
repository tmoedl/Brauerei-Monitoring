# Testprotokoll — Nutzertest mit EEG

*Ausgefüllt nach dem Kurs-Template „Testprotokoll (Template) — Nutzertest mit EEG".*

## Studienübersicht

- **Studienleiter:** Tobias Mödl
- **Projekt/Titel:** Brauerei Monitoring 3D/AR — Nutzertest mit EEG-Aufzeichnung
- **Datum:** 2026-06-10
- **Ort/Raum:** OTH Amberg-Weiden (Labor/Raum)
- **Kontakt:** mail@tobiasmoedl.de

## Ziele der Studie

- **Primäres Ziel:** Usability der 3D/AR-Brauerei-Visualisierung — können Status, Abweichungen und historische Verläufe schnell und korrekt erfasst werden?
- **Sekundäre Ziele:** EEG-Metriken zur Einschätzung der kognitiven Beanspruchung während der Nutzung (Engagement-Index β/[α+θ], Bandleistungs-Verteilung, Aufmerksamkeits-Verlauf über die Session).

## Teilnehmer

- **Rekrutierung:** Persönliches Umfeld (Kommilitone)
- **Einschlusskriterien:** Volljährig, keine bekannten neurologischen Vorerkrankungen
- **Ausschlusskriterien:** Neurologische Erkrankungen, Epilepsie in der Vorgeschichte
- **Empfohlene Stichprobe (laut Aufgabenstellung):** 5–12 Personen
- **Tatsächliche Stichprobe:** N=1 (Niklas Schmitt)

> **Einschränkung:** Aus Zeit- und Ressourcengründen wurde die Studie als explorativer Einzelfalltest mit einer Person durchgeführt, nicht mit der empfohlenen Stichprobengröße. Die EEG-Auswertung ist entsprechend als Tendenz-Analyse zu verstehen, nicht als statistisch abgesicherte Aussage (siehe auch Hinweis im Auswertungs-Notebook).

## Materialien & Geräte

- **Gerät/Plattform:** Laptop, Chrome (aktuelle Version), Brauerei-Monitoring-Webanwendung (Live-Instanz)
- **EEG-System:** PLUX biosignalsplux, 2 Kanäle (Fp1 frontal, O1 okzipital nach 10-20-System), 16 bit Auflösung, 1000 Hz Samplingrate
- **Zusätzliche Messungen:** Bildschirmaufnahme des Anwendungsbildschirms + Handy-Kamera auf die reale Anlage (für den AR-Task), zur nachträglichen Synchronisation mit dem EEG-Signal
- **Software/Versionen:** OpenSignals (Revolution, Version 12-2020), Brauerei-Monitoring-Webanwendung (dieses Repository)

## Versuchsaufbau (tatsächlicher Ablauf)

1. Begrüßung, mündliche Aufklärung über Ablauf und Zweck der Aufzeichnung (5 min)
2. Elektroden anbringen (Gelelektroden, frontal + okzipital, bipolare Ableitung gegen Ohrreferenz), kurzer Signalcheck (10–15 min)
3. Kurze Ruhephase vor Testbeginn (als Baseline für die spätere Auswertung genutzt)
4. Kurze Einweisung in die Anwendung (2–3 min)
5. Aufgabenblock T1–T7 (siehe unten), während der gesamten Zeit durchgehend aufgezeichnet
6. Elektroden entfernen, Verabschiedung

> **Abweichung vom Template:** Es wurde keine strukturierte Nachbefragung (SUS-Fragebogen, Interview) durchgeführt — die Auswertung stützt sich ausschließlich auf die EEG-Aufzeichnung und die Beobachtung während der Aufgabenbearbeitung. Das ist eine Lücke gegenüber dem empfohlenen Vorgehen und wird als Verbesserungspunkt für eine Folgestudie festgehalten.

## Aufgaben (Tasks)

Die Aufgaben wurden aus typischen Nutzerrollen der Anwendung abgeleitet (Anlagenführer, IT-Mitarbeiter, Wartungspersonal vor Ort).

### T1 — Übersicht / Anlagenstatus
- **Instruktion:** „Sie sind Mitglied der Brauerei AG der OTH Amberg-Weiden. Schalten Sie sich auf das Brauerei-Monitoring und verschaffen Sie sich mit einem schnellen Blick einen Überblick: Wie viele Kühltanks sind aktiv, und liegt die Temperatur überall im normalen Bereich, oder wurde irgendwo die Warnschwelle von 2°C überschritten?"
- **Erfolgskriterium:** Korrekte Anzahl aktiver Tanks genannt; alle Tanks mit Δ > 2°C anhand der Farbcodierung richtig identifiziert.
- **Erwartete Interaktion:** Betrachten der 3D-Übersicht, Lesen der Balken-/Farbcodierung, ggf. Klick auf auffällige Tanks.
- **Geschätzte Dauer:** 60–120 s

### T2 — Datenaktualität / Verbindungsstatus
- **Instruktion:** „Prüfen Sie, ob die angezeigten Daten aktuell sind oder ob es gerade ein Problem mit der Verbindung zur Brauerei gibt."
- **Erfolgskriterium:** Korrekte Ablesung des „vor X Sek"-Zählers bzw. des Verbindungs-Status-Indikators in der Fußleiste.
- **Erwartete Interaktion:** Blick auf Fußleiste/Statusanzeige, ggf. Status-Pill.
- **Geschätzte Dauer:** 20–40 s

### T3 — Verlaufsanalyse Kühltank 3 (letzte Woche)
- **Instruktion:** „Da letzte Woche ein Bier gebraut wurde, informieren Sie sich über den Temperaturverlauf der letzten Woche in Kühltank 3."
- **Erfolgskriterium:** Tank 3 korrekt ausgewählt, Zeitraum „Woche" korrekt eingestellt, plausible Aussage zum Verlauf getroffen.
- **Erwartete Interaktion:** Klick auf Tank 3 → Detailansicht öffnen → Zeitraum „Woche" wählen.
- **Geschätzte Dauer:** 90–150 s

### T4 — Vergleichsaufgabe: Soll-Ist-Abweichung aller Tanks
- **Instruktion:** „Vergleichen Sie die Abweichung zwischen Soll- und Ist-Temperatur über alle sechs Kühltanks hinweg. Wechseln Sie dafür in die Overlay-Ansicht."
- **Erfolgskriterium:** Korrekter Wechsel in den Overlay-Modus; Tank mit größter Abweichung korrekt identifiziert.
- **Erwartete Interaktion:** Umschalten des Datenfenster-Stils auf „Overlay" im Settings-Panel, Betrachtung der Vergleichsansicht.
- **Geschätzte Dauer:** 90–180 s

### T5 — Filter & Drill-Down: Brautag 22.05., Hauptbrauphase
- **Instruktion:** „Ermitteln Sie, mit wie viel Grad in der Hauptbrauphase (der Phase mit der längsten Dauer) am 22.05. maximal gebraut wurde."
- **Erfolgskriterium:** Korrekter Brautag (22.05.) ausgewählt, längste Heizphase korrekt identifiziert, korrekter Maximalwert abgelesen.
- **Erwartete Interaktion:** Braukessel → Tab „Brautage" → Brautag 22.05. auswählen → Heizphasen-Liste nach Dauer durchsehen → Max-Temperatur ablesen.
- **Geschätzte Dauer:** 90–180 s

### T6 — Hypothesenprüfung: Regelungsgüte Kühltank 2, 18.05.
- **Instruktion:** „Sie sind IT-Mitarbeiter und möchten prüfen, ob die Regelung von Kühltank 2 am 18.05. korrekt funktioniert hat — die maximale Abweichung zwischen Ist und Soll sollte 1°C nicht überschritten haben."
- **Erfolgskriterium:** Plausible, begründete Einschätzung (ja/nein) unter Bezug auf den abgelesenen Verlauf bzw. die Delta-Anzeige.
- **Erwartete Interaktion:** Tank 2 auswählen → Zeitraum auf 18.05. einstellen (benutzerdefinierter Zeitraum) → Ist-/Soll-Verlauf und Delta-Anzeige prüfen.
- **Geschätzte Dauer:** 120–300 s

### T7 — AR-Modus: Kühltank vor Ort ablesen
- **Instruktion:** „Sie sind Mitarbeiter und optimieren gerade vor Ort den Kühlkreislauf. Lesen Sie über den AR-Modus direkt die aktuelle Temperatur eines Kühltanks ab, ohne vorher nachsehen zu müssen, welche Nummer auf dem Tank aufgedruckt ist."
- **Erfolgskriterium:** AR-Modus erfolgreich gestartet, QR-Code erkannt, Temperatur korrekt und ohne Rückgriff auf die Tanknummer abgelesen.
- **Erwartete Interaktion:** AR-Button antippen, Kamera auf QR-Code halten, schwebendes Live-Datenfenster lesen.
- **Geschätzte Dauer:** 60–120 s

Für jeden Task wurden als Metrik Task-Completion (ja/nein), grobe Zeitdauer (per Video) sowie qualitative Beobachtungen erfasst. Ein strukturiertes Event-Log (CSV mit `task_start`/`task_end`) wurde **nicht** parallel zur EEG-Aufzeichnung geführt — die zeitliche Zuordnung der Tasks zum EEG-Signal erfolgt nachträglich über den Abgleich von Video-Zeitstempeln mit dem EEG-Start (siehe `VideoSync`-Klasse in [`eeg_analysis_brewvis.ipynb`](eeg_analysis_brewvis.ipynb)). Das ist eine pragmatische Lösung anstelle eines Live-Marker-Streams (z. B. LSL) und eine Einschränkung gegenüber dem empfohlenen Vorgehen.

## Consent-Kurzcheck (vor Testbeginn)

- **Consent eingeholt:** Mündlich (kein unterschriebenes Formular) ⚠
- **Teilnehmer hat Fragen verstanden:** Ja
- **Teilnehmer ist fit für Messung:** Ja

> **Wichtiger Hinweis:** Die Aufgabenstellung fordert für personenbezogene Daten ausdrücklich eine **schriftliche** Einverständniserklärung. Hier wurde diese nur mündlich eingeholt — das ist eine dokumentierte Abweichung von der Methodik-Vorgabe und sollte bei einer Wiederholung der Studie nachgeholt werden.

## EEG-Messparameter

- **Samplingrate:** 1000 Hz
- **Auflösung:** 16 bit
- **Referenz:** Ohrreferenz nach 10-20-System (bipolare Ableitung)
- **Filter (Vorverarbeitung im Notebook):** Bandpass 0.5–45 Hz, Notch 50 Hz (Netzbrummen)
- **Impedanz-Grenzwert:** nicht dokumentiert/gemessen (Limitation)
- **Stimulus/Marker-Kanal:** kein separater Marker-Kanal; Synchronisation über Video-Zeitstempel-Abgleich (siehe oben)

## Beobachtungsprotokoll (Zusammenfassung)

Detaillierte Zeitstempel- und Verlaufsbeobachtungen sowie die automatisiert erkannten auffälligen EEG-Momente sind im Auswertungs-Notebook dokumentiert (Abschnitt „Top-Auffälligkeiten mit Video-Screenshots"). Eine tabellarische Rohfassung eines klassischen Beobachtungsprotokolls (Zeit/Beobachter/Notizen) wurde während der Session nicht separat geführt — die Videoaufzeichnung dient hier als Beobachtungsgrundlage.

## Nachbefragung

Nicht durchgeführt (siehe Abweichung oben). Für eine Folgestudie empfohlen: SUS-Fragebogen + kurzes Interview direkt im Anschluss.

## Datenablage & Dateikonvention

- Rohdaten: [`EEG/data/`](data/) (`opensignals_..._2026-06-10_10-18-30.txt` / `.h5`, Video-Aufnahmen)
- Events/Synchronisation: über `VideoSync`-Klasse im Notebook, keine separate Event-CSV
- Analyse: [`EEG/eeg_analysis_brewvis.ipynb`](eeg_analysis_brewvis.ipynb), Ergebnisse in [`EEG/output/`](output/)
- Report: [`EEG/EEG_Report_BrewVis.pdf`](EEG_Report_BrewVis.pdf)

## Post-Processing Checklist

- [x] Rohdaten gesichert
- [x] Events (Video ↔ EEG) synchronisiert geprüft (`VideoSync`-Klasse, Abdeckungsprüfung im Notebook)
- [x] Preprocessing-Schritte (Filter) im Notebook dokumentiert
- [x] Ergebnisse reproduzierbar aus dem Notebook generierbar
- [ ] Strukturierte Nachbefragung (offen, siehe oben)
- [ ] Schriftlicher Consent (offen, siehe oben)

## Troubleshooting (aufgetretene Fälle)

- Keine Live-Marker im EEG vorhanden → Synchronisation nachträglich per Video-Zeitstempel gelöst (siehe `VideoSync`-Klasse).
- Nur eines von zwei aufgenommenen Videos lag zeitlich innerhalb der EEG-Aufzeichnung (Abdeckungsprüfung im Notebook, Abschnitt 2) — das zweite Video wurde für die Auswertung nicht verwendet.
