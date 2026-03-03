import { Request, Response, NextFunction } from "express";
import pool from "../db/pool";

/** Create a session (festival) for a channel */
export async function createSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { channelSlug, title, starts_at, ends_at, status, timezone } = req.body as {
      channelSlug: string;
      title: string;
      starts_at?: string; // ISO
      ends_at?: string;   // ISO
      status?: string;    // scheduled | live | closed | archived
      timezone?: string;
    };

    if (!channelSlug || !title) {
      res.status(400).json({ error: "channelSlug and title are required" });
      return;
    }

    const ch = await pool.query(`SELECT id FROM channels WHERE slug = $1 LIMIT 1`, [channelSlug]);
    if (ch.rowCount === 0) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const channelId = ch.rows[0].id;
    const result = await pool.query(
      `INSERT INTO sessions (channel_id, title, starts_at, ends_at, status, timezone)
       VALUES ($1, $2, COALESCE($3, now()), $4, COALESCE($5, 'scheduled'), $6)
       RETURNING id, channel_id, title, starts_at, ends_at, status, timezone, created_at`,
      [channelId, title, starts_at ?? null, ends_at ?? null, status ?? null, timezone ?? null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

/** Start a session now (status → live) */
export async function startSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessionId = Number(req.params.sessionId);
    const { rows } = await pool.query(
      `UPDATE sessions
          SET status = 'live',
              starts_at = COALESCE(starts_at, now())
        WHERE id = $1
      RETURNING id, channel_id, title, starts_at, ends_at, status`,
      [sessionId]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

/** Close a session now (status → closed) */
export async function closeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessionId = Number(req.params.sessionId);
    const { rows } = await pool.query(
      `UPDATE sessions
          SET status = 'closed',
              ends_at = COALESCE(ends_at, now())
        WHERE id = $1
      RETURNING id, channel_id, title, starts_at, ends_at, status`,
      [sessionId]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

/** Add a film to the session lineup (creates film if needed) */
export async function addEntry(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessionId = Number(req.params.sessionId);
    const { filmId, filmTitle, order_index } = req.body as {
      filmId?: number;
      filmTitle?: string;
      order_index?: number;
    };

    if (!filmId && !filmTitle) {
      res.status(400).json({ error: "filmId or filmTitle is required" });
      return;
    }

    let idToUse = filmId ?? null;

    if (!idToUse) {
      // upsert film by title (simple)
      const f = await pool.query(
        `INSERT INTO films (title)
         VALUES ($1)
         ON CONFLICT (title) DO UPDATE SET title = EXCLUDED.title
         RETURNING id, title`,
        [filmTitle!.trim()]
      );
      idToUse = f.rows[0].id;
    }

    const ins = await pool.query(
      `INSERT INTO session_entries (session_id, film_id, order_index)
       VALUES ($1, $2, COALESCE($3, (
         SELECT COALESCE(MAX(order_index), 0) + 1 FROM session_entries WHERE session_id = $1
       )))
       RETURNING id, session_id, film_id, order_index`,
      [sessionId, idToUse, order_index ?? null]
    );

    res.status(201).json(ins.rows[0]);
  } catch (err) {
    next(err);
  }
}

/** Get the lineup for a session */
export async function getLineup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessionId = Number(req.params.sessionId);
    const { rows } = await pool.query(
      `SELECT se.id AS entry_id,
              se.order_index,
              f.id  AS film_id,
              f.title
         FROM session_entries se
         JOIN films f ON f.id = se.film_id
        WHERE se.session_id = $1
        ORDER BY se.order_index ASC, se.id ASC`,
      [sessionId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}
