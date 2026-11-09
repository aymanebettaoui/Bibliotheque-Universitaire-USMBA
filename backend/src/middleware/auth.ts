import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, RequestHandler } from 'express';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../config/db.js';
import { HttpError, asyncHandler } from './error.js';

export type AuthUser = Prisma.UserGetPayload<{ include: { student: true } }>;
export interface Principal { user: AuthUser; sessionId: string; csrfToken: string }
export type StaffPermission = 'canManageUsers' | 'canManageSettings' | 'canViewAudit' | 'canRevokeSanctions';
declare global {
  namespace Express {
    interface Request { auth?: Principal; user?: AuthUser }
  }
}

export const SESSION_COOKIE = 'library_session';
export const CHALLENGE_COOKIE = 'library_preauth';
export const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const challengeLifetimeMs = 15 * 60 * 1000;
export const opaqueToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const demoEnabled = () => process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production';
export const configuredOrigin = () => process.env.APP_ORIGIN || 'http://localhost:5173';

export function cookieValue(req: Request, name: string): string | undefined {
  const entry = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  const value = entry?.slice(name.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
export function safeEqual(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function setAuthCookie(res: Response, name: string, value: string, maxAge: number) {
  res.cookie(name, value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api', maxAge });
}
export function clearAuthCookie(res: Response, name: string) {
  res.clearCookie(name, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api' });
}
export const publicUser = (user: AuthUser) => ({
  id: user.id, name: user.name, email: user.email, role: user.role, active: user.active,
  student: user.student ? { id: user.student.id, studentNumber: user.student.studentNumber, verified: user.student.verified } : null,
  permissions: {
    manageUsers: user.role === 'LIBRARIAN' && user.canManageUsers,
    manageSettings: user.role === 'LIBRARIAN' && user.canManageSettings,
    viewAudit: user.role === 'LIBRARIAN' && user.canViewAudit,
    revokeSanctions: user.role === 'LIBRARIAN' && user.canRevokeSanctions,
  },
});

export const loadSession = asyncHandler(async (req, res, next) => {
  const token = cookieValue(req, SESSION_COOKIE);
  if (token) {
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { student: true } } } });
    const allowedIdentity = session && (!session.user.googleSub?.startsWith('demo:') || demoEnabled());
    if (session && session.expiresAt > new Date() && session.user.active && allowedIdentity) {
      req.auth = { user: session.user, sessionId: session.id, csrfToken: session.csrfToken };
      req.user = session.user;
      res.set('Cache-Control', 'no-store');
    } else {
      if (session) await prisma.session.deleteMany({ where: { id: session.id } });
      clearAuthCookie(res, SESSION_COOKIE);
    }
  }
  next();
});
export const sessionMiddleware = loadSession;

export async function getChallenge(req: Request) {
  const token = cookieValue(req, CHALLENGE_COOKIE);
  if (!token) return null;
  return prisma.authChallenge.findFirst({ where: { tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: new Date() } } });
}

export async function createChallenge(res: Response, nonce?: string) {
  const raw = opaqueToken();
  const challenge = await prisma.authChallenge.create({ data: {
    tokenHash: hashToken(raw), csrfToken: opaqueToken(),
    nonceHash: nonce ? hashToken(nonce) : null,
    expiresAt: new Date(Date.now() + challengeLifetimeMs),
  } });
  setAuthCookie(res, CHALLENGE_COOKIE, raw, challengeLifetimeMs);
  return challenge;
}

export async function ensureChallenge(req: Request, res: Response) {
  return (await getChallenge(req)) ?? createChallenge(res);
}

export const csrfProtection = asyncHandler(async (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
  const origin = req.get('Origin');
  if (!origin || origin !== configuredOrigin()) throw new HttpError(403, 'INVALID_ORIGIN', 'Origine de la requête non autorisée.');
  const supplied = req.get('X-CSRF-Token');
  if (req.auth && safeEqual(supplied, req.auth.csrfToken)) { next(); return; }
  const challenge = await getChallenge(req);
  if (!challenge || !safeEqual(supplied, challenge.csrfToken)) throw new HttpError(403, 'CSRF_INVALID', 'La protection de session a expiré. Rechargez la page.');
  next();
});

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) { next(new HttpError(401, 'AUTH_REQUIRED', 'Connectez-vous pour continuer.')); return; }
  if (!req.auth.user.active) { next(new HttpError(403, 'ACCOUNT_INACTIVE', 'Ce compte est désactivé.')); return; }
  next();
};
export const requireRoles = (...roles: Role[]): RequestHandler => (req, _res, next) => {
  if (!req.auth) { next(new HttpError(401, 'AUTH_REQUIRED', 'Connectez-vous pour continuer.')); return; }
  if (!roles.includes(req.auth.user.role)) { next(new HttpError(403, 'FORBIDDEN', 'Votre rôle ne permet pas cette opération.')); return; }
  next();
};
export const requirePermission = (permission: StaffPermission): RequestHandler => (req, _res, next) => {
  if (!req.auth) { next(new HttpError(401, 'AUTH_REQUIRED', 'Connectez-vous pour continuer.')); return; }
  if (req.auth.user.role !== 'LIBRARIAN' || !req.auth.user[permission]) {
    next(new HttpError(403, 'PERMISSION_REQUIRED', 'Cette opération sensible nécessite une habilitation bibliothécaire spécifique.'));
    return;
  }
  next();
};

export function assertAuthConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.DEMO_MODE === 'true') throw new Error('DEMO_MODE est interdit en production.');
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID est obligatoire en production.');
  if (!process.env.APP_ORIGIN?.startsWith('https://')) throw new Error('APP_ORIGIN doit utiliser HTTPS en production.');
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || /replace|change.?me|example|demo|local-demo/i.test(process.env.SESSION_SECRET)) throw new Error('SESSION_SECRET doit contenir au moins 32 caractères aléatoires, sans valeur d’exemple, en production.');
}
