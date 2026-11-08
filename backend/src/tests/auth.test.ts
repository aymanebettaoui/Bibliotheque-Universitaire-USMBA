import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Role } from '@prisma/client';
import { createApp } from '../app.js';
import { prisma } from '../config/db.js';
import { hashToken, opaqueToken, assertAuthConfiguration } from '../middleware/auth.js';
import { DemoUniversityConnector, demoRoster, UnconfiguredUniversityConnector } from '../integrations/university.js';
import { hasUniversityDomain, validateGoogleClaims, type GoogleClaims } from '../services/google.js';
import * as googleService from '../services/google.js';

const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
const fixtureIds: string[] = [];
const sessionIds: string[] = [];
const challengeNonces: string[] = [];
let app: ReturnType<typeof createApp>;

async function fixture(role: Role = 'STUDENT', verified = false) {
  const run = randomUUID();
  const user = await prisma.user.create({ data: {
    email: `auth-${run}@usmba.ac.ma`, googleSub: `auth-test:${run}`, name: `Test ${role}`, role,
    ...(role === 'STUDENT' ? { student: { create: { verified } } } : {}),
  }, include: { student: true } });
  fixtureIds.push(user.id);
  const raw = opaqueToken();
  const csrfToken = opaqueToken();
  const session = await prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(raw), csrfToken, expiresAt: new Date(Date.now() + 3600000) } });
  sessionIds.push(session.id);
  return { user, cookie: `library_session=${raw}`, csrfToken, sessionId: session.id };
}
const claims = (overrides: Partial<GoogleClaims> = {}): GoogleClaims => ({
  iss: 'https://accounts.google.com', aud: 'test-client', sub: '123456789012345678901',
  iat: 1000, exp: 2000, email: 'etudiant@usmba.ac.ma', email_verified: true, nonce: 'a-valid-nonce', ...overrides,
});

