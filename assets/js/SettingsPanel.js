/**
 * SettingsPanel v5
 * -------------------------------------------------------
 * Aenderungen:
 *  - Brautage-Logik intern erhalten (loadBrewDays/selectBrewDay),
 *    aber kein eigenes UI in der Sidebar mehr
 *  - Warn-Schwellen jetzt im externen Modal (thresholds-modal)
 *  - sp-tank-counts entfernt (existiert nicht mehr im DOM)
 *  - showTempBars / showSollMarker / showBarLabels default: true
 *  - update-Timer wird ueber window._onDataUpdate gemeldet
 */

console.log('=== SettingsPanel.js GELADEN ===');
import { dataService } from './dataService.js';
import { TANKS, BREWKETTLE_VARS, varsForTank, THRESHOLDS } from './config.js';

function isActive(v) { return v != null && +v > 0.5; }
function classifyStatus(ist, soll, kind) {
    if (ist == null || soll == null) return 'idle';
    const delta = Math.abs(ist - soll);
    const warn = kind === 'brewkettle' ? 3 : 2;
    const crit = kind === 'brewkettle' ? 8 : 5;
    return delta >= crit ? 'crit' : delta >= warn ? 'warn' : 'ok';
}

const LOG  = (m, ...a) => console.log('[SettingsPanel]', m, ...a);
const WARN = (m, ...a) => console.warn('[SettingsPanel]', m, ...a);

const SETTING_KEYS = ['showTempDigital','showStatusColor','showModeBadge','showVentilFlow','showTempBars','showSollMarker','showBarLabels'];

const SETTING_DEFAULTS = {
    showTempDigital: true,
    showStatusColor: true,
    showModeBadge:   true,
    showVentilFlow:  true,
    //Balken immer standardmaessig an
    showTempBars:    true,
    showSollMarker:  true,
    showBarLabels:   true,
};

export class SettingsPanel {
    constructor(rootSelector = '#settings-panel') {
        this.root = document.querySelector(rootSelector);
        if (!this.root) throw new Error(`SettingsPanel: '${rootSelector}' nicht gefunden`);

        this._handlers = {};
        this._viewMode = 'all';  //Ansicht immer "Alle" - kein UI-Toggle mehr
        this._projMode = 'overlay';
        this._settings = this._loadSettings();
        this._brewDays = [];

        requestAnimationFrame(() => {
            this._bindPanelToggle();
            this._bindViewFilter();
            this._bindProjectionButtons();
            this._bindSettingToggles();
            this._bindThresholds();
            this._bindBarModeButtons();
            this._bindThresholdsModalBtn();
            this._applySettingsToUI();
            this._applyThresholdsToUI();

            LOG('Bereit', {
                toggles:   SETTING_KEYS.length,
                thrInputs: document.querySelectorAll('[data-thr]').length,
            });
        });
    }

    on(ev, cb) { (this._handlers[ev] ||= []).push(cb); return this; }
    _emit(ev, ...args) { (this._handlers[ev] || []).forEach(cb => cb(...args)); }

    get settings()  { return { ...this._settings }; }
    get viewMode()  { return this._viewMode; }
    get projMode()  { return this._projMode; }

    // ---- Status-Update (vom Poll-Loop) ----
    updateStatus(values) {
        //Update-Timer in index.php benachrichtigen
        if (typeof window._onDataUpdate === 'function') {
            window._onDataUpdate(Date.now());
        }

        const aktiv = isActive(values[BREWKETTLE_VARS.aktiv]?.val);
        const pill  = document.getElementById('sp-brewery-status');
        if (pill) {
            pill.className   = `sp-status-pill sp-status-pill--${aktiv ? 'ok' : 'idle'}`;
            pill.textContent = aktiv ? 'Brauerei aktiv' : 'Inaktiv';
        }
        //Tank-Uebersicht und Fleet-Stats wurden aus der Sidebar entfernt.
        //Berechnungen werden hier nicht mehr benoetigt.
    }

    // ---- Brautage (intern erhalten, kein Sidebar-UI) ----
    async loadBrewDays(forceRefresh = false) {
        if (this._brewDays.length && !forceRefresh) return;
        try {
            LOG('Lade Brautage ...');
            const res = await dataService._request({ action: 'brew_days', limitDays: 90 });
            this._brewDays = res.brew_days || [];
            LOG(`${this._brewDays.length} Brautage geladen`);
        } catch (err) {
            WARN('Brautage:', err);
        }
    }

    selectBrewDay(date) {
        //Kein Sidebar-UI mehr - nur interne Markierung fuer openDetail
        this._selectedBrewDate = date;
    }

    // ---- Private Bindings ----

