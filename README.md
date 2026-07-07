# Brauerei Monitoring 3D/AR

> Informationsvisualisierung Projekt 2026 · OTH Amberg-Weiden

Interaktive 3D-Visualisierung einer realen Brauanlage (6 Kühltanks + 1 Braukessel + Pumpen) mit Live-Daten aus einer MySQL-Datenbank. Ergänzt um einen AR-Modus zur Vor-Ort-Diagnose über QR-Codes.

## Live-Demo

**URL:** https://tobiasmoedl.de/iv/
**Passwort:** `IV2026`

> Chrome / Edge / Safari (WebGL 2 + WebXR für AR). Für den AR-Modus wird ein mobiles Gerät mit Kamera empfohlen.

![Übersicht](docs/screenshots/overview.png)

---

## 1) Welche Daten werden visualisiert? (+ Quelle)

**Quelle:** Live-Datenbank einer realen Brauanlage (MySQL, tabellen-pro-Variable: `v_<VARIABLE>`, Spalten `ts` + `val`). Datenpunkte werden alle 5 Sekunden vom Frontend gepollt.

Visualisiert werden pro Anlagenteil:

**Braukessel (BK):**
- `BK_Ist` – aktuelle Temperatur (°C)
- `BK_Soll` – Sollwert
- `BK_Ein` – Anlage aktiv (0/1)
- `BK_Auto` / `BK_Hand` – Betriebsmodus
- `BK_A_H` – Heizungs-/Ventilstatus

**Kühltanks 1–6 (T1..T6):**
- `Tx_IstT` – Ist-Temperatur
- `Tx_SollT` – Soll-Temperatur
- `Tx_Ein` – Kühlregelung aktiv
- `Tx_AM` – Auto-Modus
- `Tx_AV` – Automatikventil (offen/zu)
- `Tx_HV` – Handventil

**Pumpen & Kühlkreis:**
- `P1_Run`, `P1_Val`, `CWP_Run`, `CWP_Val` – Pumpenzustände
- `T_HeatEx` – Kühlwasser-Temperatur am Wärmetauscher

**Historisch:** Aus dem Verlauf werden **Brautage** automatisch erkannt (Sessions mit `BK_Ein > 0.5`, Lücke ≤ 30 min, Dauer ≥ 20 min).

## 2) Warum diese Daten?

Der Anlagenführer muss auf einen Blick beantworten können:

1. **Läuft die Anlage gerade?** → Aktiv-Status + Sekunden-Zähler seit letztem Datenpunkt.
2. **Ist irgendwo etwas kritisch?** → Farb-Codierung nach Ist/Soll-Abweichung.
3. **Wo genau ist das Problem?** → 3D-Modell bildet die reale Räumlichkeit ab; man erkennt sofort *welcher* Tank betroffen ist.
4. **Wie war es gestern?** → Historische Brautage als klickbare Zeitreihe.

Klassische SCADA-Listen zeigen nur Zahlen. Durch die räumliche Repräsentation entsteht ein **direkter Bezug zur physischen Anlage** – das ist der Kern der Informationsvisualisierung hier.

## 3) Wie sind die Daten gemappt?

**3D-Szene** (Three.js r158, WebGL):

| Datum | Visueller Kanal |
|---|---|
| Ist-Temperatur (numerisch) | Digital-Label über dem Tank + 3D-Balkenhöhe |
| Soll-Temperatur | Horizontale Marker-Linie am Balken |
| Δ Ist-Soll (Status) | **Farbe** des Tanks: `ok` = grün, `warn` = gelb, `crit` = rot, `idle` = grau |
| Ventil offen/zu | Animierter Fluss-Effekt am Rohr |
| Betriebsmodus (Auto/Hand) | Badge oben am Tank |
| Position im Raum | X-Koordinate im Modell entspricht der realen Aufstellung |
| Auswahl-Variable | Nutzer wählt im Panel *welche* Kennzahl als 3D-Balken angezeigt wird (Ist, Soll, Δ, Ventil, Kühlung, Auto) |

**Schwellen** (konfigurierbar, lokal in `localStorage`):
- Tank: Δ-Warn 2.0 °C, Δ-Krit 5.0 °C, Abs. −2 bis 24 °C
- Braukessel: Δ-Warn 3.0 °C, Δ-Krit 8.0 °C, Abs. 10 bis 105 °C

