"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const playoutController_1 = require("../controllers/playoutController");
// Small wrapper so TS is happy with async controllers
const wrap = (fn) => (req, res, next) => {
    fn(req, res).catch(next);
};
const router = (0, express_1.Router)();
// POST /api/playout/asrun  (ffplayout task-script hook, auth: X-Stream-Key)
router.post("/asrun", wrap(playoutController_1.recordAsRun));
// GET /api/playout/pl/:token/:year/:month/:date  (ffplayout playlist pull)
// e.g. /api/playout/pl/<token>/2026/07/2026-07-21.json
router.get("/pl/:token/:year/:month/:date", wrap(playoutController_1.getPlaylist));
exports.default = router;
