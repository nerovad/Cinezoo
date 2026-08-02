"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.provisionPlayout = provisionPlayout;
exports.getPlayoutConfig = getPlayoutConfig;
exports.getPlaylist = getPlaylist;
exports.recordAsRun = recordAsRun;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const pool_1 = __importDefault(require("../db/pool"));
const playlist_1 = require("../services/playlist");
const mediaStorage_1 = require("../services/mediaStorage");
/* Where the public API and RTMP tower live, for the engine config we emit. */
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://cinezoo.tv").replace(/\/$/, "");
const RTMP_INGEST_URL = (process.env.RTMP_INGEST_URL || "rtmp://cinezoo.tv:1935/live").replace(/\/$/, "");
/* Auth helper — matches the segment/media controllers. */
function authUserIdOr401(req, res) {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) {
        res.status(401).json({ error: "Access Denied" });
        return null;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        return decoded.id;
    }
    catch (_a) {
        res.status(401).json({ error: "Invalid Token" });
        return null;
    }
}
/** Shape the ffplayout-facing config for a provisioned channel. */
function buildPlayoutConfig(channel) {
    return {
        channel_id: channel.id,
        playout_mode: "scheduled",
        // ffplayout `playlists` config → it fetches <base>/YYYY/MM/YYYY-MM-DD.json
        playlist_url: `${PUBLIC_BASE_URL}/api/playout/pl/${channel.playout_token}`,
        // ffplayout stream output target (its push lands in Cinezoo's nginx-rtmp)
        rtmp_output: `${RTMP_INGEST_URL}/${channel.stream_key}`,
        // ffplayout storage root — where conformed media for this channel lives
        media_storage_root: `${mediaStorage_1.MEDIA_ROOT}/${channel.id}`,
        // as-run task-script target + the secret it authenticates with
        asrun_url: `${PUBLIC_BASE_URL}/api/playout/asrun`,
        stream_key: channel.stream_key,
    };
}
/**
 * POST /api/channels/:slug/playout/provision   (owner only)
 * Turns a channel into a scheduled playout channel: mints a playout_token if
 * absent, sets playout_mode='scheduled', and returns the engine config an
 * operator (or the Phase 5 supervisor) uses to configure ffplayout.
 */
function provisionPlayout(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const uid = authUserIdOr401(req, res);
        if (!uid)
            return;
        try {
            const { rows } = yield pool_1.default.query("SELECT id, owner_id, stream_key, playout_token FROM channels WHERE slug = $1 LIMIT 1", [req.params.slug]);
            if (rows.length === 0) {
                res.status(404).json({ error: "Channel not found" });
                return;
            }
            const ch = rows[0];
            if (ch.owner_id !== uid) {
                res.status(403).json({ error: "Only the channel owner can provision playout" });
                return;
            }
            const token = ch.playout_token || crypto_1.default.randomBytes(24).toString("hex");
            const upd = yield pool_1.default.query(`UPDATE channels
          SET playout_token = $2, playout_mode = 'scheduled'
        WHERE id = $1
        RETURNING id, stream_key, playout_token`, [ch.id, token]);
            res.json({ config: buildPlayoutConfig(upd.rows[0]) });
        }
        catch (err) {
            console.error("provisionPlayout error:", err);
            res.status(500).json({ error: "Failed to provision playout" });
        }
    });
}
/**
 * GET /api/channels/:slug/playout/config   (owner only)
 * Read-only view of the engine config. 409 if the channel isn't provisioned yet.
 */
function getPlayoutConfig(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const uid = authUserIdOr401(req, res);
        if (!uid)
            return;
        try {
            const { rows } = yield pool_1.default.query("SELECT id, owner_id, stream_key, playout_token, playout_mode FROM channels WHERE slug = $1 LIMIT 1", [req.params.slug]);
            if (rows.length === 0) {
                res.status(404).json({ error: "Channel not found" });
                return;
            }
            const ch = rows[0];
            if (ch.owner_id !== uid) {
                res.status(403).json({ error: "Only the channel owner can view playout config" });
                return;
            }
            if (!ch.playout_token) {
                res.status(409).json({ error: "Channel is not provisioned for playout" });
                return;
            }
            res.json({ config: buildPlayoutConfig(ch), playout_mode: ch.playout_mode });
        }
        catch (err) {
            console.error("getPlayoutConfig error:", err);
            res.status(500).json({ error: "Failed to read playout config" });
        }
    });
}
/**
 * GET /api/playout/pl/:token/:year/:month/:date
 *
 * The URL ffplayout is pointed at (its `playlists` config = the /pl/:token
 * base). The engine fetches `<base>/YYYY/MM/YYYY-MM-DD.json` and reloads when
 * Last-Modified changes. The token both identifies the channel and authorizes
 * the pull (it is a per-channel secret, never shown in a browser), so no bearer
 * header is needed.
 *
 * :date is the filename, e.g. "2026-07-21.json".
 */
