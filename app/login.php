<?php
require_once __DIR__ . '/auth.php';

// Falls Auth deaktiviert oder bereits eingeloggt → direkt weiter
if (Auth::isLoggedIn()) {
    header('Location: index.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $token = $_POST['csrf'] ?? '';
    if (!Auth::csrfValid($token)) {
        $error = 'Sitzung abgelaufen. Bitte erneut versuchen.';
    } else {
        $result = Auth::attemptLogin($_POST['password'] ?? '');
        if ($result['success']) {
            header('Location: index.php');
            exit;
        }
        $error = $result['error'] ?? 'Anmeldung fehlgeschlagen.';
    }
}
$csrf = Auth::csrfToken();
?>
<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Anmeldung · Brauerei Monitoring</title>
    <link rel="stylesheet" href="assets/css/login.css">
</head>
<body>
    <main class="login-wrap">
        <div class="login-card" role="dialog" aria-labelledby="login-title">
            <div class="brand">
                <div class="brand-mark" aria-hidden="true">
                    <svg viewBox="0 0 32 32" width="36" height="36" fill="none">
                        <path d="M8 6 L8 22 Q8 26 12 26 L20 26 Q24 26 24 22 L24 6 Z"
                              stroke="currentColor" stroke-width="2" fill="none"/>
                        <path d="M24 10 L28 10 L28 18 L24 18" stroke="currentColor" stroke-width="2" fill="none"/>
                        <circle cx="16" cy="14" r="1.4" fill="currentColor"/>
                        <circle cx="13" cy="18" r="1.1" fill="currentColor"/>
                        <circle cx="19" cy="19" r="1.1" fill="currentColor"/>
                    </svg>
                </div>
                <div>
                    <div class="brand-eyebrow">OTH Amberg-Weiden · InfoVis 2026</div>
                    <h1 id="login-title" class="brand-title">Brauerei Monitoring</h1>
                </div>
            </div>

            <p class="lead">Anmeldung erforderlich. Bitte Zugangs-Passwort eingeben.</p>

            <form method="POST" autocomplete="off" novalidate>
                <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">

                <label class="field">
                    <span class="field-label">Passwort</span>
                    <input type="password"
                           name="password"
                           required
                           autofocus
                           autocomplete="current-password"
                           placeholder="••••••">
                </label>

                <?php if ($error): ?>
                    <div class="error" role="alert">⚠ <?= htmlspecialchars($error) ?></div>
                <?php endif; ?>

                <button type="submit" class="btn-primary">
                    <span>Anmelden</span>
                    <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                        <path d="M2 8 H14 M9 3 L14 8 L9 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            </form>

            <footer class="login-foot">
                Studienarbeit · Prof. Dr. Dieter Meiller
            </footer>
        </div>
    </main>
</body>
</html>
