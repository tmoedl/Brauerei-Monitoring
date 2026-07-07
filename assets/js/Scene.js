/**
 * Scene * Three.js-Aufbau v4
 * --------------------------------------------------------------
 * - CSS2DRenderer fuer Labels
 * - WallPanel3D: UV-Raycasting fuer Klick auf 3D-Panel
 * - WASD-Navigation (WASD = Pan, QE = Hoehe, Shift+R = Reset)
 */

import * as THREE                           from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
import { OrbitControls }                    from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer }                    from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/renderers/CSS2DRenderer.js';

console.log('=== Scene.js GELADEN ===');
const LOG  = (m, ...a) => console.log('[Scene]', m, ...a);
const WARN = (m, ...a) => console.warn('[Scene]', m, ...a);

// Skalierungsfaktor: Wie viele CSS-Pixel = 1 Three.js-Unit
// WallDisplay-Breite: 700px, Wand-Breite: 150 units -> 700 * 0.19 ~= 133 units
const CSS3D_SCALE = 0.19;

export class Scene {
    constructor(containerSelector = '#stage') {
        this.container = document.querySelector(containerSelector);
        if (!this.container) throw new Error('Stage-Container fehlt');

        this._handlers     = { hover: [], click: [], dblclick: [] };
        this._hoverObject  = null;
        this._keys         = new Set();

        this._initRenderer();
        this._initScene();
        this._initCamera();
        this._initLights();
        this._initGround();
        this._initWall();
        this._initControls();
        this._initRaycaster();
        this._initWASD();
        this._initWebXR();
        this._bindResize();

        LOG('Initialisiert. Wand:', this.wall);
    }

    on(eventName, cb) {
        if (this._handlers[eventName]) this._handlers[eventName].push(cb);
    }
    _emit(eventName, data) {
        (this._handlers[eventName] || []).forEach(cb => cb(data));
    }

    // ----------------------------------------------------------------
    // Init
    // ----------------------------------------------------------------
    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            antialias: true, alpha: true, powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace   = THREE.SRGBColorSpace;
        this.renderer.toneMapping        = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.95;
        this.renderer.xr.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        // CSS2DRenderer (Labels)
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.cssText =
            'position:absolute;top:0;left:0;pointer-events:none;z-index:1;';
        this.container.appendChild(this.labelRenderer.domElement);

