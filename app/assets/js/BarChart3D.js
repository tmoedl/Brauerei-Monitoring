/**
 * BarChart3D v4 - 3D-Balkendiagramm an der Wand
 *
 * Fixes:
 *  - Variablen-Titel wird nicht mehr auf 12 Zeichen abgeschnitten
 *  - Balkenbeschriftung in dunklem Kupfer statt hellblau (besser lesbar)
 *  - Boolesche Variablen werden hart auf 0 oder MAX_BAR_H geclampt
 *    (kein Zwischenwert moeglich)
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
import { FontLoader } from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/geometries/TextGeometry.js';

const TANKS = [{id:1,x:18,z:0},{id:2,x:34,z:0},{id:3,x:50,z:0},{id:4,x:66,z:0},{id:5,x:82,z:0},{id:6,x:98,z:0}];
function varsForTank(id) { return { ein:'T'+id+'_Ein', auto:'T'+id+'_AM', ist:'T'+id+'_IstT', soll:'T'+id+'_SollT', ventil:'T'+id+'_AV', hand:'T'+id+'_HV' }; }
const THRESHOLDS = { tank:{ deltaWarn:2, deltaCrit:5 }, brewkettle:{ deltaWarn:3, deltaCrit:8 } };
function classifyStatus(ist, soll, kind) {
    if (ist==null||soll==null) return 'idle';
    const d = Math.abs(ist-soll);
    const t = kind==='brewkettle' ? THRESHOLDS.brewkettle : THRESHOLDS.tank;
    return d>=t.deltaCrit ? 'crit' : d>=t.deltaWarn ? 'warn' : 'ok';
}
function isActive(v) { return v != null && +v > 0.5; }

const LOG  = (m, ...a) => console.log('[BarChart3D]', m, ...a);
const WARN = (m, ...a) => console.warn('[BarChart3D]', m, ...a);

//Layout
const BAR_BASE_Y = 28;
const MAX_BAR_H  = 26;
const BAR_W      = 2.8;
const BAR_D      = 2.0;

//Farben - ok ist grün (wie Status-Ampel), nicht blau
const COL = {
    ok:   new THREE.Color(0x4ec57a),
    warn: new THREE.Color(0xf0b73f),
    crit: new THREE.Color(0xe2533b),
    idle: new THREE.Color(0x2a3a4e),
    soll: new THREE.Color(0x7bc9ff),
};

//Dunkles Kupfer fuer Balkenbeschriftung - gut sichtbar gegen die Balken
const LABEL_COLOR_HEX = 0xc87341;

export const TANK_VARIABLES = [
    { key: 'ist',    label: 'Ist-Temperatur',   unit: ' C', type: 'float', min: -5,  max: 25 },
    { key: 'soll',   label: 'Soll-Temperatur',  unit: ' C', type: 'float', min: -5,  max: 25 },
    { key: 'delta',  label: 'Delta (Ist-Soll)', unit: ' C', type: 'float', min: -10, max: 10 },
    { key: 'ventil', label: 'Ventil (Offen/Zu)',unit: '',   type: 'bool'                      },
    { key: 'ein',    label: 'Kuehlregelung',    unit: '',   type: 'bool'                      },
    { key: 'auto',   label: 'Auto-Modus',       unit: '',   type: 'bool'                      },
];

export class BarChart3D {
    constructor(scene) {
        LOG('Konstruktor gestartet');
        this._scene      = scene;
        this._group      = new THREE.Group();
        this._group.visible = false;
        scene.scene.add(this._group);

        this._bars        = new Map();
        this._scaleGroup  = new THREE.Group();
        this._group.add(this._scaleGroup);

        this._mode       = 'ist';
        this._showSoll   = true;
        this._showLabels = true;
        this._currentVar = TANK_VARIABLES[0];
        this._font       = null;

        try { this._buildBars(); }
        catch (e) { console.error('[BarChart3D] _buildBars fehlgeschlagen:', e); }

        this._loadFont().then(font => {
            this._font = font;
            LOG('Font geladen -> baue 3D-Skala');
            this._buildWallScale();
        }).catch(err => {
            WARN('Font-Laden fehlgeschlagen, Fallback auf Linien:', err);
            this._buildWallScaleFallback();
        });

        LOG('Bereit. Variablen:', TANK_VARIABLES.map(v => v.key));
    }

    // ----------------------------------------------------------------
    // Oeffentliche API
    // ----------------------------------------------------------------

    show()      { this._group.visible = true;  }
    hide()      { this._group.visible = false; }
    isVisible() { return this._group.visible; }

    setShowSoll(v) {
        this._showSoll = v;
        this._bars.forEach(b => { if (b.soll) b.soll.visible = v; });
    }

    setShowLabels(v) {
        this._showLabels = v;
        this._bars.forEach(b => { if (b.labelObj) b.labelObj.visible = v; });
    }

    setVariable(key) {
        const varDef = TANK_VARIABLES.find(v => v.key === key);
        if (!varDef) { LOG('Unbekannte Variable:', key); return; }
        this._mode = key;
        this._currentVar = varDef;
        LOG('Variable:', key, varDef.label);
        this._bars.forEach(b => { b.currentH = 0.3; });
        if (this._font) this._buildWallScale();
        else this._buildWallScaleFallback();
    }

    setValues(liveValues) {
        const varDef = this._currentVar;
        TANKS.forEach(t => {
            const v   = varsForTank(t.id);
            const ein  = isActive(liveValues[v.ein]?.val);
            const ist  = liveValues[v.ist]?.val;
            const soll = liveValues[v.soll]?.val;
            const bar  = this._bars.get(t.id);
            if (!bar) return;

            let targetH, displayStr, status;

            //Kuehlregelung aus (ein=false): Balken immer auf 0 - keine Temperatur anzeigen
            if (!ein) {
                targetH    = 0.3;   //hart auf null, nicht die Temperatur
                status     = 'idle';
                displayStr = 'Aus';
            } else {
                switch (this._mode) {
                    case 'ist':
                        displayStr = ist != null ? ist.toFixed(1) + varDef.unit : '--';
                        status     = classifyStatus(ist, soll, 'tank');
                        targetH    = this._toH(ist, varDef.min, varDef.max);
                        break;
                    case 'soll':
                        displayStr = soll != null ? soll.toFixed(1) + varDef.unit : '--';
                        status     = 'ok';
                        targetH    = this._toH(soll, varDef.min, varDef.max);
                        break;
                    case 'delta': {
                        const d = (ist != null && soll != null) ? ist - soll : null;
                        displayStr = d != null ? (d >= 0 ? '+' : '') + d.toFixed(1) + ' C' : '--';
                        status     = d != null ? (Math.abs(d) >= 5 ? 'crit' : Math.abs(d) >= 2 ? 'warn' : 'ok') : 'idle';
                        targetH    = this._toH(d, varDef.min, varDef.max);
                        break;
                    }
                    default: {
                        //Boolesche Variable (Auto-Modus, Ventil etc.): hart auf AN oder AUS
                        //Wenn ein=true aber z.B. Auto-Modus aus: Balken auf 0
                        const raw = liveValues[v[this._mode]]?.val;
                        const on  = isActive(raw);
                        displayStr = on ? 'An' : 'Aus';
                        status     = on ? 'ok' : 'idle';
                        //Hard clamp: entweder volle Hoehe oder 0
                        targetH    = on ? MAX_BAR_H : 0.3;
                        break;
                    }
                }
            }

            bar.targetH = Math.max(0.3, targetH || 0.3);
            bar.status  = status;

            //Soll-Marker
            bar.soll.visible = this._showSoll && soll != null && ein && this._mode === 'ist';
            if (soll != null && ein)
                bar.soll.position.y = BAR_BASE_Y + this._toH(soll, varDef.min, varDef.max);

            if (this._font && bar.labelObj) {
                const labelStr = `T${t.id}: ${displayStr}`;
                if (bar.lastLabelStr !== labelStr || bar.lastStatus !== status) {
                    bar.lastLabelStr = labelStr;
                    bar.lastStatus   = status;

                    while (bar.labelObj.children.length > 0) {
                        const child = bar.labelObj.children[0];
                        bar.labelObj.remove(child);
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) child.material.dispose();
                    }

                    const textGeo = new TextGeometry(labelStr, {
                        font:          this._font,
                        size:          0.8,
                        height:        0.15,
                        curveSegments: 3,
                        bevelEnabled:  false,
                    });
                    textGeo.computeBoundingBox();
                    const w = textGeo.boundingBox.max.x - textGeo.boundingBox.min.x;

                    //Dunkles Kupfer: gut lesbar, kein Hellblau
                    const textMat = new THREE.MeshStandardMaterial({
                        color:             LABEL_COLOR_HEX,
                        emissive:          LABEL_COLOR_HEX,
                        emissiveIntensity: 0.5,
                        roughness:         0.3,
                        metalness:         0.6,
                    });

                    const textMesh = new THREE.Mesh(textGeo, textMat);
                    textMesh.position.set(-w / 2, 0, 0);
                    bar.labelObj.add(textMesh);
                }
            }
        });
    }

    update(dt) {
        if (!this._group.visible) return;
        this._bars.forEach(bar => {
            const diff = bar.targetH - bar.currentH;
            if (Math.abs(diff) > 0.01) bar.currentH += diff * Math.min(1, 3.5 * dt);
            else bar.currentH = bar.targetH;

            const h = Math.max(0.05, bar.currentH);
            bar.mesh.scale.y = h;
            bar.mesh.position.y = BAR_BASE_Y + h / 2;
            bar.cap.position.y  = BAR_BASE_Y + h;

            const col = COL[bar.status] || COL.idle;
            bar.mat.color.lerp(col, 0.12);
            bar.mat.emissive.copy(col).multiplyScalar(
                bar.status === 'crit' ? 0.18 + Math.sin(Date.now() * 0.003) * 0.10 :
                bar.status === 'warn' ? 0.10 : 0.05
            );

            if (bar.labelObj) bar.labelObj.position.y = BAR_BASE_Y + bar.currentH + 3.5;
        });
    }

    // ----------------------------------------------------------------
    // Aufbau: Balken
    // ----------------------------------------------------------------
    _buildBars() {
        const wallZ = (this._scene.wall?.z ?? -14) + 4.5;

        TANKS.forEach(t => {
            const mat = new THREE.MeshStandardMaterial({
                color: COL.idle, emissive: COL.idle, emissiveIntensity: 0.05,
                roughness: 0.45, metalness: 0.55, transparent: true, opacity: 0.92,
            });
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(BAR_W, 1, BAR_D), mat);
            mesh.frustumCulled = false;
            mesh.position.set(t.x, BAR_BASE_Y + 0.5, wallZ);
            mesh.castShadow = true;

            const capMat = new THREE.MeshStandardMaterial({
                color: 0xe0f0ff, emissive: 0x4db8ff, emissiveIntensity: 0.5,
                roughness: 0.15, metalness: 0.75,
            });
            const cap = new THREE.Mesh(new THREE.BoxGeometry(BAR_W + 0.15, 0.28, BAR_D + 0.15), capMat);
            cap.frustumCulled = false;
            cap.position.set(t.x, BAR_BASE_Y + 0.5, wallZ);

            const sollMat = new THREE.MeshBasicMaterial({
                color: COL.soll, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
            });
            const soll = new THREE.Mesh(new THREE.PlaneGeometry(BAR_W + 1.8, 0.3), sollMat);
            soll.frustumCulled = false;
            soll.position.set(t.x, BAR_BASE_Y, wallZ + 0.05);
            soll.visible = false;

            const baseMat = new THREE.MeshBasicMaterial({ color: 0x4db8ff, transparent: true, opacity: 0.25 });
            const base = new THREE.Mesh(new THREE.BoxGeometry(BAR_W + 0.4, 0.1, BAR_D + 0.4), baseMat);
            base.position.set(t.x, BAR_BASE_Y, wallZ);
            base.frustumCulled = false;

            const labelObj = new THREE.Group();
            labelObj.position.set(t.x, BAR_BASE_Y + 4, wallZ);

            [mesh, cap, soll, base, labelObj].forEach(o => this._group.add(o));

            this._bars.set(t.id, {
                mesh, cap, soll, mat, capMat, labelObj,
                targetH: 0.3, currentH: 0.3, status: 'idle',
                lastLabelStr: null, lastStatus: null,
            });
        });
        LOG(`${TANKS.length} Balken an wallZ=${wallZ.toFixed(1)}`);
    }

    // ----------------------------------------------------------------
    // Aufbau: 3D-Textobjekte fuer Skala
    // ----------------------------------------------------------------
    _buildWallScale() {
        while (this._scaleGroup.children.length)
            this._scaleGroup.remove(this._scaleGroup.children[0]);

        const varDef = this._currentVar;
        const isBool = varDef.type === 'bool';

        const vMin  = isBool ? 0   : (varDef.min ?? -2);
        const vMax  = isBool ? 1   : (varDef.max ?? 22);
        const range = vMax - vMin;

        let step;
        if (isBool) { step = 1; }
        else if (range <= 5)   { step = 0.5; }
        else if (range <= 10)  { step = 1;   }
        else if (range <= 20)  { step = 2;   }
        else if (range <= 50)  { step = 5;   }
        else                   { step = 10;  }

        const mainEvery = 2;
        const wallZ  = (this._scene.wall?.z ?? -14) + 2.5;
        const scaleX = TANKS[0].x - BAR_W - 7;

        const txMin  = TANKS[0].x - BAR_W / 2 - 1;
        const txMax  = TANKS[TANKS.length - 1].x + BAR_W / 2 + 1;
        const lineW  = txMax - txMin;
        const lineCX = (txMin + txMax) / 2;

        //Skala-Beschriftung: dunkles Kupfer statt Hellblau
        const textMatMain = new THREE.MeshStandardMaterial({
            color:             0xc87341,
            emissive:          0xc87341,
            emissiveIntensity: 0.55,
            roughness:         0.25,
            metalness:         0.6,
            side:              THREE.DoubleSide,
        });
        //Titel gleiche Farbe wie Skala (kein helles Orange mehr)
        const textMatTitle = new THREE.MeshStandardMaterial({
            color:             0xc87341,
            emissive:          0xc87341,
            emissiveIntensity: 0.55,
            roughness:         0.25,
            metalness:         0.6,
            side:              THREE.DoubleSide,
        });

        const steps = Math.round(range / step);
        for (let i = 0; i <= steps; i++) {
            const val    = vMin + i * step;
            const norm   = (val - vMin) / range;
            const y      = BAR_BASE_Y + norm * MAX_BAR_H;
            const isMain = (i % mainEvery === 0) || i === 0 || i === steps;

            const lineMat = new THREE.MeshBasicMaterial({
                color: isMain ? 0x4db8ff : 0x1a3a5a,
                transparent: true,
                opacity: isMain ? 0.45 : 0.2,
            });
            const line = new THREE.Mesh(
                new THREE.BoxGeometry(lineW, isMain ? 0.12 : 0.06, 0.05), lineMat
            );
            line.position.set(lineCX, y, wallZ);
            line.frustumCulled = false;
            this._scaleGroup.add(line);

            if (isMain && this._font) {
                let label;
                if (isBool) {
                    label = val === 0 ? 'AUS' : 'AN';
                } else {
                    label = step < 1
                        ? val.toFixed(1) + (varDef.unit || '')
                        : val.toFixed(0) + (varDef.unit || '');
                }
                const textGeo = new TextGeometry(label, {
                    font:           this._font,
                    size:           1.4,
                    height:         0.55,
                    curveSegments:  6,
                    bevelEnabled:   true,
                    bevelThickness: 0.06,
                    bevelSize:      0.04,
                    bevelSegments:  3,
                });
                textGeo.computeBoundingBox();
                const textW = textGeo.boundingBox.max.x - textGeo.boundingBox.min.x;

                const textMesh = new THREE.Mesh(textGeo, textMatMain.clone());
                textMesh.position.set(scaleX - textW - 0.5, y - 0.7, wallZ);
                textMesh.frustumCulled = false;
                this._scaleGroup.add(textMesh);
            }
        }

        //Titel-Text (vollstaendiger Variablenname, kein Abschneiden mehr)
        if (this._font) {
            //Vollstaendiger Name in Grossbuchstaben - kein substring-Limit
            const titleText = varDef.label.toUpperCase();
            const titleGeo  = new TextGeometry(titleText, {
                font:           this._font,
                size:           1.1,
                height:         0.45,
                curveSegments:  6,
                bevelEnabled:   true,
                bevelThickness: 0.05,
                bevelSize:      0.03,
                bevelSegments:  2,
            });
            titleGeo.computeBoundingBox();
            const titleW = titleGeo.boundingBox.max.x - titleGeo.boundingBox.min.x;

            const titleMesh = new THREE.Mesh(titleGeo, textMatTitle);
            titleMesh.position.set(lineCX - titleW / 2, BAR_BASE_Y + MAX_BAR_H + 2, wallZ);
            titleMesh.frustumCulled = false;
            this._scaleGroup.add(titleMesh);
        }

        LOG('3D-Skala aufgebaut: ' + this._scaleGroup.children.length + ' Objekte');
        this._scaleGroup.visible = true;
        this._scaleGroup.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    }

    /** Fallback ohne Font: nur Gitterlinien */
    _buildWallScaleFallback() {
        LOG('Fallback-Skala (Font nicht geladen)');
        while (this._scaleGroup.children.length)
            this._scaleGroup.remove(this._scaleGroup.children[0]);

        const varDef = this._currentVar;
        const isBool = varDef.type === 'bool';
        const vMin   = isBool ? 0   : (varDef.min ?? -2);
        const vMax   = isBool ? 1   : (varDef.max ?? 22);
        const range  = vMax - vMin;
        let step;
        if (isBool)          { step = 1; }
        else if (range <= 5) { step = 0.5; }
        else if (range <= 10){ step = 1; }
        else if (range <= 20){ step = 2; }
        else if (range <= 50){ step = 5; }
        else                 { step = 10; }
        const mainEvery = 2;

        const wallZ  = (this._scene.wall?.z ?? -14) + 2.5;
        const txMin  = TANKS[0].x - BAR_W / 2 - 1;
        const txMax  = TANKS[TANKS.length - 1].x + BAR_W / 2 + 1;
        const lineW  = txMax - txMin;
        const lineCX = (txMin + txMax) / 2;

        const steps = Math.round(range / step);
        for (let i = 0; i <= steps; i++) {
            const val    = vMin + i * step;
            const norm   = (val - vMin) / range;
            const y      = BAR_BASE_Y + norm * MAX_BAR_H;
            const isMain = (i % mainEvery === 0) || i === 0 || i === steps;
            const lineMat = new THREE.MeshBasicMaterial({
                color: isMain ? 0x4db8ff : 0x1a3a5a, transparent: true, opacity: isMain ? 0.45 : 0.2,
            });
            const line = new THREE.Mesh(new THREE.BoxGeometry(lineW, isMain ? 0.12 : 0.06, 0.05), lineMat);
            line.position.set(lineCX, y, wallZ);
            line.frustumCulled = false;
            this._scaleGroup.add(line);
        }
        WARN('Fallback-Skala: ' + this._scaleGroup.children.length + ' Linien');
    }

    // ----------------------------------------------------------------
    // Font laden (async, einmalig)
    // ----------------------------------------------------------------
    _loadFont() {
        return new Promise((resolve, reject) => {
            const loader = new FontLoader();
            loader.load(
                'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/fonts/helvetiker_regular.typeface.json',
                font  => { LOG('Font geladen'); resolve(font); },
                undefined,
                err   => { WARN('Font-Laden fehlgeschlagen', err); reject(err); }
            );
        });
    }

    _toH(val, vMin, vMax) {
        if (val == null) return 0.3;
        vMin = vMin ?? -2;
        vMax = vMax ?? 22;
        return Math.max(0.3, Math.min(MAX_BAR_H, (val - vMin) / (vMax - vMin) * MAX_BAR_H));
    }
}