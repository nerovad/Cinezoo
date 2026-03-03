// tournamentController.ts
import { Request, Response } from "express";
import pool from "../db/pool";
import { AuthRequest } from "../middleware/authMiddleware";

/**
 * GET /api/channels/:channelId/tournament
 * Fetches tournament bracket data with current vote counts
 * UPDATED: Now includes voting_window information
 */
export async function getTournament(req: Request, res: Response): Promise<void> {
  try {
    const { channelId } = req.params;

    // Get channel with active session and tournament bracket
    const channelResult = await pool.query(
      `SELECT 
        c.id as channel_id,
        c.name as channel_name,
        c.slug,
        s.id as session_id, 
        s.tournament_bracket, 
        s.starts_at, 
        s.ends_at,
        s.event_type,
        s.voting_window
       FROM channels c
       LEFT JOIN sessions s ON s.channel_id = c.id AND s.is_active = true
       WHERE c.id::text = $1 OR c.slug = $1`,
      [channelId]
    );

    if (channelResult.rows.length === 0) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const channel = channelResult.rows[0];

    if (!channel.tournament_bracket) {
      res.status(404).json({ error: "No tournament found for this channel" });
      return;
    }

    if (channel.event_type !== "tournament") {
      res.status(400).json({ error: "This channel is not a tournament" });
      return;
    }

    // Parse the bracket structure
    const bracket = channel.tournament_bracket;

    // Get all matchup data from database with current vote counts
    const matchupsResult = await pool.query(
      `SELECT 
        tm.*,
        COUNT(DISTINCT tv.id) as total_votes
       FROM tournament_matchups tm
       LEFT JOIN tournament_votes tv ON tv.matchup_id = tm.id
       WHERE tm.session_id = $1 
       GROUP BY tm.id
       ORDER BY tm.round_number, tm.position`,
      [channel.session_id]
    );

    // ✅ Get all film details for films in this tournament
    const filmIds = new Set<string>();
    matchupsResult.rows.forEach(m => {
      if (m.film1_id) filmIds.add(m.film1_id);
      if (m.film2_id) filmIds.add(m.film2_id);
    });

    const filmsResult = await pool.query(
      `SELECT id, title, creator_user_id, runtime_seconds 
       FROM films 
       WHERE id = ANY($1::int[])`,
      [Array.from(filmIds).map(id => parseInt(id))]
    );

    const filmsMap = new Map();
    filmsResult.rows.forEach(f => {
      filmsMap.set(String(f.id), f);
    });

    console.log('📚 Loaded film details:', Array.from(filmsMap.keys()));

    // Determine tournament status
    const now = new Date();
    const startsAt = new Date(channel.starts_at);
    const endsAt = new Date(channel.ends_at);

    let status: "upcoming" | "active" | "completed";
    if (now < startsAt) {
      status = "upcoming";
    } else if (now > endsAt) {
      status = "completed";
    } else {
      status = "active";
    }

    // Find current round (first round with incomplete matchups during active period)
    let currentRound = 1;
    if (status === "active") {
      for (const matchup of matchupsResult.rows) {
        if (!matchup.winner_id) {
          currentRound = matchup.round_number;
          break;
        }
      }
    } else if (status === "completed") {
      currentRound = bracket.rounds.length;
    }

    // Merge database matchup data with bracket structure
    const updatedRounds = bracket.rounds.map((round: any) => ({
      roundNumber: round.roundNumber,
      roundName: getRoundName(round.roundNumber, bracket.rounds.length),
      matchups: round.matchups.map((matchup: any) => {
        // Find corresponding database record
        const dbMatchup = matchupsResult.rows.find(
          (m) => m.matchup_id === matchup.id
        );

        // ✅ CRITICAL FIX: Build film objects from database data
        let film1 = null;
        let film2 = null;

        if (dbMatchup?.film1_id) {
          const film1Data = filmsMap.get(dbMatchup.film1_id);
          if (film1Data) {
            film1 = {
              filmId: dbMatchup.film1_id,
              seed: matchup.film1?.seed || 0,
              title: film1Data.title,
              creator: matchup.film1?.creator,
              thumbnail: matchup.film1?.thumbnail
            };
          }
        }

        if (dbMatchup?.film2_id) {
          const film2Data = filmsMap.get(dbMatchup.film2_id);
          if (film2Data) {
            film2 = {
              filmId: dbMatchup.film2_id,
              seed: matchup.film2?.seed || 0,
              title: film2Data.title,
              creator: matchup.film2?.creator,
              thumbnail: matchup.film2?.thumbnail
            };
          }
        }

        // Debug logging
        if (dbMatchup && round.roundNumber > 1) {
          console.log(`Round ${round.roundNumber} Matchup ${matchup.id}:`, {
            film1_id: dbMatchup.film1_id,
            film1_title: film1?.title,
            film2_id: dbMatchup.film2_id,
            film2_title: film2?.title
          });
        }

        return {
          id: matchup.id,
          position: matchup.position,
          roundNumber: round.roundNumber,
          film1,
          film2,
          votes1: dbMatchup?.film1_votes || 0,
          votes2: dbMatchup?.film2_votes || 0,
          winner: dbMatchup?.winner_id || undefined,
          dbMatchupId: dbMatchup?.id, // Include DB ID for voting endpoint
        };
      }),
    }));

    // Include voting window in response
    const votingWindow = channel.voting_window || { isActive: false, currentRound: null };

    res.json({
      id: channel.session_id,
      channelName: channel.channel_name,
      status,
      currentRound,
      rounds: updatedRounds,
      startsAt: channel.starts_at,
      endsAt: channel.ends_at,
      votingWindow, // NEW: Include voting window status
    });
  } catch (error) {
    console.error("Error fetching tournament:", error);
    res.status(500).json({ error: "Failed to fetch tournament data" });
  }
}

