import { defineConfig, devices } from '@playwright/test';

const repositoryBasePath = '/georgia-routing-planner/';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Hosted runners cannot reliably sustain two simultaneous WebGL maps plus DEM and
  // contour decoding. Serialize CI browsers and leave measured headroom for the
  // longest satellite workflow; local development retains two workers.
  timeout: process.env.CI ? 45_000 : 30_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:4173${repositoryBasePath}`,
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
