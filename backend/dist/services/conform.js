"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeDurationMs = probeDurationMs;
exports.conformMedia = conformMedia;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const pool_1 = __importDefault(require("../db/pool"));
const mediaStorage_1 = require("./mediaStorage");
/** ffprobe a file for its duration in milliseconds (rounded). */
function probeDurationMs(file) {
    return new Promise((resolve, reject) => {
        const p = (0, child_process_1.spawn)("ffprobe", [
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
            }
            else {
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
function conformMedia(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const { mediaId, channelId, uuid, rawPath } = opts;
        const output = (0, mediaStorage_1.conformedAbsPath)(channelId, uuid);
        try {
            (0, mediaStorage_1.ensureDir)((0, mediaStorage_1.channelRoot)(channelId));
            yield runFfmpeg(["-i", rawPath, ...(0, mediaStorage_1.houseFormatArgs)(output)]);
            // Probe the conformed output, NOT the master — re-encoding can shift the
            // duration slightly, and the playlist/guide must match what actually plays.
            const durationMs = yield probeDurationMs(output);
            yield pool_1.default.query(`UPDATE channel_media
          SET storage_path = $2, duration_ms = $3, conform_status = 'ready'
        WHERE id = $1`, [mediaId, (0, mediaStorage_1.conformedRelPath)(uuid), durationMs]);
            // House-format copy is the source of truth now; drop the raw master.
            fs_1.default.promises.unlink(rawPath).catch(() => { });
            console.log(`conform ready: media ${mediaId} (${durationMs}ms)`);
        }
        catch (err) {
            console.error(`conform failed: media ${mediaId}:`, (err === null || err === void 0 ? void 0 : err.message) || err);
            yield pool_1.default
                .query(`UPDATE channel_media SET conform_status = 'failed' WHERE id = $1`, [mediaId])
                .catch(() => { });
        }
    });
}
function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const p = (0, child_process_1.spawn)("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
        let err = "";
        p.stderr.on("data", (d) => (err += d));
        p.on("close", (code) => {
            code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exit ${code}`));
        });
        p.on("error", reject);
    });
}
