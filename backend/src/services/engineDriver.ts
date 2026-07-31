/**
 * How the supervisor actually starts/stops a channel's playout engine.
 *
 * Behind an interface because the concrete mechanism depends on how ffplayout
 * is deployed, and because until a real engine is wired (Phase 5 integration)
 * the safe default is to do nothing but log. Swap the driver via
 * PLAYOUT_ENGINE_DRIVER without touching the supervisor.
 */

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

/** Pick a driver from env. Defaults to logging (safe, no-op side effects). */
export function engineDriverFromEnv(): EngineDriver {
  const kind = (process.env.PLAYOUT_ENGINE_DRIVER || 'logging').toLowerCase();
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
