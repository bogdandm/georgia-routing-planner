import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { installMapProviderFixtures } from './installMapProviderFixtures';

interface StoredCamera {
  readonly longitude: number;
  readonly latitude: number;
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

async function readStoredCamera(page: Page): Promise<StoredCamera | null> {
  return page.evaluate(
    () =>
      new Promise<StoredCamera | null>((resolve, reject) => {
        const openRequest = indexedDB.open('GeorgiaRoutingPlanner');
        openRequest.onerror = () => {
          reject(openRequest.error ?? new Error('Could not open fixture database.'));
        };
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const transaction = database.transaction('settings', 'readonly');
          const getRequest = transaction.objectStore('settings').get('map.camera');
          getRequest.onerror = () => {
            database.close();
            reject(getRequest.error ?? new Error('Could not read camera record.'));
          };
          getRequest.onsuccess = () => {
            const record = getRequest.result as
              { value?: { camera?: StoredCamera } } | undefined;
            database.close();
            resolve(record?.value?.camera ?? null);
          };
        };
      }),
  );
}

test.beforeEach(async ({ page }) => {
  await installMapProviderFixtures(page);
});

test('persists a settled camera and restores it before interaction after reload', async ({
  page,
}) => {
  await page.goto('?developer=1');
  const workspace = page.getByTestId('map-workspace');
  await expect(workspace).toHaveAttribute('data-map-state', 'ready');

  const canvas = page.locator('.maplibregl-canvas');
  await canvas.hover();
  await page.mouse.wheel(0, -600);
  await expect
    .poll(async () => (await readStoredCamera(page))?.zoom ?? null)
    .not.toBeNull();
  const cameraBeforeReload = await readStoredCamera(page);
  expect(cameraBeforeReload).not.toBeNull();
  expect(cameraBeforeReload?.zoom).not.toBeCloseTo(5.8, 1);

  await page.reload();
  await expect(workspace).toHaveAttribute('data-map-state', 'ready');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await readStoredCamera(page))?.longitude)
    .not.toBe(cameraBeforeReload?.longitude);
  const cameraAfterReload = await readStoredCamera(page);

  expect(cameraAfterReload?.zoom).toBeCloseTo(cameraBeforeReload?.zoom ?? 0, 4);
  expect(cameraAfterReload?.bearing).toBeCloseTo(cameraBeforeReload?.bearing ?? 0, 4);
  expect(cameraAfterReload?.pitch).toBeCloseTo(cameraBeforeReload?.pitch ?? 0, 4);
});

test('switches between 2D and synthetic 3D terrain on the same map', async ({
  page,
}) => {
  const terrainRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/elevation-tiles-prod/terrarium/')) {
      terrainRequests.push(request.url());
    }
  });
  await page.goto('?developer=1');
  await expect(page.getByTestId('map-workspace')).toHaveAttribute(
    'data-map-state',
    'ready',
  );

  const flatButton = page.getByRole('button', { name: 'Show flat 2D map' });
  const terrainButton = page.getByRole('button', {
    name: 'Show 3D terrain map',
  });
  const canvas = page.locator('.maplibregl-canvas');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await readStoredCamera(page))?.longitude ?? null)
    .not.toBeNull();
  const cameraBeforeTerrain = await readStoredCamera(page);
  await terrainButton.click();
  await expect(terrainButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => terrainRequests.length).toBeGreaterThan(0);
  await expect(page.getByText(/Terrain data:/)).toBeVisible();

  await flatButton.click();
  await expect(flatButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readStoredCamera(page))?.pitch).toBe(0);
  const cameraAfterTerrain = await readStoredCamera(page);
  expect(cameraAfterTerrain?.longitude).toBeCloseTo(
    cameraBeforeTerrain?.longitude ?? 0,
    4,
  );
  expect(cameraAfterTerrain?.latitude).toBeCloseTo(
    cameraBeforeTerrain?.latitude ?? 0,
    4,
  );
  expect(cameraAfterTerrain?.zoom).toBeCloseTo(cameraBeforeTerrain?.zoom ?? 0, 4);
  expect(cameraAfterTerrain?.bearing).toBeCloseTo(cameraBeforeTerrain?.bearing ?? 0, 4);
  await expect(page.getByTestId('map-workspace')).toHaveAttribute(
    'data-map-state',
    'ready',
  );
});

test('falls back after DEM failure and enables terrain after explicit retry', async ({
  page,
}) => {
  let terrainUnavailable = true;
  await page.route(
    /https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/.*\.png/u,
    (route) => (terrainUnavailable ? route.abort('failed') : route.fallback()),
  );
  await page.goto('?developer=1');
  const workspace = page.getByTestId('map-workspace');
  await expect(workspace).toHaveAttribute('data-map-state', 'ready');

  await page.getByRole('button', { name: 'Show 3D terrain map' }).click();
  await expect(workspace).toHaveAttribute('data-map-state', 'degraded');
  await expect(page.getByRole('alert')).toContainText(
    'Terrain data could not be loaded',
  );
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();

  terrainUnavailable = false;
  await page.getByRole('button', { name: 'Retry 3D' }).click();
  await expect(
    page.getByRole('button', { name: 'Show 3D terrain map' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace).toHaveAttribute('data-map-state', 'ready');
});

test('reports and restores a controlled WebGL context loss', async ({ page }) => {
  await page.goto('?developer=1');
  const workspace = page.getByTestId('map-workspace');
  await expect(workspace).toHaveAttribute('data-map-state', 'ready');
  const canvas = page.locator('.maplibregl-canvas');
  const supported = await canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext('webgl2');
    const extension = context?.getExtension('WEBGL_lose_context') ?? null;
    if (extension === null) return false;
    const testWindow = window as typeof window & {
      __mapContextExtension?: WEBGL_lose_context;
    };
    testWindow.__mapContextExtension = extension;
    extension.loseContext();
    return true;
  });
  test.skip(!supported, 'Chromium did not expose WEBGL_lose_context.');

  await expect(workspace).toHaveAttribute('data-map-state', 'fatal');
  await expect(page.getByRole('alert')).toContainText('lost the WebGL context');
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __mapContextExtension?: WEBGL_lose_context;
    };
    testWindow.__mapContextExtension?.restoreContext();
  });
  await expect(workspace).toHaveAttribute('data-map-state', 'ready');

  await page.getByRole('button', { name: 'Developer diagnostics' }).click();
  await page.getByRole('tab', { name: /Logs/ }).click();
  await expect(page.getByText('map.webgl.context-lost')).toBeVisible();
  await expect(page.getByText('map.webgl.context-restored')).toBeVisible();
  await expect(page.getByText('map.lifecycle.mounted')).toHaveCount(1);
});

test('keeps the map usable and offers retry after intercepted vector failures', async ({
  page,
}) => {
  await page.route(/https:\/\/tiles\.openfreemap\.org\/fixtures\/.*\.pbf/u, (route) =>
    route.abort('failed'),
  );
  await page.goto('?developer=1');
  const workspace = page.getByTestId('map-workspace');
  await expect(workspace).toHaveAttribute('data-map-state', 'degraded');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'Some basemap tiles could not load',
  );

  const accessibility = await new AxeBuilder({ page })
    .include('[data-testid="map-workspace"]')
    .analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);

  await page.getByRole('button', { name: 'Retry map data' }).click();
  await expect(workspace).toHaveAttribute('data-map-state', 'ready');
});
