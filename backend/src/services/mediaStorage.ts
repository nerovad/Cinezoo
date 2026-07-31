import path from "path";
import fs from "fs";

/**
 * Where hosted channel media lives. Playout (ffplayout) reads from this same
 * tree, so in production this should be a volume shared with the playout host.
 * Layout, per channel:
 *
 *   <MEDIA_ROOT>/<channelId>/raw/<uuid>_<originalName>   uploaded master (transient)
 *   <MEDIA_ROOT>/<channelId>/<uuid>.mp4                  conformed house-format file
 *
 * channel_media.storage_path stores the path RELATIVE to the per-channel root
 * (e.g. "<uuid>.mp4"), which is exactly what a playlist item's `source` needs.
 */
export const MEDIA_ROOT =
  process.env.MEDIA_ROOT || path.join(__dirname, "../../media");

export function channelRoot(channelId: number | string): string {
  return path.join(MEDIA_ROOT, String(channelId));
}

export function rawPath(channelId: number | string, uuid: string, originalName: string): string {
  // keep the original name for humans, but namespace by uuid so it's unique
  const safe = originalName.replace(/[^\w.\-]+/g, "_").slice(-120);
  return path.join(channelRoot(channelId), "raw", `${uuid}_${safe}`);
}

/** Relative-to-channel-root path stored in channel_media.storage_path. */
export function conformedRelPath(uuid: string): string {
  return `${uuid}.mp4`;
}

export function conformedAbsPath(channelId: number | string, uuid: string): string {
  return path.join(channelRoot(channelId), conformedRelPath(uuid));
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * House broadcast format. Conforming every master to ONE profile on ingest is
 * what makes clip-to-clip joins seamless (Phase 1 proved a continuous single
 * encoder produces unbroken HLS; mixed source codecs/resolutions are what break
 * that). Fixed 1280x720 canvas with letterbox/pillarbox so every output has
 * identical dimensions; constant GOP with scene-cut detection off so segment
 * boundaries are predictable; faststart so the file is streamable/probeable
 * from the front.
 */
export const HOUSE_FORMAT = {
  width: 1280,
  height: 720,
  fps: 30,
  gop: 60, // 2s at 30fps
  videoCodec: "libx264",
  preset: "veryfast",
  audioCodec: "aac",
  audioBitrate: "128k",
  audioRate: 44100,
  audioChannels: 2,
};

/** ffmpeg argv (after `-i <input>`) that produces a house-format file. */
export function houseFormatArgs(output: string): string[] {
  const f = HOUSE_FORMAT;
  const vf =
    `scale=${f.width}:${f.height}:force_original_aspect_ratio=decrease,` +
    `pad=${f.width}:${f.height}:(ow-iw)/2:(oh-ih)/2,` +
    `fps=${f.fps},setsar=1`;
  return [
    "-vf", vf,
    "-c:v", f.videoCodec,
    "-preset", f.preset,
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    "-g", String(f.gop),
    "-keyint_min", String(f.gop),
    "-sc_threshold", "0",
    "-c:a", f.audioCodec,
    "-b:a", f.audioBitrate,
    "-ar", String(f.audioRate),
    "-ac", String(f.audioChannels),
    "-movflags", "+faststart",
    "-y",
    output,
  ];
}