function getPlaylist(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const token = String(req.params.token || "").trim();
        const dateName = String(req.params.date || "");
        const dateMatch = dateName.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
        if (!token || !dateMatch) {
            res.status(400).send("bad request");
            return;
        }
        const date = dateMatch[1];
        try {
            const chan = yield pool_1.default.query(`SELECT id, COALESCE(display_name, name) AS label, schedule_rev
         FROM channels WHERE playout_token = $1 LIMIT 1`, [token]);
            if (chan.rowCount === 0) {
                res.status(404).send("unknown channel");
                return;
            }
            const channel = chan.rows[0];
            // Last-Modified / If-Modified-Since: how ffplayout avoids re-parsing an
            // unchanged playlist. schedule_rev bumps on any segment mutation.
            const lastModified = new Date(channel.schedule_rev);
            const ims = req.headers["if-modified-since"];
            if (ims && new Date(ims).getTime() >= Math.floor(lastModified.getTime() / 1000) * 1000) {
                res.status(304).end();
                return;
            }
            const seg = yield pool_1.default.query(`SELECT m.storage_path, m.title, s.in_ms, s.out_ms,
              m.duration_ms AS media_duration_ms, s.category
         FROM channel_segments s
         JOIN channel_media m ON m.id = s.media_id
        WHERE s.channel_id = $1 AND m.conform_status = 'ready'
        ORDER BY s.position ASC`, [channel.id]);
            const playlist = (0, playlist_1.buildDayPlaylist)(channel.label || "Channel", date, seg.rows);
            res.set("Last-Modified", lastModified.toUTCString());
            res.set("Cache-Control", "no-cache");
            res.json(playlist);
        }
        catch (err) {
            console.error("getPlaylist error:", err);
            res.status(500).send("playlist error");
        }
    });
}
/**
 * As-run reporting endpoint.
 *
 * The Cinezoo-hosted ffplayout runs a fire-and-forget task script on every clip
 * start (see docs/ffplayout-adapter.md section 6). That script POSTs here the
 * same JSON `GET /api/control/{id}/media/current` returns:
 *
 *   { "index": 3, "ingest": false, "mode": "playlist", "elapsed": 12.3,
 *     "media": { "in": 0.0, "out": 252.0, "duration": 252.0,
 *                "category": "", "source": "sketches/cold-open.mp4",
 *                "title": "Cold Open" } }
 *
 * We record it as ground truth for "Now Playing". Machine-to-machine, so auth is
 * the channel's stream_key via X-Stream-Key (same secret nginx-rtmp validates),
 * not a user JWT.
 *
 * The caller discards the response, so we stay lenient: record what we can,
 * answer 204, and never make the playout engine's task script care about us.
 */
function recordAsRun(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const streamKey = String((_a = req.header("x-stream-key")) !== null && _a !== void 0 ? _a : "").trim();
        if (!streamKey) {
            res.status(401).send("missing stream key");
            return;
        }
        const body = (_b = req.body) !== null && _b !== void 0 ? _b : {};
        const media = (_c = body.media) !== null && _c !== void 0 ? _c : {};
        const source = typeof media.source === "string" ? media.source : "";
        if (!source) {
            res.status(400).send("missing media.source");
            return;
        }
        try {
            const chan = yield pool_1.default.query("SELECT id FROM channels WHERE stream_key = $1 LIMIT 1", [streamKey]);
            if (chan.rowCount === 0) {
                res.status(403).send("invalid stream key");
                return;
            }
            const channelId = chan.rows[0].id;
            // Playing time is out - in (NOT `duration`, which is the full asset length).
            const inSec = Number(media.in) || 0;
            const outSec = Number(media.out) || 0;
            const durationMs = outSec > inSec ? Math.round((outSec - inSec) * 1000) : null;
            const isIngest = body.ingest === true;
            const title = typeof media.title === "string" ? media.title : null;
            // Best-effort attribution back to a scheduled segment. Returns null until
            // the scheduler (Phase 4) populates channel_media / channel_segments; the FK
            // is nullable, so recording an unmatched airing is fine.
            //
            // ffplayout reports `source` as the ABSOLUTE path it played
            // (<media_storage_root>/<file>), while channel_media.storage_path is stored
            // relative to that root. Match on the basename so attribution works whether
            // the engine reports an absolute or relative source.
            const sourceBasename = source.split("/").pop() || source;
            const seg = yield pool_1.default.query(`SELECT s.id
         FROM channel_segments s
         JOIN channel_media m ON m.id = s.media_id
        WHERE s.channel_id = $1
          AND (m.storage_path = $2 OR m.storage_path = $3)
        ORDER BY s.position
        LIMIT 1`, [channelId, source, sourceBasename]);
            const segmentId = seg.rowCount ? seg.rows[0].id : null;
            yield pool_1.default.query(`INSERT INTO channel_asrun
         (channel_id, segment_id, source, title, started_at, duration_ms, is_ingest, raw)
       VALUES ($1, $2, $3, $4, now(), $5, $6, $7)`, [channelId, segmentId, source, title, durationMs, isIngest, body]);
            res.status(204).end();
        }
        catch (err) {
            console.error("recordAsRun error:", err);
            res.status(500).send("as-run error");
        }
    });
}
