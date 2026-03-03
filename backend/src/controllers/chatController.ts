import { Request, Response } from "express";
import pool from "../db/pool";


export const getMessages = async (req: Request, res: Response) => {
  try {
    const { channelSlug, sessionId } = req.query as {
      channelSlug?: string;
      sessionId?: string;
    };


    let result;
    if (sessionId) {
      result = await pool.query(
        `SELECT m.id, m.content, m.created_at, u.username
FROM messages m
JOIN users u ON u.id = m.user_id
WHERE m.session_id = $1
ORDER BY m.created_at ASC`,
        [Number(sessionId)]
      );
    } else if (channelSlug) {
      result = await pool.query(
        `SELECT m.id, m.content, m.created_at, u.username
FROM messages m
JOIN users u ON u.id = m.user_id
WHERE m.channel_id = (SELECT id FROM channels WHERE slug = $1)
ORDER BY m.created_at ASC`,
        [channelSlug]
      );
    } else {
      result = await pool.query(
        `SELECT m.id, m.content, m.created_at, u.username
FROM messages m
JOIN users u ON u.id = m.user_id
ORDER BY m.created_at ASC`
      );
    }


    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ error: "Error fetching messages" });
  }
};
