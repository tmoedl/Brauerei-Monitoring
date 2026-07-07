<?php
/**
 * Haupt-Einstiegspunkt - 3D/AR-Brauerei-Monitoring
 * Redesign 2026: linkes Settings-Panel, Wand-Projektion, Brautage.
 */
require_once __DIR__ . '/auth.php';
Auth::requireLogin('html');

$frontendConfig = [
    'pollingIntervalSec' => POLLING_INTERVAL_SEC,
    'chartHistoryLimit'  => CHART_HISTORY_LIMIT,
    'apiEndpoint'        => 'api/get_data.php',
    'authEnabled'        => AUTH_ENABLED,
    'appTitle'           => APP_TITLE,
];
?>
<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= htmlspecialchars(APP_TITLE) ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
    <script>
      window.APP_CONFIG = <?= json_encode($frontendConfig, JSON_UNESCAPED_UNICODE) ?>;
    </script>
    <!-- Diagnostik + CDN-Test -->
    <script>
    console.log('=== INDEX.PHP V9 GELADEN (mit Importmap) ===');

    function showError(title, detail) {
        console.error('BOOT-FEHLER:', title, detail);
        var el = document.getElementById('boot-overlay');
        if (!el) return;
        el.classList.remove('is-hidden');
        el.innerHTML = '<div style="color:#e8e8e8;max-width:640px;padding:24px;font-family:monospace;text-align:left">'
            + '<h2 style="font-size:15px;margin-bottom:10px;color:#f0b73f">&#9888; Ladefehler</h2>'
            + '<p style="font-size:12px;color:#e2533b;margin-bottom:10px;word-break:break-all">' + title + '</p>'
            + '<pre style="font-size:10px;color:#aaa;white-space:pre-wrap;max-height:200px;overflow:auto">' + detail + '</pre>'
            + '<hr style="border:1px solid #333;margin:12px 0">'
            + '<p style="font-size:11px;color:#888">Konsole (F12) zeigt genauere Infos.</p>'
            + '</div>';
    }

    window.onerror = function(msg, src, line, col, err) {
        showError('JS-Fehler: ' + msg, 'Datei: ' + src + '  Zeile: ' + line + (err ? '\n' + err.stack : ''));
        return false;
    };

    window.addEventListener('error', function(e) {
        if (e.target && (e.target.src || e.target.href)) {
            showError('Datei konnte nicht geladen werden:', e.target.src || e.target.href);
        }
    }, true);

    window.addEventListener('unhandledrejection', function(e) {
        showError('Promise-Fehler (CDN?)', String(e.reason && e.reason.stack ? e.reason.stack : e.reason));
    });

    // CDN-Erreichbarkeit testen
    var CDN_TEST = 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
    fetch(CDN_TEST, { method: 'HEAD', cache: 'no-store' })
        .then(function(r) {
            if (r.status !== 200) showError('CDN antwortet mit Status ' + r.status, CDN_TEST);
        })
        .catch(function(e) {
            showError(
                'CDN nicht erreichbar! Three.js kann nicht geladen werden.',
                'URL: ' + CDN_TEST + '\nFehler: ' + e.message
            );
        });
    </script>
</head>
<body>

<!-- 3D-Buehne -->
<div id="stage" aria-label="3D-Modell der Brauanlage" role="region"></div>

<!-- ============================================================
     WAND-PROJEKTION
     ============================================================ -->
<div id="wall-display" class="wall-display" hidden role="dialog" aria-label="Detail-Ansicht">
    <div class="wd-projection-bg" aria-hidden="true">
        <div class="wd-scanlines"></div>
        <div class="wd-corner wd-corner--tl"></div>
        <div class="wd-corner wd-corner--tr"></div>
        <div class="wd-corner wd-corner--bl"></div>
        <div class="wd-corner wd-corner--br"></div>
    </div>
    <div class="wd-inner">
        <div class="wd-head" id="wd-head"></div>
        <div class="wd-tabs" id="wd-tabs" hidden>
            <button class="wd-tab is-active" data-tab="series">&#128200; Braukessel</button>
            <button class="wd-tab" data-tab="pumps">&#128260; Pumpen</button>
            <button class="wd-tab" data-tab="brewdays">&#127866; Brautage</button>
        </div>
        <div class="wd-body" id="wd-body"></div>
    </div>
</div>

<!-- ============================================================
     LINKES SETTINGS-PANEL
     ============================================================ -->
