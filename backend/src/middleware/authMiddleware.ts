// src/middleware/authMiddleware.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import pool from "../db/pool";

export type UserGroup = 'super_admin' | 'network' | 'general_user';

export interface AuthRequest extends Request {
  userId?: number;
  userGroup?: UserGroup;
  user?: any;
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: number };
    req.userId = decoded.id;

    const result = await pool.query('SELECT user_group FROM users WHERE id = $1', [decoded.id]);
    if (result.rows.length > 0) {
      req.userGroup = result.rows[0].user_group as UserGroup;
    }

    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireGroup = (...allowedGroups: UserGroup[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userGroup || !allowedGroups.includes(req.userGroup)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
};
