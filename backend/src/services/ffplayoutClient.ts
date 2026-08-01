/**
 * Minimal ffplayout v2 control-plane client.
 *
 * Phase 5 integration proved the adapter's original assumption wrong: ffplayout
 * does NOT pull a day playlist from an HTTP URL. It stores playlists locally and
 * exposes an API to receive them. So Cinezoo PUSHES:
 *
 *   login  →  configure the channel's stream output (RTMP → our tower)
 *          →  POST the generated day playlist
 *          →  control: start
 *
 * Every call here mirrors a request verified by hand against a real
 * ffplayout-v2.0.0-rc5 during the integration test (docs/ffplayout-adapter.md
 * section 13). Auth is username/password → a short-lived access token; we simply
 * re-login on a 401 rather than juggling refresh tokens.
 */

export interface FfplayoutOutput {
  id: number;
  name: string; // 'hls' | 'stream' | 'desktop'
  stream_type?: string | null;
}

export interface StreamOutputConfig {
  streamUrl: string;   // rtmp://host:1935/live/<stream_key>
  width: number;
  height: number;
  fps: number;
  taskPath: string;    // absolute path (inside the ffplayout host) to the as-run script
}

export interface DayPlaylistBody {
  channel: string;
  date: string;        // YYYY-MM-DD
  program: Array<{ in: number; out: number; duration: number; source: string; title?: string; category?: string }>;
}

export class FfplayoutClient {
  private access: string | null = null;

  constructor(
    private baseUrl: string,
    private username: string,
    private password: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async login(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    if (!res.ok) throw new Error(`ffplayout login failed: ${res.status}`);
    const body = (await res.json()) as { access?: string };
    if (!body.access) throw new Error("ffplayout login returned no access token");
    this.access = body.access;
  }

  /** Authenticated fetch that logs in on first use and re-logs once on a 401. */
  private async authFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    if (!this.access) await this.login();
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${this.access}`,
      },
    });
    if (res.status === 401 && retry) {
      this.access = null;
      return this.authFetch(path, init, false);
    }
    return res;
  }

  async listOutputs(ch: number): Promise<FfplayoutOutput[]> {
    const res = await this.authFetch(`/api/playout/outputs/${ch}`);
    if (!res.ok) throw new Error(`listOutputs(${ch}) failed: ${res.status}`);
    return (await res.json()) as FfplayoutOutput[];
  }

  async getConfig(ch: number): Promise<any> {
    const res = await this.authFetch(`/api/playout/config/${ch}`);
    if (!res.ok) throw new Error(`getConfig(${ch}) failed: ${res.status}`);
    return res.json();
  }

  async putConfig(ch: number, config: any): Promise<void> {
    const res = await this.authFetch(`/api/playout/config/${ch}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error(`putConfig(${ch}) failed: ${res.status}`);
  }

  /**
   * Point the channel at our RTMP tower and enable the as-run task. ffplayout
   * selects the active output by its `output.id` (the 'stream' output row), not
   * by a free-form mode string — so we look the id up and set it explicitly.
   */
  async configureStreamOutput(ch: number, opts: StreamOutputConfig): Promise<void> {
    const outputs = await this.listOutputs(ch);
    const stream = outputs.find((o) => o.name === "stream");
    if (!stream) throw new Error(`channel ${ch} has no 'stream' output`);

    const config = await this.getConfig(ch);
    config.output = {
      ...config.output,
      id: stream.id,
      mode: "stream",
      stream_type: "rtmp",
      stream_format: "flv",
      stream_url: opts.streamUrl,
      width: opts.width,
      height: opts.height,
      fps: opts.fps,
    };
    config.task = { enable: true, path: opts.taskPath };
    config.playlist = { ...config.playlist, day_start: "00:00:00" };
    await this.putConfig(ch, config);
  }

  /**
   * Replace the channel's day playlist. DELETE-then-POST is idempotent: a bare
   * POST 409s when a playlist for that date already exists, so we clear it first.
   */
  async pushPlaylist(ch: number, playlist: DayPlaylistBody): Promise<void> {
    await this.authFetch(`/api/playlist/${ch}/${playlist.date}`, { method: "DELETE" }).catch(() => {});
    const res = await this.authFetch(`/api/playlist/${ch}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(playlist),
    });
    if (!res.ok) throw new Error(`pushPlaylist(${ch}, ${playlist.date}) failed: ${res.status}`);
  }

  async control(ch: number, command: "start" | "stop" | "restart" | "status"): Promise<void> {
    const res = await this.authFetch(`/api/control/${ch}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    if (!res.ok) throw new Error(`control(${ch}, ${command}) failed: ${res.status}`);
  }

  async mediaCurrent(ch: number): Promise<any> {
    const res = await this.authFetch(`/api/control/${ch}/media/current`);
    if (!res.ok) throw new Error(`mediaCurrent(${ch}) failed: ${res.status}`);
    return res.json();
  }
}
