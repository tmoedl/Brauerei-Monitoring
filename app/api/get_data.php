<?php
/**
 * Daten-API mit Zeitbereich-Support + Brautage-Erkennung
 * --------------------------------------------------------------
 * Endpunkte:
 *   ?action=list                          → Liste aller Variablen
 *   ?action=current&names=a,b             → Aktueller Wert (HUD/Labels)
 *   ?action=series&names=a,b&range=1d     → Verlauf für Zeitraum
 *   ?action=brew_days                     → Liste erkannter Brausessions
 *   ?action=brew_days&date=YYYY-MM-DD     → Zeitreihen für einen Tag
 *
 * Erlaubte ranges: 1h, 6h, 1d, 1w, 1m, all
 *
 * @author OTH Amberg-Weiden | InfoVis 2026
 */

require_once __DIR__ . '/../auth.php';
Auth::requireLogin('json');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', DB_HOST, DB_NAME);
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

function safeVar(string $name): string {
    if (!preg_match('/^[A-Za-z0-9_]{1,40}$/', $name)) {
        throw new InvalidArgumentException("Ungültiger Variablenname: $name");
    }
    return $name;
}

function parseNames(?string $raw): array {
    if (!$raw) return [];
    $names = array_filter(array_map('trim', explode(',', $raw)));
    return array_values(array_unique(array_map('safeVar', $names)));
}

function resolveRange(?string $range, ?int $fromMs, ?int $toMs): array {
    $toSec = $toMs ? (int)($toMs / 1000) : time();
    if ($fromMs) {
        return ['from' => (int)($fromMs / 1000), 'to' => $toSec];
    }
    $map = [
        '1h'  =>      3600,
        '6h'  =>  6 * 3600,
        '1d'  => 24 * 3600,
        '1w'  =>  7 * 24 * 3600,
        '1m'  => 30 * 24 * 3600,
        'all' => null,
    ];
    $range = $range ?: '1d';
    if (!array_key_exists($range, $map)) {
        throw new InvalidArgumentException("Unbekannter Range: $range");
    }
    if ($map[$range] === null) {
        return ['from' => 0, 'to' => $toSec];
    }
    return ['from' => $toSec - $map[$range], 'to' => $toSec];
}

function tableExists(string $name): bool {
    try {
        $stmt = db()->query("SHOW TABLES LIKE " . db()->quote($name));
        return (bool)$stmt->fetchColumn();
    } catch (Throwable $e) {
        return false;
    }
}

function fetchSeries(string $name, int $fromSec, int $toSec, int $maxPoints): array {
    $table = "v_" . $name;
    
    // TRY-CATCH hinzufügen, falls Tabelle nicht existiert
    try {
        $cnt   = db()->prepare("SELECT COUNT(*) FROM `$table` WHERE ts BETWEEN FROM_UNIXTIME(:f) AND FROM_UNIXTIME(:t)");
        $cnt->execute([':f' => $fromSec, ':t' => $toSec]);
        $count = (int)$cnt->fetchColumn();
    } catch (PDOException $e) {
        // Tabelle existiert nicht -> Leeres Array zurückgeben
        return [];
    }
    
    if ($count === 0) return [];
    if ($count <= $maxPoints) {
        $stmt = db()->prepare(
            "SELECT UNIX_TIMESTAMP(ts)*1000 AS ts_ms, val
             FROM `$table`
             WHERE ts BETWEEN FROM_UNIXTIME(:f) AND FROM_UNIXTIME(:t)
             ORDER BY ts ASC"
        );
        $stmt->execute([':f' => $fromSec, ':t' => $toSec]);
        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            $out[] = [(int)$row['ts_ms'], (float)$row['val']];
        }
        return $out;
    }

    $spanSec    = max(1, $toSec - $fromSec);
    $bucketSize = max(1, (int)ceil($spanSec / $maxPoints));
    $sql = "
        SELECT
            (FLOOR(UNIX_TIMESTAMP(ts) / :bs1) * :bs2) * 1000 AS ts_ms,
            AVG(val) AS v
        FROM `$table`
        WHERE ts BETWEEN FROM_UNIXTIME(:f) AND FROM_UNIXTIME(:t)
        GROUP BY FLOOR(UNIX_TIMESTAMP(ts) / :bs3)
        ORDER BY ts_ms ASC
    ";
    $stmt = db()->prepare($sql);
    $stmt->bindValue(':bs1', $bucketSize, PDO::PARAM_INT);
    $stmt->bindValue(':bs2', $bucketSize, PDO::PARAM_INT);
    $stmt->bindValue(':bs3', $bucketSize, PDO::PARAM_INT);
    $stmt->bindValue(':f',   $fromSec,   PDO::PARAM_INT);
    $stmt->bindValue(':t',   $toSec,     PDO::PARAM_INT);
    $stmt->execute();
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $out[] = [(int)$row['ts_ms'], (float)$row['v']];
    }
    return $out;
}

