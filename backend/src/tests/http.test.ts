import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../config/db.js';
import { createApp } from '../app.js';
import { coverDirectory } from '../routes/covers.js';
import { hashToken, opaqueToken } from '../middleware/auth.js';

const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
const suffix = randomUUID();
const userIds: string[] = [], bookIds: string[] = [], coverFiles: string[] = [];
const app = createApp();
const student = request.agent(app), librarian = request.agent(app), manager = request.agent(app);
let studentId: string, staffId: string;
const studentNumber = `H${suffix.replaceAll('-', '').slice(0, 9).toUpperCase()}`;
let studentCsrf = '', staffCsrf = '', managerCsrf = '';
let book: any, reservation: any, loan: any, settings: any;

const mutate = (agent: ReturnType<typeof request.agent>, method: 'post'|'patch', url: string, csrf: string, body: unknown) =>
  agent[method](`/api${url}`).set('Origin', origin).set('X-CSRF-Token', csrf).send(body);

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  await prisma.librarySettings.upsert({ where: { id: 'singleton' }, create: {}, update: {} });
  settings = await prisma.librarySettings.findUniqueOrThrow({ where: { id: 'singleton' } });
  const fixtures = [
    { key: 'student', role: 'STUDENT' as const, agent: student, sensitive: false },
    { key: 'staff', role: 'LIBRARIAN' as const, agent: librarian, sensitive: false },
    { key: 'manager', role: 'LIBRARIAN' as const, agent: manager, sensitive: true },
  ];
  for (const fixture of fixtures) {
    const { role } = fixture;
    const id = randomUUID(); userIds.push(id);
    const u = await prisma.user.create({ data: { id, googleSub: `http-test:${suffix}:${fixture.key}`, email: `000-http-${suffix}-${fixture.key}@usmba.ac.ma`, name: `Compte HTTP fictif ${fixture.key}`, role,
      canManageUsers: fixture.sensitive, canManageSettings: fixture.sensitive, canViewAudit: fixture.sensitive, canRevokeSanctions: fixture.sensitive,
      ...(role === 'STUDENT' ? { student: { create: { verified: true, studentNumber } } } : {}) }, include: { student: true } });
    const raw = opaqueToken();
    const csrf = opaqueToken();
    await prisma.session.create({ data: { userId: u.id, tokenHash: hashToken(raw), csrfToken: csrf, expiresAt: new Date(Date.now() + 3_600_000) } });
    fixture.agent.set('Cookie', `library_session=${raw}`);
    if (role === 'STUDENT') { studentId = u.student!.id; studentCsrf = csrf; }
    else if (fixture.sensitive) managerCsrf = csrf;
    else { staffId = u.id; staffCsrf = csrf; }
  }
  const b = await prisma.book.create({ data: { title: `HTTP ${suffix}`, priceDh: '180.00', copies: { create: { barcode: `HTTP-${suffix}` } } }, include: { copies: true } });
  book = b; bookIds.push(b.id);
});

