console.log('=== MAIN.JS V10 GELADEN ===');
/**
 * App-Orchestrator v10 (main.js)
 *
 * Aenderungen:
 *  - openDetail: Kamera zoomt nun auf die Wand (Datenfenster-Position),
 *    nicht auf den Tank - distance reduziert, Y-Ziel hoeher gesetzt
 *  - Poll: window._onDataUpdate() wird aufgerufen fuer Status-Timer
 *  - Bars/Soll/Labels werden immer mit show() gestartet (Default true)
 */

import { Scene }         from './Scene.js?v=1784124514';
import { BreweryModel }  from './BreweryModel.js?v=1784124514';
import { WallDisplay }   from './WallDisplay.js?v=1784124514';
import { WallPanel3D }   from './WallPanel3D.js?v=1784124514';
import { SettingsPanel } from './SettingsPanel.js?v=1784124514';
import { dataService }   from './dataService.js?v=1784124514';

// ================================================================
// Inline-Konfiguration
// ================================================================
const SERVER = window.APP_CONFIG || {};
const POLLING_INTERVAL_MS = (SERVER.pollingIntervalSec || 5) * 1000;

const TANKS = [
    { id: 1, label: 'Kuehltank 1', x:  18, z: 0 },
    { id: 2, label: 'Kuehltank 2', x:  34, z: 0 },
    { id: 3, label: 'Kuehltank 3', x:  50, z: 0 },
    { id: 4, label: 'Kuehltank 4', x:  66, z: 0 },
    { id: 5, label: 'Kuehltank 5', x:  82, z: 0 },
    { id: 6, label: 'Kuehltank 6', x:  98, z: 0 },
];

const BREWKETTLE_VARS = {
    aktiv: 'B_Aktiv', ein: 'BK_Ein', auto: 'BK_Auto',
    ist: 'BK_Ist', soll: 'BK_Soll', hand: 'BK_Hand',
    heat: 'BK_A_H',
};

const PUMP_VARS = {
    p1_run: 'P1_Run', p1_val: 'P1_Val',
    cwp_run: 'CWP_Run', cwp_val: 'CWP_Val',
};

const COOLING_WATER_VAR = 'T_HeatEx';

function varsForTank(tankId) {
    return {
        ein:    'T'+tankId+'_Ein',
        auto:   'T'+tankId+'_AM',
        ist:    'T'+tankId+'_IstT',
        soll:   'T'+tankId+'_SollT',
        ventil: 'T'+tankId+'_AV',
        hand:   'T'+tankId+'_HV',
    };
}

const THRESHOLDS = {
    tank:       { deltaWarn: 2.0, deltaCrit: 5.0, absMin: -2.0, absMax: 24.0 },
    brewkettle: { deltaWarn: 3.0, deltaCrit: 8.0, absMin: 10.0, absMax: 105.0 },
};

function classifyStatus(ist, soll, kind) {
    if (ist == null || soll == null) return 'idle';
    try {
        const stored = JSON.parse(localStorage.getItem('brauerei-thr') || '{}');
        if (stored[kind]) Object.assign(THRESHOLDS[kind], stored[kind]);
    } catch {}
    const delta = Math.abs(ist - soll);
    const t = THRESHOLDS[kind] || THRESHOLDS.tank;
    return delta >= t.deltaCrit ? 'crit' : delta >= t.deltaWarn ? 'warn' : 'ok';
}

function isActive(v) { return v != null && +v > 0.5; }
const LOG  = (m, ...a) => console.log('[App]', m, ...a);
const WARN = (m, ...a) => console.warn('[App]', m, ...a);

function buildVarList() {
    const list = new Set();
    Object.values(BREWKETTLE_VARS).forEach(v => list.add(v));
    Object.values(PUMP_VARS).forEach(v => list.add(v));
    list.add(COOLING_WATER_VAR);
    TANKS.forEach(t => Object.values(varsForTank(t.id)).forEach(n => list.add(n)));
    return Array.from(list);
}