beforeAll(() => { app = createApp(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => {
  await prisma.authChallenge.deleteMany({ where: { nonceHash: { in: challengeNonces.map(hashToken) } } });
  await prisma.session.deleteMany({ where: { userId: { in: fixtureIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: fixtureIds } } });
  await prisma.identityVerification.deleteMany({ where: { userId: { in: fixtureIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: fixtureIds } } });
  await prisma.student.deleteMany({ where: { userId: { in: fixtureIds } } });
  await prisma.user.deleteMany({ where: { id: { in: fixtureIds } } });
});

describe('Contrôles des claims Google après vérification cryptographique', () => {
  it('accepte les claims cohérents et conserve le sub stable', () => {
    expect(validateGoogleClaims(claims(), 'test-client', 'a-valid-nonce', 1500)).toMatchObject({ sub: '123456789012345678901', email: 'etudiant@usmba.ac.ma' });
  });
  it.each([
    [{ iss: 'https://evil.invalid' }, 'GOOGLE_ISSUER'],
    [{ aud: 'other-client' }, 'GOOGLE_AUDIENCE'],
    [{ exp: 1400 }, 'GOOGLE_EXPIRED'],
    [{ iat: 1601 }, 'GOOGLE_EXPIRED'],
    [{ email_verified: false }, 'GOOGLE_EMAIL_UNVERIFIED'],
    [{ email: undefined }, 'GOOGLE_EMAIL_UNVERIFIED'],
    [{ nonce: 'replayed' }, 'GOOGLE_NONCE'],
  ] as Array<[Partial<GoogleClaims>, string]>)('refuse les claims invalides %j', (override, code) => {
    expect(() => validateGoogleClaims(claims(override), 'test-client', 'a-valid-nonce', 1500)).toThrow(expect.objectContaining({ code }));
  });
  it('applique le domaine exact sans faire confiance à hd', () => {
    expect(hasUniversityDomain('Etudiant@usmba.ac.ma')).toBe(true);
    expect(hasUniversityDomain('etudiant@evil.usmba.ac.ma')).toBe(false);
    expect(hasUniversityDomain('etudiant@usmba.ac.ma.evil.invalid')).toBe(false);
    expect(hasUniversityDomain('etudiant@gmail.com')).toBe(false);
    expect(hasUniversityDomain('etudiant@usmba.ac.ma@evil.invalid')).toBe(false);
  });
});

describe('Sessions réelles, CSRF et restrictions de rôle', () => {
  it('émet un défi préauth protégé sans exposer de secret session', async () => {
    const response = await request(app).get('/api/auth/me').expect(200);
    expect(response.body.user).toBeNull();
    expect(response.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers['set-cookie'].join(';')).toContain('HttpOnly');
    expect(response.headers['cache-control']).toContain('no-store');
  });
  it('refuse une origine étrangère et un jeton CSRF absent', async () => {
    const f = await fixture();
    await request(app).post('/api/auth/logout').set('Cookie', f.cookie).set('Origin', 'https://evil.invalid').set('X-CSRF-Token', f.csrfToken).expect(403);
    await request(app).post('/api/auth/logout').set('Cookie', f.cookie).set('Origin', origin).expect(403);
    expect(await prisma.session.findUnique({ where: { id: f.sessionId } })).not.toBeNull();
  });
  it('expire les sessions côté serveur', async () => {
    const f = await fixture();
    await prisma.session.update({ where: { id: f.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const response = await request(app).get('/api/auth/me').set('Cookie', f.cookie).expect(200);
    expect(response.body.user).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: f.sessionId } })).toBeNull();
  });
  it.each([
    ['test', 'false'],
    ['production', 'true'],
  ])('révoque une ancienne session fictive lorsque NODE_ENV=%s et DEMO_MODE=%s', async (nodeEnv, demoMode) => {
    const f = await fixture();
    await prisma.user.update({ where: { id: f.user.id }, data: { googleSub: `demo:revoked-${randomUUID()}` } });
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DEMO_MODE', 'true');
    expect((await request(app).get('/api/auth/me').set('Cookie', f.cookie)).body.user.id).toBe(f.user.id);
    vi.stubEnv('NODE_ENV', nodeEnv); vi.stubEnv('DEMO_MODE', demoMode);
    const response = await request(app).get('/api/auth/me').set('Cookie', f.cookie).expect(200);
    expect(response.body.user).toBeNull();
    expect(response.body.demo).toBe(false);
    expect(await prisma.session.findUnique({ where: { id: f.sessionId } })).toBeNull();
  });
  it('révoque une session lorsque son compte est désactivé', async () => {
    const f = await fixture();
    await prisma.user.update({ where: { id: f.user.id }, data: { active: false } });
    expect((await request(app).get('/api/auth/me').set('Cookie', f.cookie)).body.user).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: f.sessionId } })).toBeNull();
  });
  it('ne permet pas à un étudiant d’accéder au personnel ou aux rôles administratifs', async () => {
    const f = await fixture();
    await request(app).get('/api/staff/dashboard').set('Cookie', f.cookie).expect(403);
    await request(app).get('/api/admin/users').set('Cookie', f.cookie).expect(403);
    await request(app).patch(`/api/admin/users/${f.user.id}`).set('Cookie', f.cookie).set('Origin', origin).set('X-CSRF-Token', f.csrfToken).send({ role: 'ADMIN' }).expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).role).toBe('STUDENT');
  });
  it('révoque la session à la déconnexion et masque les champs internes', async () => {
    const f = await fixture();
    const me = await request(app).get('/api/auth/me').set('Cookie', f.cookie).expect(200);
    expect(me.body.user).toMatchObject({ id: f.user.id, role: 'STUDENT', student: { verified: false } });
    expect(me.body.user.googleSub).toBeUndefined();
    expect(me.body.user.sessions).toBeUndefined();
    expect((await request(app).get('/api/notifications').set('Cookie', f.cookie).expect(200)).headers['cache-control']).toContain('no-store');
    await request(app).post('/api/auth/logout').set('Cookie', f.cookie).set('Origin', origin).set('X-CSRF-Token', f.csrfToken).expect(200);
    expect(await prisma.session.findUnique({ where: { id: f.sessionId } })).toBeNull();
    expect((await request(app).get('/api/auth/me').set('Cookie', f.cookie)).body.user).toBeNull();
  });
  it('désactive le changement de rôle de démonstration en production', async () => {
    const agent = request.agent(app);
    const me = await agent.get('/api/auth/me');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO_MODE', 'true');
    await agent.post('/api/auth/demo').set('Origin', origin).set('X-CSRF-Token', me.body.csrfToken).send({ role: 'ADMIN' }).expect(404);
  });
  it('refuse une configuration production avec secret exemple ou démonstration', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('DEMO_MODE', 'true');
    expect(assertAuthConfiguration).toThrow('DEMO_MODE');
    vi.stubEnv('DEMO_MODE', 'false'); vi.stubEnv('GOOGLE_CLIENT_ID', 'client.apps.googleusercontent.com'); vi.stubEnv('APP_ORIGIN', 'https://library.example.org');
    vi.stubEnv('SESSION_SECRET', 'replace-with-a-random-secret-at-least-32-characters');
    expect(assertAuthConfiguration).toThrow('SESSION_SECRET');
  });
  it('refuse un jeton Google malformé sans authentifier ni consommer le défi', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client.apps.googleusercontent.com');
    const agent = request.agent(app);
    const challenge = await agent.get('/api/auth/google/nonce').expect(200);
    challengeNonces.push(challenge.body.nonce);
    const response = await agent.post('/api/auth/google').set('Origin', origin).set('X-CSRF-Token', challenge.body.csrfToken).send({ credential: 'this-is-not-a-valid-google-id-token', nonce: challenge.body.nonce }).expect(401);
    expect(response.body.error.code).toBe('GOOGLE_INVALID');
    expect((await agent.get('/api/auth/me')).body.user).toBeNull();
    expect((await prisma.authChallenge.findUniqueOrThrow({ where: { nonceHash: hashToken(challenge.body.nonce) } })).usedAt).toBeNull();
  });
});

