import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
config();
if (process.env.DEMO_MODE !== 'true' || process.env.NODE_ENV === 'production') {
  throw new Error('Réinitialisation réservée à la démonstration locale (DEMO_MODE=true et NODE_ENV différent de production).');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant.');
const reset = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'reset', '--force', '--skip-seed', '--schema', 'backend/prisma/schema.prisma'], { stdio: 'inherit', env: process.env });
if (reset.status !== 0) process.exit(reset.status ?? 1);
const seed = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--env-file=.env', 'backend/prisma/seed.ts'], { stdio: 'inherit', env: process.env });
process.exit(seed.status ?? 1);
