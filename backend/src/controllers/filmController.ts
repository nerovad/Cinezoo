// src/controllers/filmController.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import pool from "../db/pool";

/* ========================= Helpers ========================= */

function authUserIdOr401(req: Request, res: Response): number | null {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Access Denied" }); return null; }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: number };
    return decoded.id;
  } catch {
    res.status(401).json({ error: "Invalid Token" });
    return null;
  }
}

function toSeconds(s?: string | null): number | null {
  if (!s) return null;
  const parts = s.split(":").map((n) => Number(n));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function fmtDuration(sec?: number | null): string | null {
  if (sec == null || Number.isNaN(sec)) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Resolve a channel id by numeric id, or by slug/name/stream_key */
async function findChannelId(key: string): Promise<number | null> {
  if (/^\d+$/.test(key)) {
    const r = await pool.query(`select id from channels where id = $1 limit 1`, [Number(key)]);
    return r.rowCount ? r.rows[0].id : null;
  }
  const { rows } = await pool.query(
    `select id from channels
      where slug = $1 or name = $1 or stream_key = $1
      limit 1`,
    [key]
  );
  return rows.length ? rows[0].id : null;
}

/* ========================= Endpoints ========================= */

/**
 * POST /api/films
 * Body: { title: string, duration?: "MM:SS" | "HH:MM:SS" }
 * Notes:
 * - Uses your existing global unique-on-title upsert pattern.
 * - Also sets creator_user_id when possible and updates runtime_seconds if provided.
 */
export async function createFilm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const uid = authUserIdOr401(req, res);
    if (!uid) return;

    const { title, duration } = (req.body ?? {}) as { title?: string; duration?: string };
    if (!title?.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const runtimeSeconds = toSeconds(duration);

    const { rows } = await pool.query(
      `
      insert into films (title, creator_user_id, runtime_seconds, created_at)
      values ($1, $2, $3, now())
      on conflict (title) do update set
        creator_user_id = coalesce(films.creator_user_id, excluded.creator_user_id),
        runtime_seconds = coalesce(excluded.runtime_seconds, films.runtime_seconds)
      returning id, title, creator_user_id, runtime_seconds, created_at
      `,
      [title.trim(), uid, runtimeSeconds]
    );

    res.status(201).json({
      id: rows[0].id,
      title: rows[0].title,
      duration: fmtDuration(rows[0].runtime_seconds),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/films
 * Returns a simple recent list (unchanged behavior).
 */
export async function listFilms(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query(
      `select id, title, runtime_seconds from films order by id desc limit 500`
    );
    res.json(rows.map((r) => ({
      id: r.id,
      title: r.title,
      duration: fmtDuration(r.runtime_seconds),
    })));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/films/mine
 * Films created by the logged-in user (for the Profile "Films" tab).
 * Shape matches your Profile card expectations: id, title, duration, thumbnail?, synopsis?
 * (We return null for fields you don’t store yet.)
 */
export async function getMyFilms(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = authUserIdOr401(req, res);
    if (!uid) return;

    const { rows } = await pool.query(
      `
      select id, title, runtime_seconds
        from films
       where creator_user_id = $1
       order by created_at desc
      `,
      [uid]
    );

    res.json(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        duration: fmtDuration(r.runtime_seconds),
        thumbnail: null, // you don't have thumbnail columns (safe for UI)
        synopsis: null,  // you don't have synopsis columns (safe for UI)
      }))
    );
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/channels/:channelId/films
 * Returns lineup for the channel’s active session, or latest session if none active.
 * Output is an array ordered by session_entries.order_index.
 */
export async function listFilmsForChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect();
  try {
    const channelKey = String(req.params.channelId || req.params.slug);
    console.log("🔍 Looking for channel:", channelKey);

    const cid = await findChannelId(channelKey);
    if (!cid) {
      console.log("❌ Channel not found for key:", channelKey); // Add this too
      res.json([]);
      return;
    }

    console.log("✅ Found channel ID:", cid);

    const nowIso = new Date().toISOString();

    // Prefer active session
    const active = await client.query(
      `select id
         from sessions
        where channel_id = $1
          and starts_at <= $2
          and (ends_at is null or ends_at >= $2)
        order by starts_at desc
        limit 1`,
      [cid, nowIso]
    );

    let sessionId: number | null = active.rowCount ? active.rows[0].id : null;

    // Fallback to latest session
    if (!sessionId) {
      const latest = await client.query(
        `select id
           from sessions
          where channel_id = $1
          order by starts_at desc
          limit 1`,
        [cid]
      );
      sessionId = latest.rowCount ? latest.rows[0].id : null;
    }

    if (!sessionId) { res.json([]); return; }

    const rows = await client.query(
      `select f.id, f.title, f.runtime_seconds, se.order_index
         from session_entries se
         join films f on f.id = se.film_id
        where se.session_id = $1
        order by se.order_index asc, f.id asc`,
      [sessionId]
    );

    res.json(
      rows.rows.map((r) => ({
        id: String(r.id),
        title: r.title,
        duration: fmtDuration(r.runtime_seconds),
        // front-end tolerates missing fields
        thumbnail: null,
        synopsis: null,
        order: r.order_index,
      }))
    );
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}
