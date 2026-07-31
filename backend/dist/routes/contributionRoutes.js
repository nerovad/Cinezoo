"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/contributionRoutes.ts
const express_1 = __importDefault(require("express"));
const contributionController_1 = require("../controllers/contributionController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// GET /api/contributions/mine - the logged-in user's pitches across channels
router.get("/mine", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, contributionController_1.getMyContributions)(req, res, next);
});
// POST /api/contributions/:id/review - owner accepts or declines a pitch
router.post("/:id(\\d+)/review", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, contributionController_1.reviewContribution)(req, res, next);
});
// POST /api/contributions/:id/withdraw - contributor pulls a pending pitch
router.post("/:id(\\d+)/withdraw", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, contributionController_1.withdrawContribution)(req, res, next);
});
exports.default = router;
