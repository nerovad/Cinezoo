import { Response } from "express";
import pool from "../db/pool";
import { AuthRequest, UserGroup } from "../middleware/authMiddleware";

const VALID_GROUPS: UserGroup[] = ['super_admin', 'network', 'general_user'];

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
