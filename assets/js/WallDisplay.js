/**
 * WallDisplay * Wand-Projektion v3
 * --------------------------------------------------------------
 * Zwei Modi:
 *
 *   'overlay'  - klassisches position:fixed Fenster (Standard)
 *
 *   '3d'       -> wird von WallPanel3D gehandhabt (CanvasTexture auf PlaneGeometry)
 *               WallDisplay selbst ist immer im Overlay-Modus.
 *
 * Verwendung:
 *   const wall = new WallDisplay('#wall-display', scene);
 *   wall.setProjectionMode('3d');
 */

import { dataService }    from './dataService.js';
import { varsForTank, BREWKETTLE_VARS, classifyStatus } from './config.js';

// Lokal definiert (kompatibel mit alter und neuer config.js)
function isActive(v) { return v != null && +v > 0.5; }

const TANK_ROLE_META = {
    ist:    { label:'Ist-Temp.',      type:'float', unit:'GradC', desc:'Gemessene Temperatur' },
    soll:   { label:'Soll-Temp.',     type:'float', unit:'GradC', desc:'Zieltemperatur' },
    ein:    { label:'Kuehlregelung',  type:'bool',  trueText:'Aktiv',       falseText:'Inaktiv',    desc:'Kuehlsteuerung' },
    auto:   { label:'Modus',          type:'bool',  trueText:'Auto',        falseText:'Manuell',    desc:'Regelungs-Modus' },
    ventil: { label:'Auslass-Ventil', type:'bool',  trueText:'Offen',       falseText:'Geschlossen',desc:'Ventilzustand' },
    hand:   { label:'Hand-Ventil',    type:'bool',  trueText:'An',          falseText:'Aus',        desc:'Manuelles Override' },
};
const BK_ROLE_META = {
    ist:    { label:'Ist-Temp.',       type:'float', unit:'GradC', desc:'Kesseltemperatur' },
    soll:   { label:'Soll-Temp.',      type:'float', unit:'GradC', desc:'Zieltemperatur' },
    ein:    { label:'Kesselsteuerung', type:'bool', trueText:'Aktiv', falseText:'Inaktiv', desc:'Steuerung' },
    auto:   { label:'Modus',           type:'bool', trueText:'Auto',  falseText:'Manuell', desc:'Regelungs-Modus' },
    heat:   { label:'Ausg. Heizung',   type:'bool', trueText:'An',    falseText:'Aus',     desc:'Heizelement' },
};

const LOG  = (m, ...a) => console.log('[WallDisplay]', m, ...a);
const WARN = (m, ...a) => console.warn('[WallDisplay]', m, ...a);

const RANGES = [
    { key: '1h',     label: '1 Std',     maxPoints: 360 },
    { key: '6h',     label: '6 Std',     maxPoints: 480 },
    { key: '1d',     label: 'Tag',       maxPoints: 600 },
    { key: '1w',     label: 'Woche',     maxPoints: 900 },
    { key: '1m',     label: 'Monat',     maxPoints: 900 },
    { key: 'custom', label: 'Zeitraum...', maxPoints: 900 },
];

export class WallDisplay {
    /**
     * @param {string}      rootSelector  CSS-Selektor fuer #wall-display
     * @param {Scene|null}  scene         Scene-Instanz (fuer 3D-Modus)
     */
    constructor(rootSelector = '#wall-display', scene = null) {
        this.root = document.querySelector(rootSelector);
        if (!this.root) throw new Error('WallDisplay: #wall-display nicht gefunden');

        this._scene         = scene;
        this.currentId      = null;
        this._range         = '1d';
        this._customFrom    = null;
        this._customTo      = null;
        this._activeTab     = 'series';
        this._chart         = null;
        this._refreshTimer  = null;
        this._escHandler    = null;
        this._closeHandlers = [];
        this._brewDayData   = null;
        this._projMode      = 'overlay';
        this._lastIst       = null;

        this._bindClose();
        LOG('Initialisiert (mode=overlay)');
    }

    onClose(cb) { this._closeHandlers.push(cb); }
    isOpen()    { return this.currentId !== null; }

    // ----------------------------------------------------------------
    // Projektionsmodus
    // ----------------------------------------------------------------

    /**
     * Modus wechseln - kann jederzeit (auch wenn Display offen) aufgerufen werden.
     * @param {'overlay'|'3d'} mode
     */
    /**
     * Im WallDisplay gibt es nur noch 'overlay'.
     * '3d' wird komplett durch WallPanel3D (separate Klasse) gehandhabt.
     * Diese Methode ist ein No-Op - die Umschaltung macht app.js.
     */
    setProjectionMode(mode) {
        LOG(`Modus '${mode}' - WallDisplay ist immer Overlay, 3D via WallPanel3D`);
    }

    // ----------------------------------------------------------------
    // Oeffnen / Schliessen
    // ----------------------------------------------------------------

    async open(interactiveId, liveValues = {}) {
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
        this.currentId   = interactiveId;
        this._range      = '1d';
        this._customFrom = null;
        this._customTo   = null;
        this._activeTab  = 'series';
        this._brewDayData = null;
        this._lastIst    = null;

        LOG('Oeffne:', interactiveId, '| Mode:', this._projMode);

        this._renderHead(interactiveId, liveValues);
        this._renderTabs(interactiveId);
        this._renderSeriesBody(interactiveId, liveValues);

        // Sichtbar machen VOR dem CSS3D-Anheften
        this.root.hidden = false;

        document.addEventListener('keydown', this._escHandler = e => {
            if (e.key === 'Escape' && this.isOpen()) this.close();
        });

        await this._loadSeries(interactiveId);

        this._refreshTimer = setInterval(() => {
            if (this.currentId === interactiveId && this._activeTab === 'series')
                this._loadSeries(interactiveId);
        }, 15_000);
    }

    close() {
        LOG('Schliesse:', this.currentId);

        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
        if (this._escHandler) { document.removeEventListener('keydown', this._escHandler); this._escHandler = null; }
        if (this._chart) { this._chart.destroy(); this._chart = null; }

        this.root.hidden = true;
        this.currentId   = null;
        this._lastIst    = null;

        this._closeHandlers.forEach(cb => cb());
    }

    async openBrewDay(day, currentValues = {}) {
        if (this.currentId !== 'brewkettle') {
            await this.open('brewkettle', currentValues);
        }
        this._pumpBodyActive = false;
        this._switchTab('brewdays');
        await this._loadBrewDaySession(day);
    }

    // ----------------------------------------------------------------
    // Live-Update
    // ----------------------------------------------------------------

