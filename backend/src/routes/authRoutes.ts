// src/routes/authRoutes.ts
import express, { Request, Response, NextFunction } from "express";
import { body, validationResult } from "express-validator";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../db/pool"; // ✅ default import

const router = express.Router();

// POST /api/auth/register
router.post(
  "/register",
  [
    body("email").isEmail().withMessage("Enter a valid email"),
    body("username").notEmpty().withMessage("Username is required"),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters long"),
  ],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return; // ✅ avoid returning Response type
      }

      const { email, username, password } = req.body;
      const hashedPassword = await bcrypt.hash(password, 10);

      const result = await pool.query(
        "INSERT INTO users (email, username, password) VALUES ($1, $2, $3) RETURNING id, email, username",
        [email, username, hashedPassword]
      );

      res.status(201).json({ message: "User created successfully", user: result.rows[0] });
      return; // ✅
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/login
router.post(
  "/login",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, username, password } = req.body;

      if (!email && !username) {
        res.status(400).json({ error: "Email or Username is required" });
        return; // ✅
      }

      const result = await pool.query(
        "SELECT * FROM users WHERE email = COALESCE($1, email) OR username = COALESCE($2, username) LIMIT 1",
        [email, username]
      );

      const user = result.rows[0];
      if (!user) {
        res.status(400).json({ error: "Invalid credentials" });
        return; // ✅
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        res.status(400).json({ error: "Invalid credentials" });
        return; // ✅
      }

      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET as string, { expiresIn: "1h" });
      res.json({ token });
      return; // ✅
    } catch (error) {
      next(error);
    }
  }
);

export default router;
