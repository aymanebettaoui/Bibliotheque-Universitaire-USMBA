import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { prisma } from '../config/db.js';
import { hashToken, opaqueToken, SESSION_COOKIE, configuredOrigin } from '../middleware/auth.js';
import { resetExpiredLateCycles } from '../jobs/scheduler.js';
import { cancelRequest, expireReservations, generateReminders, handover, processOverdue, requestBorrow, returnLoan } from '../services/circulation.js';

// These tests create only random, fictional fixtures and clean only their IDs.
// Run against a separately migrated database, e.g. library_test.
const userIds: string[] = [];
const bookIds: string[] = [];
const prefix = `test-${randomUUID()}`;
let staffId: string;
let originalSettings: { maxLoans: number; loanDays: number; pickupHours: number; lateSuspensionDays: number; minorDamageDays: number };
const now = new Date('2026-11-08T12:00:00.000Z');
const day = 86_400_000;

async function student(options: { verified?: boolean; active?: boolean; lateCycle?: number; suspensions?: number } = {}) {
  const id = randomUUID();
  userIds.push(id);
  return prisma.user.create({ data: {
    id, googleSub: `${prefix}:${id}`, email: `${id}@usmba.ac.ma`, name: 'Étudiant de test fictif', role: 'STUDENT', active: options.active ?? true,
    student: { create: { studentNumber: `T${id.replaceAll('-', '').slice(0, 12)}`, verified: options.verified ?? true, lateCycle: options.lateCycle ?? 0, suspensions: options.suspensions ?? 0 } },
  }, include: { student: true } });
}

async function book(count = 1, priceDh = '200.00') {
  const id = randomUUID(); bookIds.push(id);
  return prisma.book.create({ data: {
    id, title: `${prefix} — Ouvrage ${id}`, priceDh,
    copies: { create: Array.from({ length: count }, (_, index) => ({ barcode: `${prefix}-${id}-${index}` })) },
  }, include: { copies: true } });
}

async function reserved() {
  const user = await student();
  const b = await book();
  const request = await requestBorrow(user.id, b.id, now);
  return { user, book: b, request, reservation: request.reservation! };
}

async function activeLoan(options: { late?: boolean; priceDh?: string; lateCycle?: number; suspensions?: number } = {}) {
  const user = await student({ lateCycle: options.lateCycle, suspensions: options.suspensions });
  const b = await book(1, options.priceDh ?? '200.00');
  const request = await requestBorrow(user.id, b.id, now);
  const reservation = request.reservation!;
  const loan = await handover(staffId, reservation.id, { studentNumber: user.student!.studentNumber!, barcode: b.copies[0]!.barcode }, now);
  if (options.late) await prisma.loan.update({ where: { id: loan.id }, data: { handedAt: new Date(now.getTime() - 20 * day), dueAt: new Date(now.getTime() - day) } });
  return { user, book: b, loan };
}

// Represents a physical loan granted before a restriction, which can become
// late while that restriction is active. The two writes commit atomically.
async function existingLateLoan(user: Awaited<ReturnType<typeof student>>, eventAt: Date) {
  const b = await book();
  return prisma.$transaction(async tx => {
    await tx.copy.update({ where: { id: b.copies[0]!.id }, data: { status: 'LOANED' } });
    return tx.loan.create({ data: { studentId: user.student!.id, copyId: b.copies[0]!.id,
      handedAt: new Date(eventAt.getTime() - 20 * day), dueAt: new Date(eventAt.getTime() - day) } });
  });
}

beforeAll(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Integration tests cannot run with NODE_ENV=production.');
  await prisma.$connect();
  originalSettings = await prisma.librarySettings.upsert({ where: { id: 'singleton' }, create: {}, update: {} });
  await prisma.librarySettings.update({ where: { id: 'singleton' }, data: { maxLoans: 3, loanDays: 14, pickupHours: 48, lateSuspensionDays: 7, minorDamageDays: 15 } });
  staffId = randomUUID(); userIds.push(staffId);
  await prisma.user.create({ data: { id: staffId, email: `${staffId}@usmba.ac.ma`, googleSub: `${prefix}:staff`, name: 'Bibliothécaire de test fictif', role: 'LIBRARIAN' } });
});

