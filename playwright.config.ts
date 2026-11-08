import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const baseURL = process.env.TEST_BASE_URL || 'http://localhost:5173';
const base = new URL(baseURL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
  throw new Error('Les tests de démonstration Playwright sont limités à un serveur local.');
}
const startServers = process.env.E2E_START_SERVERS === 'true';
if (startServers && (base.port !== '5173' || base.protocol !== 'http:')) {
  throw new Error('Le démarrage automatique utilise http://localhost:5173. Pour une autre adresse locale, lancez un serveur de TEST puis utilisez E2E_USE_EXISTING_TEST_SERVER=true.');
}
// An existing server must explicitly be identified as a test instance. The
// automatic path always overrides DATABASE_URL with the dedicated _test DB.
if (!startServers && process.env.E2E_USE_EXISTING_TEST_SERVER !== 'true') {
  throw new Error('Utilisez E2E_START_SERVERS=true pour lancer la base de tests isolée, ou E2E_USE_EXISTING_TEST_SERVER=true pour une instance de TEST locale déjà démarrée.');
}

export default defineConfig({
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
    env: { TEST_BASE_URL: baseURL },
  } : undefined,
});
