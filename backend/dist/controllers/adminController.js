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
exports.listAllChannels = listAllChannels;
exports.adminUpdateChannel = adminUpdateChannel;
exports.adminDeleteChannel = adminDeleteChannel;
exports.listUsers = listUsers;
exports.deleteUser = deleteUser;
exports.adminGetChannelAnalytics = adminGetChannelAnalytics;
exports.updateUserGroup = updateUserGroup;
const pool_1 = __importDefault(require("../db/pool"));
const channelController_1 = require("./channelController");
const VALID_GROUPS = ['super_admin', 'network', 'general_user'];
/* ==================== Channel Management ==================== */
function listAllChannels(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const result = yield pool_1.default.query(`SELECT c.id, c.slug, c.name, c.display_name, c.channel_number, c.stream_url,
              c.tags, c.created_at, c.owner_id,
              u.username as owner_name
       FROM channels c
       LEFT JOIN users u ON c.owner_id = u.id
       ORDER BY c.id`);
            res.json(result.rows);
        }
        catch (error) {
            console.error('List channels error:', error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function adminUpdateChannel(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { channelId } = req.params;
            const { name, display_name, channel_number } = req.body;
            const result = yield pool_1.default.query(`UPDATE channels
       SET name = COALESCE($1, name),
           display_name = COALESCE($2, display_name),
           channel_number = COALESCE($3, channel_number)
       WHERE id = $4
       RETURNING id, slug, name, display_name, channel_number`, [name || null, display_name || null, channel_number !== null && channel_number !== void 0 ? channel_number : null, channelId]);
            if (result.rows.length === 0) {
                res.status(404).json({ error: "Channel not found" });
                return;
            }
            res.json(result.rows[0]);
        }
        catch (error) {
            console.error('Admin update channel error:', error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function adminDeleteChannel(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { channelId } = req.params;
            const client = yield pool_1.default.connect();
            try {
                yield client.query("BEGIN");
                // Check channel exists
                const ch = yield client.query(`SELECT id FROM channels WHERE id = $1`, [channelId]);
                if (ch.rows.length === 0) {
                    yield client.query("ROLLBACK");
                    res.status(404).json({ error: "Channel not found" });
                    return;
                }
                // Delete schedule items
                yield client.query(`DELETE FROM channel_schedule WHERE channel_id = $1`, [channelId]);
                // Delete tournament matchups for sessions in this channel
                yield client.query(`DELETE FROM tournament_matchups WHERE session_id IN (
           SELECT id FROM sessions WHERE channel_id = $1
         )`, [channelId]);
                // Delete session entries
                yield client.query(`DELETE FROM session_entries WHERE session_id IN (
           SELECT id FROM sessions WHERE channel_id = $1
         )`, [channelId]);
                // Delete sessions
                yield client.query(`DELETE FROM sessions WHERE channel_id = $1`, [channelId]);
                // Delete the channel
                yield client.query(`DELETE FROM channels WHERE id = $1`, [channelId]);
                yield client.query("COMMIT");
                res.json({ success: true });
            }
            catch (err) {
                yield client.query("ROLLBACK");
                throw err;
            }
            finally {
                client.release();
            }
        }
        catch (error) {
            console.error('Admin delete channel error:', error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function listUsers(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const result = yield pool_1.default.query(`SELECT id, username, email, user_group, created_at FROM users ORDER BY id`);
            res.json(result.rows);
        }
        catch (error) {
            console.error('List users error:', error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function deleteUser(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            // Prevent deleting yourself
            if (parseInt(userId) === req.userId) {
                res.status(400).json({ error: "Cannot delete your own account" });
                return;
            }
            // Prevent deleting the last super_admin
            const targetResult = yield pool_1.default.query(`SELECT user_group FROM users WHERE id = $1`, [userId]);
            if (targetResult.rows.length === 0) {
                res.status(404).json({ error: "User not found" });
                return;
            }
            if (targetResult.rows[0].user_group === 'super_admin') {
                const countResult = yield pool_1.default.query(`SELECT COUNT(*) FROM users WHERE user_group = 'super_admin' AND id != $1`, [userId]);
                if (parseInt(countResult.rows[0].count) === 0) {
                    res.status(400).json({ error: "Cannot delete the last super_admin" });
                    return;
                }
            }
            const client = yield pool_1.default.connect();
            try {
                yield client.query("BEGIN");
                // Get all channels owned by this user
                const userChannels = yield client.query(`SELECT id FROM channels WHERE owner_id = $1`, [userId]);
                const channelIds = userChannels.rows.map((r) => r.id);
                if (channelIds.length > 0) {
                    // Get all sessions in those channels
                    const userSessions = yield client.query(`SELECT id FROM sessions WHERE channel_id = ANY($1)`, [channelIds]);
                    const sessionIds = userSessions.rows.map((r) => r.id);
                    if (sessionIds.length > 0) {
                        // Get all session entries
                        const entries = yield client.query(`SELECT id FROM session_entries WHERE session_id = ANY($1)`, [sessionIds]);
                        const entryIds = entries.rows.map((r) => r.id);
                        if (entryIds.length > 0) {
                            // Clear winner_entry_id refs (no CASCADE on this FK)
                            yield client.query(`UPDATE matches SET winner_entry_id = NULL WHERE winner_entry_id = ANY($1)`, [entryIds]);
                            // Delete match_votes for matches in these sessions
                            yield client.query(`DELETE FROM match_votes WHERE match_id IN (SELECT id FROM matches WHERE session_id = ANY($1))`, [sessionIds]);
                            // Delete matches
                            yield client.query(`DELETE FROM matches WHERE session_id = ANY($1)`, [sessionIds]);
                            // Delete ratings
                            yield client.query(`DELETE FROM ratings WHERE session_id = ANY($1)`, [sessionIds]);
                            // Delete ballots
                            yield client.query(`DELETE FROM ballots WHERE session_id = ANY($1)`, [sessionIds]);
                            // Delete session entries
                            yield client.query(`DELETE FROM session_entries WHERE session_id = ANY($1)`, [sessionIds]);
                        }
                        // Delete sessions
                        yield client.query(`DELETE FROM sessions WHERE channel_id = ANY($1)`, [channelIds]);
                    }
                    // Delete channels
                    yield client.query(`DELETE FROM channels WHERE owner_id = $1`, [userId]);
                }
                // Delete the user (remaining FKs cascade or set null)
                yield client.query(`DELETE FROM users WHERE id = $1`, [userId]);
                yield client.query("COMMIT");
                res.json({ success: true });
            }
            catch (err) {
                yield client.query("ROLLBACK");
                throw err;
            }
            finally {
                client.release();
            }
        }
        catch (error) {
            console.error('Delete user error:', error);
            res.status(500).json({ error: (error === null || error === void 0 ? void 0 : error.message) || "Server error" });
        }
    });
}
function adminGetChannelAnalytics(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { channelId } = req.params;
        try {
            const chResult = yield pool_1.default.query(`SELECT c.id, c.display_name, c.name, c.channel_number, c.created_at, c.owner_id,
              u.username as owner_name
       FROM channels c
       LEFT JOIN users u ON c.owner_id = u.id
       WHERE c.id = $1`, [channelId]);
            if (chResult.rows.length === 0) {
                res.status(404).json({ error: "Channel not found" });
                return;
            }
            const channel = chResult.rows[0];
            const analytics = yield (0, channelController_1.buildChannelAnalytics)(parseInt(channelId));
            res.json(Object.assign({ channel }, analytics));
        }
        catch (error) {
            console.error("Admin channel analytics error:", error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function updateUserGroup(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const { userId } = req.params;
            const { userGroup } = req.body;
            if (!VALID_GROUPS.includes(userGroup)) {
                res.status(400).json({ error: `Invalid group. Must be one of: ${VALID_GROUPS.join(', ')}` });
                return;
            }
            // Prevent removing the last super_admin
            if (userGroup !== 'super_admin') {
                const countResult = yield pool_1.default.query(`SELECT COUNT(*) FROM users WHERE user_group = 'super_admin' AND id != $1`, [userId]);
                const targetResult = yield pool_1.default.query(`SELECT user_group FROM users WHERE id = $1`, [userId]);
                if (((_a = targetResult.rows[0]) === null || _a === void 0 ? void 0 : _a.user_group) === 'super_admin' && parseInt(countResult.rows[0].count) === 0) {
                    res.status(400).json({ error: "Cannot remove the last super_admin" });
                    return;
                }
            }
            const result = yield pool_1.default.query(`UPDATE users SET user_group = $1 WHERE id = $2 RETURNING id, username, email, user_group`, [userGroup, userId]);
            if (result.rows.length === 0) {
                res.status(404).json({ error: "User not found" });
                return;
            }
            res.json(result.rows[0]);
        }
        catch (error) {
            console.error('Update user group error:', error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
