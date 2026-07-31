// src/routes/channelRoutes.ts
import express, { Request, Response, NextFunction } from "express";
import {
  createChannel,
  listChannels,
  getChannel,
  updateChannel,
  deleteChannel,
  getMyChannels,
  getChannelSchedule,
  updateChannelSchedule,
  getChannelAnalytics,
} from "../controllers/channelController";
import { listFilmsForChannel } from "../controllers/filmController";
import {
  createContribution,
  listChannelContributions,
  listChannelContributors,
  addChannelContributor,
  removeChannelContributor,
} from "../controllers/contributionController";
import { uploadMedia, listMedia, deleteMedia, mediaUpload } from "../controllers/mediaController";
import {
  listSegments,
  addSegment,
  updateSegment,
  reorderSegments,
  deleteSegment,
} from "../controllers/segmentController";
import { authenticateToken, requireGroup, AuthRequest } from "../middleware/authMiddleware";

const router = express.Router();

// GET /api/channels/mine - MUST be before /:slug to avoid conflicts
router.get("/mine", authenticateToken, (req: AuthRequest, res: Response, next: NextFunction): void => {
  getMyChannels(req, res).catch(next);
});

// GET /api/channels/:channelId/analytics - Get channel analytics (owner only)
router.get("/:channelId(\\d+)/analytics", authenticateToken, (req: AuthRequest, res: Response, next: NextFunction): void => {
  getChannelAnalytics(req, res).catch(next);
});

// POST /api/channels - requires super_admin or network group
router.post("/", authenticateToken, requireGroup('super_admin', 'network'), (req: Request, res: Response, next: NextFunction) => {
  createChannel(req, res, next);
});

// GET /api/channels (list all channels)
router.get("/", (req: Request, res: Response, next: NextFunction) => {
  listChannels(req, res, next);
});

// PATCH /api/channels/:id (update channel)
router.patch("/:id", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  updateChannel(req, res, next);
});

// DELETE /api/channels/:id (delete channel)
router.delete("/:id", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  deleteChannel(req, res, next);
});

// GET /api/channels/:channelId/films (numeric IDs only)
router.get("/:channelId(\\d+)/films", (req: Request, res: Response, next: NextFunction) => {
  listFilmsForChannel(req, res, next);
});

router.get("/:slug/films", (req: Request, res: Response, next: NextFunction) => {
  listFilmsForChannel(req, res, next);
});

// GET /api/channels/:slug/schedule - Get channel schedule
router.get("/:slug/schedule", (req: Request, res: Response) => {
  getChannelSchedule(req, res);
});

// POST /api/channels/:slug/schedule - Create/update schedule items
router.post("/:slug/schedule", authenticateToken, (req: AuthRequest, res: Response) => {
  updateChannelSchedule(req, res);
});

// POST /api/channels/:slug/contributions - pitch a film to this channel
router.post("/:slug/contributions", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  createContribution(req, res, next);
});

// GET /api/channels/:slug/contributions - owner sees all pitches; others see their own
router.get("/:slug/contributions", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  listChannelContributions(req, res, next);
});

// GET /api/channels/:slug/contributors - public credits (accepted pitches per user)
router.get("/:slug/contributors", (req: Request, res: Response, next: NextFunction) => {
  listChannelContributors(req, res, next);
});

// POST /api/channels/:slug/contributors - owner adds invitee / trusted contributor
router.post("/:slug/contributors", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  addChannelContributor(req, res, next);
});

// DELETE /api/channels/:slug/contributors/:userId - owner removes a contributor
router.delete("/:slug/contributors/:userId(\\d+)", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  removeChannelContributor(req, res, next);
});

// --- Media pipeline (Phase 3): owner uploads masters; conform to house format ---

// POST /api/channels/:slug/media - upload a master (multipart field "file"); conforms in background
router.post("/:slug/media", authenticateToken, mediaUpload.single("file"), (req: Request, res: Response, next: NextFunction) => {
  uploadMedia(req, res, next);
});

// GET /api/channels/:slug/media - owner's media catalogue (for the scheduler)
router.get("/:slug/media", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  listMedia(req, res, next);
});

// DELETE /api/channels/:slug/media/:id - owner removes a media item and its file
router.delete("/:slug/media/:id(\\d+)", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  deleteMedia(req, res, next);
});

// --- Scheduler (Phase 4): the ordered segment list that becomes the playlist ---

// GET /api/channels/:slug/segments - the ordered program list (owner)
router.get("/:slug/segments", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  listSegments(req, res, next);
});

// POST /api/channels/:slug/segments - append a segment from a media item
router.post("/:slug/segments", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  addSegment(req, res, next);
});

// POST /api/channels/:slug/segments/reorder - drag-and-drop write { ordered_ids }
router.post("/:slug/segments/reorder", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  reorderSegments(req, res, next);
});

// PATCH /api/channels/:slug/segments/:id - adjust trim/category
router.patch("/:slug/segments/:id(\\d+)", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  updateSegment(req, res, next);
});

// DELETE /api/channels/:slug/segments/:id - remove a segment
router.delete("/:slug/segments/:id(\\d+)", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  deleteSegment(req, res, next);
});

// GET /api/channels/:slug (get single channel by slug)
router.get("/:slug", (req: Request, res: Response, next: NextFunction) => {
  getChannel(req, res, next);
});

export default router;
