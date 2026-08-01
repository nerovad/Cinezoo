"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const errorHandler = (err, req, res, _next) => {
    console.error(`[ERROR] ${req.method} ${req.path}:`, err.message, err.stack);
    res.status(500).json({ error: "Internal Server Error" });
};
exports.default = errorHandler;
