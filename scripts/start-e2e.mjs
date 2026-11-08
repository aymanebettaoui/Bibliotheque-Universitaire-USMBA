import { spawn, spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const testDatabase = process.env.TEST_DATABASE_URL;
if (!testDatabase || !new URL(testDatabase).pathname.endsWith('_test') || testDatabase === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL doit être distincte de DATABASE_URL et désigner une base dont le nom se termine par _test.');
}
const base = new URL(process.env.TEST_BASE_URL || 'http://localhost:5173');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.port !== '5173') {
  throw new Error('Ce lanceur utilise exclusivement le serveur local au port 5173.');
}
const childEnv = {
  ...process.env,
  DATABASE_URL: testDatabase,
  NODE_ENV: 'test',
  DEMO_MODE: 'true',
  APP_ORIGIN: base.origin,
  PORT: '3001',
};
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const options = { env: childEnv, stdio: 'inherit', shell: process.platform === 'win32' };
// No reset or truncation: migrate the dedicated database and seed only when
// empty. The scenario archives its own book and preserves the circulation log.
for (const script of ['db:migrate', 'db:seed']) {
  const result = spawnSync(npm, ['run', script], options);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.info('E2E : démarrage de la démonstration sur la base dédiée de tests.');
const child = spawn(npm, ['run', 'dev'], options);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(signal); });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
