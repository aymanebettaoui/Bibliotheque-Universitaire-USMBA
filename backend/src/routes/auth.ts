import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { HttpError, asyncHandler } from '../middleware/error.js';
import {
  CHALLENGE_COOKIE, SESSION_COOKIE, cookieValue, clearAuthCookie, createChallenge,
  demoEnabled, ensureChallenge, getChallenge, hashToken, opaqueToken, publicUser,
  safeEqual, sessionLifetimeMs, setAuthCookie, type AuthUser,
} from '../middleware/auth.js';
import { hasUniversityDomain, verifyGoogleCredential } from '../services/google.js';
import { officialUniversityConnector } from '../integrations/university.js';
import { onboardingRouter } from './onboarding.js';

export const authRouter = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'AUTH_RATE_LIMIT', message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' } },
});

authRouter.get('/auth/me', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const csrfToken = req.auth?.csrfToken ?? (await ensureChallenge(req, res)).csrfToken;
  res.json({
    user: req.auth ? publicUser(req.auth.user) : null, csrfToken,
    demo: demoEnabled(), googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    universityConfigured: officialUniversityConnector.configured,
  });
}));

authRouter.get('/auth/google/nonce', loginLimiter, asyncHandler(async (_req, res) => {
  const nonce = opaqueToken();
  const challenge = await createChallenge(res, nonce);
  res.set('Cache-Control', 'no-store').json({ nonce, csrfToken: challenge.csrfToken });
}));

authRouter.post('/auth/demo', loginLimiter, asyncHandler(async (req, res) => {
  if (!demoEnabled()) throw new HttpError(404, 'NOT_FOUND', 'Cette route est indisponible.');
  const { role, scenario } = z.object({ role: z.enum(['STUDENT', 'LIBRARIAN', 'ADMIN']), scenario: z.literal('ONBOARDING').optional() }).strict()
    .refine(input => !input.scenario || input.role === 'STUDENT', 'Le parcours d’inscription est réservé au profil étudiant fictif.').parse(req.body);
  const user = await prisma.user.findFirst({
    where: { role, googleSub: scenario === 'ONBOARDING' ? 'demo:onboarding' : { startsWith: 'demo:', not: 'demo:onboarding' }, active: true },
    include: { student: true }, orderBy: { email: 'asc' },
  });
  if (!user) throw new HttpError(503, 'DEMO_NOT_SEEDED', 'Les comptes fictifs ne sont pas disponibles. Exécutez le peuplement de démonstration.');
  const token = opaqueToken();
  const csrfToken = opaqueToken();
  await prisma.$transaction(async tx => {
    if (req.auth) await tx.session.deleteMany({ where: { id: req.auth.sessionId } });
    await tx.session.create({ data: { tokenHash: hashToken(token), userId: user.id, csrfToken, expiresAt: new Date(Date.now() + sessionLifetimeMs) } });
    await tx.auditLog.create({ data: { userId: user.id, action: 'DEMO_LOGIN', entity: 'User', entityId: user.id, details: { role, simulated: true, scenario: scenario || 'STANDARD' } } });
    const preauth = cookieValue(req, CHALLENGE_COOKIE);
    if (preauth) await tx.authChallenge.updateMany({ where: { tokenHash: hashToken(preauth), usedAt: null }, data: { usedAt: new Date() } });
  });
  setAuthCookie(res, SESSION_COOKIE, token, sessionLifetimeMs);
  clearAuthCookie(res, CHALLENGE_COOKIE);
  res.set('Cache-Control', 'no-store').json({ user: publicUser(user), csrfToken, demo: true });
}));

authRouter.post('/auth/google', loginLimiter, asyncHandler(async (req, res) => {
  const { credential, nonce } = z.object({ credential: z.string().min(20).max(16384), nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(req.body);
  const challenge = await getChallenge(req);
  if (!challenge || !safeEqual(challenge.nonceHash ?? undefined, hashToken(nonce))) throw new HttpError(401, 'GOOGLE_CHALLENGE', 'La demande de connexion a expiré. Recommencez avec Google.');
  const claims = await verifyGoogleCredential(credential, nonce);
  const rawSession = opaqueToken();
  const csrfToken = opaqueToken();
  const user = await prisma.$transaction(async tx => {
    const consumed = await tx.authChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() }, nonceHash: hashToken(nonce) },
      data: { usedAt: new Date(), credentialHash: hashToken(credential) },
    });
    if (consumed.count !== 1) throw new HttpError(409, 'GOOGLE_REPLAY', 'Cette connexion a déjà été utilisée. Recommencez avec Google.');
    let account: AuthUser | null = await tx.user.findUnique({ where: { googleSub: claims.sub }, include: { student: true } });
    if (!account) {
      const provisioned = await tx.user.findUnique({ where: { email: claims.email }, include: { student: true } });
      if (provisioned) {
        if (provisioned.googleSub || provisioned.role === 'STUDENT') throw new HttpError(409, 'GOOGLE_ACCOUNT_CONFLICT', 'Cette adresse est déjà liée à une autre identité. Contactez l’administration.');
        account = await tx.user.update({ where: { id: provisioned.id }, data: { googleSub: claims.sub }, include: { student: true } });
      } else {
        if (!hasUniversityDomain(claims.email)) throw new HttpError(403, 'UNIVERSITY_DOMAIN_REQUIRED', 'Utilisez votre compte universitaire @usmba.ac.ma.');
        account = await tx.user.create({ data: { googleSub: claims.sub, email: claims.email, name: claims.name, role: 'STUDENT', student: { create: {} } }, include: { student: true } });
      }
    }
    if (account.role === 'STUDENT' && !hasUniversityDomain(claims.email)) throw new HttpError(403, 'UNIVERSITY_DOMAIN_REQUIRED', 'Utilisez votre compte universitaire @usmba.ac.ma.');
    if (!account.active) throw new HttpError(403, 'ACCOUNT_INACTIVE', 'Ce compte est désactivé. Contactez l’administration.');
    if (account.email !== claims.email) account = await tx.user.update({ where: { id: account.id }, data: { email: claims.email }, include: { student: true } });
    if (req.auth) await tx.session.deleteMany({ where: { id: req.auth.sessionId } });
    await tx.session.create({ data: { tokenHash: hashToken(rawSession), userId: account.id, csrfToken, expiresAt: new Date(Date.now() + sessionLifetimeMs) } });
    await tx.auditLog.create({ data: { userId: account.id, action: 'GOOGLE_LOGIN', entity: 'User', entityId: account.id } });
    return account;
  });
  setAuthCookie(res, SESSION_COOKIE, rawSession, sessionLifetimeMs);
  clearAuthCookie(res, CHALLENGE_COOKIE);
  res.set('Cache-Control', 'no-store').json({ user: publicUser(user), csrfToken });
}));

authRouter.post('/auth/logout', asyncHandler(async (req, res) => {
  if (req.auth) {
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { id: req.auth.sessionId } }),
      prisma.auditLog.create({ data: { userId: req.auth.user.id, action: 'LOGOUT', entity: 'User', entityId: req.auth.user.id } }),
    ]);
  }
  clearAuthCookie(res, SESSION_COOKIE);
  clearAuthCookie(res, CHALLENGE_COOKIE);
  res.json({ ok: true });
}));

authRouter.use(onboardingRouter);
