import { defineConfig, devices } from '@playwright/test';

const repositoryBasePath = '/georgia-routing-planner/';
const previewPort = process.env.E2E_PORT ?? '4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Hosted software rendering can make map, DEM, persistence, and diagnostics work
  // several times slower than a desktop run. Keep explicit headroom without retries so
  // a genuine failure is reported once with its original artifacts.
  timeout: process.env.CI ? 120_000 : 90_000,
  expect: { timeout: process.env.CI ? 20_000 : 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${previewPort}${repositoryBasePath}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