    updateLive(values) {
        if (!this.isOpen()) return;
        const id = this.currentId;

        // Alle Werte speichern (fuer Pumpen-Tab-Refresh)
        this._lastPumpValues = values;

        // Pumpen-Tab: bei aktivem Tab einfach neu rendern
        if (this._activeTab === 'pumps' && this._pumpBodyActive) {
            this._renderPumpsBody();
            return;
        }
        this._pumpBodyActive = false;

        if (id === 'brewkettle') {
            // Direkte DB-Variablennamen verwenden (BK_Ist ohne T-Suffix)
            const istVal  = values['BK_Ist']?.val;
            const sollVal = values['BK_Soll']?.val;
            const heatVal = values['BK_A_H']?.val;
            const autoVal = values['BK_Auto']?.val;
            const einVal  = values['BK_Ein']?.val;

            this._setMetricFmt('ist',  istVal,  BK_ROLE_META.ist);
            this._setMetricFmt('soll', sollVal, BK_ROLE_META.soll);
            this._setMetricFmt('heat', heatVal, BK_ROLE_META.heat);
            this._setMetricFmt('auto', autoVal, BK_ROLE_META.auto);
            this._setMetricFmt('ein',  einVal,  BK_ROLE_META.ein);
            this._updateTrend(istVal);

            const st = isActive(einVal) ? classifyStatus(istVal, sollVal, 'brewkettle') : 'idle';
            this._setStatusBadge(st);
            this._setRegBar(isActive(heatVal) && isActive(einVal), 'Heizung', heatVal);

        } else if (id.startsWith('tank-')) {
            const tankId  = parseInt(id.replace('tank-', ''), 10);
            const v       = varsForTank(tankId);
            const istVal  = values[v.ist]?.val;
            const sollVal = values[v.soll]?.val;
            const ventVal = values[v.ventil]?.val;
            const einVal  = values[v.ein]?.val;
            const autoVal = values[v.auto]?.val;
            const handVal = values[v.hand]?.val;

            this._setMetricFmt('ist',  istVal,  TANK_ROLE_META.ist);
            this._setMetricFmt('soll', sollVal, TANK_ROLE_META.soll);
            this._setMetricFmt('ein',  einVal,  TANK_ROLE_META.ein);
            this._setMetricFmt('auto', autoVal, TANK_ROLE_META.auto);
            this._setMetricFmt('vent', ventVal, TANK_ROLE_META.ventil);
            this._setMetricFmt('hand', handVal, TANK_ROLE_META.hand);
            this._updateTrend(istVal, sollVal);

            // Hand-Ventil: dimmen wenn nicht relevant
            const handRelevant = isActive(einVal) && !isActive(autoVal);
            const handBox = this.root.querySelector('[data-metric="hand"]')?.closest('.wd-metric');
            if (handBox) {
                handBox.classList.toggle('is-dimmed', !handRelevant);
                const note = handBox.querySelector('.wd-metric-note');
                if (note) note.textContent = handRelevant ? '' : 'Nur im Manuell-Modus';
            }

            // _ Soll
            const deltaEl = this.root.querySelector('#wd-delta');
            if (deltaEl && istVal != null && sollVal != null) {
                const d = istVal - sollVal;
                deltaEl.textContent = `_ ${d >= 0 ? '+' : ''}${d.toFixed(1)}  GradC`;
                deltaEl.style.color = Math.abs(d) > 5 ? '#e2533b' :
                                      Math.abs(d) > 2 ? '#f0b73f' : 'rgba(255,255,255,0.35)';
            }

            const kuehlAktiv = isActive(einVal);
            this._setStatusBadge(kuehlAktiv ? classifyStatus(istVal, sollVal, 'tank') : 'idle');
            this._setRegBar(isActive(ventVal) && kuehlAktiv, 'Kuehlventil', ventVal);
        }
    }

    _updateTrend(istVal) {
        const trendEl = this.root.querySelector('#wd-trend');
        if (!trendEl || istVal == null) return;
        const prev = this._lastIst;
        this._lastIst = istVal;
        if (prev == null) return;
        const delta = istVal - prev;
        if (Math.abs(delta) < 0.05) {
            trendEl.textContent = '->'; trendEl.style.color = 'rgba(255,255,255,0.4)';
        } else if (delta > 0) {
            trendEl.textContent = '^'; trendEl.style.color = '#e2533b';
        } else {
            trendEl.textContent = 'v'; trendEl.style.color = '#4db8ff';
        }
    }


    // ----------------------------------------------------------------
    // Vergleichs-Ansicht (alle Tanks auf einem Chart)
    // ----------------------------------------------------------------

    /**
     * Oeffnet den Vergleichs-Chart mit allen Tanks.
     * @param {Array}  tanks       TANKS-Array aus config.js
     * @param {object} liveValues  aktuelle Poll-Werte
     */
    async openComparison(tanks, liveValues = {}) {
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
        this.currentId   = '__comparison__';
        this._activeTab  = 'comparison';
        this._range      = '1d';
        this._customFrom = null;
        this._customTo   = null;
        this._lastIst    = null;

        LOG('Oeffne Vergleichs-Chart');
        this._renderComparisonHead(tanks, liveValues);
        this.root.hidden = false;

        document.addEventListener('keydown', this._escHandler = e => {
            if (e.key === 'Escape' && this.isOpen()) this.close();
        });

        await this._loadComparisonSeries(tanks);

        this._refreshTimer = setInterval(() => {
            if (this.currentId === '__comparison__')
                this._loadComparisonSeries(tanks);
        }, 20_000);
    }