<aside id="settings-panel" class="settings-panel" aria-label="Einstellungen">

    <!-- Brand-Bar (immer sichtbar) -->
    <div class="sp-brand">
        <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="26" height="26" fill="none">
                <path d="M8 6 L8 22 Q8 26 12 26 L20 26 Q24 26 24 22 L24 6 Z"
                      stroke="currentColor" stroke-width="2"/>
                <path d="M24 10 L28 10 L28 18 L24 18" stroke="currentColor" stroke-width="2"/>
                <circle cx="16" cy="14" r="1.4" fill="currentColor"/>
                <circle cx="13" cy="18" r="1.1" fill="currentColor"/>
                <circle cx="19" cy="19" r="1.1" fill="currentColor"/>
            </svg>
        </div>
        <div class="brand-text">
            <div class="brand-eyebrow">OTH &middot; InfoVis 2026</div>
            <div class="brand-title">Brauerei&nbsp;Monitoring</div>
        </div>
        <button id="btn-settings-toggle" class="sp-toggle"
                aria-expanded="false" title="Einstellungen öffnen">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none"
                 stroke="currentColor" stroke-width="1.8">
                <circle cx="10" cy="6"  r="1.5"/>
                <line x1="10" y1="1"  x2="10" y2="4.5"/>
                <line x1="10" y1="7.5" x2="10" y2="19"/>
                <circle cx="5"  cy="13" r="1.5"/>
                <line x1="5"  y1="1"  x2="5"  y2="11.5"/>
                <line x1="5"  y1="14.5" x2="5" y2="19"/>
                <circle cx="15" cy="9"  r="1.5"/>
                <line x1="15" y1="1"  x2="15" y2="7.5"/>
                <line x1="15" y1="10.5" x2="15" y2="19"/>
            </svg>
        </button>
    </div>

    <!-- Anlagen-Status: Pill + Timer (immer sichtbar, ausserhalb des Body) -->
    <div class="sp-status-row" id="sp-status-row">
        <span class="sp-status-pill sp-status-pill--idle" id="sp-brewery-status">Inaktiv</span>
        <!-- Timer: Sekunden seit letzter Aktualisierung -->
        <span class="sp-last-update-hint" id="sp-update-timer" title="Sekunden seit letzter Daten-Aktualisierung"></span>
    </div>

    <!-- Ausklappbarer Koerper -->
    <div id="settings-body" class="sp-body" hidden>

        <!-- Projektion -->
        <section class="sp-section">
            <h4 class="sp-section-title">Datenfenster-Stil</h4>
            <div class="vf-group">
                <button class="vf-btn proj-btn is-active" data-proj="3d">Wand 3D</button>
                <button class="vf-btn proj-btn" data-proj="overlay">Overlay</button>
            </div>
            <p class="sp-hint" id="proj-hint">Auf der 3D-Wand &ndash; beim Wegbewegen verschwindet es</p>
        </section>

        <!-- Variable anzeigen (bleibt erhalten) -->
        <section class="sp-section">
            <h4 class="sp-section-title">3D-Balkendiagramm</h4>
            <div class="sp-sub-label">Variable anzeigen</div>
            <select id="bar-variable-select" class="sp-select">
                <option value="ist">Ist-Temperatur</option>
                <option value="soll">Soll-Temperatur</option>
                <option value="delta">Delta (Ist &minus; Soll)</option>
                <option value="ventil">Ventil (Offen/Zu)</option>
                <option value="ein">Kuehlregelung (aktiv/aus)</option>
                <option value="auto">Auto-Modus (an/aus)</option>
            </select>
        </section>

        <!-- Warn-Schwellen: Button oeffnet Modal -->
        <section class="sp-section">
            <button id="btn-open-thresholds" class="action-btn action-btn--full">
                &#9881; Warnschwellen einstellen
            </button>
        </section>

        <!-- Versteckte Checkboxen (immer aktiv, kein sichtbares UI) -->
        <input type="checkbox" id="set-showTempDigital" checked style="display:none">
        <input type="checkbox" id="set-showStatusColor" checked style="display:none">
        <input type="checkbox" id="set-showModeBadge"   checked style="display:none">
        <input type="checkbox" id="set-showVentilFlow"  checked style="display:none">
        <input type="checkbox" id="set-showTempBars"    checked style="display:none">
        <input type="checkbox" id="set-showSollMarker"  checked style="display:none">
        <input type="checkbox" id="set-showBarLabels"   checked style="display:none">

        <!-- Navigation / Aktionen -->
        <section class="sp-section sp-section--actions">
            <button id="btn-help" class="action-btn">? Hilfe</button>
            <?php if (AUTH_ENABLED): ?>
            <a href="logout.php" class="action-btn action-btn--muted">&#10548; Abmelden</a>
            <?php endif; ?>
        </section>

    </div><!-- /settings-body -->
</aside>

<!-- ============================================================
     STATUSLEISTE
     ============================================================ -->
<footer class="statusbar" aria-label="Verbindungsstatus">
    <div class="statusbar-left">
        <span id="conn-dot" class="conn-dot conn-dot--unknown" aria-hidden="true"></span>
        <span id="conn-text">Verbinde &hellip;</span>
    </div>
    <div class="statusbar-center">
        <span class="hint">Klick Tank &rarr; Details &middot; WASD &rarr; Bewegen &middot; Shift+R &rarr; Reset</span>
    </div>
    <div class="statusbar-right">
        <span id="last-update">&mdash;</span>
    </div>
