<?php
/**
 * Zentrale Konfiguration
 * --------------------------------------------------------------
 * Diese Datei wird ausschliesslich serverseitig ausgewertet und
 * niemals an den Browser ausgeliefert. Anmeldedaten und Toggles
 * sind hier sicher aufgehoben.
 *
 * @author  OTH Amberg-Weiden | InfoVis Projekt 2026
 */

// ------------------------------------------------------------------
// Anmeldung an/ausschalten
// ------------------------------------------------------------------
// true  = Login erforderlich (Default-Passwort siehe unten)
// false = Direkter Zugriff ohne Anmeldung (z.B. für lokale Tests)
define('AUTH_ENABLED', true);

// Standard-Passwort. Beim ersten Login wird hieraus automatisch
// ein bcrypt-Hash erzeugt und in '.pwhash' abgelegt. Diese Konstante
// dient nur als Initial-Wert und kann danach gefahrlos entfernt werden.
define('DEFAULT_PASSWORD', 'IV2026');

// Pfad für den persistierten bcrypt-Hash (ausserhalb der Auslieferung
// erreichbar, da kein Direkt-URL-Mapping). Falls Sie auf Shared
// Hosting arbeiten, evtl. in einen geschützten Ordner verschieben.
define('PASSWORD_HASH_FILE', __DIR__ . '/.pwhash');

// Maximale erlaubte Fehlversuche pro 5 Minuten (einfache Brute-Force-Bremse)
define('AUTH_MAX_ATTEMPTS', 8);

// Wie lange darf eine Session ohne Aktivität bleiben? (Sekunden)
define('SESSION_IDLE_TIMEOUT', 60 * 60 * 4); // 4 h

// ------------------------------------------------------------------
// Datenbank-Zugang (übernommen aus dem Bestand)
// ------------------------------------------------------------------
define('DB_HOST', '10.35.46.44');
define('DB_NAME', 'k86629_bier');
define('DB_USER', 'k86629_bier');
define('DB_PASS', '%U=;8h].y_0:6[EW');

// ------------------------------------------------------------------
// Anwendungs-Settings
// ------------------------------------------------------------------
define('APP_TITLE',  'Brauerei Monitoring · 3D/AR · OTH-AW');
define('APP_AUTHOR', 'InfoVis Projekt 2026');

// Wie viele Datenpunkte pro Variable im Detail-Chart? (zu hohe Werte
// belasten die Datenbank-Antwort spürbar)
define('CHART_HISTORY_LIMIT', 600);

// Polling-Intervall im Frontend (Sekunden) – wird ans JS durchgereicht
define('POLLING_INTERVAL_SEC', 5);
