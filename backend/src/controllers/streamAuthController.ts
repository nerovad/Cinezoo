import { Request, Response, NextFunction } from "express";
import pool from "../db/pool";

export const verifyStreamKey = async (
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> => {
  const streamKey = req.body?.name;

  if (!streamKey) {
    res.status(400).send("Missing stream key");
    return;
  }

  try {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM channels WHERE stream_key = $1 LIMIT 1`,
      [streamKey]
    );

    if (rowCount === 0) {
      res.status(403).send("Invalid stream key");
    } else {
      res.status(200).send("OK");
    }
  } catch (err) {
    console.error("Stream auth error:", err);
    res.status(500).send("Internal error");
  }
};
