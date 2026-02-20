import path from "path";
import dotenv from "dotenv";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import setupSocket from "./sockets/chatSocket"; // ✅ fixed
import authRoutes from "./routes/authRoutes";
import chatRoutes from "./routes/chatRoutes";
import directMessageRoutes from "./routes/directMessageRoutes";
import voteRoutes from "./routes/voteRoutes";
import profileRoutes from "./routes/profileRoutes";
import errorHandler from "./middleware/errorHandler"; // ✅ fixed
import pool from "../db/pool";
import channelRoutes from "./routes/channelRoutes";
import festivalRoutes from "./routes/festivalRoutes";
import filmRoutes from "./routes/filmRoutes";
import bodyParser from "body-parser";
import rtmpRoutes from "./routes/rtmpRoutes";
import awardRoutes from "./routes/awardRoutes";
import companyRoutes from "./routes/companyRoutes";
import tournamentRoutes from "./routes/tournamentRoutes";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:5173"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 4000;

// Middleware
app.use(express.json({ limit: '10mb' })); // Increased limit for base64 images
app.use(cors());

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use(express.urlencoded({ extended: false }));
app.use("/api/auth", authRoutes);
app.use("/api/messages", directMessageRoutes);
app.use("/api/messages", chatRoutes);
app.use("/api", voteRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/channels", channelRoutes);
app.use("/api/festivals", festivalRoutes);  // sessions control
app.use("/api/films", filmRoutes);
app.use("/api/awards", awardRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api", tournamentRoutes);
app.use("/api/rtmp", rtmpRoutes);
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());

// Error Handler
app.use(errorHandler);

// Socket Setup
setupSocket(io, pool);

// Cleanup old messages every 10 minutes
const cleanupOldMessages = async () => {
  try {
    const result = await pool.query(
      `DELETE FROM messages WHERE created_at < NOW() - INTERVAL '1 hour'`
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`🧹 Cleaned up ${result.rowCount} old messages`);
    }

    // Cleanup expired direct messages
    const dmResult = await pool.query(
      `DELETE FROM direct_messages WHERE expires_at < NOW()`
    );
    if (dmResult.rowCount && dmResult.rowCount > 0) {
      console.log(`🧹 Cleaned up ${dmResult.rowCount} expired direct messages`);
    }
  } catch (err) {
    console.error("Error cleaning up old messages:", err);
  }
};

// Run cleanup every 10 minutes
setInterval(cleanupOldMessages, 10 * 60 * 1000);

// Run cleanup once on startup
cleanupOldMessages();

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
