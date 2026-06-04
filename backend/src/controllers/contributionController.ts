// src/controllers/contributionController.ts
// Open Source TV: viewers pitch films to a channel ("pull requests"), the
// channel owner accepts or declines. Accepted pitches with a proposed slot
// are materialized into channel_schedule with an attribution pointer.
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import pool from "../db/pool";
import { PoolClient } from "pg";

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

// Spam pressure: a user may only have this many open pitches per channel.
const MAX_PENDING_PER_USER_PER_CHANNEL = 3;

type ProposedSlot = {
  scheduled_at: string;
  duration_seconds?: number;
  recurrence_type?: string;
  recurrence_days?: number[];
  recurrence_end_date?: string;
  air_time?: string;
};

async function findChannelBySlug(client: PoolClient, slug: string) {
  const { rows } = await client.query(
    `SELECT id, owner_id, contribution_policy FROM channels WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  return rows[0] ?? null;
}

/**
 * Insert an accepted contribution's proposed slot into channel_schedule,
 * keeping a contribution_id pointer back for attribution.
 * Same upsert semantics as the owner's schedule editor.
 */
async function materializeContribution(
  client: PoolClient,
  contribution: { id: number; channel_id: number; film_id: number; proposed_slot: ProposedSlot | null }
): Promise<number | null> {
  const slot = contribution.proposed_slot;
  if (!slot?.scheduled_at) return null; // no slot pitched - owner schedules it manually

  const filmResult = await client.query(`SELECT title FROM films WHERE id = $1`, [contribution.film_id]);
  const title = filmResult.rows[0]?.title ?? null;

  const inserted = await client.query(
    `INSERT INTO channel_schedule
       (channel_id, film_id, title, scheduled_at, duration_seconds, status, recurrence_type, recurrence_days, recurrence_end_date, air_time, contribution_id)
     VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $7, $8, $9, $10)
     ON CONFLICT (channel_id, scheduled_at)
     DO UPDATE SET
       film_id = EXCLUDED.film_id,
       title = EXCLUDED.title,
       duration_seconds = EXCLUDED.duration_seconds,
       recurrence_type = EXCLUDED.recurrence_type,
       recurrence_days = EXCLUDED.recurrence_days,
       recurrence_end_date = EXCLUDED.recurrence_end_date,
       air_time = EXCLUDED.air_time,
       contribution_id = EXCLUDED.contribution_id
     RETURNING id`,
    [
      contribution.channel_id,
      contribution.film_id,
      title,
      slot.scheduled_at,
      slot.duration_seconds ?? null,
      slot.recurrence_type ?? "once",
      slot.recurrence_days ?? null,
      slot.recurrence_end_date ?? null,
      slot.air_time ?? null,
      contribution.id,
    ]
  );
  return inserted.rows[0]?.id ?? null;
}

/* ========================= Endpoints ========================= */

/**
 * POST /api/channels/:slug/contributions
 * Body: { film_id, proposed_slot?, pitch_text?, rights_confirmed }
 * Policy: 'open' = anyone, 'invite' = listed contributors, 'closed' = nobody.
 * Trusted contributors (and the owner) are auto-accepted.
 */
export async function createContribution(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;

  const { film_id, proposed_slot, pitch_text, rights_confirmed } = req.body as {
    film_id?: number;
    proposed_slot?: ProposedSlot;
    pitch_text?: string;
    rights_confirmed?: boolean;
  };

  if (!film_id) {
    res.status(400).json({ error: "film_id is required" });
    return;
  }
  // The "CLA": contributor must assert they hold rights to the film and
  // grant the channel permission to broadcast it.
  if (rights_confirmed !== true) {
    res.status(400).json({ error: "You must confirm you hold the rights to this film and grant the channel permission to air it." });
    return;
  }
  if (proposed_slot && !proposed_slot.scheduled_at) {
    res.status(400).json({ error: "proposed_slot requires scheduled_at" });
    return;
  }

  const client = await pool.connect();
  let begun = false;

  try {
    const channel = await findChannelBySlug(client, String(req.params.slug));
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const film = await client.query(`SELECT id FROM films WHERE id = $1 LIMIT 1`, [film_id]);
    if (!film.rowCount) {
      res.status(404).json({ error: "Film not found" });
      return;
    }

    const isOwner = channel.owner_id === uid;
    const membership = await client.query(
      `SELECT role FROM channel_contributors WHERE channel_id = $1 AND user_id = $2 LIMIT 1`,
      [channel.id, uid]
    );
    const role: string | null = membership.rows[0]?.role ?? null;

    if (!isOwner) {
      if (channel.contribution_policy === "closed") {
        res.status(403).json({ error: "This channel is not accepting contributions." });
        return;
      }
      if (channel.contribution_policy === "invite" && !role) {
        res.status(403).json({ error: "This channel accepts contributions by invite only." });
        return;
      }

      const pending = await client.query(
        `SELECT COUNT(*)::int AS n FROM channel_contributions
         WHERE channel_id = $1 AND contributor_id = $2 AND status = 'pending'`,
        [channel.id, uid]
      );
      if (pending.rows[0].n >= MAX_PENDING_PER_USER_PER_CHANNEL) {
        res.status(429).json({ error: `You already have ${MAX_PENDING_PER_USER_PER_CHANNEL} pending pitches on this channel. Wait for a review before pitching more.` });
        return;
      }
    }

    // Owner and trusted contributors skip review ("commit access").
    const autoAccept = isOwner || role === "trusted";

    await client.query("BEGIN");
    begun = true;

    const ins = await client.query(
      `INSERT INTO channel_contributions
         (channel_id, contributor_id, film_id, proposed_slot, pitch_text, rights_confirmed, status, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7)
       RETURNING *`,
      [
        channel.id,
        uid,
        film_id,
        proposed_slot ? JSON.stringify(proposed_slot) : null,
        pitch_text?.trim() || null,
        autoAccept ? "accepted" : "pending",
        autoAccept ? new Date().toISOString() : null,
      ]
    );
    const contribution = ins.rows[0];

    let scheduleItemId: number | null = null;
    if (autoAccept) {
      scheduleItemId = await materializeContribution(client, contribution);
    }

    await client.query("COMMIT");
    begun = false;

    res.status(201).json({
      ...contribution,
      auto_accepted: autoAccept,
      schedule_item_id: scheduleItemId,
    });
  } catch (err) {
    try { if (begun) await client.query("ROLLBACK"); } catch { }
    next(err);
  } finally {
    client.release();
  }
}

/**
 * GET /api/channels/:slug/contributions?status=pending
 * Owner sees every pitch; everyone else sees only their own.
 */
export async function listChannelContributions(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;

  const client = await pool.connect();
  try {
    const channel = await findChannelBySlug(client, String(req.params.slug));
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const isOwner = channel.owner_id === uid;
    const status = typeof req.query.status === "string" ? req.query.status : null;

    const params: any[] = [channel.id];
    let where = `cc.channel_id = $1`;
    if (!isOwner) {
      params.push(uid);
      where += ` AND cc.contributor_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      where += ` AND cc.status = $${params.length}`;
    }

    const { rows } = await client.query(
      `SELECT cc.*,
              u.username AS contributor_name,
              f.title AS film_title,
              f.runtime_seconds AS film_runtime_seconds
       FROM channel_contributions cc
       JOIN users u ON u.id = cc.contributor_id
       JOIN films f ON f.id = cc.film_id
       WHERE ${where}
       ORDER BY (cc.status = 'pending') DESC, cc.created_at DESC`,
      params
    );

    // Owners also get the invite/trusted roster for managing access
    let roster: any[] | undefined;
    if (isOwner) {
      const r = await client.query(
        `SELECT cm.user_id, cm.role, cm.created_at, u.username
         FROM channel_contributors cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.channel_id = $1
         ORDER BY cm.created_at ASC`,
        [channel.id]
      );
      roster = r.rows;
    }

    res.json({ is_owner: isOwner, contributions: rows, roster });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

