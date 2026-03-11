import { Server, Socket } from "socket.io";
import { Pool } from "pg";

/** Build top-5 channels by viewer count and broadcast to everyone. */
async function broadcastViewerCounts(io: Server, pool: Pool) {
  // io.sockets.adapter.rooms is a Map<roomId, Set<socketId>>
  const rooms = io.sockets.adapter.rooms;
  const counts: { slug: string; viewers: number }[] = [];

  for (const [roomId, sockets] of rooms) {
    // skip per-socket rooms (socket.id rooms)
    if (io.sockets.sockets.has(roomId)) continue;
    counts.push({ slug: roomId, viewers: sockets.size });
  }

  // sort descending by viewers, take top 5
  counts.sort((a, b) => b.viewers - a.viewers);
  const top5 = counts.slice(0, 5);

  if (top5.length === 0) {
    io.emit("viewerCounts", []);
    return;
  }

  // fetch display names for these slugs
  try {
    const slugs = top5.map((c) => c.slug);
    const { rows } = await pool.query(
      `SELECT slug, display_name, name, channel_number FROM channels WHERE slug = ANY($1)`,
      [slugs]
    );
    const bySlug = new Map(rows.map((r) => [r.slug, r]));

    const payload = top5.map((c) => {
      const ch = bySlug.get(c.slug);
      return {
        slug: c.slug,
        name: ch?.display_name || ch?.name || c.slug,
        channelNumber: ch?.channel_number ?? null,
        viewers: c.viewers,
      };
    });

    io.emit("viewerCounts", payload);
  } catch (err) {
    console.error("broadcastViewerCounts error:", err);
  }
}

export default function setupSocket(io: Server, pool: Pool) {
  io.on("connection", (socket: Socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on("joinRoom", async ({ channelId }) => {
      try {
        for (const room of socket.rooms) {
          if (room !== socket.id) socket.leave(room);
        }

        socket.join(channelId);

        const ch = await pool.query("SELECT id FROM channels WHERE slug = $1 LIMIT 1", [channelId]);
        const channelDbId = ch.rows[0]?.id ?? null;

        let sessionId: number | null = null;
        if (channelDbId) {
          const sess = await pool.query(
            `SELECT id FROM sessions
             WHERE channel_id = $1
               AND now() BETWEEN starts_at AND COALESCE(ends_at, now() + interval '100 years')
               AND status IN ('scheduled','live')
             ORDER BY starts_at DESC
             LIMIT 1`,
            [channelDbId]
          );
          sessionId = sess.rows[0]?.id ?? null;
        }

        const result = sessionId
          ? await pool.query(
            `SELECT m.id, m.content, m.created_at, u.username
               FROM messages m
               JOIN users u ON u.id = m.user_id
               WHERE m.session_id = $1
                 AND m.created_at > NOW() - INTERVAL '1 hour'
               ORDER BY m.created_at ASC`,
            [sessionId]
          )
          : channelDbId
            ? await pool.query(
              `SELECT m.id, m.content, m.created_at, u.username
                 FROM messages m
                 JOIN users u ON u.id = m.user_id
                 WHERE m.channel_id = $1
                   AND m.created_at > NOW() - INTERVAL '1 hour'
                 ORDER BY m.created_at ASC`,
              [channelDbId]
            )
            : { rows: [] };

        socket.data = { channelSlug: channelId, channelDbId, sessionId };
        socket.emit("chatHistory", result.rows);

        // broadcast updated viewer counts after room change
        broadcastViewerCounts(io, pool);
      } catch (err) {
        console.error("joinRoom error:", err);
        socket.emit("chatHistory", []);
      }
    });

    socket.on("sendMessage", async ({ userId, message, channelId }) => {
      try {
        if (!userId || !channelId || !message?.trim()) return;

        const u = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
        if (u.rowCount === 0) return;

        const username = u.rows[0].username;

        let { channelDbId, sessionId } = socket.data ?? {};
        if (!channelDbId) {
          const ch = await pool.query("SELECT id FROM channels WHERE slug = $1", [channelId]);
          channelDbId = ch.rows[0]?.id ?? null;
        }

        const ins = await pool.query(
          `INSERT INTO messages (user_id, content, channel_id, session_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id, content, created_at`,
          [userId, message.trim(), channelDbId, sessionId ?? null]
        );

        io.to(channelId).emit("receiveMessage", {
          id: ins.rows[0].id,
          content: ins.rows[0].content,
          created_at: ins.rows[0].created_at,
          user: username,
        });
      } catch (err) {
        console.error("sendMessage error:", err);
      }
    });

    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.id}`);
      // broadcast updated viewer counts after disconnect
      broadcastViewerCounts(io, pool);
    });

    // send current counts to newly connected client
    broadcastViewerCounts(io, pool);
  });
}
