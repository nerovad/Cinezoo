import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../db/pool";

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users (email, username, password) VALUES ($1, $2, $3) RETURNING id, email, username",
      [email, username, hashedPassword]
    );

    res.json({ message: "User created successfully", user: result.rows[0] });
  } catch (error: any) {
    // Check for unique constraint violations
    if (error.code === '23505') {
      if (error.constraint === 'users_email_key') {
        return res.status(400).json({ error: "Email already in use" });
      }
      if (error.constraint === 'users_username_key') {
        return res.status(400).json({ error: "Username already taken" });
      }
    }
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, username, password } = req.body;


    if (!email && !username) {
      return res.status(400).json({ error: "Email or Username is required" });
    }


    const result = await pool.query(
      "SELECT * FROM users WHERE email = COALESCE($1, email) OR username = COALESCE($2, username) LIMIT 1",
      [email, username]
    );


    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: "Invalid credentials" });
    }


    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET as string, { expiresIn: "1h" });
    res.json({ token });
  } catch (error) {
    next(error);
  }
};
