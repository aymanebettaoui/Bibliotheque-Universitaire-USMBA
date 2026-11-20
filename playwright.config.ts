import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const useExistingServer = process.env.E2E_USE_EXISTING_TEST_SERVER === 'true';
const startServers = !useExistingServer && process.env.E2E_START_SERVERS !== 'false';
const baseURL = process.env.TEST_BASE_URL || (startServers ? 'http://localhost:5174' : 'http://localhost:5173');
const base = new URL(baseURL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
  throw new Error('Les tests de démonstration Playwright sont limités à un serveur local.');
}
if (startServers && base.protocol !== 'http:') {
  throw new Error('Le démarrage automatique E2E exige une origine HTTP locale dédiée.');
}
export default defineConfig({
  globalSetup: './scripts/verify-e2e-mode.ts',
  testDir: './frontend/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'work/playwright-report', open: 'never' }]],
  outputDir: 'work/playwright-results',
  use: {
    baseURL,
    locale: 'fr-FR',
    timezoneId: 'Africa/Casablanca',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: startServers ? {
    command: 'node scripts/start-e2e.mjs',
    url: new URL('/api/health', baseURL).toString(),
    timeout: 120_000,
    reuseExistingServer: false,
    env: { TEST_BASE_URL: baseURL, E2E_API_PORT: process.env.E2E_API_PORT || '3002' },
  } : undefined,
});