**Wand-Projektion** (Detail-Ansicht):
Beim Klick auf einen Tank fährt die Kamera an eine virtuelle „Wand" hinter der Anlage, auf der die Zeitreihe als Liniendiagramm projiziert wird. Alternativ als HTML-Overlay (Modus umschaltbar).

**Historische Brautage:**
Zeitreihen für `BK_Ist`, `BK_Soll`, `BK_A_H` und die Pumpe des gewählten Tages, aggregiert per SQL-Bucketing (max. 800 Punkte).

## 4) Interaktion (Suche / Filter)

**Navigation:**
- **Maus ziehen** – Kamera drehen
- **Mausrad** – Zoomen
- **WASD** – Kamera bewegen · **Q/E** – Höhe · **Shift+R** – Reset
- **Klick auf Tank/Kessel** – Detail-Ansicht
- **Doppelklick** – Übersicht zurück

**Filter & Auswahl (linkes Settings-Panel):**
- Variablen-Auswahl für das 3D-Balkendiagramm (6 Optionen)
- Datenfenster-Stil: `Wand 3D` vs. `Overlay`
- Warn-Schwellen individuell für Tanks / Braukessel einstellbar (Modal)
- Brautag-Auswahl: Liste erkannter Brausessions mit Datum, Dauer, Peak-Temp, Ø-Temp

**Live-Feedback:**
- Verbindungs-Dot in der Fußleiste (`ok` / `warn` / `crit`)
- „Vor X Sek" Zähler zeigt Datenaktualität; ab 120 s → „Brauerei offline"
- Anlagen-Status-Pill (`Aktiv` / `Inaktiv`) immer sichtbar

## 5) XR (Augmented Reality)

**AR-Modus** über WebXR (`ARButton`), Klick auf den 📷-Button rechts unten.

- Der Nutzer steht vor der realen Anlage
- Kamera wird geöffnet, QR-Codes an den Tanks/dem Kessel werden erkannt
- Über jedem erkannten Tank erscheint ein schwebendes Live-Datenfenster mit Temperatur, Status, Modus
- Mehrere Codes können **gleichzeitig** erkannt werden

**QR-Code-Inhalte:**

```
BRAUEREI:TANK:1
BRAUEREI:TANK:2
...
BRAUEREI:TANK:6
BRAUEREI:KESSEL:1
```

Damit lässt sich vor Ort ohne Panel-Bedienung sofort ablesen, was der jeweilige Tank tut – ideal für Rundgänge und Wartung.

![AR-Modus](docs/screenshots/ar-mode.png)

---

## Projektstruktur

```
├── index.php               Haupt-Einstiegspunkt (nach Login)
├── login.php / auth.php    Session-basierte Anmeldung (bcrypt)
├── config.example.php      Konfigurations-Vorlage
├── api/get_data.php        JSON-API: list | current | series | brew_days
└── assets/
    ├── css/                Styles (Panel, Modal, Wall-Display)
    └── js/
        ├── main.js         App-Orchestrator, Polling-Loop
        ├── Scene.js        Three.js-Szene + Kamera
        ├── BreweryModel.js 3D-Modell der Anlage
        ├── BarChart3D.js   Konfigurierbares Balkendiagramm
        ├── Labels3D.js     Digitale Temperatur-Labels
        ├── WallDisplay.js  HTML-Overlay-Detailfenster
        ├── WallPanel3D.js  3D-Wand-Detailfenster
        ├── SettingsPanel.js Linkes Bedien-Panel
        ├── ARMode.js       WebXR + QR-Erkennung
        ├── dataService.js  Fetch-/Polling-Layer
        └── config.js       Frontend-Konstanten
```

## Lokale Installation

```bash
git clone https://github.com/tmoedl/iv.git
cd iv
cp config.example.php config.php
# DB-Zugang und Passwort in config.php eintragen
# Web-Server auf dieses Verzeichnis zeigen lassen (PHP 8+, MySQL 5.7+)
```

Beim ersten Login wird aus `DEFAULT_PASSWORD` automatisch ein bcrypt-Hash in `.pwhash` erzeugt.

## Tech-Stack

- Backend: PHP 8, PDO/MySQL
- Frontend: Three.js r158 (WebGL 2), Vanilla JS (ES-Modules)
- XR: WebXR Device API (`ARButton`)
- Auth: Session + bcrypt, einfache Brute-Force-Bremse (8 Versuche / 5 min)

## Autor

Tobias Mödl · OTH Amberg-Weiden · Informationsvisualisierung 2026
