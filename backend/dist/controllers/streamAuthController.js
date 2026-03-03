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
exports.verifyStreamKey = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const verifyStreamKey = (req, res, _next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const streamKey = (_a = req.body) === null || _a === void 0 ? void 0 : _a.name;
    if (!streamKey) {
        res.status(400).send("Missing stream key");
        return;
    }
    try {
        const { rowCount } = yield pool_1.default.query(`SELECT 1 FROM channels WHERE stream_key = $1 LIMIT 1`, [streamKey]);
        if (rowCount === 0) {
            res.status(403).send("Invalid stream key");
        }
        else {
            res.status(200).send("OK");
        }
    }
    catch (err) {
        console.error("Stream auth error:", err);
        res.status(500).send("Internal error");
    }
});
exports.verifyStreamKey = verifyStreamKey;
