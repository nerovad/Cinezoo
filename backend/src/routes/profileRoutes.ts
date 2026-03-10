// src/routes/profileRoutes.ts
import express, { Request, Response, NextFunction } from "express";
import {
  getProfile,
  getPublicProfile,
  updateBio,
  updateAvatar,  // Add it here
  getMyFilms,
  getMyAwards,
  getMyCompanies
} from "../controllers/profileController";
import { authenticateToken, AuthRequest } from "../middleware/authMiddleware";

const router = express.Router();

// Public route - get any user's profile by handle (no auth required)
router.get("/user/:handle", (req: any, res: Response, next: NextFunction): void => {
  getPublicProfile(req, res).catch(next);
});

// All remaining profile routes require authentication
router.use(authenticateToken);

// GET /api/profile/me - Get current user's profile
router.get("/me", (req: AuthRequest, res: Response, next: NextFunction): void => {
  getProfile(req, res).catch(next);
});

// POST /api/profile/bio - Update bio
router.post("/bio", (req: AuthRequest, res: Response, next: NextFunction): void => {
  updateBio(req, res).catch(next);
});

// POST /api/profile/avatar - Update avatar
router.post("/avatar", (req: AuthRequest, res: Response, next: NextFunction): void => {
  updateAvatar(req, res).catch(next);
});

export default router;
