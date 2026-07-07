/**
 * BreweryModel * Geometrie der Brauanlage
 * --------------------------------------------------------------
 * Bewusst simpel gehalten - primitive Three.js-Bausteine, aber
 * als Brauerei-Anlage eindeutig erkennbar. Keine externen Modelle.
 *
 * Aufbau (von links nach rechts):
 *   - Braukessel: zwei verbundene Kupferzylinder mit Kuppeldach,
 *     Schauglas und Pumpen-Block, Rohrbruecken
 *   - 6 Kuehltanks: konische Zylinder mit Standfuessen, oben mit
 *     Mannloch
 *
 * Jeder Tank ist als THREE.Group registriert und reagiert auf
 * Raycasting (siehe Scene.addInteractive).
 */

console.log('=== BreweryModel.js GELADEN ===');
import * as THREE        from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
const TANKS = [{id:1,x:18,z:0},{id:2,x:34,z:0},{id:3,x:50,z:0},{id:4,x:66,z:0},{id:5,x:82,z:0},{id:6,x:98,z:0}];
const STATUS_COLORS = { ok:'#4ec57a', warn:'#f0b73f', crit:'#e2533b', idle:'#4a5568' };

const COLORS = {
    copper:    0xc06a32,
    copperHi:  0xe8a065,
    steel:     0xcdd6df,
    steelDark: 0x9aa6b3,
    rubber:    0x4a505a,
    glass:     0x9fc8e8,
    cool:      0x4d8bd1,
    edge:      0x5a6472,   // Konturlinien-Farbe fuer Kanten
};

// Temperatur -> Farbe (kalt = blau, warm = rot). Bereich ca. -2..24  GradC.
function tempToColor(temp) {
    if (temp === null || temp === undefined || Number.isNaN(temp)) return 0x94a3b1;
    const t = Math.max(0, Math.min(1, (temp - (-2)) / (24 - (-2))));
    // Blau (kalt) -> Cyan -> Gelb -> Rot (warm)
    const c = new THREE.Color();
    // HSL: 0.6 (blau) bis 0.0 (rot)
    const hue = 0.62 * (1 - t);
    c.setHSL(hue, 0.65, 0.55);
    return c.getHex();
}

// ----------------------------------------------------------------
// Hilfs-Material-Fabrik
// ----------------------------------------------------------------
function makeMetalMaterial(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.32,
        metalness: opts.metalness ?? 0.78,
        envMapIntensity: 0.6,
    });
}
function makeMatteMaterial(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.7,
        metalness: opts.metalness ?? 0.15,
    });
}

/**
 * Legt dezente Konturlinien ueber ein Mesh, damit Kanten auf
 * hellem Grund klar erkennbar sind (verbessert Figur-Grund-Trennung).
 */
function addEdges(mesh, opacity = 0.35) {
    const edges = new THREE.EdgesGeometry(mesh.geometry, 30);
    const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({
            color: COLORS.edge,
            transparent: true,
            opacity,
        })
    );
    mesh.add(line);
    return line;
}

// ----------------------------------------------------------------
// Bauteile
// ----------------------------------------------------------------

/**
 * Standfuss aus 4 schmalen Beinen - wird fuer Tanks und Kessel genutzt.
 */
function makeLegs(radius, height) {
    const group = new THREE.Group();
    const legMat = makeMetalMaterial(COLORS.steelDark, { roughness: 0.6, metalness: 0.7 });
    const legGeo = new THREE.BoxGeometry(0.7, height, 0.7);
    const positions = [
        [ radius * 0.78, 0,  radius * 0.78],
        [-radius * 0.78, 0,  radius * 0.78],
        [ radius * 0.78, 0, -radius * 0.78],
        [-radius * 0.78, 0, -radius * 0.78],
    ];
    for (const [x, _y, z] of positions) {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(x, height / 2, z);
        leg.castShadow = true; leg.receiveShadow = true;
        group.add(leg);
    }
    // Bodenring zur Stabilisierung
    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.05, 0.18, 8, 24),
        legMat
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.4;
    ring.castShadow = true;
    group.add(ring);
    return group;
}

