import { defineConfig, devices } from '@playwright/test';

const repositoryBasePath = '/georgia-routing-planner/';
const previewPort = process.env.E2E_PORT ?? '4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Four to six concurrent agent workstreams are normal on the managed Windows host.
  // Keep one worker and CI-sized timing locally so agents do not compete through many
  // Chromium processes or ratchet timeouts after resource-contention failures.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
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