/**
 * POST /api/tournaments/matchups/:matchupId/vote
 * Records a vote for a film in a matchup
 * UPDATED: Now supports vote switching - if user already voted, changes their vote
 */
export async function voteOnMatchup(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { matchupId } = req.params;
    const { film_id } = req.body;
    const userId = req.userId;

    if (!film_id) {
      res.status(400).json({ error: "Film ID is required" });
      return;
    }

    // Get matchup details including voting_window from session
    const matchupResult = await pool.query(
      `SELECT tm.*, s.require_login, s.voting_window
       FROM tournament_matchups tm
       JOIN sessions s ON s.id = tm.session_id
       WHERE tm.id = $1`,
      [matchupId]
    );

    if (matchupResult.rows.length === 0) {
      res.status(404).json({ error: "Matchup not found" });
      return;
    }

    const matchup = matchupResult.rows[0];

    // Check if voting window is active
    const votingWindow = matchup.voting_window || { isActive: false, currentRound: null };

    if (!votingWindow.isActive) {
      res.status(400).json({ error: "Voting is not currently active" });
      return;
    }

    // Check if voting is for the correct round
    if (votingWindow.currentRound !== matchup.round_number) {
      res.status(400).json({
        error: `Voting is active for Round ${votingWindow.currentRound}, not Round ${matchup.round_number}`
      });
      return;
    }

    const filmIdStr = String(film_id);

    // Verify film is in this matchup
    if (filmIdStr !== matchup.film1_id && filmIdStr !== matchup.film2_id) {
      console.error('Film validation failed:', {
        received: film_id,
        filmIdStr,
        film1_id: matchup.film1_id,
        film2_id: matchup.film2_id
      });
      res.status(400).json({ error: "Invalid film for this matchup" });
      return;
    }

    // Check if matchup is already completed
    if (matchup.winner_id) {
      res.status(400).json({ error: "This matchup has already been decided" });
      return;
    }

    // Check authentication if required
    if (matchup.require_login && !userId) {
      res.status(401).json({ error: "Login required to vote" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ✅ NEW: Check if user already voted
      let existingVote = null;
      if (userId) {
        const existingVoteResult = await client.query(
          `SELECT id, film_id FROM tournament_votes 
           WHERE matchup_id = $1 AND user_id = $2`,
          [matchupId, userId]
        );
        existingVote = existingVoteResult.rows[0];
      }

      if (existingVote) {
        // ✅ NEW: User is switching their vote
        const oldFilmId = existingVote.film_id;

        // Only proceed if they're voting for a different film
        if (oldFilmId !== filmIdStr) {
          // Decrement old film's vote count
          const oldVoteColumn = oldFilmId === matchup.film1_id ? 'film1_votes' : 'film2_votes';
          await client.query(
            `UPDATE tournament_matchups 
             SET ${oldVoteColumn} = GREATEST(0, ${oldVoteColumn} - 1),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [matchupId]
          );

          // Update the vote record
          await client.query(
            `UPDATE tournament_votes 
            SET film_id = $1
            WHERE id = $2`,
            [filmIdStr, existingVote.id]
          );

          // Increment new film's vote count
          const newVoteColumn = filmIdStr === matchup.film1_id ? 'film1_votes' : 'film2_votes';
          await client.query(
            `UPDATE tournament_matchups 
             SET ${newVoteColumn} = ${newVoteColumn} + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [matchupId]
          );

          console.log(`✅ Vote switched from ${oldFilmId} to ${filmIdStr}`);
        }
      } else {
        // New vote
        if (userId) {
          await client.query(
            `INSERT INTO tournament_votes (matchup_id, user_id, film_id)
             VALUES ($1, $2, $3)`,
            [matchupId, userId, filmIdStr]
          );
        }

        // Increment vote count
        const voteColumn = filmIdStr === matchup.film1_id ? 'film1_votes' : 'film2_votes';
        await client.query(
          `UPDATE tournament_matchups 
           SET ${voteColumn} = ${voteColumn} + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [matchupId]
        );

        console.log(`✅ New vote recorded for ${filmIdStr}`);
      }

      await client.query('COMMIT');

      const updatedMatchup = await pool.query(
        `SELECT * FROM tournament_matchups WHERE id = $1`,
        [matchupId]
      );

      res.json({
        success: true,
        message: existingVote ? "Vote changed successfully" : "Vote recorded successfully",
        matchup: {
          id: updatedMatchup.rows[0].id,
          film1Votes: updatedMatchup.rows[0].film1_votes,
          film2Votes: updatedMatchup.rows[0].film2_votes,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error recording vote:", error);
    res.status(500).json({ error: "Failed to record vote" });
  }
}

/**
 * DELETE /api/tournaments/matchups/:matchupId/vote
 * Removes a user's vote from a matchup
 * ✅ NEW FUNCTION - Add route: router.delete('/tournaments/matchups/:matchupId/vote', authenticateToken, removeVote);
 */
export async function removeVote(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { matchupId } = req.params;
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Get matchup details including voting_window from session
    const matchupResult = await pool.query(
      `SELECT tm.*, s.voting_window
       FROM tournament_matchups tm
       JOIN sessions s ON s.id = tm.session_id
       WHERE tm.id = $1`,
      [matchupId]
    );

    if (matchupResult.rows.length === 0) {
      res.status(404).json({ error: "Matchup not found" });
      return;
    }

    const matchup = matchupResult.rows[0];

    // Check if voting window is active
    const votingWindow = matchup.voting_window || { isActive: false, currentRound: null };

    if (!votingWindow.isActive) {
      res.status(400).json({ error: "Voting is not currently active" });
      return;
    }

    // Check if voting is for the correct round
    if (votingWindow.currentRound !== matchup.round_number) {
      res.status(400).json({
        error: `Voting is active for Round ${votingWindow.currentRound}, not Round ${matchup.round_number}`
      });
      return;
    }

    // Check if matchup is already completed
    if (matchup.winner_id) {
      res.status(400).json({ error: "This matchup has already been decided" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get the user's existing vote
      const voteResult = await client.query(
        `SELECT film_id FROM tournament_votes 
         WHERE matchup_id = $1 AND user_id = $2`,
        [matchupId, userId]
      );

      if (voteResult.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: "You haven't voted on this matchup" });
        return;
      }

      const filmId = voteResult.rows[0].film_id;

      // Delete the vote record
      await client.query(
        `DELETE FROM tournament_votes 
         WHERE matchup_id = $1 AND user_id = $2`,
        [matchupId, userId]
      );

      // Decrement the vote count
      const voteColumn = filmId === matchup.film1_id ? 'film1_votes' : 'film2_votes';
      await client.query(
        `UPDATE tournament_matchups 
         SET ${voteColumn} = GREATEST(0, ${voteColumn} - 1),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [matchupId]
      );

      await client.query('COMMIT');

      const updatedMatchup = await pool.query(
        `SELECT * FROM tournament_matchups WHERE id = $1`,
        [matchupId]
      );

      console.log(`✅ Vote removed for film ${filmId}`);

      res.json({
        success: true,
        message: "Vote removed successfully",
        matchup: {
          id: updatedMatchup.rows[0].id,
          film1Votes: updatedMatchup.rows[0].film1_votes,
          film2Votes: updatedMatchup.rows[0].film2_votes,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error removing vote:", error);
    res.status(500).json({ error: "Failed to remove vote" });
  }
}

/**
 * POST /api/tournaments/matchups/:matchupId/advance
 * Advances the winner of a matchup to the next round
 */
export async function advanceWinner(req: Request, res: Response): Promise<void> {
  try {
    const { matchupId } = req.params;
    const { forceWinnerId } = req.body;

    const matchupResult = await pool.query(
      `SELECT tm.*, s.tournament_bracket
       FROM tournament_matchups tm
       JOIN sessions s ON s.id = tm.session_id
       WHERE tm.id = $1`,
      [matchupId]
    );

    if (matchupResult.rows.length === 0) {
      res.status(404).json({ error: "Matchup not found" });
      return;
    }

    const matchup = matchupResult.rows[0];

    let winnerId: string;
    if (forceWinnerId) {
      if (forceWinnerId !== matchup.film1_id && forceWinnerId !== matchup.film2_id) {
        res.status(400).json({ error: "Invalid winner ID" });
        return;
      }
      winnerId = forceWinnerId;
    } else {
      if (matchup.film1_votes === matchup.film2_votes) {
        res.status(400).json({ error: "Cannot advance: votes are tied" });
        return;
      }
      winnerId = matchup.film1_votes > matchup.film2_votes
        ? matchup.film1_id
        : matchup.film2_id;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE tournament_matchups 
         SET winner_id = $1, 
             completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [winnerId, matchupId]
      );

      const bracket = JSON.parse(matchup.tournament_bracket);
      const totalRounds = bracket.rounds.length;

      if (matchup.round_number === totalRounds) {
        await client.query('COMMIT');
        res.json({
          success: true,
          message: "Tournament completed!",
          champion: winnerId,
        });
        return;
      }

      const nextRound = matchup.round_number + 1;
      const nextPosition = Math.floor(matchup.position / 2);
      const nextMatchupId = `r${nextRound}-m${nextPosition + 1}`;

      const nextMatchupResult = await client.query(
        `SELECT id FROM tournament_matchups 
         WHERE session_id = $1 AND round_number = $2 AND position = $3`,
        [matchup.session_id, nextRound, nextPosition]
      );

      const isFilm1Slot = matchup.position % 2 === 0;
      const filmSlot = isFilm1Slot ? 'film1_id' : 'film2_id';

      if (nextMatchupResult.rows.length === 0) {
        await client.query(
          `INSERT INTO tournament_matchups 
           (session_id, matchup_id, round_number, position, ${filmSlot})
           VALUES ($1, $2, $3, $4, $5)`,
          [matchup.session_id, nextMatchupId, nextRound, nextPosition, winnerId]
        );
      } else {
        await client.query(
          `UPDATE tournament_matchups 
           SET ${filmSlot} = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [winnerId, nextMatchupResult.rows[0].id]
        );
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: "Winner advanced to next round",
        winnerId,
        nextRound,
        nextPosition,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error advancing winner:", error);
    res.status(500).json({ error: "Failed to advance winner" });
  }
}

/**
 * POST /api/tournaments/rounds/:sessionId/:roundNumber/advance-all
 */
export async function advanceAllInRound(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId, roundNumber } = req.params;

    const matchupsResult = await pool.query(
      `SELECT * FROM tournament_matchups 
       WHERE session_id = $1 AND round_number = $2
       ORDER BY position`,
      [sessionId, parseInt(roundNumber)]
    );

    if (matchupsResult.rows.length === 0) {
      res.status(404).json({ error: "No matchups found for this round" });
      return;
    }

    const results = [];

    for (const matchup of matchupsResult.rows) {
      try {
        if (matchup.winner_id) {
          results.push({ matchupId: matchup.id, status: "already_advanced" });
          continue;
        }

        if (matchup.film1_votes === matchup.film2_votes) {
          results.push({ matchupId: matchup.id, status: "tie" });
          continue;
        }

        const winnerId = matchup.film1_votes > matchup.film2_votes
          ? matchup.film1_id
          : matchup.film2_id;

        await pool.query(
          `UPDATE tournament_matchups 
           SET winner_id = $1, completed_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [winnerId, matchup.id]
        );

        const nextRound = matchup.round_number + 1;
        const nextPosition = Math.floor(matchup.position / 2);
        const isFilm1Slot = matchup.position % 2 === 0;
        const filmSlot = isFilm1Slot ? 'film1_id' : 'film2_id';
        const nextMatchupId = `r${nextRound}-m${nextPosition + 1}`;

        const existing = await pool.query(
          `SELECT id FROM tournament_matchups 
           WHERE session_id = $1 AND round_number = $2 AND position = $3`,
          [sessionId, nextRound, nextPosition]
        );

        if (existing.rows.length === 0) {
          await pool.query(
            `INSERT INTO tournament_matchups 
             (session_id, matchup_id, round_number, position, ${filmSlot})
             VALUES ($1, $2, $3, $4, $5)`,
            [sessionId, nextMatchupId, nextRound, nextPosition, winnerId]
          );
        } else {
          await pool.query(
            `UPDATE tournament_matchups 
             SET ${filmSlot} = $1
             WHERE id = $2`,
            [winnerId, existing.rows[0].id]
          );
        }

        results.push({ matchupId: matchup.id, status: "advanced", winnerId });
      } catch (error: any) {
        results.push({ matchupId: matchup.id, status: "error", error: error.message });
      }
    }

    res.json({
      success: true,
      message: "Round advancement complete",
      results,
    });
  } catch (error) {
    console.error("Error advancing round:", error);
    res.status(500).json({ error: "Failed to advance round" });
  }
}

function getRoundName(roundNumber: number, totalRounds: number): string {
  const roundsFromEnd = totalRounds - roundNumber;
  if (roundsFromEnd === 0) return "Finals";
  if (roundsFromEnd === 1) return "Semi-Finals";
  if (roundsFromEnd === 2) return "Quarter-Finals";
  if (roundsFromEnd === 3) return "Round of 16";
  return `Round ${roundNumber}`;
}