    _renderComparisonHead(tanks, liveValues) {
        const head = document.getElementById('wd-head');
        if (!head) return;
        head.innerHTML = `
            <div class="wd-icon" style="font-size:13px">T1-T6</div>
            <div class="wd-title-area">
                <div class="wd-eyebrow">Gaerkeller * Uebersicht</div>
                <div class="wd-title-text">Alle Kuehltanks * Vergleich</div>
            </div>
            <button class="wd-close" id="wd-close-btn" aria-label="Schliessen">x</button>
        `;
        head.querySelector('#wd-close-btn').addEventListener('click', () => this.close());

        const tabs = document.getElementById('wd-tabs');
        if (tabs) tabs.hidden = true;

        const body = document.getElementById('wd-body');
        if (!body) return;

        // Zeige aktuelle Werte als Tabelle oben
        const { varsForTank, isActive, classifyStatus } = window._brewConfig || {};
        const rows = tanks.map(t => {
            const v   = (window._brewConfig?.varsForTank || (() => ({})))(t.id);
            const ist = liveValues[v.ist]?.val;
            const sol = liveValues[v.soll]?.val;
            const on  = isActive ? isActive(liveValues[v.ein]?.val) : false;
            const s   = on && ist != null ? (classifyStatus ? classifyStatus(ist, sol, 'tank') : 'ok') : 'idle';
            const stColor = { ok:'#5ee8a0', warn:'#f0b73f', crit:'#e2533b', idle:'#5d6b78' }[s] || '#5d6b78';
            const delta = (ist != null && sol != null) ? ist - sol : null;
            return `<tr>
                <td><span style="color:${stColor}">_</span> T${t.id}</td>
                <td style="font-family:var(--font-mono);color:#c87341">${ist != null ? ist.toFixed(1)+'  GradC' : '--'}</td>
                <td style="font-family:var(--font-mono);color:#7bc9ff">${sol != null ? sol.toFixed(1)+'  GradC' : '--'}</td>
                <td style="font-family:var(--font-mono);color:${delta!=null&&Math.abs(delta)>3?'#f0b73f':'rgba(255,255,255,0.4)'}">${delta!=null?(delta>=0?'+':'')+delta.toFixed(1)+'  GradC':'--'}</td>
                <td style="color:${stColor}">${on?'Aktiv':'Aus'}</td>
            </tr>`;
        }).join('');

        const rangesHtml = RANGES.map(r =>
            `<button class="wd-range-btn${r.key === this._range ? ' is-active' : ''}" data-range="${r.key}">${r.label}</button>`
        ).join('');

        body.innerHTML = `
            <div class="wd-comparison-table-wrap">
                <table class="wd-comparison-table">
                    <thead>
                        <tr><th>Tank</th><th>Ist</th><th>Soll</th><th>_ Soll</th><th>Status</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="wd-range" style="margin-top:0">
                <span class="wd-range-label">Zeitraum</span>
                ${rangesHtml}
            </div>
            <div class="wd-custom-range" id="wd-custom-range" style="display:none">
                <label class="wd-date-label">Von <input type="date" id="wd-from" class="wd-date-input"></label>
                <label class="wd-date-label">Bis <input type="date" id="wd-to" class="wd-date-input"></label>
                <button class="wd-range-btn wd-date-apply" id="wd-date-apply">Laden</button>
            </div>
            <div class="wd-chart-wrap">
                <div class="wd-chart-head">
                    <h4>Temperaturverlaeufe * Alle Kuehltanks</h4>
                    <div class="wd-chart-legend" id="wd-comp-legend"></div>
                    <button class="wd-export-btn" id="wd-export-csv" title="Chart-Daten als CSV exportieren">_ CSV</button>
                </div>
                <canvas class="chart-canvas" id="wd-canvas"></canvas>
            </div>
            <div class="wd-stats-bar" id="wd-stats-bar" style="display:none"></div>
        `;

        body.querySelectorAll('.wd-range-btn[data-range]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._range = btn.dataset.range;
                body.querySelectorAll('.wd-range-btn[data-range]').forEach(b =>
                    b.classList.toggle('is-active', b === btn));
                const customDiv = document.getElementById('wd-custom-range');
                if (customDiv) customDiv.style.display = this._range === 'custom' ? 'flex' : 'none';
                if (this._range !== 'custom') this._loadComparisonSeries(tanks);
            });
        });

        document.getElementById('wd-date-apply')?.addEventListener('click', () => {
            const from = document.getElementById('wd-from')?.value;
            const to   = document.getElementById('wd-to')?.value;
            if (from && to) {
                this._customFrom = new Date(from).getTime();
                this._customTo   = new Date(to + 'T23:59:59').getTime();
                this._loadComparisonSeries(tanks);
            }
        });

        if (this._chart) this._chart.destroy();
        const canvas = document.getElementById('wd-canvas');
        if (canvas) this._chart = new WallChart(canvas);
    }

    async _loadComparisonSeries(tanks) {
        if (!this._chart) return;
        this._chart.showLoading();

        // Alle Tank Ist-Temperaturen auf einmal holen
        const istNames  = tanks.map(t => varsForTank(t.id).ist);
        const sollNames = tanks.map(t => varsForTank(t.id).soll);
        const allNames  = [...istNames, ...sollNames];

        const opts = { maxPoints: 900 };
        if (this._range === 'custom' && this._customFrom && this._customTo) {
            opts.from = this._customFrom; opts.to = this._customTo;
        } else {
            opts.range = this._range;
        }

        try {
            const res  = await dataService.fetchSeries(allNames, opts);
            const find = n => res.series.find(s => s.name === n)?.data || [];

            const seriesData = tanks.map(t => {
                const v = varsForTank(t.id);
                return { label: `T${t.id}`, ist: find(v.ist), soll: find(v.soll) };
            });

            // Legende generieren
            const legend = document.getElementById('wd-comp-legend');
            if (legend) {
                legend.innerHTML = COMP_COLORS.slice(0, tanks.length).map((c, i) =>
                    `<span><i style="background:${c}"></i> T${tanks[i].id}</span>`
                ).join('');
            }

            this._chart.renderComparison(seriesData);
            this._comparisonData = seriesData;  // fuer CSV-Export

            // Statistiken berechnen
            this._showComparisonStats(seriesData);

            // CSV-Export
            document.getElementById('wd-export-csv')?.addEventListener('click', () => {
                this._exportCSV(seriesData);
            });

        } catch (err) {
            this._chart?.showError();
            WARN('Vergleichs-Daten:', err);
        }
    }

    _showComparisonStats(seriesData) {
        const bar = document.getElementById('wd-stats-bar');
        if (!bar) return;
        const stats = seriesData.map(s => {
            const vals = s.ist.map(p => p[1]).filter(v => v != null);
            if (!vals.length) return { label: s.label, min: null, max: null, avg: null, stddev: null };
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            const avg = vals.reduce((a,v)=>a+v,0) / vals.length;
            const sd  = Math.sqrt(vals.reduce((a,v)=>a+(v-avg)**2,0) / vals.length);
            return { label: s.label, min, max, avg, sd };
        });

        bar.style.display = 'flex';
        bar.innerHTML = stats.map((s, i) => `
            <div class="wd-stat-item">
                <div class="wd-stat-label" style="color:${COMP_COLORS[i]}">${s.label}</div>
                <div class="wd-stat-vals">
                    <span title="Minimum">v${s.min != null ? s.min.toFixed(1) : '--'} Grad</span>
                    <span title="Durchschnitt" style="color:rgba(255,255,255,0.6)">_${s.avg != null ? s.avg.toFixed(1) : '--'} Grad</span>
                    <span title="Maximum">^${s.max != null ? s.max.toFixed(1) : '--'} Grad</span>
                    <span title="Standardabweichung" style="color:rgba(255,255,255,0.35)">sigma${s.sd != null ? s.sd.toFixed(2) : '--'}</span>
                </div>
            </div>
        `).join('');
    }

    _exportCSV(seriesData) {
        // Alle Zeitstempel sammeln
        const tsSet = new Set();
        seriesData.forEach(s => s.ist.forEach(p => tsSet.add(p[0])));
        const timestamps = Array.from(tsSet).sort((a,b) => a-b);

        const headers = ['Zeitstempel', ...seriesData.map(s => `${s.label}_Ist_ GradC`),
                                         ...seriesData.map(s => `${s.label}_Soll_ GradC`)];

        const rows = timestamps.map(ts => {
            const row = [new Date(ts).toLocaleString('de-DE')];
            seriesData.forEach(s => {
                const p = s.ist.find(p => p[0] === ts);
                row.push(p != null ? p[1].toFixed(2) : '');
            });
            seriesData.forEach(s => {
                const p = s.soll.find(p => p[0] === ts);
                row.push(p != null ? p[1].toFixed(2) : '');
            });
            return row.join(';');
        });

        const csv  = [headers.join(';'), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `brauerei_vergleich_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        LOG('CSV exportiert:', timestamps.length, 'Punkte');
    }

    // ----------------------------------------------------------------
    // Render-Methoden
    // ----------------------------------------------------------------

    _renderHead(id, values) {
        const head = document.getElementById('wd-head');
        if (!head) return;
        const isKettle = id === 'brewkettle';
        const tankId   = isKettle ? null : parseInt(id.replace('tank-', ''), 10);
        const iconText = isKettle ? 'BK' : `T${tankId}`;
        const eyebrow  = isKettle ? 'Brauanlage * Kernprozess' : 'Gaerkeller * Regelung';
        const title    = isKettle ? 'Braukessel' : `Kuehltank ${tankId}`;

        head.innerHTML = `
            <div class="wd-icon">${iconText}</div>
            <div class="wd-title-area">
                <div class="wd-eyebrow">${eyebrow}</div>
                <div class="wd-title-text">${title}
                    <span id="wd-trend" class="wd-trend-arrow">--</span>
                    <span id="wd-delta" class="wd-delta"></span>
                </div>
            </div>
            <span class="wd-status-badge idle" id="wd-status-badge">--</span>
            <button class="wd-mode-toggle" id="wd-mode-toggle-btn" title="Zu Wand 3D wechseln">&#9635; Wand 3D</button>
            <button class="wd-close" id="wd-close-btn" aria-label="Schliessen">x</button>
        `;
        head.querySelector('#wd-close-btn').addEventListener('click', () => this.close());
        head.querySelector('#wd-mode-toggle-btn').addEventListener('click', () => {
            if (this._onModeToggle) this._onModeToggle();
        });
    }

    _renderTabs(id) {
        const tabs = document.getElementById('wd-tabs');
        if (!tabs) return;
        const isKettle = id === 'brewkettle';
        tabs.hidden = !isKettle;
        if (isKettle) {
            tabs.querySelectorAll('.wd-tab').forEach(t =>
                t.classList.toggle('is-active', t.dataset.tab === 'series'));
            if (!tabs._listenerBound) {
                tabs._listenerBound = true;
                tabs.addEventListener('click', e => {
                    const tab = e.target.closest('.wd-tab');
                    if (!tab) return;
                    this._switchTab(tab.dataset.tab);
                });
            }
        }
    }

    _switchTab(tab) {
        this._activeTab = tab;
        LOG('Tab ->', tab);
        document.querySelectorAll('.wd-tab').forEach(t =>
            t.classList.toggle('is-active', t.dataset.tab === tab));
        const body = document.getElementById('wd-body');
        if (!body) return;
        if (tab === 'series') {
            this._renderSeriesBody(this.currentId, {});
            this._loadSeries(this.currentId);
        } else if (tab === 'pumps') {
            this._renderPumpsBody();
        } else if (tab === 'brewdays') {
            this._renderBrewDaysBody();
        }
    }

    _renderSeriesBody(id, values) {
        const body = document.getElementById('wd-body');
        if (!body) return;
        const isKettle = id === 'brewkettle';

        const metricDefs = isKettle ? [
            { key: 'ist',  meta: BK_ROLE_META.ist,   cls: 'accent' },
            { key: 'soll', meta: BK_ROLE_META.soll,  cls: 'cool'   },
            { key: 'heat', meta: BK_ROLE_META.heat,  cls: ''       },
            { key: 'auto', meta: BK_ROLE_META.auto,  cls: ''       },
            { key: 'ein',  meta: BK_ROLE_META.ein,   cls: ''       },
        ] : [
            { key: 'ist',  meta: TANK_ROLE_META.ist,    cls: 'accent' },
            { key: 'soll', meta: TANK_ROLE_META.soll,   cls: 'cool'   },
            { key: 'ein',  meta: TANK_ROLE_META.ein,    cls: ''       },
            { key: 'auto', meta: TANK_ROLE_META.auto,   cls: ''       },
            { key: 'vent', meta: TANK_ROLE_META.ventil, cls: ''       },
            { key: 'hand', meta: TANK_ROLE_META.hand,   cls: ''       },
        ];

        const cols = metricDefs.length === 6 ? 3 : metricDefs.length === 5 ? 5 : 4;

        const metricsHtml = `
            <div class="wd-metrics" style="grid-template-columns:repeat(${cols},1fr)">
                ${metricDefs.map(({ key, meta, cls }) => `
                    <div class="wd-metric ${cls}" title="${meta.desc}">
                        <div class="lbl">${meta.label}</div>
                        <div class="val" data-metric="${key}">--</div>
                        <div class="wd-metric-note"></div>
                    </div>`).join('')}
            </div>`;

        const legendHtml = isKettle ? `
            <span><i style="background:#c87341"></i> Ist</span>
            <span><i style="background:#4d8bd1"></i> Soll</span>
            <span><i style="background:rgba(212,134,31,0.4)"></i> Heizung</span>
        ` : `
            <span><i style="background:#c87341"></i> Ist</span>
            <span><i style="background:#4d8bd1"></i> Soll</span>
            <span><i style="background:rgba(77,180,255,0.3)"></i> Ventil</span>
        `;

        const rangesHtml = RANGES.map(r =>
            `<button class="wd-range-btn${r.key === this._range ? ' is-active' : ''}" data-range="${r.key}">${r.label}</button>`
        ).join('');

        // Benutzerdefinierter Zeitraum
        const today   = new Date().toISOString().slice(0, 10);
        const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
        const customDisplay = this._range === 'custom' ? 'flex' : 'none';

        body.innerHTML = `
            ${metricsHtml}
            <div class="wd-reg-bar" id="wd-reg-bar">
                <span class="wd-reg-dot"></span>
                <span id="wd-reg-text" style="flex:1">--</span>
                <span id="wd-reg-sub" style="font-family:var(--font-mono);font-size:12px;color:rgba(255,255,255,0.35)"></span>
            </div>
            <div class="wd-range">
                <span class="wd-range-label">Zeitraum</span>
                ${rangesHtml}
            </div>
            <div class="wd-custom-range" id="wd-custom-range" style="display:${customDisplay}">
                <label class="wd-date-label">Von
                    <input type="date" id="wd-from" value="${weekAgo}" max="${today}" class="wd-date-input">
                </label>
                <label class="wd-date-label">Bis
                    <input type="date" id="wd-to" value="${today}" max="${today}" class="wd-date-input">
                </label>
                <button class="wd-range-btn wd-date-apply" id="wd-date-apply">Laden</button>
            </div>
            <div class="wd-chart-wrap">
                <div class="wd-chart-head">
                    <h4>Verlauf * Regelung</h4>
                    <div class="wd-chart-legend">${legendHtml}</div>
                    <button class="wd-export-btn" id="wd-export-csv" title="Als CSV exportieren">_ CSV</button>
                </div>
                <canvas class="chart-canvas" id="wd-canvas"></canvas>
            </div>
            <div class="wd-stats-bar" id="wd-stats-bar" style="display:none"></div>
        `;

        // Range-Buttons binden
        body.querySelectorAll('.wd-range-btn[data-range]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._range = btn.dataset.range;
                body.querySelectorAll('.wd-range-btn[data-range]').forEach(b =>
                    b.classList.toggle('is-active', b === btn));
                const customDiv = document.getElementById('wd-custom-range');
                if (customDiv) customDiv.style.display = this._range === 'custom' ? 'flex' : 'none';
                if (this._range !== 'custom') this._loadSeries(this.currentId);
            });
        });

        // Benutzerdefiniert laden
        document.getElementById('wd-date-apply')?.addEventListener('click', () => {
            const from = document.getElementById('wd-from')?.value;
            const to   = document.getElementById('wd-to')?.value;
            if (from && to) {
                this._customFrom = new Date(from).getTime();
                this._customTo   = new Date(to + 'T23:59:59').getTime();
                LOG(`Benutzer-Zeitraum: ${from} -> ${to}`);
                this._loadSeries(this.currentId);
            } else {
                WARN('Datum unvollstaendig');
            }
        });

        if (this._chart) this._chart.destroy();
        const canvas = document.getElementById('wd-canvas');
        if (canvas) this._chart = new WallChart(canvas);

        this.updateLive(values || {});
    }

    async _renderBrewDaysBody() {
        const body = document.getElementById('wd-body');
        if (!body) return;
        body.innerHTML = `<div class="wd-brewday-list">
            <div style="padding:30px;text-align:center;color:rgba(255,255,255,0.3)">Lade Brautage ...</div>
        </div>`;

        try {
            LOG('Lade Brautage ...');
            const res  = await dataService._request({ action: 'brew_days', limitDays: 90 });
            const days = res.brew_days || [];
            LOG(`${days.length} Brautage geladen`);
            const list = body.querySelector('.wd-brewday-list');

            if (!days.length) {
                list.innerHTML = `<div class="wd-bd-empty">
                    Keine Brautage gefunden.<br>
                    <small>Tipp: Pumpen-Daten muessen vorhanden sein.</small>
                </div>`;
                return;
            }

            list.innerHTML = days.map((d, idx) => `
                <div class="wd-bd-item" data-idx="${idx}">
                    <div class="wd-bd-meta">
                        <div class="wd-bd-date">${formatDateLong(d.date)}</div>
                        <div class="wd-bd-time">${formatTime(d.start_ms)} &ndash; ${formatTime(d.end_ms)}</div>
                        <div class="wd-bd-dur">${formatDuration(d.duration_min)}</div>
                    </div>
                    <div class="wd-bd-peak">${d.peak_temp != null ? d.peak_temp + ' &deg;C' : '--'}</div>
                    <div class="wd-bd-go">&rsaquo;</div>
                </div>
            `).join('');

            list.addEventListener('click', e => {
                const item = e.target.closest('.wd-bd-item');
                if (!item) return;
                const day = days[+item.dataset.idx];
                if (day) {
                    list.querySelectorAll('.wd-bd-item').forEach(el =>
                        el.classList.toggle('is-selected', el === item));
                    this._loadBrewDaySession(day);
                }
            });
        } catch (err) {
            const list = body.querySelector('.wd-brewday-list');
            if (list) list.innerHTML = '<div class="wd-bd-empty">Laden fehlgeschlagen.</div>';
            WARN('Brautage:', err);
        }
    }

    _renderPumpsBody() {
        const body = document.getElementById('wd-body');
        if (!body) return;
        const v = this._lastPumpValues || {};
        const pumpDefs = [
            { label: 'Pumpe 1 (P1)',           run: 'P1_Run',  val: 'P1_Val'  },
            { label: 'Kuehlwasserpumpe (CWP)', run: 'CWP_Run', val: 'CWP_Val' },
        ];
        const pumpHtml = pumpDefs.map(p => {
            const running = (v[p.run]?.val ?? 0) > 0.5;
            const flowVal = v[p.val]?.val;
            return `
            <div class="wd-pump-block wd-pump-block--${running ? 'ok' : 'idle'}">
                <div class="wd-pump-label">${p.label}</div>
                <div class="wd-pump-status">${running ? 'LAEUFT' : 'STOP'}</div>
                <div class="wd-pump-val">${flowVal != null ? flowVal.toFixed(0) + ' %' : '--'}</div>
                <div class="wd-pump-bar"><div class="wd-pump-fill" style="width:${running && flowVal != null ? Math.max(0,Math.min(100,flowVal)) : 0}%"></div></div>
            </div>`;
        }).join('');
        body.innerHTML = `
            <div class="wd-pumps-wrap">
                <div class="wd-section-title" style="padding:14px 18px 8px;font-size:11px;letter-spacing:0.12em;color:rgba(255,255,255,0.4);text-transform:uppercase">Pumpen</div>
                <div class="wd-pump-grid">${pumpHtml}</div>
            </div>`;
        this._pumpBodyActive = true;
    }

    async _loadBrewDaySession(day) {
        const body = document.getElementById('wd-body');
        if (!body) return;
        LOG('Lade Brautag-Detail:', day.date);

        body.innerHTML = `
            <div class="wd-session-back" id="wd-session-back"><- Zurueck</div>
            <div class="wd-session-stats">
                <div class="wd-session-stat"><div class="lbl">Datum</div><div class="val">${formatDateLong(day.date)}</div></div>
                <div class="wd-session-stat"><div class="lbl">Dauer</div><div class="val">${formatDuration(day.duration_min)}</div></div>
                <div class="wd-session-stat"><div class="lbl">Max</div><div class="val">${day.peak_temp != null ? day.peak_temp + '  GradC' : '--'}</div></div>
                <div class="wd-session-stat"><div class="lbl">_ Temp</div><div class="val">${day.avg_temp != null ? (+day.avg_temp).toFixed(1) + '  GradC' : '--'}</div></div>
            </div>
            <div class="wd-chart-wrap">
                <div class="wd-chart-head">
                    <h4>Verlauf * Heizphasen * ${day.date}</h4>
                    <div class="wd-chart-legend">
                        <span><i style="background:#c87341"></i> Ist</span>
                        <span><i style="background:#4d8bd1"></i> Soll</span>
                        <span><i style="background:rgba(212,134,31,0.4)"></i> Heizung</span>
                    </div>
                </div>
                <canvas class="chart-canvas" id="wd-canvas"></canvas>
            </div>
            <div class="wd-heating-phases" id="wd-phases">
                <h5>Heizphasen</h5>
                <div style="color:rgba(255,255,255,0.3);font-size:12px">Lade ...</div>
            </div>
        `;

        body.querySelector('#wd-session-back').addEventListener('click', () => this._renderBrewDaysBody());

        if (this._chart) this._chart.destroy();
        const canvas = document.getElementById('wd-canvas');
        if (canvas) this._chart = new WallChart(canvas);
        this._chart?.showLoading();

        try {
            const res  = await dataService._request({ action: 'brew_days', date: day.date });
            const find = n => res.series?.find(s => s.name === n)?.data || [];
            let ist  = find('BK_Ist');
            let soll = find('BK_Soll');
            let heat = find('BK_A_H');

            // Chart auf exakten Brauprozess-Zeitraum skalieren
            if (day.start_ms && day.end_ms) {
                const pad = 5 * 60_000;
                const from = day.start_ms - pad, to = day.end_ms + pad;
                const inRange = p => p[0] >= from && p[0] <= to;
                ist  = ist.filter(inRange);
                soll = soll.filter(inRange);
                heat = heat.filter(inRange);
            }
            LOG(`${day.date}: ${ist.length} Datenpunkte im Brauzeitraum`);
            this._chart?.render({ ist, soll, regul: heat, regulLabel: 'Heizung' });
            this._renderHeatingPhases(heat, ist);
        } catch (err) {
            this._chart?.showError();
            WARN('Brautag-Detail:', err);
        }
    }

    _renderHeatingPhases(heatData, istData) {
        const container = document.getElementById('wd-phases');
        if (!container || !heatData.length) return;

        const phases = [];
        let phaseStart = null;
        for (let i = 0; i < heatData.length; i++) {
            const [ts, val] = heatData[i];
            if (val > 0.5 && !phaseStart) {
                phaseStart = ts;
            } else if (val <= 0.5 && phaseStart) {
                const prev   = heatData[i - 1]?.[0] ?? ts;
                const durMin = Math.round((prev - phaseStart) / 60000);
                if (durMin >= 1) {
                    phases.push({
                        start:   phaseStart,
                        end:     prev,
                        durMin,
                        maxTemp: findMaxInRange(istData, phaseStart, prev),
                        avgTemp: findAvgInRange(istData, phaseStart, prev),
                    });
                }
                phaseStart = null;
            }
        }
        LOG(`${phases.length} Heizphasen erkannt`);

        if (!phases.length) {
            container.innerHTML = '<h5>Heizphasen</h5><div style="color:rgba(255,255,255,0.3);font-size:12px">Keine erkannt.</div>';
            return;
        }

        container.innerHTML = `
            <h5>Heizphasen (${phases.length})</h5>
            ${phases.map((p, i) => `
                <div class="wd-phase">
                    <div class="wd-phase-dot"></div>
                    <div class="wd-phase-time">Phase ${i+1} * ${formatTime(p.start)}</div>
                    <div class="wd-phase-dur">${p.durMin} min</div>
                    <div class="wd-phase-max">${p.maxTemp != null ? p.maxTemp.toFixed(1)+'  GradC max' : '--'}</div>
                    <div style="font-size:11px;color:rgba(255,255,255,0.35)">${p.avgTemp != null ? '_ '+p.avgTemp.toFixed(1)+' Grad' : ''}</div>
                </div>
            `).join('')}
        `;
    }


    _showSeriesStats(ist, soll) {
        const bar = document.getElementById('wd-stats-bar');
        if (!bar || !ist?.length) return;
        const vals = ist.map(p => p[1]).filter(v => v != null);
        if (!vals.length) return;
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const avg = vals.reduce((a,v)=>a+v,0) / vals.length;
        const sd  = Math.sqrt(vals.reduce((a,v)=>a+(v-avg)**2,0) / vals.length);
        const sollVals = (soll || []).map(p => p[1]).filter(v=>v!=null);
        const avgSoll  = sollVals.length ? sollVals.reduce((a,v)=>a+v,0)/sollVals.length : null;
        const avgDelta = avgSoll != null ? avg - avgSoll : null;
        bar.style.display = 'flex';
        bar.innerHTML = `
            <div class="wd-stat-item">
                <div class="wd-stat-label" style="color:rgba(255,255,255,0.4)">Ist-Verlauf</div>
                <div class="wd-stat-vals">
                    <span title="Minimum">v ${min.toFixed(1)}  GradC</span>
                    <span title="Durchschnitt" style="color:rgba(255,255,255,0.6)">_ ${avg.toFixed(1)}  GradC</span>
                    <span title="Maximum">^ ${max.toFixed(1)}  GradC</span>
                    <span title="Standardabweichung" style="color:rgba(255,255,255,0.35)">sigma ${sd.toFixed(2)}</span>
                    ${avgDelta != null ? '<span title="Durchschn. Abweichung vom Soll" style="color:'+
                        (Math.abs(avgDelta)>3?'#f0b73f':'rgba(255,255,255,0.35)')+'">'+
                        '_ _ ' + (avgDelta>=0?'+':'')+avgDelta.toFixed(1)+'  GradC</span>' : ''}
                </div>
            </div>
        `;
    }

    _exportSeriesCSV(id, data) {
        const isKettle = id === 'brewkettle';
        const { ist = [], soll = [], regul = [] } = data;
        const tsSet = new Set([...ist.map(p=>p[0]), ...soll.map(p=>p[0])]);
        const timestamps = Array.from(tsSet).sort((a,b)=>a-b);
        const label = isKettle ? 'Braukessel' : `Kuehltank_${id.replace('tank-','')}`;
        const reg   = isKettle ? 'Heizung_%' : 'Ventil_%';
        const headers = ['Zeitstempel', `${label}_Ist_ GradC`, `${label}_Soll_ GradC`, reg];
        const rows = timestamps.map(ts => {
            const pi = ist.find(p=>p[0]===ts);
            const ps = soll.find(p=>p[0]===ts);
            const pr = regul.find(p=>p[0]===ts);
            return [
                new Date(ts).toLocaleString('de-DE'),
                pi != null ? pi[1].toFixed(2) : '',
                ps != null ? ps[1].toFixed(2) : '',
                pr != null ? (pr[1]*100).toFixed(0) : '',
            ].join(';');
        });
        const csv  = [headers.join(';'), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `${label}_${this._range}_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        LOG('CSV exportiert:', timestamps.length, 'Punkte');
    }

    async _loadSeries(id) {
        if (!this._chart) return;
        const isKettle = id === 'brewkettle';
        const tankId   = isKettle ? null : parseInt(id.replace('tank-', ''), 10);
        let names;
        if (isKettle) {
            // Korrekte DB-Variablennamen: BK_Ist, BK_Soll (ohne T-Suffix)
            names = ['BK_Ist', 'BK_Soll', 'BK_A_H'];
        } else {
            const v = varsForTank(tankId);
            names = [v.ist, v.soll, v.ventil];
        }

        const rangeCfg = RANGES.find(r => r.key === this._range) || RANGES[2];
        this._chart.showLoading();

        try {
            const opts = { range: this._range, maxPoints: rangeCfg.maxPoints };
            if (this._range === 'custom' && this._customFrom && this._customTo) {
                delete opts.range;
                opts.from = this._customFrom;
                opts.to   = this._customTo;
                LOG(`Zeitreihe benutzerdefiniert: ${new Date(this._customFrom).toLocaleDateString('de-DE')} - ${new Date(this._customTo).toLocaleDateString('de-DE')}`);
            } else {
                LOG(`Zeitreihe (${this._range}) fuer ${id}`);
            }
            const res  = await dataService.fetchSeries(names, opts);
            const find = n => res.series.find(s => s.name === n)?.data || [];
            const data = {
                ist:        find(names[0]),
                soll:       find(names[1]),
                regul:      find(names[2]),
                regulLabel: isKettle ? 'Heizung' : 'Ventil',
            };
            this._chart.render(data);
            this._showSeriesStats(data.ist, data.soll);

            // CSV-Export
            const csvBtn = document.getElementById('wd-export-csv');
            if (csvBtn) {
                csvBtn.onclick = () => this._exportSeriesCSV(id, data);
            }
        } catch (err) {
            this._chart.showError();
            WARN('Zeitreihe:', err);
        }
    }

    // ----------------------------------------------------------------
    // Metrik-Hilfsmethoden
    // ----------------------------------------------------------------

    _setMetricFmt(name, rawVal, meta) {
        const el = this.root.querySelector(`[data-metric="${name}"]`);
        if (!el) return;
        if (rawVal == null || Number.isNaN(+rawVal)) { el.textContent = '--'; return; }

        if (meta.type === 'bool') {
            const on = +rawVal > 0.5;
            el.textContent = on ? (meta.trueText || 'An') : (meta.falseText || 'Aus');
            el.style.color = '';
            if (name === 'vent' || name === 'heat')
                el.style.color = on ? 'var(--proj-accent)' : 'rgba(255,255,255,0.4)';
            else if (name === 'ein')
                el.style.color = on ? '#5ee8a0' : 'rgba(255,255,255,0.35)';
            else if (name === 'auto')
                el.style.color = on ? '#7bc9ff' : 'rgba(255,255,255,0.6)';
        } else {
            el.innerHTML = meta.unit
                ? `${(+rawVal).toFixed(1)}<span class="unit"> ${meta.unit}</span>`
                : (+rawVal).toFixed(1);
        }
    }

    _setStatusBadge(status) {
        const el = document.getElementById('wd-status-badge');
        if (!el) return;
        const map = { ok:'OK', warn:'Warnung', crit:'KRITISCH', idle:'Inaktiv' };
        el.className = `wd-status-badge ${status}`;
        el.textContent = map[status] || '--';
    }

    _setRegBar(active, label, value) {
        const bar = document.getElementById('wd-reg-bar');
        const txt = document.getElementById('wd-reg-text');
        const sub = document.getElementById('wd-reg-sub');
        if (!bar) return;
        bar.classList.toggle('is-active',  active && label === 'Heizung');
        bar.classList.toggle('is-cooling', active && label === 'Kuehlventil');
        if (txt) txt.textContent = active
            ? (label === 'Kuehlventil' ? 'Kuehlung aktiv * Ventil offen' : 'Heizung aktiv')
            : `${label} inaktiv`;
        if (sub && value != null) sub.textContent = `${(+value).toFixed(0)} %`;
    }

    _bindClose() {
        this.root.addEventListener('click', e => {
            if (e.target === this.root || e.target.classList.contains('wd-projection-bg')) {
                this.close();
            }
        });
    }
}


