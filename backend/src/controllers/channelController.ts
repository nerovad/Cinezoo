import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import pool from "../db/pool";
import { slugify } from "../utils/slugify";
import crypto from "crypto";
import fs from "fs";
import path from "path";

/* ------------ Auth helper copied to match your profileController style ------------ */
function authUserIdOr401(req: Request, res: Response): number | null {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Access Denied" });
    return null;
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: number };
    return decoded.id;
  } catch {
    res.status(401).json({ error: "Invalid Token" });
    return null;
  }
}

/* --------------------------------- Utils --------------------------------- */
function generateStreamKey(): string {
  return crypto.randomBytes(16).toString("hex");
}

function parseDurationToSeconds(s?: string): number | null {
  if (!s) return null;
  const parts = s.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) {
    const [hh, mm, ss] = parts;
    return hh * 3600 + mm * 60 + ss;
  } else if (parts.length === 2) {
    const [mm, ss] = parts;
    return mm * 60 + ss;
  } else if (parts.length === 1) {
    return parts[0];
  }
  return null;
}

// Save base64 image to uploads folder and return the URL path
function saveBase64Image(base64Data: string, channelSlug: string, subfolder: string = "thumbnails"): string | null {
  if (!base64Data) return null;

  try {
    // Extract mime type and data from base64 string
    const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) return null;

    const extension = matches[1];
    const data = matches[2];
    const buffer = Buffer.from(data, "base64");

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(__dirname, `../../uploads/${subfolder}`);
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Generate filename
    const filename = `${channelSlug}-${Date.now()}.${extension}`;
    const filepath = path.join(uploadsDir, filename);

    // Save file
    fs.writeFileSync(filepath, buffer);

    // Return URL path
    return `/uploads/${subfolder}/${filename}`;
  } catch (err) {
    console.error(`Failed to save ${subfolder} image:`, err);
    return null;
  }
}

/**
 * Create or update a channel, and (optionally) create a session + lineup.
 * - Associates the channel with the logged-in user (owner_id).
 * - Updates are allowed only if the current user owns the channel.
 * - Auto-determines voting_mode based on event.kind
 * - Always requires login to vote (require_login = true)
 */
