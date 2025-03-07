import { Request, Response, NextFunction } from 'express';

//Plan Status
export const UserStatus = ["active", "inactive"] as const;
export type UserStatusType = typeof UserStatus[number];

export type MiddlewareType = (req: Request, res: Response, next: NextFunction) => void;
