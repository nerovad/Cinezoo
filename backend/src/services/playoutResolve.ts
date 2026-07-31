/**
 * Pure helpers for the on-demand playout supervisor.
 *
 * NOTE on "seek to the computed offset": ffplayout playlist mode is wall-clock
 * synced — when its engine starts mid-day it plays whatever program item covers
 * the current time, so it JOINS THE LOOP AT THE RIGHT OFFSET on its own. The
 * supervisor therefore only decides start/stop; it does not have to pass a seek.
 * `resolveNowPlaying` below is for Cinezoo's own knowledge (logging on start, a
 * fallback for "now playing" if as-run is briefly stale) — not to drive ffplayout.
 */

export interface LoopSeg {
  playing_ms: number; // out - in
  [k: string]: any;
}

export interface Resolved<T> {
  index: number;
  offsetMs: number; // how far into that segment we are
  segment: T;
}

/**
 * Given a looping segment list anchored at `anchorMs`, what is airing at
 * `nowMs`, and how far into it. Returns null for an empty/zero-length loop.
 */
export function resolveNowPlaying<T extends LoopSeg>(
  segments: T[],
  anchorMs: number,
  nowMs: number
): Resolved<T> | null {
  const totalLoop = segments.reduce((s, seg) => s + Math.max(0, seg.playing_ms), 0);
  if (segments.length === 0 || totalLoop <= 0) return null;

  // Position within the loop, robust to now < anchor (negative) via double mod.
  const elapsed = (((nowMs - anchorMs) % totalLoop) + totalLoop) % totalLoop;

  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const dur = Math.max(0, segments[i].playing_ms);
    if (dur === 0) continue;
    if (elapsed < acc + dur) {
      return { index: i, offsetMs: elapsed - acc, segment: segments[i] };
    }
    acc += dur;
  }
  // Floating-point tail: land on the last non-empty segment.
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].playing_ms > 0) return { index: i, offsetMs: 0, segment: segments[i] };
  }
  return null;
}

/** Anchor = the given day's broadcast_day_start, as an epoch-ms reference. */
export function dayAnchorMs(dayStartHHMM: string, nowMs: number): number {
  const [h, m] = (dayStartHHMM || '00:00').split(':').map((n) => parseInt(n, 10) || 0);
  const d = new Date(nowMs);
  d.setHours(h, m, 0, 0);
  // If we're before today's day-start, the current broadcast day began yesterday.
  let anchor = d.getTime();
  if (anchor > nowMs) anchor -= 86400000;
  return anchor;
}

export type EngineStatus = 'running' | 'stopping'; // absent = no entry

export interface TransitionPlan {
  start: string[];       // slugs with viewers and no engine → start
  scheduleStop: string[]; // running slugs that lost all viewers → begin grace
  cancelStop: string[];  // slugs in grace whose viewers returned → keep running
}

/**
 * Pure decision: given current per-channel engine statuses and the set of
 * channels that currently have >=1 viewer, what transitions should happen.
 */
export function planTransitions(
  statuses: Map<string, EngineStatus>,
  activeSlugs: Set<string>
): TransitionPlan {
  const start: string[] = [];
  const scheduleStop: string[] = [];
  const cancelStop: string[] = [];

  for (const slug of activeSlugs) {
    const st = statuses.get(slug);
    if (st === undefined) start.push(slug);
    else if (st === 'stopping') cancelStop.push(slug);
    // 'running' → nothing to do
  }
  for (const [slug, st] of statuses) {
    if (st === 'running' && !activeSlugs.has(slug)) scheduleStop.push(slug);
  }
  return { start, scheduleStop, cancelStop };
}
