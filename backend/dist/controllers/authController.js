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
exports.login = exports.register = void 0;
const express_validator_1 = require("express-validator");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const pool_1 = __importDefault(require("../db/pool"));
const register = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { email, username, password } = req.body;
        const hashedPassword = yield bcrypt_1.default.hash(password, 10);
        const result = yield pool_1.default.query("INSERT INTO users (email, username, password) VALUES ($1, $2, $3) RETURNING id, email, username", [email, username, hashedPassword]);
        res.json({ message: "User created successfully", user: result.rows[0] });
    }
    catch (error) {
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
});
exports.register = register;
const login = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, username, password } = req.body;
        if (!email && !username) {
            return res.status(400).json({ error: "Email or Username is required" });
        }
        const result = yield pool_1.default.query("SELECT * FROM users WHERE email = COALESCE($1, email) OR username = COALESCE($2, username) LIMIT 1", [email, username]);
        const user = result.rows[0];
        if (!user || !(yield bcrypt_1.default.compare(password, user.password))) {
            return res.status(400).json({ error: "Invalid credentials" });
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });
        res.json({ token });
    }
    catch (error) {
        next(error);
    }
});
exports.login = login;
