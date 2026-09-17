import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export const SESSION_COOKIE = 'bc_session';

export interface AuthedRequest extends Request {
  userId?: string;
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET não configurado (.env).');
  return secret;
}

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId }, jwtSecret(), { expiresIn: '30d' });
}

export function resolveUserId(req: Request): string | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret());
    if (typeof payload === 'object' && typeof payload.sub === 'string') return payload.sub;
    return null;
  } catch {
    return null;
  }
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: 'Não autenticado.' });
    return;
  }
  req.userId = userId;
  next();
}
