"use strict";
/**
 * ffplayout day-playlist generation.
 *
 * The guide and the playout read the SAME expanded array (see
 * docs/ffplayout-adapter.md section 5): air times are a cumulative sum over
 * this program, so nothing can drift. We expand the channel's ordered segment
 * list, looping it, until the broadcast day is full; ffplayout trims the final
 * clip to land exactly on 24h.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDayPlaylist = buildDayPlaylist;
const DAY_SECONDS = 86400;
const MAX_ITEMS = 100000; // safety bound against pathological zero-length loops
/**
 * Build a full-day playlist by looping `segments` until `targetSeconds` of
 * PLAYING time (out - in) is reached. Field names/units match ffplayout: floats
 * in seconds, wire name `in` (not `seek`), playing time is out - in.
 */
function buildDayPlaylist(channelLabel, date, segments, targetSeconds = DAY_SECONDS) {
    const program = [];
    const totalLoopSec = segments.reduce((s, seg) => s + Math.max(0, (seg.out_ms - seg.in_ms) / 1000), 0);
    if (segments.length === 0 || totalLoopSec <= 0) {
        return { channel: channelLabel, date, program };
    }
    let filled = 0;
    let i = 0;
    while (filled < targetSeconds && program.length < MAX_ITEMS) {
        const seg = segments[i % segments.length];
        const playing = (seg.out_ms - seg.in_ms) / 1000;
        if (playing <= 0) {
            i++;
            continue;
        }
        const item = {
            in: round3(seg.in_ms / 1000),
            out: round3(seg.out_ms / 1000),
            duration: round3(seg.media_duration_ms / 1000),
            source: seg.storage_path,
        };
        if (seg.title)
            item.title = seg.title;
        if (seg.category)
            item.category = seg.category;
        program.push(item);
        filled += playing;
        i++;
    }
    return { channel: channelLabel, date, program };
}
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
