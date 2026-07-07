/**
 * ARMode - Kamera-AR mit QR-Code-Erkennung (Multi-Code)
 * -----------------------------------------
 * Oeffnet Kamera, scannt QR-Codes per jsQR.
 * Mehrere QR-Codes gleichzeitig werden erkannt, indem nach jedem
 * Fund die erkannte Region im Scan-Puffer maskiert und erneut
 * gescannt wird (Region-Masking-Loop).
 *
 * QR-Code-Inhalte pro Objekt:
 *   Kuehlttank 1:  BRAUEREI:TANK:1
 *   Kuehlttank 2:  BRAUEREI:TANK:2
 *   Kuehlttank 3:  BRAUEREI:TANK:3
 *   Kuehlttank 4:  BRAUEREI:TANK:4
 *   Kuehlttank 5:  BRAUEREI:TANK:5
 *   Kuehlttank 6:  BRAUEREI:TANK:6
 *   Braukessel:    BRAUEREI:KESSEL:1
 */

const LOG  = (m, ...a) => console.log('[ARMode]', m, ...a);
const WARN = (m, ...a) => console.warn('[ARMode]', m, ...a);

//jsQR aus CDN (wird dynamisch geladen)
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

//QR-Code-Inhalt -> interactiveId Mapping
const QR_MAP = {
    'BRAUEREI:TANK:1':   'tank-1',
    'BRAUEREI:TANK:2':   'tank-2',
    'BRAUEREI:TANK:3':   'tank-3',
    'BRAUEREI:TANK:4':   'tank-4',
    'BRAUEREI:TANK:5':   'tank-5',
    'BRAUEREI:TANK:6':   'tank-6',
    'BRAUEREI:KESSEL:1': 'brewkettle',
};

const STATUS_COLOR = { ok:'#2b7fd6', warn:'#f0b73f', crit:'#e2533b', idle:'#5a6b80' };

//Maximale Anzahl gleichzeitig erkannter Codes (Sicherheits-Limit fuer den Mask-Loop)
const MAX_CODES = 7;

export class ARMode {
    constructor() {
        this._active   = false;
        this._video    = null;
        this._canvas   = null;
        this._ctx      = null;
        this._overlay  = null;
        this._raf      = null;
        this._jsqr     = null;
        this._values   = {};
        this._closeHandlers = [];

        //Letzter stabiler Fund: Map von QR-Data -> { location, id, ts }
        //Wird genutzt um Overlays auch dann zu zeigen wenn der Code kurz verdeckt ist
        this._lastSeen = new Map();
        //Wie lange (ms) ein Code nach dem letzten Fund noch angezeigt wird
        this._PERSIST_MS = 800;

        //Performance: Scan-Canvas mit reduzierter Aufloesung
        this._SCAN_W     = 640;
        this._SCAN_H     = 360;
        this._scanCanvas = document.createElement('canvas');
        this._scanCanvas.width  = this._SCAN_W;
        this._scanCanvas.height = this._SCAN_H;
        this._scanCtx    = this._scanCanvas.getContext('2d', { willReadFrequently: true });

        //Jeden N-ten Frame wirklich scannen - Rendering laeuft mit voller fps
        this._frameCount = 0;
        this._SCAN_EVERY = 2;

        this._buildUI();
    }

    onClose(cb) { this._closeHandlers.push(cb); }

    /** Polling-Werte aktualisieren */
    setValues(v) { this._values = v; }

