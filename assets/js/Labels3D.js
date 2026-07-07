/**
 * Labels3D - Echte 3D-Textobjekte auf den Tanks
 * -----------------------------------------------
 * Verwendet THREE.TextGeometry + FontLoader (Helvetiker).
 * Die Labels sind echte 3D-Meshes im Raum - keine CSS2D-Sprites.
 * Beim Drehen der Kamera aendert sich die Perspektive des Textes.
 *
 * Aenderungen:
 *  - Labels tiefer gesetzt (LABEL_Y 14 statt 30) damit sie nicht
 *    mit dem Balkendiagramm kollidieren
 *  - Grosse Tank-ID-Beschriftung ("T1" etc.) als oberste Zeile
 *  - Temperaturwert als kleinere zweite Zeile darunter
 */
import * as THREE      from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
import { FontLoader }  from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/geometries/TextGeometry.js';

const TANKS = [{id:1,x:18,z:0},{id:2,x:34,z:0},{id:3,x:50,z:0},{id:4,x:66,z:0},{id:5,x:82,z:0},{id:6,x:98,z:0}];

//Ausgeschriebene Namen fuer die Schilder
const LABEL_NAMES = {
    'tank-1': 'Tank 1',
    'tank-2': 'Tank 2',
    'tank-3': 'Tank 3',
    'tank-4': 'Tank 4',
    'tank-5': 'Tank 5',
    'tank-6': 'Tank 6',
    'brewkettle': 'Braukessel',
};

const LOG  = (m, ...a) => console.log('[Labels3D]', m, ...a);
const WARN = (m, ...a) => console.warn('[Labels3D]', m, ...a);

//Y-Position der Labels - tiefer als Balkendiagramm (startet bei BAR_BASE_Y=28)
//so dass Labels nicht vom Diagramm verdeckt werden
const LABEL_Y     = 14;
const BK_LABEL_Y  = 12;

//Font-URL (Three.js CDN)
const FONT_URL = 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/fonts/helvetiker_regular.typeface.json';

//Status-Farben (als THREE.Color)
const STATUS_COLORS = {
    ok:   new THREE.Color(0x4ec57a),
    warn: new THREE.Color(0xf0b73f),
    crit: new THREE.Color(0xe2533b),
    idle: new THREE.Color(0x4a5568),
};

//Groesse der Titel-ID (gross und gut lesbar)
const ID_TEXT_SIZE  = 2.2;
//Groesse des Temperaturwerts darunter
const VAL_TEXT_SIZE = 1.1;

export class Labels3D {
    constructor(scene) {
        this._scene   = scene;
        this._labels  = new Map();  //id -> { group, idMesh, valMesh, status, lastStr }
        this._visible = true;
        this._font    = null;

        //Font laden -> dann alle Labels bauen
        this._loadFont().then(font => {
            this._font = font;
            LOG('Font geladen, baue Labels');
            this._buildAll(scene);
            LOG(this._labels.size + ' 3D-Labels erstellt');
        }).catch(err => {
            WARN('Font nicht geladen:', err.message);
        });
    }

    // __ API ______________________________________________________

    setAllVisible(v) {
        this._visible = v;
        this._labels.forEach(lbl => { lbl.group.visible = v; });
    }

    setVisible(id, v) {
        const lbl = this._labels.get(id);
        if (lbl) lbl.group.visible = v && this._visible;
    }

    setValue(id, tempStr, status) {
        const lbl = this._labels.get(id);
        if (!lbl || !this._font) return;
        const newStr = tempStr || '';
        if (lbl.lastStr === newStr && lbl.status === status) return;
        lbl.lastStr = newStr;
        lbl.status  = status || 'idle';
        this._rebuildVal(lbl, newStr, lbl.status);
    }

    highlight(id) {
        this._labels.forEach((lbl, lid) => {
            lbl.group.traverse(o => { if (o.isMesh) o.material.opacity = (lid !== id) ? 0.25 : 1.0; });
        });
    }

    resetHighlight() {
        this._labels.forEach(lbl => {
            lbl.group.traverse(o => { if (o.isMesh) o.material.opacity = 1.0; });
        });
    }

    //Kompatibilitaet mit altem Labels.js-Interface
    get labels() { return this._labels; }

    // __ Aufbau ____________________________________________________

