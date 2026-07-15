/**
 * Frontend-Konfiguration - Vollstaendig (alle Exports)
 */
const SERVER = window.APP_CONFIG || {};

export const POLLING_INTERVAL_MS = (SERVER.pollingIntervalSec || 5) * 1000;
export const CHART_HISTORY_LIMIT = SERVER.chartHistoryLimit || 600;
export const API_ENDPOINT        = SERVER.apiEndpoint || 'api/get_data.php';
export const DETAIL_SERIES_LIMIT = 240;

export const ALIAS_MAP = {};
export function getAlias(name) { return ALIAS_MAP[name] || name; }

export const TANKS = [
    { id: 1, label: 'Kuehltank 1', x:  18, z: 0 },
    { id: 2, label: 'Kuehltank 2', x:  34, z: 0 },
    { id: 3, label: 'Kuehltank 3', x:  50, z: 0 },
    { id: 4, label: 'Kuehltank 4', x:  66, z: 0 },
    { id: 5, label: 'Kuehltank 5', x:  82, z: 0 },
    { id: 6, label: 'Kuehltank 6', x:  98, z: 0 },
];

export function varsForTank(tankId) {
    return {
        ein:    'T'+tankId+'_Ein',
        auto:   'T'+tankId+'_AM',
        ist:    'T'+tankId+'_IstT',
        soll:   'T'+tankId+'_SollT',
        ventil: 'T'+tankId+'_AV',
        hand:   'T'+tankId+'_HV',
    };
}

export const BREWKETTLE_VARS = {
    aktiv: 'B_Aktiv',
    ein:   'BK_Ein',
    auto:  'BK_Auto',
    ist:   'BK_Ist',
    soll:  'BK_Soll',
    hand:  'BK_Hand',
    heat:  'BK_A_H',
};

export const PUMP_VARS = {
    p1_run:  'P1_Run',
    p1_val:  'P1_Val',
    cwp_run: 'CWP_Run',
    cwp_val: 'CWP_Val',
};

export const COOLING_WATER_VAR = 'T_HeatEx';

export const THRESHOLDS = {
    tank:       { deltaWarn: 2.0, deltaCrit: 5.0, absMin: -2.0, absMax: 24.0 },
    brewkettle: { deltaWarn: 3.0, deltaCrit: 8.0, absMin: 10.0, absMax: 105.0 },
};

export function classifyStatus(ist, soll, kind = 'tank') {
    if (ist == null || soll == null) return 'idle';
    const delta = Math.abs(ist - soll);
    const t = THRESHOLDS[kind] || THRESHOLDS.tank;
    return delta >= t.deltaCrit ? 'crit' : delta >= t.deltaWarn ? 'warn' : 'ok';
}

export const STATUS_COLORS = {
    ok:   '#4ec57a',
    warn: '#f0b73f',
    crit: '#e2533b',
    idle: '#4a5568',
};

export function isActive(v) { return v != null && +v > 0.5; }

// Marker zur Verifikation
console.log('=== CONFIG.JS V9 GELADEN (vollstaendig) ===');