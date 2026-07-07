<?php
/**
 * Authentifizierungs-Modul
 * --------------------------------------------------------------
 * Komplett vom restlichen Code getrennt. Lässt sich über die
 * Konstante AUTH_ENABLED in config.php deaktivieren, ohne dass
 * andere Module geändert werden müssen.
 *
 *   require_once __DIR__ . '/auth.php';
 *   Auth::requireLogin();        // Schutz für Seiten/APIs
 *   Auth::attemptLogin($pw);     // Login-Versuch (Login-Formular)
 *   Auth::logout();              // Abmelden
 *
 * @author  OTH Amberg-Weiden | InfoVis Projekt 2026
 */

require_once __DIR__ . '/config.php';

if (session_status() === PHP_SESSION_NONE) {
    // Strenge Cookie-Settings
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_name('BREWMON_SID');
    session_start();
}

class Auth
{
    /**
     * Gibt den bcrypt-Hash zurück. Wird beim ersten Aufruf
     * aus DEFAULT_PASSWORD generiert und persistiert.
     */
    private static function passwordHash(): string
    {
        $file = PASSWORD_HASH_FILE;
        if (!is_file($file)) {
            $hash = password_hash(DEFAULT_PASSWORD, PASSWORD_DEFAULT);
            if (@file_put_contents($file, $hash) === false) {
                // Fallback: Hash nur im Speicher halten (kein Persist)
                return $hash;
            }
            @chmod($file, 0600);
            return $hash;
        }
        return trim((string)file_get_contents($file));
    }

    /**
     * Prüft, ob der aktuelle Nutzer eingeloggt ist
     * (bzw. Auth global deaktiviert ist).
     */
    public static function isLoggedIn(): bool
    {
        if (!AUTH_ENABLED) {
            return true;
        }

        if (empty($_SESSION['auth']) || empty($_SESSION['auth']['logged_in'])) {
            return false;
        }
        // Idle-Timeout
        $lastSeen = (int)($_SESSION['auth']['last_seen'] ?? 0);
        if ($lastSeen > 0 && (time() - $lastSeen) > SESSION_IDLE_TIMEOUT) {
            self::logout();
            return false;
        }
        $_SESSION['auth']['last_seen'] = time();
        return true;
    }

    /**
     * Forciert eine Anmeldung. Bei HTML-Aufrufen Redirect zur
     * Login-Seite, bei API-Aufrufen JSON 401.
     */
    public static function requireLogin(string $mode = 'html'): void
    {
        if (self::isLoggedIn()) {
            return;
        }
        if ($mode === 'json') {
            http_response_code(401);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Unauthorized', 'login_required' => true]);
            exit;
        }
        header('Location: login.php');
        exit;
    }

    /**
     * Login-Versuch mit Brute-Force-Bremse.
     * @return array{success:bool, error?:string}
     */
    public static function attemptLogin(string $password): array
    {
        if (!AUTH_ENABLED) {
            return ['success' => true];
        }

        // Brute-Force-Bremse: max. AUTH_MAX_ATTEMPTS Versuche pro 5 min
        $now = time();
        $attempts = $_SESSION['auth_attempts'] ?? [];
        $attempts = array_values(array_filter($attempts, fn($t) => ($now - $t) < 300));

        if (count($attempts) >= AUTH_MAX_ATTEMPTS) {
            $wait = 300 - ($now - $attempts[0]);
            return ['success' => false, 'error' => "Zu viele Versuche. Bitte {$wait} Sekunden warten."];
        }

        $hash = self::passwordHash();
        if (password_verify($password, $hash)) {
            // Session-Fixation verhindern
            session_regenerate_id(true);
            $_SESSION['auth'] = [
                'logged_in' => true,
                'login_at'  => $now,
                'last_seen' => $now,
                'ip'        => $_SERVER['REMOTE_ADDR'] ?? '',
            ];
            unset($_SESSION['auth_attempts']);
            return ['success' => true];
        }

        $attempts[] = $now;
        $_SESSION['auth_attempts'] = $attempts;
        return ['success' => false, 'error' => 'Falsches Passwort.'];
    }

    /**
     * Beendet die Session sauber.
     */
    public static function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
    }

    /**
     * CSRF-Token generieren / abfragen
     */
    public static function csrfToken(): string
    {
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(16));
        }
        return $_SESSION['csrf'];
    }

    public static function csrfValid(?string $token): bool
    {
        return !empty($token)
            && !empty($_SESSION['csrf'])
            && hash_equals($_SESSION['csrf'], $token);
    }
}