    _bindPanelToggle() {
        const btn  = document.getElementById('btn-settings-toggle');
        const body = document.getElementById('settings-body');
        if (!btn || !body) { WARN('Panel-Toggle nicht gefunden'); return; }

        const sync = () => {
            const open = !body.hidden;
            btn.setAttribute('aria-expanded', String(open));
            btn.classList.toggle('is-active', open);
        };
        sync();

        btn.addEventListener('click', () => {
            body.hidden = !body.hidden;
            sync();
        });
    }

    _bindViewFilter() {
        //Ansichts-Filter wurde aus der Sidebar entfernt.
        //Ansicht ist dauerhaft auf "all" fixiert.
    }

    _bindProjectionButtons() {
        this.root.addEventListener('click', e => {
            const btn = e.target.closest('.proj-btn');
            if (!btn?.dataset.proj) return;
            const mode = btn.dataset.proj;
            if (mode === this._projMode) return;
            this._projMode = mode;
            this.root.querySelectorAll('.proj-btn').forEach(b =>
                b.classList.toggle('is-active', b === btn));
            const hint = document.getElementById('proj-hint');
            if (hint) hint.textContent = mode === '3d'
                ? 'Auf der 3D-Wand - beim Wegbewegen verschwindet es'
                : 'Zentriertes Overlay-Fenster';
            this._emit('projectionModeChange', mode);
        });
    }

    _bindSettingToggles() {
        SETTING_KEYS.forEach(key => {
            const el = document.getElementById(`set-${key}`);
            if (!el) return;
            el.addEventListener('change', () => {
                this._settings[key] = el.checked;
                this._saveSettings();
                this._emit('settingChange', key, el.checked);
            });
        });
    }

    //Schwellen-Inputs koennen jetzt im Modal liegen - document-weite Suche
    _bindThresholds() {
        document.querySelectorAll('[data-thr]').forEach(input => {
            input.addEventListener('change', () => {
                const [kind, field] = input.dataset.thr.split('.');
                let val = parseFloat(input.value);
                if (Number.isNaN(val)) return;

                if (field === 'deltaCrit') {
                    const warnEl  = document.querySelector(`[data-thr="${kind}.deltaWarn"]`);
                    const warnVal = parseFloat(warnEl?.value ?? 0);
                    if (val <= warnVal) { val = +(warnVal + 0.5).toFixed(1); input.value = val; }
                }
                if (field === 'deltaWarn') {
                    const critEl  = document.querySelector(`[data-thr="${kind}.deltaCrit"]`);
                    const critVal = parseFloat(critEl?.value ?? 99);
                    if (val >= critVal) { val = +(critVal - 0.5).toFixed(1); input.value = val; }
                }

                if (THRESHOLDS[kind]) {
                    THRESHOLDS[kind][field] = val;
                    this._saveThresholds();
                    this._emit('thresholdChange', kind, field, val);
                }
            });
        });
        LOG(`${document.querySelectorAll('[data-thr]').length} Schwellen gebunden`);
    }

    //Schwellen-Modal oeffnen/schliessen (Button ist in index.php definiert,
    //aber hier binden wir ihn zusaetzlich falls er noch nicht gebunden ist)
    _bindThresholdsModalBtn() {
        const btn   = document.getElementById('btn-open-thresholds');
        const modal = document.getElementById('thresholds-modal');
        if (btn && modal) {
            btn.addEventListener('click', () => { modal.hidden = false; });
        }
    }

    _bindBarModeButtons() {
        const sel = document.getElementById('bar-variable-select');
        if (sel) {
            sel.addEventListener('change', () => {
                this._emit('barVariableChange', sel.value);
            });
        }
    }

    _applySettingsToUI() {
        SETTING_KEYS.forEach(key => {
            const el = document.getElementById(`set-${key}`);
            if (el) el.checked = this._settings[key];
        });
    }

    _applyThresholdsToUI() {
        document.querySelectorAll('[data-thr]').forEach(input => {
            const [kind, field] = input.dataset.thr.split('.');
            const val = THRESHOLDS[kind]?.[field];
            if (val != null) input.value = val;
        });
    }

    _loadSettings() {
        try { return { ...SETTING_DEFAULTS, ...JSON.parse(localStorage.getItem('brauerei-ar') || '{}') }; }
        catch { return { ...SETTING_DEFAULTS }; }
    }
    _saveSettings() {
        try { localStorage.setItem('brauerei-ar', JSON.stringify(this._settings)); } catch {}
    }
    _saveThresholds() {
        try {
            const d = {};
            ['tank','brewkettle'].forEach(k => { d[k] = { ...THRESHOLDS[k] }; });
            localStorage.setItem('brauerei-thr', JSON.stringify(d));
        } catch {}
    }
}