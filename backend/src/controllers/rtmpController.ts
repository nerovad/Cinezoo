import { Request, Response } from "express";
import pool from "../db/pool";

/**
 * nginx-rtmp on_publish auth hook.
 * nginx sends application/x-www-form-urlencoded:
 *   name=<stream_key>&app=live
 */
export async function verifyStreamKey(req: Request, res: Response): Promise<void> {
  try {
    const key = String(req.body?.name ?? req.query?.name ?? "").trim();
    const app = String(req.body?.app ?? req.query?.app ?? "live").trim();

    if (!key) {
      res.status(403).send("missing key");
      return;
    }

    // Optional: ensure app matches what you expect
    if (app && app !== "live") {
      res.status(403).send("invalid app");
      return;
    }

    const { rows } = await pool.query(
      "SELECT 1 FROM channels WHERE stream_key = $1 LIMIT 1",
      [key]
    );

    if (rows.length === 0) {
      res.status(403).send("invalid key");
      return;
    }

    // IMPORTANT: nginx-rtmp expects a 2xx to allow publish
    res.status(200).send("OK");
  } catch (err) {
    console.error("verifyStreamKey error:", err);
    // non-2xx will reject the publish
    res.status(500).send("auth error");
  }
}
