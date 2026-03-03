"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/channelRoutes.ts
const express_1 = __importDefault(require("express"));
const channelController_1 = require("../controllers/channelController");
const filmController_1 = require("../controllers/filmController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// GET /api/channels/mine - MUST be before /:slug to avoid conflicts
router.get("/mine", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, channelController_1.getMyChannels)(req, res).catch(next);
});
// POST /api/channels
router.post("/", (req, res, next) => {
    (0, channelController_1.createChannel)(req, res, next);
});
// GET /api/channels (list all channels)
router.get("/", (req, res, next) => {
    (0, channelController_1.listChannels)(req, res, next);
});
// PATCH /api/channels/:id (update channel)
router.patch("/:id", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, channelController_1.updateChannel)(req, res, next);
});
// DELETE /api/channels/:id (delete channel)
router.delete("/:id", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, channelController_1.deleteChannel)(req, res, next);
});
// GET /api/channels/:channelId/films (numeric IDs only)
router.get("/:channelId(\\d+)/films", (req, res, next) => {
    (0, filmController_1.listFilmsForChannel)(req, res, next);
});
router.get("/:slug/films", (req, res, next) => {
    (0, filmController_1.listFilmsForChannel)(req, res, next);
});
// GET /api/channels/:slug/schedule - Get channel schedule
router.get("/:slug/schedule", (req, res) => {
    (0, channelController_1.getChannelSchedule)(req, res);
});
// POST /api/channels/:slug/schedule - Create/update schedule items
router.post("/:slug/schedule", authMiddleware_1.authenticateToken, (req, res) => {
    (0, channelController_1.updateChannelSchedule)(req, res);
});
// GET /api/channels/:slug (get single channel by slug)
router.get("/:slug", (req, res, next) => {
    (0, channelController_1.getChannel)(req, res, next);
});
exports.default = router;
