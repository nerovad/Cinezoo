"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const adminController_1 = require("../controllers/adminController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// All admin routes require authentication + super_admin group
router.use(authMiddleware_1.authenticateToken);
router.use((0, authMiddleware_1.requireGroup)('super_admin'));
// GET /api/admin/users - List all users with their groups
router.get("/users", (req, res, next) => {
    (0, adminController_1.listUsers)(req, res).catch(next);
});
// PUT /api/admin/users/:userId/group - Update a user's group
router.put("/users/:userId/group", (req, res, next) => {
    (0, adminController_1.updateUserGroup)(req, res).catch(next);
});
// DELETE /api/admin/users/:userId - Delete a user
router.delete("/users/:userId", (req, res, next) => {
    (0, adminController_1.deleteUser)(req, res).catch(next);
});
// GET /api/admin/channels - List all channels
router.get("/channels", (req, res, next) => {
    (0, adminController_1.listAllChannels)(req, res).catch(next);
});
// PUT /api/admin/channels/:channelId - Update a channel
router.put("/channels/:channelId", (req, res, next) => {
    (0, adminController_1.adminUpdateChannel)(req, res).catch(next);
});
// GET /api/admin/channels/:channelId/analytics - Get analytics for any channel
router.get("/channels/:channelId/analytics", (req, res, next) => {
    (0, adminController_1.adminGetChannelAnalytics)(req, res).catch(next);
});
// DELETE /api/admin/channels/:channelId - Delete a channel
router.delete("/channels/:channelId", (req, res, next) => {
    (0, adminController_1.adminDeleteChannel)(req, res).catch(next);
});
exports.default = router;
