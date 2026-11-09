import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  E2E_START_SERVERS: 'true',
  TEST_BASE_URL: 'http://localhost:5174',
  E2E_API_PORT: '3002',
};
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});
child.on('error', error => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', code => {
  process.exitCode = code ?? 1;
});
