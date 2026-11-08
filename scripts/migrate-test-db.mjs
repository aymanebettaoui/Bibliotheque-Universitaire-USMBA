import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
config();
const target = process.env.TEST_DATABASE_URL;
if (!target || !/^\/[a-zA-Z0-9_]+_test$/.test(new URL(target).pathname) || target === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL doit désigner une base dédiée se terminant par _test, différente de DATABASE_URL.');
}
const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'backend/prisma/schema.prisma'], {
  stdio: 'inherit', env: { ...process.env, DATABASE_URL: target },
});
process.exit(result.status ?? 1);