afterAll(async () => {
  const sids = (await prisma.student.findMany({ where: { userId: { in: userIds } } })).map(s => s.id);
  const copies = (await prisma.copy.findMany({ where: { bookId: { in: bookIds } } })).map(c => c.id);
  const requests = (await prisma.borrowRequest.findMany({ where: { studentId: { in: sids } } })).map(r => r.id);
  const reservations = (await prisma.reservation.findMany({ where: { studentId: { in: sids } } })).map(r => r.id);
  const loans = (await prisma.loan.findMany({ where: { studentId: { in: sids } } })).map(l => l.id);
  await prisma.$transaction([
    prisma.statusHistory.deleteMany({ where: { entityId: { in: [...bookIds, ...copies, ...requests, ...reservations, ...loans] } } }),
    prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.notification.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.identityVerification.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.sanction.deleteMany({ where: { studentId: { in: sids } } }),
    prisma.infraction.deleteMany({ where: { studentId: { in: sids } } }),
    prisma.loan.deleteMany({ where: { studentId: { in: sids } } }),
    prisma.reservation.deleteMany({ where: { studentId: { in: sids } } }),
    prisma.borrowRequest.deleteMany({ where: { studentId: { in: sids } } }),
    prisma.acquisition.deleteMany({ where: { studentId: { in: sids } } }),
    prisma.copy.deleteMany({ where: { bookId: { in: bookIds } } }),
    prisma.book.deleteMany({ where: { id: { in: bookIds } } }),
    prisma.student.deleteMany({ where: { id: { in: sids } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    prisma.librarySettings.update({ where: { id: 'singleton' }, data: { maxLoans: settings.maxLoans, loanDays: settings.loanDays, pickupHours: settings.pickupHours, lateSuspensionDays: settings.lateSuspensionDays, minorDamageDays: settings.minorDamageDays } }),
  ]);
  for (const name of coverFiles) await unlink(path.join(coverDirectory, name)).catch(() => {});
  await prisma.$disconnect();
});

describe('Parcours HTTP réel et autorisations', () => {
  it('protège le personnel, les données privées et les mutations CSRF', async () => {
    await request(app).get('/api/staff/loans').expect(401);
    await student.get('/api/staff/loans').expect(403);
    await student.get('/api/staff/users').expect(403);
    await student.get('/api/staff/settings').expect(403);
    await student.post('/api/requests').set('Origin', origin).send({ bookId: book.id }).expect(403);
    await student.post('/api/requests').set('Origin', 'https://evil.example').set('X-CSRF-Token', studentCsrf).send({ bookId: book.id }).expect(403);
  });

  it('ne divulgue aucune identité dans la fiche publique', async () => {
    const response = await request(app).get(`/api/books/${book.id}`).expect(200);
    expect(response.body.availableCount).toBe(1);
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('@usmba.ac.ma');
    expect(body).not.toContain('studentId');
    expect(response.body.copies[0]).not.toHaveProperty('loans');
  });

  it('réserve automatiquement sans créer de prêt et interdit la remise à l’étudiant', async () => {
    const response = await mutate(student, 'post', '/requests', studentCsrf, { bookId: book.id }).expect(201);
    expect(response.body.status).toBe('ACCEPTED'); reservation = response.body.reservation;
    expect(await prisma.loan.count({ where: { studentId } })).toBe(0);
    await mutate(student, 'post', `/staff/reservations/${reservation.id}/handover`, studentCsrf, { studentNumber, barcode: book.copies[0].barcode }).expect(403);
  });

  it('vérifie la carte et l’exemplaire puis confirme la remise physique', async () => {
    await mutate(librarian, 'post', `/staff/reservations/${reservation.id}/handover`, staffCsrf, { studentNumber: 'H000000000', barcode: book.copies[0].barcode }).expect(409);
    const response = await mutate(librarian, 'post', `/staff/reservations/${reservation.id}/handover`, staffCsrf, { studentNumber, barcode: book.copies[0].barcode }).expect(201);
    loan = response.body;
    const personal = await student.get('/api/me/loans').expect(200);
    expect(personal.body.items.some((item: any) => item.id === loan.id && item.status === 'ACTIVE')).toBe(true);
    expect((await request(app).get(`/api/books/${book.id}`)).body.availableCount).toBe(0);
  });

  it('enregistre le retour, conserve l’historique et rend la disponibilité au catalogue', async () => {
    await mutate(librarian, 'post', `/staff/loans/${loan.id}/return`, staffCsrf, { condition: 'GOOD' }).expect(200);
    const publicBook = await request(app).get(`/api/books/${book.id}`).expect(200);
    expect(publicBook.body.availableCount).toBe(1);
    const personal = await student.get('/api/me/loans').expect(200);
    expect(personal.body.items.find((item: any) => item.id === loan.id).status).toBe('CLOSED');
    await mutate(librarian, 'post', `/staff/loans/${loan.id}/return`, staffCsrf, { condition: 'GOOD' }).expect(409);
  });

  it('isole les notifications entre utilisateurs', async () => {
    const other = await prisma.notification.create({ data: { userId: staffId, type: 'TEST_PRIVATE', content: 'Notification personnelle du personnel.' } });
    const response = await student.get('/api/notifications').expect(200);
    expect(response.body.items.some((n: any) => n.id === other.id)).toBe(false);
    await mutate(student, 'post', `/notifications/${other.id}/read`, studentCsrf, {}).expect(404);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: other.id } })).readAt).toBeNull();
  });

  it('valide les entrées et conserve les livres ajoutés entre instances Express', async () => {
    const input = { title: `Nouveau ${suffix}`, authors: [`Auteur ${suffix}`], categories: [`Thème ${suffix}`], priceDh: 100 };
    await mutate(student, 'post', '/staff/books', studentCsrf, input).expect(403);
    await mutate(librarian, 'post', '/staff/books', staffCsrf, { ...input, priceDh: -1 }).expect(400);
    const created = await mutate(librarian, 'post', '/staff/books', staffCsrf, input).expect(201);
    bookIds.push(created.body.id);
    await mutate(librarian, 'post', `/staff/books/${created.body.id}/copies`, staffCsrf, { count: 2 }).expect(201);
    const fromNewProcess = await request(createApp()).get(`/api/books/${created.body.id}`).expect(200);
    expect(fromNewProcess.body.totalCount).toBe(2);
    expect(fromNewProcess.body.title).toBe(input.title);
    await request(app).get('/api/books/not-a-uuid').expect(400);
  });

  it('refuse les fausses images et stocke uniquement une couverture réencodée', async () => {
    await librarian.post(`/api/staff/books/${book.id}/cover`).set('Origin', origin).set('X-CSRF-Token', staffCsrf).set('Content-Type', 'image/png').send(Buffer.from('<svg onload="alert(1)"></svg>')).expect(400);
    const image = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#244c60' } }).png().toBuffer();
    const uploaded = await librarian.post(`/api/staff/books/${book.id}/cover`).set('Origin', origin).set('X-CSRF-Token', staffCsrf).set('Content-Type', 'image/png').send(image).expect(200);
    coverFiles.push(uploaded.body.coverUrl.split('/').pop());
    const served = await request(app).get(uploaded.body.coverUrl).expect(200);
    expect(served.headers['content-type']).toContain('image/webp');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect((await sharp(served.body).metadata()).format).toBe('webp');
    expect((await prisma.book.findUniqueOrThrow({ where: { id: book.id } })).coverUrl).toBe(uploaded.body.coverUrl);
  });

  it('traite les propositions sans confondre acceptation et acquisition physique', async () => {
    const input = { title: `Proposition ${suffix}`, author: 'Auteur fictif', category: 'Informatique', referenceUrl: 'https://example.org/reference' };
    const proposal = await mutate(student, 'post', '/acquisitions', studentCsrf, input).expect(201);
    await mutate(student, 'post', '/acquisitions', studentCsrf, input).expect(409);
    const accepted = await mutate(librarian, 'patch', `/staff/acquisitions/${proposal.body.id}`, staffCsrf, { status: 'ACCEPTED', comment: 'Pertinent pour le cursus.' }).expect(200);
    expect(accepted.body.bookId).toBeNull();
    await mutate(librarian, 'patch', `/staff/acquisitions/${proposal.body.id}`, staffCsrf, { status: 'ACQUIRED' }).expect(400);
    const acquired = await mutate(librarian, 'patch', `/staff/acquisitions/${proposal.body.id}`, staffCsrf, { status: 'ACQUIRED', bookId: book.id }).expect(200);
    expect(acquired.body.status).toBe('ACQUIRED');
    await mutate(student, 'post', '/acquisitions', studentCsrf, { ...input, title: 'Autre titre', referenceUrl: 'javascript:alert(1)' }).expect(400);
  });

  it('réserve les paramètres et les journaux au bibliothécaire habilité et audite leur changement', async () => {
    const body = { maxLoans: 4, loanDays: 21, pickupHours: 36, lateSuspensionDays: 7, minorDamageDays: 15 };
    await mutate(student, 'patch', '/staff/settings', studentCsrf, body).expect(403);
    await mutate(manager, 'patch', '/staff/settings', managerCsrf, { ...body, loanDays: 0 }).expect(400);
    await mutate(manager, 'patch', '/staff/settings', managerCsrf, body).expect(200);
    expect((await manager.get('/api/staff/settings').expect(200)).body.loanDays).toBe(21);
    const audit = await manager.get('/api/staff/audit').expect(200);
    expect(audit.body.items.some((item: any) => item.action === 'SETTINGS_UPDATED')).toBe(true);
  });

  it('permet règlement manuel et correction motivée, avec historique d’audit', async () => {
    const fine = await prisma.sanction.create({ data: { studentId, type: 'FINE', amountDh: '135.00', reason: 'Pénalité fictive pour test HTTP.' } });
    await mutate(student, 'post', `/staff/sanctions/${fine.id}/settle`, studentCsrf, { reason: 'Espèces reçues au guichet.' }).expect(403);
    await mutate(librarian, 'post', `/staff/sanctions/${fine.id}/settle`, staffCsrf, { reason: 'Reçu local de règlement fictif.' }).expect(200);
    const restriction = await prisma.sanction.create({ data: { studentId, type: 'BAN', reason: 'Interdiction fictive contestée.' } });
    await mutate(student, 'post', `/staff/sanctions/${restriction.id}/revoke`, studentCsrf, { reason: 'Erreur constatée.' }).expect(403);
    await mutate(manager, 'post', `/staff/sanctions/${restriction.id}/revoke`, managerCsrf, { reason: 'Erreur de dossier corrigée après contrôle de la carte.' }).expect(200);
    expect(await prisma.auditLog.count({ where: { entityId: { in: [fine.id, restriction.id] }, action: { in: ['SANCTION_SETTLED', 'SANCTION_REVOKED'] } } })).toBe(2);
  });

  it('archive une référence sans détruire les prêts terminés', async () => {
    const source = await prisma.book.findUniqueOrThrow({ where: { id: book.id }, include: { authors: true, categories: true } });
    await mutate(librarian, 'patch', `/staff/books/${book.id}`, staffCsrf, { title: source.title, priceDh: 180, authors: ['Auteur historique'], categories: ['Tests'], archived: true }).expect(200);
    await request(app).get(`/api/books/${book.id}`).expect(404);
    expect(await prisma.loan.count({ where: { id: loan.id, status: 'CLOSED' } })).toBe(1);
  });
});