describe('Vérification universitaire et repli administratif', () => {
  it('propose un compte fictif d’inscription précis, le vérifie une seule fois puis conserve son activation', async () => {
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DEMO_MODE', 'true');
    const standard = await fixture('STUDENT', true);
    await prisma.user.update({ where: { id: standard.user.id }, data: { googleSub: `demo:standard-${randomUUID()}` } });
    const existing = await prisma.user.findUnique({ where: { googleSub: 'demo:onboarding' }, include: { student: true } });
    const target = existing ?? await prisma.user.create({ data: {
      googleSub: 'demo:onboarding', email: 'inscription.demo@usmba.ac.ma', name: 'Samir Exemple', role: 'STUDENT', student: { create: {} },
    }, include: { student: true } });
    if (!existing) fixtureIds.push(target.id);
    const started = new Date();
    const activationKey = `account-verified:${target.id}`;
    const oldNotification = existing ? await prisma.notification.findUnique({ where: { dedupeKey: activationKey } }) : null;
    if (oldNotification) await prisma.notification.update({ where: { id: oldNotification.id }, data: { dedupeKey: `${activationKey}:preserved:${randomUUID()}` } });
    // Test fixtures are isolated in library_test; production/demo login never resets verification.
    if (existing?.student) await prisma.student.update({ where: { id: existing.student.id }, data: { verified: false, studentNumber: null } });
    try {
      const agent = request.agent(app);
      const anonymous = await agent.get('/api/auth/me').expect(200);
      const login = await agent.post('/api/auth/demo').set('Origin', origin).set('X-CSRF-Token', anonymous.body.csrfToken).send({ role: 'STUDENT', scenario: 'ONBOARDING' }).expect(200);
      expect(login.body.user).toMatchObject({ id: target.id, role: 'STUDENT', student: { verified: false, studentNumber: null } });
      await agent.post('/api/auth/demo').set('Origin', origin).set('X-CSRF-Token', login.body.csrfToken).send({ role: 'ADMIN', scenario: 'ONBOARDING' }).expect(400);
      const verified = await agent.post('/api/onboarding/verify').set('Origin', origin).set('X-CSRF-Token', login.body.csrfToken).send({ studentNumber: 'R202400003' }).expect(200);
      expect(verified.body.verification).toMatchObject({ provider: 'DEMO', status: 'VERIFIED', message: 'Vérification simulée — environnement de démonstration' });
      expect(verified.body.user.student).toMatchObject({ verified: true, studentNumber: 'R202400003' });
      const nextLogin = await agent.post('/api/auth/demo').set('Origin', origin).set('X-CSRF-Token', login.body.csrfToken).send({ role: 'STUDENT', scenario: 'ONBOARDING' }).expect(200);
      expect(nextLogin.body.user.student.verified).toBe(true);
      const repeatedVerify = await agent.post('/api/onboarding/verify').set('Origin', origin).set('X-CSRF-Token', nextLogin.body.csrfToken).send({ studentNumber: 'R202400003' }).expect(200);
      expect(repeatedVerify.body.verification.provider).toBe('EXISTING');
      const ordinary = await agent.post('/api/auth/demo').set('Origin', origin).set('X-CSRF-Token', nextLogin.body.csrfToken).send({ role: 'STUDENT' }).expect(200);
      expect(ordinary.body.user.id).not.toBe(target.id);
    } finally {
      if (existing?.student) {
        await prisma.session.deleteMany({ where: { userId: target.id, createdAt: { gte: started } } });
        await prisma.notification.deleteMany({ where: { userId: target.id, createdAt: { gte: started } } });
        await prisma.identityVerification.deleteMany({ where: { userId: target.id, createdAt: { gte: started } } });
        await prisma.auditLog.deleteMany({ where: { userId: target.id, createdAt: { gte: started } } });
        await prisma.student.update({ where: { id: existing.student.id }, data: { verified: existing.student.verified, studentNumber: existing.student.studentNumber } });
        if (oldNotification) await prisma.notification.update({ where: { id: oldNotification.id }, data: { dedupeKey: activationKey } });
      }
    }
  });
  it('ne confond jamais le registre fictif et une connexion officielle', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    await expect(new DemoUniversityConnector().verify(demoRoster[0]!)).resolves.toMatchObject({ valid: true, provider: 'DEMO' });
    await expect(new DemoUniversityConnector().verify({ ...demoRoster[0]!, googleSub: 'real-google-sub' })).rejects.toMatchObject({ code: 'UNIVERSITY_NOT_CONFIGURED' });
    await expect(new UnconfiguredUniversityConnector().verify(demoRoster[0]!)).rejects.toMatchObject({ status: 503 });
  });
  it('ne valide aucun compte réel sur la seule base d’un résultat OCR', async () => {
    const f = await fixture();
    await request(app).post('/api/onboarding/verify').set('Cookie', f.cookie).set('Origin', origin).set('X-CSRF-Token', f.csrfToken).send({ studentNumber: 'R202499999' }).expect(503);
    expect((await prisma.student.findUniqueOrThrow({ where: { userId: f.user.id } })).verified).toBe(false);
    expect(await prisma.identityVerification.findFirst({ where: { userId: f.user.id, status: 'UNAVAILABLE' } })).not.toBeNull();
  });
  it('permet un contrôle physique justifié uniquement par l’administrateur, conserve la preuve et évite les doublons', async () => {
    const f = await fixture();
    const admin = await fixture('ADMIN');
    const number = `T${Date.now().toString().slice(-10)}`;
    await request(app).post('/api/onboarding/review').set('Cookie', f.cookie).set('Origin', origin).set('X-CSRF-Token', f.csrfToken).send({ reason: 'La caméra ne fonctionne pas sur mon ordinateur.' }).expect(201);
    const pending = await request(app).get('/api/admin/identity-reviews').set('Cookie', admin.cookie).expect(200);
    expect(pending.body.items.some((row: { userId: string }) => row.userId === f.user.id)).toBe(true);
    await request(app).post(`/api/admin/students/${f.user.student!.id}/verify`).set('Cookie', f.cookie).set('Origin', origin).set('X-CSRF-Token', f.csrfToken).send({ studentNumber: number, reason: 'Carte originale vérifiée au guichet par un agent.', physicalConfirmed: true }).expect(403);
    await request(app).post(`/api/admin/students/${f.user.student!.id}/verify`).set('Cookie', admin.cookie).set('Origin', origin).set('X-CSRF-Token', admin.csrfToken).send({ studentNumber: number, reason: 'Carte originale vérifiée au guichet par un agent.', physicalConfirmed: false }).expect(400);
    const result = await request(app).post(`/api/admin/students/${f.user.student!.id}/verify`).set('Cookie', admin.cookie).set('Origin', origin).set('X-CSRF-Token', admin.csrfToken).send({ studentNumber: number, reason: 'Carte originale vérifiée au guichet par un agent.', physicalConfirmed: true }).expect(200);
    expect(result.body.verification.provider).toBe('ADMIN_REVIEW');
    expect((await request(app).get('/api/auth/me').set('Cookie', f.cookie)).body.user.student.verified).toBe(true);
    expect(await prisma.auditLog.findFirst({ where: { entityId: f.user.student!.id, action: 'IDENTITY_VERIFIED_MANUALLY', userId: admin.user.id } })).not.toBeNull();
    await request(app).post(`/api/admin/students/${f.user.student!.id}/verify`).set('Cookie', admin.cookie).set('Origin', origin).set('X-CSRF-Token', admin.csrfToken).send({ studentNumber: number, reason: 'Carte originale vérifiée au guichet par un agent.', physicalConfirmed: true }).expect(409);
    const another = await fixture();
    await request(app).post(`/api/admin/students/${another.user.student!.id}/verify`).set('Cookie', admin.cookie).set('Origin', origin).set('X-CSRF-Token', admin.csrfToken).send({ studentNumber: number, reason: 'Carte originale vérifiée au guichet par un agent.', physicalConfirmed: true }).expect(409);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: another.user.student!.id } })).verified).toBe(false);
  });
});