    _buildAll(scene) {
        TANKS.forEach(t => {
            this._buildLabel(`tank-${t.id}`, `T${t.id}`, t.x, LABEL_Y, t.z, scene, 6);
        });
        //Braukessel: k1 sitzt bei z=4, Radius 4.4 -> Vorderkante bei z=8.4
        //Label muss deutlich davor liegen -> z+14
        const bkX = scene._tankConfig?.BREWKETTLE_X ?? -2;
        this._buildLabel('brewkettle', 'BK', bkX, BK_LABEL_Y, 0, scene, 14);
    }

    _buildLabel(id, nameStr, x, y, z, scene, zOffset = 6) {
        const group = new THREE.Group();
        group.position.set(x, y, z + zOffset);
        group.frustumCulled = false;

        //Hintergrund-Panel - etwas hoeher wegen der dritten Namenszeile
        const bgGeo = new THREE.PlaneGeometry(10, 8);
        const bgMat = new THREE.MeshBasicMaterial({
            color:       0x040c1e,
            transparent: true,
            opacity:     0.72,
            side:        THREE.DoubleSide,
            depthWrite:  false,
        });
        const bg = new THREE.Mesh(bgGeo, bgMat);
        bg.position.set(0, 0, -0.05);
        bg.frustumCulled = false;
        group.add(bg);

        //Akzentlinie oben (blau)
        const frameMat = new THREE.MeshBasicMaterial({ color: 0x4db8ff, transparent: true, opacity: 0.7 });
        const frame = new THREE.Mesh(new THREE.BoxGeometry(10, 0.14, 0.05), frameMat);
        frame.position.set(0, 3.8, 0);
        frame.frustumCulled = false;
        group.add(frame);

        scene.scene.add(group);

        //Eintrag anlegen (idMesh und valMesh werden separat gebaut)
        const entry = {
            group,
            idMesh:    null,
            nameMesh:  null,  //ausgeschriebener Name (neue dritte Zeile)
            valMesh:   null,
            status:    'idle',
            lastStr:   null,
            defaultId: nameStr,
            labelId:   id,    //fuer LABEL_NAMES-Lookup
        };
        this._labels.set(id, entry);

        //Tank-ID gross aufbauen (statisch, einmalig)
        this._buildIdText(entry, nameStr);
        //Initialwert
        this._rebuildVal(entry, '--', 'idle');
    }

    //Tank-ID gross und hell - wird einmal gebaut, nicht bei jedem Update neu
    _buildIdText(lbl, nameStr) {
        if (!this._font) return;

        const col = new THREE.Color(0xe8f4ff);
        const mat = new THREE.MeshStandardMaterial({
            color:             col,
            emissive:          col,
            emissiveIntensity: 0.45,
            roughness:         0.2,
            metalness:         0.5,
            transparent:       true,
            opacity:           1.0,
            side:              THREE.DoubleSide,
        });

        const geo = new TextGeometry(nameStr, {
            font:           this._font,
            size:           ID_TEXT_SIZE,
            height:         0.45,
            curveSegments:  5,
            bevelEnabled:   true,
            bevelThickness: 0.08,
            bevelSize:      0.04,
            bevelSegments:  3,
        });
        geo.computeBoundingBox();
        const textW = geo.boundingBox.max.x - geo.boundingBox.min.x;

        const mesh = new THREE.Mesh(geo, mat);
        //ID-Kurzbezeichnung oben im Panel
        mesh.position.set(-textW / 2, 0.5, 0);
        mesh.frustumCulled = false;
        lbl.group.add(mesh);
        lbl.idMesh = mesh;

        //Ausgeschriebener Name darunter - so gross wie ins Panel passt
        const fullName = LABEL_NAMES[lbl.labelId] || nameStr;

        //Groesse automatisch berechnen: Panel-Breite / Name-Breite * Zielgroesse
        //Erst mit Standardgroesse messen, dann skalieren
        const nameTestGeo = new TextGeometry(fullName, {
            font:           this._font,
            size:           1.0,
            height:         0.12,
            curveSegments:  4,
            bevelEnabled:   false,
        });
        nameTestGeo.computeBoundingBox();
        const nameTestW = nameTestGeo.boundingBox.max.x - nameTestGeo.boundingBox.min.x;
        nameTestGeo.dispose();

        //Panel-Breite ergibt sich aus ID-Textbreite + Rand
        const panelW   = Math.max(10, textW + 2.5);
        //Ziel: Name fuellt ~85% der Panel-Breite, aber max 1.3 (damit es nicht zu klobig wird)
        const nameSz   = Math.min(1.3, (panelW * 0.85) / Math.max(nameTestW, 0.1));

        const nameGeo = new TextGeometry(fullName, {
            font:           this._font,
            size:           nameSz,
            height:         0.10,
            curveSegments:  4,
            bevelEnabled:   true,
            bevelThickness: 0.03,
            bevelSize:      0.02,
            bevelSegments:  2,
        });
        nameGeo.computeBoundingBox();
        const nameW = nameGeo.boundingBox.max.x - nameGeo.boundingBox.min.x;

        //Gedaempfte Hellblau-Farbe fuer den Namen - etwas dezenter als ID
        const nameCol = new THREE.Color(0xa0c8e8);
        const nameMat = new THREE.MeshStandardMaterial({
            color:             nameCol,
            emissive:          nameCol,
            emissiveIntensity: 0.25,
            roughness:         0.3,
            metalness:         0.45,
            transparent:       true,
            opacity:           0.92,
            side:              THREE.DoubleSide,
        });

        const nameMesh = new THREE.Mesh(nameGeo, nameMat);
        //Unterhalb der ID-Beschriftung, oberhalb des Temperaturwerts
        nameMesh.position.set(-nameW / 2, -0.9, 0);
        nameMesh.frustumCulled = false;
        lbl.group.add(nameMesh);
        lbl.nameMesh = nameMesh;

        //Hintergrund an groesste Breite anpassen
        this._resizeBackground(lbl, Math.max(panelW, nameW + 1.8));
    }

