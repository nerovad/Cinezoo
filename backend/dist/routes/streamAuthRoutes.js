"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/streamAuthRoutes.ts
const express_1 = __importDefault(require("express"));
const streamAuthController_1 = require("../controllers/streamAuthController");
const router = express_1.default.Router();
router.post("/auth", streamAuthController_1.verifyStreamKey);
exports.default = router;
