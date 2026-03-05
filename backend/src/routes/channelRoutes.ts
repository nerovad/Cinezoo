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
} from "../controllers/channelController";
import { listFilmsForChannel } from "../controllers/filmController";
import { authenticateToken, requireGroup, AuthRequest } from "../middleware/authMiddleware";

const router = express.Router();

// GET /api/channels/mine - MUST be before /:slug to avoid conflicts
router.get("/mine", authenticateToken, (req: AuthRequest, res: Response, next: NextFunction): void => {
  getMyChannels(req, res).catch(next);
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

// GET /api/channels/:slug (get single channel by slug)
router.get("/:slug", (req: Request, res: Response, next: NextFunction) => {
  getChannel(req, res, next);
});

export default router;
