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
exports.verifyStreamKey = verifyStreamKey;
const pool_1 = __importDefault(require("../db/pool"));
/**
 * nginx-rtmp on_publish auth hook.
 * nginx sends application/x-www-form-urlencoded:
 *   name=<stream_key>&app=live
 */
function verifyStreamKey(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        try {
            const key = String((_d = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : (_c = req.query) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "").trim();
            const app = String((_h = (_f = (_e = req.body) === null || _e === void 0 ? void 0 : _e.app) !== null && _f !== void 0 ? _f : (_g = req.query) === null || _g === void 0 ? void 0 : _g.app) !== null && _h !== void 0 ? _h : "live").trim();
            if (!key) {
                res.status(403).send("missing key");
                return;
            }
            // Optional: ensure app matches what you expect
            if (app && app !== "live") {
                res.status(403).send("invalid app");
                return;
            }
            const { rows } = yield pool_1.default.query("SELECT 1 FROM channels WHERE stream_key = $1 LIMIT 1", [key]);
            if (rows.length === 0) {
                res.status(403).send("invalid key");
                return;
            }
            // IMPORTANT: nginx-rtmp expects a 2xx to allow publish
            res.status(200).send("OK");
        }
        catch (err) {
            console.error("verifyStreamKey error:", err);
            // non-2xx will reject the publish
            res.status(500).send("auth error");
        }
    });
}
