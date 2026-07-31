"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/channelRoutes.ts
const express_1 = __importDefault(require("express"));
const channelController_1 = require("../controllers/channelController");
const filmController_1 = require("../controllers/filmController");
const contributionController_1 = require("../controllers/contributionController");
const mediaController_1 = require("../controllers/mediaController");
const segmentController_1 = require("../controllers/segmentController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// GET /api/channels/mine - MUST be before /:slug to avoid conflicts
router.get("/mine", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, channelController_1.getMyChannels)(req, res).catch(next);
});
// GET /api/channels/:channelId/analytics - Get channel analytics (owner only)
router.get("/:channelId(\\d+)/analytics", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, channelController_1.getChannelAnalytics)(req, res).catch(next);
});
// POST /api/channels - requires super_admin or network group
router.post("/", authMiddleware_1.authenticateToken, (0, authMiddleware_1.requireGroup)('super_admin', 'network'), (req, res, next) => {
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
// POST /api/channels/:slug/contributions - pitch a film to this channel
router.post("/:slug/contributions", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, contributionController_1.createContribution)(req, res, next);
});
// GET /api/channels/:slug/contributions - owner sees all pitches; others see their own
router.get("/:slug/contributions", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, contributionController_1.listChannelContributions)(req, res, next);
});
// GET /api/channels/:slug/contributors - public credits (accepted pitches per user)
router.get("/:slug/contributors", (req, res, next) => {
    (0, contributionController_1.listChannelContributors)(req, res, next);
});
// POST /api/channels/:slug/contributors - owner adds invitee / trusted contributor
router.post("/:slug/contributors", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, contributionController_1.addChannelContributor)(req, res, next);
});
// DELETE /api/channels/:slug/contributors/:userId - owner removes a contributor
router.delete("/:slug/contributors/:userId(\\d+)", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, contributionController_1.removeChannelContributor)(req, res, next);
});
// --- Media pipeline (Phase 3): owner uploads masters; conform to house format ---
// POST /api/channels/:slug/media - upload a master (multipart field "file"); conforms in background
router.post("/:slug/media", authMiddleware_1.authenticateToken, mediaController_1.mediaUpload.single("file"), (req, res, next) => {
    (0, mediaController_1.uploadMedia)(req, res, next);
});
// GET /api/channels/:slug/media - owner's media catalogue (for the scheduler)
router.get("/:slug/media", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, mediaController_1.listMedia)(req, res, next);
});
// DELETE /api/channels/:slug/media/:id - owner removes a media item and its file
router.delete("/:slug/media/:id(\\d+)", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, mediaController_1.deleteMedia)(req, res, next);
});
// --- Scheduler (Phase 4): the ordered segment list that becomes the playlist ---
// GET /api/channels/:slug/segments - the ordered program list (owner)
router.get("/:slug/segments", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, segmentController_1.listSegments)(req, res, next);
});
// POST /api/channels/:slug/segments - append a segment from a media item
router.post("/:slug/segments", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, segmentController_1.addSegment)(req, res, next);
});
// POST /api/channels/:slug/segments/reorder - drag-and-drop write { ordered_ids }
router.post("/:slug/segments/reorder", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, segmentController_1.reorderSegments)(req, res, next);
});
// PATCH /api/channels/:slug/segments/:id - adjust trim/category
router.patch("/:slug/segments/:id(\\d+)", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, segmentController_1.updateSegment)(req, res, next);
});
// DELETE /api/channels/:slug/segments/:id - remove a segment
router.delete("/:slug/segments/:id(\\d+)", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, segmentController_1.deleteSegment)(req, res, next);
});
// GET /api/channels/:slug (get single channel by slug)
router.get("/:slug", (req, res, next) => {
    (0, channelController_1.getChannel)(req, res, next);
});
exports.default = router;
