import express, { Response, NextFunction } from "express";
import { listUsers, updateUserGroup } from "../controllers/adminController";
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

export default router;
