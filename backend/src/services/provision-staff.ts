/** Privileged local CLI. No HTTP route or public role selection. */
import { z } from 'zod';
import { prisma } from '../config/db.js';

const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const schema = z.object({
  email: z.string().email().transform(value => value.toLowerCase()),
  name: z.string().trim().min(2).max(100),
  role: z.enum(['ADMIN', 'LIBRARIAN']),
  googleSub: z.string().regex(/^[0-9]{10,255}$/).optional(),
});

async function main() {
  if (!args.includes('--confirm-local-admin-access')) {
    throw new Error('Procédure réservée à l’administrateur du serveur. Ajoutez --confirm-local-admin-access après vérification de l’adresse Google du personnel.');
  }
  const input = schema.parse({ email: value('--email'), name: value('--name'), role: value('--role'), googleSub: value('--google-sub') });
  const user = await prisma.$transaction(async tx => {
    const existing = await tx.user.findUnique({ where: { email: input.email } });
    if (existing) throw new Error('Compte déjà existant. Utilisez la gestion administrative authentifiée pour modifier un rôle.');
    const created = await tx.user.create({ data: { ...input, active: true } });
    await tx.auditLog.create({ data: { userId: created.id, action: 'STAFF_PROVISIONED_LOCAL_CLI', entity: 'User', entityId: created.id, details: { role: input.role, googleSubjectPrebound: !!input.googleSub } } });
    return created;
  });
  console.log(`Compte ${user.role} créé (${user.id}). Connexion exclusivement avec l’identité Google préautorisée.`);
}
main().catch(error => { console.error(error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') : error instanceof Error ? error.message : 'Échec de provisionnement.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
