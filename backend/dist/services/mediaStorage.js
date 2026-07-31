"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOUSE_FORMAT = exports.MEDIA_ROOT = void 0;
exports.channelRoot = channelRoot;
exports.rawPath = rawPath;
exports.conformedRelPath = conformedRelPath;
exports.conformedAbsPath = conformedAbsPath;
exports.ensureDir = ensureDir;
exports.houseFormatArgs = houseFormatArgs;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
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
exports.MEDIA_ROOT = process.env.MEDIA_ROOT || path_1.default.join(__dirname, "../../media");
function channelRoot(channelId) {
    return path_1.default.join(exports.MEDIA_ROOT, String(channelId));
}
function rawPath(channelId, uuid, originalName) {
    // keep the original name for humans, but namespace by uuid so it's unique
    const safe = originalName.replace(/[^\w.\-]+/g, "_").slice(-120);
    return path_1.default.join(channelRoot(channelId), "raw", `${uuid}_${safe}`);
}
/** Relative-to-channel-root path stored in channel_media.storage_path. */
function conformedRelPath(uuid) {
    return `${uuid}.mp4`;
}
function conformedAbsPath(channelId, uuid) {
    return path_1.default.join(channelRoot(channelId), conformedRelPath(uuid));
}
function ensureDir(dir) {
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
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
exports.HOUSE_FORMAT = {
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
function houseFormatArgs(output) {
    const f = exports.HOUSE_FORMAT;
    const vf = `scale=${f.width}:${f.height}:force_original_aspect_ratio=decrease,` +
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