</footer>

<!-- ============================================================
     WARN-SCHWELLEN-MODAL (ausgeklappt aus Sidebar)
     ============================================================ -->
<div id="thresholds-modal" class="modal" hidden role="dialog" aria-labelledby="thr-modal-title">
    <div class="modal-backdrop" data-close></div>
    <div class="modal-card modal-card--wide">
        <button class="modal-close" data-close aria-label="Schliessen">&times;</button>
        <h2 id="thr-modal-title">&#9881; Warnschwellen einstellen</h2>

        <div class="thr-modal-grid">
            <!-- Kuehltanks -->
            <div class="thr-modal-col">
                <h3 class="thr-modal-col-title">Kuehltanks</h3>
                <div class="thr-group">
                    <div class="thr-row">
                        <span class="thr-label">&#9888; Abweichung Warnung</span>
                        <input type="number" class="thr-input" id="thr-tank-warn" value="2.0"
                               min="0.1" max="20" step="0.5" data-thr="tank.deltaWarn">
                        <span class="thr-unit">&deg;C</span>
                    </div>
                    <div class="thr-row">
                        <span class="thr-label thr-crit">&#128308; Abweichung Kritisch</span>
                        <input type="number" class="thr-input" id="thr-tank-crit" value="5.0"
                               min="0.5" max="30" step="0.5" data-thr="tank.deltaCrit">
                        <span class="thr-unit">&deg;C</span>
                    </div>
                    <div class="thr-row">
                        <span class="thr-label">&#9660; Abs. Min-Temp</span>
                        <input type="number" class="thr-input" id="thr-tank-absMin" value="-2.0"
                               min="-20" max="20" step="0.5" data-thr="tank.absMin">
                        <span class="thr-unit">&deg;C</span>
                    </div>
                    <div class="thr-row">
                        <span class="thr-label">&#9650; Abs. Max-Temp</span>
                        <input type="number" class="thr-input" id="thr-tank-absMax" value="24.0"
                               min="5" max="50" step="0.5" data-thr="tank.absMax">
                        <span class="thr-unit">&deg;C</span>
                    </div>
                </div>
                <div class="threshold-preview" id="thr-tank-preview">
                    <div class="thr-band ok">OK</div>
                    <div class="thr-band warn">Warn</div>
                    <div class="thr-band crit">Krit</div>
                </div>
            </div>

            <!-- Braukessel -->
            <div class="thr-modal-col">
                <h3 class="thr-modal-col-title">Braukessel</h3>
                <div class="thr-group">
                    <div class="thr-row">
                        <span class="thr-label">&#9888; Abweichung Warnung</span>
                        <input type="number" class="thr-input" id="thr-bk-warn" value="3.0"
                               min="0.1" max="30" step="0.5" data-thr="brewkettle.deltaWarn">
                        <span class="thr-unit">&deg;C</span>
                    </div>
                    <div class="thr-row">
                        <span class="thr-label thr-crit">&#128308; Abweichung Kritisch</span>
                        <input type="number" class="thr-input" id="thr-bk-crit" value="8.0"
                               min="0.5" max="50" step="0.5" data-thr="brewkettle.deltaCrit">
                        <span class="thr-unit">&deg;C</span>
                    </div>
                    <div class="thr-row">
                        <span class="thr-label">&#9660; Abs. Min-Temp</span>
                        <input type="number" class="thr-input" id="thr-bk-absMin" value="10.0"
                               min="0" max="50" step="1" data-thr="brewkettle.absMin">
                        <span class="thr-unit">&deg;C</span>
                    </div>
                    <div class="thr-row">
                        <span class="thr-label">&#9650; Abs. Max-Temp</span>
                        <input type="number" class="thr-input" id="thr-bk-absMax" value="105.0"
                               min="50" max="200" step="1" data-thr="brewkettle.absMax">
                        <span class="thr-unit">&deg;C</span>
                    </div>
                </div>
            </div>
        </div>

        <p class="thr-modal-hint">Aenderungen werden sofort uebernommen und lokal gespeichert.</p>
    </div>
</div>

