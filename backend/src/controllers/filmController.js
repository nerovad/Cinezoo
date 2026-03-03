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
exports.createFilm = createFilm;
exports.listFilms = listFilms;
exports.getMyFilms = getMyFilms;
exports.listFilmsForChannel = listFilmsForChannel;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const pool_1 = __importDefault(require("../../db/pool"));
/* ========================= Helpers ========================= */
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
function toSeconds(s) {
    if (!s)
        return null;
    const parts = s.split(":").map((n) => Number(n));
    if (parts.some((n) => Number.isNaN(n)))
        return null;
    if (parts.length === 3)
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2)
        return parts[0] * 60 + parts[1];
    return parts[0];
}
function fmtDuration(sec) {
    if (sec == null || Number.isNaN(sec))
        return null;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0)
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
/** Resolve a channel id by numeric id, or by slug/name/stream_key */
function findChannelId(key) {
    return __awaiter(this, void 0, void 0, function* () {
        if (/^\d+$/.test(key)) {
            const r = yield pool_1.default.query(`select id from channels where id = $1 limit 1`, [Number(key)]);
            return r.rowCount ? r.rows[0].id : null;
        }
        const { rows } = yield pool_1.default.query(`select id from channels
      where slug = $1 or name = $1 or stream_key = $1
      limit 1`, [key]);
        return rows.length ? rows[0].id : null;
    });
}
/* ========================= Endpoints ========================= */
/**
 * POST /api/films
 * Body: { title: string, duration?: "MM:SS" | "HH:MM:SS" }
 * Notes:
 * - Uses your existing global unique-on-title upsert pattern.
 * - Also sets creator_user_id when possible and updates runtime_seconds if provided.
 */
function createFilm(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const uid = authUserIdOr401(req, res);
            if (!uid)
                return;
            const { title, duration } = ((_a = req.body) !== null && _a !== void 0 ? _a : {});
            if (!(title === null || title === void 0 ? void 0 : title.trim())) {
                res.status(400).json({ error: "title is required" });
                return;
            }
            const runtimeSeconds = toSeconds(duration);
            const { rows } = yield pool_1.default.query(`
      insert into films (title, creator_user_id, runtime_seconds, created_at)
      values ($1, $2, $3, now())
      on conflict (title) do update set
        creator_user_id = coalesce(films.creator_user_id, excluded.creator_user_id),
        runtime_seconds = coalesce(excluded.runtime_seconds, films.runtime_seconds)
      returning id, title, creator_user_id, runtime_seconds, created_at
      `, [title.trim(), uid, runtimeSeconds]);
            res.status(201).json({
                id: rows[0].id,
                title: rows[0].title,
                duration: fmtDuration(rows[0].runtime_seconds),
            });
        }
        catch (err) {
            next(err);
        }
    });
}
/**
 * GET /api/films
 * Returns a simple recent list (unchanged behavior).
 */
function listFilms(_req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { rows } = yield pool_1.default.query(`select id, title, runtime_seconds from films order by id desc limit 500`);
            res.json(rows.map((r) => ({
                id: r.id,
                title: r.title,
                duration: fmtDuration(r.runtime_seconds),
            })));
        }
        catch (err) {
            next(err);
        }
    });
}
/**
 * GET /api/films/mine
 * Films created by the logged-in user (for the Profile "Films" tab).
 * Shape matches your Profile card expectations: id, title, duration, thumbnail?, synopsis?
 * (We return null for fields you don’t store yet.)
 */
function getMyFilms(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const uid = authUserIdOr401(req, res);
            if (!uid)
                return;
            const { rows } = yield pool_1.default.query(`
      select id, title, runtime_seconds
        from films
       where creator_user_id = $1
       order by created_at desc
      `, [uid]);
            res.json(rows.map((r) => ({
                id: r.id,
                title: r.title,
                duration: fmtDuration(r.runtime_seconds),
                thumbnail: null, // you don't have thumbnail columns (safe for UI)
                synopsis: null, // you don't have synopsis columns (safe for UI)
            })));
        }
        catch (err) {
            next(err);
        }
    });
}
/**
 * GET /api/channels/:channelId/films
 * Returns lineup for the channel’s active session, or latest session if none active.
 * Output is an array ordered by session_entries.order_index.
 */
function listFilmsForChannel(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool_1.default.connect();
        try {
            const channelKey = String(req.params.channelId || req.params.slug);
            console.log("🔍 Looking for channel:", channelKey);
            const cid = yield findChannelId(channelKey);
            if (!cid) {
                console.log("❌ Channel not found for key:", channelKey); // Add this too
                res.json([]);
                return;
            }
            console.log("✅ Found channel ID:", cid);
            const nowIso = new Date().toISOString();
            // Prefer active session
            const active = yield client.query(`select id
         from sessions
        where channel_id = $1
          and starts_at <= $2
          and (ends_at is null or ends_at >= $2)
        order by starts_at desc
        limit 1`, [cid, nowIso]);
            let sessionId = active.rowCount ? active.rows[0].id : null;
            // Fallback to latest session
            if (!sessionId) {
                const latest = yield client.query(`select id
           from sessions
          where channel_id = $1
          order by starts_at desc
          limit 1`, [cid]);
                sessionId = latest.rowCount ? latest.rows[0].id : null;
            }
            if (!sessionId) {
                res.json([]);
                return;
            }
            const rows = yield client.query(`select f.id, f.title, f.runtime_seconds, se.order_index
         from session_entries se
         join films f on f.id = se.film_id
        where se.session_id = $1
        order by se.order_index asc, f.id asc`, [sessionId]);
            res.json(rows.rows.map((r) => ({
                id: String(r.id),
                title: r.title,
                duration: fmtDuration(r.runtime_seconds),
                // front-end tolerates missing fields
                thumbnail: null,
                synopsis: null,
                order: r.order_index,
            })));
        }
        catch (err) {
            next(err);
        }
        finally {
            client.release();
        }
    });
}
