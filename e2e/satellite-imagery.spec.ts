import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { installMapProviderFixtures } from './installMapProviderFixtures';

test.beforeEach(async ({ page }) => {
  await installMapProviderFixtures(page);
});

test('auto mode routes a CORS-hidden TiTiler 429 to the direct COG without retrying', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const rendererRequests: string[] = [];
  const cogRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://titiler.xyz/stac/tiles/')) {
      rendererRequests.push(request.url());
    }
    if (request.url().startsWith('https://sentinel-cogs.example.test/')) {
      cogRequests.push(request.url());
    }
  });
  await page.route('https://titiler.xyz/stac/tiles/**', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'text/plain',
      body: 'Too Many Requests',
    }),
  );

  await page.goto('?developer=1#satellite');
  await expect(page.getByTestId('map-workspace')).toHaveAttribute(
    'data-map-state',
    'ready',
    { timeout: 15_000 },
  );
  await page.getByRole('button', { name: 'Open settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Rendering' }).click();
  await expect(
    settings.getByRole('combobox', { name: 'Satellite render' }),
  ).toContainText('Auto');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Search images' }).click();
  await page.getByRole('button', { name: 'Apply 9 Jul 2026 imagery' }).click();
  await expect(
    page.getByText(
      'TiTiler is unavailable. Switching to direct pre-rendered Sentinel imagery.',
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => cogRequests.length).toBeGreaterThan(0);
  expect(rendererRequests.length).toBeGreaterThan(0);
  expect(new Set(rendererRequests).size).toBe(rendererRequests.length);
});

test('applies and hides a Sentinel scene without restoring it after reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
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
  await expect(
    page.getByTestId('map-workspace').getByText(/Earth Search \/ Element 84/u),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('tab', { name: 'Rendering' }).click();
  const reflectanceCeiling = page.getByRole('slider', {
    name: 'Sentinel reflectance ceiling',
  });
  await reflectanceCeiling.fill('6250');
  await page.getByRole('combobox', { name: 'Contour distance' }).click();
  await page.getByRole('option', { name: '25 m' }).click();
  await page
    .getByRole('switch', {
      name: 'Show relief shading above satellite imagery',
    })
    .check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect
    .poll(() => rendererRequests.some((url) => url.includes('rescale=0%2C6250')))
    .toBe(true);

  await page
    .getByRole('button', { name: 'Developer diagnostics', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Map' }).click();
  const sources = await page
    .getByRole('list', { name: 'Ordered map sources' })
    .getByRole('listitem')
    .allTextContents();
  expect(sources).toEqual(expect.arrayContaining(['terrain-dem', 'terrain-contours']));
  const layers = await page
    .getByRole('list', { name: 'Ordered map layers' })
    .getByRole('listitem')
    .allTextContents();
  const satelliteIndex = layers.findIndex((id) => id.startsWith('sentinel-raster-'));
  const reliefIndex = layers.indexOf('terrain-relief-shade');
  const contourIndex = layers.indexOf('terrain-contour-minor');
  const boundaryIndex = layers.indexOf('basemap-boundaries');
  expect(satelliteIndex).toBeGreaterThanOrEqual(0);
  expect(reliefIndex).toBeGreaterThan(satelliteIndex);
  expect(contourIndex).toBeGreaterThan(reliefIndex);
  expect(boundaryIndex).toBeGreaterThan(contourIndex);
  await page
    .getByRole('button', { name: 'Close developer diagnostics', exact: true })
    .click();

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
  await expect.poll(() => rendererRequests.length).toBe(requestsBeforeReload);
  await expect(
    page.getByRole('checkbox', { name: 'Satellite imagery' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('tab', { name: 'Rendering' }).click();
  await expect(
    page.getByRole('slider', { name: 'Sentinel reflectance ceiling' }),
  ).toHaveValue('6250');
  await expect(page.getByRole('combobox', { name: 'Contour distance' })).toContainText(
    '25 m',
  );
  await expect(
    page.getByRole('switch', {
      name: 'Show relief shading above satellite imagery',
    }),
  ).toBeChecked();
});
