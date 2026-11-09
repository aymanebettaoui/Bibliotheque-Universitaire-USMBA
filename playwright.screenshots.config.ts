import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig(baseConfig, {
  testDir: './scripts/screenshots',
  testMatch: 'capture.spec.ts',
  reporter: [['list']],
  outputDir: 'work/screenshots-results',
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1440, height: 900 },
    },
  }],
  use: {
    ...baseConfig.use,
    viewport: { width: 1440, height: 900 },
    screenshot: 'off',
    trace: 'retain-on-failure',
  },
});
