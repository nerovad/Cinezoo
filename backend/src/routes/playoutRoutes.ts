import { Router, RequestHandler } from "express";
import { recordAsRun } from "../controllers/playoutController";

// Small wrapper so TS is happy with async controllers
const wrap =
  (fn: (...args: any[]) => Promise<void>): RequestHandler =>
    (req, res, next) => {
      fn(req, res).catch(next);
    };

const router = Router();

// POST /api/playout/asrun  (ffplayout task-script hook, auth: X-Stream-Key)
router.post("/asrun", wrap(recordAsRun));

export default router;