        LOG('Renderer erstellt (WebGL + CSS2D)');
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0xefe7d6, 240, 520);
    }

    _initCamera() {
        const aspect = window.innerWidth / window.innerHeight;
        this.camera  = new THREE.PerspectiveCamera(42, aspect, 0.1, 1000);
        this.camera.position.set(110, 90, 130);
        this.camera.lookAt(50, 18, 0);
    }

    _initLights() {
        this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0xd8ccb4, 0.95));
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));

        const sun = new THREE.DirectionalLight(0xfff4e2, 1.05);
        sun.position.set(60, 130, 80);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const s = 100;
        sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
        sun.shadow.camera.top  =  s; sun.shadow.camera.bottom = -s;
        sun.shadow.camera.near = 1;  sun.shadow.camera.far    = 400;
        sun.shadow.bias = -0.0005; sun.shadow.intensity = 0.4;
        this.scene.add(sun);

        const rim  = new THREE.PointLight(0xe09a5e, 0.35, 240, 1.6);
        rim.position.set(-30, 45, 70);
        this.scene.add(rim);

        const fill = new THREE.PointLight(0x9cc0dd, 0.28, 240, 1.6);
        fill.position.set(110, 35, -80);
        this.scene.add(fill);

        const wallLight = new THREE.PointLight(0xd0eaff, 0.22, 180, 1.8);
        wallLight.position.set(50, 50, 40);
        this.scene.add(wallLight);
    }

    _initGround() {
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(420, 320),
            new THREE.MeshStandardMaterial({ color: 0xe4dac4, roughness: 0.92, metalness: 0.04 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        const grid = new THREE.GridHelper(420, 42, 0xb0a588, 0xcabfa6);
        grid.position.y = 0.03;
        grid.material.transparent = true; grid.material.opacity = 0.5;
        this.scene.add(grid);

        const frame = new THREE.Mesh(
            new THREE.BoxGeometry(160, 0.5, 0.5),
            new THREE.MeshStandardMaterial({
                color:0xc87341, emissive:0xc87341, emissiveIntensity:0.12,
                roughness:0.4, metalness:0.8
            })
        );
        frame.position.set(58, 0.12, 32);
        this.scene.add(frame);
    }

    _initWall() {
        const wallW = 150, wallH = 70, wallD = 2.0;
        const wallX = 47,  wallY = 35, wallZ = -14;

        const wallMat = new THREE.MeshStandardMaterial({
            color: 0xd8d0c0, roughness: 0.88, metalness: 0.04,
        });
        const wall = new THREE.Mesh(new THREE.BoxGeometry(wallW, wallH, wallD), wallMat);
        wall.position.set(wallX, wallY, wallZ);
        wall.receiveShadow = true;
        this.scene.add(wall);

        const panelLineMat = new THREE.MeshStandardMaterial({ color: 0xc4bba9, roughness: 0.92 });
        for (const y of [10, 20, 30, 40, 50, 60]) {
            const line = new THREE.Mesh(
                new THREE.BoxGeometry(wallW, 0.18, 0.12), panelLineMat
            );
            line.position.set(wallX, y, wallZ + wallD / 2 + 0.06);
            this.scene.add(line);
        }

        const cols = 7;
        for (let i = 0; i <= cols; i++) {
            const x = wallX - wallW / 2 + (i / cols) * wallW;
            const pillar = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, wallH, 0.15), panelLineMat
            );
            pillar.position.set(x, wallY, wallZ + wallD / 2 + 0.07);
            this.scene.add(pillar);
        }

        const topBar = new THREE.Mesh(
            new THREE.BoxGeometry(wallW + 2, 0.8, wallD + 0.4),
            new THREE.MeshStandardMaterial({
                color: 0xc87341, metalness: 0.85, roughness: 0.35,
                emissive: 0xc87341, emissiveIntensity: 0.06,
            })
        );
        topBar.position.set(wallX, wallH + 0.3, wallZ);
        topBar.castShadow = true;
        this.scene.add(topBar);

        const bottomBar = new THREE.Mesh(
            new THREE.BoxGeometry(wallW + 2, 0.5, wallD + 0.4),
            new THREE.MeshStandardMaterial({ color: 0x9aa6b3, metalness: 0.7, roughness: 0.5 })
        );
        bottomBar.position.set(wallX, 0.2, wallZ);
        this.scene.add(bottomBar);

        this.wall = { x: wallX, y: wallY, z: wallZ, w: wallW, h: wallH };
    }

    _initControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping  = true;
        this.controls.dampingFactor  = 0.07;
        this.controls.enablePan      = true;
        this.controls.minDistance    = 30;
        this.controls.maxDistance    = 280;
        this.controls.maxPolarAngle  = Math.PI / 2.05;
        this.controls.target.set(58, 18, 0);
        this.controls.autoRotate     = false;
    }

    _initWASD() {
        const ignore = e => ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);

        window.addEventListener('keydown', e => {
            if (ignore(e)) return;
            this._keys.add(e.code);
            if (e.code === 'KeyR' && e.shiftKey) {
                this.camera.position.set(110, 90, 130);
                this.controls.target.set(58, 18, 0);
                this.controls.update();
                LOG('Kamera zurueckgesetzt (Shift+R)');
            }
        });
        window.addEventListener('keyup', e => this._keys.delete(e.code));

        // Kurzer Hinweis beim ersten WASD-Druck
        let hintShown = false;
        const hint = document.querySelector('.statusbar-center .hint');
        window.addEventListener('keydown', e => {
            if (ignore(e) || hintShown) return;
            if (['KeyW','KeyA','KeyS','KeyD'].includes(e.code)) {
                hintShown = true;
                if (hint) {
                    hint.style.color = 'rgba(77,180,255,0.7)';
                    setTimeout(() => { hint.style.color = ''; }, 2000);
                }
            }
        });

        LOG('WASD-Navigation aktiv (WASD=Pan, Q/E=Hoehe, Shift+R=Reset)');
    }

    _applyWASD(dt) {
        const keys = this._keys;
        if (!keys.has('KeyW') && !keys.has('KeyS') &&
            !keys.has('KeyA') && !keys.has('KeyD') &&
            !keys.has('KeyQ') && !keys.has('KeyE')) return;

        const speed = 45 * dt;
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) return;
        forward.normalize();

        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();
        const move  = new THREE.Vector3();

        if (keys.has('KeyW')) move.addScaledVector(forward,  speed);
        if (keys.has('KeyS')) move.addScaledVector(forward, -speed);
        if (keys.has('KeyA')) move.addScaledVector(right,   -speed);
        if (keys.has('KeyD')) move.addScaledVector(right,    speed);
        if (keys.has('KeyQ')) move.y -= speed;
        if (keys.has('KeyE')) move.y += speed;

        this.camera.position.add(move);
        this.controls.target.add(move);
    }

    _initRaycaster() {
        this.raycaster    = new THREE.Raycaster();
        this._pointer     = new THREE.Vector2();
        this._interactables = [];
        this._panelMeshes   = [];   // WallPanel3D meshes (separate, UV-faehig)

        const canvas = this.renderer.domElement;
        canvas.addEventListener('pointermove', e => this._handlePointer(e, 'hover'));
        canvas.addEventListener('click',       e => this._handlePointer(e, 'click'));
        canvas.addEventListener('dblclick',    e => this._handlePointer(e, 'dblclick'));
    }

    _handlePointer(event, kind) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this._pointer.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        this._pointer.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this._pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this._interactables, true);

        let hit = null;
        for (const h of hits) {
            let o = h.object;
            while (o && !o.userData?.interactiveId) o = o.parent;
            if (o) { hit = o; break; }
        }

        if (kind === 'hover') {
            const newId = hit ? hit.userData.interactiveId : null;
            const oldId = this._hoverObject ? this._hoverObject.userData.interactiveId : null;
            if (newId !== oldId) {
                this._hoverObject = hit;
                this.renderer.domElement.style.cursor = hit ? 'pointer' : 'default';
                this._emit('hover', { object: hit, id: newId });
            }
        } else {
            // Zuerst Panel-Meshes pruefen (haben UV-Koordinaten fuer Klick-Bereiche)
            if (this._panelMeshes.length) {
                const panelHits = this.raycaster.intersectObjects(this._panelMeshes, false);
                if (panelHits.length) {
                    const ph = panelHits[0];
                    if (ph.uv && ph.object.userData?.panel) {
                        ph.object.userData.panel.handleClick(ph);
                        return;
                    }
                }
            }
            this._emit(kind, { object: hit, id: hit ? hit.userData.interactiveId : null });
        }
    }

    addInteractive(object) { this._interactables.push(object); }
    addPanelMesh(mesh)    { this._panelMeshes.push(mesh); }

    // ----------------------------------------------------------------
    // Kamera-Animation
    // ----------------------------------------------------------------
    focusOn(target, distance = 40, onWall = false) {
        const tx = target.x, ty = target.y;
        const tz = onWall ? (this.wall?.z ?? -14) : target.z;

        const start = {
            cx: this.camera.position.x, cy: this.camera.position.y, cz: this.camera.position.z,
            tx: this.controls.target.x, ty: this.controls.target.y, tz: this.controls.target.z,
        };

        let dir;
        if (onWall) {
            //Steiler Blickwinkel von vorne-oben auf die Wand,
            //damit das Datenfenster zentral im Bild erscheint
            dir = new THREE.Vector3(0, 0.0, 1).normalize().multiplyScalar(distance);
        } else {
            dir = new THREE.Vector3()
                .subVectors(this.camera.position, this.controls.target)
                .normalize();
            if (dir.lengthSq() < 1e-6) dir.set(1, 0.6, 1).normalize();
            dir.multiplyScalar(distance);
        }

        const end = {
            cx: tx + dir.x, cy: ty + dir.y, cz: tz + dir.z,
            tx, ty, tz,
        };

        const dur = 900, t0 = performance.now();
        const ease = t => 1 - Math.pow(1 - t, 3);
        const step = now => {
            const t = Math.min(1, (now - t0) / dur);
            const e = ease(t);
            this.camera.position.set(
                start.cx + (end.cx - start.cx) * e,
                start.cy + (end.cy - start.cy) * e,
                start.cz + (end.cz - start.cz) * e,
            );
            this.controls.target.set(
                start.tx + (end.tx - start.tx) * e,
                start.ty + (end.ty - start.ty) * e,
                start.tz + (end.tz - start.tz) * e,
            );
            this.controls.update();
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    _initWebXR() {
        // VR/AR Buttons entfernt (nicht benoetigt)
    }

    _bindResize() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    /** Konfiguration fuer WallPanel3D (Tank-X-Positionen) */
    setTankConfig(config) { this._tankConfig = config; }

    start(onFrame = () => {}) {
        const clock = new THREE.Clock();
        this.renderer.setAnimationLoop(() => {
            const dt = clock.getDelta();
            this._applyWASD(dt);
            onFrame(dt, clock.elapsedTime);
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
            this.labelRenderer.render(this.scene, this.camera);
        });
    }
}