// ================================================================
try {
    $action = $_GET['action'] ?? '';

    switch ($action) {

        // ----------------------------------------------------------
        case 'list': {
            $stmt   = db()->query("SHOW TABLES LIKE 'v\\_%'");
            $tables = $stmt->fetchAll(PDO::FETCH_COLUMN);
            $vars   = array_map(fn($t) => substr($t, 2), $tables);
            sort($vars, SORT_NATURAL | SORT_FLAG_CASE);
            echo json_encode(['variables' => $vars]);
            break;
        }

        // ----------------------------------------------------------
		case 'current': {
					$names = parseNames($_GET['names'] ?? '');
					if (!$names) {
						echo json_encode(['values' => new stdClass(), 'latest_ts' => 0]);
						break;
					}
					$values   = [];
					$latestTs = 0;
					foreach ($names as $name) {
						$table = "v_" . $name;

						// Jede Tabelle einzeln im try...catch prüfen!
						try {
							$stmt  = db()->prepare(
								"SELECT val, UNIX_TIMESTAMP(ts)*1000 AS ts_ms FROM `$table` ORDER BY ts DESC LIMIT 1"
							);
							$stmt->execute();
							$row = $stmt->fetch();
							if ($row) {
								$values[$name] = ['val' => (float)$row['val'], 'ts' => (int)$row['ts_ms']];
								if ($row['ts_ms'] > $latestTs) $latestTs = (int)$row['ts_ms'];
							} else {
								$values[$name] = null;
							}
						} catch (PDOException $e) {
							// Tabelle existiert noch nicht im System -> Wert ist null
							$values[$name] = null;
						}
					}

					echo json_encode([
						'values'      => $values,
						'latest_ts'   => $latestTs,
						'server_time' => (int)(microtime(true) * 1000),
					]);
					break;
				}

        // ----------------------------------------------------------
        case 'series': {
            $names  = parseNames($_GET['names'] ?? '');
            $range  = isset($_GET['range']) ? (string)$_GET['range'] : null;
            $fromMs = isset($_GET['from'])  ? (int)$_GET['from']  : null;
            $toMs   = isset($_GET['to'])    ? (int)$_GET['to']    : null;
            $maxPts = max(10, min(2000, (int)($_GET['maxPoints'] ?? 600)));

            $r        = resolveRange($range, $fromMs, $toMs);
            $series   = [];
            $latestTs = 0;
            foreach ($names as $name) {
                $data = fetchSeries($name, $r['from'], $r['to'], $maxPts);
                if (!empty($data)) {
                    $last = end($data)[0];
                    if ($last > $latestTs) $latestTs = $last;
                }
                $series[] = ['name' => $name, 'data' => $data];
            }
            echo json_encode([
                'series'      => $series,
                'range'       => ['from' => $r['from'] * 1000, 'to' => $r['to'] * 1000],
                'latest_ts'   => $latestTs,
                'server_time' => (int)(microtime(true) * 1000),
            ]);
            break;
        }

        // ----------------------------------------------------------
        // Brautage: erkennt Sessions wo Braukessel/Pumpe aktiv war.
        // Ohne 'date': gibt Liste aller erkannter Sessions zurück.
        // Mit 'date=YYYY-MM-DD': gibt Zeitreihen für diesen Tag zurück.
        // ----------------------------------------------------------
        case 'brew_days': {
            $limitDays  = max(7, min(365, (int)($_GET['limitDays'] ?? 90)));
            $detailDate = $_GET['date'] ?? null;

            // Detail-Modus: Zeitreihen für einen spezifischen Tag
            if ($detailDate !== null) {
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $detailDate)) {
                    throw new InvalidArgumentException('Ungültiges Datum (erwartet YYYY-MM-DD)');
                }
                $from = (int)strtotime($detailDate . ' 00:00:00');
                $to   = (int)strtotime($detailDate . ' 23:59:59');

                $varNames = ['BK_Ist', 'BK_Soll', 'BK_A_H'];
                // Pumpen-Variable falls vorhanden
                foreach (['BK_Ein', 'P1_Run'] as $pv) {
                    if (tableExists("v_{$pv}")) { $varNames[] = $pv; break; }
                }

                $series = [];
                foreach ($varNames as $vn) {
                    try {
                        $data = fetchSeries($vn, $from, $to, 800);
                    } catch (Throwable $e) {
                        $data = [];
                    }
                    $series[] = ['name' => $vn, 'data' => $data];
                }

                echo json_encode([
                    'series' => $series,
                    'date'   => $detailDate,
                    'range'  => ['from' => $from * 1000, 'to' => $to * 1000],
                ]);
                break;
            }

            // Listen-Modus: Sessions erkennen
            // Welche Variable signalisiert "Brauerei aktiv"?
            $sourceVar = null;
            foreach (['BK_Ein', 'P1_Run', 'B_Aktiv'] as $candidate) {
                if (tableExists("v_{$candidate}")) { $sourceVar = $candidate; break; }
            }

            if (!$sourceVar) {
                echo json_encode(['brew_days' => [], 'note' => 'Keine Aktivierungs-Variable gefunden']);
                break;
            }

            // Alle aktiven Zeitpunkte im Fenster laden
            $stmt = db()->prepare(
                "SELECT UNIX_TIMESTAMP(ts) AS ts_sec, val
                 FROM `v_{$sourceVar}`
                 WHERE ts > DATE_SUB(NOW(), INTERVAL :days DAY)
                   AND val > 0.5
                 ORDER BY ts ASC"
            );
            $stmt->execute([':days' => $limitDays]);
            $rows = $stmt->fetchAll();

            // Sessions erkennen (max. 30 min Lücke, min. 20 min Dauer)
            $GAP_SEC     = 1800;  // 30 Minuten Maximal-Lücke zwischen zwei aktiven Punkten
            $MIN_DUR_SEC = 1200;  // 20 Minuten Mindestdauer einer Session

            $sessions     = [];
            $sessStart    = null;
            $sessEnd      = null;
            $sessLastSeen = null;

            foreach ($rows as $row) {
                $t = (int)$row['ts_sec'];
                if ($sessStart === null) {
                    $sessStart = $sessEnd = $t;
                } elseif (($t - $sessLastSeen) > $GAP_SEC) {
                    // Lücke → aktuelle Session abschliessen
                    if (($sessEnd - $sessStart) >= $MIN_DUR_SEC) {
                        $sessions[] = ['start' => $sessStart, 'end' => $sessEnd];
                    }
                    $sessStart = $sessEnd = $t;
                } else {
                    $sessEnd = $t;
                }
                $sessLastSeen = $t;
            }
            if ($sessStart !== null && ($sessEnd - $sessStart) >= $MIN_DUR_SEC) {
                $sessions[] = ['start' => $sessStart, 'end' => $sessEnd];
            }

            // Metadaten pro Session anreichern
            $result = [];
            foreach ($sessions as $s) {
                $date     = date('Y-m-d', $s['start']);
                $durMin   = (int)round(($s['end'] - $s['start']) / 60);
                $peakTemp = null;
                $avgTemp  = null;

                if (tableExists('v_BK_Ist')) {
                    try {
                        $tStmt = db()->prepare(
                            "SELECT MAX(val) AS peak, AVG(val) AS avg
                             FROM v_BK_Ist
                             WHERE ts BETWEEN FROM_UNIXTIME(:f) AND FROM_UNIXTIME(:t)"
                        );
                        $tStmt->execute([':f' => $s['start'], ':t' => $s['end']]);
                        $tr = $tStmt->fetch();
                        if ($tr && $tr['peak'] !== null) {
                            $peakTemp = round((float)$tr['peak'], 1);
                            $avgTemp  = round((float)$tr['avg'], 1);
                        }
                    } catch (Throwable $e) { /* ignorieren */ }
                }

                $result[] = [
                    'date'         => $date,
                    'start_ms'     => $s['start'] * 1000,
                    'end_ms'       => $s['end'] * 1000,
                    'duration_min' => $durMin,
                    'peak_temp'    => $peakTemp,
                    'avg_temp'     => $avgTemp,
                ];
            }

            // Neueste zuerst
            usort($result, fn($a, $b) => $b['start_ms'] <=> $a['start_ms']);

            echo json_encode([
                'brew_days'  => $result,
                'source_var' => $sourceVar,
                'limit_days' => $limitDays,
                'server_time' => (int)(microtime(true) * 1000),
            ]);
            break;
        }

        // ----------------------------------------------------------
        default:
            http_response_code(400);
            echo json_encode(['error' => 'Unbekannte Aktion. Erlaubt: list, current, series, brew_days']);
    }

} catch (InvalidArgumentException $e) {
    http_response_code(400);
    echo json_encode(['error' => $e->getMessage()]);
} catch (PDOException $e) {
    http_response_code(500);
    error_log('[brauerei-api] ' . $e->getMessage());
    echo json_encode(['error' => 'Datenbank-Fehler', 'detail' => $e->getMessage()]);
} catch (Throwable $e) {
    http_response_code(500);
    error_log('[brauerei-api] ' . $e->getMessage());
    echo json_encode(['error' => 'Interner Fehler']);
}