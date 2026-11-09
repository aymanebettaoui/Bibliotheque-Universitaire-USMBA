/** Privileged local CLI. No HTTP route or public role selection. */
import { z } from 'zod';
import { prisma } from '../config/db.js';

const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const schema = z.object({
  email: z.string().email().transform(value => value.toLowerCase()),
  name: z.string().trim().min(2).max(100),
  googleSub: z.string().regex(/^[0-9]{10,255}$/).optional(),
});

async function main() {
  if (!args.includes('--confirm-local-server-access')) {
    throw new Error('Procédure réservée à l’opérateur du serveur. Ajoutez --confirm-local-server-access après vérification de l’identité du personnel.');
  }
  const input = schema.parse({ email: value('--email'), name: value('--name'), googleSub: value('--google-sub') });
  const grantSensitiveManagement = args.includes('--grant-sensitive-management');
  const user = await prisma.$transaction(async tx => {
    const existing = await tx.user.findUnique({ where: { email: input.email } });
    if (existing) throw new Error('Compte déjà existant. Utilisez une procédure locale contrôlée pour toute évolution de ses habilitations.');
    const created = await tx.user.create({ data: {
      ...input, role: 'LIBRARIAN', active: true,
      canManageUsers: grantSensitiveManagement,
      canManageSettings: grantSensitiveManagement,
      canViewAudit: grantSensitiveManagement,
      canRevokeSanctions: grantSensitiveManagement,
    } });
    await tx.auditLog.create({ data: { userId: created.id, action: 'STAFF_PROVISIONED_LOCAL_CLI', entity: 'User', entityId: created.id, details: { role: 'LIBRARIAN', sensitiveManagement: grantSensitiveManagement, googleSubjectPrebound: !!input.googleSub } } });
    return created;
  });
  console.log(`Compte LIBRARIAN créé (${user.id}). Connexion exclusivement avec l’identité Google préautorisée.`);
}
main().catch(error => { console.error(error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') : error instanceof Error ? error.message : 'Échec de provisionnement.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
