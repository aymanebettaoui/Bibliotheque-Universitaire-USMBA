import { Prisma, type PhysicalCondition } from '@prisma/client';
import { prisma } from '../config/db.js';
import { HttpError } from '../middleware/error.js';
import { applyInfraction } from './sanctions.js';

type Tx = Prisma.TransactionClient;
const day = 86_400_000;
const transactionOptions = { maxWait: 15_000, timeout: 25_000 };

async function lockStudent(tx: Tx, studentId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${studentId}::uuid FOR UPDATE`;
  return tx.student.findUniqueOrThrow({ where: { id: studentId }, include: { user: true } });
}
async function lockCopy(tx: Tx, copyId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Copy" WHERE "id" = ${copyId}::uuid FOR UPDATE`;
}
async function history(tx: Tx, entity: string, entityId: string, fromStatus: string | null, toStatus: string, actorId?: string, reason?: string) {
  await tx.statusHistory.create({ data: { entity, entityId, fromStatus, toStatus, actorId, reason } });
}
async function audit(tx: Tx, action: string, entity: string, entityId: string, userId?: string, details?: Prisma.InputJsonObject) {
  await tx.auditLog.create({ data: { userId, action, entity, entityId, details } });
}
async function notify(tx: Tx, userId: string, type: string, content: string, dedupeKey: string) {
  await tx.notification.upsert({ where: { dedupeKey }, create: { userId, type, content, dedupeKey }, update: {} });
}

/** All callers hold this student's row lock, serializing concurrent requests
 * even when the requests target different physical copies. */
async function refusalReason(tx: Tx, studentId: string, now: Date, currentReservationId?: string): Promise<string | null> {
  const student = await tx.student.findUniqueOrThrow({ where: { id: studentId }, include: { user: true } });
  if (!student.user.active) return 'Votre compte est désactivé. Contactez la bibliothèque.';
  if (!student.verified || !student.studentNumber) return 'Votre identité universitaire doit être vérifiée avant de pouvoir emprunter.';
  const restriction = await tx.sanction.findFirst({ where: {
    studentId, status: 'ACTIVE', type: { in: ['BAN', 'SUSPENSION'] }, startsAt: { lte: now },
    OR: [{ endsAt: null }, { endsAt: { gt: now } }],
  }, orderBy: { createdAt: 'desc' } });
  if (restriction) return restriction.type === 'BAN'
    ? 'Votre droit d’emprunt fait l’objet d’une interdiction. Contactez la bibliothèque pour une contestation.'
    : `Votre droit d’emprunt est suspendu${restriction.endsAt ? ` jusqu’au ${restriction.endsAt.toISOString()}` : ''}.`;
  if (await tx.loan.count({ where: { studentId, status: { in: ['ACTIVE', 'OVERDUE'] }, dueAt: { lt: now } } })) {
    return 'Un emprunt est en retard. Rapportez cet exemplaire avant toute nouvelle remise ou réservation.';
  }
  const [settings, loans, reservations] = await Promise.all([
    tx.librarySettings.findUniqueOrThrow({ where: { id: 'singleton' } }),
    tx.loan.count({ where: { studentId, status: { in: ['ACTIVE', 'OVERDUE'] } } }),
    tx.reservation.count({ where: {
      studentId, status: 'ACTIVE', expiresAt: { gt: now }, ...(currentReservationId ? { id: { not: currentReservationId } } : {}),
    } }),
  ]);
  if (loans + reservations >= settings.maxLoans) return `La limite de ${settings.maxLoans} emprunts et réservations cumulés est atteinte.`;
  return null;
}

