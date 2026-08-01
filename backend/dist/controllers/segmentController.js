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
exports.listSegments = listSegments;
exports.addSegment = addSegment;
exports.updateSegment = updateSegment;
exports.reorderSegments = reorderSegments;
exports.deleteSegment = deleteSegment;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const pool_1 = __importDefault(require("../db/pool"));
/* Auth helper — matches the channelController/mediaController style. */
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
function ownedChannelOr403(slug, uid, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { rows } = yield pool_1.default.query("SELECT id, owner_id FROM channels WHERE slug = $1 LIMIT 1", [slug]);
        if (rows.length === 0) {
            res.status(404).json({ error: "Channel not found" });
            return null;
        }
        if (rows[0].owner_id !== uid) {
            res.status(403).json({ error: "Only the channel owner can manage the schedule" });
            return null;
        }
        return { id: rows[0].id };
    });
}
function bumpScheduleRev(channelId_1) {
    return __awaiter(this, arguments, void 0, function* (channelId, q = pool_1.default) {
        yield q.query("UPDATE channels SET schedule_rev = now() WHERE id = $1", [channelId]);
    });
}
/**
 * GET /api/channels/:slug/segments
 * The ordered program list, joined to media for the scheduler UI. Includes
 * playing_ms (out - in) so the timeline can size each block by duration.
 */
function listSegments(req, res, _next) {
    return __awaiter(this, void 0, void 0, function* () {
        const uid = authUserIdOr401(req, res);
        if (!uid)
            return;
        try {
            const channel = yield ownedChannelOr403(req.params.slug, uid, res);
            if (!channel)
                return;
            const { rows } = yield pool_1.default.query(`SELECT s.id, s.media_id, s.position, s.in_ms, s.out_ms, s.category,
              s.contribution_id,
              (s.out_ms - s.in_ms) AS playing_ms,
              m.title, m.duration_ms AS media_duration_ms, m.conform_status
         FROM channel_segments s
         JOIN channel_media m ON m.id = s.media_id
        WHERE s.channel_id = $1
        ORDER BY s.position ASC`, [channel.id]);
            res.json({ segments: rows });
        }
        catch (err) {
            console.error("listSegments error:", err);
            res.status(500).json({ error: "Failed to list segments" });
        }
    });
}
/**
 * POST /api/channels/:slug/segments   { media_id, in_ms?, out_ms?, category? }
 * Appends a segment (position = current max + 100). in/out default to the whole
 * clip. The media must belong to this channel and be conformed ('ready').
 */
function addSegment(req, res, _next) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const uid = authUserIdOr401(req, res);
        if (!uid)
            return;
        try {
            const channel = yield ownedChannelOr403(req.params.slug, uid, res);
            if (!channel)
                return;
            const mediaId = Number((_a = req.body) === null || _a === void 0 ? void 0 : _a.media_id);
            if (!Number.isFinite(mediaId)) {
                res.status(400).json({ error: "media_id is required" });
                return;
            }
            const m = yield pool_1.default.query(`SELECT id, duration_ms, conform_status
         FROM channel_media WHERE id = $1 AND channel_id = $2 LIMIT 1`, [mediaId, channel.id]);
            if (m.rowCount === 0) {
                res.status(404).json({ error: "Media not found on this channel" });
                return;
            }
            if (m.rows[0].conform_status !== "ready") {
                res.status(409).json({ error: `Media is not ready (status: ${m.rows[0].conform_status})` });
                return;
            }
            const fullMs = Number(m.rows[0].duration_ms);
            const inMs = clampInt((_b = req.body) === null || _b === void 0 ? void 0 : _b.in_ms, 0, 0, fullMs);
            const outMs = clampInt((_c = req.body) === null || _c === void 0 ? void 0 : _c.out_ms, fullMs, inMs + 1, fullMs);
            const category = typeof ((_d = req.body) === null || _d === void 0 ? void 0 : _d.category) === "string" ? req.body.category : null;
            const pos = yield pool_1.default.query(`SELECT COALESCE(MAX(position), 0) + 100 AS next FROM channel_segments WHERE channel_id = $1`, [channel.id]);
            const ins = yield pool_1.default.query(`INSERT INTO channel_segments (channel_id, media_id, position, in_ms, out_ms, category)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, media_id, position, in_ms, out_ms, category, (out_ms - in_ms) AS playing_ms`, [channel.id, mediaId, pos.rows[0].next, inMs, outMs, category]);
            yield bumpScheduleRev(channel.id);
            res.status(201).json({ segment: ins.rows[0] });
        }
        catch (err) {
            console.error("addSegment error:", err);
            res.status(500).json({ error: "Failed to add segment" });
        }
    });
}
/**
 * PATCH /api/channels/:slug/segments/:id   { in_ms?, out_ms?, category? }
 * Adjust a segment's trim points or category.
 */
