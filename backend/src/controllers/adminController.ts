import { Response } from "express";
import pool from "../db/pool";
import { AuthRequest, UserGroup } from "../middleware/authMiddleware";

const VALID_GROUPS: UserGroup[] = ['super_admin', 'network', 'general_user'];

/* ==================== Channel Management ==================== */

export async function listAllChannels(req: AuthRequest, res: Response): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT c.id, c.slug, c.name, c.display_name, c.channel_number, c.stream_url,
              c.tags, c.created_at, c.owner_id,
              u.username as owner_name
       FROM channels c
       LEFT JOIN users u ON c.owner_id = u.id
       ORDER BY c.id`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List channels error:', error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function adminUpdateChannel(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { channelId } = req.params;
    const { name, display_name, channel_number } = req.body;

    const result = await pool.query(
      `UPDATE channels
       SET name = COALESCE($1, name),
           display_name = COALESCE($2, display_name),
           channel_number = COALESCE($3, channel_number)
       WHERE id = $4
       RETURNING id, slug, name, display_name, channel_number`,
      [name || null, display_name || null, channel_number ?? null, channelId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Admin update channel error:', error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function adminDeleteChannel(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { channelId } = req.params;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Check channel exists
      const ch = await client.query(`SELECT id FROM channels WHERE id = $1`, [channelId]);
      if (ch.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Channel not found" });
        return;
      }

      // Delete schedule items
      await client.query(`DELETE FROM channel_schedule WHERE channel_id = $1`, [channelId]);

      // Delete tournament matchups for sessions in this channel
      await client.query(
        `DELETE FROM tournament_matchups WHERE session_id IN (
           SELECT id FROM sessions WHERE channel_id = $1
         )`,
        [channelId]
      );

      // Delete session entries
      await client.query(
        `DELETE FROM session_entries WHERE session_id IN (
           SELECT id FROM sessions WHERE channel_id = $1
         )`,
        [channelId]
      );

      // Delete sessions
      await client.query(`DELETE FROM sessions WHERE channel_id = $1`, [channelId]);

      // Delete the channel
      await client.query(`DELETE FROM channels WHERE id = $1`, [channelId]);

      await client.query("COMMIT");
      res.json({ success: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Admin delete channel error:', error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT id, username, email, user_group, created_at FROM users ORDER BY id`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateUserGroup(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { userGroup } = req.body;

    if (!VALID_GROUPS.includes(userGroup)) {
      res.status(400).json({ error: `Invalid group. Must be one of: ${VALID_GROUPS.join(', ')}` });
      return;
    }

    // Prevent removing the last super_admin
    if (userGroup !== 'super_admin') {
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM users WHERE user_group = 'super_admin' AND id != $1`,
        [userId]
      );
      const targetResult = await pool.query(
        `SELECT user_group FROM users WHERE id = $1`,
        [userId]
      );
      if (targetResult.rows[0]?.user_group === 'super_admin' && parseInt(countResult.rows[0].count) === 0) {
        res.status(400).json({ error: "Cannot remove the last super_admin" });
        return;
      }
    }

    const result = await pool.query(
      `UPDATE users SET user_group = $1 WHERE id = $2 RETURNING id, username, email, user_group`,
      [userGroup, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update user group error:', error);
    res.status(500).json({ error: "Server error" });
  }
}