describe('Parcours Google après la frontière de vérification cryptographique simulée en test', () => {
  // These tests exercise our persistence and challenge logic, not Google's live signature service.
  it('crée une seule identité étudiante en attente, révoque le nonce puis retrouve le même sub à la connexion suivante', async () => {
    const run = randomUUID();
    const identity = { sub: `google-boundary:${run}`, email: `google-${run}@usmba.ac.ma`, name: 'Étudiant de test' };
    const verifier = vi.spyOn(googleService, 'verifyGoogleCredential').mockResolvedValue(identity);
    const agent = request.agent(app);
    const challenge = await agent.get('/api/auth/google/nonce').expect(200);
    challengeNonces.push(challenge.body.nonce);
    const credential = `test-boundary-credential-${run}`;
    const login = await agent.post('/api/auth/google').set('Origin', origin).set('X-CSRF-Token', challenge.body.csrfToken).send({ credential, nonce: challenge.body.nonce }).expect(200);
    fixtureIds.push(login.body.user.id);
    expect(verifier).toHaveBeenCalledWith(credential, challenge.body.nonce);
    expect(login.body.user).toMatchObject({ role: 'STUDENT', student: { verified: false, studentNumber: null } });
    const oldChallenge = await prisma.authChallenge.findUnique({ where: { nonceHash: hashToken(challenge.body.nonce) } });
    expect(oldChallenge?.usedAt).not.toBeNull();
    expect(oldChallenge?.credentialHash).toBe(hashToken(credential));
    await agent.post('/api/auth/google').set('Origin', origin).set('X-CSRF-Token', login.body.csrfToken).send({ credential, nonce: challenge.body.nonce }).expect(401);
    const retryChallenge = await agent.get('/api/auth/google/nonce').expect(200);
    challengeNonces.push(retryChallenge.body.nonce);
    const replay = await agent.post('/api/auth/google').set('Origin', origin).set('X-CSRF-Token', retryChallenge.body.csrfToken).send({ credential, nonce: retryChallenge.body.nonce }).expect(409);
    expect(replay.body.error.code).toBe('DUPLICATE');
    const nextChallenge = await agent.get('/api/auth/google/nonce').expect(200);
    challengeNonces.push(nextChallenge.body.nonce);
    verifier.mockResolvedValue({ ...identity, email: `renamed-${run}@usmba.ac.ma` });
    const second = await agent.post('/api/auth/google').set('Origin', origin).set('X-CSRF-Token', nextChallenge.body.csrfToken).send({ credential: `${credential}-second`, nonce: nextChallenge.body.nonce }).expect(200);
    expect(second.body.user.id).toBe(login.body.user.id);
    expect(second.body.user.email).toBe(`renamed-${run}@usmba.ac.ma`);
    expect(await prisma.user.count({ where: { googleSub: identity.sub } })).toBe(1);
  });
  it('ne crée pas de compte pour un domaine externe ni de rôle fourni publiquement', async () => {
    const run = randomUUID();
    vi.spyOn(googleService, 'verifyGoogleCredential').mockResolvedValue({ sub: `external:${run}`, email: `external-${run}@gmail.com`, name: 'Externe' });
    const agent = request.agent(app);
    const challenge = await agent.get('/api/auth/google/nonce').expect(200);
    challengeNonces.push(challenge.body.nonce);
    await agent.post('/api/auth/google').set('Origin', origin).set('X-CSRF-Token', challenge.body.csrfToken).send({ credential: `external-credential-${run}`, nonce: challenge.body.nonce }).expect(403);
    await agent.post('/api/auth/google').set('Origin', origin).set('X-CSRF-Token', challenge.body.csrfToken).send({ credential: `external-credential-${run}`, nonce: challenge.body.nonce, role: 'ADMIN' }).expect(400);
    expect(await prisma.user.findUnique({ where: { googleSub: `external:${run}` } })).toBeNull();
  });
});
