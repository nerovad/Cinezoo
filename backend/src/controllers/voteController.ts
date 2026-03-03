import { Request, Response } from "express";
import pool from "../db/pool";
import crypto from "crypto";


export const rateEntry = async (req: Request, res: Response) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const entryId = Number(req.params.entryId);
    const { score } = req.body;


    const userId = (req as any).user?.id || 1; // replace with real auth later


    const ballot = await pool.query(
      `INSERT INTO ballots (session_id, user_id, weight)
VALUES ($1, $2, 1.0)
ON CONFLICT (session_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
RETURNING id`,
      [sessionId, userId]
    );


    await pool.query(
      `INSERT INTO ratings (session_id, entry_id, ballot_id, score)
VALUES ($1, $2, $3, $4)
ON CONFLICT (session_id, entry_id, ballot_id)
DO UPDATE SET score = EXCLUDED.score, created_at = now()`,
      [sessionId, entryId, ballot.rows[0].id, score]
    );


    res.json({ ok: true });
  } catch (err) {
    console.error("Error rating:", err);
    res.status(500).json({ error: "Error saving rating" });
  }
};


export const getLeaderboard = async (req: Request, res: Response) => {
  try {
    const sessionId = Number(req.params.sessionId);


    const { rows } = await pool.query(
      `SELECT
se.id AS entry_id,
f.title,
ROUND(SUM(r.score * COALESCE(b.weight,1)) / NULLIF(SUM(COALESCE(b.weight,1)),0), 3) AS weighted_avg,
COUNT(*) AS votes
FROM ratings r
JOIN ballots b ON (b.session_id = r.session_id AND b.id = r.ballot_id)
JOIN session_entries se ON se.id = r.entry_id
JOIN films f ON f.id = se.film_id
WHERE r.session_id = $1
GROUP BY se.id, f.title
ORDER BY weighted_avg DESC, votes DESC`,
      [sessionId]
    );


    res.json(rows);
  } catch (err) {
    console.error("Error leaderboard:", err);
    res.status(500).json({ error: "Error fetching leaderboard" });
  }
};
// --- helper to resolve channel -> session -> entry ---
async function resolveSessionAndEntryId(channelKey: string, filmId: number): Promise<{ sessionId: number, entryId: number } | null> {
  const client = await pool.connect();
  try {
    // 1) channel by slug | name | stream_key
    const ch = await client.query(
      `SELECT id FROM channels WHERE slug=$1 OR name=$1 OR stream_key=$1 LIMIT 1`,
      [channelKey]
    );
    if (!ch.rowCount) return null;
    const channelId: number = ch.rows[0].id;

    // 2) pick active session, else latest
    const nowIso = new Date().toISOString();
    const active = await client.query(
      `SELECT id FROM sessions
        WHERE channel_id=$1
          AND starts_at <= $2
          AND (ends_at IS NULL OR ends_at >= $2)
        ORDER BY starts_at DESC
        LIMIT 1`,
      [channelId, nowIso]
    );
    let sessionId: number | null = active.rowCount ? active.rows[0].id : null;

    if (!sessionId) {
      const latest = await client.query(
        `SELECT id FROM sessions WHERE channel_id=$1 ORDER BY starts_at DESC LIMIT 1`,
        [channelId]
      );
      sessionId = latest.rowCount ? latest.rows[0].id : null;
    }
    if (!sessionId) return null;

    // 3) entry in that session for the given film
    const entry = await client.query(
      `SELECT id FROM session_entries WHERE session_id=$1 AND film_id=$2 LIMIT 1`,
      [sessionId, filmId]
    );
    if (!entry.rowCount) return null;

    return { sessionId, entryId: entry.rows[0].id as number };
  } finally {
    client.release();
  }
}

/**
 * Adapter for frontend: POST /api/ratings
 * Body: { channel: string, film_id: number|string, score: number }
 * Reuses the same ballots/ratings logic as rateEntry.
 */
export const createRatingFromChannelFilm = async (req: Request, res: Response) => {
  try {
    const { channel, film_id, score } = req.body as {
      channel: string;
      film_id: number | string;
      score: number;
    };

    if (!channel || !film_id || typeof score !== "number" || score < 1 || score > 10) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }

    const resolved = await resolveSessionAndEntryId(channel, Number(film_id));
    if (!resolved) {
      res.status(400).json({ error: "session_or_entry_not_found" });
      return;
    }

    const { sessionId, entryId } = resolved;

    // Use your existing user (or anonymous fallback)
    const userId = (req as any).user?.id || 1; // replace with real auth later

    // Optional fingerprint (nice to have if you want to de-dupe later)
    const ua = req.get("user-agent") || "";
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
    const fingerprint = crypto.createHash("sha256").update(`${ip}|${ua}|${userId}`).digest("hex");

    // Create/Upsert ballot (your original logic)
    const ballot = await pool.query(
      `INSERT INTO ballots (session_id, user_id, fingerprint_sha256, weight)
       VALUES ($1, $2, $3, 1.0)
       ON CONFLICT (session_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING id`,
      [sessionId, userId, fingerprint]
    );

    await pool.query(
      `INSERT INTO ratings (session_id, entry_id, ballot_id, score)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id, entry_id, ballot_id)
       DO UPDATE SET score = EXCLUDED.score, created_at = now()`,
      [sessionId, entryId, ballot.rows[0].id, score]
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("Error rating (adapter):", err);
    res.status(500).json({ error: "Error saving rating" });
  }
};
