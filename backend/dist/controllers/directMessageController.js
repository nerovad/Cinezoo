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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConversations = getConversations;
exports.getMessages = getMessages;
exports.markAsRead = markAsRead;
exports.searchUsers = searchUsers;
exports.sendMessage = sendMessage;
const pool_1 = __importDefault(require("../db/pool"));
function getConversations(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const userId = req.userId;
            // Get all conversations with the other user's info, last message, and unread count
            const result = yield pool_1.default.query(`WITH conversations AS (
        SELECT
          CASE
            WHEN sender_id = $1 THEN receiver_id
            ELSE sender_id
          END AS other_user_id,
          content,
          created_at,
          read,
          sender_id
        FROM direct_messages
        WHERE sender_id = $1 OR receiver_id = $1
      ),
      latest_messages AS (
        SELECT DISTINCT ON (other_user_id)
          other_user_id,
          content AS last_message,
          created_at AS last_message_time
        FROM conversations
        ORDER BY other_user_id, created_at DESC
      ),
      unread_counts AS (
        SELECT
          sender_id AS other_user_id,
          COUNT(*) AS unread_count
        FROM direct_messages
        WHERE receiver_id = $1 AND read = false
        GROUP BY sender_id
      )
      SELECT
        u.id AS user_id,
        COALESCE(up.handle, '@' || u.username) AS user_handle,
        up.avatar_url AS user_avatar,
        lm.last_message,
        lm.last_message_time,
        COALESCE(uc.unread_count, 0) AS unread_count
      FROM latest_messages lm
      JOIN users u ON u.id = lm.other_user_id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      LEFT JOIN unread_counts uc ON uc.other_user_id = lm.other_user_id
      ORDER BY lm.last_message_time DESC`, [userId]);
            const conversations = result.rows.map(row => ({
                userId: row.user_id.toString(),
                userHandle: row.user_handle,
                userAvatar: row.user_avatar,
                lastMessage: row.last_message,
                lastMessageTime: row.last_message_time,
                unreadCount: parseInt(row.unread_count) || 0
            }));
            res.json(conversations);
        }
        catch (error) {
            console.error("Get conversations error:", error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function getMessages(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const userId = req.userId;
            const otherUserId = parseInt(req.params.userId);
            if (isNaN(otherUserId)) {
                res.status(400).json({ error: "Invalid user ID" });
                return;
            }
            const result = yield pool_1.default.query(`SELECT
        dm.id,
        dm.sender_id,
        COALESCE(sp.handle, '@' || su.username) AS sender_handle,
        sp.avatar_url AS sender_avatar,
        dm.receiver_id,
        dm.content,
        dm.created_at,
        dm.expires_at,
        dm.read
      FROM direct_messages dm
      JOIN users su ON su.id = dm.sender_id
      LEFT JOIN user_profiles sp ON sp.user_id = dm.sender_id
      WHERE (dm.sender_id = $1 AND dm.receiver_id = $2)
         OR (dm.sender_id = $2 AND dm.receiver_id = $1)
      ORDER BY dm.created_at ASC`, [userId, otherUserId]);
            const messages = result.rows.map(row => ({
                id: row.id.toString(),
                senderId: row.sender_id === userId ? "me" : row.sender_id.toString(),
                senderHandle: row.sender_handle,
                senderAvatar: row.sender_avatar,
                receiverId: row.receiver_id === userId ? "me" : row.receiver_id.toString(),
                content: row.content,
                createdAt: row.created_at,
                expiresAt: row.expires_at,
                read: row.read
            }));
            res.json(messages);
        }
        catch (error) {
            console.error("Get messages error:", error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function markAsRead(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const userId = req.userId;
            const senderId = parseInt(req.params.userId);
            if (isNaN(senderId)) {
                res.status(400).json({ error: "Invalid user ID" });
                return;
            }
            yield pool_1.default.query(`UPDATE direct_messages
       SET read = true
       WHERE sender_id = $1 AND receiver_id = $2 AND read = false`, [senderId, userId]);
            res.json({ message: "Messages marked as read" });
        }
        catch (error) {
            console.error("Mark as read error:", error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function searchUsers(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const userId = req.userId;
            const query = req.query.q;
            if (!query || query.length < 2) {
                res.json([]);
                return;
            }
            const result = yield pool_1.default.query(`SELECT u.id, u.username, COALESCE(up.handle, '@' || u.username) AS handle, up.avatar_url
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id != $1
         AND (u.username ILIKE $2 OR up.handle ILIKE $2)
       LIMIT 10`, [userId, `%${query}%`]);
            const users = result.rows.map(row => ({
                userId: row.id.toString(),
                userHandle: row.handle,
                userAvatar: row.avatar_url
            }));
            res.json(users);
        }
        catch (error) {
            console.error("Search users error:", error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function sendMessage(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const senderId = req.userId;
            const { receiverId, content } = req.body;
            if (!receiverId || !content) {
                res.status(400).json({ error: "receiverId and content are required" });
                return;
            }
            const receiverIdNum = parseInt(receiverId);
            if (isNaN(receiverIdNum)) {
                res.status(400).json({ error: "Invalid receiver ID" });
                return;
            }
            if (receiverIdNum === senderId) {
                res.status(400).json({ error: "Cannot send message to yourself" });
                return;
            }
            // Verify receiver exists
            const userCheck = yield pool_1.default.query("SELECT id FROM users WHERE id = $1", [receiverIdNum]);
            if (userCheck.rows.length === 0) {
                res.status(404).json({ error: "Recipient not found" });
                return;
            }
            // Insert the message
            const result = yield pool_1.default.query(`INSERT INTO direct_messages (sender_id, receiver_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id, receiver_id, content, read, created_at, expires_at`, [senderId, receiverIdNum, content]);
            const msg = result.rows[0];
            // Get sender info
            const senderInfo = yield pool_1.default.query(`SELECT u.username, up.handle, up.avatar_url
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id = $1`, [senderId]);
            const sender = senderInfo.rows[0];
            res.status(201).json({
                id: msg.id.toString(),
                senderId: "me",
                senderHandle: sender.handle || `@${sender.username}`,
                senderAvatar: sender.avatar_url,
                receiverId: msg.receiver_id.toString(),
                content: msg.content,
                createdAt: msg.created_at,
                expiresAt: msg.expires_at,
                read: msg.read
            });
        }
        catch (error) {
            console.error("Send message error:", error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
