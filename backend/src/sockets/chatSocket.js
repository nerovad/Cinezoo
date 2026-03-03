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
exports.default = setupSocket;
function setupSocket(io, pool) {
    io.on("connection", (socket) => {
        console.log(`User connected: ${socket.id}`);
        socket.on("joinRoom", (_a) => __awaiter(this, [_a], void 0, function* ({ channelId }) {
            var _b, _c, _d, _e;
            try {
                for (const room of socket.rooms) {
                    if (room !== socket.id)
                        socket.leave(room);
                }
                socket.join(channelId);
                const ch = yield pool.query("SELECT id FROM channels WHERE slug = $1 LIMIT 1", [channelId]);
                const channelDbId = (_c = (_b = ch.rows[0]) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null;
                let sessionId = null;
                if (channelDbId) {
                    const sess = yield pool.query(`SELECT id FROM sessions
             WHERE channel_id = $1
               AND now() BETWEEN starts_at AND COALESCE(ends_at, now() + interval '100 years')
               AND status IN ('scheduled','live')
             ORDER BY starts_at DESC
             LIMIT 1`, [channelDbId]);
                    sessionId = (_e = (_d = sess.rows[0]) === null || _d === void 0 ? void 0 : _d.id) !== null && _e !== void 0 ? _e : null;
                }
                const result = sessionId
                    ? yield pool.query(`SELECT m.id, m.content, m.created_at, u.username
               FROM messages m
               JOIN users u ON u.id = m.user_id
               WHERE m.session_id = $1
                 AND m.created_at > NOW() - INTERVAL '1 hour'
               ORDER BY m.created_at ASC`, [sessionId])
                    : channelDbId
                        ? yield pool.query(`SELECT m.id, m.content, m.created_at, u.username
                 FROM messages m
                 JOIN users u ON u.id = m.user_id
                 WHERE m.channel_id = $1
                   AND m.created_at > NOW() - INTERVAL '1 hour'
                 ORDER BY m.created_at ASC`, [channelDbId])
                        : { rows: [] };
                socket.data = { channelSlug: channelId, channelDbId, sessionId };
                socket.emit("chatHistory", result.rows);
            }
            catch (err) {
                console.error("joinRoom error:", err);
                socket.emit("chatHistory", []);
            }
        }));
        socket.on("sendMessage", (_a) => __awaiter(this, [_a], void 0, function* ({ userId, message, channelId }) {
            var _b, _c, _d;
            try {
                if (!userId || !channelId || !(message === null || message === void 0 ? void 0 : message.trim()))
                    return;
                const u = yield pool.query("SELECT username FROM users WHERE id = $1", [userId]);
                if (u.rowCount === 0)
                    return;
                const username = u.rows[0].username;
                let { channelDbId, sessionId } = (_b = socket.data) !== null && _b !== void 0 ? _b : {};
                if (!channelDbId) {
                    const ch = yield pool.query("SELECT id FROM channels WHERE slug = $1", [channelId]);
                    channelDbId = (_d = (_c = ch.rows[0]) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null;
                }
                const ins = yield pool.query(`INSERT INTO messages (user_id, content, channel_id, session_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id, content, created_at`, [userId, message.trim(), channelDbId, sessionId !== null && sessionId !== void 0 ? sessionId : null]);
                io.to(channelId).emit("receiveMessage", {
                    id: ins.rows[0].id,
                    content: ins.rows[0].content,
                    created_at: ins.rows[0].created_at,
                    user: username,
                });
            }
            catch (err) {
                console.error("sendMessage error:", err);
            }
        }));
        socket.on("disconnect", () => {
            console.log(`User disconnected: ${socket.id}`);
        });
    });
}
