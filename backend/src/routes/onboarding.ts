import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { publicUser, requireRoles } from '../middleware/auth.js';
import { HttpError, asyncHandler } from '../middleware/error.js';
import { connectorForIdentity } from '../integrations/university.js';

export const onboardingRouter = Router();
const studentNumberSchema = z.string().trim().toUpperCase().regex(/^[A-Z][0-9]{8,11}$/, 'Numéro étudiant invalide : une lettre suivie de 8 à 11 chiffres.');
const verificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'VERIFICATION_RATE_LIMIT', message: 'Trop de tentatives de vérification. Réessayez dans une heure.' } },
});

onboardingRouter.post('/onboarding/verify', requireRoles('STUDENT'), verificationLimiter, asyncHandler(async (req, res) => {
  const user = req.auth!.user;
  const { studentNumber } = z.object({ studentNumber: studentNumberSchema }).strict().parse(req.body);
  if (!user.student || !user.googleSub) throw new HttpError(403, 'STUDENT_PROFILE_REQUIRED', 'Le profil étudiant doit être créé par une connexion Google.');
  if (user.student.verified) {
    res.json({ user: publicUser(user), verification: { provider: 'EXISTING', status: 'VERIFIED', message: 'Votre compte est déjà vérifié. Aucun nouveau scan n’est nécessaire.' } });
    return;
  }
  const identity = { studentNumber, googleSub: user.googleSub, email: user.email, name: user.name };
  const connector = connectorForIdentity(identity);
  let result;
  try {
    result = await connector.verify(identity);
  } catch (error) {
    if (error instanceof HttpError && error.code === 'UNIVERSITY_NOT_CONFIGURED') {
      await prisma.identityVerification.create({ data: { userId: user.id, studentNumber, provider: 'UNCONFIGURED', status: 'UNAVAILABLE' } });
    }
    throw error;
  }
  if (!result.valid) {
    await prisma.identityVerification.create({ data: { userId: user.id, studentNumber, provider: result.provider, status: 'FAILED' } });
    throw new HttpError(422, 'IDENTITY_MISMATCH', 'La carte ne correspond pas à ce compte dans le registre de démonstration. Recommencez ou contactez la bibliothèque.');
  }
  const verifiedUser = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${user.student!.id}::uuid FOR UPDATE`;
    const current = await tx.student.findUniqueOrThrow({ where: { id: user.student!.id } });
    if (!current.verified) {
      await tx.student.update({ where: { id: current.id }, data: { studentNumber, verified: true } });
      await tx.identityVerification.create({ data: { userId: user.id, studentNumber, provider: result.provider, status: 'VERIFIED', verifiedAt: new Date() } });
      await tx.notification.create({ data: { userId: user.id, type: 'ACCOUNT_ACTIVATED', content: result.message, dedupeKey: `account-verified:${user.id}` } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'IDENTITY_VERIFIED', entity: 'Student', entityId: current.id, details: { provider: result.provider } } });
    }
    return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: { student: true } });
  });
  res.json({ user: publicUser(verifiedUser), verification: { provider: result.provider, status: 'VERIFIED', message: result.message } });
}));

onboardingRouter.post('/onboarding/review', requireRoles('STUDENT'), verificationLimiter, asyncHandler(async (req, res) => {
  const { reason, studentNumber } = z.object({ reason: z.string().trim().min(10).max(500), studentNumber: studentNumberSchema.optional() }).strict().parse(req.body);
  const user = req.auth!.user;
  if (!user.student || user.student.verified) throw new HttpError(409, 'REVIEW_NOT_REQUIRED', 'Ce compte ne nécessite pas de vérification manuelle.');
  const review = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${user.student!.id}::uuid FOR UPDATE`;
    const pending = await tx.identityVerification.findFirst({ where: { userId: user.id, status: 'REVIEW_REQUESTED' } });
    if (pending) throw new HttpError(409, 'REVIEW_ALREADY_REQUESTED', 'Votre demande de vérification est déjà en attente. Présentez votre carte physique à la bibliothèque.');
    const created = await tx.identityVerification.create({ data: { userId: user.id, studentNumber: studentNumber || 'UNREADABLE', provider: 'ADMIN_REVIEW', status: 'REVIEW_REQUESTED' } });
    await tx.auditLog.create({ data: { userId: user.id, action: 'IDENTITY_REVIEW_REQUESTED', entity: 'IdentityVerification', entityId: created.id, details: { reason } } });
    const admins = await tx.user.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true } });
    if (admins.length) await tx.notification.createMany({ data: admins.map(admin => ({ userId: admin.id, type: 'IDENTITY_REVIEW_REQUESTED', content: `${user.name} demande une vérification de sa carte physique.`, dedupeKey: `identity-review:${created.id}:${admin.id}` })) });
    return created;
  });
  res.status(201).json({ id: review.id, status: review.status, message: 'Demande enregistrée. Présentez votre carte physique à un administrateur de la bibliothèque.' });
}));

onboardingRouter.get('/admin/identity-reviews', requireRoles('ADMIN'), asyncHandler(async (_req, res) => {
  const items = await prisma.identityVerification.findMany({
    where: { status: 'REVIEW_REQUESTED', user: { student: { is: { verified: false } } } },
    include: { user: { select: { id: true, name: true, email: true, student: true } } },
    orderBy: { createdAt: 'asc' }, take: 100,
  });
  res.json({ items });
}));

onboardingRouter.post('/admin/students/:id/verify', requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { studentNumber, reason } = z.object({ studentNumber: studentNumberSchema, reason: z.string().trim().min(20).max(500), physicalConfirmed: z.literal(true) }).strict().parse(req.body);
  const student = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${id}::uuid FOR UPDATE`;
    const target = await tx.student.findUnique({ where: { id }, include: { user: true } });
    if (!target || target.user.role !== 'STUDENT') throw new HttpError(404, 'STUDENT_NOT_FOUND', 'Étudiant introuvable.');
    if (!target.user.active) throw new HttpError(409, 'ACCOUNT_INACTIVE', 'Ce compte est désactivé.');
    if (target.verified) throw new HttpError(409, 'ALREADY_VERIFIED', 'Cet étudiant est déjà vérifié.');
    const updated = await tx.student.update({ where: { id }, data: { studentNumber, verified: true } });
    await tx.identityVerification.updateMany({ where: { userId: target.userId, status: 'REVIEW_REQUESTED' }, data: { status: 'RESOLVED', verifiedAt: new Date() } });
    await tx.identityVerification.create({ data: { userId: target.userId, studentNumber, provider: 'ADMIN_REVIEW', status: 'VERIFIED', verifiedAt: new Date() } });
    await tx.auditLog.create({ data: { userId: req.auth!.user.id, action: 'IDENTITY_VERIFIED_MANUALLY', entity: 'Student', entityId: id, details: { reason, provider: 'ADMIN_REVIEW', physicalConfirmed: true } } });
    await tx.notification.create({ data: { userId: target.userId, type: 'ACCOUNT_ACTIVATED', content: 'Votre carte physique a été vérifiée par un administrateur. Votre compte étudiant est activé.', dedupeKey: `account-verified:${target.userId}` } });
    return updated;
  });
  res.json({ student, verification: { provider: 'ADMIN_REVIEW', status: 'VERIFIED', message: 'Vérification administrative de la carte physique enregistrée ; aucune API universitaire n’a été interrogée.' } });
}));
