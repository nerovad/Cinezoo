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
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const pool_1 = __importDefault(require("../db/pool"));
const router = express_1.default.Router();
const MAX_SAVED = 5;
// GET /api/saved-channels — list saved channels for the authenticated user
router.get("/", authMiddleware_1.authenticateToken, (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { rows } = yield pool_1.default.query(`SELECT c.slug, c.display_name, c.name
       FROM saved_channels sc
       JOIN channels c ON c.id = sc.channel_id
       WHERE sc.user_id = $1
       ORDER BY sc.created_at ASC`, [req.userId]);
        res.json(rows.map(r => ({ slug: r.slug, name: r.display_name || r.name || r.slug })));
    }
    catch (err) {
        next(err);
    }
}));
// POST /api/saved-channels/:slug — save a channel
router.post("/:slug", authMiddleware_1.authenticateToken, (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Look up channel
        const ch = yield pool_1.default.query("SELECT id FROM channels WHERE slug = $1", [req.params.slug]);
        if (ch.rows.length === 0) {
            res.status(404).json({ error: "Channel not found" });
            return;
        }
        const channelId = ch.rows[0].id;
        // Check limit
        const countRes = yield pool_1.default.query("SELECT count(*)::int AS cnt FROM saved_channels WHERE user_id = $1", [req.userId]);
        if (countRes.rows[0].cnt >= MAX_SAVED) {
            res.status(400).json({ error: `You can save up to ${MAX_SAVED} channels` });
            return;
        }
        yield pool_1.default.query("INSERT INTO saved_channels (user_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.userId, channelId]);
        res.status(201).json({ saved: true });
    }
    catch (err) {
        next(err);
    }
}));
// DELETE /api/saved-channels/:slug — unsave a channel
router.delete("/:slug", authMiddleware_1.authenticateToken, (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const ch = yield pool_1.default.query("SELECT id FROM channels WHERE slug = $1", [req.params.slug]);
        if (ch.rows.length === 0) {
            res.status(404).json({ error: "Channel not found" });
            return;
        }
        yield pool_1.default.query("DELETE FROM saved_channels WHERE user_id = $1 AND channel_id = $2", [req.userId, ch.rows[0].id]);
        res.json({ saved: false });
    }
    catch (err) {
        next(err);
    }
}));
exports.default = router;
