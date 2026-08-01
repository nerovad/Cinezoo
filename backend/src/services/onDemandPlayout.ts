import { Pool } from "pg";
import { EngineDriver, EngineChannel, engineDriverFromEnv } from "./engineDriver";
import { planTransitions, EngineStatus } from "./playoutResolve";

/**
 * On-demand playout supervisor (Phase 5, part 2).
 *
 * A scheduled channel broadcasting 24/7 with zero viewers still burns a full
 * encoder if always-on. This starts a channel's ffplayout engine on the FIRST
 * viewer and tears it down a grace period after the LAST viewer leaves, so idle
 * channels cost nothing. ffplayout's clock-synced playlist mode makes a fresh
 * start join the loop at the right offset automatically.
 *
 * Fed by the socket layer's per-channel viewer counts (chatSocket). Disabled by
 * default (PLAYOUT_ONDEMAND_ENABLED) and defaults to the logging driver, so it
 * is inert until a real ffplayout is wired.
 */
class OnDemandPlayout {
  private pool: Pool | null = null;
  private driver: EngineDriver = engineDriverFromEnv();
  private enabled = false;
  private graceMs = 90_000;

  // Per-channel engine status. Absent = no engine. 'stopping' = in grace.
  private status = new Map<string, EngineStatus>();
  private teardownTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Guard cache: slug -> EngineChannel (or null if not eligible), so we don't
  // hit the DB on every viewer tick.
  private eligible = new Map<string, EngineChannel | null>();

  configureFromEnv(pool: Pool): void {
    this.pool = pool;
    this.enabled = (process.env.PLAYOUT_ONDEMAND_ENABLED || "false").toLowerCase() === "true";
    this.graceMs = Number(process.env.PLAYOUT_GRACE_MS) || 90_000;
    this.driver = engineDriverFromEnv(pool);
    if (this.enabled) {
      console.log(`[playout] on-demand supervisor enabled (grace ${this.graceMs}ms)`);
    }
  }

  /**
   * Called by the socket layer whenever viewer counts change, with the set of
   * channel slugs that currently have >=1 viewer.
   */
  syncViewerCounts(activeSlugs: Set<string>): void {
    if (!this.enabled || !this.pool) return;
    const plan = planTransitions(this.status, activeSlugs);

    for (const slug of plan.cancelStop) {
      const t = this.teardownTimers.get(slug);
      if (t) { clearTimeout(t); this.teardownTimers.delete(slug); }
      this.status.set(slug, "running");
    }
    for (const slug of plan.scheduleStop) {
      this.status.set(slug, "stopping");
      const t = setTimeout(() => this.teardown(slug), this.graceMs);
      // Don't keep the process alive just for a teardown timer.
      if (typeof (t as any).unref === "function") (t as any).unref();
      this.teardownTimers.set(slug, t);
    }
    for (const slug of plan.start) {
      // Mark running optimistically so rapid ticks don't double-start; the async
      // eligibility check may clear it back to absent.
      this.status.set(slug, "running");
      void this.startIfEligible(slug);
    }
  }

  private async startIfEligible(slug: string): Promise<void> {
    const channel = await this.resolveEligible(slug);
    if (!channel) {
      // Not a provisioned scheduled channel with ready segments — forget it so
      // we don't hold a phantom 'running' status.
      if (this.status.get(slug) === "running") this.status.delete(slug);
      return;
    }
    if (this.status.get(slug) !== "running") return; // viewers left during the check
    try {
      await this.driver.start(channel);
    } catch (err) {
      console.error(`[playout] start failed for ${slug}:`, err);
      this.status.delete(slug);
    }
  }

  private async teardown(slug: string): Promise<void> {
    this.teardownTimers.delete(slug);
    if (this.status.get(slug) !== "stopping") return; // viewers returned
    const channel = this.eligible.get(slug);
    this.status.delete(slug);
    if (channel) {
      try { await this.driver.stop(channel); }
      catch (err) { console.error(`[playout] stop failed for ${slug}:`, err); }
    }
  }

  /** Is this a provisioned, scheduled channel with at least one ready segment? */
  private async resolveEligible(slug: string): Promise<EngineChannel | null> {
    // Only positives are cached (needed at teardown); a not-yet-eligible channel
    // is re-checked on its next start attempt, so newly-added segments are seen.
    const cached = this.eligible.get(slug);
    if (cached) return cached;
    let channel: EngineChannel | null = null;
    try {
      const { rows } = await this.pool!.query(
        `SELECT c.id, c.slug, c.playout_token,
                (SELECT count(*) FROM channel_segments s
                   JOIN channel_media m ON m.id = s.media_id
                  WHERE s.channel_id = c.id AND m.conform_status = 'ready') AS ready_segments
           FROM channels c
          WHERE c.slug = $1 AND c.playout_mode = 'scheduled' AND c.playout_token IS NOT NULL
          LIMIT 1`,
        [slug]
      );
      if (rows.length && Number(rows[0].ready_segments) > 0) {
        // One ffplayout process per channel → its internal channel id is 1.
        channel = { id: rows[0].id, slug: rows[0].slug, ffplayout_channel_id: 1 };
      }
    } catch (err) {
      console.error(`[playout] eligibility check failed for ${slug}:`, err);
    }
    if (channel) this.eligible.set(slug, channel); // cache positives only
    return channel;
  }

  /** Drop cached eligibility for a channel (call when its schedule/mode changes). */
  invalidate(slug: string): void {
    this.eligible.delete(slug);
  }
}

export const playoutSupervisor = new OnDemandPlayout();