export async function createChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;

  const client = await pool.connect();
  let begun = false;

  try {
    let {
      name,
      slug,
      stream_url,
      display_name,
      channel_number,
      // OPTIONAL festival payload
      type, // "channel" | "festival" (unused for channel insert; accepted for completeness)
      event, // { kind, title, starts_at, ends_at, tournament_bracket }
      films, // [{ title, creator?, duration?, thumbnail?, id? }]
      // NEW: Widget system fields
      widgets, // [{ type, order, config? }]
      about_text, // Markdown text for About widget
      first_live_at, // When channel first went live
      tags, // Metadata tags for channel discovery
      thumbnail, // Base64 encoded thumbnail image
      intermission, // Base64 encoded intermission screen image
      schedule, // Schedule items for Now Playing / Up Next widget
    } = req.body as {
      name: string;
      slug?: string;
      stream_url?: string;
      display_name?: string;
      channel_number?: number;
      type?: string;
      event?: {
        kind?: string; // "film_festival" | "battle_royal" | "tournament"
        title: string;
        starts_at: string;
        ends_at?: string | null;
        tournament_bracket?: any; // tournament bracket structure
      };
      films?: Array<{
        title: string;
        creator?: string;
        duration?: string;
        thumbnail?: string;
        id?: string; // film ID for tournament seeding
      }>;
      widgets?: Array<{
        type: string;
        order: number;
        config?: any;
      }>;
      about_text?: string;
      first_live_at?: string | null;
      tags?: string[];
      thumbnail?: string;
      intermission?: string;
      schedule?: Array<{
        film_id?: number;
        title?: string;
        scheduled_at: string;
        duration_seconds?: number;
        recurrence_type?: string;
        recurrence_days?: number[];
        recurrence_end_date?: string;
        air_time?: string;
      }>;
    };

    if (!name && !slug) {
      res.status(400).json({ error: "name (or slug) is required" });
      return;
    }

    slug = slug ? slugify(slug) : slugify(name!);

    await client.query("BEGIN");
    begun = true;

    // Check if slug already exists
    const existing = await client.query(
      `select id, owner_id, name, stream_url, stream_key, ingest_app, playback_path, created_at
       from channels where slug = $1 limit 1`,
      [slug]
    );

    let channel: any;

    if (existing.rowCount) {
      const row = existing.rows[0];
      // Only owner can update this channel
      if (row.owner_id !== uid) {
        await client.query("ROLLBACK");
        begun = false;
        res.status(409).json({ error: "Channel slug is already in use by another user." });
        return;
      }

      // Update name/stream_url only; preserve keys/paths
      const upd = await client.query(
        `update channels
         set name = $2, stream_url = $3, display_name = $4, channel_number = $5,
             widgets = COALESCE($6, widgets),
             about_text = COALESCE($7, about_text),
             first_live_at = COALESCE($8, first_live_at),
             tags = COALESCE($9, tags)
         where id = $1
         returning id, slug, name, stream_url, stream_key, ingest_app, playback_path, display_name, channel_number, widgets, about_text, first_live_at, tags, created_at`,
        [row.id, name ?? row.name, stream_url ?? row.stream_url, display_name ?? row.display_name, channel_number ?? row.channel_number,
         widgets ? JSON.stringify(widgets) : null,
         about_text ?? null,
         first_live_at ?? null,
         tags && tags.length > 0 ? tags : null]
      );
      channel = upd.rows[0];
    } else {
      // Create a brand-new channel for this owner
      const streamKey = generateStreamKey();
      const ingestApp = "live";
      const playbackPath = `/hls/${streamKey}/index.m3u8`;

      // Save thumbnail if provided
      const thumbnailUrl = thumbnail ? saveBase64Image(thumbnail, slug, "thumbnails") : null;
      // Save intermission screen if provided (custom per-channel)
      const intermissionUrl = intermission ? saveBase64Image(intermission, slug, "intermissions") : null;

      const chResult = await client.query(
        `insert into channels
           (owner_id, slug, name, stream_url, stream_key, ingest_app, playback_path, display_name, channel_number, widgets, about_text, first_live_at, tags, thumbnail, intermission_url, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
         returning id, slug, name, stream_url, stream_key, ingest_app, playback_path, display_name, channel_number, widgets, about_text, first_live_at, tags, thumbnail, intermission_url, created_at`,
        [uid, slug, name ?? slug, stream_url ?? null, streamKey, ingestApp, playbackPath, display_name ?? null, channel_number ?? null,
         widgets ? JSON.stringify(widgets) : null,
         about_text ?? null,
         first_live_at ?? null,
         tags && tags.length > 0 ? tags : null,
         thumbnailUrl,
         intermissionUrl]
      );
      channel = chResult.rows[0];
    }

    // Insert schedule items for Now Playing / Up Next widget if provided
    if (schedule && Array.isArray(schedule) && schedule.length > 0) {
      for (const item of schedule) {
        // Require scheduled_at AND either a title or a film_id
        if (!item.scheduled_at || (!item.title && !item.film_id)) {
          continue;
        }

        // If we have a film_id but no title, look up the film's title
        let title = item.title;
        if (item.film_id && !title) {
          const filmResult = await client.query('SELECT title FROM films WHERE id = $1', [item.film_id]);
          if (filmResult.rows.length > 0) {
            title = filmResult.rows[0].title;
          }
        }

        await client.query(
          `INSERT INTO channel_schedule
             (channel_id, film_id, title, scheduled_at, duration_seconds, status, recurrence_type, recurrence_days, recurrence_end_date, air_time)
           VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $7, $8, $9)
           ON CONFLICT (channel_id, scheduled_at)
           DO UPDATE SET
             film_id = EXCLUDED.film_id,
             title = EXCLUDED.title,
             duration_seconds = EXCLUDED.duration_seconds,
             recurrence_type = EXCLUDED.recurrence_type,
             recurrence_days = EXCLUDED.recurrence_days,
             recurrence_end_date = EXCLUDED.recurrence_end_date,
             air_time = EXCLUDED.air_time`,
          [
            channel.id,
            item.film_id || null,
            title || null,
            item.scheduled_at,
            item.duration_seconds || null,
            item.recurrence_type || 'once',
            item.recurrence_days || null,
            item.recurrence_end_date || null,
            item.air_time || null
          ]
        );
      }
    }

    // Optional event + films for session lineup
    const hasEventPayload =
      event &&
      typeof event.title === "string" &&
      event.title.trim().length > 0 &&
      typeof event.starts_at === "string" &&
      event.starts_at.trim().length > 0;

    const hasFilms = Array.isArray(films) && films.length > 0;

    let sessionRow: any = null;
    let filmRows: Array<{ id: number; title: string }> = [];

    if (hasEventPayload && hasFilms) {
      // ✅ Auto-determine voting_mode based on event type
      const eventKind = event!.kind ?? 'film_festival';
      let votingMode: 'ratings' | 'battle';

      if (eventKind === 'film_festival') {
        votingMode = 'ratings';
      } else if (eventKind === 'battle_royal' || eventKind === 'tournament') {
        votingMode = 'battle';
      } else {
        votingMode = 'ratings'; // default fallback
      }

      // ✅ Always require login to vote
      const requireLogin = true;

      const sesResult = await client.query(
        `insert into sessions (channel_id, title, starts_at, ends_at, status, event_type, voting_mode, require_login, created_at)
         values ($1, $2, $3, $4, 'scheduled', $5, $6, $7, now())
         returning id, channel_id, title, starts_at, ends_at, status, event_type, voting_mode, require_login`,
        [channel.id, event!.title, event!.starts_at, event!.ends_at ?? null, eventKind, votingMode, requireLogin]
      );
      sessionRow = sesResult.rows[0];

      // ✅ Process films and create session entries
      filmRows = [];
      for (let i = 0; i < films!.length; i++) {
        const f = films![i];
        if (!f?.title || !f.title.trim()) continue;

        const runtimeSeconds = parseDurationToSeconds(f.duration);

        const found = await client.query(
          `select id, title from films where lower(title) = lower($1) limit 1`,
          [f.title.trim()]
        );

        let filmId: number;
        if (found.rowCount) {
          filmId = found.rows[0].id;
        } else {
          const ins = await client.query(
            `insert into films (title, creator_user_id, runtime_seconds, created_at)
             values ($1, $2, $3, now())
             returning id, title`,
            [f.title.trim(), uid, runtimeSeconds]
          );
          filmId = ins.rows[0].id;
        }

        filmRows.push({ id: filmId, title: f.title.trim() });

        await client.query(
          `insert into session_entries (session_id, film_id, order_index)
           values ($1, $2, $3)`,
          [sessionRow.id, filmId, i]
        );
      }

      // ✅ TOURNAMENT BRACKET HANDLING
      if (event?.kind === "tournament" && event?.tournament_bracket) {
        console.log("Creating tournament bracket for session:", sessionRow.id);
        console.log("Available films in filmRows:", filmRows.map(f => ({ id: f.id, title: f.title })));

        // Store bracket structure in session
        await client.query(
          `UPDATE sessions SET tournament_bracket = $1 WHERE id = $2`,
          [JSON.stringify(event.tournament_bracket), sessionRow.id]
        );

        // Create initial matchup records for Round 1 only
        const bracket = event.tournament_bracket;
        if (bracket.rounds && Array.isArray(bracket.rounds)) {
          const firstRound = bracket.rounds.find((r: any) => r.roundNumber === 1);
          if (firstRound && firstRound.matchups) {
            for (const matchup of firstRound.matchups) {
              console.log("Processing matchup:", {
                id: matchup.id,
                film1: matchup.film1,
                film2: matchup.film2
              });

              // Get actual film database IDs by matching titles
              let film1DbId: number | null = null;
              let film2DbId: number | null = null;

              // ✅ Check for film1 existence (not film1.id)
              if (matchup.film1) {
                console.log(`Looking for film1: "${matchup.film1.title}"`);
                const film1Match = filmRows.find(fr => {
                  const match = matchup.film1.title.toLowerCase().trim() === fr.title.toLowerCase().trim();
                  console.log(`  Comparing "${matchup.film1.title}" vs "${fr.title}" = ${match}`);
                  return match;
                });
                film1DbId = film1Match?.id ?? null;
                console.log(`  film1DbId: ${film1DbId}`);
              }

              // ✅ Check for film2 existence (not film2.id)
              if (matchup.film2) {
                console.log(`Looking for film2: "${matchup.film2.title}"`);
                const film2Match = filmRows.find(fr => {
                  const match = matchup.film2.title.toLowerCase().trim() === fr.title.toLowerCase().trim();
                  console.log(`  Comparing "${matchup.film2.title}" vs "${fr.title}" = ${match}`);
                  return match;
                });
                film2DbId = film2Match?.id ?? null;
                console.log(`  film2DbId: ${film2DbId}`);
              }
              // Store film IDs as strings (matching your schema)
              await client.query(
                `INSERT INTO tournament_matchups (session_id, matchup_id, round_number, position, film1_id, film2_id)
                VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                  sessionRow.id,
                  matchup.id,
                  firstRound.roundNumber,
                  matchup.position,
                  film1DbId ? film1DbId.toString() : null,
                  film2DbId ? film2DbId.toString() : null,
                ]
              );
            }
            console.log(`Created ${firstRound.matchups.length} tournament matchups`);
          }
        }
      }
    }

    await client.query("COMMIT");
    begun = false;

    res.status(201).json({
      ...channel,
      session: sessionRow ?? null,
      films: filmRows,
    });
  } catch (err) {
    try {
      if (begun) await client.query("ROLLBACK");
    } catch { }
    next(err);
  } finally {
    client.release();
  }
}

/* ===== Existing endpoints (kept) ===== */

// GET /api/channels -> must return an ARRAY
export async function listChannels(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query(
      `select id, slug, name, stream_url, stream_key, ingest_app, playback_path, channel_number, display_name, tags, intermission_url, created_at
       from channels order by created_at desc`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// GET /api/channels/:slug
export async function getChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const slug = String(req.params.slug);
    const { rows } = await pool.query(
      `select c.id, c.slug, c.name, c.stream_url, c.stream_key, c.ingest_app, c.playback_path,
              c.display_name, c.channel_number, c.widgets, c.about_text, c.first_live_at, c.thumbnail, c.intermission_url, c.created_at,
              u.username as owner_name
       from channels c
       left join users u on c.owner_id = u.id
       where c.slug = $1 limit 1`,
      [slug]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const channel = rows[0];

    // ✅ UPDATED: Add event_type to the session query
    const session = await pool.query(
      `select id, title, starts_at, ends_at, status, event_type
       from sessions where channel_id = $1
       order by starts_at desc limit 1`,
      [channel.id]
    );

    const latestSession = session.rows[0] ?? null;

    // Fetch all sessions for this channel (for event history)
    const allSessions = await pool.query(
      `select id, title, starts_at, ends_at, status, event_type, created_at
       from sessions where channel_id = $1
       order by starts_at desc`,
      [channel.id]
    );

    res.json({
      ...channel,
      latestSession: latestSession,
      event_type: latestSession?.event_type ?? null, // ✅ Add event_type at top level for easy frontend access
      sessions: allSessions.rows, // ✅ Add all sessions for event history
    });
  } catch (err) {
    next(err);
  }
}

export async function updateChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;

  const channelId = req.params.id;
  const { display_name, description, event, films, widgets, about_text, first_live_at, thumbnail, intermission } = req.body;

  const client = await pool.connect();
  let begun = false;

  try {
    await client.query("BEGIN");
    begun = true;

    // Verify ownership
    const ownership = await client.query(
      `SELECT id, slug FROM channels WHERE id = $1 AND owner_id = $2`,
      [channelId, uid]
    );

    if (!ownership.rowCount) {
      await client.query("ROLLBACK");
      begun = false;
      res.status(403).json({ error: "Not authorized to edit this channel" });
      return;
    }

    const channelSlug = ownership.rows[0].slug;

    // Save thumbnail if provided
    const thumbnailUrl = thumbnail ? saveBase64Image(thumbnail, channelSlug, "thumbnails") : null;
    // Save intermission screen if provided
    const intermissionUrl = intermission ? saveBase64Image(intermission, channelSlug, "intermissions") : null;

    // Update channel
    const updated = await client.query(
      `UPDATE channels
       SET display_name = COALESCE($1, display_name),
           description = COALESCE($2, description),
           widgets = COALESCE($3, widgets),
           about_text = COALESCE($4, about_text),
           first_live_at = COALESCE($5, first_live_at),
           thumbnail = COALESCE($7, thumbnail),
           intermission_url = COALESCE($8, intermission_url)
       WHERE id = $6
       RETURNING *`,
      [display_name, description, widgets ? JSON.stringify(widgets) : null, about_text, first_live_at, channelId, thumbnailUrl, intermissionUrl]
    );

    // Handle event creation if provided (same logic as createChannel)
    let sessionRow = null;
    let filmRows: Array<{ id: number; title: string }> = [];

    if (event && films && films.length > 0) {
      const sesResult = await client.query(
        `INSERT INTO sessions (channel_id, title, starts_at, ends_at, status, created_at)
         VALUES ($1, $2, $3, $4, 'scheduled', now())
         RETURNING id, channel_id, title, starts_at, ends_at, status`,
        [channelId, event.title, event.starts_at, event.ends_at ?? null]
      );
      sessionRow = sesResult.rows[0];

      for (let i = 0; i < films.length; i++) {
        const f = films[i];
        if (!f?.title || !f.title.trim()) continue;

        const runtimeSeconds = parseDurationToSeconds(f.duration);

        const found = await client.query(
          `SELECT id, title FROM films WHERE lower(title) = lower($1) LIMIT 1`,
          [f.title.trim()]
        );

        let filmId: number;
        if (found.rowCount) {
          filmId = found.rows[0].id;
        } else {
          const ins = await client.query(
            `INSERT INTO films (title, creator_user_id, runtime_seconds, created_at)
             VALUES ($1, $2, $3, now())
             RETURNING id, title`,
            [f.title.trim(), uid, runtimeSeconds]
          );
          filmId = ins.rows[0].id;
        }

        filmRows.push({ id: filmId, title: f.title.trim() });

        await client.query(
          `INSERT INTO session_entries (session_id, film_id, order_index)
           VALUES ($1, $2, $3)`,
          [sessionRow.id, filmId, i]
        );
      }
    }

    await client.query("COMMIT");
    begun = false;

    res.json({
      ...updated.rows[0],
      session: sessionRow,
    });
  } catch (err) {
    try {
      if (begun) await client.query("ROLLBACK");
    } catch { }
    next(err);
  } finally {
    client.release();
  }
}

// Add this to channelController.ts
export async function deleteChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;

  const channelId = req.params.id;

  const client = await pool.connect();
  let begun = false;

  try {
    await client.query("BEGIN");
    begun = true;

    // Verify ownership
    const ownership = await client.query(
      `SELECT id FROM channels WHERE id = $1 AND owner_id = $2`,
      [channelId, uid]
    );

    if (!ownership.rowCount) {
      await client.query("ROLLBACK");
      begun = false;
      res.status(403).json({ error: "Not authorized to delete this channel" });
      return;
    }

    // Delete associated sessions and entries first (if any)
    await client.query(
      `DELETE FROM session_entries WHERE session_id IN (
         SELECT id FROM sessions WHERE channel_id = $1
       )`,
      [channelId]
    );

    await client.query(`DELETE FROM sessions WHERE channel_id = $1`, [channelId]);

    // Delete the channel
    await client.query(`DELETE FROM channels WHERE id = $1`, [channelId]);

    await client.query("COMMIT");
    begun = false;

    res.json({ success: true, message: "Channel deleted successfully" });
  } catch (err) {
    try {
      if (begun) await client.query("ROLLBACK");
    } catch { }
    next(err);
  } finally {
    client.release();
  }
}

// GET /api/channels/:slug/ingest
export async function getIngest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const slug = String(req.params.slug);
    const { rows } = await pool.query(
      `select slug, stream_key, ingest_app from channels where slug = $1 limit 1`,
      [slug]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const { stream_key, ingest_app } = rows[0];
    const ingest_url = `rtmp://dainbramage.tv/${ingest_app}/${stream_key}`;

    res.json({ ingest_url, stream_key });
  } catch (err) {
    next(err);
  }
}

// POST /api/channels/:slug/rotate
export async function rotateKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const slug = String(req.params.slug);
    const newKey = generateStreamKey();
    const newPlayback = `/hls/${newKey}/index.m3u8`;

    const { rows } = await pool.query(
      `update channels
       set stream_key = $1, playback_path = $2
       where slug = $3
       returning stream_key, playback_path`,
      [newKey, newPlayback, slug]
    );

    if (!rows.length) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    res.json({ stream_key: rows[0].stream_key, playback_path: rows[0].playback_path });
  } catch (err) {
    next(err);
  }
}

/* ===== NEW: GET /api/channels/mine ===== */
export async function getMyChannels(req: Request, res: Response): Promise<void> {
  const uid = authUserIdOr401(req, res);
  if (!uid) return;

  const r = await pool.query(
    `SELECT
       c.id,
       c.slug,
       c.name,
       c.display_name,
       c.channel_number,
       c.stream_url,
       null::text as description,
       false as "isLive",
       c.thumbnail,
       s.id as session_id,
       s.event_type
     FROM channels c
     LEFT JOIN sessions s ON s.channel_id = c.id AND s.is_active = true
     WHERE c.owner_id = $1
     ORDER BY c.channel_number ASC`,
    [uid]
  );

  res.json(r.rows);
}

/* ===== NEW: Channel Schedule Endpoints ===== */

// Helper: Expand recurring schedule items into individual occurrences
function expandRecurringItems(items: any[], daysAhead: number = 7): any[] {
  const now = new Date();
  const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const expanded: any[] = [];

  for (const item of items) {
    const recurrenceType = item.recurrence_type || 'once';

    if (recurrenceType === 'once') {
      // Non-recurring item, include as-is
      expanded.push(item);
      continue;
    }

    // Recurring item - expand to individual occurrences
    const startDate = new Date(item.scheduled_at);
    const airTime = item.air_time || '00:00';
    const [hours, minutes] = airTime.split(':').map(Number);
    const recurrenceEndDate = item.recurrence_end_date ? new Date(item.recurrence_end_date) : null;

    // Get days of week for this recurrence type
    let daysOfWeek: number[];
    switch (recurrenceType) {
      case 'daily':
        daysOfWeek = [0, 1, 2, 3, 4, 5, 6];
        break;
      case 'weekdays':
        daysOfWeek = [1, 2, 3, 4, 5]; // Mon-Fri
        break;
      case 'weekends':
        daysOfWeek = [0, 6]; // Sun, Sat
        break;
      case 'weekly':
        daysOfWeek = item.recurrence_days || [];
        break;
      default:
        daysOfWeek = [];
    }

    // Generate occurrences for each day in the range
    const currentDate = new Date(Math.max(startDate.getTime(), now.getTime() - 24 * 60 * 60 * 1000));
    currentDate.setHours(0, 0, 0, 0);

    while (currentDate <= endDate) {
      // Check if this day matches the recurrence pattern
      const dayOfWeek = currentDate.getDay();

      if (daysOfWeek.includes(dayOfWeek)) {
        // Check if within the recurrence period
        if (currentDate >= startDate && (!recurrenceEndDate || currentDate <= recurrenceEndDate)) {
          const occurrenceTime = new Date(currentDate);
          occurrenceTime.setHours(hours, minutes, 0, 0);

          // Create expanded occurrence
          expanded.push({
            ...item,
            scheduled_at: occurrenceTime.toISOString(),
            is_recurring_instance: true,
            original_id: item.id,
          });
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  // Sort by scheduled_at
  expanded.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  return expanded;
}

// GET /api/channels/:slug/schedule - Get channel schedule
export async function getChannelSchedule(req: Request, res: Response): Promise<void> {
  const { slug } = req.params;
  const client = await pool.connect();

  try {
    // Get channel ID
    const chResult = await client.query('SELECT id FROM channels WHERE slug = $1', [slug]);
    if (chResult.rows.length === 0) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    const channelId = chResult.rows[0].id;

    console.log('Fetching schedule for channel:', { slug, channelId });

    const now = new Date();

    // Get ALL schedule items for this channel (including recurrence fields)
    const allResult = await client.query(
      `SELECT cs.*,
              COALESCE(f.title, cs.title) as display_title,
              f.id as film_id
       FROM channel_schedule cs
       LEFT JOIN films f ON cs.film_id = f.id
       WHERE cs.channel_id = $1
       ORDER BY cs.scheduled_at ASC`,
      [channelId]
    );

    console.log('Found schedule items:', allResult.rows.length);

    if (allResult.rows.length === 0) {
      res.json({
        now_playing: null,
        up_next: [],
        schedule: []
      });
      return;
    }

    // Expand recurring items into individual occurrences for the next 7 days
    const expandedItems = expandRecurringItems(allResult.rows, 7);

    // Separate into now playing and up next
    let nowPlaying = null;
    const upNext: any[] = [];

    for (const item of expandedItems) {
      const scheduledTime = new Date(item.scheduled_at);
      const endTime = item.duration_seconds
        ? new Date(scheduledTime.getTime() + item.duration_seconds * 1000)
        : new Date(scheduledTime.getTime() + 3600000); // Default 1 hour if no duration

      if (scheduledTime <= now && now < endTime) {
        // Currently airing
        nowPlaying = item;
      } else if (scheduledTime > now) {
        // Future items
        upNext.push(item);
      }
    }

    // If nothing is currently airing, use the most recent past item
    if (!nowPlaying && expandedItems.length > 0) {
      const pastItems = expandedItems.filter(item => new Date(item.scheduled_at) <= now);
      if (pastItems.length > 0) {
        nowPlaying = pastItems[pastItems.length - 1];
      }
    }

    // If still nothing, use the first upcoming item
    if (!nowPlaying && upNext.length > 0) {
      nowPlaying = upNext.shift();
    }

    console.log('Schedule result:', { nowPlaying: !!nowPlaying, upNextCount: upNext.length });

    res.json({
      now_playing: nowPlaying,
      up_next: upNext.slice(0, 5), // Limit to 5 upcoming
      schedule: allResult.rows // Return raw items (not expanded) for editing
    });
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  } finally {
    client.release();
  }
}

// POST /api/channels/:slug/schedule - Create/update schedule items
export async function updateChannelSchedule(req: Request, res: Response): Promise<void> {
  console.log('=== SCHEDULE UPDATE STARTED ===');
  console.log('Request params:', req.params);
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  console.log('Request headers:', {
    authorization: req.headers.authorization ? 'Present' : 'Missing',
    contentType: req.headers['content-type']
  });

  const { slug } = req.params;
  const uid = authUserIdOr401(req, res);

  console.log('Auth check result - uid:', uid);

  if (uid === null) {
    console.log('Auth failed - returning 401');
    return;
  }

  const { schedule } = req.body; // Array of {film_id, title, scheduled_at, duration_seconds, recurrence_type, recurrence_days, recurrence_end_date, air_time}

  console.log('Update schedule request:', { slug, uid, scheduleCount: schedule?.length });
  console.log('Schedule items:', JSON.stringify(schedule, null, 2));

  if (!schedule || !Array.isArray(schedule)) {
    console.log('ERROR: Schedule is not an array');
    res.status(400).json({ error: 'Schedule must be an array' });
    return;
  }

  if (schedule.length === 0) {
    console.log('WARNING: Schedule array is empty');
  }

  const client = await pool.connect();
  console.log('Database client acquired');

  try {
    console.log('Starting transaction...');
    await client.query('BEGIN');
    console.log('Transaction started');

    // Get channel and verify ownership
    console.log('Looking up channel by slug:', slug);
    const chResult = await client.query(
      'SELECT id, owner_id FROM channels WHERE slug = $1',
      [slug]
    );

    console.log('Channel query result:', chResult.rows);

    if (chResult.rows.length === 0) {
      console.log('ERROR: Channel not found');
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const channel = chResult.rows[0];
    console.log('Channel found:', { channelId: channel.id, ownerId: channel.owner_id, requestUid: uid });

    if (channel.owner_id !== uid) {
      console.log('ERROR: User does not own this channel');
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    console.log('Authorization passed, proceeding with inserts...');

    // Insert schedule items (upsert on conflict)
    let insertedCount = 0;
    for (let i = 0; i < schedule.length; i++) {
      const item = schedule[i];
      console.log(`\n--- Processing item ${i + 1}/${schedule.length} ---`);
      console.log('Item data:', JSON.stringify(item, null, 2));

      // Require scheduled_at AND either a title or a film_id
      if (!item.scheduled_at || (!item.title && !item.film_id)) {
        console.warn('SKIPPING invalid item (missing required fields):', item);
        continue;
      }

      // If we have a film_id but no title, look up the film's title
      let title = item.title;
      if (item.film_id && !title) {
        const filmResult = await client.query('SELECT title FROM films WHERE id = $1', [item.film_id]);
        if (filmResult.rows.length > 0) {
          title = filmResult.rows[0].title;
          console.log('Looked up film title:', title);
        }
      }

      console.log('Executing INSERT query with values:', {
        channel_id: channel.id,
        film_id: item.film_id || null,
        title: title || null,
        scheduled_at: item.scheduled_at,
        duration_seconds: item.duration_seconds || null,
        recurrence_type: item.recurrence_type || 'once',
        recurrence_days: item.recurrence_days || null,
        recurrence_end_date: item.recurrence_end_date || null,
        air_time: item.air_time || null
      });

      const insertResult = await client.query(
        `INSERT INTO channel_schedule
           (channel_id, film_id, title, scheduled_at, duration_seconds, status, recurrence_type, recurrence_days, recurrence_end_date, air_time)
         VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $7, $8, $9)
         ON CONFLICT (channel_id, scheduled_at)
         DO UPDATE SET
           film_id = EXCLUDED.film_id,
           title = EXCLUDED.title,
           duration_seconds = EXCLUDED.duration_seconds,
           recurrence_type = EXCLUDED.recurrence_type,
           recurrence_days = EXCLUDED.recurrence_days,
           recurrence_end_date = EXCLUDED.recurrence_end_date,
           air_time = EXCLUDED.air_time
         RETURNING id`,
        [
          channel.id,
          item.film_id || null,
          title || null,
          item.scheduled_at,
          item.duration_seconds || null,
          item.recurrence_type || 'once',
          item.recurrence_days || null,
          item.recurrence_end_date || null,
          item.air_time || null
        ]
      );

      console.log('Insert successful, returned id:', insertResult.rows[0]?.id);
      insertedCount++;
    }

    console.log(`\nAll ${insertedCount} items processed. Committing transaction...`);
    await client.query('COMMIT');
    console.log('COMMIT successful!');
    console.log(`=== SCHEDULE UPDATE COMPLETED: ${insertedCount} items saved ===\n`);

    res.json({ success: true, count: insertedCount });
  } catch (error) {
    console.log('\n!!! ERROR OCCURRED - ROLLING BACK !!!');
    await client.query('ROLLBACK');
    console.error('Error details:', error);
    console.log('=== SCHEDULE UPDATE FAILED ===\n');
    res.status(500).json({ error: 'Failed to update schedule', details: error instanceof Error ? error.message : 'Unknown error' });
  } finally {
    client.release();
    console.log('Database client released');
  }
}