async function boot() {
    LOG('=== BOOT START ===');

    //Optionale Module mit Fallback
    let TankLabels3D_cls = null;
    let TankBars3D_cls   = null;
    let ARMode_cls       = null;

    try {
        const m = await import('./Labels3D.js?v=1784124514');
        TankLabels3D_cls = m.Labels3D || m.TankLabels3D;
        LOG('TankLabels3D geladen');
    } catch (e) { WARN('TankLabels3D nicht geladen:', e.message); }

    try {
        const m = await import('./BarChart3D.js?v=1784124514');
        TankBars3D_cls = m.BarChart3D || m.TankBars3D;
        LOG('TankBars3D geladen');
    } catch (e) { WARN('TankBars3D nicht geladen:', e.message); }

    try {
        const m = await import('./ARMode.js?v=1784124514');
        ARMode_cls = m.ARMode;
        LOG('ARMode geladen');
    } catch (e) { WARN('ARMode nicht geladen:', e.message); }

    const scene = new Scene('#stage');
    scene.setTankConfig({ TANKS });

    let labels3D = null;
    if (TankLabels3D_cls) {
        try { labels3D = new TankLabels3D_cls(scene); }
        catch (e) { WARN('TankLabels3D Init:', e.message); }
    }
    if (!labels3D) {
        labels3D = {
            labels: new Map(),
            setAllVisible: () => {},
            setVisible: () => {},
            setValue: () => {},
            highlight: () => {},
            resetHighlight: () => {},
        };
        WARN('Labels deaktiviert (Fallback)');
    }

    const model       = new BreweryModel(scene);
    const wallOverlay = new WallDisplay('#wall-display', null);
    const wallPanel3D = new WallPanel3D(scene);

    let bars3D = null;
    if (TankBars3D_cls) {
        try { bars3D = new TankBars3D_cls(scene); LOG('TankBars3D bereit'); }
        catch (e) { WARN('TankBars3D Init:', e.message); }
    }

    let arMode = null;
    if (ARMode_cls) {
        try { arMode = new ARMode_cls(); }
        catch (e) { WARN('ARMode Init:', e.message); }
    }

    const settings  = new SettingsPanel('#settings-panel');
    const statusMap = new Map();
    const detailMap = new Map();
    let lastValues  = {};
    let currentMode = '3d';
    wallPanel3D._currentModeLabel = '3d';

    //Render-Loop
    scene.start((dt, elapsed) => {
        model.update(dt, elapsed, statusMap, detailMap);
        wallPanel3D.update(dt, elapsed);
        bars3D?.update(dt);
    });

    //Balkendiagramm-Sichtbarkeit: EINZIGE Quelle der Wahrheit.
    //Sichtbar genau dann, wenn KEIN Detail-Panel offen ist UND die Einstellung
    //aktiv ist. Nach jedem Oeffnen/Schliessen/Moduswechsel aufrufen, statt
    //verstreut show()/hide() aufzurufen (das fuehrte bisher dazu, dass das
    //Diagramm in manchen Pfaden - z.B. Overlay-Modus - versteckt blieb).
    function syncBarsVisibility() {
        const panelOpen = wallOverlay.isOpen() || wallPanel3D.isOpen();
        if (!panelOpen && settings.settings.showTempBars) bars3D?.show();
        else bars3D?.hide();
    }

    //onClose
    const onPanelClose = () => {
        labels3D.resetHighlight?.();
        settings.selectBrewDay(null);
        syncBarsVisibility();
    };
    wallOverlay.onClose(onPanelClose);
    wallPanel3D.onClose(onPanelClose);

    //Mode switch
    function switchMode(newMode, reopenId = null) {
        if (newMode === currentMode && !reopenId) return;
        if (currentMode === 'overlay' && wallOverlay.isOpen()) wallOverlay.close();
        if (currentMode === '3d' && wallPanel3D.isOpen()) wallPanel3D.close();
        currentMode = newMode;
        wallPanel3D._currentModeLabel = newMode;
        if (reopenId) openDetail(reopenId);
        syncBarsVisibility();
    }

    wallPanel3D._onModeToggle = () => {
        const openId = wallPanel3D.currentId;
        if (!openId) return;
        wallPanel3D.close();
        currentMode = 'overlay';
        wallPanel3D._currentModeLabel = 'overlay';
        wallOverlay._lastOpenId = openId;
        wallOverlay.open(openId, lastValues);
        syncBarsVisibility();
    };

    wallOverlay._onModeToggle = () => {
        const openId = wallOverlay.currentId || wallOverlay._lastOpenId;
        if (!openId) return;
        wallOverlay.close();
        currentMode = '3d';
        wallPanel3D._currentModeLabel = '3d';
        wallPanel3D.open(openId, lastValues);
        syncBarsVisibility();
        const tankId = openId === 'brewkettle' ? null : parseInt(openId.replace('tank-',''),10);
        const wallX  = openId === 'brewkettle'
            ? (model.getCenterWorldPos?.('brewkettle')?.x ?? -2)
            : (TANKS.find(t=>t.id===tankId)?.x ?? scene.wall.x);
        //Gleicher Uebersichtsflug wie beim direkten Tank-Klick im 3D-Modus,
        //damit der Panel-Kopf nicht abgeschnitten wird.
        scene.focusOn({ x: wallX, y: 30, z: scene.wall.z }, 95, true);
    };

    //Settings
    settings.on('viewChange', mode => applyViewMode(mode, model, labels3D));

    settings.on('settingChange', (key, val) => {
        if (key === 'showTempDigital') labels3D.setAllVisible(val);
        if (key === 'showTempBars')    syncBarsVisibility();
        if (key === 'showSollMarker')  bars3D?.setShowSoll(val);
        if (key === 'showBarLabels')   bars3D?.setShowLabels(val);
    });

    settings.on('projectionModeChange', mode => switchMode(mode));
    settings.on('thresholdChange', () => {});
    settings.on('barVariableChange', key => bars3D?.setVariable(key));

    settings.on('brewDaySelect', async day => {
        wallOverlay.close(); wallPanel3D.close();
        if (currentMode === 'overlay') {
            await wallOverlay.openBrewDay(day, lastValues);
            //Overlay-Modus: Kamera bleibt unveraendert.
        } else {
            await wallPanel3D.openBrewDay(day, lastValues);
            //Wand-3D-Modus: Uebersichtsflug zum Braukessel-Bereich.
            const pos = model.getCenterWorldPos?.('brewkettle');
            scene.focusOn({ x: pos?.x ?? scene.wall.x, y: 30, z: scene.wall.z }, 95, true);
        }
        syncBarsVisibility();
        labels3D.highlight?.('brewkettle');
    });

    //Klick
    scene.on('click', ({ id }) => {
        if (!id) { wallOverlay.close(); wallPanel3D.close(); return; }
        openDetail(id);
    });
    scene.on('dblclick', ({ id }) => {
        if (id) return;
        wallOverlay.close(); wallPanel3D.close();
        scene.focusOn({ x: 58, y: 18, z: 0 }, 110);
        labels3D.resetHighlight?.();
    });
    scene.on('hover', () => {});

    function openDetail(id) {
        const isKettle = id === 'brewkettle';
        const tankId   = isKettle ? null : parseInt(id.replace('tank-',''), 10);

        //X-Position des jeweiligen Tanks/Kessels auf der Wand
        const wallX = isKettle
            ? (model.getCenterWorldPos?.('brewkettle')?.x ?? -2)
            : (TANKS.find(t => t.id === tankId)?.x ?? scene.wall.x);

        wallOverlay.close(); wallPanel3D.close();
        if (currentMode === 'overlay') {
            wallOverlay._lastOpenId = id;
            wallOverlay.open(id, lastValues);
            //Overlay-Modus: Kamera bleibt bewusst UNVERAeNDERT - das Fenster
            //ist ein zentrales HTML-Overlay, ein Zoom lenkt nur ab.
        } else {
            wallPanel3D.open(id, lastValues);
            //Wand-3D-Modus: Uebersichtsflug zur Wand. Bewusst grosser Abstand,
            //damit der Kopfbereich des Panels sichtbar bleibt und Kessel+Tanks
            //weiterhin im Bild sind.
            scene.focusOn({ x: wallX, y: 30, z: scene.wall.z }, 95, true);
        }
        syncBarsVisibility();
        labels3D.highlight?.(id);
    }

    //AR
    document.getElementById('btn-ar-mode')?.addEventListener('click', () => {
        if (!arMode) { alert('AR-Modus nicht verfuegbar'); return; }
        wallOverlay.close(); wallPanel3D.close();
        arMode.start();
    });
    if (arMode) arMode.onClose(() => {});

    //Verbindung
    const connDot = document.getElementById('conn-dot');
    const connTxt = document.getElementById('conn-text');
    dataService.on('connection', state => {
        if (connDot) connDot.className = 'conn-dot conn-dot--' + ({ok:'ok',warn:'warn',crit:'crit'}[state]||'unknown');
        if (connTxt) connTxt.textContent = ({ok:'Live * Verbindung stabil',warn:'Instabil ...',crit:'Keine Verbindung'}[state]||'Verbinde ...');
    });
    dataService.on('unauthorized', () => setTimeout(() => location.href = 'login.php', 1000));

    setTimeout(() => document.getElementById('boot-overlay')?.classList.add('is-hidden'), 600);

    document.getElementById('btn-help')?.addEventListener('click', () => {
        const m = document.getElementById('help-modal'); if (m) m.hidden = false;
    });
    document.querySelectorAll('[data-close]').forEach(el =>
        el.addEventListener('click', () => el.closest('.modal')?.setAttribute('hidden', ''))
    );

    //Polling
    const varList = buildVarList();
    LOG(varList.length + ' Variablen');

    function applyLabels(v) {
        const s = settings.settings;
        const bkIst  = v[BREWKETTLE_VARS.ist]?.val;
        const bkSoll = v[BREWKETTLE_VARS.soll]?.val;
        const bkEin  = isActive(v[BREWKETTLE_VARS.ein]?.val);
        const bkStat = bkEin ? classifyStatus(bkIst, bkSoll, 'brewkettle') : 'idle';
        statusMap.set('brewkettle', bkStat);
        detailMap.set('brewkettle', {
            temp: bkIst, valveOpen: isActive(v[BREWKETTLE_VARS.heat]?.val) && bkEin,
            mode: isActive(v[BREWKETTLE_VARS.auto]?.val) ? 'auto' : 'hand',
        });
        if (s.showTempDigital) labels3D.setValue('brewkettle', bkIst != null ? bkIst.toFixed(1)+' C' : '--', s.showStatusColor ? bkStat : 'ok');

        TANKS.forEach(t => {
            const vt     = varsForTank(t.id);
            const ein    = isActive(v[vt.ein]?.val);
            const ist    = v[vt.ist]?.val;
            const soll   = v[vt.soll]?.val;
            const vent   = isActive(v[vt.ventil]?.val);
            const status = ein ? classifyStatus(ist, soll, 'tank') : 'idle';
            const mode   = ein ? (isActive(v[vt.auto]?.val) ? 'auto' : 'hand') : 'off';
            statusMap.set('tank-'+t.id, status);
            detailMap.set('tank-'+t.id, { temp: ist, valveOpen: vent && ein, mode });
            if (s.showTempDigital) labels3D.setValue('tank-'+t.id, ist != null ? ist.toFixed(1)+' C' : '--', s.showStatusColor ? status : 'ok');
            model.setTankMode?.(t.id, s.showModeBadge ? mode : 'off');
        });
    }

    async function poll() {
        try {
            const res = await dataService.fetchCurrent(varList);
            const v   = res.values || {};
            lastValues = v;
            applyLabels(v);
            settings.updateStatus(v);
            arMode?.setValues(v);
            if (currentMode === 'overlay') wallOverlay.updateLive(v);
            else wallPanel3D.updateLive(v);
            bars3D?.setValues(v);

            //Update-Timer in index.php benachrichtigen
            if (typeof window._onDataUpdate === 'function') {
                window._onDataUpdate(res.latest_ts || Date.now());
            }

            const ts  = res.latest_ts ? new Date(res.latest_ts) : null;
            const upd = document.getElementById('last-update');
            if (upd) upd.textContent = ts ? 'Daten * ' + ts.toLocaleTimeString('de-DE') : 'Daten * --';
        } catch (err) { WARN('Poll:', err.message || err); }
    }

    await poll();
    setInterval(poll, POLLING_INTERVAL_MS);

    //Initial settings - alles standardmaessig an
    const initS = settings.settings;
    if (!initS.showTempDigital) labels3D.setAllVisible(false);
    //Balkendiagramm respektiert die gespeicherte Einstellung; Soll-Marker
    //und Labels starten immer sichtbar.
    syncBarsVisibility();
    bars3D?.setShowSoll(true);
    bars3D?.setShowLabels(true);

    settings.loadBrewDays();
    LOG('Boot abgeschlossen (3D-Modus)');
}

function applyViewMode(mode, model, labels) {
    const showT = mode === 'all' || mode === 'tanks';
    const showK = mode === 'all' || mode === 'kettle';
    TANKS.forEach(t => {
        model.setVisible?.('tank-'+t.id, showT);
        labels.setVisible?.('tank-'+t.id, showT);
    });
    model.setVisible?.('brewkettle', showK);
    labels.setVisible?.('brewkettle', showK);
}

boot().catch(err => {
    console.error('[App] FATAL:', err);
    const el = document.getElementById('boot-overlay');
    if (el) {
        el.classList.remove('is-hidden');
        el.innerHTML = '<div style="color:#e2533b;text-align:center;max-width:520px;padding:28px;font-family:monospace">'
            + '<h2 style="font-size:18px;margin-bottom:8px">Start fehlgeschlagen</h2>'
            + '<p style="font-size:13px;color:#b9b3a7;margin-bottom:12px">' + (err.message || err) + '</p>'
            + '<pre style="font-size:10px;color:#7a7060;text-align:left;white-space:pre-wrap">' + (err.stack||'') + '</pre>'
            + '</div>';
    }
});