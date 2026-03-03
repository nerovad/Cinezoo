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
const pool_1 = __importDefault(require("../../db/pool")); // ✅ default import
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
        next(error);
    }
}));
// POST /api/auth/login
router.post("/login", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, username, password } = req.body;
        if (!email && !username) {
            res.status(400).json({ error: "Email or Username is required" });
            return; // ✅
        }
        const result = yield pool_1.default.query("SELECT * FROM users WHERE email = COALESCE($1, email) OR username = COALESCE($2, username) LIMIT 1", [email, username]);
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
        const token = jsonwebtoken_1.default.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });
        res.json({ token });
        return; // ✅
    }
    catch (error) {
        next(error);
    }
}));
exports.default = router;
