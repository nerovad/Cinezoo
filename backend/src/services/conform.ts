import { spawn } from "child_process";
import fs from "fs";
import pool from "../db/pool";
import {
  conformedAbsPath,
  conformedRelPath,
  ensureDir,
  channelRoot,
  houseFormatArgs,
} from "./mediaStorage";

/** ffprobe a file for its duration in milliseconds (rounded). */
export function probeDurationMs(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      const secs = parseFloat(out.trim());
      if (code === 0 && Number.isFinite(secs) && secs > 0) {
        resolve(Math.round(secs * 1000));
      } else {
        reject(new Error(`ffprobe failed (code ${code}): ${err.trim() || "no duration"}`));
      }
    });
    p.on("error", reject);
  });
}

/**
 * Conform an uploaded master to house format, probe the RESULT for an
 * authoritative duration, and mark the channel_media row ready. Runs in the
 * background (not awaited by the request). On failure the row is marked
 * 'failed' with the reason; the raw upload is left in place for inspection.
 *
 * NOTE: this is an in-process worker. If the server restarts mid-conform, the
 * row stays 'pending' — a startup sweep (re-queue stuck 'pending' rows) is a
 * Phase 5 hardening item, not needed to prove the pipeline.
 */
export async function conformMedia(opts: {
  mediaId: number;
  channelId: number;
  uuid: string;
  rawPath: string;
}): Promise<void> {
  const { mediaId, channelId, uuid, rawPath } = opts;
  const output = conformedAbsPath(channelId, uuid);

  try {
    ensureDir(channelRoot(channelId));

    await runFfmpeg(["-i", rawPath, ...houseFormatArgs(output)]);

    // Probe the conformed output, NOT the master — re-encoding can shift the
    // duration slightly, and the playlist/guide must match what actually plays.
    const durationMs = await probeDurationMs(output);

    await pool.query(
      `UPDATE channel_media
          SET storage_path = $2, duration_ms = $3, conform_status = 'ready'
        WHERE id = $1`,
      [mediaId, conformedRelPath(uuid), durationMs]
    );

    // House-format copy is the source of truth now; drop the raw master.
    fs.promises.unlink(rawPath).catch(() => {});
    console.log(`conform ready: media ${mediaId} (${durationMs}ms)`);
  } catch (err: any) {
    console.error(`conform failed: media ${mediaId}:`, err?.message || err);
    await pool
      .query(
        `UPDATE channel_media SET conform_status = 'failed' WHERE id = $1`,
        [mediaId]
      )
      .catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exit ${code}`));
    });
    p.on("error", reject);
  });
}
