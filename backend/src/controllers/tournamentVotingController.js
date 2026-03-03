"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.endVoting = exports.startVoting = exports.getTournamentStatus = void 0;
const pool_1 = __importDefault(require("../../db/pool"));
// Get tournament status (for Tournament Console)
const getTournamentStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { sessionId } = req.params;
    const userId = req.userId; // ✅ Use req.userId from your auth middleware
    if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const sessionIdNum = Number(sessionId);
    if (Number.isNaN(sessionIdNum)) {
        res.status(400).json({ error: 'Invalid session id' });
        return;
    }
    try {
        // Get session and check if it's a tournament
        const sessionQuery = yield pool_1.default.query(`SELECT s.*, c.owner_id 
       FROM sessions s 
       JOIN channels c ON s.channel_id::text = c.id::text 
       WHERE s.id::text = $1 AND LOWER(s.event_type) = 'tournament'`, [sessionId]);
        if (sessionQuery.rows.length === 0) {
            res.status(404).json({ error: 'Tournament session not found' });
            return;
        }
        const session = sessionQuery.rows[0];
        // Verify ownership
        if (session.owner_id !== userId) {
            res.status(403).json({ error: 'You do not own this tournament' });
            return;
        }
        // Get all matchups grouped by round
        const matchupsQuery = yield pool_1.default.query(`SELECT 
        tm.*,
        f1.title as film1_title,
        f2.title as film2_title
      FROM tournament_matchups tm
      LEFT JOIN films f1 ON tm.film1_id::bigint = f1.id
      LEFT JOIN films f2 ON tm.film2_id::bigint = f2.id
      WHERE tm.session_id = $1
      ORDER BY tm.round_number, tm.position`, [sessionIdNum] // number, not string
        );
        const matchups = matchupsQuery.rows;
        // Group matchups by round
        const rounds = {};
        let maxRound = 0;
        let currentRound = 1;
        matchups.forEach(matchup => {
            if (!rounds[matchup.round_number]) {
                rounds[matchup.round_number] = [];
            }
            rounds[matchup.round_number].push({
                id: matchup.id,
                matchupId: matchup.matchup_id,
                round: matchup.round_number,
                position: matchup.position,
                film1Title: matchup.film1_title,
                film2Title: matchup.film2_title,
                votes1: matchup.film1_votes || 0,
                votes2: matchup.film2_votes || 0,
                winnerId: matchup.winner_id,
                completed: matchup.completed_at !== null
            });
            maxRound = Math.max(maxRound, matchup.round_number);
            // Find current round (first incomplete round)
            if (!matchup.winner_id && matchup.round_number >= currentRound) {
                currentRound = matchup.round_number;
            }
        });
        // Check if tournament is complete
        const isComplete = matchups.every(m => m.winner_id !== null);
        // Get voting window status
        const votingWindow = session.voting_window || { isActive: false, currentRound: null };
        res.json({
            currentRound,
            totalRounds: maxRound,
            isComplete,
            votingWindow,
            rounds
        });
    }
    catch (error) {
        console.error('Error getting tournament status:', error);
        res.status(500).json({ error: 'Failed to get tournament status' });
    }
});
exports.getTournamentStatus = getTournamentStatus;
// Start voting for a round
const startVoting = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { sessionId } = req.params;
    const { round } = req.body;
    const userId = req.userId; // ✅ Use req.userId
    if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    if (!round || typeof round !== 'number') {
        res.status(400).json({ error: 'Round number is required' });
        return;
    }
    try {
        // Get session and verify ownership
        const sessionQuery = yield pool_1.default.query(`SELECT s.*, c.owner_id 
       FROM sessions s 
       JOIN channels c ON s.channel_id::text = c.id::text 
       WHERE s.id::text = $1 AND LOWER(s.event_type) = 'tournament'`, [sessionId]);
        if (sessionQuery.rows.length === 0) {
            res.status(404).json({ error: 'Tournament session not found' });
            return;
        }
        const session = sessionQuery.rows[0];
        if (session.owner_id !== userId) {
            res.status(403).json({ error: 'You do not own this tournament' });
            return;
        }
        // Check if voting is already active
        const votingWindow = session.voting_window || { isActive: false, currentRound: null };
        if (votingWindow.isActive) {
            res.status(400).json({
                error: `Voting is already active for Round ${votingWindow.currentRound}`
            });
            return;
        }
        // Verify that the round exists and has incomplete matchups
        const roundMatchups = yield pool_1.default.query(`SELECT COUNT(*) as total, COUNT(winner_id) as completed
       FROM tournament_matchups
       WHERE session_id::text = $1 AND round_number = $2`, [sessionId, round]);
        const roundData = roundMatchups.rows[0];
        if (parseInt(roundData.total) === 0) {
            res.status(400).json({ error: `Round ${round} does not exist` });
            return;
        }
        if (parseInt(roundData.completed) === parseInt(roundData.total)) {
            res.status(400).json({ error: `Round ${round} is already complete` });
            return;
        }
        // Start voting window
        const newVotingWindow = { isActive: true, currentRound: round };
        yield pool_1.default.query(`UPDATE sessions 
       SET voting_window = $1, updated_at = NOW()
       WHERE id = $2`, [JSON.stringify(newVotingWindow), sessionId]);
        res.json({
            message: `Voting started for Round ${round}`,
            votingWindow: newVotingWindow
        });
    }
    catch (error) {
        console.error('Error starting voting:', error);
        res.status(500).json({ error: 'Failed to start voting' });
    }
});
exports.startVoting = startVoting;
// End voting and advance winners
const endVoting = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { sessionId } = req.params;
    const userId = req.userId; // ✅ Use req.userId
    if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    try {
        // Get session and verify ownership
        const sessionQuery = yield pool_1.default.query(`SELECT s.*, c.owner_id 
       FROM sessions s 
       JOIN channels c ON s.channel_id::text = c.id::text 
       WHERE s.id::text = $1 AND LOWER(s.event_type) = 'tournament'`, [sessionId]);
        if (sessionQuery.rows.length === 0) {
            res.status(404).json({ error: 'Tournament session not found' });
            return;
        }
        const session = sessionQuery.rows[0];
        if (session.owner_id !== userId) {
            res.status(403).json({ error: 'You do not own this tournament' });
            return;
        }
        // Check if voting is active
        const votingWindow = session.voting_window || { isActive: false, currentRound: null };
        if (!votingWindow.isActive) {
            res.status(400).json({ error: 'No active voting window' });
            return;
        }
        const currentRound = votingWindow.currentRound;
        // Get tournament bracket to check total rounds
        const bracket = session.tournament_bracket;
        const totalRounds = ((_a = bracket === null || bracket === void 0 ? void 0 : bracket.rounds) === null || _a === void 0 ? void 0 : _a.length) || 0;
        console.log(`🎯 Ending voting for Round ${currentRound} of ${totalRounds}`);
        // Get all matchups in current round
        const matchupsQuery = yield pool_1.default.query(`SELECT * FROM tournament_matchups
       WHERE session_id::text = $1 AND round_number = $2 AND winner_id IS NULL`, [sessionId, currentRound]);
        let winnersAdvanced = 0;
        // Determine winners and advance them
        for (const matchup of matchupsQuery.rows) {
            let winnerId = null;
            // Determine winner (film with most votes)
            if (matchup.film1_votes > matchup.film2_votes) {
                winnerId = matchup.film1_id;
            }
            else if (matchup.film2_votes > matchup.film1_votes) {
                winnerId = matchup.film2_id;
            }
            else if (matchup.film1_votes === matchup.film2_votes) {
                // In case of tie, randomly pick (or you could use seed)
                winnerId = Math.random() < 0.5 ? matchup.film1_id : matchup.film2_id;
                console.log(`⚖️  Tie in matchup ${matchup.matchup_id}, randomly selected winner: ${winnerId}`);
            }
            if (winnerId) {
                // Update matchup with winner
                yield pool_1.default.query(`UPDATE tournament_matchups
           SET winner_id = $1, completed_at = NOW()
           WHERE id = $2`, [winnerId, matchup.id]);
                console.log(`✅ Winner for matchup ${matchup.matchup_id}: ${winnerId}`);
                winnersAdvanced++;
                // Check if this is the final round
                if (currentRound === totalRounds) {
                    console.log(`🏆 This is the FINAL ROUND! Champion: ${winnerId}`);
                    continue; // Don't advance to next round - tournament is complete
                }
                // Advance winner to next round
                const nextRound = currentRound + 1;
                const nextPosition = Math.floor(matchup.position / 2);
                const nextMatchupId = `r${nextRound}-m${nextPosition + 1}`;
                // Determine if winner goes to film1 or film2 slot
                const isFilm1Slot = matchup.position % 2 === 0;
                const filmSlot = isFilm1Slot ? 'film1_id' : 'film2_id';
                console.log(`➡️  Advancing ${winnerId} to Round ${nextRound}, Position ${nextPosition} (${filmSlot})`);
                // Check if next round matchup exists
                const nextMatchupQuery = yield pool_1.default.query(`SELECT * FROM tournament_matchups
           WHERE session_id::text = $1 AND round_number = $2 AND position = $3`, [sessionId, nextRound, nextPosition]);
                if (nextMatchupQuery.rows.length > 0) {
                    // Update existing matchup
                    const nextMatchup = nextMatchupQuery.rows[0];
                    console.log(`📝 Updating existing matchup ${nextMatchup.id}`);
                    yield pool_1.default.query(`UPDATE tournament_matchups
             SET ${filmSlot} = $1, updated_at = NOW()
             WHERE id = $2`, [winnerId, nextMatchup.id]);
                }
                else {
                    // ✅ CREATE next round matchup if it doesn't exist
                    console.log(`🆕 Creating new matchup for Round ${nextRound}, Position ${nextPosition}`);
                    yield pool_1.default.query(`INSERT INTO tournament_matchups 
             (session_id, matchup_id, round_number, position, ${filmSlot}, film1_votes, film2_votes)
             VALUES ($1, $2, $3, $4, $5, 0, 0)`, [sessionId, nextMatchupId, nextRound, nextPosition, winnerId]);
                }
            }
        }
        // Close voting window
        const closedVotingWindow = { isActive: false, currentRound: null };
        yield pool_1.default.query(`UPDATE sessions 
       SET voting_window = $1, updated_at = NOW()
       WHERE id = $2`, [JSON.stringify(closedVotingWindow), sessionId]);
        // ✅ Update current_round if not final round
        if (currentRound < totalRounds) {
            yield pool_1.default.query(`UPDATE sessions 
         SET current_round = $1
         WHERE id = $2`, [currentRound + 1, sessionId]);
            console.log(`📈 Advanced tournament to Round ${currentRound + 1}`);
        }
        console.log(`✅ Voting ended. ${winnersAdvanced} winners advanced.`);
        res.json({
            message: 'Voting ended and winners advanced',
            winnersAdvanced,
            round: currentRound,
            isFinalRound: currentRound === totalRounds
        });
    }
    catch (error) {
        console.error('Error ending voting:', error);
        res.status(500).json({ error: 'Failed to end voting' });
    }
});
exports.endVoting = endVoting;
