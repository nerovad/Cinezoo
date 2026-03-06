import { Request, Response, NextFunction } from "express";


const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message, err.stack);
  res.status(500).json({ error: "Internal Server Error" });
};


export default errorHandler;