/**
 * Einzelner Kuehltank: zylindrischer Mantel + konischer Boden + Kuppel
 *
 * Layout-Hinweis: der gesamte Tank ist auf seine eigene lokale
 * Y-Achse zentriert (Boden bei y=0, Spitze bei y~=22).
 */
function buildCoolingTank() {
    const group = new THREE.Group();
    const RADIUS = 3.4;

    // 1) Standfuesse
    const legHeight = 5.5;
    group.add(makeLegs(RADIUS, legHeight));

    // 2) Konischer Boden (Spitze nach unten)
    const coneGeo = new THREE.ConeGeometry(RADIUS, 3.6, 24, 1, true);
    const coneMat = makeMetalMaterial(COLORS.steel, { roughness: 0.28 });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.rotation.x = Math.PI; // Spitze nach unten
    cone.position.y = legHeight + 1.8;
    cone.castShadow = true; cone.receiveShadow = true;
    group.add(cone);

    // 3) Zylindrischer Mantel (leicht transparent, damit Fuellung sichtbar)
    const cylGeo = new THREE.CylinderGeometry(RADIUS, RADIUS, 12, 24, 1, true);
    const cylMat = new THREE.MeshPhysicalMaterial({
        color: COLORS.steel,
        roughness: 0.22,
        metalness: 0.7,
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
    });
    const cyl = new THREE.Mesh(cylGeo, cylMat);
    cyl.position.y = legHeight + 3.6 + 6;
    cyl.castShadow = true; cyl.receiveShadow = true;
    addEdges(cyl, 0.25);
    group.add(cyl);

    // 3a) Innen-"Fluessigkeit": ein zweiter Zylinder, dessen Farbe die
    //     Temperatur kodiert und dessen Hoehe wir leicht modulieren.
    const liquidMat = new THREE.MeshStandardMaterial({
        color: STATUS_COLORS.idle,
        roughness: 0.35,
        metalness: 0.1,
        transparent: true,
        opacity: 0.55,
        emissive: STATUS_COLORS.idle,
        emissiveIntensity: 0.15,
    });
    const liquid = new THREE.Mesh(
        new THREE.CylinderGeometry(RADIUS - 0.25, RADIUS - 0.25, 11, 24),
        liquidMat
    );
    liquid.position.y = legHeight + 3.6 + 6;
    group.add(liquid);

    // 3b) Mantel-Baender
    const bandMat = makeMetalMaterial(COLORS.steelDark, { roughness: 0.6 });
    for (const bandY of [legHeight + 4.5, legHeight + 8.5, legHeight + 12.5]) {
        const band = new THREE.Mesh(
            new THREE.TorusGeometry(RADIUS + 0.05, 0.12, 6, 28),
            bandMat
        );
        band.position.y = bandY;
        band.rotation.x = Math.PI / 2;
        group.add(band);
    }

    // 4) Obere Kuppel
    const domeGeo = new THREE.SphereGeometry(RADIUS, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const dome = new THREE.Mesh(domeGeo, coneMat);
    dome.position.y = legHeight + 3.6 + 12;
    dome.castShadow = true;
    addEdges(dome, 0.22);
    group.add(dome);

    // 5) Mannloch
    const manhole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.7, 0.6, 16),
        bandMat
    );
    manhole.position.y = legHeight + 3.6 + 12 + RADIUS - 0.3;
    group.add(manhole);

    // 6) Status-Schein
    const glowGeo = new THREE.CylinderGeometry(RADIUS * 1.02, RADIUS * 1.02, 12, 24, 1, true);
    const glowMat = new THREE.MeshBasicMaterial({
        color:       STATUS_COLORS.idle,
        transparent: true,
        opacity:     0.0,
        side:        THREE.BackSide,
        depthWrite:  false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = legHeight + 3.6 + 6;
    group.add(glow);

    // 7) Modus-Indikator (Hand/Auto)
    const modeBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.4),
        new THREE.MeshStandardMaterial({
            color: STATUS_COLORS.idle,
            emissive: STATUS_COLORS.idle,
            emissiveIntensity: 0.4,
            roughness: 0.5,
        })
    );
    modeBox.position.set(RADIUS + 0.35, legHeight + 9.5, 0);
    group.add(modeBox);

    // 8) Kuehlmantel-Ventil (seitliches Rohr + Ventilrad) - Regelung sichtbar
    const valveGroup = new THREE.Group();
    valveGroup.position.set(-(RADIUS + 0.2), legHeight + 2.5, 0);

    const valvePipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 2.4, 12),
        makeMetalMaterial(COLORS.cool ?? 0x4d8bd1, { roughness: 0.35 })
    );
    valvePipe.rotation.z = Math.PI / 2;
    valvePipe.position.x = -1;
    valveGroup.add(valvePipe);

    const valveWheel = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.12, 8, 18),
        new THREE.MeshStandardMaterial({ color: 0x4d8bd1, roughness: 0.4, metalness: 0.5 })
    );
    valveWheel.position.x = -2.2;
    valveGroup.add(valveWheel);
    group.add(valveGroup);

    // 8a) Kuehlmittel-Fluss-Partikel (kleine Kugeln, die bei offenem
    //     Ventil am Mantel "herunterlaufen")
    const flowParticles = [];
    const flowMat = new THREE.MeshBasicMaterial({
        color: 0x4d8bd1, transparent: true, opacity: 0.0,
    });
    for (let i = 0; i < 8; i++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), flowMat.clone());
        const angle = (i / 8) * Math.PI * 2;
        p.userData.angle = angle;
        p.userData.offset = Math.random();
        p.position.set(Math.cos(angle) * RADIUS, legHeight + 12, Math.sin(angle) * RADIUS);
        group.add(p);
        flowParticles.push(p);
    }

    group.userData = {
        kind:    'tank',
        glow,
        modeBox,
        liquid,
        liquidMat,
        valveWheel,
        flowParticles,
        shellMaterials: [coneMat],
        labelAnchor: new THREE.Vector3(0, legHeight + 3.6 + 12 + RADIUS + 1.5, 0),
        baseAnchor:  new THREE.Vector3(0, legHeight, 0),
        legHeight,
    };
    return group;
}

