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

interface StoredMapView {
  readonly camera: StoredCamera;
  readonly terrainMode: 'flat' | 'terrain';
}

// The application gives the controlled DEM source up to 15 seconds to become ready.
// Assert the persisted completion signal with a small runner margin instead of treating
// the terrain control's immediate `enabling` state as a completed transition.
const terrainPersistenceTimeoutMs = 20_000;
const cameraPersistenceTimeoutMs = 10_000;

async function readStoredMapView(page: Page): Promise<StoredMapView | null> {
  return page.evaluate(
    () =>
      new Promise<StoredMapView | null>((resolve, reject) => {
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
            const record = getRequest.result as { value?: StoredMapView } | undefined;
            database.close();
            resolve(record?.value ?? null);
          };
        };
      }),
  );
}

async function readStoredCamera(page: Page): Promise<StoredCamera | null> {
  return (await readStoredMapView(page))?.camera ?? null;
}

async function readStoredTerrainOverlayVisibility(page: Page): Promise<{
  readonly relief: boolean;
  readonly isolines: boolean;
} | null> {
  return page.evaluate(
    () =>
      new Promise<{
        readonly relief: boolean;
        readonly isolines: boolean;
      } | null>((resolve, reject) => {
        const openRequest = indexedDB.open('GeorgiaRoutingPlanner');
        openRequest.onerror = () => {
          reject(openRequest.error ?? new Error('Could not open fixture database.'));
        };
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const transaction = database.transaction('settings', 'readonly');
          const getRequest = transaction.objectStore('settings').get('map.layers');
          getRequest.onerror = () => {
            database.close();
            reject(getRequest.error ?? new Error('Could not read layer settings.'));
          };
          getRequest.onsuccess = () => {
            const record = getRequest.result as
              | {
                  value?: {
                    visibility?: {
                      'terrain-relief'?: boolean;
                      'elevation-isolines'?: boolean;
                    };
                  };
                }
              | undefined;
            database.close();
            const visibility = record?.value?.visibility;
            resolve(
              visibility === undefined
                ? null
                : {
                    relief: visibility['terrain-relief'] ?? true,
                    isolines: visibility['elevation-isolines'] ?? true,
                  },
            );
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
  test.setTimeout(45_000);
  await page.goto('?developer=1');
  const workspace = page.getByTestId('map-workspace');
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 15_000,
  });

  const canvas = page.locator('.maplibregl-canvas');
  await canvas.hover();
  await page.mouse.wheel(0, -600);
  await expect
    .poll(async () => (await readStoredCamera(page))?.zoom ?? null)
    .not.toBeNull();
  expect((await readStoredCamera(page))?.zoom).not.toBeCloseTo(5.8, 1);

  await page.getByRole('button', { name: 'Show 3D terrain map' }).click();
  await expect
    .poll(async () => (await readStoredMapView(page))?.terrainMode, {
      timeout: terrainPersistenceTimeoutMs,
    })
    .toBe('terrain');
  const cameraBeforeReload = await readStoredCamera(page);
  expect(cameraBeforeReload).not.toBeNull();

  await page.reload();
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 15_000,
  });
  await expect(
    page.getByRole('button', { name: 'Show 3D terrain map' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Show 3D terrain map' })).toBeEnabled({
    timeout: terrainPersistenceTimeoutMs,
  });
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await readStoredCamera(page))?.longitude, {
      timeout: cameraPersistenceTimeoutMs,
    })
    .not.toBe(cameraBeforeReload?.longitude);
  const cameraAfterReload = await readStoredCamera(page);

  expect(cameraAfterReload?.zoom).toBeCloseTo(cameraBeforeReload?.zoom ?? 0, 4);
  expect(cameraAfterReload?.bearing).toBeCloseTo(cameraBeforeReload?.bearing ?? 0, 4);
  expect(cameraAfterReload?.pitch).toBeCloseTo(cameraBeforeReload?.pitch ?? 0, 4);
});

test('persists terrain overlay visibility from the Layers tab', async ({ page }) => {
  await page.goto('#layers');
  const workspace = page.getByTestId('map-workspace');
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 15_000,
  });

  const relief = page.getByRole('checkbox', { name: 'Relief shading' });
  const isolines = page.getByRole('checkbox', { name: 'Elevation isolines' });
  await expect(relief).toBeChecked();
  await expect(isolines).toBeChecked();
  await relief.uncheck();
  await isolines.uncheck();
  await expect
    .poll(() => readStoredTerrainOverlayVisibility(page))
    .toEqual({ relief: false, isolines: false });

  await page.reload();
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 15_000,
  });
  await expect(relief).not.toBeChecked();
  await expect(isolines).not.toBeChecked();
});

