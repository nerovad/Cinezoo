"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const directMessageController_1 = require("../controllers/directMessageController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// All direct message routes require authentication
router.use(authMiddleware_1.authenticateToken);
// GET /api/messages/conversations - Get all conversations
router.get("/conversations", (req, res, next) => {
    (0, directMessageController_1.getConversations)(req, res).catch(next);
});
// GET /api/messages/users/search - Search users to message
router.get("/users/search", (req, res, next) => {
    (0, directMessageController_1.searchUsers)(req, res).catch(next);
});
// POST /api/messages/send - Send a new message
router.post("/send", (req, res, next) => {
    (0, directMessageController_1.sendMessage)(req, res).catch(next);
});
// GET /api/messages/:userId - Get messages with a specific user
router.get("/:userId", (req, res, next) => {
    (0, directMessageController_1.getMessages)(req, res).catch(next);
});
// POST /api/messages/:userId/read - Mark messages from user as read
router.post("/:userId/read", (req, res, next) => {
    (0, directMessageController_1.markAsRead)(req, res).catch(next);
});
exports.default = router;