function updateSegment(req, res, _next) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const uid = authUserIdOr401(req, res);
        if (!uid)
            return;
        try {
            const channel = yield ownedChannelOr403(req.params.slug, uid, res);
            if (!channel)
                return;
            const segId = Number(req.params.id);
            const cur = yield pool_1.default.query(`SELECT s.id, s.in_ms, s.out_ms, m.duration_ms
         FROM channel_segments s JOIN channel_media m ON m.id = s.media_id
        WHERE s.id = $1 AND s.channel_id = $2 LIMIT 1`, [segId, channel.id]);
            if (cur.rowCount === 0) {
                res.status(404).json({ error: "Segment not found" });
                return;
            }
            const fullMs = Number(cur.rows[0].duration_ms);
            const inMs = clampInt((_a = req.body) === null || _a === void 0 ? void 0 : _a.in_ms, Number(cur.rows[0].in_ms), 0, fullMs);
            const outMs = clampInt((_b = req.body) === null || _b === void 0 ? void 0 : _b.out_ms, Number(cur.rows[0].out_ms), inMs + 1, fullMs);
            const category = ((_c = req.body) === null || _c === void 0 ? void 0 : _c.category) === undefined
                ? undefined
                : (typeof req.body.category === "string" ? req.body.category : null);
            const upd = yield pool_1.default.query(`UPDATE channel_segments
          SET in_ms = $2, out_ms = $3,
              category = COALESCE($4, category)
        WHERE id = $1
        RETURNING id, media_id, position, in_ms, out_ms, category, (out_ms - in_ms) AS playing_ms`, [segId, inMs, outMs, category === undefined ? null : category]);
            yield bumpScheduleRev(channel.id);
            res.json({ segment: upd.rows[0] });
        }
        catch (err) {
            console.error("updateSegment error:", err);
            res.status(500).json({ error: "Failed to update segment" });
        }
    });
}
/**
 * POST /api/channels/:slug/segments/reorder   { ordered_ids: [id, id, ...] }
 * The drag-and-drop write. Rewrites positions to a gapped sequence (100, 200,
 * ...). The unique (channel_id, position) index is NOT deferrable, so a naive
 * bulk update could transiently collide; we first move every row to a unique
 * negative position, then assign finals.
 */
function reorderSegments(req, res, _next) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const uid = authUserIdOr401(req, res);
        if (!uid)
            return;
        const orderedIds = Array.isArray((_a = req.body) === null || _a === void 0 ? void 0 : _a.ordered_ids)
            ? req.body.ordered_ids.map((n) => Number(n)).filter((n) => Number.isFinite(n))
            : [];
        const client = yield pool_1.default.connect();
        try {
            const chan = yield client.query("SELECT id, owner_id FROM channels WHERE slug = $1 LIMIT 1", [req.params.slug]);
            if (chan.rowCount === 0) {
                res.status(404).json({ error: "Channel not found" });
                return;
            }
            if (chan.rows[0].owner_id !== uid) {
                res.status(403).json({ error: "Only the channel owner can manage the schedule" });
                return;
            }
            const channelId = chan.rows[0].id;
            // ordered_ids must be exactly the channel's current segment set.
            const existing = yield client.query("SELECT id FROM channel_segments WHERE channel_id = $1", [channelId]);
            const existingIds = new Set(existing.rows.map((r) => Number(r.id)));
            const sameSet = orderedIds.length === existingIds.size &&
                orderedIds.every((id) => existingIds.has(id)) &&
                new Set(orderedIds).size === orderedIds.length;
            if (!sameSet) {
                res.status(400).json({ error: "ordered_ids must list every segment of this channel exactly once" });
                return;
            }
            yield client.query("BEGIN");
            // Phase 1: park all rows at unique negative positions (no collision with finals).
            yield client.query("UPDATE channel_segments SET position = -position - 1 WHERE channel_id = $1", [channelId]);
            // Phase 2: assign gapped finals in the requested order.
            for (let i = 0; i < orderedIds.length; i++) {
                yield client.query("UPDATE channel_segments SET position = $1 WHERE id = $2 AND channel_id = $3", [(i + 1) * 100, orderedIds[i], channelId]);
            }
            yield bumpScheduleRev(channelId, client);
            yield client.query("COMMIT");
            const { rows } = yield client.query(`SELECT s.id, s.media_id, s.position, s.in_ms, s.out_ms, (s.out_ms - s.in_ms) AS playing_ms,
              m.title
         FROM channel_segments s JOIN channel_media m ON m.id = s.media_id
        WHERE s.channel_id = $1 ORDER BY s.position ASC`, [channelId]);
            res.json({ segments: rows });
        }
        catch (err) {
            yield client.query("ROLLBACK").catch(() => { });
            console.error("reorderSegments error:", err);
            res.status(500).json({ error: "Failed to reorder segments" });
        }
        finally {
            client.release();
        }
    });
}
/** DELETE /api/channels/:slug/segments/:id */
function deleteSegment(req, res, _next) {
    return __awaiter(this, void 0, void 0, function* () {
        const uid = authUserIdOr401(req, res);
        if (!uid)
            return;
        try {
            const channel = yield ownedChannelOr403(req.params.slug, uid, res);
            if (!channel)
                return;
            const segId = Number(req.params.id);
            const { rowCount } = yield pool_1.default.query("DELETE FROM channel_segments WHERE id = $1 AND channel_id = $2", [segId, channel.id]);
            if (rowCount === 0) {
                res.status(404).json({ error: "Segment not found" });
                return;
            }
            yield bumpScheduleRev(channel.id);
            res.status(204).end();
        }
        catch (err) {
            console.error("deleteSegment error:", err);
            res.status(500).json({ error: "Failed to delete segment" });
        }
    });
}
/** Parse an int from req input, defaulting and clamping to [min, max]. */
function clampInt(v, dflt, min, max) {
    const n = v === undefined || v === null ? dflt : Number(v);
    if (!Number.isFinite(n))
        return dflt;
    return Math.max(min, Math.min(max, Math.round(n)));
}