// Farb-Palette fuer Vergleichs-Chart (6 Tanks + Reserve)
const COMP_COLORS = [
    '#4db8ff',  // T1 - Hellblau (Cyan)
    '#c87341',  // T2 - Kupfer
    '#5ee8a0',  // T3 - Gruen
    '#f0b73f',  // T4 - Gelb/Amber
    '#e2533b',  // T5 - Rot
    '#b57bee',  // T6 - Violett
    '#f4c4f3',  // Reserve
];

// ----------------------------------------------------------------
// WallChart * Canvas-basiertes AR-Diagramm
// ----------------------------------------------------------------
class WallChart {
    constructor(canvas) {
        this.canvas  = canvas;
        this.ctx     = canvas.getContext('2d');
        this._dpr    = Math.max(1, window.devicePixelRatio || 1);
        this._data   = null;
        this._state  = 'idle';
        this._hoverX = null;
        this._geom   = null;

        this._fit();
        this._bindHover();
        this._resizeObs = new ResizeObserver(() => { this._fit(); if (this._data) this._draw(); });
        this._resizeObs.observe(canvas);

        this._tip = document.createElement('div');
        this._tip.className = 'chart-tooltip';
        document.body.appendChild(this._tip);
    }

    destroy() { this._resizeObs?.disconnect(); this._tip?.remove(); }

