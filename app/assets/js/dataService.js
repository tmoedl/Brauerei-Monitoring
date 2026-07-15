/**
 * DataService
 * --------------------------------------------------------------
 * Kapselt jeden API-Zugriff. Liefert ein einfaches Promise-API
 * und einen Event-Bus für Verbindungs-/Status-Events.
 *
 *   dataService.on('connection', state => …)
 *   dataService.listVariables()
 *   dataService.fetchCurrent(['T1_IstT','BK_Ist'])
 *   dataService.fetchSeries(['T1_IstT','T1_SollT'], 240)
 */

import { API_ENDPOINT } from './config.js';

class EventBus {
    constructor() { this._handlers = {}; }
    on(name, cb)  { (this._handlers[name] ||= []).push(cb); }
    emit(name, payload) { (this._handlers[name] || []).forEach(cb => cb(payload)); }
}

class DataService extends EventBus {
    constructor() {
        super();
        this._connectionState = 'unknown'; // 'ok' | 'warn' | 'crit' | 'unknown'
        this._lastServerTime  = 0;
        this._latestTs        = 0;
        this._consecutiveErrors = 0;
    }

    get connectionState() { return this._connectionState; }
    get latestDataTs()    { return this._latestTs; }
    get serverTime()      { return this._lastServerTime; }

    _setConnection(state) {
        if (state === this._connectionState) return;
        this._connectionState = state;
        this.emit('connection', state);
    }

    async _request(params) {
        const url = `${API_ENDPOINT}?${new URLSearchParams(params).toString()}`;
        try {
            const r = await fetch(url, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
            });
            if (r.status === 401) {
                this._setConnection('crit');
                this.emit('unauthorized');
                throw new Error('Nicht angemeldet');
            }
            if (!r.ok) throw new Error(`HTTP ${r.status}`);

            const json = await r.json();
            if (json.error) throw new Error(json.error);

            // Server-/Daten-Zeitstempel mitführen
            if (json.server_time) this._lastServerTime = json.server_time;
            if (json.latest_ts && json.latest_ts > this._latestTs) {
                this._latestTs = json.latest_ts;
            }

            this._consecutiveErrors = 0;
            this._setConnection('ok');
            return json;
        } catch (err) {
            this._consecutiveErrors++;
            this._setConnection(this._consecutiveErrors >= 3 ? 'crit' : 'warn');
            this.emit('error', err);
            throw err;
        }
    }

    /** Liste aller Variablennamen */
    async listVariables() {
        const data = await this._request({ action: 'list' });
        return data.variables || [];
    }

    /** Neueste Werte für die gegebenen Variablen */
    async fetchCurrent(names) {
        if (!names || !names.length) return { values: {}, latest_ts: 0, server_time: Date.now() };
        const data = await this._request({
            action: 'current',
            names:  names.join(','),
        });
        return data;
    }

    /** Historische Reihen für Chart.
     *  opts = { range: '1d', from, to, maxPoints }
     */
    async fetchSeries(names, opts = {}) {
        if (!names || !names.length) return { series: [], latest_ts: 0 };
        const params = { action: 'series', names: names.join(',') };
        if (opts.range)               params.range = opts.range;
        if (opts.from)                params.from = String(opts.from);
        if (opts.to)                  params.to = String(opts.to);
        params.maxPoints = String(opts.maxPoints || 600);
        return this._request(params);
    }
}

// Singleton
export const dataService = new DataService();
