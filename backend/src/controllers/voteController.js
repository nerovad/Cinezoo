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
exports.createRatingFromChannelFilm = exports.getLeaderboard = exports.rateEntry = void 0;
const pool_1 = __importDefault(require("../../db/pool"));
const crypto_1 = __importDefault(require("crypto"));
const rateEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const sessionId = Number(req.params.sessionId);
        const entryId = Number(req.params.entryId);
        const { score } = req.body;
        const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.id) || 1; // replace with real auth later
        const ballot = yield pool_1.default.query(`INSERT INTO ballots (session_id, user_id, weight)
VALUES ($1, $2, 1.0)
ON CONFLICT (session_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
RETURNING id`, [sessionId, userId]);
        yield pool_1.default.query(`INSERT INTO ratings (session_id, entry_id, ballot_id, score)
VALUES ($1, $2, $3, $4)
ON CONFLICT (session_id, entry_id, ballot_id)
DO UPDATE SET score = EXCLUDED.score, created_at = now()`, [sessionId, entryId, ballot.rows[0].id, score]);
        res.json({ ok: true });
    }
    catch (err) {
        console.error("Error rating:", err);
        res.status(500).json({ error: "Error saving rating" });
    }
});
exports.rateEntry = rateEntry;
const getLeaderboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const sessionId = Number(req.params.sessionId);
        const { rows } = yield pool_1.default.query(`SELECT
se.id AS entry_id,
f.title,
ROUND(SUM(r.score * COALESCE(b.weight,1)) / NULLIF(SUM(COALESCE(b.weight,1)),0), 3) AS weighted_avg,
COUNT(*) AS votes
FROM ratings r
JOIN ballots b ON (b.session_id = r.session_id AND b.id = r.ballot_id)
JOIN session_entries se ON se.id = r.entry_id
JOIN films f ON f.id = se.film_id
WHERE r.session_id = $1
GROUP BY se.id, f.title
ORDER BY weighted_avg DESC, votes DESC`, [sessionId]);
        res.json(rows);
    }
    catch (err) {
        console.error("Error leaderboard:", err);
        res.status(500).json({ error: "Error fetching leaderboard" });
    }
});
exports.getLeaderboard = getLeaderboard;
// --- helper to resolve channel -> session -> entry ---
function resolveSessionAndEntryId(channelKey, filmId) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool_1.default.connect();
        try {
            // 1) channel by slug | name | stream_key
            const ch = yield client.query(`SELECT id FROM channels WHERE slug=$1 OR name=$1 OR stream_key=$1 LIMIT 1`, [channelKey]);
            if (!ch.rowCount)
                return null;
            const channelId = ch.rows[0].id;
            // 2) pick active session, else latest
            const nowIso = new Date().toISOString();
            const active = yield client.query(`SELECT id FROM sessions
        WHERE channel_id=$1
          AND starts_at <= $2
          AND (ends_at IS NULL OR ends_at >= $2)
        ORDER BY starts_at DESC
        LIMIT 1`, [channelId, nowIso]);
            let sessionId = active.rowCount ? active.rows[0].id : null;
            if (!sessionId) {
                const latest = yield client.query(`SELECT id FROM sessions WHERE channel_id=$1 ORDER BY starts_at DESC LIMIT 1`, [channelId]);
                sessionId = latest.rowCount ? latest.rows[0].id : null;
            }
            if (!sessionId)
                return null;
            // 3) entry in that session for the given film
            const entry = yield client.query(`SELECT id FROM session_entries WHERE session_id=$1 AND film_id=$2 LIMIT 1`, [sessionId, filmId]);
            if (!entry.rowCount)
                return null;
            return { sessionId, entryId: entry.rows[0].id };
        }
        finally {
            client.release();
        }
    });
}
/**
 * Adapter for frontend: POST /api/ratings
 * Body: { channel: string, film_id: number|string, score: number }
 * Reuses the same ballots/ratings logic as rateEntry.
 */
const createRatingFromChannelFilm = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { channel, film_id, score } = req.body;
        if (!channel || !film_id || typeof score !== "number" || score < 1 || score > 10) {
            res.status(400).json({ error: "invalid_payload" });
            return;
        }
        const resolved = yield resolveSessionAndEntryId(channel, Number(film_id));
        if (!resolved) {
            res.status(400).json({ error: "session_or_entry_not_found" });
            return;
        }
        const { sessionId, entryId } = resolved;
        // Use your existing user (or anonymous fallback)
        const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.id) || 1; // replace with real auth later
        // Optional fingerprint (nice to have if you want to de-dupe later)
        const ua = req.get("user-agent") || "";
        const ip = ((_c = (_b = req.headers["x-forwarded-for"]) === null || _b === void 0 ? void 0 : _b.split(",")[0]) === null || _c === void 0 ? void 0 : _c.trim()) || req.ip || "";
        const fingerprint = crypto_1.default.createHash("sha256").update(`${ip}|${ua}|${userId}`).digest("hex");
        // Create/Upsert ballot (your original logic)
        const ballot = yield pool_1.default.query(`INSERT INTO ballots (session_id, user_id, fingerprint_sha256, weight)
       VALUES ($1, $2, $3, 1.0)
       ON CONFLICT (session_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING id`, [sessionId, userId, fingerprint]);
        yield pool_1.default.query(`INSERT INTO ratings (session_id, entry_id, ballot_id, score)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id, entry_id, ballot_id)
       DO UPDATE SET score = EXCLUDED.score, created_at = now()`, [sessionId, entryId, ballot.rows[0].id, score]);
        res.status(201).json({ ok: true });
    }
    catch (err) {
        console.error("Error rating (adapter):", err);
        res.status(500).json({ error: "Error saving rating" });
    }
});
exports.createRatingFromChannelFilm = createRatingFromChannelFilm;
