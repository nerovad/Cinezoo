"use strict";
/**
 * How the supervisor actually starts/stops a channel's playout engine.
 *
 * Behind an interface because the concrete mechanism depends on how ffplayout
 * is deployed, and because until a real engine is wired (Phase 5 integration)
 * the safe default is to do nothing but log. Swap the driver via
 * PLAYOUT_ENGINE_DRIVER without touching the supervisor.
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
exports.FfplayoutApiDriver = exports.FfplayoutControlDriver = exports.LoggingEngineDriver = void 0;
exports.engineDriverFromEnv = engineDriverFromEnv;
const ffplayoutClient_1 = require("./ffplayoutClient");
const playlist_1 = require("./playlist");
const mediaStorage_1 = require("./mediaStorage");
/** Default: no side effects, just a log line. Safe to run without ffplayout. */
class LoggingEngineDriver {
    start(channel) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`[playout] would START engine for channel ${channel.slug} (id ${channel.id})`);
        });
    }
    stop(channel) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`[playout] would STOP engine for channel ${channel.slug} (id ${channel.id})`);
        });
    }
}
exports.LoggingEngineDriver = LoggingEngineDriver;
/**
 * Drives a running ffplayout instance via its control API
 * (POST {base}/api/control/{id}/process {command}). ffplayout playlist mode is
 * wall-clock synced, so `start` joins the loop at the correct offset by itself.
 *
 * Auth here is a static bearer token (FFPLAYOUT_TOKEN). ffplayout access tokens
 * are short-lived (45 min) and refresh tokens rotate; a production driver must
 * refresh behind a mutex (see spec section 5). This first cut assumes a
 * long-lived/service token and logs auth failures rather than crashing.
 */
class FfplayoutControlDriver {
    constructor(baseUrl, token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }
    command(channel, command) {
        return __awaiter(this, void 0, void 0, function* () {
            const url = `${this.baseUrl.replace(/\/$/, '')}/api/control/${channel.ffplayout_channel_id}/process`;
            try {
                const res = yield fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
                    body: JSON.stringify({ command }),
                });
                if (!res.ok) {
                    console.error(`[playout] ffplayout ${command} for ${channel.slug} failed: ${res.status}`);
                }
            }
            catch (err) {
                console.error(`[playout] ffplayout ${command} for ${channel.slug} errored:`, err);
            }
        });
    }
    start(channel) {
        return __awaiter(this, void 0, void 0, function* () { yield this.command(channel, 'start'); });
    }
    stop(channel) {
        return __awaiter(this, void 0, void 0, function* () { yield this.command(channel, 'stop'); });
    }
}
exports.FfplayoutControlDriver = FfplayoutControlDriver;
/**
 * Full push-based driver — the one Phase 5 integration proved out.
 *
 * `start` does what the integration test did by hand: configure the channel's
 * stream output to push RTMP at Cinezoo's tower, generate today's playlist from
 * the channel's segments (with ABSOLUTE sources), push it to ffplayout, then
 * start playout. ffplayout's clock-synced playlist mode joins the loop at the
 * right offset on its own. `stop` just stops the process.
 *
 * Needs the DB (to build the playlist) and these env values for the emitted
 * config: FFPLAYOUT_BASE_URL, FFPLAYOUT_USER, FFPLAYOUT_PASSWORD,
 * RTMP_INGEST_URL (tower), FFPLAYOUT_TASK_PATH (as-run script path on the engine
 * host). MEDIA_ROOT must be the shared media volume ffplayout also reads.
 */
class FfplayoutApiDriver {
    constructor(client, pool, opts) {
        this.client = client;
        this.pool = pool;
        this.opts = opts;
    }
    start(channel) {
        return __awaiter(this, void 0, void 0, function* () {
            const ff = channel.ffplayout_channel_id;
            const { rows: chRows } = yield this.pool.query(`SELECT stream_key, COALESCE(display_name, name) AS label
         FROM channels WHERE id = $1 LIMIT 1`, [channel.id]);
            if (chRows.length === 0)
                throw new Error(`channel ${channel.id} not found`);
            const { stream_key, label } = chRows[0];
            const { rows: segs } = yield this.pool.query(`SELECT m.storage_path, m.title, s.in_ms, s.out_ms,
              m.duration_ms AS media_duration_ms, s.category
         FROM channel_segments s
         JOIN channel_media m ON m.id = s.media_id
        WHERE s.channel_id = $1 AND m.conform_status = 'ready'
        ORDER BY s.position ASC`, [channel.id]);
            const storageRoot = `${mediaStorage_1.MEDIA_ROOT}/${channel.id}`;
            const streamUrl = `${this.opts.rtmpBase.replace(/\/$/, "")}/${stream_key}`;
            const date = new Date().toISOString().slice(0, 10); // UTC broadcast day
            yield this.client.configureStreamOutput(ff, {
                streamUrl,
                width: mediaStorage_1.HOUSE_FORMAT.width,
                height: mediaStorage_1.HOUSE_FORMAT.height,
                fps: mediaStorage_1.HOUSE_FORMAT.fps,
                taskPath: this.opts.taskPath,
            });
            const playlist = (0, playlist_1.buildDayPlaylist)(label || "Channel", date, segs, 86400, storageRoot);
            yield this.client.pushPlaylist(ff, playlist);
            yield this.client.control(ff, "start");
        });
    }
    stop(channel) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.client.control(channel.ffplayout_channel_id, "stop");
        });
    }
}
exports.FfplayoutApiDriver = FfplayoutApiDriver;
/** Pick a driver from env. Defaults to logging (safe, no-op side effects). */
function engineDriverFromEnv(pool) {
    const kind = (process.env.PLAYOUT_ENGINE_DRIVER || 'logging').toLowerCase();
    if (kind === 'ffplayout-api') {
        const base = process.env.FFPLAYOUT_BASE_URL || '';
        const user = process.env.FFPLAYOUT_USER || '';
        const pass = process.env.FFPLAYOUT_PASSWORD || '';
        const rtmpBase = process.env.RTMP_INGEST_URL || '';
        const taskPath = process.env.FFPLAYOUT_TASK_PATH || '';
        if (!base || !user || !pass || !rtmpBase || !taskPath || !pool) {
            console.warn('[playout] ffplayout-api driver selected but FFPLAYOUT_BASE_URL/USER/PASSWORD, RTMP_INGEST_URL, FFPLAYOUT_TASK_PATH or DB pool missing — using logging driver');
            return new LoggingEngineDriver();
        }
        return new FfplayoutApiDriver(new ffplayoutClient_1.FfplayoutClient(base, user, pass), pool, { rtmpBase, taskPath });
    }
    if (kind === 'ffplayout-control') {
        const base = process.env.FFPLAYOUT_BASE_URL || '';
        const token = process.env.FFPLAYOUT_TOKEN || '';
        if (!base || !token) {
            console.warn('[playout] ffplayout-control driver selected but FFPLAYOUT_BASE_URL/TOKEN unset — using logging driver');
            return new LoggingEngineDriver();
        }
        return new FfplayoutControlDriver(base, token);
    }
    return new LoggingEngineDriver();
}