    // ----------------------------------------------------------------
    async start() {
        if (this._active) return;

        //jsQR laden falls noch nicht vorhanden
        if (!window.jsQR) {
            await this._loadJsQR();
        }
        this._jsqr = window.jsQR;

        //Kamera
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false,
            });
            this._video.srcObject = stream;
            await this._video.play();
            LOG('Kamera gestartet:', stream.getVideoTracks()[0].label);
        } catch (err) {
            WARN('Kamera-Zugriff verweigert:', err.message);
            this._overlay.querySelector('#ar-status').textContent =
                'Kamera-Zugriff verweigert. Bitte Berechtigung erteilen.';
            return;
        }

        this._active = true;
        this._overlay.hidden = false;
        this._overlay.querySelector('#ar-status').textContent = 'QR-Codes in die Kamera halten ...';
        this._scanLoop();
        LOG('AR-Modus aktiv (Multi-Code)');
    }

    stop() {
        if (!this._active) return;
        this._active = false;
        cancelAnimationFrame(this._raf);
        //Kamera stoppen
        const tracks = this._video.srcObject?.getTracks() || [];
        tracks.forEach(t => t.stop());
        this._video.srcObject = null;
        this._overlay.hidden = true;
        this._lastSeen.clear();
        this._closeHandlers.forEach(cb => cb());
        LOG('AR-Modus beendet');
    }

    // ----------------------------------------------------------------
    _buildUI() {
        this._overlay = document.createElement('div');
        this._overlay.id = 'ar-overlay';
        this._overlay.hidden = true;
        this._overlay.innerHTML = `
            <video id="ar-video" playsinline muted></video>
            <canvas id="ar-canvas"></canvas>
            <div class="ar-ui">
                <div class="ar-header">
                    <span class="ar-title">AR Brauerei Monitor</span>
                    <span id="ar-status" class="ar-status">Initialisierung ...</span>
                    <button id="ar-close" class="ar-close-btn">X Beenden</button>
                </div>
                <div class="ar-hint">Mehrere QR-Codes gleichzeitig in die Kamera halten</div>
            </div>
        `;
        document.body.appendChild(this._overlay);

        this._video  = this._overlay.querySelector('#ar-video');
        this._canvas = this._overlay.querySelector('#ar-canvas');
        this._ctx    = this._canvas.getContext('2d');

        this._overlay.querySelector('#ar-close').addEventListener('click', () => this.stop());

        //Canvas-Groesse mit Fenster synchronisieren
        const resize = () => {
            this._canvas.width  = window.innerWidth;
            this._canvas.height = window.innerHeight;
        };
        resize();
        window.addEventListener('resize', resize);
    }

    // ----------------------------------------------------------------
    _scanLoop() {
        if (!this._active) return;

        const vid = this._video;
        const ctx = this._ctx;
        const cw  = this._canvas.width;
        const ch  = this._canvas.height;

        if (vid.readyState === vid.HAVE_ENOUGH_DATA) {
            //Video auf Haupt-Canvas zeichnen (volle Aufloesung fuer Darstellung)
            ctx.clearRect(0, 0, cw, ch);
            ctx.drawImage(vid, 0, 0, cw, ch);

            this._frameCount++;
            if (this._frameCount % this._SCAN_EVERY === 0) {
                //Scan auf kleinem Canvas durchfuehren
                this._scanCtx.drawImage(vid, 0, 0, this._SCAN_W, this._SCAN_H);
                const found = this._scanAllCodes();

                //Skalierungsfaktor: Scan-Koordinaten -> Canvas-Koordinaten umrechnen
                const scaleX = cw / this._SCAN_W;
                const scaleY = ch / this._SCAN_H;

                //Letzte-Sicht-Map aktualisieren
                const now = Date.now();
                found.forEach(({ data, location, id }) => {
                    this._lastSeen.set(data, {
                        id,
                        ts: now,
                        location: this._scaleLocation(location, scaleX, scaleY),
                    });
                });

                //Abgelaufene Eintraege entfernen
                for (const [key, entry] of this._lastSeen) {
                    if (now - entry.ts > this._PERSIST_MS) this._lastSeen.delete(key);
                }
            }

            //Alle aktuell sichtbaren Overlays zeichnen
            const now = Date.now();
            let activeCount = 0;
            const knownIds = new Set();
            for (const [, entry] of this._lastSeen) {
                if (now - entry.ts > this._PERSIST_MS) continue;
                if (entry.id && knownIds.has(entry.id)) continue; //Duplikat (gleiche ID, zwei Codes)
                if (entry.id) {
                    knownIds.add(entry.id);
                    this._drawAROverlay(ctx, entry.location, entry.id, cw, ch);
                    activeCount++;
                } else {
                    this._drawUnknownQR(ctx, entry.location);
                }
            }

            //Status-Text aktualisieren
            const statusEl = this._overlay.querySelector('#ar-status');
            if (statusEl) {
                if (activeCount === 0) {
                    statusEl.textContent = 'QR-Codes in die Kamera halten ...';
                } else if (activeCount === 1) {
                    const first = [...this._lastSeen.values()].find(e => e.id);
                    if (first) {
                        statusEl.textContent = (first.id === 'brewkettle'
                            ? 'Braukessel'
                            : 'Kuehlttank ' + first.id.replace('tank-', '')) + ' erkannt';
                    }
                } else {
                    statusEl.textContent = activeCount + ' Objekte erkannt';
                }
            }

            //Sucher-Rahmen nur wenn nichts erkannt
            if (activeCount === 0 && this._lastSeen.size === 0) {
                this._drawFinderFrame(ctx, cw, ch);
            }
        }

        this._raf = requestAnimationFrame(() => this._scanLoop());
    }

    /**
     * Region-Masking-Loop: scannt das Scan-Canvas wiederholt.
     * Nach jedem Fund wird die gefundene Region weiss uebermalt,
     * damit jsQR beim naechsten Durchlauf einen anderen Code findet.
     * Gibt Array von { data, location, id } zurueck.
     */
    _scanAllCodes() {
        const found = [];

        //Arbeitskopie der Pixel holen
        const imageData = this._scanCtx.getImageData(0, 0, this._SCAN_W, this._SCAN_H);

        for (let i = 0; i < MAX_CODES; i++) {
            const code = this._jsqr(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
            });
            if (!code) break; //Kein weiterer Code vorhanden

            const id = QR_MAP[code.data] || null;
            found.push({ data: code.data, location: code.location, id });

            //Erkannte Region im imageData maskieren (weiss fuellen)
            //Bounding-Box der vier Ecken berechnen
            const pts = [
                code.location.topLeftCorner,
                code.location.topRightCorner,
                code.location.bottomRightCorner,
                code.location.bottomLeftCorner,
            ];
            const minX = Math.max(0, Math.floor(Math.min(...pts.map(p => p.x))) - 10);
            const minY = Math.max(0, Math.floor(Math.min(...pts.map(p => p.y))) - 10);
            const maxX = Math.min(this._SCAN_W, Math.ceil(Math.max(...pts.map(p => p.x))) + 10);
            const maxY = Math.min(this._SCAN_H, Math.ceil(Math.max(...pts.map(p => p.y))) + 10);

            //Region im Uint8ClampedArray weiss faerben
            for (let y = minY; y < maxY; y++) {
                for (let x = minX; x < maxX; x++) {
                    const idx = (y * this._SCAN_W + x) * 4;
                    imageData.data[idx]     = 255; //R
                    imageData.data[idx + 1] = 255; //G
                    imageData.data[idx + 2] = 255; //B
                    //Alpha unveraendert lassen
                }
            }
        }

        return found;
    }

    /**
     * Skaliert Location-Koordinaten vom Scan-Canvas auf den Haupt-Canvas.
     */
    _scaleLocation(loc, sx, sy) {
        const scale = pt => ({ x: pt.x * sx, y: pt.y * sy });
        return {
            topLeftCorner:     scale(loc.topLeftCorner),
            topRightCorner:    scale(loc.topRightCorner),
            bottomRightCorner: scale(loc.bottomRightCorner),
            bottomLeftCorner:  scale(loc.bottomLeftCorner),
        };
    }

    /** AR-Overlay mit Tank-Daten an QR-Code-Position */
    _drawAROverlay(ctx, loc, id, cw, ch) {
        const pts  = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
        const cx   = pts.reduce((s, p) => s + p.x, 0) / 4;
        const cy   = pts.reduce((s, p) => s + p.y, 0) / 4;
        const size = Math.max(
            Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
            Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y)
        );

        //QR-Rahmen
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.strokeStyle = '#4db8ff';
        ctx.lineWidth   = 3;
        ctx.stroke();

        //Daten ermitteln
        const isKettle = id === 'brewkettle';
        const { label, ist, soll, status, ventil, heat } = this._getValues(id);

        //Panel-Box: oberhalb falls Platz vorhanden, sonst unterhalb
        const boxW   = Math.max(240, size * 2.2);
        const boxH   = 160;
        const stCol  = STATUS_COLOR[status] || '#5a6b80';

        //Automatisch ueber oder unter dem Code platzieren
        const spaceAbove = cy - size * 0.7 - 10;
        const placeAbove = spaceAbove >= boxH;
        const boxX = Math.min(Math.max(cx - boxW / 2, 4), cw - boxW - 4);
        const boxY = placeAbove
            ? cy - size * 0.7 - boxH - 10
            : cy + size * 0.7 + 10;

        //Hintergrund
        ctx.save();
        ctx.globalAlpha = 0.88;
        ctx.fillStyle   = 'rgba(8,16,36,0.95)';
        this._roundRect(ctx, boxX, boxY, boxW, boxH, 10);
        ctx.fill();
        ctx.globalAlpha = 1.0;

        //Farbiger Rand
        ctx.strokeStyle = stCol;
        ctx.lineWidth   = 2.5;
        this._roundRect(ctx, boxX, boxY, boxW, boxH, 10);
        ctx.stroke();

        //Akzentlinie oben
        ctx.fillStyle = stCol;
        ctx.fillRect(boxX + 10, boxY, boxW - 20, 4);
        ctx.restore();

        //Texte
        const titleLabel = isKettle ? 'Braukessel' : 'Kuehlttank ' + id.replace('tank-', '');
        ctx.fillStyle = '#e8f4ff'; ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(titleLabel, boxX + boxW / 2, boxY + 14);

        //Grosse Temperatur
        ctx.fillStyle = stCol;
        ctx.font = 'bold 38px monospace';
        ctx.fillText(ist != null ? ist.toFixed(1) + ' C' : '--', boxX + boxW / 2, boxY + 38);

        //Soll-Temp
        ctx.fillStyle = 'rgba(77,180,255,0.8)'; ctx.font = '15px monospace';
        ctx.fillText('Soll: ' + (soll != null ? soll.toFixed(1) + ' C' : '--'), boxX + boxW / 2, boxY + 86);

        //Statuszeile
        const stLabel = { ok:'OK', warn:'WARNUNG', crit:'KRITISCH', idle:'INAKTIV' }[status] || '--';
        ctx.fillStyle = stCol; ctx.font = 'bold 13px monospace';
        ctx.fillText(
            stLabel + (isKettle ? (heat ? '  |  HEIZUNG AN' : '') : (ventil ? '  |  VENTIL OFFEN' : '')),
            boxX + boxW / 2, boxY + 110
        );

        //Verbindungslinie QR -> Panel
        const lineFromY = placeAbove ? cy - size * 0.7 : cy + size * 0.7;
        const lineTtoY  = placeAbove ? boxY + boxH : boxY;
        ctx.beginPath();
        ctx.moveTo(cx, lineFromY);
        ctx.lineTo(cx, lineTtoY);
        ctx.strokeStyle = stCol + '80';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    _drawUnknownQR(ctx, loc) {
        const pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.strokeStyle = '#f0b73f'; ctx.lineWidth = 2;
        ctx.stroke();
    }

    _drawFinderFrame(ctx, cw, ch) {
        const s  = Math.min(cw, ch) * 0.35;
        const cx = cw / 2, cy = ch / 2;
        const x  = cx - s / 2, y = cy - s / 2;
        const cs = 24; //Ecken-Groesse
        const t  = 3;  //Liniendicke

        ctx.strokeStyle = 'rgba(77,180,255,0.7)'; ctx.lineWidth = t;
        //Vier Ecken
        [[x,y],[x+s,y],[x+s,y+s],[x,y+s]].forEach(([px,py], i) => {
            ctx.beginPath();
            const dx = i===0||i===3 ? cs : -cs;
            const dy = i===0||i===1 ? cs : -cs;
            ctx.moveTo(px + dx, py); ctx.lineTo(px, py); ctx.lineTo(px, py + dy);
            ctx.stroke();
        });
    }

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    _getValues(id) {
        const v = this._values;
        let ist = null, soll = null, status = 'idle', ventil = false, heat = false, label = id;
        try {
            if (id === 'brewkettle') {
                ist    = v['BK_IstT']?.val ?? v['BK_Ist']?.val;
                soll   = v['BK_SollT']?.val ?? v['BK_Soll']?.val;
                heat   = isActive(v['BK_A_H']?.val);
                const ein = isActive(v['BK_Ein']?.val);
                status = ein ? (ist != null && soll != null ? this._cs(ist, soll, 8, 3) : 'idle') : 'idle';
                label  = 'Braukessel';
            } else {
                const n = id.replace('tank-', '');
                ist    = v[`T${n}_IstT`]?.val;
                soll   = v[`T${n}_SollT`]?.val;
                ventil = isActive(v[`T${n}_AV`]?.val);
                const ein = isActive(v[`T${n}_Ein`]?.val);
                status = ein ? (ist != null && soll != null ? this._cs(ist, soll, 5, 2) : 'idle') : 'idle';
                label  = 'Kuehlttank ' + n;
            }
        } catch (_) {}
        return { label, ist, soll, status, ventil, heat };
    }

    _cs(ist, soll, crit, warn) {
        const d = Math.abs(ist - soll);
        return d >= crit ? 'crit' : d >= warn ? 'warn' : 'ok';
    }

    async _loadJsQR() {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = JSQR_URL;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }
}

function isActive(v) { return v != null && +v > 0.5; }