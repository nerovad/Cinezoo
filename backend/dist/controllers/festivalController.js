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
exports.createSession = createSession;
exports.startSession = startSession;
exports.closeSession = closeSession;
exports.addEntry = addEntry;
exports.getLineup = getLineup;
const pool_1 = __importDefault(require("../db/pool"));
/** Create a session (festival) for a channel */
function createSession(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { channelSlug, title, starts_at, ends_at, status, timezone } = req.body;
            if (!channelSlug || !title) {
                res.status(400).json({ error: "channelSlug and title are required" });
                return;
            }
            const ch = yield pool_1.default.query(`SELECT id FROM channels WHERE slug = $1 LIMIT 1`, [channelSlug]);
            if (ch.rowCount === 0) {
                res.status(404).json({ error: "Channel not found" });
                return;
            }
            const channelId = ch.rows[0].id;
            const result = yield pool_1.default.query(`INSERT INTO sessions (channel_id, title, starts_at, ends_at, status, timezone)
       VALUES ($1, $2, COALESCE($3, now()), $4, COALESCE($5, 'scheduled'), $6)
       RETURNING id, channel_id, title, starts_at, ends_at, status, timezone, created_at`, [channelId, title, starts_at !== null && starts_at !== void 0 ? starts_at : null, ends_at !== null && ends_at !== void 0 ? ends_at : null, status !== null && status !== void 0 ? status : null, timezone !== null && timezone !== void 0 ? timezone : null]);
            res.status(201).json(result.rows[0]);
        }
        catch (err) {
            next(err);
        }
    });
}
/** Start a session now (status → live) */
function startSession(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const sessionId = Number(req.params.sessionId);
            const { rows } = yield pool_1.default.query(`UPDATE sessions
          SET status = 'live',
              starts_at = COALESCE(starts_at, now())
        WHERE id = $1
      RETURNING id, channel_id, title, starts_at, ends_at, status`, [sessionId]);
            if (rows.length === 0) {
                res.status(404).json({ error: "Session not found" });
                return;
            }
            res.json(rows[0]);
        }
        catch (err) {
            next(err);
        }
    });
}
/** Close a session now (status → closed) */
function closeSession(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const sessionId = Number(req.params.sessionId);
            const { rows } = yield pool_1.default.query(`UPDATE sessions
          SET status = 'closed',
              ends_at = COALESCE(ends_at, now())
        WHERE id = $1
      RETURNING id, channel_id, title, starts_at, ends_at, status`, [sessionId]);
            if (rows.length === 0) {
                res.status(404).json({ error: "Session not found" });
                return;
            }
            res.json(rows[0]);
        }
        catch (err) {
            next(err);
        }
    });
}
/** Add a film to the session lineup (creates film if needed) */
function addEntry(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const sessionId = Number(req.params.sessionId);
            const { filmId, filmTitle, order_index } = req.body;
            if (!filmId && !filmTitle) {
                res.status(400).json({ error: "filmId or filmTitle is required" });
                return;
            }
            let idToUse = filmId !== null && filmId !== void 0 ? filmId : null;
            if (!idToUse) {
                // upsert film by title (simple)
                const f = yield pool_1.default.query(`INSERT INTO films (title)
         VALUES ($1)
         ON CONFLICT (title) DO UPDATE SET title = EXCLUDED.title
         RETURNING id, title`, [filmTitle.trim()]);
                idToUse = f.rows[0].id;
            }
            const ins = yield pool_1.default.query(`INSERT INTO session_entries (session_id, film_id, order_index)
       VALUES ($1, $2, COALESCE($3, (
         SELECT COALESCE(MAX(order_index), 0) + 1 FROM session_entries WHERE session_id = $1
       )))
       RETURNING id, session_id, film_id, order_index`, [sessionId, idToUse, order_index !== null && order_index !== void 0 ? order_index : null]);
            res.status(201).json(ins.rows[0]);
        }
        catch (err) {
            next(err);
        }
    });
}
/** Get the lineup for a session */
function getLineup(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const sessionId = Number(req.params.sessionId);
            const { rows } = yield pool_1.default.query(`SELECT se.id AS entry_id,
              se.order_index,
              f.id  AS film_id,
              f.title
         FROM session_entries se
         JOIN films f ON f.id = se.film_id
        WHERE se.session_id = $1
        ORDER BY se.order_index ASC, se.id ASC`, [sessionId]);
            res.json(rows);
        }
        catch (err) {
            next(err);
        }
    });
}
