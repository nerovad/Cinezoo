"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const rtmpController_1 = require("../controllers/rtmpController");
// Small wrapper so TS is happy with async controllers
const wrap = (fn) => (req, res, next) => {
    fn(req, res).catch(next);
};
const router = (0, express_1.Router)();
// POST /api/rtmp/auth  (nginx-rtmp on_publish hook)
router.post("/auth", wrap(rtmpController_1.verifyStreamKey));
exports.default = router;
