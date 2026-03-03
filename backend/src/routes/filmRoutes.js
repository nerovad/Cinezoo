"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const filmController_1 = require("../controllers/filmController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const profileController_1 = require("../controllers/profileController");
const router = express_1.default.Router();
router.get("/mine", authMiddleware_1.authenticateToken, (req, res, next) => {
    (0, profileController_1.getMyFilms)(req, res).catch(next);
});
// POST /api/films
router.post("/", (req, res, next) => {
    (0, filmController_1.createFilm)(req, res, next);
});
// GET /api/films
router.get("/", (req, res, next) => {
    (0, filmController_1.listFilms)(req, res, next);
});
exports.default = router;
