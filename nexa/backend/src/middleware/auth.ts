import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db.js';

export const ACCESS_SECRET: string = process.env.NEXA_ACCESS_SECRET || 'nexa-dev-access-secret-change-me';
export const REFRESH_SECRET: string = process.env.NEXA_REFRESH_SECRET || 'nexa-dev-refresh-secret-change-me';
export const ACCESS_TTL = '15m';
export const REFRESH_TTL_DAYS = 30;

const bearer = (req: Request): string | null => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } });
    return;
  }
  try {
    const payload = jwt.verify(token, ACCESS_SECRET) as jwt.JwtPayload;
    const u = db.prepare('SELECT account_status FROM users WHERE id = ?').get(payload.sub) as { account_status: string } | undefined;
    if (!u || u.account_status !== 'active') {
      res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'This session is no longer valid. Please log in again.' } });
      return;
    }
    // The second space can act on the owner's moved chats (see space.js / routes/messages.js).
    req.userId = (req as Request & { spaceActAs?: string }).spaceActAs || payload.sub;
    next();
  } catch {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Session expired or invalid. Please log in again.' } });
  }
}

/** Attaches req.userId if a valid token is present, but doesn't reject if absent. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (token) {
    try {
      req.userId = (jwt.verify(token, ACCESS_SECRET) as jwt.JwtPayload).sub;
    } catch { /* ignore, treat as anonymous */ }
  }
  next();
}
