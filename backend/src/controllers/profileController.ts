// src/controllers/profileController.ts
import { Response } from "express";
import pool from "../db/pool";
import { AuthRequest } from "../middleware/authMiddleware";

export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId;

    // Get user basic info
    const userQuery = `SELECT id, username, email, user_group FROM users WHERE id = $1`;
    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const user = userResult.rows[0];

    // Get profile data from user_profiles table
    const profileQuery = `SELECT * FROM user_profiles WHERE user_id = $1`;
    const profileResult = await pool.query(profileQuery, [userId]);
    const profile = profileResult.rows[0] || {};

    // Get socials
    const socialsQuery = `SELECT label, url FROM user_profile_socials WHERE user_id = $1 ORDER BY position`;
    const socialsResult = await pool.query(socialsQuery, [userId]);
    const socials = socialsResult.rows;

    // Get stats
    const statsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM follows WHERE following_id = $1) as followers_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = $1) as following_count,
        (SELECT COUNT(*) FROM user_profile_film_links WHERE user_id = $1) as films_count,
        (SELECT COUNT(*) FROM user_profile_awards WHERE user_id = $1) as awards_count
    `;
    const statsResult = await pool.query(statsQuery, [userId]);
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
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateBio(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId;
    const { bio } = req.body;

    // Update or insert into user_profiles table
    await pool.query(
      `INSERT INTO user_profiles (user_id, bio, updated_at) 
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) 
       DO UPDATE SET bio = $2, updated_at = CURRENT_TIMESTAMP`,
      [userId, bio]
    );

    res.json({ message: "Bio updated successfully" });
  } catch (error) {
    console.error('Update bio error:', error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateAvatar(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId;
    const { avatarUrl } = req.body;

    await pool.query(
      `INSERT INTO user_profiles (user_id, avatar_url, updated_at) 
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) 
       DO UPDATE SET avatar_url = $2, updated_at = CURRENT_TIMESTAMP`,
      [userId, avatarUrl]
    );

    res.json({ message: "Avatar updated successfully" });
  } catch (error) {
    console.error('Update avatar error:', error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getMyFilms(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId;

    // Use user_profile_film_links since that's what you have
    const result = await pool.query(
      "SELECT * FROM user_profile_film_links WHERE user_id = $1 ORDER BY position, id DESC",
      [userId]
    );

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
  } catch (error) {
    console.error('Get films error:', error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getMyAwards(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId;

    const result = await pool.query(
      "SELECT * FROM user_profile_awards WHERE user_id = $1 ORDER BY position, year DESC, id DESC",
      [userId]
    );

    const awards = result.rows.map(a => ({
      id: a.id.toString(),
      name: a.name,
      year: a.year,
      work: a.work,
      position: a.position
    }));

    res.json(awards);
  } catch (error) {
    console.error('Get awards error:', error);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getMyCompanies(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId;

    const result = await pool.query(
      "SELECT * FROM user_profile_companies WHERE user_id = $1 ORDER BY position, id DESC",
      [userId]
    );

    const companies = result.rows.map(c => ({
      id: c.id.toString(),
      name: c.name,
      role: c.role,
      website: c.website,
      position: c.position
    }));

    res.json(companies);
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({ error: "Server error" });
  }
}
