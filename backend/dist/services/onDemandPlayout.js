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
Object.defineProperty(exports, "__esModule", { value: true });
exports.playoutSupervisor = void 0;
const engineDriver_1 = require("./engineDriver");
const playoutResolve_1 = require("./playoutResolve");
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
    constructor() {
        this.pool = null;
        this.driver = (0, engineDriver_1.engineDriverFromEnv)();
        this.enabled = false;
        this.graceMs = 90000;
        // Per-channel engine status. Absent = no engine. 'stopping' = in grace.
        this.status = new Map();
        this.teardownTimers = new Map();
        // Guard cache: slug -> EngineChannel (or null if not eligible), so we don't
        // hit the DB on every viewer tick.
        this.eligible = new Map();
    }
    configureFromEnv(pool) {
        this.pool = pool;
        this.enabled = (process.env.PLAYOUT_ONDEMAND_ENABLED || "false").toLowerCase() === "true";
        this.graceMs = Number(process.env.PLAYOUT_GRACE_MS) || 90000;
        this.driver = (0, engineDriver_1.engineDriverFromEnv)(pool);
        if (this.enabled) {
            console.log(`[playout] on-demand supervisor enabled (grace ${this.graceMs}ms)`);
        }
    }
    /**
     * Called by the socket layer whenever viewer counts change, with the set of
     * channel slugs that currently have >=1 viewer.
     */
    syncViewerCounts(activeSlugs) {
        if (!this.enabled || !this.pool)
            return;
        const plan = (0, playoutResolve_1.planTransitions)(this.status, activeSlugs);
        for (const slug of plan.cancelStop) {
            const t = this.teardownTimers.get(slug);
            if (t) {
                clearTimeout(t);
                this.teardownTimers.delete(slug);
            }
            this.status.set(slug, "running");
        }
        for (const slug of plan.scheduleStop) {
            this.status.set(slug, "stopping");
            const t = setTimeout(() => this.teardown(slug), this.graceMs);
            // Don't keep the process alive just for a teardown timer.
            if (typeof t.unref === "function")
                t.unref();
            this.teardownTimers.set(slug, t);
        }
        for (const slug of plan.start) {
            // Mark running optimistically so rapid ticks don't double-start; the async
            // eligibility check may clear it back to absent.
            this.status.set(slug, "running");
            void this.startIfEligible(slug);
        }
    }
    startIfEligible(slug) {
        return __awaiter(this, void 0, void 0, function* () {
            const channel = yield this.resolveEligible(slug);
            if (!channel) {
                // Not a provisioned scheduled channel with ready segments — forget it so
                // we don't hold a phantom 'running' status.
                if (this.status.get(slug) === "running")
                    this.status.delete(slug);
                return;
            }
            if (this.status.get(slug) !== "running")
                return; // viewers left during the check
            try {
                yield this.driver.start(channel);
            }
            catch (err) {
                console.error(`[playout] start failed for ${slug}:`, err);
                this.status.delete(slug);
            }
        });
    }
    teardown(slug) {
        return __awaiter(this, void 0, void 0, function* () {
            this.teardownTimers.delete(slug);
            if (this.status.get(slug) !== "stopping")
                return; // viewers returned
            const channel = this.eligible.get(slug);
            this.status.delete(slug);
            if (channel) {
                try {
                    yield this.driver.stop(channel);
                }
                catch (err) {
                    console.error(`[playout] stop failed for ${slug}:`, err);
                }
            }
        });
    }
    /** Is this a provisioned, scheduled channel with at least one ready segment? */
    resolveEligible(slug) {
        return __awaiter(this, void 0, void 0, function* () {
            // Only positives are cached (needed at teardown); a not-yet-eligible channel
            // is re-checked on its next start attempt, so newly-added segments are seen.
            const cached = this.eligible.get(slug);
            if (cached)
                return cached;
            let channel = null;
            try {
                const { rows } = yield this.pool.query(`SELECT c.id, c.slug, c.playout_token,
                (SELECT count(*) FROM channel_segments s
                   JOIN channel_media m ON m.id = s.media_id
                  WHERE s.channel_id = c.id AND m.conform_status = 'ready') AS ready_segments
           FROM channels c
          WHERE c.slug = $1 AND c.playout_mode = 'scheduled' AND c.playout_token IS NOT NULL
          LIMIT 1`, [slug]);
                if (rows.length && Number(rows[0].ready_segments) > 0) {
                    // One ffplayout process per channel → its internal channel id is 1.
                    channel = { id: rows[0].id, slug: rows[0].slug, ffplayout_channel_id: 1 };
                }
            }
            catch (err) {
                console.error(`[playout] eligibility check failed for ${slug}:`, err);
            }
            if (channel)
                this.eligible.set(slug, channel); // cache positives only
            return channel;
        });
    }
    /** Drop cached eligibility for a channel (call when its schedule/mode changes). */
    invalidate(slug) {
        this.eligible.delete(slug);
    }
}
exports.playoutSupervisor = new OnDemandPlayout();
