"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const festivalController_1 = require("../controllers/festivalController");
const router = express_1.default.Router();
// POST /api/festivals  (create a session)
router.post("/", (req, res, next) => {
    (0, festivalController_1.createSession)(req, res, next);
});
// POST /api/festivals/:sessionId/start
router.post("/:sessionId/start", (req, res, next) => {
    (0, festivalController_1.startSession)(req, res, next);
});
// POST /api/festivals/:sessionId/close
router.post("/:sessionId/close", (req, res, next) => {
    (0, festivalController_1.closeSession)(req, res, next);
});
// POST /api/festivals/:sessionId/entries  (add film to lineup)
router.post("/:sessionId/entries", (req, res, next) => {
    (0, festivalController_1.addEntry)(req, res, next);
});
// GET /api/festivals/:sessionId/lineup
router.get("/:sessionId/lineup", (req, res, next) => {
    (0, festivalController_1.getLineup)(req, res, next);
});
exports.default = router;
