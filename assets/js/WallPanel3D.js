/**
 * WallPanel3D - Echte 3D-Canvas-Projektion auf der Brauerei-Wand
 * _______________________________________________________________
 * Ansatz: Kein CSS3D / kein HTML-in-3D.
 * Stattdessen:
 *   - THREE.PlaneGeometry + THREE.CanvasTexture -> echter 3D-Mesh
 *   - Alle UI-Elemente per Canvas-2D-API gezeichnet
 *   - UV-Raycasting fuer Klick-Interaktion (Buttons, Close)
 *   - Animation ueber den normalen Render-Loop (scan lines, Pulse)
 *   - Beim Wegbewegen mit WASD verschwindet das Panel hinter der
 *     Kamera - wie jedes andere 3D-Objekt in der Szene
 *
 * WICHTIG: Dies ist KOMPLETT GETRENNT von #wall-display (Overlay-Modus).
 *          Der Overlay-Modus bleibt unveraendert - WallPanel3D ist nur
 *          fuer mode === '3d' zustaendig.
 */

console.log('=== WallPanel3D.js GELADEN ===');
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
// Inline-Fallback (funktioniert auch ohne aktualisierte config.js)
const SERVER_WP = window.APP_CONFIG || {};
function varsForTank(tankId) { return { ein:'T'+tankId+'_Ein', auto:'T'+tankId+'_AM', ist:'T'+tankId+'_IstT', soll:'T'+tankId+'_SollT', ventil:'T'+tankId+'_AV', hand:'T'+tankId+'_HV' }; }
const BREWKETTLE_VARS = { aktiv:'B_Aktiv', ein:'BK_Ein', auto:'BK_Auto', ist:'BK_Ist', soll:'BK_Soll', hand:'BK_Hand', heat:'BK_A_H' };
const PUMP_VARS = { p1_run:'P1_Run', p1_val:'P1_Val', cwp_run:'CWP_Run', cwp_val:'CWP_Val' };
const THRESHOLDS = { tank:{ deltaWarn:2, deltaCrit:5 }, brewkettle:{ deltaWarn:3, deltaCrit:8 } };
function classifyStatus(ist, soll, kind) { if(ist==null||soll==null) return 'idle'; const d=Math.abs(ist-soll); const t=(kind==='brewkettle'?THRESHOLDS.brewkettle:THRESHOLDS.tank); return d>=t.deltaCrit?'crit':d>=t.deltaWarn?'warn':'ok'; }

// Lokal definiert (kompatibel mit alter und neuer config.js)
function isActive(v) { return v != null && +v > 0.5; }

// Variablen-Metadaten (inline, unabhaengig von config.js-Version)
const TANK_ROLE_META = {
    ist:    { label:'Ist-Temp.',     type:'float', unit:'GradC', desc:'Gemessene Temperatur' },
    soll:   { label:'Soll-Temp.',    type:'float', unit:'GradC', desc:'Zieltemperatur' },
    ein:    { label:'Kuehlregelung', type:'bool',  trueText:'Aktiv',       falseText:'Inaktiv',    desc:'Kuehlsteuerung Ein/Aus' },
    auto:   { label:'Modus',         type:'bool',  trueText:'Auto',        falseText:'Manuell',    desc:'Regelungs-Modus' },
    ventil: { label:'Auslass-Ventil',type:'bool',  trueText:'Offen',       falseText:'Geschlossen',desc:'Ventilzustand' },
    hand:   { label:'Hand-Ventil',   type:'bool',  trueText:'An',          falseText:'Aus',        desc:'Manuelles Override' },
};
const BK_ROLE_META = {
    ist:    { label:'Ist-Temp.',     type:'float', unit:'GradC', desc:'Kesseltemperatur' },
    soll:   { label:'Soll-Temp.',    type:'float', unit:'GradC', desc:'Zieltemperatur' },
    ein:    { label:'Kesselsteuerung',type:'bool', trueText:'Aktiv',falseText:'Inaktiv',desc:'Steuerung Ein/Aus' },
    auto:   { label:'Modus',          type:'bool', trueText:'Auto', falseText:'Manuell',desc:'Regelungs-Modus' },
    heat:   { label:'Ausg. Heizung',  type:'bool', trueText:'An',   falseText:'Aus',    desc:'Heizelement' },
};
import { dataService } from './dataService.js';

const LOG  = (m, ...a) => console.log('[WallPanel3D]', m, ...a);
const WARN = (m, ...a) => console.warn('[WallPanel3D]', m, ...a);

// __ Canvas-Aufloesung ____________________________________________
const CW = 1024;   // Pixel (Textur-Breite)
const CH = 720;    // Pixel (Textur-Hoehe)
const ASPECT = CW / CH;

// __ 3D-Dimensionen in World-Units _______________________________
const PW = 52;     // Breite des Panels
const PH = PW / ASPECT;  // Hoehe (behaelt Seitenverhaeltnis bei)

// __ Design-Tokens (entsprechen dem CSS-Farbschema) _____________
const C = {
    bg:        '#0a1628',
    bgAlpha:   'rgba(10,22,40,0.95)',
    surface:   'rgba(15,28,52,0.9)',
    border:    'rgba(77,180,255,0.14)',
    borderSoft:'rgba(77,180,255,0.08)',
    accent:    '#4db8ff',
    copper:    '#c87341',
    copperLt:  '#e8a56f',
    green:     '#4ec57a',
    warn:      '#f0b73f',
    crit:      '#e2533b',
    idle:      '#4a5568',
    textHi:    '#e8f4ff',
    textMid:   'rgba(232,244,255,0.65)',
    textLo:    'rgba(232,244,255,0.35)',
    grid:      'rgba(77,180,255,0.08)',
    scanLine:  'rgba(77,180,255,0.03)',
};

const STATUS_COLOR = { ok: C.green, warn: C.warn, crit: C.crit, idle: C.idle };

// __ Ranges ______________________________________________________
const RANGES = [
    { key: '1h', label: '1 Std' },
    { key: '6h', label: '6 Std' },
    { key: '1d', label: 'Tag'   },
    { key: '1w', label: 'Woche' },
    { key: '1m', label: 'Monat' },
];

// ________________________________________________________________
export class WallPanel3D {
    /**
     * @param {Scene} scene  - Scene-Instanz (hat .scene, .wall, .addInteractive)
     */
	get currentId() { return this._currentId; }
    constructor(scene) {
        this._scene         = scene;
        this._currentId     = null;
        this._liveValues    = {};
        this._chartData     = null;
        this._range         = '1d';
        this._refreshTimer  = null;
        this._elapsed       = 0;
        this._closeHandlers = [];
        this._hitAreas      = [];   // { x, y, w, h, action } in Canvas-Koordinaten

        // Offscreen-Canvas fuer Texture
        this._canvas  = document.createElement('canvas');
        this._canvas.width  = CW;
        this._canvas.height = CH;
        this._ctx     = this._canvas.getContext('2d');

        // Three.js Objekte aufbauen
        this._texture = new THREE.CanvasTexture(this._canvas);
        this._texture.minFilter = THREE.LinearFilter;
        this._texture.magFilter = THREE.LinearFilter;

        this._material = new THREE.MeshBasicMaterial({
            map: this._texture,
            transparent: true,
            side: THREE.DoubleSide,
        });

        const geo = new THREE.PlaneGeometry(PW, PH);
        this._mesh = new THREE.Mesh(geo, this._material);
        this._mesh.visible = false;
        this._mesh.frustumCulled = false;   // nie vom Frustum ausblenden
        this._mesh.userData.isWallPanel3D = true;
        this._mesh.userData.panel = this;  // Rueckreferenz fuer Raycasting
        scene.scene.add(this._mesh);

        // Leuchtrahmen um das Panel (EdgeGeometry)
        this._frame = this._buildFrame();
        scene.scene.add(this._frame);

        // Initialen Leerzustand zeichnen
        // Mesh bei Scene als Panel-Mesh registrieren (fuer UV-Raycasting)
        scene.addPanelMesh(this._mesh);

        this._drawIdle();
        this._update3DObjects();

        LOG(`Initialisiert - Panelgroesse: ${PW.toFixed(1)} x ${PH.toFixed(1)} World-Units`);
    }

    // __ Oeffentliche API __________________________________________

    isOpen() { return this._currentId !== null; }
    onClose(cb) { this._closeHandlers.push(cb); }

    /** Panel fuer ein bestimmtes Objekt oeffnen */
    async open(interactiveId, liveValues = {}) {
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }

        this._currentId    = interactiveId;
        this._liveValues   = liveValues;
        this._chartData    = null;
        this._range        = '1d';
        this._bkTab        = 'kessel';   // Braukessel: Standard-Tab
        this._brewDaysData = null;
        this._selectedBrewDay = null;
        this._brewDayActive = false;   // Kein Brautag aktiv
        this._brewDaysScroll = 0;      // Scroll-Position in der Brautage-Liste
        this._hitAreas   = [];

        // Panel vor dem Tank positionieren
        this._positionForId(interactiveId);

