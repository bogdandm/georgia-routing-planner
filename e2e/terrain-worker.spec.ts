import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { installMapProviderFixtures } from './installMapProviderFixtures';

interface StoredMapView {
  readonly camera: { readonly longitude: number; readonly zoom: number };
  readonly terrainMode: 'flat' | 'terrain';
}

async function readStoredMapView(page: Page) {
  return page.evaluate(
    () =>
      new Promise<StoredMapView | null>((resolve, reject) => {
        const openRequest = indexedDB.open('GeorgiaRoutingPlanner');
        openRequest.onerror = () => {
          reject(openRequest.error ?? new Error('Could not open fixture database.'));
        };
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const request = database
            .transaction('settings', 'readonly')
            .objectStore('settings')
            .get('map.camera');
          request.onerror = () => {
            database.close();
            reject(request.error ?? new Error('Could not read camera record.'));
          };
          request.onsuccess = () => {
            const record = request.result as { value?: StoredMapView } | undefined;
            database.close();
            resolve(record?.value ?? null);
          };
        };
      }),
  );
}

test('keeps production terrain and contours on the module worker through reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installMapProviderFixtures(page);
  const workerUrls: string[] = [];
  let closedWorkerCount = 0;
  let terrainRequestCount = 0;
  page.on('worker', (worker) => {
    workerUrls.push(worker.url());
    worker.on('close', () => {
      closedWorkerCount += 1;
    });
  });
  page.on('request', (request) => {
    if (request.url().includes('/elevation-tiles-prod/terrarium/')) {
      terrainRequestCount += 1;
    }
  });

  await page.goto('?developer=1&map=1&lat=41.7&lon=44.8&z=11.5#layers');
  const workspace = page.getByTestId('map-workspace');
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 20_000,
  });
  await expect(workspace).toHaveAttribute('data-terrain-compute-status', 'worker');
  await expect.poll(() => terrainRequestCount).toBeGreaterThan(0);
  await expect
    .poll(() => workerUrls.find((url) => url.includes('terrainCompute.worker')) ?? '')
    .toMatch(/\/georgia-routing-planner\/assets\/terrainCompute\.worker-/u);

  await expect(page.getByRole('checkbox', { name: 'Relief shading' })).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Elevation isolines' }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('tab', { name: 'Rendering' }).click();
  await expect(
    page.getByText(/Terrain processing is running in compatibility mode/u),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Developer diagnostics' }).click();
  await page.getByRole('tab', { name: /Logs/u }).click();
  await expect(page.getByText('map.terrain-compute.completed').first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('map.contours.tiles-generated').first()).toBeVisible({
    timeout: 15_000,
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagnostics' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  const bundle = JSON.parse(await readFile(downloadPath, 'utf8')) as {
    events: {
      readonly name: string;
      readonly data?: Readonly<Record<string, boolean | number | string | null>>;
    }[];
  };
  const computeEvents = bundle.events.filter(
    (event) => event.name === 'map.terrain-compute.completed',
  );
  expect(computeEvents.some((event) => event.data?.executionMode === 'worker')).toBe(
    true,
  );
  expect(
    computeEvents.some((event) =>
      ['contour', 'mixed'].includes(String(event.data?.operation)),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Close developer diagnostics' }).click();

  // Let the high-zoom contour proof finish, then return to the tested overview zoom
  // before exercising and persisting MapLibre's bounded 3D transition. CI's software
  // renderer cannot reliably initialize a fresh terrain map while a dense viewport is
  // still saturating its DEM/contour pipeline.
  await expect(page.getByText(/Terrain worker ·/u)).toHaveCount(0);
  const canvas = page.locator('.maplibregl-canvas');
  await canvas.press('-');
  await canvas.press('-');
  await canvas.press('-');
  await canvas.press('-');
  await canvas.press('-');
  await canvas.press('-');
  await expect
    .poll(async () => (await readStoredMapView(page))?.camera.zoom ?? 22)
    .toBeLessThan(7);

  const terrainButton = page.getByRole('button', {
    name: 'Show 3D terrain map',
  });
  await terrainButton.click();
  await expect
    .poll(async () => (await readStoredMapView(page))?.terrainMode, {
      timeout: 20_000,
    })
    .toBe('terrain');
  const longitudeBeforeMove = (await readStoredMapView(page))?.camera.longitude;
  await canvas.press('ArrowRight');
  await expect
    .poll(async () => (await readStoredMapView(page))?.camera.longitude)
    .not.toBe(longitudeBeforeMove);

  // The foundation workflow already proves 3D restoration. Return to persisted flat
  // mode here so this worker-focused workflow can prove teardown/recreation without
  // starting a second redundant software-rendered terrain restore at the end of CI.
  const flatButton = page.getByRole('button', { name: 'Show flat 2D map' });
  await flatButton.click();
  await expect
    .poll(async () => (await readStoredMapView(page))?.terrainMode)
    .toBe('flat');

  await page.reload();
  await expect.poll(() => closedWorkerCount).toBeGreaterThan(0);
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 20_000,
  });
  await expect(workspace).toHaveAttribute('data-terrain-compute-status', 'worker');
  await expect(flatButton).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => (await readStoredMapView(page))?.terrainMode)
    .toBe('flat');
});
