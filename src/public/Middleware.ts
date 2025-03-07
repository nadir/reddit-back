import { Request, Response, NextFunction } from "express";
const { validationResult } = require("express-validator");
class Middleware {
  static isValidBody = (
    req: Request & Partial<{ user: any }>,
    res: Response,
    next: NextFunction
  ) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    } else {
      next();
    }
  };

}

export default Middleware;