/**
 * Braukessel-Anlage:
 *   - Zwei Kupferzylinder mit Kuppeldaechern, durch Rohr verbunden
 *   - Pumpen-Block davor
 *   - Schauglas-Detail
 */
function buildBrewKettleArea() {
    const group = new THREE.Group();
    const copper = makeMetalMaterial(COLORS.copper, { roughness: 0.34, metalness: 0.82 });
    copper.emissive = new THREE.Color(0x1a0d05);
    copper.emissiveIntensity = 0.04;

    const copperHi = makeMetalMaterial(COLORS.copperHi, { roughness: 0.25, metalness: 0.9 });

    // ---- Kessel 1 (vordere Position) ----
    const k1 = new THREE.Group();
    k1.position.set(0, 0, 4);

    // Standfuesse
    k1.add(makeLegs(4.4, 4.2));

    // Mantel
    const mantle1 = new THREE.Mesh(
        new THREE.CylinderGeometry(4.4, 4.4, 11, 28, 1, true),
        copper
    );
    mantle1.position.y = 4.2 + 5.5;
    mantle1.castShadow = true; mantle1.receiveShadow = true;
    addEdges(mantle1, 0.20);
    k1.add(mantle1);

    // Boden des Kessels (geschlossener Disk)
    const bottom1 = new THREE.Mesh(new THREE.CircleGeometry(4.4, 28), copper);
    bottom1.rotation.x = Math.PI / 2;
    bottom1.position.y = 4.2;
    k1.add(bottom1);

    // Kuppel
    const dome1 = new THREE.Mesh(
        new THREE.SphereGeometry(4.4, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2),
        copper
    );
    dome1.position.y = 4.2 + 11;
    dome1.castShadow = true;
    addEdges(dome1, 0.18);
    k1.add(dome1);

    // Spitzhut / Brueden-Abzug
    const stack1 = new THREE.Mesh(
        new THREE.ConeGeometry(0.9, 4.5, 16),
        copperHi
    );
    stack1.position.y = 4.2 + 11 + 4.4 - 0.5;
    k1.add(stack1);

    // Mantel-Baender (geben Brauerei-Charakter)
    const bandMat = makeMetalMaterial(COLORS.copperHi, { roughness: 0.35, metalness: 0.9 });
    for (const by of [4.2 + 1.5, 4.2 + 9.5]) {
        const b = new THREE.Mesh(
            new THREE.TorusGeometry(4.45, 0.18, 8, 32),
            bandMat
        );
        b.rotation.x = Math.PI / 2;
        b.position.y = by;
        k1.add(b);
    }

    // Schauglas (kleines Fenster im Mantel)
    const glassMat = new THREE.MeshPhysicalMaterial({
        color: COLORS.glass,
        transparent: true,
        opacity: 0.55,
        transmission: 0.6,
        roughness: 0.05,
        metalness: 0.0,
        clearcoat: 1,
    });
    const sight = new THREE.Mesh(
        new THREE.CircleGeometry(0.7, 24),
        glassMat
    );
    sight.position.set(0, 4.2 + 6, 4.42);
    k1.add(sight);

    // Heizungs-Indikator-Ring unten (Pop-Out farblich)
    const heatRing = new THREE.Mesh(
        new THREE.TorusGeometry(4.5, 0.22, 8, 32),
        new THREE.MeshStandardMaterial({
            color: 0x4a1f10,
            emissive: 0xff5e2a,
            emissiveIntensity: 0.3,
            roughness: 0.4,
        })
    );
    heatRing.rotation.x = Math.PI / 2;
    heatRing.position.y = 4.2 + 0.4;
    k1.add(heatRing);

    group.add(k1);

    // ---- Kessel 2 (hintere Position, leicht versetzt) ----
    const k2 = k1.clone(true);  // sehr aehnliches Bauteil
    k2.position.set(-5.5, 0, -4);
    // Glow eines Klones reset
    k2.traverse(c => { if (c.material) c.material = c.material; });
    group.add(k2);

    // ---- Verbindungs-Rohr zwischen den Kesseln (Bogen) ----
    const pipeMat = makeMetalMaterial(COLORS.copperHi, { roughness: 0.3, metalness: 0.9 });
    const pipeCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.2, 4.2 + 6, 4),
        new THREE.Vector3(-3, 4.2 + 9, 0),
        new THREE.Vector3(-5.5, 4.2 + 6, -4),
    ]);
    const pipe = new THREE.Mesh(
        new THREE.TubeGeometry(pipeCurve, 32, 0.35, 12, false),
        pipeMat
    );
    pipe.castShadow = true;
    group.add(pipe);

    // ---- Pumpen-Block (vor den Kesseln) ----
    const pump = new THREE.Group();
    pump.position.set(3.5, 0, 6);

    const pumpBase = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, 2.4, 2.0),
        makeMetalMaterial(COLORS.steelDark, { roughness: 0.55 })
    );
    pumpBase.position.y = 1.2;
    pumpBase.castShadow = true; pumpBase.receiveShadow = true;
    pump.add(pumpBase);

    const pumpHead = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 1.0, 18),
        makeMetalMaterial(COLORS.copper, { roughness: 0.35, metalness: 0.9 })
    );
    pumpHead.rotation.z = Math.PI / 2;
    pumpHead.position.y = 2.6;
    pumpHead.castShadow = true;
    pump.add(pumpHead);

    // Drehender Luefter (animiert in app.js)
    const fan = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 0.12, 16),
        new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.5 })
    );
    fan.position.set(0, 2.6, 1.05);
    fan.rotation.x = Math.PI / 2;
    pump.add(fan);
    for (let i = 0; i < 4; i++) {
        const blade = new THREE.Mesh(
            new THREE.BoxGeometry(0.16, 0.55, 0.04),
            new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.45 })
        );
        blade.position.y = 0.27;
        const wrap = new THREE.Group();
        wrap.rotation.z = (i / 4) * Math.PI * 2;
        wrap.add(blade);
        fan.add(wrap);
    }

    group.add(pump);
    group.userData = {
        kind: 'brewkettle',
        fan,
        heatRing,
        labelAnchor: new THREE.Vector3(-2.5, 4.2 + 11 + 5.5, 0),
        baseAnchor:  new THREE.Vector3(0, 0, 0),
        shellMaterials: [copper, copperHi],
    };

    return group;
}

