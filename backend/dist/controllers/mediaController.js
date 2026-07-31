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
exports.mediaUpload = void 0;
exports.uploadMedia = uploadMedia;
exports.listMedia = listMedia;
exports.deleteMedia = deleteMedia;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const pool_1 = __importDefault(require("../db/pool"));
const mediaStorage_1 = require("../services/mediaStorage");
const conform_1 = require("../services/conform");
/* Auth helper — matches channelController/profileController style. */
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
/* Resolve a channel by slug and confirm the caller owns it. */
function ownedChannelOr403(slug, uid, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { rows } = yield pool_1.default.query("SELECT id, owner_id FROM channels WHERE slug = $1 LIMIT 1", [slug]);
        if (rows.length === 0) {
            res.status(404).json({ error: "Channel not found" });
            return null;
        }
        if (rows[0].owner_id !== uid) {
            res.status(403).json({ error: "Only the channel owner can manage media" });
            return null;
        }
        return { id: rows[0].id };
    });
}
/**
 * multer instance for master uploads. Streams straight to a temp dir on disk
 * (no memory buffering — masters are large). We move it to the per-channel raw
 * dir inside the handler, once we know the channel is valid and owned.
 */
exports.mediaUpload = (0, multer_1.default)({
    dest: undefined, // set per-request via storage below
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, cb) => {
            const tmp = require("path").join(require("os").tmpdir(), "cinezoo-uploads");
            (0, mediaStorage_1.ensureDir)(tmp);
            cb(null, tmp);
        },
        filename: (_req, _file, cb) => cb(null, `up_${Date.now()}_${crypto_1.default.randomBytes(6).toString("hex")}`),
    }),
    limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB ceiling for a master
});
/**
 * POST /api/channels/:slug/media   (multipart: field "file", plus "title")
 * Accepts a master upload, records a pending channel_media row, and kicks off
 * the background conform. Returns immediately with the pending row so the UI
 * can show "processing".
 */
function uploadMedia(req, res, _next) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const uid = authUserIdOr401(req, res);
        if (!uid)
            return;
        const file = req.file;
        const cleanupTmp = () => { if (file === null || file === void 0 ? void 0 : file.path)
            fs_1.default.promises.unlink(file.path).catch(() => { }); };
        if (!file) {
            res.status(400).json({ error: "No file uploaded (expected multipart field 'file')" });
            return;
        }
        try {
            const channel = yield ownedChannelOr403(req.params.slug, uid, res);
            if (!channel) {
                cleanupTmp();
                return;
            }
            const title = String(((_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.title) !== null && _b !== void 0 ? _b : "") || file.originalname || "Untitled").slice(0, 200);
            const uuid = crypto_1.default.randomUUID();
            // Move the temp upload into the channel's raw dir.
            const dest = (0, mediaStorage_1.rawPath)(channel.id, uuid, file.originalname || "master");
            (0, mediaStorage_1.ensureDir)(require("path").dirname(dest));
            yield fs_1.default.promises.rename(file.path, dest).catch(() => __awaiter(this, void 0, void 0, function* () {
                // rename across filesystems can EXDEV — fall back to copy+unlink
                yield fs_1.default.promises.copyFile(file.path, dest);
                yield fs_1.default.promises.unlink(file.path).catch(() => { });
            }));
            // Pending row. duration_ms is filled in by the conform worker (NOT NULL, so
            // 0 as a placeholder until 'ready'). storage_path is set to the planned
            // conformed path by the worker on success.
            const ins = yield pool_1.default.query(`INSERT INTO channel_media
         (channel_id, title, storage_path, duration_ms, source_kind, original_name, conform_status)
       VALUES ($1, $2, $3, 0, 'hosted', $4, 'pending')
       RETURNING id, title, duration_ms, conform_status, created_at`, [channel.id, title, `raw/${uuid}`, file.originalname || null]);
            const media = ins.rows[0];
            // Fire-and-forget conform; the row flips to ready/failed when it finishes.
            void (0, conform_1.conformMedia)({ mediaId: media.id, channelId: channel.id, uuid, rawPath: dest });
            res.status(202).json({ media });
        }
        catch (err) {
            cleanupTmp();
            console.error("uploadMedia error:", err);
            res.status(500).json({ error: "Upload failed" });
        }
    });
}
/** GET /api/channels/:slug/media — the channel's media catalogue (owner only). */
function listMedia(req, res, _next) {
    return __awaiter(this, void 0, void 0, function* () {
        const uid = authUserIdOr401(req, res);
        if (!uid)
            return;
        try {
            const channel = yield ownedChannelOr403(req.params.slug, uid, res);
            if (!channel)
                return;
            const { rows } = yield pool_1.default.query(`SELECT id, title, duration_ms, source_kind, conform_status, original_name, created_at
         FROM channel_media
        WHERE channel_id = $1
        ORDER BY created_at DESC`, [channel.id]);
            res.json({ media: rows });
        }
        catch (err) {
            console.error("listMedia error:", err);
            res.status(500).json({ error: "Failed to list media" });
        }
    });
}
/** DELETE /api/channels/:slug/media/:id — remove a media item and its file. */
function deleteMedia(req, res, _next) {
    return __awaiter(this, void 0, void 0, function* () {
        const uid = authUserIdOr401(req, res);
        if (!uid)
            return;
        try {
            const channel = yield ownedChannelOr403(req.params.slug, uid, res);
            if (!channel)
                return;
            const mediaId = Number(req.params.id);
            const { rows } = yield pool_1.default.query(`DELETE FROM channel_media WHERE id = $1 AND channel_id = $2
       RETURNING storage_path`, [mediaId, channel.id]);
            if (rows.length === 0) {
                res.status(404).json({ error: "Media not found" });
                return;
            }
            // Best-effort file cleanup (both conformed and any leftover raw).
            const rel = rows[0].storage_path;
            const abs = require("path").join((0, mediaStorage_1.channelRoot)(channel.id), rel);
            fs_1.default.promises.unlink(abs).catch(() => { });
            res.status(204).end();
        }
        catch (err) {
            console.error("deleteMedia error:", err);
            res.status(500).json({ error: "Failed to delete media" });
        }
    });
}
