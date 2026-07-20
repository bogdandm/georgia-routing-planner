import { readFile } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { installMapProviderFixtures } from './installMapProviderFixtures';

test.beforeEach(async ({ page }) => {
  await installMapProviderFixtures(page);
});

test('keeps diagnostics persistent and exposes the Sentinel timeline', async ({
  page,
}) => {
  await page.goto('?developer=1');
  const diagnosticsButton = page.getByRole('button', {
    name: 'Developer diagnostics',
    exact: true,
  });

  await diagnosticsButton.click();
  const drawer = page.getByRole('complementary', {
    name: 'Developer diagnostics',
  });
  await expect(drawer).toBeVisible();
  await expect(page.locator('.MuiBackdrop-root')).toHaveCount(0);
  await expect(drawer).toHaveCSS('box-shadow', 'none');

  const sentinelTab = page.getByRole('tab', { name: 'Sentinel query' });
  await sentinelTab.click();
  await expect(sentinelTab).toHaveCSS('border-radius', '0px');
  await expect(sentinelTab.locator('.MuiTouchRipple-root')).toHaveCount(0);
  await expect(page.getByLabel('Sentinel query timeline')).toContainText(
    'No Sentinel operation has run in this browser.',
  );
  await expect(page.getByTestId(/^sentinel-query-step-/u)).toHaveCount(10);

  await page.keyboard.press('Escape');
  await expect(drawer).toBeVisible();
  await page.getByRole('tab', { name: 'Satellite', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Satellite imagery' })).toBeVisible();
  await expect(drawer).toBeVisible();

  await diagnosticsButton.click();
  await expect(drawer).toBeHidden();
  await diagnosticsButton.click();
  await page.getByRole('button', { name: 'Close developer diagnostics' }).click();
  await expect(drawer).toBeHidden();
});

test('captures failures and exports an inspectable redacted bundle', async ({
  page,
}) => {
  await page.goto('?developer=1');
  await expect(page.getByRole('button', { name: 'Developer diagnostics' })).toBeVisible(
    { timeout: 15_000 },
  );

  await page.evaluate(() => {
    setTimeout(() => {
      void Promise.reject(new Error('Synthetic unhandled rejection token=private'));
    }, 0);
  });
  await page.getByRole('button', { name: 'Developer diagnostics' }).click();
  await page.getByRole('tab', { name: 'Map' }).click();
  await expect(page.getByText('Exact current camera')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ordered map sources' })).toContainText(
    'basemap-vector',
    { timeout: 15_000 },
  );
  await page.getByRole('switch', { name: 'Show tile boundaries' }).click();
  const mapDrawerAccessibility = await new AxeBuilder({ page })
    .include('.MuiDrawer-paper')
    .analyze();
  expect(
    mapDrawerAccessibility.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);

  await page.getByRole('tab', { name: 'Overview' }).click();
  await page.getByRole('button', { name: 'Check configured providers' }).click();
  await expect(page.getByText('Vector provider reachability')).toBeVisible();
  await expect(page.getByText('Terrain provider reachability')).toBeVisible();
  await expect(page.getByText('Satellite catalog reachability')).toBeVisible();

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

  expect(bundle.schemaVersion).toBe(3);
  expect(bundle.events.map((event) => event.name)).toContain(
    'react.error-boundary.caught',
  );
  expect(bundle.events.map((event) => event.name)).toContain(
    'runtime.promise.unhandled',
  );
  expect(bundle.map).toMatchObject({
    styleId: 'Georgia hiking basemap v1',
    sourceIds: ['basemap-vector', 'terrain-dem', 'terrain-contours'],
    webGlCapabilities: { contextType: 'webgl2' },
  });
  expect(bundle.map?.layerIds.length).toBeGreaterThan(10);
  expect(serialized).not.toContain('token=private');
});
