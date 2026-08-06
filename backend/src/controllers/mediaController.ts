/// <reference path="../types/multer.d.ts" />
// The multer shim is an ambient .d.ts. tsc picks it up via tsconfig "include",
// but ts-node/ts-node-dev compile only the entry file's import graph and ignore
// "include" — so without this reference the shim is invisible in dev and the
// server dies on an implicit-any for "multer" while `npm run build` succeeds.
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import fs from "fs";
import multer from "multer";
import pool from "../db/pool";
import { rawPath, ensureDir, channelRoot } from "../services/mediaStorage";
import { conformMedia } from "../services/conform";

/* Auth helper — matches channelController/profileController style. */
function authUserIdOr401(req: Request, res: Response): number | null {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Access Denied" });
    return null;
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: number };
    return decoded.id;
  } catch {
    res.status(401).json({ error: "Invalid Token" });
    return null;
  }
}

/* Resolve a channel by slug and confirm the caller owns it. */
async function ownedChannelOr403(
  slug: string,
  uid: number,
  res: Response
): Promise<{ id: number } | null> {
  const { rows } = await pool.query(
    "SELECT id, owner_id FROM channels WHERE slug = $1 LIMIT 1",
    [slug]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Channel not found" });
    return null;
  }
  if (rows[0].owner_id !== uid) {
    res.status(403).json({ error: "Only the channel owner can manage media" });
    return null;
  }
  return { id: rows[0].id };
}

/**
 * multer instance for master uploads. Streams straight to a temp dir on disk
 * (no memory buffering — masters are large). We move it to the per-channel raw
 * dir inside the handler, once we know the channel is valid and owned.
 */
export const mediaUpload = multer({
  dest: undefined, // set per-request via storage below
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const tmp = require("path").join(require("os").tmpdir(), "cinezoo-uploads");
      ensureDir(tmp);
      cb(null, tmp);
    },
    filename: (_req, _file, cb) => cb(null, `up_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB ceiling for a master
});

/**
 * POST /api/channels/:slug/media   (multipart: field "file", plus "title")
 * Accepts a master upload, records a pending channel_media row, and kicks off
 * the background conform. Returns immediately with the pending row so the UI
 * can show "processing".
 */
export async function uploadMedia(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;

  const file = (req as any).file as { path: string; originalname: string } | undefined;
  const cleanupTmp = () => { if (file?.path) fs.promises.unlink(file.path).catch(() => {}); };

  if (!file) {
    res.status(400).json({ error: "No file uploaded (expected multipart field 'file')" });
    return;
  }

  try {
    const channel = await ownedChannelOr403(req.params.slug, uid, res);
    if (!channel) { cleanupTmp(); return; }

    const title = String((req.body?.title ?? "") || file.originalname || "Untitled").slice(0, 200);
    const uuid = crypto.randomUUID();

    // Move the temp upload into the channel's raw dir.
    const dest = rawPath(channel.id, uuid, file.originalname || "master");
    ensureDir(require("path").dirname(dest));
    await fs.promises.rename(file.path, dest).catch(async () => {
      // rename across filesystems can EXDEV — fall back to copy+unlink
      await fs.promises.copyFile(file.path, dest);
      await fs.promises.unlink(file.path).catch(() => {});
    });

    // Pending row. duration_ms is filled in by the conform worker (NOT NULL, so
    // 0 as a placeholder until 'ready'). storage_path is set to the planned
    // conformed path by the worker on success.
    const ins = await pool.query(
      `INSERT INTO channel_media
         (channel_id, title, storage_path, duration_ms, source_kind, original_name, conform_status)
       VALUES ($1, $2, $3, 0, 'hosted', $4, 'pending')
       RETURNING id, title, duration_ms, conform_status, created_at`,
      [channel.id, title, `raw/${uuid}`, file.originalname || null]
    );
    const media = ins.rows[0];

    // Fire-and-forget conform; the row flips to ready/failed when it finishes.
    void conformMedia({ mediaId: media.id, channelId: channel.id, uuid, rawPath: dest });

    res.status(202).json({ media });
  } catch (err) {
    cleanupTmp();
    console.error("uploadMedia error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
}

/** GET /api/channels/:slug/media — the channel's media catalogue (owner only). */
export async function listMedia(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;
  try {
    const channel = await ownedChannelOr403(req.params.slug, uid, res);
    if (!channel) return;
    const { rows } = await pool.query(
      `SELECT id, title, duration_ms, source_kind, conform_status, original_name, created_at
         FROM channel_media
        WHERE channel_id = $1
        ORDER BY created_at DESC`,
      [channel.id]
    );
    res.json({ media: rows });
  } catch (err) {
    console.error("listMedia error:", err);
    res.status(500).json({ error: "Failed to list media" });
  }
}

/** DELETE /api/channels/:slug/media/:id — remove a media item and its file. */
export async function deleteMedia(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;
  try {
    const channel = await ownedChannelOr403(req.params.slug, uid, res);
    if (!channel) return;
    const mediaId = Number(req.params.id);

    const { rows } = await pool.query(
      `DELETE FROM channel_media WHERE id = $1 AND channel_id = $2
       RETURNING storage_path`,
      [mediaId, channel.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Media not found" });
      return;
    }
    // Best-effort file cleanup (both conformed and any leftover raw).
    const rel = rows[0].storage_path as string;
    const abs = require("path").join(channelRoot(channel.id), rel);
    fs.promises.unlink(abs).catch(() => {});
    res.status(204).end();
  } catch (err) {
    console.error("deleteMedia error:", err);
    res.status(500).json({ error: "Failed to delete media" });
  }
}

/**
 * PATCH /api/channels/:slug/media/:id  (owner only)
 * Give a media item a custom display name. This is the title the scheduler,
 * playlist, and "Now Playing" show — so renaming a raw filename to something
 * human ("Cold Open") flows everywhere the clip airs. `schedule_rev` is bumped
 * so a running engine re-pulls the (retitled) playlist.
 */
export async function renameMedia(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;
  try {
    const channel = await ownedChannelOr403(req.params.slug, uid, res);
    if (!channel) return;
    const mediaId = Number(req.params.id);

    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const { rows } = await pool.query(
      `UPDATE channel_media SET title = $3
        WHERE id = $1 AND channel_id = $2
        RETURNING id, title, duration_ms, conform_status, original_name`,
      [mediaId, channel.id, title]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Media not found" });
      return;
    }
    await pool.query("UPDATE channels SET schedule_rev = now() WHERE id = $1", [channel.id]);
    res.json({ media: rows[0] });
  } catch (err) {
    console.error("renameMedia error:", err);
    res.status(500).json({ error: "Failed to rename media" });
  }
}
