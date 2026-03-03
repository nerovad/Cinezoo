"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/awardRoutes.ts
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../middleware/authMiddleware");
const profileController_1 = require("../controllers/profileController");
const router = express_1.default.Router();
// GET /api/awards/mine
router.get("/mine", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, profileController_1.getMyAwards)(req, res).catch(next);
});
exports.default = router;
