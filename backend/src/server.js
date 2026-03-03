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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const socket_io_1 = require("socket.io");
const chatSocket_1 = __importDefault(require("./sockets/chatSocket")); // ✅ fixed
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const chatRoutes_1 = __importDefault(require("./routes/chatRoutes"));
const directMessageRoutes_1 = __importDefault(require("./routes/directMessageRoutes"));
const voteRoutes_1 = __importDefault(require("./routes/voteRoutes"));
const profileRoutes_1 = __importDefault(require("./routes/profileRoutes"));
const errorHandler_1 = __importDefault(require("./middleware/errorHandler")); // ✅ fixed
const pool_1 = __importDefault(require("../db/pool"));
const channelRoutes_1 = __importDefault(require("./routes/channelRoutes"));
const festivalRoutes_1 = __importDefault(require("./routes/festivalRoutes"));
const filmRoutes_1 = __importDefault(require("./routes/filmRoutes"));
const body_parser_1 = __importDefault(require("body-parser"));
const rtmpRoutes_1 = __importDefault(require("./routes/rtmpRoutes"));
const awardRoutes_1 = __importDefault(require("./routes/awardRoutes"));
const companyRoutes_1 = __importDefault(require("./routes/companyRoutes"));
const tournamentRoutes_1 = __importDefault(require("./routes/tournamentRoutes"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, "../../.env") });
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: ((_a = process.env.CORS_ORIGIN) === null || _a === void 0 ? void 0 : _a.split(",")) || ["http://localhost:5173"],
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
    },
});
const PORT = process.env.PORT || 4000;
// Middleware
app.use(express_1.default.json({ limit: '10mb' })); // Increased limit for base64 images
app.use((0, cors_1.default)());
// Serve uploaded files
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../uploads')));
// Routes
app.use(express_1.default.urlencoded({ extended: false }));
app.use("/api/auth", authRoutes_1.default);
app.use("/api/messages", directMessageRoutes_1.default);
app.use("/api/messages", chatRoutes_1.default);
app.use("/api", voteRoutes_1.default);
app.use("/api/profile", profileRoutes_1.default);
app.use("/api/channels", channelRoutes_1.default);
app.use("/api/festivals", festivalRoutes_1.default); // sessions control
app.use("/api/films", filmRoutes_1.default);
app.use("/api/awards", awardRoutes_1.default);
app.use("/api/companies", companyRoutes_1.default);
app.use("/api", tournamentRoutes_1.default);
app.use("/api/rtmp", rtmpRoutes_1.default);
app.use(body_parser_1.default.urlencoded({ extended: false }));
app.use(express_1.default.json());
app.use((0, cors_1.default)());
// Error Handler
app.use(errorHandler_1.default);
// Socket Setup
(0, chatSocket_1.default)(io, pool_1.default);
// Cleanup old messages every 10 minutes
const cleanupOldMessages = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield pool_1.default.query(`DELETE FROM messages WHERE created_at < NOW() - INTERVAL '1 hour'`);
        if (result.rowCount && result.rowCount > 0) {
            console.log(`🧹 Cleaned up ${result.rowCount} old messages`);
        }
        // Cleanup expired direct messages
        const dmResult = yield pool_1.default.query(`DELETE FROM direct_messages WHERE expires_at < NOW()`);
        if (dmResult.rowCount && dmResult.rowCount > 0) {
            console.log(`🧹 Cleaned up ${dmResult.rowCount} expired direct messages`);
        }
    }
    catch (err) {
        console.error("Error cleaning up old messages:", err);
    }
});
// Run cleanup every 10 minutes
setInterval(cleanupOldMessages, 10 * 60 * 1000);
// Run cleanup once on startup
cleanupOldMessages();
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
