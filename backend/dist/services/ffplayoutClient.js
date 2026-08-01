"use strict";
/**
 * Minimal ffplayout v2 control-plane client.
 *
 * Phase 5 integration proved the adapter's original assumption wrong: ffplayout
 * does NOT pull a day playlist from an HTTP URL. It stores playlists locally and
 * exposes an API to receive them. So Cinezoo PUSHES:
 *
 *   login  →  configure the channel's stream output (RTMP → our tower)
 *          →  POST the generated day playlist
 *          →  control: start
 *
 * Every call here mirrors a request verified by hand against a real
 * ffplayout-v2.0.0-rc5 during the integration test (docs/ffplayout-adapter.md
 * section 13). Auth is username/password → a short-lived access token; we simply
 * re-login on a 401 rather than juggling refresh tokens.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FfplayoutClient = void 0;
class FfplayoutClient {
    constructor(baseUrl, username, password) {
        this.baseUrl = baseUrl;
        this.username = username;
        this.password = password;
        this.access = null;
        this.baseUrl = baseUrl.replace(/\/$/, "");
    }
    login() {
        return __awaiter(this, void 0, void 0, function* () {
            const res = yield fetch(`${this.baseUrl}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: this.username, password: this.password }),
            });
            if (!res.ok)
                throw new Error(`ffplayout login failed: ${res.status}`);
            const body = (yield res.json());
            if (!body.access)
                throw new Error("ffplayout login returned no access token");
            this.access = body.access;
        });
    }
    /** Authenticated fetch that logs in on first use and re-logs once on a 401. */
    authFetch(path_1) {
        return __awaiter(this, arguments, void 0, function* (path, init = {}, retry = true) {
            if (!this.access)
                yield this.login();
            const res = yield fetch(`${this.baseUrl}${path}`, Object.assign(Object.assign({}, init), { headers: Object.assign(Object.assign({}, (init.headers || {})), { Authorization: `Bearer ${this.access}` }) }));
            if (res.status === 401 && retry) {
                this.access = null;
                return this.authFetch(path, init, false);
            }
            return res;
        });
    }
    listOutputs(ch) {
        return __awaiter(this, void 0, void 0, function* () {
            const res = yield this.authFetch(`/api/playout/outputs/${ch}`);
            if (!res.ok)
                throw new Error(`listOutputs(${ch}) failed: ${res.status}`);
            return (yield res.json());
        });
    }
    getConfig(ch) {
        return __awaiter(this, void 0, void 0, function* () {
            const res = yield this.authFetch(`/api/playout/config/${ch}`);
            if (!res.ok)
                throw new Error(`getConfig(${ch}) failed: ${res.status}`);
            return res.json();
        });
    }
    putConfig(ch, config) {
        return __awaiter(this, void 0, void 0, function* () {
            const res = yield this.authFetch(`/api/playout/config/${ch}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            if (!res.ok)
                throw new Error(`putConfig(${ch}) failed: ${res.status}`);
        });
    }
    /**
     * Point the channel at our RTMP tower and enable the as-run task. ffplayout
     * selects the active output by its `output.id` (the 'stream' output row), not
     * by a free-form mode string — so we look the id up and set it explicitly.
     */
    configureStreamOutput(ch, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const outputs = yield this.listOutputs(ch);
            const stream = outputs.find((o) => o.name === "stream");
            if (!stream)
                throw new Error(`channel ${ch} has no 'stream' output`);
            const config = yield this.getConfig(ch);
            config.output = Object.assign(Object.assign({}, config.output), { id: stream.id, mode: "stream", stream_type: "rtmp", stream_format: "flv", stream_url: opts.streamUrl, width: opts.width, height: opts.height, fps: opts.fps });
            config.task = { enable: true, path: opts.taskPath };
            config.playlist = Object.assign(Object.assign({}, config.playlist), { day_start: "00:00:00" });
            yield this.putConfig(ch, config);
        });
    }
    /**
     * Replace the channel's day playlist. DELETE-then-POST is idempotent: a bare
     * POST 409s when a playlist for that date already exists, so we clear it first.
     */
    pushPlaylist(ch, playlist) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.authFetch(`/api/playlist/${ch}/${playlist.date}`, { method: "DELETE" }).catch(() => { });
            const res = yield this.authFetch(`/api/playlist/${ch}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(playlist),
            });
            if (!res.ok)
                throw new Error(`pushPlaylist(${ch}, ${playlist.date}) failed: ${res.status}`);
        });
    }
    control(ch, command) {
        return __awaiter(this, void 0, void 0, function* () {
            const res = yield this.authFetch(`/api/control/${ch}/process`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command }),
            });
            if (!res.ok)
                throw new Error(`control(${ch}, ${command}) failed: ${res.status}`);
        });
    }
    mediaCurrent(ch) {
        return __awaiter(this, void 0, void 0, function* () {
            const res = yield this.authFetch(`/api/control/${ch}/media/current`);
            if (!res.ok)
                throw new Error(`mediaCurrent(${ch}) failed: ${res.status}`);
            return res.json();
        });
    }
}
exports.FfplayoutClient = FfplayoutClient;