export async function requestBorrow(userId: string, bookId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    const initialStudent = await tx.student.findUnique({ where: { userId } });
    if (!initialStudent) throw new HttpError(403, 'STUDENT_REQUIRED', 'Un profil étudiant est nécessaire.');
    const student = await lockStudent(tx, initialStudent.id);
    const book = await tx.book.findUnique({ where: { id: bookId } });
    if (!book) throw new HttpError(404, 'BOOK_NOT_FOUND', 'Ouvrage introuvable.');
    let reason = await refusalReason(tx, student.id, now);
    if (!reason && book.archived) reason = 'Cet ouvrage est archivé et ne peut plus être réservé.';
    if (!reason) {
      const duplicate = await tx.reservation.count({ where: { studentId: student.id, status: 'ACTIVE', expiresAt: { gt: now }, copy: { bookId } } });
      const duplicateLoan = await tx.loan.count({ where: { studentId: student.id, status: { in: ['ACTIVE', 'OVERDUE'] }, copy: { bookId } } });
      if (duplicate || duplicateLoan) reason = 'Vous possédez déjà une réservation ou un emprunt actif pour cet ouvrage.';
    }
    let copyId: string | undefined;
    if (!reason) {
      const copies = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT c."id" FROM "Copy" c
        WHERE c."bookId" = ${bookId}::uuid AND c."status" = 'AVAILABLE' AND c."condition" = 'GOOD'
        ORDER BY c."barcode" FOR UPDATE SKIP LOCKED LIMIT 1`;
      copyId = copies[0]?.id;
      if (!copyId) reason = 'Aucun exemplaire disponible. Consultez le catalogue ultérieurement.';
    }
    const request = await tx.borrowRequest.create({ data: { studentId: student.id, bookId, status: reason ? 'REFUSED' : 'ACCEPTED', reason } });
    await history(tx, 'BorrowRequest', request.id, 'PENDING', request.status, userId, reason ?? undefined);
    if (reason || !copyId) {
      await notify(tx, userId, 'REQUEST_REFUSED', `Demande pour « ${book.title} » refusée : ${reason}`, `request-refused:${request.id}`);
      await audit(tx, 'REQUEST_REFUSED', 'BorrowRequest', request.id, userId, { reason: reason ?? '' });
    } else {
      const settings = await tx.librarySettings.findUniqueOrThrow({ where: { id: 'singleton' } });
      const expiresAt = new Date(now.getTime() + settings.pickupHours * 3_600_000);
      await tx.copy.update({ where: { id: copyId }, data: { status: 'RESERVED' } });
      const reservation = await tx.reservation.create({ data: { requestId: request.id, studentId: student.id, copyId, expiresAt } });
      await history(tx, 'Copy', copyId, 'AVAILABLE', 'RESERVED', userId);
      await history(tx, 'Reservation', reservation.id, null, 'ACTIVE', userId);
      await notify(tx, userId, 'REQUEST_ACCEPTED', `« ${book.title} » vous attend au guichet. Présentez votre carte avant le ${expiresAt.toISOString()}.`, `request-accepted:${request.id}`);
      await audit(tx, 'REQUEST_ACCEPTED', 'BorrowRequest', request.id, userId, { reservationId: reservation.id, copyId });
    }
    return tx.borrowRequest.findUniqueOrThrow({ where: { id: request.id }, include: { book: { include: { authors: true, categories: true } }, reservation: { include: { copy: true } } } });
  }, transactionOptions);
}

export async function cancelRequest(userId: string, requestId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    const initial = await tx.borrowRequest.findUnique({ where: { id: requestId }, include: { student: true, reservation: true } });
    if (!initial || initial.student.userId !== userId) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'Demande introuvable.');
    await lockStudent(tx, initial.studentId);
    if (initial.reservation) await lockCopy(tx, initial.reservation.copyId);
    const request = await tx.borrowRequest.findUniqueOrThrow({ where: { id: requestId }, include: { reservation: true, book: true } });
    if (request.status !== 'ACCEPTED' || !request.reservation || request.reservation.status !== 'ACTIVE') {
      throw new HttpError(409, 'REQUEST_NOT_CANCELLABLE', 'Seule une réservation active peut être annulée.');
    }
    if (request.reservation.expiresAt <= now) throw new HttpError(409, 'RESERVATION_EXPIRED', 'Le délai de récupération est écoulé.');
    await tx.reservation.update({ where: { id: request.reservation.id }, data: { status: 'CANCELLED' } });
    await tx.borrowRequest.update({ where: { id: request.id }, data: { status: 'CANCELLED', reason: 'Annulée par l’étudiant.' } });
    await tx.copy.update({ where: { id: request.reservation.copyId }, data: { status: 'AVAILABLE' } });
    await history(tx, 'Reservation', request.reservation.id, 'ACTIVE', 'CANCELLED', userId);
    await history(tx, 'BorrowRequest', request.id, 'ACCEPTED', 'CANCELLED', userId);
    await history(tx, 'Copy', request.reservation.copyId, 'RESERVED', 'AVAILABLE', userId);
    await notify(tx, userId, 'RESERVATION_CANCELLED', `Votre réservation de « ${request.book.title} » a été annulée.`, `reservation-cancelled:${request.reservation.id}`);
    await audit(tx, 'RESERVATION_CANCELLED', 'Reservation', request.reservation.id, userId);
    return { ok: true };
  }, transactionOptions);
}

export async function handover(actorId: string, reservationId: string, input: { studentNumber: string; barcode: string }, now = new Date()) {
  // Makes the expiration effective immediately even between two scheduler ticks.
  await expireReservations(now);
  return prisma.$transaction(async tx => {
    const initial = await tx.reservation.findUnique({ where: { id: reservationId } });
    if (!initial) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Réservation introuvable.');
    const student = await lockStudent(tx, initial.studentId);
    await lockCopy(tx, initial.copyId);
    const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { copy: { include: { book: true } }, request: true } });
    if (reservation.status !== 'ACTIVE' || reservation.expiresAt <= now || reservation.request.status !== 'ACCEPTED') {
      throw new HttpError(409, 'RESERVATION_INACTIVE', 'Cette réservation est expirée, annulée ou déjà remise.');
    }
    if (student.studentNumber !== input.studentNumber.trim() || reservation.copy.barcode !== input.barcode.trim()) {
      throw new HttpError(409, 'IDENTITY_OR_COPY_MISMATCH', 'Le numéro étudiant ou le code de l’exemplaire ne correspond pas à cette réservation.');
    }
    if (reservation.copy.status !== 'RESERVED' || reservation.copy.condition !== 'GOOD' || reservation.copy.book.archived) {
      throw new HttpError(409, 'COPY_NOT_LENDABLE', 'Cet exemplaire ne peut pas être remis.');
    }
    const reason = await refusalReason(tx, student.id, now, reservation.id);
    if (reason) throw new HttpError(409, 'STUDENT_INELIGIBLE', reason);
    const settings = await tx.librarySettings.findUniqueOrThrow({ where: { id: 'singleton' } });
    await tx.reservation.update({ where: { id: reservationId }, data: { status: 'COLLECTED' } });
    await tx.copy.update({ where: { id: reservation.copyId }, data: { status: 'LOANED' } });
    const loan = await tx.loan.create({ data: {
      reservationId, studentId: student.id, copyId: reservation.copyId, status: 'ACTIVE', handedAt: now,
      dueAt: new Date(now.getTime() + settings.loanDays * day), handedById: actorId,
    }, include: { copy: { include: { book: true } }, student: { include: { user: { select: { id: true, name: true, email: true } } } } } });
    await history(tx, 'Reservation', reservationId, 'ACTIVE', 'COLLECTED', actorId);
    await history(tx, 'Copy', reservation.copyId, 'RESERVED', 'LOANED', actorId);
    await history(tx, 'Loan', loan.id, null, 'ACTIVE', actorId);
    await notify(tx, student.userId, 'LOAN_CONFIRMED', `Remise de « ${reservation.copy.book.title} » confirmée. Retour attendu le ${loan.dueAt.toISOString()}.`, `loan-confirmed:${loan.id}`);
    await audit(tx, 'LOAN_HANDOVER', 'Loan', loan.id, actorId, { reservationId, copyId: reservation.copyId, studentId: student.id });
    return loan;
  }, transactionOptions);
}

export async function returnLoan(actorId: string, loanId: string, input: { condition: PhysicalCondition; damageSeverity?: 'MINOR' | 'SEVERE' }, now = new Date()) {
  return prisma.$transaction(async tx => {
    const initial = await tx.loan.findUnique({ where: { id: loanId } });
    if (!initial) throw new HttpError(404, 'LOAN_NOT_FOUND', 'Emprunt introuvable.');
    const student = await lockStudent(tx, initial.studentId);
    await lockCopy(tx, initial.copyId);
    const loan = await tx.loan.findUniqueOrThrow({ where: { id: loanId }, include: { copy: { include: { book: true } } } });
    if (loan.status === 'CLOSED') throw new HttpError(409, 'LOAN_ALREADY_CLOSED', 'Le retour de cet exemplaire a déjà été enregistré.');
    if (input.condition === 'DAMAGED' && !input.damageSeverity) throw new HttpError(400, 'DAMAGE_SEVERITY_REQUIRED', 'Précisez la gravité de la détérioration.');
    if (loan.dueAt < now) await applyInfraction(tx, { studentId: student.id, userId: student.userId, loanId, type: 'LATE', priceDh: loan.copy.book.priceDh, now });
    const infractionType = input.condition === 'LOST' ? 'LOSS' : input.condition === 'DAMAGED' ? (input.damageSeverity === 'MINOR' ? 'DAMAGE_MINOR' : 'DAMAGE_SEVERE') : null;
    if (infractionType) await applyInfraction(tx, { studentId: student.id, userId: student.userId, loanId, type: infractionType, priceDh: loan.copy.book.priceDh, now });
    await tx.loan.update({ where: { id: loanId }, data: { status: 'CLOSED', returnedAt: now, returnedById: actorId } });
    const copyStatus = input.condition === 'GOOD' ? 'AVAILABLE' : 'WITHDRAWN';
    await tx.copy.update({ where: { id: loan.copyId }, data: { condition: input.condition, status: copyStatus } });
    await history(tx, 'Loan', loanId, loan.status, 'CLOSED', actorId);
    await history(tx, 'Copy', loan.copyId, 'LOANED', copyStatus, actorId, `État au retour : ${input.condition}${input.damageSeverity ? ` / ${input.damageSeverity}` : ''}`);
    await notify(tx, student.userId, 'LOAN_RETURNED', `Retour de « ${loan.copy.book.title} » enregistré${input.condition === 'GOOD' ? '' : ' ; exemplaire retiré de la circulation'}.`, `loan-returned:${loanId}`);
    await audit(tx, 'LOAN_RETURN', 'Loan', loanId, actorId, { condition: input.condition, damageSeverity: input.damageSeverity ?? null });
    return tx.loan.findUniqueOrThrow({ where: { id: loanId }, include: { copy: { include: { book: true } }, infractions: { include: { sanctions: true } } } });
  }, transactionOptions);
}

export async function expireReservations(now = new Date()) {
  const candidates = await prisma.reservation.findMany({ where: { status: 'ACTIVE', expiresAt: { lte: now } }, select: { id: true, studentId: true, copyId: true }, orderBy: { expiresAt: 'asc' }, take: 500 });
  let expired = 0;
  for (const candidate of candidates) {
    const changed = await prisma.$transaction(async tx => {
      const student = await lockStudent(tx, candidate.studentId);
      await lockCopy(tx, candidate.copyId);
      const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: candidate.id }, include: { copy: { include: { book: true } } } });
      if (reservation.status !== 'ACTIVE' || reservation.expiresAt > now) return false;
      await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'EXPIRED' } });
      await tx.borrowRequest.update({ where: { id: reservation.requestId }, data: { status: 'EXPIRED', reason: 'Délai de récupération dépassé.' } });
      await tx.copy.update({ where: { id: reservation.copyId }, data: { status: reservation.copy.condition === 'GOOD' ? 'AVAILABLE' : 'WITHDRAWN' } });
      await history(tx, 'Reservation', reservation.id, 'ACTIVE', 'EXPIRED', undefined, 'Délai de récupération dépassé.');
      await history(tx, 'BorrowRequest', reservation.requestId, 'ACCEPTED', 'EXPIRED');
      await history(tx, 'Copy', reservation.copyId, 'RESERVED', reservation.copy.condition === 'GOOD' ? 'AVAILABLE' : 'WITHDRAWN');
      await notify(tx, student.userId, 'RESERVATION_EXPIRED', `Votre réservation de « ${reservation.copy.book.title} » a expiré. L’exemplaire a été libéré.`, `reservation-expired:${reservation.id}`);
      await audit(tx, 'RESERVATION_EXPIRED', 'Reservation', reservation.id);
      return true;
    }, transactionOptions);
    if (changed) expired++;
  }
  return expired;
}

export async function processOverdue(now = new Date()) {
  const candidates = await prisma.loan.findMany({ where: { status: { in: ['ACTIVE', 'OVERDUE'] }, dueAt: { lt: now }, infractions: { none: { type: 'LATE' } } }, select: { id: true, studentId: true, copyId: true }, take: 500 });
  let processed = 0;
  for (const candidate of candidates) {
    const changed = await prisma.$transaction(async tx => {
      const student = await lockStudent(tx, candidate.studentId);
      await lockCopy(tx, candidate.copyId);
      const loan = await tx.loan.findUniqueOrThrow({ where: { id: candidate.id }, include: { copy: { include: { book: true } } } });
      if (loan.status === 'CLOSED' || loan.dueAt >= now) return false;
      const sanction = await applyInfraction(tx, { studentId: student.id, userId: student.userId, loanId: loan.id, type: 'LATE', priceDh: loan.copy.book.priceDh, now });
      if (!sanction) return false;
      await tx.loan.update({ where: { id: loan.id }, data: { status: 'OVERDUE' } });
      await history(tx, 'Loan', loan.id, loan.status, 'OVERDUE');
      await notify(tx, student.userId, 'LOAN_OVERDUE', `Le retour de « ${loan.copy.book.title} » est en retard. Merci de rapporter cet exemplaire au guichet.`, `loan-overdue:${loan.id}`);
      await audit(tx, 'LOAN_OVERDUE', 'Loan', loan.id);
      return true;
    }, transactionOptions);
    if (changed) processed++;
  }
  return processed;
}

export async function generateReminders(now = new Date()) {
  const [reservations, loans] = await Promise.all([
    prisma.reservation.findMany({ where: { status: 'ACTIVE', expiresAt: { gt: now, lte: new Date(now.getTime() + 6 * 3_600_000) } }, include: { student: true, copy: { include: { book: true } } } }),
    prisma.loan.findMany({ where: { status: 'ACTIVE', dueAt: { gt: now, lte: new Date(now.getTime() + 2 * day) } }, include: { student: true, copy: { include: { book: true } } } }),
  ]);
  for (const r of reservations) {
    await prisma.notification.upsert({ where: { dedupeKey: `pickup-reminder:${r.id}` }, create: { userId: r.student.userId, type: 'PICKUP_REMINDER', content: `Dernières heures pour récupérer « ${r.copy.book.title} » : échéance ${r.expiresAt.toISOString()}.`, dedupeKey: `pickup-reminder:${r.id}` }, update: {} });
  }
  for (const l of loans) {
    await prisma.notification.upsert({ where: { dedupeKey: `return-reminder:${l.id}` }, create: { userId: l.student.userId, type: 'RETURN_REMINDER', content: `Pensez à rapporter « ${l.copy.book.title} » avant le ${l.dueAt.toISOString()}.`, dedupeKey: `return-reminder:${l.id}` }, update: {} });
  }
  return { reservations: reservations.length, loans: loans.length };
}
