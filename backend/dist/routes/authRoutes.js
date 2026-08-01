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
// src/routes/authRoutes.ts
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const pool_1 = __importDefault(require("../db/pool")); // ✅ default import
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// POST /api/auth/register
router.post("/register", [
    (0, express_validator_1.body)("email").isEmail().withMessage("Enter a valid email"),
    (0, express_validator_1.body)("username").notEmpty().withMessage("Username is required"),
    (0, express_validator_1.body)("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters long"),
], (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return; // ✅ avoid returning Response type
        }
        const { email, username, password } = req.body;
        const hashedPassword = yield bcrypt_1.default.hash(password, 10);
        const result = yield pool_1.default.query("INSERT INTO users (email, username, password) VALUES ($1, $2, $3) RETURNING id, email, username", [email, username, hashedPassword]);
        res.status(201).json({ message: "User created successfully", user: result.rows[0] });
        return; // ✅
    }
    catch (error) {
        if (error.code === '23505') {
            if (error.constraint === 'users_email_key') {
                res.status(400).json({ error: "Email already in use" });
                return;
            }
            if (error.constraint === 'users_username_key') {
                res.status(400).json({ error: "Username already taken" });
                return;
            }
        }
        next(error);
    }
}));
// POST /api/auth/login
router.post("/login", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, username, password } = req.body;
        if (!email && !username) {
            res.status(400).json({ error: "Email or Username is required" });
            return;
        }
        const result = yield pool_1.default.query("SELECT * FROM users WHERE email = $1 OR username = $2 LIMIT 1", [email || null, username || null]);
        const user = result.rows[0];
        if (!user) {
            res.status(400).json({ error: "Invalid credentials" });
            return; // ✅
        }
        const isMatch = yield bcrypt_1.default.compare(password, user.password);
        if (!isMatch) {
            res.status(400).json({ error: "Invalid credentials" });
            return; // ✅
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "30d" });
        res.json({ token });
        return; // ✅
    }
    catch (error) {
        next(error);
    }
}));
// POST /api/auth/refresh - Issue a new token if the current one is still valid
router.post("/refresh", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) {
            res.status(401).json({ error: "Token required" });
            return;
        }
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        // Verify user still exists
        const result = yield pool_1.default.query("SELECT id FROM users WHERE id = $1", [decoded.id]);
        if (result.rows.length === 0) {
            res.status(401).json({ error: "User not found" });
            return;
        }
        // Issue a fresh 30-day token
        const newToken = jsonwebtoken_1.default.sign({ id: decoded.id }, process.env.JWT_SECRET, { expiresIn: "30d" });
        res.json({ token: newToken });
        return;
    }
    catch (error) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
    }
}));
// POST /api/auth/forgot-password
router.post("/forgot-password", [(0, express_validator_1.body)("email").isEmail().withMessage("Enter a valid email")], (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { email } = req.body;
        const result = yield pool_1.default.query("SELECT id, email FROM users WHERE email = $1 LIMIT 1", [email]);
        // Always return success to avoid leaking whether the email exists
        if (result.rows.length === 0) {
            res.json({ message: "If that email is registered, a temporary password has been sent." });
            return;
        }
        const user = result.rows[0];
        // Generate a random temporary password
        const tempPassword = crypto_1.default.randomBytes(8).toString("hex");
        const hashedPassword = yield bcrypt_1.default.hash(tempPassword, 10);
        yield pool_1.default.query("UPDATE users SET password = $1 WHERE id = $2", [
            hashedPassword,
            user.id,
        ]);
        // Send email
        const transporter = nodemailer_1.default.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
        yield transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: user.email,
            subject: "Cinezoo - Temporary Password",
            text: `Your temporary password is: ${tempPassword}\n\nPlease log in and change your password immediately.`,
            html: `<p>Your temporary password is: <strong>${tempPassword}</strong></p><p>Please log in and change your password immediately.</p>`,
        });
        res.json({ message: "If that email is registered, a temporary password has been sent." });
        return;
    }
    catch (error) {
        next(error);
    }
}));
// POST /api/auth/change-password (authenticated)
router.post("/change-password", authMiddleware_1.authenticateToken, [
    (0, express_validator_1.body)("currentPassword").notEmpty().withMessage("Current password is required"),
    (0, express_validator_1.body)("newPassword").isLength({ min: 6 }).withMessage("New password must be at least 6 characters long"),
], (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { currentPassword, newPassword } = req.body;
        const result = yield pool_1.default.query("SELECT password FROM users WHERE id = $1", [req.userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const isMatch = yield bcrypt_1.default.compare(currentPassword, result.rows[0].password);
        if (!isMatch) {
            res.status(400).json({ error: "Current password is incorrect" });
            return;
        }
        const hashedPassword = yield bcrypt_1.default.hash(newPassword, 10);
        yield pool_1.default.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, req.userId]);
        res.json({ message: "Password updated successfully" });
        return;
    }
    catch (error) {
        next(error);
    }
}));
exports.default = router;
