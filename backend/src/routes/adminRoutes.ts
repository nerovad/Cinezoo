import express, { Response, NextFunction } from "express";
import { listUsers, updateUserGroup, listAllChannels, adminUpdateChannel, adminDeleteChannel } from "../controllers/adminController";
import { authenticateToken, requireGroup, AuthRequest } from "../middleware/authMiddleware";

const router = express.Router();

// All admin routes require authentication + super_admin group
router.use(authenticateToken);
router.use(requireGroup('super_admin'));

// GET /api/admin/users - List all users with their groups
router.get("/users", (req: AuthRequest, res: Response, next: NextFunction): void => {
  listUsers(req, res).catch(next);
});

// PUT /api/admin/users/:userId/group - Update a user's group
router.put("/users/:userId/group", (req: AuthRequest, res: Response, next: NextFunction): void => {
  updateUserGroup(req, res).catch(next);
});

// GET /api/admin/channels - List all channels
router.get("/channels", (req: AuthRequest, res: Response, next: NextFunction): void => {
  listAllChannels(req, res).catch(next);
});

// PUT /api/admin/channels/:channelId - Update a channel
router.put("/channels/:channelId", (req: AuthRequest, res: Response, next: NextFunction): void => {
  adminUpdateChannel(req, res).catch(next);
});

// DELETE /api/admin/channels/:channelId - Delete a channel
router.delete("/channels/:channelId", (req: AuthRequest, res: Response, next: NextFunction): void => {
  adminDeleteChannel(req, res).catch(next);
});

export default router;
