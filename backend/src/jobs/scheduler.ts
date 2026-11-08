import { prisma } from '../config/db.js';
import { expireReservations, generateReminders, processOverdue } from '../services/circulation.js';
import { resetExpiredLateCycle } from '../services/sanctions.js';

let running = false;

/** Resets completed late cycles without requiring a browser or a new loan. */
export async function resetExpiredLateCycles(now = new Date()) {
  const candidates = await prisma.student.findMany({
    where: { lateCycle: { gte: 3 }, suspensions: { lt: 2 }, sanctions: { some: {
      type: 'SUSPENSION', infraction: { type: 'LATE' },
      OR: [{ status: 'REVOKED' }, { endsAt: { lte: now } }],
    } } }, select: { id: true }, take: 500,
  });
  let reset = 0;
  for (const candidate of candidates) {
    const changed = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${candidate.id}::uuid FOR UPDATE`;
      return resetExpiredLateCycle(tx, candidate.id, now);
    });
    if (changed) reset++;
  }
  return reset;
}

/** Database-backed idempotency allows multiple workers. This process guard
 * prevents overlapping timer invocations in one Node.js instance. */
export async function sweepJobs(now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  try {
    const expired = await expireReservations(now);
    const resetLateCycles = await resetExpiredLateCycles(now);
    const overdue = await processOverdue(now);
    const reminders = await generateReminders(now);
    await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
    await prisma.authChallenge.deleteMany({ where: { expiresAt: { lte: new Date(now.getTime() - 86_400_000) } } });
    return { skipped: false, expired, resetLateCycles, overdue, reminders };
  } finally {
    running = false;
  }
}

export function startJobs(intervalMs = 60_000) {
  const run = () => { void sweepJobs().catch((error: unknown) => {
    // No credentials, request bodies or personal details in scheduled-job logs.
    console.error('Library scheduler failed', error instanceof Error ? error.name : 'UnknownError');
  }); };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