/**
 * POST /api/contributions/:id/review  (owner only)
 * Body: { action: 'accept' | 'decline', review_note? }
 * A note is optional either way - declining never requires a reason.
 */
export async function reviewContribution(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;

  const { action, review_note } = req.body as { action?: string; review_note?: string };
  if (action !== "accept" && action !== "decline") {
    res.status(400).json({ error: "action must be 'accept' or 'decline'" });
    return;
  }

  const client = await pool.connect();
  let begun = false;

  try {
    await client.query("BEGIN");
    begun = true;

    const found = await client.query(
      `SELECT cc.*, c.owner_id
       FROM channel_contributions cc
       JOIN channels c ON c.id = cc.channel_id
       WHERE cc.id = $1
       FOR UPDATE OF cc`,
      [req.params.id]
    );
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      begun = false;
      res.status(404).json({ error: "Contribution not found" });
      return;
    }

    const contribution = found.rows[0];
    if (contribution.owner_id !== uid) {
      await client.query("ROLLBACK");
      begun = false;
      res.status(403).json({ error: "Only the channel owner can review contributions" });
      return;
    }
    if (contribution.status !== "pending") {
      await client.query("ROLLBACK");
      begun = false;
      res.status(409).json({ error: `Contribution is already ${contribution.status}` });
      return;
    }

    const newStatus = action === "accept" ? "accepted" : "declined";
    const upd = await client.query(
      `UPDATE channel_contributions
       SET status = $2, review_note = $3, reviewed_at = now()
       WHERE id = $1
       RETURNING *`,
      [contribution.id, newStatus, review_note?.trim() || null]
    );

    let scheduleItemId: number | null = null;
    if (newStatus === "accepted") {
      scheduleItemId = await materializeContribution(client, contribution);
    }

    await client.query("COMMIT");
    begun = false;

    res.json({ ...upd.rows[0], schedule_item_id: scheduleItemId });
  } catch (err) {
    try { if (begun) await client.query("ROLLBACK"); } catch { }
    next(err);
  } finally {
    client.release();
  }
}