test('switches between 2D and synthetic 3D terrain on the same map', async ({
  page,
}) => {
  test.setTimeout(45_000);
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
    { timeout: 15_000 },
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
  await expect
    .poll(async () => (await readStoredMapView(page))?.terrainMode, {
      timeout: terrainPersistenceTimeoutMs,
    })
    .toBe('terrain');
  await expect(
    page.getByRole('link', { name: 'Mapzen/AWS Open Data providers' }).first(),
  ).toBeVisible();
  await canvas.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(async () => Math.abs((await readStoredCamera(page))?.bearing ?? 0))
    .toBeGreaterThan(0);

  await flatButton.click();
  await expect(flatButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readStoredCamera(page))?.pitch).toBe(0);
  await expect.poll(async () => (await readStoredCamera(page))?.bearing).toBe(0);
  await expect
    .poll(async () => (await readStoredMapView(page))?.terrainMode)
    .toBe('flat');
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
  expect(cameraAfterTerrain?.bearing).toBe(0);
  await expect(page.getByTestId('map-workspace')).toHaveAttribute(
    'data-map-state',
    'ready',
    { timeout: 15_000 },
  );
});

test('uses conventional native camera gestures and resets them with the compass', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('?developer=1');
  await expect(page.getByTestId('map-workspace')).toHaveAttribute(
    'data-map-state',
    'ready',
    { timeout: 15_000 },
  );
  const canvas = page.locator('.maplibregl-canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds === null) return;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  const initialCamera = await readStoredCamera(page);
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 90, centerY + 30, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await readStoredCamera(page))?.longitude)
    .not.toBe(initialCamera?.longitude);

  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: 'middle' });
  await expect(page.locator('.map-orbit-pivot')).toHaveCount(0);
  await page.mouse.move(centerX + 40, centerY - 40, { steps: 2 });
  await page.mouse.up({ button: 'middle' });

  await page.getByRole('button', { name: 'Show 3D terrain map' }).click();
  await expect(
    page.getByRole('button', { name: 'Show 3D terrain map' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => (await readStoredMapView(page))?.terrainMode, {
      timeout: terrainPersistenceTimeoutMs,
    })
    .toBe('terrain');
  const cameraBeforeOrbit = await readStoredCamera(page);
  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: 'middle' });
  const pivot = page.locator('.map-orbit-pivot');
  await expect(pivot).toHaveCount(1);
  const pivotBeforeOrbit = await pivot.boundingBox();
  expect(pivotBeforeOrbit).not.toBeNull();
  await page.mouse.move(centerX + 80, centerY - 80, { steps: 4 });
  if (pivotBeforeOrbit !== null) {
    await expect
      .poll(async () => {
        const current = await pivot.boundingBox();
        return current === null
          ? Number.POSITIVE_INFINITY
          : Math.hypot(current.x - pivotBeforeOrbit.x, current.y - pivotBeforeOrbit.y);
      })
      .toBeLessThan(4);
  }
  await page.mouse.up({ button: 'middle' });
  await expect(pivot).toHaveCount(0);
  await expect
    .poll(async () => (await readStoredCamera(page))?.bearing)
    .not.toBe(cameraBeforeOrbit?.bearing);
  await expect
    .poll(async () => (await readStoredCamera(page))?.pitch ?? 0)
    .toBeGreaterThan(0);

  const cameraBeforeKeyboard = await readStoredCamera(page);
  await canvas.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(async () => (await readStoredCamera(page))?.bearing, {
      timeout: cameraPersistenceTimeoutMs,
    })
    .not.toBe(cameraBeforeKeyboard?.bearing);

  await page.locator('.maplibregl-ctrl-compass').click();
  await expect
    .poll(async () => (await readStoredCamera(page))?.bearing ?? null)
    .toBe(0);
  await expect.poll(async () => (await readStoredCamera(page))?.pitch ?? null).toBe(0);
});

test('keeps DEM failure feedback in the shared status without a map banner', async ({
  page,
}) => {
  await page.route(
    /https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/.*\.png/u,
    (route) => route.abort('failed'),
  );
  await page.goto('?developer=1');
  const workspace = page.getByTestId('map-workspace');
  await expect(workspace).toHaveAttribute('data-map-state', 'degraded', {
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Show 3D terrain map' }).click();
  await expect(workspace).toHaveAttribute('data-map-state', 'degraded');
  await expect(
    page.getByRole('button', { name: 'Show current error details' }),
  ).toContainText('3D terrain is unavailable');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry 3D' })).toHaveCount(0);
});

test('reports and restores a controlled WebGL context loss', async ({ page }) => {
  await page.goto('?developer=1');
  const workspace = page.getByTestId('map-workspace');
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 15_000,
  });
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
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Developer diagnostics' }).click();
  await page.getByRole('tab', { name: /Logs/ }).click();
  await expect(page.getByText('map.webgl.context-lost')).toBeVisible();
  await expect(page.getByText('map.webgl.context-restored')).toBeVisible();
  await expect(page.getByText('map.lifecycle.mounted')).toHaveCount(1);
});

test('keeps the map usable and centralizes intercepted vector failures', async ({
  page,
}) => {
  await page.route(/https:\/\/tiles\.openfreemap\.org\/fixtures\/.*\.pbf/u, (route) =>
    route.abort('failed'),
  );
  await page.goto('?developer=1');
  const workspace = page.getByTestId('map-workspace');
  await expect(workspace).toHaveAttribute('data-map-state', 'degraded');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Show current error details' }),
  ).toContainText('Some basemap tiles could not load');
  await expect(page.getByRole('button', { name: 'Retry map data' })).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page })
    .include('[data-testid="map-workspace"]')
    .analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);
});