afterAll(async () => {
  const students = await prisma.student.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const studentIds = students.map(s => s.id);
  const loans = await prisma.loan.findMany({ where: { studentId: { in: studentIds } }, select: { id: true } });
  const loanIds = loans.map(l => l.id);
  const reservations = await prisma.reservation.findMany({ where: { studentId: { in: studentIds } }, select: { id: true } });
  const requests = await prisma.borrowRequest.findMany({ where: { studentId: { in: studentIds } }, select: { id: true } });
  const copies = await prisma.copy.findMany({ where: { bookId: { in: bookIds } }, select: { id: true } });
  const sanctions = await prisma.sanction.findMany({ where: { studentId: { in: studentIds } }, select: { id: true } });
  const ids = [...userIds, ...studentIds, ...bookIds, ...loanIds, ...reservations.map(r => r.id), ...requests.map(r => r.id), ...copies.map(c => c.id), ...sanctions.map(s => s.id)];
  await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: { in: ids } }] } }),
    prisma.statusHistory.deleteMany({ where: { entityId: { in: ids } } }),
    prisma.notification.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.sanction.deleteMany({ where: { studentId: { in: studentIds } } }),
    prisma.infraction.deleteMany({ where: { studentId: { in: studentIds } } }),
    prisma.loan.deleteMany({ where: { studentId: { in: studentIds } } }),
    prisma.reservation.deleteMany({ where: { studentId: { in: studentIds } } }),
    prisma.borrowRequest.deleteMany({ where: { studentId: { in: studentIds } } }),
    prisma.acquisition.deleteMany({ where: { studentId: { in: studentIds } } }),
    prisma.copy.deleteMany({ where: { bookId: { in: bookIds } } }),
    prisma.book.deleteMany({ where: { id: { in: bookIds } } }),
    prisma.student.deleteMany({ where: { id: { in: studentIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);
  await prisma.librarySettings.update({ where: { id: 'singleton' }, data: originalSettings });
  await prisma.$disconnect();
});

describe('Réservations transactionnelles PostgreSQL', () => {
  it('accepte une demande, réserve physiquement et ne crée aucun emprunt avant remise', async () => {
    const { request, book: b, user } = await reserved();
    expect(request.status).toBe('ACCEPTED');
    expect(request.reservation?.status).toBe('ACTIVE');
    expect(request.reservation?.expiresAt.toISOString()).toBe('2026-11-10T12:00:00.000Z');
    expect((await prisma.copy.findUniqueOrThrow({ where: { id: b.copies[0]!.id } })).status).toBe('RESERVED');
    expect(await prisma.loan.count({ where: { studentId: user.student!.id } })).toBe(0);
  });

  it('refuse un ouvrage sans exemplaire et enregistre le motif et la notification', async () => {
    const user = await student(); const b = await book(0);
    const request = await requestBorrow(user.id, b.id, now);
    expect(request.status).toBe('REFUSED');
    expect(request.reason).toContain('Aucun exemplaire');
    expect(await prisma.notification.count({ where: { userId: user.id, type: 'REQUEST_REFUSED' } })).toBe(1);
  });

  it('refuse le compte non vérifié', async () => {
    const user = await student({ verified: false }); const b = await book();
    expect((await requestBorrow(user.id, b.id, now)).status).toBe('REFUSED');
  });

  it('refuse le compte désactivé', async () => {
    const user = await student({ active: false }); const b = await book();
    expect((await requestBorrow(user.id, b.id, now)).reason).toContain('désactivé');
  });

  it('refuse une suspension active et accepte après sa fin', async () => {
    const user = await student(); const b = await book();
    const sanction = await prisma.sanction.create({ data: { studentId: user.student!.id, type: 'SUSPENSION', startsAt: new Date(now.getTime() - day), endsAt: new Date(now.getTime() + day), reason: 'Fictif' } });
    expect((await requestBorrow(user.id, b.id, now)).reason).toContain('suspendu');
    await prisma.sanction.update({ where: { id: sanction.id }, data: { endsAt: new Date(now.getTime() - 1) } });
    expect((await requestBorrow(user.id, b.id, now)).status).toBe('ACCEPTED');
  });

  it('empêche les doublons du même livre même avec plusieurs exemplaires', async () => {
    const user = await student(); const b = await book(2);
    expect((await requestBorrow(user.id, b.id, now)).status).toBe('ACCEPTED');
    expect((await requestBorrow(user.id, b.id, now)).reason).toContain('déjà');
  });

  it('deux étudiants concurrents ne réservent jamais le même exemplaire', async () => {
    const a = await student(); const b = await student(); const title = await book();
    const requests = await Promise.all([requestBorrow(a.id, title.id, now), requestBorrow(b.id, title.id, now)]);
    expect(requests.filter(r => r.status === 'ACCEPTED')).toHaveLength(1);
    expect(requests.filter(r => r.status === 'REFUSED')).toHaveLength(1);
    expect(await prisma.reservation.count({ where: { copyId: title.copies[0]!.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('sérialise les demandes du même étudiant et respecte la limite cumulée', async () => {
    const user = await student();
    const settings = await prisma.librarySettings.findUniqueOrThrow({ where: { id: 'singleton' } });
    for (let i = 0; i < settings.maxLoans - 1; i++) {
      const title = await book(); await requestBorrow(user.id, title.id, now);
    }
    const a = await book(); const b = await book();
    const requests = await Promise.all([requestBorrow(user.id, a.id, now), requestBorrow(user.id, b.id, now)]);
    expect(requests.filter(r => r.status === 'ACCEPTED')).toHaveLength(1);
    expect(await prisma.reservation.count({ where: { studentId: user.student!.id, status: 'ACTIVE' } })).toBe(settings.maxLoans);
  });

  it('annule seulement la demande de son propriétaire et libère l’exemplaire', async () => {
    const f = await reserved(); const other = await student();
    await expect(cancelRequest(other.id, f.request.id, now)).rejects.toMatchObject({ status: 404 });
    await cancelRequest(f.user.id, f.request.id, now);
    expect((await prisma.copy.findUniqueOrThrow({ where: { id: f.book.copies[0]!.id } })).status).toBe('AVAILABLE');
    expect((await prisma.borrowRequest.findUniqueOrThrow({ where: { id: f.request.id } })).status).toBe('CANCELLED');
  });

  it('expire côté serveur une réservation et déduplique les notifications', async () => {
    const f = await reserved();
    await prisma.reservation.update({ where: { id: f.reservation.id }, data: { expiresAt: new Date(now.getTime() - 1) } });
    await expireReservations(now); await expireReservations(now);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: f.reservation.id } })).status).toBe('EXPIRED');
    expect((await prisma.borrowRequest.findUniqueOrThrow({ where: { id: f.request.id } })).status).toBe('EXPIRED');
    expect((await prisma.copy.findUniqueOrThrow({ where: { id: f.book.copies[0]!.id } })).status).toBe('AVAILABLE');
    expect(await prisma.notification.count({ where: { dedupeKey: `reservation-expired:${f.reservation.id}` } })).toBe(1);
  });

  it('les contraintes SQL refusent un emprunt direct qui chevauche une réservation', async () => {
    const f = await reserved(); const other = await student();
    await expect(prisma.$transaction(async tx => {
      await tx.copy.update({ where: { id: f.reservation.copyId }, data: { status: 'LOANED' } });
      await tx.loan.create({ data: { studentId: other.student!.id, copyId: f.reservation.copyId, handedAt: now, dueAt: new Date(now.getTime() + day) } });
    })).rejects.toBeDefined();
    expect((await prisma.copy.findUniqueOrThrow({ where: { id: f.reservation.copyId } })).status).toBe('RESERVED');
  });

  it('les contraintes différées refusent un statut disponible avec réservation active', async () => {
    const f = await reserved();
    await expect(prisma.copy.update({ where: { id: f.reservation.copyId }, data: { status: 'AVAILABLE' } })).rejects.toBeDefined();
    expect((await prisma.copy.findUniqueOrThrow({ where: { id: f.reservation.copyId } })).status).toBe('RESERVED');
  });
});

describe('Guichet physique, retours et sanctions', () => {
  it('contrôle la carte et le code exemplaire avant la remise', async () => {
    const f = await reserved();
    await expect(handover(staffId, f.reservation.id, { studentNumber: 'FAUX', barcode: f.book.copies[0]!.barcode }, now)).rejects.toMatchObject({ code: 'IDENTITY_OR_COPY_MISMATCH' });
    expect(await prisma.loan.count({ where: { reservationId: f.reservation.id } })).toBe(0);
  });

  it('réévalue l’éligibilité au guichet', async () => {
    const f = await reserved();
    await prisma.sanction.create({ data: { studentId: f.user.student!.id, type: 'BAN', reason: 'Fictif', startsAt: now } });
    await expect(handover(staffId, f.reservation.id, { studentNumber: f.user.student!.studentNumber!, barcode: f.book.copies[0]!.barcode }, now)).rejects.toMatchObject({ code: 'STUDENT_INELIGIBLE' });
  });

  it('interdit la remise après expiration même avant le prochain passage du job', async () => {
    const f = await reserved();
    await prisma.reservation.update({ where: { id: f.reservation.id }, data: { expiresAt: new Date(now.getTime() - 1) } });
    await expect(handover(staffId, f.reservation.id, { studentNumber: f.user.student!.studentNumber!, barcode: f.book.copies[0]!.barcode }, now)).rejects.toMatchObject({ code: 'RESERVATION_INACTIVE' });
  });

  it('un emprunt dépassé bloque une nouvelle demande avant le passage du job', async () => {
    const f = await activeLoan({ late: true }); const b = await book();
    const request = await requestBorrow(f.user.id, b.id, now);
    expect(request.status).toBe('REFUSED'); expect(request.reason).toContain('retard');
  });

  it('confirme la remise puis clôture un retour normal, historique conservé', async () => {
    const f = await activeLoan();
    expect(f.loan.status).toBe('ACTIVE');
    const result = await returnLoan(staffId, f.loan.id, { condition: 'GOOD' }, now);
    expect(result.status).toBe('CLOSED'); expect(result.returnedAt?.toISOString()).toBe(now.toISOString());
    expect(result.copy.status).toBe('AVAILABLE');
    expect(await prisma.statusHistory.count({ where: { entityId: f.loan.id } })).toBe(2);
    await expect(returnLoan(staffId, f.loan.id, { condition: 'GOOD' }, now)).rejects.toMatchObject({ code: 'LOAN_ALREADY_CLOSED' });
  });

  it('un retard ne compte qu’une seule fois malgré le job et le retour', async () => {
    const f = await activeLoan({ late: true });
    await processOverdue(now); await processOverdue(now);
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: f.loan.id } })).status).toBe('OVERDUE');
    await returnLoan(staffId, f.loan.id, { condition: 'GOOD' }, now);
    expect(await prisma.infraction.count({ where: { loanId: f.loan.id, type: 'LATE' } })).toBe(1);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: f.user.student!.id } })).lateCycle).toBe(1);
  });

  it('deuxième retard : avertissement, aucune suspension', async () => {
    const f = await activeLoan({ late: true, lateCycle: 1 });
    await returnLoan(staffId, f.loan.id, { condition: 'GOOD' }, now);
    const sanctions = await prisma.sanction.findMany({ where: { studentId: f.user.student!.id } });
    expect(sanctions.map(s => s.type)).toEqual(['WARNING']);
  });

  it('troisième retard : compteur conservé à trois pendant sept jours puis remis à zéro une seule fois', async () => {
    const f = await activeLoan({ late: true, lateCycle: 2 });
    await returnLoan(staffId, f.loan.id, { condition: 'GOOD' }, now);
    const sanction = await prisma.sanction.findFirstOrThrow({ where: { studentId: f.user.student!.id } });
    expect(sanction.type).toBe('SUSPENSION'); expect(sanction.endsAt!.getTime() - sanction.startsAt.getTime()).toBe(7 * day);
    const s = await prisma.student.findUniqueOrThrow({ where: { id: f.user.student!.id } });
    expect(s.lateCycle).toBe(3); expect(s.suspensions).toBe(1);
    await resetExpiredLateCycles(new Date(now.getTime() + 7 * day - 1));
    expect((await prisma.student.findUniqueOrThrow({ where: { id: s.id } })).lateCycle).toBe(3);
    const expiry = new Date(now.getTime() + 7 * day);
    await resetExpiredLateCycles(expiry); await resetExpiredLateCycles(expiry);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: s.id } })).lateCycle).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'LATE_CYCLE_RESET', entityId: s.id } })).toBe(1);
  });

  it('conserve les retards pendant la suspension sans nouveau cycle, puis reprend après expiration même sans job', async () => {
    const f = await activeLoan({ late: true, lateCycle: 2 });
    await returnLoan(staffId, f.loan.id, { condition: 'GOOD' }, now);
    const during = new Date(now.getTime() + day);
    const oldLoan = await existingLateLoan(f.user, during);
    await returnLoan(staffId, oldLoan.id, { condition: 'GOOD' }, during);
    const held = await prisma.student.findUniqueOrThrow({ where: { id: f.user.student!.id } });
    expect(held.lateCycle).toBe(3); expect(held.suspensions).toBe(1);
    expect(await prisma.sanction.count({ where: { studentId: held.id, type: 'SUSPENSION' } })).toBe(1);
    expect((await prisma.sanction.findFirstOrThrow({ where: { infraction: { loanId: oldLoan.id, type: 'LATE' } } })).type).toBe('WARNING');
    // No scheduler call: applyInfraction catches the expiry before counting.
    for (let incident = 1; incident <= 3; incident++) {
      const after = new Date(now.getTime() + (6 + incident) * day);
      const loan = await existingLateLoan(f.user, after);
      await returnLoan(staffId, loan.id, { condition: 'GOOD' }, after);
      const updated = await prisma.student.findUniqueOrThrow({ where: { id: held.id } });
      expect(updated.lateCycle).toBe(incident);
      expect(updated.suspensions).toBe(incident === 3 ? 2 : 1);
    }
    expect(await prisma.infraction.count({ where: { studentId: held.id, type: 'LATE' } })).toBe(5);
    expect(await prisma.sanction.count({ where: { studentId: held.id, type: 'BAN' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'LATE_CYCLE_RESET', entityId: held.id } })).toBe(1);
  });

  it('la révocation administrative d’une suspension clôture le cycle sans attendre sa date initiale', async () => {
    const f = await activeLoan({ late: true, lateCycle: 2 });
    await returnLoan(staffId, f.loan.id, { condition: 'GOOD' }, now);
    const suspension = await prisma.sanction.findFirstOrThrow({ where: { studentId: f.user.student!.id, type: 'SUSPENSION' } });
    await prisma.sanction.update({ where: { id: suspension.id }, data: { status: 'REVOKED' } });
    await resetExpiredLateCycles(new Date(now.getTime() + day));
    const s = await prisma.student.findUniqueOrThrow({ where: { id: f.user.student!.id } });
    expect(s.lateCycle).toBe(0); expect(s.suspensions).toBe(1);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'LATE_CYCLE_RESET', entityId: s.id } });
    expect(log.details).toMatchObject({ cause: 'ADMINISTRATIVE_REVOCATION', from: 3, to: 0 });
  });

  it('deuxième suspension pour retard : interdiction définitive', async () => {
    const f = await activeLoan({ late: true, lateCycle: 2, suspensions: 1 });
    await returnLoan(staffId, f.loan.id, { condition: 'GOOD' }, now);
    const sanction = await prisma.sanction.findFirstOrThrow({ where: { studentId: f.user.student!.id } });
    expect(sanction.type).toBe('BAN'); expect(sanction.endsAt).toBeNull();
  });

  it.each([['200.00', '150'], ['100.00', '100'], ['80.40', '80.4']])('perte au prix %s DH : indemnité exacte %s DH', async (priceDh, expected) => {
    const f = await activeLoan({ priceDh });
    const result = await returnLoan(staffId, f.loan.id, { condition: 'LOST' }, now);
    expect(result.copy.status).toBe('WITHDRAWN'); expect(result.copy.condition).toBe('LOST');
    const sanction = await prisma.sanction.findFirstOrThrow({ where: { studentId: f.user.student!.id, type: 'FINE' } });
    expect(sanction.amountDh!.toString()).toBe(expected);
  });

  it('détérioration légère : suspension 15 jours, exemplaire retiré', async () => {
    const f = await activeLoan();
    const result = await returnLoan(staffId, f.loan.id, { condition: 'DAMAGED', damageSeverity: 'MINOR' }, now);
    expect(result.copy.status).toBe('WITHDRAWN');
    const sanction = await prisma.sanction.findFirstOrThrow({ where: { studentId: f.user.student!.id } });
    expect(sanction.type).toBe('SUSPENSION'); expect(sanction.endsAt!.getTime() - sanction.startsAt.getTime()).toBe(15 * day);
  });

  it('détérioration grave : 50% du prix, sans remise en circulation', async () => {
    const f = await activeLoan({ priceDh: '171.13' });
    const result = await returnLoan(staffId, f.loan.id, { condition: 'DAMAGED', damageSeverity: 'SEVERE' }, now);
    expect(result.copy.status).toBe('WITHDRAWN');
    const sanction = await prisma.sanction.findFirstOrThrow({ where: { studentId: f.user.student!.id } });
    expect(sanction.amountDh!.toFixed(2)).toBe('85.57');
  });

  it('le rappel programmé ne crée pas de notification en double', async () => {
    const f = await activeLoan();
    await prisma.loan.update({ where: { id: f.loan.id }, data: { dueAt: new Date(now.getTime() + day) } });
    await generateReminders(now); await generateReminders(now);
    expect(await prisma.notification.count({ where: { dedupeKey: `return-reminder:${f.loan.id}` } })).toBe(1);
  });
});