    //Temperaturwert (wird bei jedem Poll-Update neu gebaut wenn sich Wert aendert)
    _rebuildVal(lbl, str, status) {
        if (!this._font) return;

        //Altes Wert-Mesh entfernen
        if (lbl.valMesh) {
            lbl.group.remove(lbl.valMesh);
            lbl.valMesh.geometry.dispose();
            lbl.valMesh.material.dispose();
            lbl.valMesh = null;
        }

        const col = STATUS_COLORS[status] || STATUS_COLORS.idle;
        const mat = new THREE.MeshStandardMaterial({
            color:             col.clone(),
            emissive:          col.clone(),
            emissiveIntensity: 0.6,
            roughness:         0.25,
            metalness:         0.5,
            transparent:       true,
            opacity:           1.0,
            side:              THREE.DoubleSide,
        });

        const geo = new TextGeometry(str, {
            font:           this._font,
            size:           VAL_TEXT_SIZE,
            height:         0.18,
            curveSegments:  4,
            bevelEnabled:   true,
            bevelThickness: 0.04,
            bevelSize:      0.025,
            bevelSegments:  2,
        });
        geo.computeBoundingBox();
        const textW = geo.boundingBox.max.x - geo.boundingBox.min.x;

        const mesh = new THREE.Mesh(geo, mat);
        //Unterhalb des Namens platzieren
        mesh.position.set(-textW / 2, -2.6, 0);
        mesh.frustumCulled = false;
        lbl.group.add(mesh);
        lbl.valMesh = mesh;

        //Rahmen-Farbe an Status anpassen
        const frameMesh = lbl.group.children.find(c => c.geometry?.type === 'BoxGeometry');
        if (frameMesh) {
            frameMesh.material.color.copy(col);
        }
    }

    _resizeBackground(lbl, w) {
        const bgMesh = lbl.group.children.find(c => c.geometry?.type === 'PlaneGeometry');
        if (!bgMesh) return;
        bgMesh.geometry.dispose();
        bgMesh.geometry = new THREE.PlaneGeometry(w, 8);

        const frameMesh = lbl.group.children.find(c => c.geometry?.type === 'BoxGeometry');
        if (frameMesh) {
            frameMesh.geometry.dispose();
            frameMesh.geometry = new THREE.BoxGeometry(w, 0.14, 0.05);
            //Frame-Position anpassen (oben am Panel)
            frameMesh.position.set(0, 3.8, 0);
        }
    }

    async _loadFont() {
        return new Promise((resolve, reject) => {
            const loader = new FontLoader();
            loader.load(FONT_URL, font => resolve(font), undefined, err => reject(err));
        });
    }
}