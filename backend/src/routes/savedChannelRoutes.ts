import express, { Response, NextFunction } from "express";
import { authenticateToken, AuthRequest } from "../middleware/authMiddleware";
import pool from "../db/pool";

const router = express.Router();

const MAX_SAVED = 5;

// GET /api/saved-channels — list saved channels for the authenticated user
router.get("/", authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.slug, c.display_name, c.name
       FROM saved_channels sc
       JOIN channels c ON c.id = sc.channel_id
       WHERE sc.user_id = $1
       ORDER BY sc.created_at ASC`,
      [req.userId]
    );
    res.json(rows.map(r => ({ slug: r.slug, name: r.display_name || r.name || r.slug })));
  } catch (err) {
    next(err);
  }
});

// POST /api/saved-channels/:slug — save a channel
router.post("/:slug", authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Look up channel
    const ch = await pool.query("SELECT id FROM channels WHERE slug = $1", [req.params.slug]);
    if (ch.rows.length === 0) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    const channelId = ch.rows[0].id;

    // Check limit
    const countRes = await pool.query("SELECT count(*)::int AS cnt FROM saved_channels WHERE user_id = $1", [req.userId]);
    if (countRes.rows[0].cnt >= MAX_SAVED) {
      res.status(400).json({ error: `You can save up to ${MAX_SAVED} channels` });
      return;
    }

    await pool.query(
      "INSERT INTO saved_channels (user_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [req.userId, channelId]
    );
    res.status(201).json({ saved: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/saved-channels/:slug — unsave a channel
router.delete("/:slug", authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ch = await pool.query("SELECT id FROM channels WHERE slug = $1", [req.params.slug]);
    if (ch.rows.length === 0) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    await pool.query(
      "DELETE FROM saved_channels WHERE user_id = $1 AND channel_id = $2",
      [req.userId, ch.rows[0].id]
    );
    res.json({ saved: false });
  } catch (err) {
    next(err);
  }
});

export default router;
