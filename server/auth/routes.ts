import crypto from 'node:crypto';

import bcrypt from 'bcryptjs';
import express, { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';

import { db } from '../db';
import { requireAuth, resolveUserId, signSession, SESSION_COOKIE, type AuthedRequest } from './middleware';

export const authRouter = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

const COOKIE_OPTS = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
};

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
}

function publicUser(row: UserRow) {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

authRouter.post('/register', authLimiter, async (req: Request, res: Response) => {
  const { name, email, password } = req.body ?? {};
  if (typeof name !== 'string' || name.trim().length < 2) {
    res.status(400).json({ success: false, error: 'Informe seu nome.' });
    return;
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ success: false, error: 'E-mail inválido.' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ success: false, error: 'A senha precisa ter ao menos 8 caracteres.' });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(email.trim()) as { id: string } | undefined;
  if (existing) {
    res.status(409).json({ success: false, error: 'Já existe uma conta com este e-mail.' });
    return;
  }

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  const createdAt = new Date().toISOString();
  db.prepare(
    'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, name.trim(), email.trim(), passwordHash, createdAt);

  res.cookie(SESSION_COOKIE, signSession(id), COOKIE_OPTS);
  res.status(201).json({
    success: true,
    user: publicUser({ id, name: name.trim(), email: email.trim(), password_hash: passwordHash, created_at: createdAt }),
  });
});

authRouter.post('/login', authLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ success: false, error: 'Informe e-mail e senha.' });
    return;
  }

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as
    | UserRow
    | undefined;
  const genericError = { success: false, error: 'E-mail ou senha inválidos.' };
  if (!row) {
    res.status(401).json(genericError);
    return;
  }

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    res.status(401).json(genericError);
    return;
  }

  res.cookie(SESSION_COOKIE, signSession(row.id), COOKIE_OPTS);
  res.json({ success: true, user: publicUser(row) });
});

authRouter.put('/me', requireAuth, async (req: AuthedRequest, res: Response) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId!) as UserRow | undefined;
  if (!existing) {
    res.status(401).json({ success: false, error: 'Não autenticado.' });
    return;
  }

  const { name, email } = req.body ?? {};
  if (typeof name !== 'string' || name.trim().length < 2) {
    res.status(400).json({ success: false, error: 'Informe seu nome.' });
    return;
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ success: false, error: 'E-mail inválido.' });
    return;
  }

  const trimmedEmail = email.trim();
  if (trimmedEmail.toLowerCase() !== existing.email.toLowerCase()) {
    const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(trimmedEmail, existing.id) as
      | { id: string }
      | undefined;
    if (taken) {
      res.status(409).json({ success: false, error: 'Já existe uma conta com este e-mail.' });
      return;
    }
  }

  db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name.trim(), trimmedEmail, existing.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as unknown as UserRow;
  res.json({ success: true, user: publicUser(row) });
});

authRouter.put('/password', authLimiter, requireAuth, async (req: AuthedRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    res.status(400).json({ success: false, error: 'Informe a senha atual e a nova senha.' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ success: false, error: 'A nova senha precisa ter ao menos 8 caracteres.' });
    return;
  }

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId!) as UserRow | undefined;
  if (!existing) {
    res.status(401).json({ success: false, error: 'Não autenticado.' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, existing.password_hash);
  if (!valid) {
    res.status(401).json({ success: false, error: 'Senha atual incorreta.' });
    return;
  }

  const nextHash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(nextHash, existing.id);
  res.json({ success: true });
});

authRouter.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ success: true });
});

authRouter.get('/me', (req: AuthedRequest, res: Response) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: 'Não autenticado.' });
    return;
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  if (!row) {
    res.status(401).json({ success: false, error: 'Não autenticado.' });
    return;
  }
  res.json({ success: true, user: publicUser(row) });
});

// Mantido por simetria; usado por outros routers que já importam requireAuth daqui.
export { requireAuth };
