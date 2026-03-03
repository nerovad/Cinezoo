"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/profileRoutes.ts
const express_1 = __importDefault(require("express"));
const profileController_1 = require("../controllers/profileController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// All profile routes require authentication
router.use(authMiddleware_1.authenticateToken);
// GET /api/profile/me - Get current user's profile
router.get("/me", (req, res, next) => {
    (0, profileController_1.getProfile)(req, res).catch(next);
});
// POST /api/profile/bio - Update bio
router.post("/bio", (req, res, next) => {
    (0, profileController_1.updateBio)(req, res).catch(next);
});
// POST /api/profile/avatar - Update avatar
router.post("/avatar", (req, res, next) => {
    (0, profileController_1.updateAvatar)(req, res).catch(next);
});
exports.default = router;
