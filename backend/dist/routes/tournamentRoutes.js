"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../middleware/authMiddleware");
// Import from existing tournament controller
const tournamentController_1 = require("../controllers/tournamentController");
// Import from new tournament voting controller
const tournamentVotingController_1 = require("../controllers/tournamentVotingController");
const router = (0, express_1.Router)();
// ============================================
// PUBLIC ROUTES - Tournament Viewing
// ============================================
// Get tournament bracket for a channel (public)
router.get("/channels/:channelId/tournament", tournamentController_1.getTournament);
// ============================================
// AUTHENTICATED ROUTES
// ============================================
// Vote on a matchup (requires auth, checks voting window)
router.post("/tournaments/matchups/:matchupId/vote", authMiddleware_1.authenticateToken, tournamentController_1.voteOnMatchup);
// Get tournament status for console dashboard (requires auth)
router.get("/tournaments/:sessionId/status", authMiddleware_1.authenticateToken, tournamentVotingController_1.getTournamentStatus);
// Start voting window for a round (requires auth)
router.post("/tournaments/:sessionId/voting/start", authMiddleware_1.authenticateToken, tournamentVotingController_1.startVoting);
// End voting window and advance winners (requires auth)
router.post("/tournaments/:sessionId/voting/end", authMiddleware_1.authenticateToken, tournamentVotingController_1.endVoting);
// Manually advance winner to next round (requires auth)
router.post("/tournaments/matchups/:matchupId/advance", authMiddleware_1.authenticateToken, tournamentController_1.advanceWinner);
// Manually advance entire round (requires auth)
router.post("/tournaments/rounds/:sessionId/:roundNumber/advance-all", authMiddleware_1.authenticateToken, tournamentController_1.advanceAllInRound);
// Delete Vote
router.delete('/tournaments/matchups/:matchupId/vote', authMiddleware_1.authenticateToken, tournamentController_1.removeVote);
exports.default = router;
