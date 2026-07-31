// src/routes/tickerRoutes.ts
import express, { Response, NextFunction } from "express";
import {
  getTicker,
  listTickerMessages,
  createTickerMessage,
  updateTickerMessage,
  deleteTickerMessage,
} from "../controllers/tickerController";
import { authenticateToken, requireGroup, AuthRequest } from "../middleware/authMiddleware";

const router = express.Router();

// Guards are per-route rather than a blanket router.use, because GET / is
// public — the player fetches it with no token.
const adminOnly = [authenticateToken, requireGroup("super_admin")];

// GET /api/ticker - public. Live segments for the player.
router.get("/", (req: AuthRequest, res: Response, next: NextFunction): void => {
  getTicker(req, res, next);
});

// GET /api/ticker/all - admin. Every row, including inactive and expired.
router.get("/all", ...adminOnly, (req: AuthRequest, res: Response, next: NextFunction): void => {
  listTickerMessages(req, res, next);
});

// POST /api/ticker - admin. Create a segment.
router.post("/", ...adminOnly, (req: AuthRequest, res: Response, next: NextFunction): void => {
  createTickerMessage(req, res, next);
});

// PUT /api/ticker/:id - admin. Update a segment.
router.put("/:id(\\d+)", ...adminOnly, (req: AuthRequest, res: Response, next: NextFunction): void => {
  updateTickerMessage(req, res, next);
});

// DELETE /api/ticker/:id - admin. Remove a segment.
router.delete("/:id(\\d+)", ...adminOnly, (req: AuthRequest, res: Response, next: NextFunction): void => {
  deleteTickerMessage(req, res, next);
});

export default router;
