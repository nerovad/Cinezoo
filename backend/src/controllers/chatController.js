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
exports.getMessages = void 0;
const pool_1 = __importDefault(require("../../db/pool"));
const getMessages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { channelSlug, sessionId } = req.query;
        let result;
        if (sessionId) {
            result = yield pool_1.default.query(`SELECT m.id, m.content, m.created_at, u.username
FROM messages m
JOIN users u ON u.id = m.user_id
WHERE m.session_id = $1
ORDER BY m.created_at ASC`, [Number(sessionId)]);
        }
        else if (channelSlug) {
            result = yield pool_1.default.query(`SELECT m.id, m.content, m.created_at, u.username
FROM messages m
JOIN users u ON u.id = m.user_id
WHERE m.channel_id = (SELECT id FROM channels WHERE slug = $1)
ORDER BY m.created_at ASC`, [channelSlug]);
        }
        else {
            result = yield pool_1.default.query(`SELECT m.id, m.content, m.created_at, u.username
FROM messages m
JOIN users u ON u.id = m.user_id
ORDER BY m.created_at ASC`);
        }
        res.json(result.rows);
    }
    catch (err) {
        console.error("Error fetching messages:", err);
        res.status(500).json({ error: "Error fetching messages" });
    }
});
exports.getMessages = getMessages;
