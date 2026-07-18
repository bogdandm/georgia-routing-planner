import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { installMapProviderFixtures } from './installMapProviderFixtures';

test.beforeEach(async ({ page }) => {
  await installMapProviderFixtures(page);
});

test('captures failures and exports an inspectable redacted bundle', async ({
  page,
}) => {
  await page.goto('?developer=1');
  await expect(
    page.getByRole('button', { name: 'Developer diagnostics' }),
  ).toBeVisible();

  await page.evaluate(() => {
    setTimeout(() => {
      void Promise.reject(new Error('Synthetic unhandled rejection token=private'));
    }, 0);
  });
  await page.getByRole('button', { name: 'Developer diagnostics' }).click();
  await page.getByRole('tab', { name: /Logs/ }).click();
  await expect(page.getByText('runtime.promise.unhandled')).toBeVisible();
  await page.getByRole('tab', { name: 'Overview' }).click();
  await page
    .getByRole('button', { name: 'Trigger controlled component failure' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'The application encountered an error' }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagnostics' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  const bundle = JSON.parse(await readFile(downloadPath, 'utf8')) as {
    schemaVersion: number;
    events: { name: string }[];
    map: {
      styleId: string;
      sourceIds: string[];
      layerIds: string[];
      webGlCapabilities: { contextType: string };
    } | null;
  };
  const serialized = JSON.stringify(bundle);

  expect(bundle.schemaVersion).toBe(2);
  expect(bundle.events.map((event) => event.name)).toContain(
    'react.error-boundary.caught',
  );
  expect(bundle.events.map((event) => event.name)).toContain(
    'runtime.promise.unhandled',
  );
  expect(bundle.map).toMatchObject({
    styleId: 'Georgia hiking basemap v1',
    sourceIds: ['basemap-vector'],
    webGlCapabilities: { contextType: 'webgl2' },
  });
  expect(bundle.map?.layerIds.length).toBeGreaterThan(10);
  expect(serialized).not.toContain('token=private');
});
