// src/routes/contributionRoutes.ts
import express, { Request, Response, NextFunction } from "express";
import {
  reviewContribution,
  withdrawContribution,
  getMyContributions,
} from "../controllers/contributionController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = express.Router();

// GET /api/contributions/mine - the logged-in user's pitches across channels
router.get("/mine", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  getMyContributions(req, res, next);
});

// POST /api/contributions/:id/review - owner accepts or declines a pitch
router.post("/:id(\\d+)/review", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  reviewContribution(req, res, next);
});

// POST /api/contributions/:id/withdraw - contributor pulls a pending pitch
router.post("/:id(\\d+)/withdraw", authenticateToken, (req: Request, res: Response, next: NextFunction) => {
  withdrawContribution(req, res, next);
});

export default router;