// ----------------------------------------------------------------
// Oeffentliche API
// ----------------------------------------------------------------
export class BreweryModel {

    constructor(scene) {
        this.scene  = scene;
        this.root   = new THREE.Group();
        this.tanks  = new Map();  // tankId -> Group
        this.kettle = null;

        this._buildKettleArea();
        this._buildTanks();

        scene.scene.add(this.root);
    }

    _buildKettleArea() {
        const kettle = buildBrewKettleArea();
        kettle.position.set(0, 0, 0);
        kettle.userData.interactiveId = 'brewkettle';
        this.root.add(kettle);
        this.scene.addInteractive(kettle);
        this.kettle = kettle;
    }

    _buildTanks() {
        TANKS.forEach(spec => {
            const tank = buildCoolingTank();
            tank.position.set(spec.x, 0, spec.z);
            tank.userData.interactiveId = `tank-${spec.id}`;
            tank.userData.tankId = spec.id;
            this.root.add(tank);
            this.scene.addInteractive(tank);
            this.tanks.set(spec.id, tank);
        });
    }

    /**
     * Pro Frame aufrufen - animiert Pumpen-Luefter, Glow-Pulse,
     * Kuehlmittel-Fluss und Fluessigkeitsfaerbung.
     *
     * @param statusMap   Map: interactiveId -> 'ok'|'warn'|'crit'|'idle'
     * @param detailMap   Map: interactiveId -> { temp, valveOpen, mode }
     */
    update(dt, elapsed, statusMap, detailMap = new Map()) {
        // Pumpen-Luefter dreht
        if (this.kettle?.userData.fan) {
            this.kettle.userData.fan.rotation.y += dt * 6;
        }

        const pulse = (Math.sin(elapsed * 3) + 1) * 0.5;  // 0..1

        for (const [tankId, group] of this.tanks) {
            const id = `tank-${tankId}`;
            const status = statusMap.get(id) || 'idle';
            const detail = detailMap.get(id) || {};
            this._applyTankStatus(group, status, pulse);
            this._applyTankDetail(group, detail, dt, elapsed);
        }
        if (this.kettle) {
            const status = statusMap.get('brewkettle') || 'idle';
            this._applyKettleStatus(this.kettle, status, pulse);
        }
    }

