import { Request, Response } from "express";
import pool from "../db/pool";

/**
 * As-run reporting endpoint.
 *
 * The Cinezoo-hosted ffplayout runs a fire-and-forget task script on every clip
 * start (see docs/ffplayout-adapter.md section 6). That script POSTs here the
 * same JSON `GET /api/control/{id}/media/current` returns:
 *
 *   { "index": 3, "ingest": false, "mode": "playlist", "elapsed": 12.3,
 *     "media": { "in": 0.0, "out": 252.0, "duration": 252.0,
 *                "category": "", "source": "sketches/cold-open.mp4",
 *                "title": "Cold Open" } }
 *
 * We record it as ground truth for "Now Playing". Machine-to-machine, so auth is
 * the channel's stream_key via X-Stream-Key (same secret nginx-rtmp validates),
 * not a user JWT.
 *
 * The caller discards the response, so we stay lenient: record what we can,
 * answer 204, and never make the playout engine's task script care about us.
 */
export async function recordAsRun(req: Request, res: Response): Promise<void> {
  const streamKey = String(req.header("x-stream-key") ?? "").trim();
  if (!streamKey) {
    res.status(401).send("missing stream key");
    return;
  }

  const body = req.body ?? {};
  const media = body.media ?? {};
  const source = typeof media.source === "string" ? media.source : "";
  if (!source) {
    res.status(400).send("missing media.source");
    return;
  }

  try {
    const chan = await pool.query(
      "SELECT id FROM channels WHERE stream_key = $1 LIMIT 1",
      [streamKey]
    );
    if (chan.rowCount === 0) {
      res.status(403).send("invalid stream key");
      return;
    }
    const channelId = chan.rows[0].id;

    // Playing time is out - in (NOT `duration`, which is the full asset length).
    const inSec = Number(media.in) || 0;
    const outSec = Number(media.out) || 0;
    const durationMs =
      outSec > inSec ? Math.round((outSec - inSec) * 1000) : null;

    const isIngest = body.ingest === true;
    const title = typeof media.title === "string" ? media.title : null;

    // Best-effort attribution back to a scheduled segment. Returns null until
    // the scheduler (Phase 4) populates channel_media / channel_segments; the FK
    // is nullable, so recording an unmatched airing is fine.
    const seg = await pool.query(
      `SELECT s.id
         FROM channel_segments s
         JOIN channel_media m ON m.id = s.media_id
        WHERE s.channel_id = $1 AND m.storage_path = $2
        ORDER BY s.position
        LIMIT 1`,
      [channelId, source]
    );
    const segmentId = seg.rowCount ? seg.rows[0].id : null;

    await pool.query(
      `INSERT INTO channel_asrun
         (channel_id, segment_id, source, title, started_at, duration_ms, is_ingest, raw)
       VALUES ($1, $2, $3, $4, now(), $5, $6, $7)`,
      [channelId, segmentId, source, title, durationMs, isIngest, body]
    );

    res.status(204).end();
  } catch (err) {
    console.error("recordAsRun error:", err);
    res.status(500).send("as-run error");
  }
}
