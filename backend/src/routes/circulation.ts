import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { cancelRequest, handover, requestBorrow, returnLoan } from '../services/circulation.js';

export const circulationRouter = Router();
const uuid = z.string().uuid();
const student = [requireAuth, requireRoles('STUDENT')];
const staff = [requireAuth, requireRoles('LIBRARIAN', 'ADMIN')];
// Express 4: forward promise failures into the centralized error middleware.
const route = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => { void fn(req, res).catch(next); };

circulationRouter.post('/requests', ...student, route(async (req, res) => {
  const { bookId } = z.object({ bookId: uuid }).strict().parse(req.body);
  res.status(201).json(await requestBorrow(req.user.id, bookId));
}));

circulationRouter.post('/requests/:id/cancel', ...student, route(async (req, res) => {
  res.json(await cancelRequest(req.user.id, uuid.parse(req.params.id)));
}));

circulationRouter.get('/staff/requests', ...staff, route(async (_req, res) => {
  const items = await prisma.borrowRequest.findMany({
    orderBy: { createdAt: 'desc' }, take: 200,
    include: {
      student: { include: { user: { select: { id: true, name: true, email: true } } } },
      book: { include: { authors: true, categories: true } }, reservation: { include: { copy: true } },
    },
  });
  res.json({ items });
}));

circulationRouter.get('/staff/loans', ...staff, route(async (_req, res) => {
  const items = await prisma.loan.findMany({
    orderBy: { handedAt: 'desc' }, take: 200,
    include: {
      student: { include: { user: { select: { id: true, name: true, email: true } } } },
      copy: { include: { book: { include: { authors: true, categories: true } } } },
    },
  });
  res.json({ items });
}));

circulationRouter.get('/staff/students', ...staff, route(async (req, res) => {
  const q = z.string().trim().max(100).default('').parse(req.query.q);
  const items = await prisma.student.findMany({
    where: q ? { OR: [{ studentNumber: q }, { user: { name: { contains: q, mode: 'insensitive' } } }] } : {},
    take: 30,
    include: { user: { select: { id: true, name: true, email: true, active: true } } },
    orderBy: { studentNumber: 'asc' },
  });
  res.json({ items });
}));

circulationRouter.post('/staff/reservations/:id/handover', ...staff, route(async (req, res) => {
  const input = z.object({ studentNumber: z.string().trim().min(3).max(50), barcode: z.string().trim().min(1).max(100) }).strict().parse(req.body);
  res.status(201).json(await handover(req.user.id, uuid.parse(req.params.id), input));
}));

circulationRouter.post('/staff/loans/:id/return', ...staff, route(async (req, res) => {
  const input = z.object({ condition: z.enum(['GOOD', 'DAMAGED', 'LOST']), damageSeverity: z.enum(['MINOR', 'SEVERE']).optional() })
    .strict().superRefine((v, ctx) => {
      if (v.condition === 'DAMAGED' && !v.damageSeverity) ctx.addIssue({ code: 'custom', path: ['damageSeverity'], message: 'Précisez la gravité de la détérioration.' });
      if (v.condition !== 'DAMAGED' && v.damageSeverity) ctx.addIssue({ code: 'custom', path: ['damageSeverity'], message: 'Une gravité ne s’applique qu’à un exemplaire endommagé.' });
    }).parse(req.body);
  res.json(await returnLoan(req.user.id, uuid.parse(req.params.id), input));
}));

export default circulationRouter;