    /**
     * Faerbt die Fluessigkeit nach Temperatur und animiert den
     * Kuehlmittel-Fluss, wenn das Ventil offen ist.
     */
    _applyTankDetail(group, detail, dt, elapsed) {
        const ud = group.userData;

        // Fluessigkeitsfarbe nach Temperatur
        if (ud.liquidMat && detail.temp !== undefined && detail.temp !== null) {
            const target = new THREE.Color(tempToColor(detail.temp));
            ud.liquidMat.color.lerp(target, 0.08);     // weich nachziehen
            ud.liquidMat.emissive.copy(ud.liquidMat.color);
            ud.liquidMat.emissiveIntensity = 0.18;
            ud.liquidMat.opacity = 0.6;
        } else if (ud.liquidMat) {
            ud.liquidMat.opacity = 0.25;
        }

        // Ventil-Rad dreht sich, wenn offen; Fluss-Partikel laufen
        const valveOpen = !!detail.valveOpen;
        if (ud.valveWheel) {
            if (valveOpen) ud.valveWheel.rotation.x += dt * 4;
        }
        if (ud.flowParticles) {
            const legHeight = ud.legHeight || 5.5;
            const topY = legHeight + 12;
            const botY = legHeight + 1;
            ud.flowParticles.forEach(p => {
                if (valveOpen) {
                    p.material.opacity = 0.75;
                    // Partikel rieselt von oben nach unten
                    let prog = (elapsed * 0.4 + p.userData.offset) % 1;
                    p.position.y = topY - prog * (topY - botY);
                } else {
                    p.material.opacity = Math.max(0, p.material.opacity - dt * 2);
                }
            });
        }
    }