/**
 * POST /api/contributions/:id/withdraw  (contributor only, while pending)
 */
export async function withdrawContribution(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;

  try {
    const { rows, rowCount } = await pool.query(
      `UPDATE channel_contributions
       SET status = 'withdrawn', reviewed_at = now()
       WHERE id = $1 AND contributor_id = $2 AND status = 'pending'
       RETURNING *`,
      [req.params.id, uid]
    );
    if (!rowCount) {
      res.status(404).json({ error: "No pending contribution of yours with that id" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/contributions/mine
 * The logged-in user's pitches across all channels (for profile / status tracking).
 */
export async function getMyContributions(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;

  try {
    const { rows } = await pool.query(
      `SELECT cc.*,
              c.slug AS channel_slug,
              COALESCE(c.display_name, c.name) AS channel_name,
              f.title AS film_title
       FROM channel_contributions cc
       JOIN channels c ON c.id = cc.channel_id
       JOIN films f ON f.id = cc.film_id
       WHERE cc.contributor_id = $1
       ORDER BY cc.created_at DESC`,
      [uid]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/channels/:slug/contributors  (public)
 * Attribution: everyone whose pitches have aired on this channel, with counts.
 * This is the channel's "contributors graph".
 */
export async function listChannelContributors(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect();
  try {
    const channel = await findChannelBySlug(client, String(req.params.slug));
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const { rows } = await client.query(
      `SELECT u.id, u.username,
              COUNT(*)::int AS accepted_count,
              MAX(cc.reviewed_at) AS last_accepted_at
       FROM channel_contributions cc
       JOIN users u ON u.id = cc.contributor_id
       WHERE cc.channel_id = $1 AND cc.status = 'accepted'
       GROUP BY u.id, u.username
       ORDER BY accepted_count DESC, last_accepted_at DESC`,
      [channel.id]
    );

    res.json({ contribution_policy: channel.contribution_policy, contributors: rows });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

/**
 * POST /api/channels/:slug/contributors  (owner only)
 * Body: { username, role? } - add someone to the invite list, or grant 'trusted'.
 */
export async function addChannelContributor(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;

  const { username, role } = req.body as { username?: string; role?: string };
  if (!username?.trim()) {
    res.status(400).json({ error: "username is required" });
    return;
  }
  const contributorRole = role === "trusted" ? "trusted" : "contributor";

  const client = await pool.connect();
  try {
    const channel = await findChannelBySlug(client, String(req.params.slug));
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    if (channel.owner_id !== uid) {
      res.status(403).json({ error: "Only the channel owner can manage contributors" });
      return;
    }

    const user = await client.query(`SELECT id, username FROM users WHERE username = $1 LIMIT 1`, [username.trim()]);
    if (!user.rowCount) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { rows } = await client.query(
      `INSERT INTO channel_contributors (channel_id, user_id, role, invited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (channel_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING *`,
      [channel.id, user.rows[0].id, contributorRole, uid]
    );

    res.status(201).json({ ...rows[0], username: user.rows[0].username });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/channels/:slug/contributors/:userId  (owner only)
 */
export async function removeChannelContributor(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;

  const client = await pool.connect();
  try {
    const channel = await findChannelBySlug(client, String(req.params.slug));
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    if (channel.owner_id !== uid) {
      res.status(403).json({ error: "Only the channel owner can manage contributors" });
      return;
    }

    await client.query(
      `DELETE FROM channel_contributors WHERE channel_id = $1 AND user_id = $2`,
      [channel.id, req.params.userId]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}
