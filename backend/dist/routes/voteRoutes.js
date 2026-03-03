"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const voteController_1 = require("../controllers/voteController");
const router = express_1.default.Router();
// New: what your Menu.tsx expects
router.post("/ratings", voteController_1.createRatingFromChannelFilm);
// Existing session-scoped endpoints
router.post("/sessions/:sessionId/entries/:entryId/rate", voteController_1.rateEntry);
router.get("/sessions/:sessionId/leaderboard", voteController_1.getLeaderboard);
exports.default = router;
