// src/controllers/tickerController.ts
// Ticker content: our own editorial lines plus at most one paid sponsor slot.
import { Request, Response, NextFunction } from "express";
import pool from "../db/pool";

/** Shape sent to the player. Deliberately narrow — no flight dates, no
 *  priority, nothing a viewer has no business seeing. */
type PublicSegment = {
  id: number;
  kind: "editorial" | "sponsor";
  body: string;
  sponsorName: string | null;
  linkUrl: string | null;
};

/** A row is live when it is switched on and now falls inside its flight window. */
const LIVE_PREDICATE = `
  active
  AND (starts_at IS NULL OR starts_at <= now())
  AND (ends_at   IS NULL OR ends_at   >  now())
`;

function toPublicSegment(row: any): PublicSegment {
  return {
    id: Number(row.id),
    kind: row.kind,
    body: row.body,
    sponsorName: row.sponsor_name ?? null,
    linkUrl: row.link_url ?? null,
  };
}

/**
 * GET /api/ticker — public. Every live segment in loop order, with the
 * one-sponsor-at-a-time rule applied here rather than in the schema.
 *
 * If two sponsor flights overlap (a booking mistake), the higher priority
 * wins and the loser is dropped rather than both running: an advertiser who
 * bought exclusivity must not silently end up sharing the strip.
 */
export const getTicker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, kind, body, sponsor_name, link_url
         FROM ticker_messages
        WHERE ${LIVE_PREDICATE}
        ORDER BY priority DESC, id ASC`
    );

    const segments: PublicSegment[] = [];
    let sponsorTaken = false;

    for (const row of rows) {
      if (row.kind === "sponsor") {
        if (sponsorTaken) continue;
        sponsorTaken = true;
      }
      segments.push(toPublicSegment(row));
    }

    // The strip is on screen for the whole session, so a viewer who opened a
    // channel hours ago should still pick up copy changes. Short cache, but
    // not none — this is hit on every page load.
    res.set("Cache-Control", "public, max-age=60");
    res.json({ segments });
  } catch (err) {
    next(err);
  }
};

/** GET /api/ticker/all — admin. Every row including inactive and expired. */
export const listTickerMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, kind, body, sponsor_name, link_url, priority, active,
              starts_at, ends_at, created_at, updated_at
         FROM ticker_messages
        ORDER BY priority DESC, id ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

type WriteBody = {
  kind?: string;
  body?: string;
  sponsorName?: string | null;
  linkUrl?: string | null;
  priority?: number;
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
};

/**
 * Validate and normalize a write. Returns an error string, or the cleaned
 * values ready to bind. The CHECK constraints in the schema are the real
 * backstop; this exists to return a usable message instead of a 500.
 */
function normalize(input: WriteBody): { error: string } | { values: Required<WriteBody> } {
  const kind = input.kind === "sponsor" ? "sponsor" : "editorial";
  const body = (input.body ?? "").trim();
  if (!body) return { error: "body is required" };

  const sponsorName = (input.sponsorName ?? "").trim() || null;
  if (kind === "sponsor" && !sponsorName) {
    return { error: "sponsorName is required for a sponsor segment" };
  }

  const linkUrl = (input.linkUrl ?? "").trim() || null;
  if (linkUrl && !/^https?:\/\//i.test(linkUrl)) {
    // Anything else (javascript:, data:) would become an XSS vector the
    // moment it is rendered into an href.
    return { error: "linkUrl must be an http(s) URL" };
  }

  const startsAt = input.startsAt || null;
  const endsAt = input.endsAt || null;
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    return { error: "endsAt must be after startsAt" };
  }

  return {
    values: {
      kind,
      body,
      sponsorName,
      linkUrl,
      priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0,
      active: input.active !== false,
      startsAt,
      endsAt,
    },
  };
}

/** POST /api/ticker — admin. Create a segment. */
export const createTickerMessage = async (req: Request, res: Response, next: NextFunction) => {
  const result = normalize(req.body ?? {});
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  const v = result.values;

  try {
    const { rows } = await pool.query(
      `INSERT INTO ticker_messages
         (kind, body, sponsor_name, link_url, priority, active, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [v.kind, v.body, v.sponsorName, v.linkUrl, v.priority, v.active, v.startsAt, v.endsAt]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
};

/** PUT /api/ticker/:id — admin. Full replace of a segment. */
export const updateTickerMessage = async (req: Request, res: Response, next: NextFunction) => {
  const id = Number(req.params.id);
  const result = normalize(req.body ?? {});
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  const v = result.values;

  try {
    const { rows } = await pool.query(
      `UPDATE ticker_messages
          SET kind = $1, body = $2, sponsor_name = $3, link_url = $4,
              priority = $5, active = $6, starts_at = $7, ends_at = $8,
              updated_at = now()
        WHERE id = $9
      RETURNING *`,
      [v.kind, v.body, v.sponsorName, v.linkUrl, v.priority, v.active, v.startsAt, v.endsAt, id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Ticker message not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/ticker/:id — admin. */
export const deleteTickerMessage = async (req: Request, res: Response, next: NextFunction) => {
  const id = Number(req.params.id);
  try {
    const { rowCount } = await pool.query(`DELETE FROM ticker_messages WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Ticker message not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