    _applyTankStatus(group, status, pulse) {
        const ud = group.userData;
        if (!ud.glow) return;
        const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
        ud.glow.material.color.setHex(color);

        if (status === 'crit')        ud.glow.material.opacity = 0.18 + pulse * 0.32;
        else if (status === 'warn')   ud.glow.material.opacity = 0.10 + pulse * 0.14;
        else if (status === 'ok')     ud.glow.material.opacity = 0.06;
        else                          ud.glow.material.opacity = 0.0;
    }

    _applyKettleStatus(group, status, pulse) {
        const ring = group.userData.heatRing;
        if (!ring) return;
        if (status === 'crit') {
            ring.material.emissive.setHex(STATUS_COLORS.crit);
            ring.material.emissiveIntensity = 0.5 + pulse * 0.7;
        } else if (status === 'warn') {
            ring.material.emissive.setHex(STATUS_COLORS.warn);
            ring.material.emissiveIntensity = 0.35 + pulse * 0.35;
        } else if (status === 'ok') {
            ring.material.emissive.setHex(0xff5e2a);
            ring.material.emissiveIntensity = 0.45;
        } else {
            ring.material.emissive.setHex(0x2a1a10);
            ring.material.emissiveIntensity = 0.1;
        }
    }

    /**
     * Modus-Indikator (Hand/Auto) am Tank setzen
     *  - Auto = gruenlich, Hand = bernsteinfarbig, Aus = grau
     */
    setTankMode(tankId, mode) {
        const t = this.tanks.get(tankId);
        if (!t?.userData.modeBox) return;
        const mat = t.userData.modeBox.material;
        let color;
        if (mode === 'auto') color = STATUS_COLORS.ok;
        else if (mode === 'hand') color = 0xe08a4b;
        else color = STATUS_COLORS.idle;
        mat.color.setHex(color);
        mat.emissive.setHex(color);
    }

    /**
     * Weltkoordinaten des Label-Ankers eines Tanks/Kessels.
     */
    getLabelAnchor(interactiveId) {
        let group;
        if (interactiveId === 'brewkettle') group = this.kettle;
        else {
            const id = parseInt(interactiveId.replace('tank-', ''), 10);
            group = this.tanks.get(id);
        }
        if (!group) return null;
        const v = group.userData.labelAnchor.clone();
        return v.add(group.position);
    }

    /**
     * Setzt die Sichtbarkeit eines Tank- oder Kessel-Objekts.
     * @param {string}  interactiveId  z.B. 'tank-1' oder 'brewkettle'
     * @param {boolean} visible
     */
    setVisible(interactiveId, visible) {
        let group;
        if (interactiveId === 'brewkettle') {
            group = this.kettle;
        } else {
            const id = parseInt(interactiveId.replace('tank-', ''), 10);
            group = this.tanks.get(id);
        }
        if (group) group.visible = visible;
    }

    getCenterWorldPos(interactiveId) {
        let group;
        if (interactiveId === 'brewkettle') group = this.kettle;
        else {
            const id = parseInt(interactiveId.replace('tank-', ''), 10);
            group = this.tanks.get(id);
        }
        if (!group) return null;
        return new THREE.Vector3().setFromMatrixPosition(group.matrixWorld)
                                  .add(new THREE.Vector3(0, 12, 0));
    }
}