    _fit() {
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width) return;
        this.canvas.width  = Math.round(rect.width  * this._dpr);
        this.canvas.height = Math.round((rect.height || 230) * this._dpr);
        this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    }

    showLoading() { this._state = 'loading'; this._drawMsg('Lade Verlauf ...'); }
    showError()   { this._state = 'error';   this._drawMsg('Laden fehlgeschlagen.'); }

    _drawMsg(msg) {
        const ctx = this.ctx;
        const w = this.canvas.width / this._dpr, h = this.canvas.height / this._dpr;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '13px "IBM Plex Sans",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(msg, w / 2, h / 2);
    }

    render(data) { this._state = 'ready'; this._data = data; this._compData = null; this._draw(); }

    renderComparison(seriesArray) {
        this._state     = 'ready';
        this._data      = null;
        this._compData  = seriesArray;  // [{label, ist, soll}]
        this._drawComparison();
    }

    _drawComparison() {
        const series = this._compData;
        if (!series?.length) return;
        const ctx = this.ctx;
        const w = this.canvas.width / this._dpr, h = this.canvas.height / this._dpr;
        ctx.clearRect(0, 0, w, h);

        const allPts = series.flatMap(s => [...s.ist, ...s.soll]);
        if (!allPts.length) { this._drawMsg('Keine Daten.'); return; }

        const padL=42,padR=14,padT=14,padB=28;
        const innerW=w-padL-padR, innerH=h-padT-padB;
        const xs=allPts.map(p=>p[0]), ys=allPts.map(p=>p[1]);
        const xMin=Math.min(...xs), xMax=Math.max(...xs);
        let yMin=Math.min(...ys), yMax=Math.max(...ys);
        if(yMin===yMax){yMin-=1;yMax+=1;}
        const yPad=(yMax-yMin)*0.12; yMin-=yPad; yMax+=yPad;
        this._geom={padL,padR,padT,padB,innerW,innerH,xMin,xMax,yMin,yMax,w,h};
        const xS=t=>padL+((t-xMin)/(xMax-xMin||1))*innerW;
        const yS=v=>padT+(1-(v-yMin)/(yMax-yMin||1))*innerH;

        // Gitter
        ctx.lineWidth=1; ctx.font='10px "JetBrains Mono",monospace';
        for(let i=0;i<=5;i++){
            const v=yMin+(i/5)*(yMax-yMin), y=yS(v);
            ctx.strokeStyle='rgba(255,255,255,0.07)';
            ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(w-padR,y); ctx.stroke();
            ctx.fillStyle='rgba(255,255,255,0.28)'; ctx.textAlign='right'; ctx.textBaseline='middle';
            ctx.fillText(v.toFixed(1)+' Grad',padL-5,y);
        }
        const span=xMax-xMin;
        const fmtX=ts=>{const d=new Date(ts);return span<=24*3600e3?d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});};
        ctx.textAlign='center'; ctx.textBaseline='top';
        for(let i=0;i<=5;i++){const t=xMin+(i/5)*span; ctx.fillStyle='rgba(255,255,255,0.25)'; ctx.fillText(fmtX(t),xS(t),h-padB+6);}

        // Jede Serie
        series.forEach((s, si) => {
            const color = COMP_COLORS[si] || '#ffffff';
            // Soll (gestrichelt, halbe Deckkraft)
            if(s.soll.length){
                ctx.strokeStyle=color; ctx.lineWidth=1.2; ctx.globalAlpha=0.4; ctx.setLineDash([4,3]);
                ctx.beginPath();
                s.soll.forEach((p,i)=>{i===0?ctx.moveTo(xS(p[0]),yS(p[1])):ctx.lineTo(xS(p[0]),yS(p[1]));});
                ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha=1;
            }
            // Ist (voll)
            if(s.ist.length){
                ctx.strokeStyle=color; ctx.lineWidth=2; ctx.globalAlpha=0.9;
                ctx.beginPath();
                s.ist.forEach((p,i)=>{i===0?ctx.moveTo(xS(p[0]),yS(p[1])):ctx.lineTo(xS(p[0]),yS(p[1]));});
                ctx.stroke(); ctx.globalAlpha=1;
                // Letzter Punkt
                const last=s.ist[s.ist.length-1];
                ctx.fillStyle=color; ctx.shadowColor=color; ctx.shadowBlur=8;
                ctx.beginPath(); ctx.arc(xS(last[0]),yS(last[1]),3,0,Math.PI*2); ctx.fill();
                ctx.shadowBlur=0;
            }
        });
        if(this._hoverX!=null) this._drawHover();
    }

    _draw() {
        const { ist = [], soll = [], regul = [] } = this._data || {};
        const ctx = this.ctx;
        const w = this.canvas.width / this._dpr, h = this.canvas.height / this._dpr;
        ctx.clearRect(0, 0, w, h);

        if (!ist.length && !soll.length) { this._drawMsg('Keine Daten.'); return; }

        const padL = 42, padR = 14, padT = 14, padB = 28;
        const innerW = w - padL - padR, innerH = h - padT - padB;

        const all = ist.concat(soll);
        const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
        const xMin = Math.min(...xs), xMax = Math.max(...xs);
        let yMin = Math.min(...ys), yMax = Math.max(...ys);
        if (yMin === yMax) { yMin -= 1; yMax += 1; }
        const yPad = (yMax - yMin) * 0.15;
        yMin -= yPad; yMax += yPad;
        this._geom = { padL, padR, padT, padB, innerW, innerH, xMin, xMax, yMin, yMax, w, h };

        const xS = t => padL + ((t - xMin) / (xMax - xMin || 1)) * innerW;
        const yS = v => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;

        // Regelungs-Band
        if (regul.length) {
            ctx.fillStyle = this._data.regulLabel === 'Heizung'
                ? 'rgba(212,134,31,0.22)' : 'rgba(77,180,255,0.18)';
            for (let i = 0; i < regul.length - 1; i++) {
                if (regul[i][1] > 0.5) {
                    ctx.fillRect(xS(regul[i][0]), padT, Math.max(1, xS(regul[i+1][0]) - xS(regul[i][0])), innerH);
                }
            }
        }

        // Gitter + Y-Achse
        ctx.lineWidth = 1;
        ctx.font = '10px "JetBrains Mono",monospace';
        for (let i = 0; i <= 5; i++) {
            const v = yMin + (i / 5) * (yMax - yMin), y = yS(v);
            ctx.strokeStyle = 'rgba(255,255,255,0.07)';
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            ctx.fillText(v.toFixed(1) + ' Grad', padL - 5, y);
        }

        // X-Achse
        const span = xMax - xMin;
        const fmtX = ts => {
            const d = new Date(ts);
            if (span <= 6*3600e3)  return d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
            if (span <= 24*3600e3) return d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
            if (span <= 7*24*3600e3) return d.toLocaleDateString('de-DE',{weekday:'short'});
            return d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
        };
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let i = 0; i <= 5; i++) {
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillText(fmtX(xMin + (i/5)*span), xS(xMin + (i/5)*span), h - padB + 6);
        }

        // Soll
        if (soll.length) {
            ctx.strokeStyle = '#4d8bd1'; ctx.lineWidth = 1.8; ctx.setLineDash([5,4]);
            ctx.beginPath();
            soll.forEach((p,i) => { i===0?ctx.moveTo(xS(p[0]),yS(p[1])):ctx.lineTo(xS(p[0]),yS(p[1])); });
            ctx.stroke(); ctx.setLineDash([]);
        }

        // Ist (Fuellung + Linie + Leuchtpunkt)
        if (ist.length) {
            const grad = ctx.createLinearGradient(0, padT, 0, padT+innerH);
            grad.addColorStop(0, 'rgba(200,115,65,0.28)');
            grad.addColorStop(1, 'rgba(200,115,65,0.02)');
            ctx.beginPath();
            ist.forEach((p,i) => { i===0?ctx.moveTo(xS(p[0]),yS(p[1])):ctx.lineTo(xS(p[0]),yS(p[1])); });
            ctx.lineTo(xS(ist[ist.length-1][0]), padT+innerH);
            ctx.lineTo(xS(ist[0][0]), padT+innerH);
            ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

            ctx.strokeStyle = '#c87341'; ctx.lineWidth = 2.2;
            ctx.beginPath();
            ist.forEach((p,i) => { i===0?ctx.moveTo(xS(p[0]),yS(p[1])):ctx.lineTo(xS(p[0]),yS(p[1])); });
            ctx.stroke();

            const last = ist[ist.length-1];
            ctx.fillStyle = '#ff9d5c'; ctx.shadowColor = '#c87341'; ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.arc(xS(last[0]), yS(last[1]), 4, 0, Math.PI*2); ctx.fill();
            ctx.shadowBlur = 0;
        }

        if (this._hoverX != null) this._drawHover();
    }

    _drawHover() {
        const g = this._geom; if (!g) return;
        if (this._hoverX < g.padL || this._hoverX > g.w - g.padR) return;
        const ctx = this.ctx;
        ctx.strokeStyle = 'rgba(77,180,255,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
        ctx.beginPath(); ctx.moveTo(this._hoverX, g.padT); ctx.lineTo(this._hoverX, g.padT+g.innerH); ctx.stroke();
        ctx.setLineDash([]);
    }

    _bindHover() {
        this.canvas.addEventListener('pointermove', e => {
            if (this._state !== 'ready' || !this._geom) return;
            const rect = this.canvas.getBoundingClientRect();
            this._hoverX = e.clientX - rect.left;
            this._draw();
            this._showTip(e.clientX, e.clientY);
        });
        this.canvas.addEventListener('pointerleave', () => {
            this._hoverX = null;
            this._tip.classList.remove('is-visible');
            if (this._state === 'ready') this._draw();
        });
    }

    _showTip(cx, cy) {
        const g = this._geom, d = this._data;
        if (!g || !d || this._hoverX < g.padL || this._hoverX > g.w-g.padR) {
            this._tip.classList.remove('is-visible'); return;
        }
        const t  = g.xMin + ((this._hoverX - g.padL) / g.innerW) * (g.xMax - g.xMin);
        const pI = nearest(d.ist || [], t);
        const pS = nearest(d.soll || [], t);
        const pR = nearest(d.regul || [], t);
        let rows = '';
        if (pI) rows += `<div class="tt-row"><span class="tt-dot" style="background:#c87341"></span><span class="tt-name">Ist</span><span class="tt-val">${pI[1].toFixed(2)}  GradC</span></div>`;
        if (pS) rows += `<div class="tt-row"><span class="tt-dot" style="background:#4d8bd1"></span><span class="tt-name">Soll</span><span class="tt-val">${pS[1].toFixed(2)}  GradC</span></div>`;
        if (pI && pS) {
            const dv = pI[1]-pS[1];
            rows += `<div class="tt-row"><span class="tt-dot"></span><span class="tt-name">_ Soll</span><span class="tt-val" style="color:${Math.abs(dv)>5?'#e2533b':Math.abs(dv)>2?'#f0b73f':'#5ee8a0'}">${dv>=0?'+':''}${dv.toFixed(2)}  GradC</span></div>`;
        }
        if (pR) {
            const on = pR[1] > 0.5;
            rows += `<div class="tt-row"><span class="tt-dot" style="background:${on?'#4db8ff':'#5a6472'}"></span><span class="tt-name">${d.regulLabel||'Regelung'}</span><span class="tt-val">${on?'An':'Aus'}</span></div>`;
        }
        const ts = pI ? pI[0] : t;
        this._tip.innerHTML = `<div class="tt-time">${new Date(ts).toLocaleString('de-DE')}</div>${rows}`;
        this._tip.style.left = cx + 'px'; this._tip.style.top = cy + 'px';
        this._tip.classList.add('is-visible');
    }
}

// ---- Hilfsfunktionen ----
function nearest(series, t) {
    if (!series.length) return null;
    let best = series[0], bestD = Math.abs(series[0][0] - t);
    for (const p of series) { const d = Math.abs(p[0]-t); if (d<bestD){bestD=d;best=p;} }
    return best;
}
function findMaxInRange(series, from, to) {
    const pts = series.filter(p => p[0]>=from && p[0]<=to);
    return pts.length ? Math.max(...pts.map(p=>p[1])) : null;
}
function findAvgInRange(series, from, to) {
    const pts = series.filter(p => p[0]>=from && p[0]<=to);
    return pts.length ? pts.reduce((s,p)=>s+p[1],0)/pts.length : null;
}
function formatDateLong(dateStr) {
    return new Date(dateStr+'T12:00:00').toLocaleDateString('de-DE',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
}
function formatTime(ms) {
    if (!ms) return '--';
    return new Date(ms).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
}
function formatDuration(min) {
    if (!min) return '--';
    const h = Math.floor(min/60), m = min%60;
    return h > 0 ? `${h} h${m>0?' '+m+' min':''}` : `${m} min`;
}