        this._mesh.visible  = true;
        this._frame.visible = true;

        // Einfahren-Animation
        this._mesh.scale.set(0.1, 0.1, 1);
        this._animateIn();

        this._drawLoading(interactiveId);
        this._updateTexture();

        LOG(`Oeffne: ${interactiveId}`);

        // Live-Werte sofort anzeigen
        this.updateLive(liveValues);

        // Chart-Daten laden
        await this._loadSeries(interactiveId);

        // Auto-Refresh - aber niemals wenn gerade ein Brautag angezeigt wird
        this._refreshTimer = setInterval(() => {
            if (this._brewDayActive) return;
            this._loadSeries(interactiveId);
        }, 15_000);
    }

    /** Panel schliessen */
    close() {
        if (!this._currentId) return;
        LOG('Schliesse:', this._currentId);
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
        this._currentId = null;
        this._brewDayActive = false;
        this._mesh.visible  = false;
        this._frame.visible = false;
        this._hitAreas = [];
        this._closeHandlers.forEach(cb => cb());
    }

    /** Live-Werte aktualisieren (vom Poll-Loop) */
    updateLive(values) {
        if (!this.isOpen()) return;
        // Wenn gerade ein Brautag angezeigt wird, NICHT ueberschreiben
        if (this._brewDayActive) return;
        this._liveValues = values;
        // Neu zeichnen (Chart bleibt erhalten, nur Metriken-Bereich)
        if (this._chartData) this._drawFull();
        else this._drawLoading(this._currentId);
        this._updateTexture();
    }

    /**
     * Jeden Frame aufrufen - fuer Animation (scan lines, Pulse).
     * @param {number} dt       Delta-Zeit in Sekunden
     * @param {number} elapsed  Gesamtzeit
     */
    update(dt, elapsed) {
        if (!this.isOpen()) return;
        this._elapsed = elapsed;
        // Wenn Brautag aktiv: nur scanlines neu zeichnen (kein Ueberschreiben)
        if (this._brewDayActive) {
            if (Math.floor(elapsed * 2) !== Math.floor((elapsed - dt) * 2)) {
                this._drawScanLines();
                this._updateTexture();
            }
            return;
        }
        // Nur alle ~0.5s neu zeichnen (spart GPU-Zeit)
        if (Math.floor(elapsed * 2) !== Math.floor((elapsed - dt) * 2)) {
            if (this._chartData) this._drawFull();
            else this._drawLoading(this._currentId);
            this._updateTexture();
        }
    }

    /**
     * Mausklick auf Panel verarbeiten.
     * Wird von Scene's Raycaster aufgerufen wenn auf den Mesh geklickt wird.
     * @param {THREE.Intersection} intersection
     */
    handleClick(intersection) {
        const uv = intersection.uv;
        if (!uv) return;
        // UV -> Canvas-Pixel (Y ist in Three.js gespiegelt)
        const px = uv.x * CW;
        const py = (1 - uv.y) * CH;

        for (const area of this._hitAreas) {
            if (px >= area.x && px <= area.x + area.w &&
                py >= area.y && py <= area.y + area.h) {
                LOG(`Hit: ${area.action}`);
                area.callback();
                return;
            }
        }
    }

    // __ Positionierung ___________________________________________

    _positionForId(id) {
        const wall = this._scene.wall;
        const isKettle = id === 'brewkettle';

        // X-Position: entspricht dem Tank-X auf der Wand, clamped
        let panelX = isKettle ? (wall.x - wall.w / 2 + 12) : this._getTankX(id);
        panelX = Math.max(wall.x - wall.w/2 + PW/2 + 2, Math.min(wall.x + wall.w/2 - PW/2 - 2, panelX));

        // Y: obere Haelfte der Wand
        const panelY = wall.y + 8;   // hoeher - Wand ist jetzt taller

        // Z: direkt vor der Wand
        const panelZ = wall.z + 2.5;

        this._mesh.position.set(panelX, panelY, panelZ);
        this._frame.position.copy(this._mesh.position);

        LOG(`Panel bei (${panelX.toFixed(1)}, ${panelY.toFixed(1)}, ${panelZ.toFixed(1)})`);
    }

    _getTankX(id) {
        const { TANKS } = this._scene._tankConfig || {};
        if (TANKS) {
            const tankId = parseInt(id.replace('tank-', ''), 10);
            return TANKS.find(t => t.id === tankId)?.x ?? this._scene.wall.x;
        }
        // Fallback: gleichmaessig verteilt (Tanks 1-6 bei x=18..98)
        const tankId = parseInt(id.replace('tank-', ''), 10);
        return 18 + (tankId - 1) * 16;
    }

    _animateIn() {
        const mesh  = this._mesh;
        const frame = this._frame;
        let t = 0;
        const step = () => {
            t = Math.min(1, t + 0.08);
            const s = 1 - Math.pow(1 - t, 3);  // ease-out-cubic
            mesh.scale.set(s, s, 1);
            frame.scale.set(s, s, 1);
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    // __ Textur aktualisieren _____________________________________

    _updateTexture() {
        this._texture.needsUpdate = true;
    }

    _update3DObjects() {
        // Mesh und Frame initial auf korrekten Zustand setzen
        this._mesh.visible  = false;
        this._frame.visible = false;
    }

    // __ Rahmen-Geometrie _________________________________________

    _buildFrame() {
        const group = new THREE.Group();

        // Leuchtender Rand (4 duenne Boxen)
        const edgeMat = new THREE.MeshBasicMaterial({
            color:  0x4db8ff,
            transparent: true,
            opacity: 0.7,
            side:  THREE.DoubleSide,
        });

        const thick = 0.18;
        const edges = [
            // [width, height, x, y]
            [PW + thick*2, thick, 0,       PH/2 + thick/2],  // oben
            [PW + thick*2, thick, 0,      -PH/2 - thick/2],  // unten
            [thick, PH, -PW/2 - thick/2,   0              ],  // links
            [thick, PH,  PW/2 + thick/2,   0              ],  // rechts
        ];
        edges.forEach(([w, h, x, y]) => {
            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                edgeMat.clone()
            );
            mesh.position.set(x, y, 0);
            group.add(mesh);
        });

        // Eck-Akzente (Kupferfarben)
        const cornerMat = new THREE.MeshBasicMaterial({ color: 0xc87341 });
        const cornerSize = 1.2;
        [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([sx, sy]) => {
            const c = new THREE.Mesh(new THREE.PlaneGeometry(cornerSize, cornerSize), cornerMat);
            c.position.set(sx * (PW/2 + thick/2), sy * (PH/2 + thick/2), 0);
            group.add(c);
        });

        group.visible = false;
        group.traverse(c => { if (c.isMesh) c.frustumCulled = false; });
        return group;
    }

    // __ Canvas-Rendering _________________________________________

    _drawIdle() {
        const ctx = this._ctx;
        ctx.clearRect(0, 0, CW, CH);
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, CW, CH);
        ctx.fillStyle = C.textLo;
        ctx.font = '28px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Bereit - Tank oder Kessel auswaehlen', CW/2, CH/2);
    }

    _drawLoading(id) {
        const ctx = this._ctx;
        const isKettle = id === 'brewkettle';
        ctx.clearRect(0, 0, CW, CH);
        this._drawBackground();
        this._drawHeader(id);
        this._drawScanLines();
        // Lade-Indikator
        const cy = CH * 0.58;
        ctx.fillStyle = C.textLo;
        ctx.font = '22px monospace';
        ctx.textAlign = 'center';
        const dots = '.'.repeat(1 + Math.floor(this._elapsed * 2) % 3);
        ctx.fillText(`Lade Verlaufsdaten${dots}`, CW/2, cy);
    }

    _drawFull() {
        const ctx = this._ctx;
        ctx.clearRect(0, 0, CW, CH);
        this._drawBackground();
        this._hitAreas = [];

        const id       = this._currentId;
        const values   = this._liveValues;
        const isKettle = id === 'brewkettle';

        // __ Header ______________________________________________
        const headerH = this._drawHeader(id);

        if (isKettle) {
            // Braukessel: 3-Tab-System
            if (!this._bkTab) this._bkTab = 'kessel'; // Standard-Tab
            const tabH = this._drawBKTabs(headerH);
            if (this._bkTab === 'kessel') {
                this._drawBKKesselTab(headerH + tabH, values);
            } else if (this._bkTab === 'pump') {
                this._drawBKPumpTab(headerH + tabH, values);
            } else if (this._bkTab === 'brewdays') {
                this._drawBKBrewdaysTab(headerH + tabH);
            }
        } else {
            // Tanks: einfaches Layout
            const metricsTop = headerH + 8;
            const metricsH   = this._drawMetrics(id, values, metricsTop);
            const regTop = metricsTop + metricsH + 6;
            const regH   = this._drawRegBar(id, values, regTop);
            const chartTop = regTop + regH + 14;
            this._drawRangeTabs(chartTop);
            this._drawChart(chartTop + 48, CH - chartTop - 48 - 14);
        }

        this._drawScanLines();
        this._drawCloseBtn();
    }

    // __ Braukessel Tab-Leiste ____________________________________
    _drawBKTabs(top) {
        const ctx  = this._ctx;
        const tabs = [
            { key: 'kessel',   label: 'Braukessel' },
            { key: 'pump',     label: 'Pumpen' },
            { key: 'brewdays', label: 'Brautage' },
        ];
        const tabW = CW / tabs.length;
        const H    = 44;

        tabs.forEach((tab, i) => {
            const x      = i * tabW;
            const active = this._bkTab === tab.key;
            ctx.fillStyle = active ? 'rgba(200,115,65,0.18)' : 'rgba(10,20,40,0.4)';
            ctx.fillRect(x, top, tabW, H);
            if (active) {
                ctx.fillStyle = 'rgba(200,115,65,0.9)';
                ctx.fillRect(x, top + H - 3, tabW, 3);
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + H); ctx.stroke();

            ctx.fillStyle   = active ? C.copper : C.textMid;
            ctx.font        = `${active ? '700' : '500'} 17px sans-serif`;
            ctx.textAlign   = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tab.label, x + tabW / 2, top + H / 2);

            this._hitAreas.push({
                x, y: top, w: tabW, h: H,
                action: 'bk-tab-' + tab.key,
                callback: () => {
                    this._bkTab = tab.key;
                    // Wenn in Kessel- oder Pumpen-Tab gewechselt: Brautag-Modus beenden
                    if (tab.key === 'kessel' || tab.key === 'pump') {
                        this._brewDayActive = false;
                        this._selectedBrewDay = null;
                        // Seriendata neu laden fuer aktuellen Verlauf
                        if (tab.key === 'kessel') {
                            this._chartData = null;
                            this._loadSeries(this._currentId);
                        }
                        // Auto-Refresh wiederherstellen (wurde beim Klick auf Brautag gestoppt)
                        if (!this._refreshTimer && this._currentId) {
                            const id = this._currentId;
                            this._refreshTimer = setInterval(() => {
                                if (this._brewDayActive) return;
                                this._loadSeries(id);
                            }, 15_000);
                        }
                    }
                    if (tab.key === 'brewdays' && !this._brewDaysData) {
                        this._loadBrewDaysList();
                    }
                },
            });
        });

        ctx.strokeStyle = C.border; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, top + H); ctx.lineTo(CW, top + H); ctx.stroke();

        return H;
    }

    // __ Braukessel-Tab: Kessel-Daten ________________________________
    _drawBKKesselTab(top, values) {
        const metricsH = this._drawMetrics('brewkettle', values, top + 6);
        const regTop   = top + 6 + metricsH + 6;
        const regH     = this._drawRegBar('brewkettle', values, regTop);
        const chartTop = regTop + regH + 10;
        this._drawRangeTabs(chartTop);
        this._drawChart(chartTop + 48, CH - chartTop - 48 - 8);
    }

    // __ Braukessel-Tab: Pumpen-Daten ________________________________
    _drawBKPumpTab(top, values) {
        const ctx  = this._ctx;
        const pv   = typeof PUMP_VARS !== 'undefined' ? PUMP_VARS : {};
        const H    = CH - top - 14;

        // Ueberschrift
        ctx.fillStyle = C.textLo; ctx.font = '600 16px sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('PUMPEN UND KUEHLSYSTEM', 24, top + 28);
        ctx.strokeStyle = C.border; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(24, top + 36); ctx.lineTo(CW - 24, top + 36); ctx.stroke();

        const pumps = [
            { label: 'PUMPE 1 (P1)', run: pv.p1_run, val: pv.p1_val, unit: '%' },
            { label: 'KUEHLWASSER (CWP)', run: pv.cwp_run, val: pv.cwp_val, unit: '%' },
        ];

        const colW   = CW / 2;
        const blockY = top + 48;
        const blockH = 160;

        pumps.forEach((pump, i) => {
            const bx = i * colW + 12;
            const by = blockY;
            const bw = colW - 24;

            const runVal = values[pump.run]?.val;
            const flowVal = values[pump.val]?.val;
            const running = isActive(runVal);

            // Block-Hintergrund
            ctx.fillStyle = running ? 'rgba(43,127,214,0.08)' : 'rgba(10,20,40,0.5)';
            ctx.strokeStyle = running ? 'rgba(43,127,214,0.3)' : 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1.5;
            this._roundRect(bx, by, bw, blockH, 6);

            // Label
            ctx.fillStyle = C.textLo; ctx.font = '600 13px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(pump.label, bx + bw / 2, by + 26);

            // Status-Kreis
            const cx = bx + bw / 2, cy = by + 72;
            const radius = 30;
            ctx.fillStyle = running ? 'rgba(43,127,214,0.2)' : 'rgba(42,58,78,0.8)';
            ctx.strokeStyle = running ? 'rgba(43,127,214,0.7)' : 'rgba(90,107,128,0.4)';
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();

            ctx.fillStyle = running ? '#4db8ff' : C.idle;
            ctx.font = `bold ${running ? '15' : '13'}px monospace`;
            ctx.textBaseline = 'middle';
            ctx.fillText(running ? 'LAEUFT' : 'STOP', cx, cy);

            // Flusswert
            if (flowVal != null) {
                ctx.fillStyle = C.textHi; ctx.font = 'bold 28px monospace';
                ctx.fillText(flowVal.toFixed(0) + ' ' + pump.unit, cx, by + 122);
            } else {
                ctx.fillStyle = C.textLo; ctx.font = '22px monospace';
                ctx.fillText('-- ' + pump.unit, cx, by + 122);
            }

            // Balken
            const barX = bx + 14, barY = by + 138, barW = bw - 28, barH = 12;
            ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(barX, barY, barW, barH);
            if (flowVal != null && running) {
                const pct = Math.max(0, Math.min(1, flowVal / 100));
                const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
                grad.addColorStop(0, '#2b7fd6'); grad.addColorStop(1, '#4db8ff');
                ctx.fillStyle = grad;
                ctx.fillRect(barX, barY, barW * pct, barH);
            }
        });

    }

    // __ Braukessel-Tab: Brautage-Liste ______________________________
    _drawBKBrewdaysTab(top) {
        const ctx    = this._ctx;
        const days   = this._brewDaysData;
        const H      = CH - top - 14;

        // Titel
        ctx.fillStyle = C.textLo; ctx.font = '600 16px sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('ERKANNTE BRAUTAGE', 24, top + 28);
        ctx.strokeStyle = C.border; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(24, top + 36); ctx.lineTo(CW - 24, top + 36); ctx.stroke();

        if (!days) {
            ctx.fillStyle = C.textLo; ctx.font = '18px monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const dots = '..'.substr(0, 1 + Math.floor(this._elapsed * 2) % 3);
            ctx.fillText('Lade Brautage' + dots, CW / 2, top + H / 2);
            return;
        }

        if (!days.length) {
            ctx.fillStyle = C.textLo; ctx.font = '18px monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('Keine Brautage gefunden.', CW / 2, top + H / 2);
            return;
        }

        // Liste mit Scroll-Pfeilen
        const rowH   = 72;
        const listY  = top + 46;
        const listH  = H - 58;   // 46 fuer Titelbereich, 12 Puffer unten
        const arrowW = 44;
        const rowsPerPage = Math.max(1, Math.floor(listH / rowH));

        if (this._brewDaysScroll == null) this._brewDaysScroll = 0;
        // Auf gueltigen Bereich klemmen
        const maxScroll = Math.max(0, days.length - rowsPerPage);
        if (this._brewDaysScroll > maxScroll) this._brewDaysScroll = maxScroll;

        const visibleDays = days.slice(this._brewDaysScroll, this._brewDaysScroll + rowsPerPage);

        // Innenbreite (Platz fuer Scroll-Pfeile rechts reservieren)
        const rowX = 20;
        const rowW = CW - 40 - arrowW - 4;

        visibleDays.forEach((d, i) => {
            const ry = listY + i * rowH;
            const isSelected = this._selectedBrewDay?.date === d.date
                && this._selectedBrewDay?.start_ms === d.start_ms;

            ctx.fillStyle = isSelected ? 'rgba(200,115,65,0.15)' : (i % 2 === 0 ? 'rgba(10,20,40,0.4)' : 'rgba(14,26,50,0.4)');
            ctx.strokeStyle = isSelected ? 'rgba(200,115,65,0.4)' : 'rgba(255,255,255,0.04)';
            ctx.lineWidth = isSelected ? 1.5 : 0.5;
            this._roundRect(rowX, ry + 2, rowW, rowH - 4, 5);

            const dateShort = this._fmtDate(d.date);
            const timeStr   = this._fmtTime(d.start_ms) + ' - ' + this._fmtTime(d.end_ms);
            const dur       = this._fmtDur(d.duration_min);
            const peak      = d.peak_temp != null ? d.peak_temp + ' °C max' : '--';

            // Datum (oben, gross)
            ctx.fillStyle   = isSelected ? C.copper : C.textHi;
            ctx.font        = `${isSelected ? 'bold' : '600'} 18px sans-serif`;
            ctx.textAlign   = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(dateShort, rowX + 16, ry + 28);

            // Uhrzeit (unten, gleiche Groesse wie Datum, blauer Akzent)
            ctx.fillStyle   = isSelected ? C.copper : '#7bc9ff';
            ctx.font        = 'bold 18px monospace';
            ctx.fillText(timeStr, rowX + 16, ry + 54);

            // Dauer (mittig)
            ctx.fillStyle   = C.textMid; ctx.font = '14px sans-serif';
            ctx.textAlign   = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(dur, rowX + rowW * 0.62, ry + rowH / 2);

            // Peak-Temp
            ctx.fillStyle   = isSelected ? C.copper : C.copper;
            ctx.font        = 'bold 15px monospace';
            ctx.textAlign   = 'right';
            ctx.fillText(peak, rowX + rowW - 32, ry + rowH / 2);

            // Chevron
            ctx.fillStyle = C.textLo; ctx.font = '22px monospace';
            ctx.fillText('›', rowX + rowW - 14, ry + rowH / 2);

            // Hit-Area (ganze Zeile)
            this._hitAreas.push({
                x: rowX, y: ry + 2, w: rowW, h: rowH - 4,
                action: 'brewday-' + d.date + '-' + d.start_ms,
                callback: () => {
                    this._selectedBrewDay = d;
                    this._bkTab = 'kessel';
                    this._chartData = null;
                    // Auto-Refresh der Live-Serie stoppen, damit die
                    // Brautag-Ansicht nicht nach 15s ueberschrieben wird
                    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
                    this._loadBrewDaySeries(d);
                },
            });
        });

        // Scroll-Pfeile rechts
        const arrowX  = CW - 20 - arrowW;
        const arrowUpY   = listY;
        const arrowDnY   = listY + listH - rowH + 4;
        const arrowH  = rowH - 8;

        const drawArrow = (x, y, w, h, dir, enabled) => {
            ctx.fillStyle   = enabled ? 'rgba(77,180,255,0.15)' : 'rgba(255,255,255,0.03)';
            ctx.strokeStyle = enabled ? 'rgba(77,180,255,0.4)'  : 'rgba(255,255,255,0.06)';
            ctx.lineWidth   = 1.2;
            this._roundRect(x, y, w, h, 5);
            ctx.fillStyle = enabled ? C.accent : C.textLo;
            ctx.font = 'bold 26px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(dir === 'up' ? '▲' : '▼', x + w/2, y + h/2);
        };

        const canUp = this._brewDaysScroll > 0;
        const canDn = this._brewDaysScroll < maxScroll;
        drawArrow(arrowX, arrowUpY, arrowW, arrowH, 'up', canUp);
        drawArrow(arrowX, arrowDnY, arrowW, arrowH, 'down', canDn);

        if (canUp) {
            this._hitAreas.push({
                x: arrowX, y: arrowUpY, w: arrowW, h: arrowH,
                action: 'brewday-scroll-up',
                callback: () => {
                    this._brewDaysScroll = Math.max(0, this._brewDaysScroll - rowsPerPage);
                },
            });
        }
        if (canDn) {
            this._hitAreas.push({
                x: arrowX, y: arrowDnY, w: arrowW, h: arrowH,
                action: 'brewday-scroll-down',
                callback: () => {
                    this._brewDaysScroll = Math.min(maxScroll, this._brewDaysScroll + rowsPerPage);
                },
            });
        }

        // Kleiner Positionsindikator zwischen den Pfeilen
        if (days.length > rowsPerPage) {
            const indX = arrowX + arrowW / 2;
            const indY0 = arrowUpY + arrowH + 8;
            const indY1 = arrowDnY - 8;
            ctx.strokeStyle = 'rgba(77,180,255,0.15)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(indX, indY0); ctx.lineTo(indX, indY1); ctx.stroke();
            const frac = maxScroll === 0 ? 0 : this._brewDaysScroll / maxScroll;
            const thumbY = indY0 + frac * (indY1 - indY0 - 24);
            ctx.fillStyle = C.accent;
            this._roundRect(indX - 4, thumbY, 8, 24, 3);
        }
    }

    _fmtTime(ms) {
        if (!ms) return '--';
        return new Date(ms).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'});
    }

    async _loadBrewDaysList() {
        try {
            const res = await dataService._request({ action: 'brew_days', limitDays: 90 });
            this._brewDaysData = res.brew_days || [];
            LOG('Brautage geladen:', this._brewDaysData.length);
        } catch (err) {
            WARN('Brautage-Liste:', err);
            this._brewDaysData = [];
        }
    }

    _fmtDate(s) {
        const [y,m,d] = s.split('-');
        return `${d}.${m}.${y.slice(2)}`;
    }
    _fmtDur(min) {
        if (!min) return '--';
        const h = Math.floor(min/60), m = min%60;
        return h > 0 ? `${h}h${m > 0 ? ' '+m+'m' : ''}` : `${m} min`;
    }

    // __ Einzelne Zeichenmethoden _________________________________

    _drawBackground() {
        const ctx = this._ctx;
        // Gradient-Hintergrund
        const grad = ctx.createLinearGradient(0, 0, 0, CH);
        grad.addColorStop(0, 'rgba(8,18,38,0.98)');
        grad.addColorStop(1, 'rgba(12,24,44,0.98)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, CW, CH);

        // Subtiles Gitter
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        for (let x = 0; x < CW; x += 64) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke();
        }
        // Horizontale Gitterlinien entfernt (ueberlagern UI-Elemente)

        // Oben: Kupfer-Leiste
        const barGrad = ctx.createLinearGradient(0, 0, CW, 0);
        barGrad.addColorStop(0,   'rgba(200,115,65,0.9)');
        barGrad.addColorStop(0.5, 'rgba(232,165,111,0.95)');
        barGrad.addColorStop(1,   'rgba(200,115,65,0.9)');
        ctx.fillStyle = barGrad;
        ctx.fillRect(0, 0, CW, 7);
    }

    _drawHeader(id) {
        const ctx     = this._ctx;
        const isKettle = id === 'brewkettle';
        const tankId   = isKettle ? null : parseInt(id.replace('tank-', ''), 10);

        const iconText = isKettle ? 'BK' : `T${tankId}`;
        const eyebrow  = isKettle ? 'BRAUANLAGE * KERNPROZESS' : 'GAeRKELLER * KUeHLREGELUNG';
        const title    = isKettle ? 'Braukessel' : `Kuehltank ${tankId}`;
        const statusColor = this._getStatusColor(id);

        const H = 88;
        const ctx2 = ctx;

        // Hintergrund Header
        ctx2.fillStyle = 'rgba(10,20,40,0.6)';
        ctx2.fillRect(0, 7, CW, H);
        ctx2.strokeStyle = C.border;
        ctx2.lineWidth = 1;
        ctx2.beginPath(); ctx2.moveTo(0, 7 + H); ctx2.lineTo(CW, 7 + H); ctx2.stroke();

        // Icon-Kreis
        const iconX = 58, iconY = 7 + H/2;
        ctx2.fillStyle = 'rgba(77,180,255,0.15)';
        ctx2.beginPath(); ctx2.arc(iconX, iconY, 28, 0, Math.PI*2); ctx2.fill();
        ctx2.strokeStyle = C.accent;
        ctx2.lineWidth = 1.5;
        ctx2.beginPath(); ctx2.arc(iconX, iconY, 28, 0, Math.PI*2); ctx2.stroke();
        ctx2.fillStyle = C.accent;
        ctx2.font = 'bold 22px monospace';
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'middle';
        ctx2.fillText(iconText, iconX, iconY);

        // Eyebrow
        ctx2.fillStyle = C.textLo;
        ctx2.font = '600 18px sans-serif';
        ctx2.textAlign = 'left';
        ctx2.textBaseline = 'alphabetic';
        ctx2.fillText(eyebrow, 104, 7 + 32);

        // Titel
        ctx2.fillStyle = C.textHi;
        ctx2.font = 'bold 38px sans-serif';
        ctx2.fillText(title, 104, 7 + 72);

        // Mode-Toggle-Button (oben rechts, direkt neben Schliessen wie im Overlay)
        const toggleW = 130, toggleH = 30;
        // Close-Button: x = CW - 52, R = 22 -> linke Kante bei CW-74
        const toggleX = CW - 74 - 8 - toggleW;
        const toggleY = 7 + (88 - toggleH) / 2;  // Vertikal zentriert im Header

        // Status-Badge links vom Toggle mit Abstand (verhindert Ueberlappung)
        const badgeW = 120, badgeH = 32;
        const badgeX = toggleX - 14 - badgeW;
        const badgeY = 7 + (H - badgeH) / 2;
        const status = this._getStatus(id);
        ctx2.fillStyle = statusColor + '33';  // 20% alpha
        ctx2.strokeStyle = statusColor;
        ctx2.lineWidth = 1.5;
        this._roundRect(badgeX, badgeY, badgeW, badgeH, 6);
        ctx2.fillStyle = statusColor;
        ctx2.font = 'bold 16px monospace';
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'middle';
        ctx2.fillText(this._statusLabel(status), badgeX + badgeW/2, badgeY + badgeH/2);

        const modeLabel = this._onModeToggle
            ? (this._currentModeLabel || '3d')
            : '';
        if (modeLabel) {
            ctx2.fillStyle = 'rgba(77,180,255,0.12)';
            ctx2.strokeStyle = 'rgba(77,180,255,0.4)';
            ctx2.lineWidth = 1.2;
            this._roundRect(toggleX, toggleY, toggleW, toggleH, 5);
            ctx2.fillStyle = 'rgba(77,180,255,0.9)';
            ctx2.font = '600 13px monospace';
            ctx2.textAlign = 'center';
            ctx2.textBaseline = 'middle';
            // Zeigt an, worauf gewechselt wird
            const label = modeLabel === '3d' ? '▦ Overlay' : '▢ Wand 3D';
            ctx2.fillText(label, toggleX + toggleW/2, toggleY + toggleH/2);
            this._hitAreas.push({
                x: toggleX, y: toggleY, w: toggleW, h: toggleH,
                action: 'mode-toggle',
                callback: () => { if (this._onModeToggle) this._onModeToggle(); },
            });
        }

        return 7 + H;  // untere Kante
    }

    _drawMetrics(id, values, top) {
        const ctx = this._ctx;
        const isKettle = id === 'brewkettle';
        const tankId   = isKettle ? null : parseInt(id.replace('tank-', ''), 10);

        // Metriken-Definition
        let defs;
        if (isKettle) {
            const bv = BREWKETTLE_VARS;
            defs = [
                { label: 'IST-TEMP',    val: values[bv.ist]?.val,  meta: BK_ROLE_META.ist,  big: true  },
                { label: 'SOLL-TEMP',   val: values[bv.soll]?.val, meta: BK_ROLE_META.soll, big: true  },
                { label: 'HEIZUNG',     val: values[bv.heat]?.val, meta: BK_ROLE_META.heat            },
                { label: 'MODUS',       val: values[bv.auto]?.val, meta: BK_ROLE_META.auto            },
                { label: 'STEUERUNG',   val: values[bv.ein]?.val,  meta: BK_ROLE_META.ein             },
            ];
        } else {
            const v = varsForTank(tankId);
            defs = [
                { label: 'IST-TEMP',    val: values[v.ist]?.val,    meta: TANK_ROLE_META.ist,    big: true },
                { label: 'SOLL-TEMP',   val: values[v.soll]?.val,   meta: TANK_ROLE_META.soll,   big: true },
                { label: 'VENTIL',      val: values[v.ventil]?.val, meta: TANK_ROLE_META.ventil            },
                { label: 'MODUS',       val: values[v.auto]?.val,   meta: TANK_ROLE_META.auto              },
                { label: 'KUeHLREGELUNG',val: values[v.ein]?.val,    meta: TANK_ROLE_META.ein               },
                { label: 'HAND-VENTIL', val: values[v.hand]?.val,   meta: TANK_ROLE_META.hand              },
            ];
        }

        const count = defs.length;
        const cellW = CW / count;
        const H = 110;

        defs.forEach((def, i) => {
            const x = i * cellW;

            // Zell-Hintergrund
            ctx.fillStyle = i % 2 === 0 ? 'rgba(10,20,40,0.4)' : 'rgba(14,28,52,0.4)';
            ctx.fillRect(x, top, cellW, H);

            // Trennlinie rechts
            if (i < count - 1) {
                ctx.strokeStyle = C.border;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(x + cellW, top + 10);
                ctx.lineTo(x + cellW, top + H - 10);
                ctx.stroke();
            }

            // Label
            ctx.fillStyle = C.textLo;
            ctx.font = '600 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(def.label, x + cellW/2, top + 26);

            // Wert
            const formatted = this._formatVal(def.val, def.meta);
            const isBig = def.big;
            const valColor = this._valColor(def.val, def.meta, i);

            ctx.fillStyle = valColor;
            ctx.font = `bold ${isBig ? '38' : '26'}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(formatted, x + cellW/2, top + (isBig ? 76 : 68));

            // Einheit
            if (def.meta.type === 'float' && def.meta.unit && def.val != null) {
                ctx.fillStyle = C.textLo;
                ctx.font = '16px sans-serif';
                ctx.fillText(def.meta.unit, x + cellW/2, top + H - 12);
            }
        });

        // Untere Trennlinie
        ctx.strokeStyle = C.border;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, top + H); ctx.lineTo(CW, top + H); ctx.stroke();

        return H;
    }

    _drawRegBar(id, values, top) {
        const ctx = this._ctx;
        const isKettle = id === 'brewkettle';
        const H = 40;

        let active = false, label = '--', pct = 0;
        if (isKettle) {
            const ein  = isActive(values[BREWKETTLE_VARS.ein]?.val);
            const heat = values[BREWKETTLE_VARS.heat]?.val ?? 0;
            active = ein && heat > 0.5;
            label  = active ? 'Heizung aktiv' : (ein ? 'Heizung inaktiv' : 'Steuerung aus');
            pct    = heat * 100;
        } else {
            const tankId = parseInt(id.replace('tank-', ''), 10);
            const v      = varsForTank(tankId);
            const ein    = isActive(values[v.ein]?.val);
            const vent   = isActive(values[v.ventil]?.val);
            active = ein && vent;
            label  = active ? 'Kuehlung aktiv * Ventil offen' : (ein ? 'Kuehlung bereit * Ventil geschlossen' : 'Kuehlregelung aus');
            pct    = vent ? 100 : 0;
        }

        ctx.fillStyle = 'rgba(10,20,40,0.5)';
        ctx.fillRect(0, top, CW, H);

        // Fortschritts-Balken
        if (active) {
            const barW = (pct / 100) * (CW - 40);
            const barColor = isKettle ? C.copper : C.accent;
            ctx.fillStyle = barColor + '22';
            ctx.fillRect(20, top + H/2 - 3, CW - 40, 6);
            ctx.fillStyle = barColor;
            ctx.fillRect(20, top + H/2 - 3, barW, 6);
        }

        // Puls-Dot
        const dotR = 5;
        const dotX = 24;
        const dotY = top + H/2;
        const pulse = Math.sin(this._elapsed * 4) * 0.5 + 0.5;
        ctx.fillStyle = active ? (isKettle ? C.copper : C.accent) : C.idle;
        if (active) {
            ctx.shadowColor = isKettle ? C.copper : C.accent;
            ctx.shadowBlur  = 10 + pulse * 8;
        }
        ctx.beginPath(); ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // Text
        ctx.fillStyle = active ? C.textHi : C.textLo;
        ctx.font = '15px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 38, top + H/2);

        ctx.strokeStyle = C.border;
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, top + H); ctx.lineTo(CW, top + H); ctx.stroke();

        return H;
    }

    _drawRangeTabs(top) {
        const ctx = this._ctx;
        const H = 44;
        const labelW = 70;
        const startX = 120;  // nach Label "ZEITRAUM"

        ctx.fillStyle = C.textLo;
        ctx.font = '600 13px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('ZEITRAUM', 20, top + H/2);

        RANGES.forEach((r, i) => {
            const x = startX + i * (labelW + 8);
            const y = top + 6;
            const w = labelW, h = H - 12;
            const isActive = r.key === this._range;

            ctx.fillStyle = isActive ? C.accent + '30' : 'rgba(255,255,255,0.04)';
            ctx.strokeStyle = isActive ? C.accent : 'rgba(255,255,255,0.12)';
            ctx.lineWidth = isActive ? 1.5 : 1;
            this._roundRect(x, y, w, h, 4);

            ctx.fillStyle = isActive ? C.accent : C.textMid;
            ctx.font = `${isActive ? '600' : '500'} 16px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(r.label, x + w/2, y + h/2);

            // Hit-Area registrieren
            this._hitAreas.push({
                x, y, w, h,
                action: `range-${r.key}`,
                callback: () => {
                    this._range = r.key;
                    this._chartData = null;
                    this._loadSeries(this._currentId);
                },
            });
        });
    }

    _drawChart(top, availH) {
        const ctx = this._ctx;
        const d   = this._chartData;
        const H   = Math.max(180, availH);
        // Aeussere Chart-Box
        const boxL = 20, boxR = CW - 20;
        const boxT = top, boxB = top + H - 4;
        // Innerer Plot-Bereich (Padding fuer Achsen-Beschriftung)
        const padL = 68, padR = 14, padT = 14, padB = 26;
        const x0  = boxL + padL, x1 = boxR - padR;
        const y0  = boxT + padT, y1 = boxB - padB;
        const w   = x1 - x0, h = y1 - y0;

        // Chart-Hintergrund (aeusserer Rahmen)
        ctx.fillStyle = 'rgba(4,12,28,0.7)';
        ctx.strokeStyle = C.border;
        ctx.lineWidth = 1;
        this._roundRect(boxL, boxT, boxR - boxL, boxB - boxT, 4);

        if (!d || (!d.ist?.length && !d.soll?.length)) {
            ctx.fillStyle = C.textLo;
            ctx.font = '18px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const dots = '.'.repeat(1 + Math.floor(this._elapsed * 2) % 3);
            ctx.fillText(`Lade${dots}`, x0 + w/2, y0 + h/2);
            return;
        }

        const ist  = d.ist || [], soll = d.soll || [], regul = d.regul || [];
        const allPts = ist.concat(soll);
        if (!allPts.length) return;

        const xs = allPts.map(p => p[0]), ys = allPts.map(p => p[1]);
        const xMin = Math.min(...xs), xMax = Math.max(...xs);
        let yMin = Math.min(...ys), yMax = Math.max(...ys);
        if (yMin === yMax) { yMin -= 1; yMax += 1; }
        const yPad = (yMax - yMin) * 0.15;
        yMin -= yPad; yMax += yPad;

        const xS = t  => x0 + ((t - xMin) / (xMax - xMin || 1)) * w;
        const yS = v  => y0 + (1 - (v - yMin) / (yMax - yMin || 1)) * h;

        // Y-Achse Gitterlinien
        ctx.lineWidth = 0.5;
        ctx.font = '11px monospace';
        for (let i = 0; i <= 4; i++) {
            const v = yMin + (i / 4) * (yMax - yMin);
            const y = yS(v);
            ctx.strokeStyle = 'rgba(77,180,255,0.07)';
            ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
            ctx.fillStyle = C.textLo;
            ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            ctx.fillText(v.toFixed(1) + ' °C', x0 - 8, y);
        }

        // X-Achse Beschriftung (innerhalb des Chart-Rahmens)
        const span = xMax - xMin;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let i = 0; i <= 4; i++) {
            const ts = xMin + (i / 4) * span;
            const dt = new Date(ts);
            const label = span <= 6*3600e3
                ? dt.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})
                : span <= 24*3600e3
                ? dt.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})
                : dt.toLocaleDateString('de-DE', {day:'2-digit', month:'2-digit'});
            ctx.fillStyle = C.textLo;
            ctx.fillText(label, xS(ts), y1 + 6);
        }

        // Regelungs-Band
        if (regul.length) {
            const isKettle = this._currentId === 'brewkettle';
            ctx.fillStyle = isKettle ? 'rgba(200,115,65,0.20)' : 'rgba(77,180,255,0.15)';
            for (let i = 0; i < regul.length - 1; i++) {
                if (regul[i][1] > 0.5) {
                    const rx = xS(regul[i][0]);
                    const rw = Math.max(1, xS(regul[i+1][0]) - rx);
                    ctx.fillRect(rx, y0, rw, h);
                }
            }
        }

        // Soll-Linie (gestrichelt, blau)
        if (soll.length) {
            ctx.strokeStyle = '#4d8bd1'; ctx.lineWidth = 2;
            ctx.setLineDash([7, 5]);
            ctx.beginPath();
            soll.forEach((p, i) => { i===0 ? ctx.moveTo(xS(p[0]), yS(p[1])) : ctx.lineTo(xS(p[0]), yS(p[1])); });
            ctx.stroke(); ctx.setLineDash([]);
        }

        // Ist-Linie (Kupfer, mit Fuellung)
        if (ist.length) {
            // Fuellung
            const fillGrad = ctx.createLinearGradient(0, y0, 0, y1);
            fillGrad.addColorStop(0, 'rgba(200,115,65,0.30)');
            fillGrad.addColorStop(1, 'rgba(200,115,65,0.02)');
            ctx.beginPath();
            ist.forEach((p, i) => { i===0 ? ctx.moveTo(xS(p[0]), yS(p[1])) : ctx.lineTo(xS(p[0]), yS(p[1])); });
            ctx.lineTo(xS(ist[ist.length-1][0]), y1);
            ctx.lineTo(xS(ist[0][0]), y1);
            ctx.closePath();
            ctx.fillStyle = fillGrad;
            ctx.fill();

            // Linie
            ctx.strokeStyle = C.copper; ctx.lineWidth = 2.5;
            ctx.beginPath();
            ist.forEach((p, i) => { i===0 ? ctx.moveTo(xS(p[0]), yS(p[1])) : ctx.lineTo(xS(p[0]), yS(p[1])); });
            ctx.stroke();

            // Letzter Punkt (Leuchtpunkt)
            const last = ist[ist.length - 1];
            ctx.fillStyle   = '#ff9d5c';
            ctx.shadowColor = C.copper;
            ctx.shadowBlur  = 12 + Math.sin(this._elapsed * 3) * 4;
            ctx.beginPath(); ctx.arc(xS(last[0]), yS(last[1]), 5, 0, Math.PI*2); ctx.fill();
            ctx.shadowBlur = 0;

            // Legende
            this._drawLegend(x0, y0 - 6);
        }

        // Statistik-Overlay im Chart entfernt (verdeckt Datenkurve)
    }

    _drawLegend(x, y) {
        const ctx = this._ctx;
        const isKettle = this._currentId === 'brewkettle';
        const items = [
            { color: C.copper,  label: 'Ist-Temp.' },
            { color: '#4d8bd1', label: 'Soll-Temp.', dash: true },
            { color: isKettle ? 'rgba(200,115,65,0.45)' : 'rgba(77,180,255,0.35)', label: isKettle ? 'Heizung aktiv' : 'Ventil offen' },
        ];
        let lx = x + 8;
        items.forEach(item => {
            ctx.strokeStyle = item.color;
            ctx.lineWidth   = 2;
            if (item.dash) ctx.setLineDash([5, 3]);
            ctx.beginPath(); ctx.moveTo(lx, y + 6); ctx.lineTo(lx + 22, y + 6); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle   = C.textLo;
            ctx.font        = '13px sans-serif';
            ctx.textAlign   = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(item.label, lx + 26, y + 6);
            lx += 26 + ctx.measureText(item.label).width + 20;
        });
    }

    _drawStats(ist, soll, y) {
        const ctx  = this._ctx;
        const vals = ist.map(p => p[1]);
        const min  = Math.min(...vals), max = Math.max(...vals);
        const avg  = vals.reduce((s, v) => s+v, 0) / vals.length;
        const sd   = Math.sqrt(vals.reduce((s, v) => s+(v-avg)**2, 0) / vals.length);
        const sollVals = soll.map(p => p[1]).filter(v => v != null);
        const avgDelta = sollVals.length ? avg - sollVals.reduce((s,v)=>s+v,0)/sollVals.length : null;

        const stats = [
            { label: 'v Min',   val: min.toFixed(1) + '  GradC' },
            { label: '_ Avg',   val: avg.toFixed(1) + '  GradC' },
            { label: '^ Max',   val: max.toFixed(1) + '  GradC' },
            { label: 'sigma',       val: sd.toFixed(2) },
            ...(avgDelta != null ? [{ label: '_ _ Soll', val: (avgDelta >= 0 ? '+' : '') + avgDelta.toFixed(1) + '  GradC', color: Math.abs(avgDelta) > 3 ? C.warn : C.textMid }] : []),
        ];

        const cellW = (CW - 72) / stats.length;
        stats.forEach((s, i) => {
            const cx = 56 + i * cellW + cellW / 2;
            ctx.fillStyle = C.textLo; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(s.label, cx, y + 14);
            ctx.fillStyle = s.color || C.textMid; ctx.font = '600 14px monospace';
            ctx.fillText(s.val, cx, y + 30);
        });
    }

    _drawScanLines() {
        // Deaktiviert - stoerende horizontale Streifen im 3D-Modus
    }

    _drawCloseBtn() {
        const ctx = this._ctx;
        const R = 22, x = CW - 52, y = 28;

        ctx.fillStyle   = 'rgba(226,83,59,0.15)';
        ctx.strokeStyle = 'rgba(226,83,59,0.5)';
        ctx.lineWidth   = 1.5;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill(); ctx.stroke();

        ctx.fillStyle = 'rgba(226,83,59,0.9)';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('x', x, y + 1);

        this._hitAreas.push({
            x: x - R, y: y - R, w: R * 2, h: R * 2,
            action: 'close',
            callback: () => this.close(),
        });
    }

    // __ Hilfsmethoden ____________________________________________

    _roundRect(x, y, w, h, r) {
        const ctx = this._ctx;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    _getStatus(id) {
        const v = this._liveValues;
        if (id === 'brewkettle') {
            const ein  = isActive(v[BREWKETTLE_VARS.ein]?.val);
            const ist  = v[BREWKETTLE_VARS.ist]?.val;
            const soll = v[BREWKETTLE_VARS.soll]?.val;
            return ein ? classifyStatus(ist, soll, 'brewkettle') : 'idle';
        } else {
            const tankId = parseInt(id.replace('tank-', ''), 10);
            const vt = varsForTank(tankId);
            const ein = isActive(v[vt.ein]?.val);
            return ein ? classifyStatus(v[vt.ist]?.val, v[vt.soll]?.val, 'tank') : 'idle';
        }
    }

    _getStatusColor(id) { return STATUS_COLOR[this._getStatus(id)] || C.idle; }

    _statusLabel(s) {
        return { ok:'OK', warn:'WARNUNG', crit:'KRITISCH', idle:'INAKTIV' }[s] || s.toUpperCase();
    }

    _formatVal(raw, meta) {
        if (raw == null || Number.isNaN(+raw)) return '--';
        if (meta.type === 'bool') return +raw > 0.5 ? (meta.trueText || 'AN') : (meta.falseText || 'AUS');
        return (+raw).toFixed(1);
    }

    _valColor(raw, meta, index) {
        if (index === 0) return C.copper;   // Ist-Temp
        if (index === 1) return '#7bc9ff';  // Soll-Temp
        if (meta.type === 'bool') {
            if (raw == null) return C.textLo;
            const on = +raw > 0.5;
            if (meta.key === 'ein') return on ? C.green : C.idle;
            return on ? C.accent : C.textMid;
        }
        return C.textHi;
    }

    // __ Daten laden ______________________________________________


    // ----------------------------------------------------------------
    // Brautag-Anzeige (an der Wand)
    // ----------------------------------------------------------------

    async openBrewDay(day, liveValues = {}) {
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
        this._currentId  = 'brewkettle';
        this._liveValues = liveValues;
        this._chartData  = null;
        this._brewDay    = day;

        this._positionForId('brewkettle');
        this._mesh.visible  = true;
        this._frame.visible = true;
        this._mesh.scale.set(0.1, 0.1, 1);
        this._animateIn();

        LOG('Oeffne Brautag:', day.date);
        this._drawBrewDayLoading(day);
        this._updateTexture();

        document.addEventListener('keydown', this._escHandler = e => {
            if (e.key === 'Escape' && this.isOpen()) this.close();
        });

        await this._loadBrewDaySeries(day);
    }

    _drawBrewDayLoading(day) {
        const ctx = this._ctx;
        ctx.clearRect(0, 0, CW, CH);
        this._drawBackground();

        // Header
        const topBar = ctx.createLinearGradient(0, 0, CW, 0);
        topBar.addColorStop(0,   'rgba(200,115,65,0.9)');
        topBar.addColorStop(0.5, 'rgba(232,165,111,0.95)');
        topBar.addColorStop(1,   'rgba(200,115,65,0.9)');
        ctx.fillStyle = topBar;
        ctx.fillRect(0, 0, CW, 7);

        ctx.fillStyle = 'rgba(10,20,40,0.6)';
        ctx.fillRect(0, 7, CW, 88);

        ctx.fillStyle = 'rgba(200,115,65,0.8)';
        ctx.font = 'bold 42px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('BK', 58, 51);

        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '600 16px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('BRAUKESSEL - BRAUTAG', 104, 30);

        ctx.fillStyle = '#e8f4ff';
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText(this._formatDateLong(day.date), 104, 72);

        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '20px monospace';
        ctx.textAlign = 'center';
        const dots = '.'.repeat(1 + Math.floor(this._elapsed * 2) % 3);
        ctx.fillText('Lade Heizphasen' + dots, CW / 2, CH * 0.55);
        this._drawScanLines();
        this._drawCloseBtn();
    }

    async _loadBrewDaySeries(day) {
        this._brewDayActive = true;   // Brautag-Modus aktiv - updateLive sperren
        this._phasesScroll  = 0;      // Scroll-Position der Phasenliste zuruecksetzen
        // Live-Refresh anhalten, damit die Brautag-Ansicht persistent bleibt
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
        try {
            LOG('Lade Brautag-Details:', day.date);
            const res  = await dataService._request({ action: 'brew_days', date: day.date });
            const find = n => res.series?.find(s => s.name === n)?.data || [];
            let ist   = find('BK_Ist');
            let soll  = find('BK_Soll');
            let regul = find('BK_A_H');

            // Auf den tatsaechlichen Brauprozess-Zeitraum zuschneiden
            // (5 Min Puffer vor Start und nach Ende), damit die Skala sinnvoll ist.
            if (day.start_ms && day.end_ms) {
                const pad = 5 * 60_000;
                const from = day.start_ms - pad, to = day.end_ms + pad;
                const inRange = p => p[0] >= from && p[0] <= to;
                ist   = ist.filter(inRange);
                soll  = soll.filter(inRange);
                regul = regul.filter(inRange);
            }

            this._chartData = { ist, soll, regul, regulLabel: 'Heizung' };
            this._brewDayMeta = day;
            LOG(day.date + ': ' + ist.length + ' Punkte im Brauzeitraum');
        } catch (err) {
            WARN('Brautag:', err);
            this._chartData = { ist: [], soll: [], regul: [] };
        }
        this._drawBrewDayFull();
        this._updateTexture();
    }

    _drawBrewDayFull() {
        const ctx = this._ctx;
        const day = this._brewDayMeta;
        ctx.clearRect(0, 0, CW, CH);
        this._drawBackground();
        this._hitAreas = [];

        // Kupfer-Leiste
        const topBar = ctx.createLinearGradient(0, 0, CW, 0);
        topBar.addColorStop(0, 'rgba(200,115,65,0.9)');
        topBar.addColorStop(0.5, 'rgba(232,165,111,0.95)');
        topBar.addColorStop(1, 'rgba(200,115,65,0.9)');
        ctx.fillStyle = topBar;
        ctx.fillRect(0, 0, CW, 7);

        // Header
        ctx.fillStyle = 'rgba(10,20,40,0.6)';
        ctx.fillRect(0, 7, CW, 88);
        ctx.fillStyle = 'rgba(200,115,65,0.8)';
        ctx.font = 'bold 40px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('BK', 58, 51);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '600 14px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('BRAUKESSEL - HEIZPHASEN-ANALYSE', 104, 30);
        ctx.fillStyle = '#e8f4ff';
        ctx.font = 'bold 26px sans-serif';
        ctx.fillText(this._formatDateLong(day.date), 104, 62);
        // Zeit-Zeile
        ctx.fillStyle = '#7bc9ff';
        ctx.font = 'bold 18px monospace';
        ctx.fillText(this._fmtTime(day.start_ms) + ' - ' + this._fmtTime(day.end_ms), 104, 86);

        // Zurueck-Button oben rechts (statt Mode-Toggle in dieser Ansicht)
        const backW = 130, backH = 30;
        const backX = CW - 74 - 8 - backW;
        const backY = 7 + (88 - backH) / 2;
        ctx.fillStyle = 'rgba(77,180,255,0.12)';
        ctx.strokeStyle = 'rgba(77,180,255,0.4)';
        ctx.lineWidth = 1.2;
        this._roundRect(backX, backY, backW, backH, 5);
        ctx.fillStyle = 'rgba(77,180,255,0.9)';
        ctx.font = '600 13px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('‹ Zur Liste', backX + backW/2, backY + backH/2);
        this._hitAreas.push({
            x: backX, y: backY, w: backW, h: backH,
            action: 'brewday-back',
            callback: () => {
                this._brewDayActive = false;
                this._selectedBrewDay = null;
                this._brewDayMeta = null;
                this._bkTab = 'brewdays';
                // Auto-Refresh wiederherstellen (war beim Klick auf Brautag gestoppt)
                if (!this._refreshTimer && this._currentId) {
                    const id = this._currentId;
                    this._refreshTimer = setInterval(() => {
                        if (this._brewDayActive) return;
                        this._loadSeries(id);
                    }, 15_000);
                }
                // Sofort Brautage-Liste zeichnen
                this._drawFull();
                this._updateTexture();
            },
        });

        // Stat-Kacheln (kompakter)
        const stats = [
            { lbl: 'DAUER',      val: this._fmtDur(day.duration_min) },
            { lbl: 'MAX TEMP',   val: day.peak_temp != null ? day.peak_temp + ' °C' : '--' },
            { lbl: 'AVG TEMP',   val: day.avg_temp  != null ? (+day.avg_temp).toFixed(1) + ' °C' : '--' },
            { lbl: 'HEIZPHASEN', val: this._countPhases(this._chartData?.regul || []) + '' },
        ];
        const statY = 104, statH = 46;
        stats.forEach((s, i) => {
            const sx = i * (CW / 4);
            ctx.fillStyle = i % 2 === 0 ? 'rgba(10,20,40,0.5)' : 'rgba(14,26,50,0.5)';
            ctx.fillRect(sx, statY, CW / 4, statH);
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = '600 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(s.lbl, sx + CW / 8, statY + 16);
            ctx.fillStyle = '#c87341';
            ctx.font = 'bold 20px monospace';
            ctx.fillText(s.val, sx + CW / 8, statY + 40);
        });
        ctx.strokeStyle = C.borderSoft;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, statY + statH); ctx.lineTo(CW, statY + statH); ctx.stroke();

        // ---- Kleineres Chart (obere Haelfte des restlichen Platzes) ----
        const chartTop  = statY + statH + 8;
        const chartH    = 244;   // fixe kleinere Hoehe
        this._drawChart(chartTop, chartH);

        // ---- Heizphasen als Textliste (untere Haelfte, scrollbar) ----
        this._drawHeizphasenList(
            this._chartData?.regul || [],
            this._chartData?.ist   || [],
            chartTop + chartH + 8
        );

        this._drawCloseBtn();
    }

    _drawHeizphasenList(heatData, istData, top) {
        const ctx = this._ctx;
        const listBottom = CH - 14;
        const listH = listBottom - top;
        if (listH < 60) return;

        const phases = this._detectPhases(heatData, istData);

        // Titel
        ctx.fillStyle = C.textLo;
        ctx.font = '600 12px sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(`HEIZPHASEN (${phases.length})`, 24, top + 16);
        ctx.strokeStyle = C.borderSoft;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(24, top + 22); ctx.lineTo(CW - 80, top + 22); ctx.stroke();

        if (!phases.length) {
            ctx.fillStyle = C.textLo;
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('Keine Heizphasen erkannt.', CW / 2, top + listH / 2);
            return;
        }

        // Scrollbereich
        const listY0  = top + 32;
        const listY1  = listBottom;
        const rowH    = 40;
        const arrowW  = 44;
        const rowsPerPage = Math.max(1, Math.floor((listY1 - listY0) / rowH));
        if (this._phasesScroll == null) this._phasesScroll = 0;
        const maxScroll = Math.max(0, phases.length - rowsPerPage);
        if (this._phasesScroll > maxScroll) this._phasesScroll = maxScroll;

        const rowX = 24;
        const rowW = CW - 48 - arrowW - 8;

        const visible = phases.slice(this._phasesScroll, this._phasesScroll + rowsPerPage);
        visible.forEach((p, i) => {
            const idx = this._phasesScroll + i;
            const ry  = listY0 + i * rowH;

            // Zeilen-Hintergrund (dezent gestreift)
            ctx.fillStyle = idx % 2 === 0 ? 'rgba(10,20,40,0.35)' : 'rgba(14,26,50,0.35)';
            ctx.fillRect(rowX, ry, rowW, rowH - 4);

            // Farb-Punkt
            ctx.fillStyle = C.copper;
            ctx.beginPath(); ctx.arc(rowX + 14, ry + rowH/2 - 2, 5, 0, Math.PI*2); ctx.fill();

            // Phase-Nr + Zeit
            ctx.fillStyle = C.textHi;
            ctx.font = '600 14px sans-serif';
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(`Phase ${idx + 1}`, rowX + 30, ry + rowH/2 - 2);

            ctx.fillStyle = '#7bc9ff';
            ctx.font = 'bold 14px monospace';
            ctx.fillText(this._fmtTime(p.start) + ' → ' + this._fmtTime(p.end),
                rowX + 130, ry + rowH/2 - 2);

            // Dauer
            ctx.fillStyle = C.textMid;
            ctx.font = '13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(p.dur + ' min', rowX + rowW * 0.72, ry + rowH/2 - 2);

            // Max-Temperatur
            const maxT = p.maxTemp != null ? p.maxTemp.toFixed(1) + ' °C max' : '--';
            ctx.fillStyle = C.copper;
            ctx.font = 'bold 13px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(maxT, rowX + rowW - 12, ry + rowH/2 - 2);
        });

        // Scroll-Pfeile rechts
        const arrowX  = CW - 24 - arrowW;
        const arrowUpY = listY0;
        const arrowH   = Math.min(rowH - 6, (listY1 - listY0) / 2 - 8);
        const arrowDnY = listY1 - arrowH;

        const canUp = this._phasesScroll > 0;
        const canDn = this._phasesScroll < maxScroll;

        const drawArrow = (x, y, w, h, dir, enabled) => {
            ctx.fillStyle   = enabled ? 'rgba(77,180,255,0.15)' : 'rgba(255,255,255,0.03)';
            ctx.strokeStyle = enabled ? 'rgba(77,180,255,0.4)'  : 'rgba(255,255,255,0.06)';
            ctx.lineWidth   = 1.2;
            this._roundRect(x, y, w, h, 5);
            ctx.fillStyle = enabled ? C.accent : C.textLo;
            ctx.font = 'bold 22px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(dir === 'up' ? '▲' : '▼', x + w/2, y + h/2);
        };
        drawArrow(arrowX, arrowUpY, arrowW, arrowH, 'up', canUp);
        drawArrow(arrowX, arrowDnY, arrowW, arrowH, 'down', canDn);

        if (canUp) {
            this._hitAreas.push({
                x: arrowX, y: arrowUpY, w: arrowW, h: arrowH,
                action: 'phase-scroll-up',
                callback: () => {
                    this._phasesScroll = Math.max(0, this._phasesScroll - rowsPerPage);
                    this._drawBrewDayFull();
                    this._updateTexture();
                },
            });
        }
        if (canDn) {
            this._hitAreas.push({
                x: arrowX, y: arrowDnY, w: arrowW, h: arrowH,
                action: 'phase-scroll-down',
                callback: () => {
                    this._phasesScroll = Math.min(maxScroll, this._phasesScroll + rowsPerPage);
                    this._drawBrewDayFull();
                    this._updateTexture();
                },
            });
        }

        // Positionsindikator
        if (phases.length > rowsPerPage) {
            const indX  = arrowX + arrowW / 2;
            const indY0 = arrowUpY + arrowH + 6;
            const indY1 = arrowDnY - 6;
            ctx.strokeStyle = 'rgba(77,180,255,0.15)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(indX, indY0); ctx.lineTo(indX, indY1); ctx.stroke();
            const frac = maxScroll === 0 ? 0 : this._phasesScroll / maxScroll;
            const thumbY = indY0 + frac * (indY1 - indY0 - 20);
            ctx.fillStyle = C.accent;
            this._roundRect(indX - 4, thumbY, 8, 20, 3);
        }
    }

    _detectPhases(heatData, istData) {
        const phases = [];
        let start = null;
        for (let i = 0; i < heatData.length; i++) {
            const [ts, val] = heatData[i];
            if (val > 0.5 && !start) start = ts;
            else if (val <= 0.5 && start) {
                const end = heatData[i-1]?.[0] ?? ts;
                const dur = Math.round((end - start) / 60000);
                if (dur >= 1) {
                    // Max-Temp in diesem Zeitraum finden
                    let maxTemp = null;
                    for (const p of istData) {
                        if (p[0] < start) continue;
                        if (p[0] > end) break;
                        if (maxTemp == null || p[1] > maxTemp) maxTemp = p[1];
                    }
                    phases.push({ start, end, dur, maxTemp });
                }
                start = null;
            }
        }
        // Laufende Phase am Ende?
        if (start != null) {
            const end = heatData[heatData.length - 1][0];
            const dur = Math.round((end - start) / 60000);
            if (dur >= 1) {
                let maxTemp = null;
                for (const p of istData) {
                    if (p[0] < start) continue;
                    if (p[0] > end) break;
                    if (maxTemp == null || p[1] > maxTemp) maxTemp = p[1];
                }
                phases.push({ start, end, dur, maxTemp });
            }
        }
        return phases;
    }

    _countPhases(heatData) {
        return this._detectPhases(heatData, []).length;
    }

    _formatDateLong(dateStr) {
        if (!dateStr) return '--';
        const d = new Date(dateStr + 'T12:00:00');
        return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    _fmtDur(min) {
        if (!min) return '--';
        const h = Math.floor(min / 60), m = min % 60;
        return h > 0 ? h + 'h ' + (m > 0 ? m + 'm' : '') : m + ' min';
    }

    async _loadSeries(id) {
        const isKettle = id === 'brewkettle';
        let names;
        if (isKettle) {
            names = [BREWKETTLE_VARS.ist, BREWKETTLE_VARS.soll, BREWKETTLE_VARS.heat];
        } else {
            const v = varsForTank(parseInt(id.replace('tank-', ''), 10));
            names = [v.ist, v.soll, v.ventil];
        }

        try {
            LOG(`Lade Zeitreihe (${this._range}) fuer ${id}`);
            const res   = await dataService.fetchSeries(names, { range: this._range, maxPoints: 700 });
            const find  = n => res.series.find(s => s.name === n)?.data || [];
            this._chartData = {
                ist:        find(names[0]),
                soll:       find(names[1]),
                regul:      find(names[2]),
                regulLabel: isKettle ? 'Heizung' : 'Ventil',
            };
            LOG(`${this._chartData.ist.length} Datenpunkte geladen`);
        } catch (err) {
            WARN('Zeitreihe:', err);
            this._chartData = { ist: [], soll: [], regul: [] };
        }

        this._drawFull();
        this._updateTexture();
    }
}