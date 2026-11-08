import { Prisma, type InfractionType } from '@prisma/client';

type Tx = Prisma.TransactionClient;
const day = 86_400_000;

/** Called with the Student row lock held. The third-late counter remains at 3
 * until its suspension has ended (or been administratively revoked). */
export async function resetExpiredLateCycle(tx: Tx, studentId: string, now: Date) {
  const student = await tx.student.findUniqueOrThrow({ where: { id: studentId } });
  if (student.lateCycle < 3 || student.suspensions >= 2) return false;
  const suspension = await tx.sanction.findFirst({
    where: { studentId, type: 'SUSPENSION', infraction: { type: 'LATE' } },
    orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
  });
  if (!suspension || !(suspension.status === 'REVOKED' || (suspension.endsAt && suspension.endsAt <= now))) return false;
  await tx.student.update({ where: { id: studentId }, data: { lateCycle: 0 } });
  await tx.auditLog.create({ data: { action: 'LATE_CYCLE_RESET', entity: 'Student', entityId: studentId,
    details: { suspensionId: suspension.id, cause: suspension.status === 'REVOKED' ? 'ADMINISTRATIVE_REVOCATION' : 'SUSPENSION_ENDED', from: student.lateCycle, to: 0 } } });
  await tx.notification.create({ data: { userId: student.userId, type: 'LATE_CYCLE_RESET',
    content: 'Le compteur du cycle de retards a été remis à zéro après la fin ou la correction de votre suspension.',
    dedupeKey: `late-cycle-reset:${suspension.id}` } });
  return true;
}

/** Called only after locking the Student row. The unique infraction key is a
 * second line of defence against repeated scheduler/return processing. */
export async function applyInfraction(
  tx: Tx,
  input: { studentId: string; userId: string; loanId: string; type: InfractionType; priceDh: Prisma.Decimal; now: Date },
) {
  const existing = await tx.infraction.findUnique({ where: { loanId_type: { loanId: input.loanId, type: input.type } } });
  if (existing) return null;
  const infraction = await tx.infraction.create({ data: { studentId: input.studentId, loanId: input.loanId, type: input.type, createdAt: input.now } });
  const settings = await tx.librarySettings.findUniqueOrThrow({ where: { id: 'singleton' } });
  let type: 'WARNING' | 'SUSPENSION' | 'BAN' | 'FINE' = 'WARNING';
  let amountDh: Prisma.Decimal | undefined;
  let endsAt: Date | undefined;
  let reason = 'Retard constaté : avertissement sans suspension.';

  if (input.type === 'LATE') {
    // A return can arrive between scheduler ticks: reset at the exact expiry
    // before counting the next incident, while still holding the student lock.
    await resetExpiredLateCycle(tx, input.studentId, input.now);
    const student = await tx.student.findUniqueOrThrow({ where: { id: input.studentId } });
    const currentRestriction = await tx.sanction.findFirst({ where: {
      studentId: input.studentId, status: 'ACTIVE', startsAt: { lte: input.now },
      type: { in: ['SUSPENSION', 'BAN'] }, infraction: { type: 'LATE' },
      OR: [{ endsAt: null }, { endsAt: { gt: input.now } }],
    } });
    if (currentRestriction) {
      // Existing physical loans may become late during a suspension. Keep the
      // full incident history without creating overlapping cycles/suspensions.
      reason = 'Retard supplémentaire pendant une restriction pour retard : avertissement conservé dans l’historique, sans nouveau cycle ni nouvelle suspension.';
    } else {
      const nextCycle = student.lateCycle + 1;
      if (nextCycle >= 3) {
        const suspensions = student.suspensions + 1;
        await tx.student.update({ where: { id: student.id }, data: { lateCycle: 3, suspensions } });
        if (suspensions >= 2) {
          type = 'BAN';
          reason = 'Deuxième cycle de trois retards : interdiction définitive selon les règles de démonstration.';
        } else {
          type = 'SUSPENSION';
          endsAt = new Date(input.now.getTime() + settings.lateSuspensionDays * day);
          reason = `Troisième retard : suspension de ${settings.lateSuspensionDays} jours. Le compteur du cycle sera remis à zéro à la fin de cette suspension.`;
        }
      } else {
        await tx.student.update({ where: { id: student.id }, data: { lateCycle: nextCycle } });
        reason = `${nextCycle === 1 ? 'Premier' : 'Deuxième'} retard du cycle : avertissement sans suspension.`;
      }
    }
  } else if (input.type === 'LOSS') {
    type = 'FINE';
    amountDh = input.priceDh.mul(input.priceDh.greaterThan(100) ? '0.75' : '1').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    reason = 'Perte d’un exemplaire : indemnité de remplacement selon les règles de démonstration.';
  } else if (input.type === 'DAMAGE_MINOR') {
    type = 'SUSPENSION';
    endsAt = new Date(input.now.getTime() + settings.minorDamageDays * day);
    reason = `Détérioration légère : suspension de ${settings.minorDamageDays} jours.`;
  } else if (input.type === 'DAMAGE_SEVERE') {
    type = 'FINE';
    amountDh = input.priceDh.mul('0.5').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    reason = 'Détérioration grave rendant l’exemplaire inutilisable : indemnité de 50 % du prix.';
  }

  const sanction = await tx.sanction.create({ data: {
    studentId: input.studentId, infractionId: infraction.id, type, status: 'ACTIVE',
    amountDh, startsAt: input.now, endsAt, reason,
  } });
  await tx.notification.create({ data: {
    userId: input.userId, type: type === 'SUSPENSION' || type === 'BAN' ? 'BORROWING_RESTRICTED' : 'SANCTION_RECORDED',
    content: `${reason}${amountDh ? ` Montant : ${amountDh.toFixed(2)} DH. Règlement auprès du personnel.` : ''}`,
    dedupeKey: `sanction:${sanction.id}`,
  } });
  await tx.auditLog.create({ data: { action: 'SANCTION_APPLIED', entity: 'Sanction', entityId: sanction.id,
    details: { studentId: input.studentId, infractionId: infraction.id, type, amountDh: amountDh?.toFixed(2) ?? null } } });
  return sanction;
}
