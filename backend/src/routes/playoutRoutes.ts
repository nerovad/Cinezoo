import { Router, RequestHandler } from "express";
import { recordAsRun, getPlaylist } from "../controllers/playoutController";

// Small wrapper so TS is happy with async controllers
const wrap =
  (fn: (...args: any[]) => Promise<void>): RequestHandler =>
    (req, res, next) => {
      fn(req, res).catch(next);
    };

const router = Router();

// POST /api/playout/asrun  (ffplayout task-script hook, auth: X-Stream-Key)
router.post("/asrun", wrap(recordAsRun));

// GET /api/playout/pl/:token/:year/:month/:date  (ffplayout playlist pull)
// e.g. /api/playout/pl/<token>/2026/07/2026-07-21.json
router.get("/pl/:token/:year/:month/:date", wrap(getPlaylist));

export default router;
