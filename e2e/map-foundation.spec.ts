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
  await terrainButton.click();
  await expect(terrainButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => terrainRequests.length).toBeGreaterThan(0);
  await expect(page.getByText(/Terrain data:/)).toBeVisible();

  await flatButton.click();
  await expect(flatButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('map-workspace')).toHaveAttribute(
    'data-map-state',
    'ready',
  );
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
