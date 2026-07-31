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
exports.getProfile = getProfile;
exports.getPublicProfile = getPublicProfile;
exports.updateBio = updateBio;
exports.updateAvatar = updateAvatar;
exports.getMyFilms = getMyFilms;
exports.getMyAwards = getMyAwards;
exports.getMyCompanies = getMyCompanies;
const pool_1 = __importDefault(require("../db/pool"));
function getProfile(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const userId = req.userId;
            // Get user basic info
            const userQuery = `SELECT id, username, email, user_group FROM users WHERE id = $1`;
            const userResult = yield pool_1.default.query(userQuery, [userId]);
            if (userResult.rows.length === 0) {
                res.status(404).json({ error: "User not found" });
                return;
            }
            const user = userResult.rows[0];
            // Get profile data from user_profiles table
            const profileQuery = `SELECT * FROM user_profiles WHERE user_id = $1`;
            const profileResult = yield pool_1.default.query(profileQuery, [userId]);
            const profile = profileResult.rows[0] || {};
            // Get socials
            const socialsQuery = `SELECT label, url FROM user_profile_socials WHERE user_id = $1 ORDER BY position`;
            const socialsResult = yield pool_1.default.query(socialsQuery, [userId]);
            const socials = socialsResult.rows;
            // Get stats
            const statsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM follows WHERE following_id = $1) as followers_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = $1) as following_count,
        (SELECT COUNT(*) FROM user_profile_film_links WHERE user_id = $1) as films_count,
        (SELECT COUNT(*) FROM user_profile_awards WHERE user_id = $1) as awards_count
    `;
            const statsResult = yield pool_1.default.query(statsQuery, [userId]);
            const stats = statsResult.rows[0] || {};
            const profileData = {
                id: user.id.toString(),
                handle: profile.handle || `@${user.username}`,
                displayName: profile.handle || `@${user.username}`, // Use @username as display name
                userGroup: user.user_group || 'general_user',
                bannerUrl: profile.banner_url,
                avatarUrl: profile.avatar_url,
                bio: profile.bio,
                location: profile.location,
                website: profile.website,
                socials: socials,
                stats: {
                    followers: parseInt(stats.followers_count) || 0,
                    following: parseInt(stats.following_count) || 0,
                    films: parseInt(stats.films_count) || 0,
                    awards: parseInt(stats.awards_count) || 0
                }
            };
            res.json(profileData);
        }
        catch (error) {
            console.error('Get profile error:', error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function getPublicProfile(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { handle } = req.params;
            // Strip leading @ if present
            const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;
            // Look up user by handle in user_profiles or by username in users
            const userQuery = `
      SELECT u.id, u.username, up.handle, up.banner_url, up.avatar_url, up.bio, up.location, up.website
      FROM users u
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE u.username ILIKE $1 OR up.handle ILIKE $2
      LIMIT 1
    `;
            const userResult = yield pool_1.default.query(userQuery, [cleanHandle, `@${cleanHandle}`]);
            if (userResult.rows.length === 0) {
                res.status(404).json({ error: "User not found" });
                return;
            }
            const user = userResult.rows[0];
            const userId = user.id;
            // Get stats
            const statsQuery = `
      SELECT
        (SELECT COUNT(*) FROM follows WHERE following_id = $1) as followers_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = $1) as following_count,
        (SELECT COUNT(*) FROM user_profile_film_links WHERE user_id = $1) as films_count,
        (SELECT COUNT(*) FROM user_profile_awards WHERE user_id = $1) as awards_count
    `;
            const statsResult = yield pool_1.default.query(statsQuery, [userId]);
            const stats = statsResult.rows[0] || {};
            // Get channels
            const channelsQuery = `SELECT id, name, display_name, channel_number, slug, description, thumbnail FROM channels WHERE owner_id = $1 ORDER BY channel_number`;
            const channelsResult = yield pool_1.default.query(channelsQuery, [userId]);
            const profileData = {
                id: userId.toString(),
                handle: user.handle || `@${user.username}`,
                displayName: user.handle || `@${user.username}`,
                bannerUrl: user.banner_url,
                avatarUrl: user.avatar_url,
                bio: user.bio,
                location: user.location,
                website: user.website,
                stats: {
                    followers: parseInt(stats.followers_count) || 0,
                    following: parseInt(stats.following_count) || 0,
                    films: parseInt(stats.films_count) || 0,
                    awards: parseInt(stats.awards_count) || 0
                },
                channels: channelsResult.rows.map((ch) => ({
                    id: ch.id.toString(),
                    name: ch.name,
                    display_name: ch.display_name,
                    channel_number: ch.channel_number,
                    slug: ch.slug,
                    description: ch.description,
                    thumbnail: ch.thumbnail
                }))
            };
            res.json(profileData);
        }
        catch (error) {
            console.error('Get public profile error:', error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function updateBio(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const userId = req.userId;
            const { bio } = req.body;
            // Update or insert into user_profiles table
            yield pool_1.default.query(`INSERT INTO user_profiles (user_id, bio, updated_at) 
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) 
       DO UPDATE SET bio = $2, updated_at = CURRENT_TIMESTAMP`, [userId, bio]);
            res.json({ message: "Bio updated successfully" });
        }
        catch (error) {
            console.error('Update bio error:', error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function updateAvatar(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const userId = req.userId;
            const { avatarUrl } = req.body;
            yield pool_1.default.query(`INSERT INTO user_profiles (user_id, avatar_url, updated_at) 
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) 
       DO UPDATE SET avatar_url = $2, updated_at = CURRENT_TIMESTAMP`, [userId, avatarUrl]);
            res.json({ message: "Avatar updated successfully" });
        }
        catch (error) {
            console.error('Update avatar error:', error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function getMyFilms(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const userId = req.userId;
            // Use user_profile_film_links since that's what you have
            const result = yield pool_1.default.query("SELECT * FROM user_profile_film_links WHERE user_id = $1 ORDER BY position, id DESC", [userId]);
            const films = result.rows.map(f => ({
                id: f.id.toString(),
                title: f.title,
                thumbnail: f.thumbnail,
                duration: f.duration,
                synopsis: f.synopsis,
                url: f.url,
                provider: f.provider
            }));
            res.json(films);
        }
        catch (error) {
            console.error('Get films error:', error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function getMyAwards(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const userId = req.userId;
            const result = yield pool_1.default.query("SELECT * FROM user_profile_awards WHERE user_id = $1 ORDER BY position, year DESC, id DESC", [userId]);
            const awards = result.rows.map(a => ({
                id: a.id.toString(),
                name: a.name,
                year: a.year,
                work: a.work,
                position: a.position
            }));
            res.json(awards);
        }
        catch (error) {
            console.error('Get awards error:', error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
function getMyCompanies(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const userId = req.userId;
            const result = yield pool_1.default.query("SELECT * FROM user_profile_companies WHERE user_id = $1 ORDER BY position, id DESC", [userId]);
            const companies = result.rows.map(c => ({
                id: c.id.toString(),
                name: c.name,
                role: c.role,
                website: c.website,
                position: c.position
            }));
            res.json(companies);
        }
        catch (error) {
            console.error('Get companies error:', error);
            res.status(500).json({ error: "Server error" });
        }
    });
}
