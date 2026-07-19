import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { installMapProviderFixtures } from './installMapProviderFixtures';

test.beforeEach(async ({ page }) => {
  await installMapProviderFixtures(page);
});

test('applies, hides, restores, and preserves a Sentinel scene across workspaces', async ({
  page,
}) => {
  const rendererRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://titiler.xyz/stac/tiles/')) {
      rendererRequests.push(request.url());
    }
  });

  await page.goto('?developer=1#satellite');
  await expect(page.getByTestId('map-workspace')).toHaveAttribute(
    'data-map-state',
    'ready',
    { timeout: 15_000 },
  );
  await page.getByRole('button', { name: 'Search images' }).click();
  const card = page.getByRole('button', { name: 'Apply 9 Jul 2026 imagery' });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByText('True-color imagery applied')).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(() => rendererRequests.length).toBeGreaterThan(0);
  expect(rendererRequests[0]).toContain(
    'url=https%3A%2F%2Fearth-search.example.test%2Fv1%2Fcollections%2Fsentinel-2-l2a%2Fitems',
  );
  expect(rendererRequests[0]).toContain(
    'assets=red&assets=green&assets=blue&asset_as_band=true',
  );
  await expect(page.getByText(/COG tiles rendered by TiTiler/u)).toBeVisible();

  await page.getByRole('button', { name: 'Open settings' }).click();
  const reflectanceCeiling = page.getByRole('slider', {
    name: 'Sentinel reflectance ceiling',
  });
  await reflectanceCeiling.fill('6250');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect
    .poll(() => rendererRequests.some((url) => url.includes('rescale=0%2C6250')))
    .toBe(true);

  await page.getByRole('tab', { name: 'Layers' }).click();
  const imagery = page.getByRole('checkbox', { name: 'Satellite imagery' });
  const footprint = page.getByRole('checkbox', { name: 'Scene footprint' });
  await expect(imagery).toBeEnabled();
  await expect(footprint).toBeEnabled();
  await imagery.uncheck();
  await expect(imagery).not.toBeChecked();
  await expect(footprint).toBeChecked();
  await imagery.check();
  await expect(imagery).toBeChecked();
  const roads = page.getByRole('checkbox', { name: 'Roads' });
  await roads.uncheck();

  await page.getByRole('button', { name: 'Show 3D terrain map' }).click();
  await expect(
    page.getByRole('button', { name: 'Show 3D terrain map' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: 'Satellite' }).click();
  await expect(page.getByText('True-color imagery applied')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Images near 42.1000, 43.4000' }),
  ).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .include('[aria-label="Sentinel imagery results"]')
    .analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);

  const requestsBeforeReload = rendererRequests.length;
  await page.getByRole('tab', { name: 'Layers' }).click();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Satellite imagery' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Roads' })).not.toBeChecked();
  await expect
    .poll(() => rendererRequests.length)
    .toBeGreaterThan(requestsBeforeReload);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(
    page.getByRole('slider', { name: 'Sentinel reflectance ceiling' }),
  ).toHaveValue('6250');
});