<!-- Hilfe-Modal -->
<div id="help-modal" class="modal" hidden role="dialog" aria-labelledby="help-title">
    <div class="modal-backdrop" data-close></div>
    <div class="modal-card">
        <button class="modal-close" data-close aria-label="Schliessen">&times;</button>
        <h2 id="help-title">Bedienung</h2>
        <dl class="help-list">
            <dt>Maus ziehen</dt><dd>Kamera drehen</dd>
            <dt>Maus-Rad</dt><dd>Zoomen</dd>
            <dt>WASD</dt><dd>Kamera bewegen &middot; Q/E Hoehe &middot; Shift+R Reset</dd>
            <dt>Klick auf Tank / Kessel</dt><dd>Detail-Ansicht oeffnen</dd>
            <dt>Doppelklick</dt><dd>Uebersicht zurueck</dd>
            <dt>&#9881; Links oben</dt><dd>Einstellungen oeffnen/schliessen</dd>
        </dl>
        <h3>AR-Modus</h3>
        <p class="muted">Kamera oeffnen und QR-Code eines Tanks einscannen. Mehrere Codes gleichzeitig erkennbar.<br>
        QR-Code-Inhalte: BRAUEREI:TANK:1 &hellip; BRAUEREI:TANK:6 und BRAUEREI:KESSEL:1</p>
    </div>
</div>

<!-- Boot-Overlay -->
<div id="boot-overlay" class="boot-overlay" aria-hidden="true">
    <div class="boot-pulse"></div>
    <div class="boot-text">3D-Anlage wird aufgebaut &hellip;</div>
</div>

<!-- AR-Modus Button -->
<button id="btn-ar-mode" class="ar-fixed-btn" title="AR-Kamera-Modus starten">
    <span class="ar-btn-icon">&#128247;</span>
    <span class="ar-btn-label">AR</span>
</button>

<script>
    // Warn-Schwellen-Modal oeffnen/schliessen
    document.getElementById('btn-open-thresholds')?.addEventListener('click', function() {
        document.getElementById('thresholds-modal').hidden = false;
    });
    document.querySelectorAll('[data-close]').forEach(function(el) {
        el.addEventListener('click', function() {
            el.closest('.modal')?.setAttribute('hidden', '');
        });
    });

    // Update-Timer: zeigt wie viele Sekunden seit letzter Aktualisierung
    (function() {
        var lastTs   = null;    // Timestamp der letzten erfolgreichen Aktualisierung (ms)
        var timerEl  = document.getElementById('sp-update-timer');
        var pillEl   = document.getElementById('sp-brewery-status');
        var OFFLINE_SEC = 120;  // ab 2 Minuten -> "Brauerei offline"

        // Wird von main.js aufgerufen wenn neue Daten ankommen
        window._onDataUpdate = function(tsMs) {
            lastTs = tsMs || Date.now();
        };

        setInterval(function() {
            if (!timerEl) return;
            if (lastTs === null) {
                timerEl.textContent = '';
                return;
            }
            var sec = Math.round((Date.now() - lastTs) / 1000);
            if (sec >= OFFLINE_SEC) {
                timerEl.textContent = 'Brauerei offline';
                timerEl.style.color = '#e2533b';
            } else if (sec >= 30) {
                timerEl.textContent = 'vor ' + sec + ' sek';
                timerEl.style.color = '#f0b73f';
            } else {
                timerEl.textContent = 'vor ' + sec + ' sek';
                timerEl.style.color = '';
            }
        }, 1000);
    })();
</script>

<script>
    setTimeout(function() {
        var overlay = document.getElementById('boot-overlay');
        if (overlay && !overlay.classList.contains('is-hidden')) {
            if (!overlay.querySelector('h2')) {
                overlay.innerHTML = '<div style="color:#e8e8e8;max-width:640px;padding:24px;font-family:monospace">'
                    + '<h2 style="font-size:15px;color:#f0b73f">&#9202; Laden dauert zu lange...</h2>'
                    + '<p style="font-size:12px;color:#aaa;margin:10px 0">Moegliche Ursachen:</p>'
                    + '<ul style="font-size:11px;color:#888;margin:0 0 12px 20px">'
                    + '<li>CDN (jsdelivr.net) nicht erreichbar vom Browser</li>'
                    + '<li>Datei fehlt auf dem Server</li>'
                    + '<li>PHP-Fehler in einer Datei</li>'
                    + '</ul>'
                    + '<p style="font-size:11px;color:#aaa">Konsole oeffnen (F12 &rarr; Console) und Fehler suchen.</p>'
                    + '</div>';
            }
        }
    }, 4000);
</script>

<script type="importmap">
{
  "imports": {
    "three":           "https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js",
    "OrbitControls":   "https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/controls/OrbitControls.js",
    "CSS2DRenderer":   "https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/renderers/CSS2DRenderer.js",
    "CSS3DRenderer":   "https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/renderers/CSS3DRenderer.js",
    "FontLoader":      "https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/FontLoader.js",
    "TextGeometry":    "https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/geometries/TextGeometry.js",
    "VRButton":        "https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/webxr/VRButton.js",
    "ARButton":        "https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/webxr/ARButton.js"
  }
}
</script>
<script type="module" src="assets/js/main.js?v=<?php echo time(); ?>"></script>
</body>
</html>