describe('Parcours API réel et séparation des rôles', () => {
  async function session(userId: string) {
    const token = opaqueToken(); const csrf = opaqueToken();
    await prisma.session.create({ data: { userId, tokenHash: hashToken(token), csrfToken: csrf, expiresAt: new Date(Date.now() + day) } });
    return { cookie: `${SESSION_COOKIE}=${token}`, csrf };
  }

  it('session étudiant → recherche → réservation → remise bibliothécaire → emprunt → retour → disponible', async () => {
    const { createApp } = await import('../app.js');
    const app = createApp();
    const user = await student(); const b = await book();
    const studentSession = await session(user.id); const staffSession = await session(staffId);
    const identity = await supertest(app).get('/api/auth/me').set('Cookie', studentSession.cookie).expect(200);
    expect(identity.body.user.id).toBe(user.id);
    const search = await supertest(app).get(`/api/books?q=${encodeURIComponent(b.title)}`).expect(200);
    expect(search.body.items.some((item: { id: string }) => item.id === b.id)).toBe(true);
    const accepted = await supertest(app).post('/api/requests').set('Cookie', studentSession.cookie).set('Origin', configuredOrigin()).set('X-CSRF-Token', studentSession.csrf).send({ bookId: b.id }).expect(201);
    expect(accepted.body.status).toBe('ACCEPTED');
    const reservationId = accepted.body.reservation.id;
    const input = { studentNumber: user.student!.studentNumber, barcode: b.copies[0]!.barcode };
    await supertest(app).post(`/api/staff/reservations/${reservationId}/handover`).set('Cookie', studentSession.cookie).set('Origin', configuredOrigin()).set('X-CSRF-Token', studentSession.csrf).send(input).expect(403);
    await supertest(app).get('/api/staff/users').set('Cookie', studentSession.cookie).expect(403);
    const given = await supertest(app).post(`/api/staff/reservations/${reservationId}/handover`).set('Cookie', staffSession.cookie).set('Origin', configuredOrigin()).set('X-CSRF-Token', staffSession.csrf).send(input).expect(201);
    expect(given.body.status).toBe('ACTIVE');
    const mine = await supertest(app).get('/api/me/loans').set('Cookie', studentSession.cookie).expect(200);
    expect(mine.body.items.some((item: { id: string }) => item.id === given.body.id)).toBe(true);
    const stranger = await student(); const otherSession = await session(stranger.id);
    const otherLoans = await supertest(app).get(`/api/me/loans?studentId=${user.student!.id}`).set('Cookie', otherSession.cookie).expect(200);
    expect(otherLoans.body.items).toHaveLength(0);
    await supertest(app).post(`/api/staff/loans/${given.body.id}/return`).set('Cookie', staffSession.cookie).set('Origin', configuredOrigin()).set('X-CSRF-Token', staffSession.csrf).send({ condition: 'GOOD' }).expect(200);
    const detail = await supertest(app).get(`/api/books/${b.id}`).expect(200);
    expect(detail.body.availableCount).toBe(1);
    expect(JSON.stringify(detail.body)).not.toContain(user.email);
  });

  it('une mutation authentifiée sans CSRF est refusée', async () => {
    const { createApp } = await import('../app.js'); const app = createApp();
    const user = await student(); const b = await book(); const s = await session(user.id);
    await supertest(app).post('/api/requests').set('Cookie', s.cookie).set('Origin', configuredOrigin()).send({ bookId: b.id }).expect(403);
    expect(await prisma.borrowRequest.count({ where: { studentId: user.student!.id } })).toBe(0);
  });
});
