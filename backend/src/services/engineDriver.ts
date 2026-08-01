/**
 * How the supervisor actually starts/stops a channel's playout engine.
 *
 * Behind an interface because the concrete mechanism depends on how ffplayout
 * is deployed, and because until a real engine is wired (Phase 5 integration)
 * the safe default is to do nothing but log. Swap the driver via
 * PLAYOUT_ENGINE_DRIVER without touching the supervisor.
 */

import { Pool } from "pg";
import { FfplayoutClient } from "./ffplayoutClient";
import { buildDayPlaylist, SegmentRow } from "./playlist";
import { MEDIA_ROOT, HOUSE_FORMAT } from "./mediaStorage";

export interface EngineChannel {
  id: number;
  slug: string;
  ffplayout_channel_id: number; // the integer channel id inside ffplayout
}

export interface EngineDriver {
  start(channel: EngineChannel): Promise<void>;
  stop(channel: EngineChannel): Promise<void>;
}

/** Default: no side effects, just a log line. Safe to run without ffplayout. */
export class LoggingEngineDriver implements EngineDriver {
  async start(channel: EngineChannel): Promise<void> {
    console.log(`[playout] would START engine for channel ${channel.slug} (id ${channel.id})`);
  }
  async stop(channel: EngineChannel): Promise<void> {
    console.log(`[playout] would STOP engine for channel ${channel.slug} (id ${channel.id})`);
  }
}

/**
 * Drives a running ffplayout instance via its control API
 * (POST {base}/api/control/{id}/process {command}). ffplayout playlist mode is
 * wall-clock synced, so `start` joins the loop at the correct offset by itself.
 *
 * Auth here is a static bearer token (FFPLAYOUT_TOKEN). ffplayout access tokens
 * are short-lived (45 min) and refresh tokens rotate; a production driver must
 * refresh behind a mutex (see spec section 5). This first cut assumes a
 * long-lived/service token and logs auth failures rather than crashing.
 */
export class FfplayoutControlDriver implements EngineDriver {
  constructor(private baseUrl: string, private token: string) {}

  private async command(channel: EngineChannel, command: 'start' | 'stop'): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/control/${channel.ffplayout_channel_id}/process`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ command }),
      });
      if (!res.ok) {
        console.error(`[playout] ffplayout ${command} for ${channel.slug} failed: ${res.status}`);
      }
    } catch (err) {
      console.error(`[playout] ffplayout ${command} for ${channel.slug} errored:`, err);
    }
  }

  async start(channel: EngineChannel): Promise<void> { await this.command(channel, 'start'); }
  async stop(channel: EngineChannel): Promise<void> { await this.command(channel, 'stop'); }
}

/**
 * Full push-based driver — the one Phase 5 integration proved out.
 *
 * `start` does what the integration test did by hand: configure the channel's
 * stream output to push RTMP at Cinezoo's tower, generate today's playlist from
 * the channel's segments (with ABSOLUTE sources), push it to ffplayout, then
 * start playout. ffplayout's clock-synced playlist mode joins the loop at the
 * right offset on its own. `stop` just stops the process.
 *
 * Needs the DB (to build the playlist) and these env values for the emitted
 * config: FFPLAYOUT_BASE_URL, FFPLAYOUT_USER, FFPLAYOUT_PASSWORD,
 * RTMP_INGEST_URL (tower), FFPLAYOUT_TASK_PATH (as-run script path on the engine
 * host). MEDIA_ROOT must be the shared media volume ffplayout also reads.
 */
export class FfplayoutApiDriver implements EngineDriver {
  constructor(
    private client: FfplayoutClient,
    private pool: Pool,
    private opts: { rtmpBase: string; taskPath: string },
  ) {}

  async start(channel: EngineChannel): Promise<void> {
    const ff = channel.ffplayout_channel_id;

    const { rows: chRows } = await this.pool.query(
      `SELECT stream_key, COALESCE(display_name, name) AS label
         FROM channels WHERE id = $1 LIMIT 1`,
      [channel.id],
    );
    if (chRows.length === 0) throw new Error(`channel ${channel.id} not found`);
    const { stream_key, label } = chRows[0];

    const { rows: segs } = await this.pool.query(
      `SELECT m.storage_path, m.title, s.in_ms, s.out_ms,
              m.duration_ms AS media_duration_ms, s.category
         FROM channel_segments s
         JOIN channel_media m ON m.id = s.media_id
        WHERE s.channel_id = $1 AND m.conform_status = 'ready'
        ORDER BY s.position ASC`,
      [channel.id],
    );

    const storageRoot = `${MEDIA_ROOT}/${channel.id}`;
    const streamUrl = `${this.opts.rtmpBase.replace(/\/$/, "")}/${stream_key}`;
    const date = new Date().toISOString().slice(0, 10); // UTC broadcast day

    await this.client.configureStreamOutput(ff, {
      streamUrl,
      width: HOUSE_FORMAT.width,
      height: HOUSE_FORMAT.height,
      fps: HOUSE_FORMAT.fps,
      taskPath: this.opts.taskPath,
    });

    const playlist = buildDayPlaylist(label || "Channel", date, segs as SegmentRow[], 86400, storageRoot);
    await this.client.pushPlaylist(ff, playlist);
    await this.client.control(ff, "start");
  }

  async stop(channel: EngineChannel): Promise<void> {
    await this.client.control(channel.ffplayout_channel_id, "stop");
  }
}

/** Pick a driver from env. Defaults to logging (safe, no-op side effects). */
export function engineDriverFromEnv(pool?: Pool): EngineDriver {
  const kind = (process.env.PLAYOUT_ENGINE_DRIVER || 'logging').toLowerCase();
  if (kind === 'ffplayout-api') {
    const base = process.env.FFPLAYOUT_BASE_URL || '';
    const user = process.env.FFPLAYOUT_USER || '';
    const pass = process.env.FFPLAYOUT_PASSWORD || '';
    const rtmpBase = process.env.RTMP_INGEST_URL || '';
    const taskPath = process.env.FFPLAYOUT_TASK_PATH || '';
    if (!base || !user || !pass || !rtmpBase || !taskPath || !pool) {
      console.warn('[playout] ffplayout-api driver selected but FFPLAYOUT_BASE_URL/USER/PASSWORD, RTMP_INGEST_URL, FFPLAYOUT_TASK_PATH or DB pool missing — using logging driver');
      return new LoggingEngineDriver();
    }
    return new FfplayoutApiDriver(new FfplayoutClient(base, user, pass), pool, { rtmpBase, taskPath });
  }
  if (kind === 'ffplayout-control') {
    const base = process.env.FFPLAYOUT_BASE_URL || '';
    const token = process.env.FFPLAYOUT_TOKEN || '';
    if (!base || !token) {
      console.warn('[playout] ffplayout-control driver selected but FFPLAYOUT_BASE_URL/TOKEN unset — using logging driver');
      return new LoggingEngineDriver();
    }
    return new FfplayoutControlDriver(base, token);
  }
  return new LoggingEngineDriver();
}
