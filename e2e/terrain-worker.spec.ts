import { readFile } from 'node:fs/promises';

import { expect, test, type Page, type Worker } from '@playwright/test';

import { installMapProviderFixtures } from './installMapProviderFixtures';

interface StoredMapView {
  readonly camera: { readonly longitude: number; readonly zoom: number };
}

interface DiagnosticsBundle {
  readonly events: readonly {
    readonly name: string;
    readonly data?: Readonly<Record<string, boolean | number | string | null>>;
  }[];
}

const productionTerrainWorkerUrlPattern =
  /\/georgia-routing-planner\/assets\/terrainCompute\.worker-[^/?]+\.js(?:\?.*)?$/u;

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

async function downloadDiagnosticsBundle(page: Page): Promise<DiagnosticsBundle> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagnostics' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  return JSON.parse(await readFile(downloadPath, 'utf8')) as DiagnosticsBundle;
}

function successfulWorkerComputeEvents(bundle: DiagnosticsBundle) {
  return bundle.events.filter(
    (event) =>
      event.name === 'map.terrain-compute.completed' &&
      event.data?.executionMode === 'worker' &&
      event.data.status === 'success' &&
      Number(event.data.count) > 0,
  );
}

test('keeps production terrain and contours on the module worker through reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installMapProviderFixtures(page);
  const terrainWorkers: Worker[] = [];
  const closedTerrainWorkers = new Set<Worker>();
  let terrainRequestCount = 0;
  page.on('worker', (worker) => {
    if (!worker.url().includes('terrainCompute.worker')) return;
    terrainWorkers.push(worker);
    worker.on('close', () => {
      closedTerrainWorkers.add(worker);
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
  await expect.poll(() => terrainWorkers.length).toBeGreaterThan(0);
  const originalTerrainWorker = terrainWorkers[0];
  expect(originalTerrainWorker).toBeDefined();
  if (originalTerrainWorker === undefined) {
    throw new Error('The production terrain worker was not created.');
  }
  expect(originalTerrainWorker.url()).toMatch(productionTerrainWorkerUrlPattern);

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
  const bundle = await downloadDiagnosticsBundle(page);
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
  // Wait for persistence after each input because CI can coalesce MapLibre keyboard
  // animations when several zoom commands arrive in the same render interval.
  let previousZoom = (await readStoredMapView(page))?.camera.zoom ?? 22;
  for (let step = 0; step < 6; step += 1) {
    let persistedZoom = previousZoom;
    await canvas.press('-');
    await expect
      .poll(async () => {
        persistedZoom = (await readStoredMapView(page))?.camera.zoom ?? previousZoom;
        return persistedZoom;
      })
      .toBeLessThan(previousZoom);
    previousZoom = persistedZoom;
  }
  await expect
    .poll(async () => (await readStoredMapView(page))?.camera.zoom ?? 22)
    .toBeLessThan(7);

  const terrainButton = page.getByRole('button', {
    name: 'Show 3D terrain map',
  });
  await terrainButton.click();
  await expect(terrainButton).toBeEnabled({ timeout: 20_000 });
  const longitudeBeforeMove = (await readStoredMapView(page))?.camera.longitude;
  await canvas.press('ArrowRight');
  await expect
    .poll(async () => (await readStoredMapView(page))?.camera.longitude)
    .not.toBe(longitudeBeforeMove);

  // Return to flat mode before the worker teardown/recreation proof.
  const flatButton = page.getByRole('button', { name: 'Show flat 2D map' });
  await flatButton.click();
  await expect(flatButton).toHaveAttribute('aria-pressed', 'true');

  expect(terrainWorkers).toHaveLength(1);
  expect(closedTerrainWorkers.has(originalTerrainWorker)).toBe(false);
  const terrainWorkerCountBeforeReload = terrainWorkers.length;
  const terrainRequestCountBeforeReload = terrainRequestCount;
  await page.reload();
  await expect.poll(() => closedTerrainWorkers.has(originalTerrainWorker)).toBe(true);
  await expect
    .poll(() => terrainWorkers.length)
    .toBeGreaterThan(terrainWorkerCountBeforeReload);
  const reloadedTerrainWorker = terrainWorkers[terrainWorkerCountBeforeReload];
  expect(reloadedTerrainWorker).toBeDefined();
  if (reloadedTerrainWorker === undefined) {
    throw new Error('Reload did not create a replacement terrain worker.');
  }
  expect(reloadedTerrainWorker).not.toBe(originalTerrainWorker);
  expect(reloadedTerrainWorker.url()).toMatch(productionTerrainWorkerUrlPattern);
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 20_000,
  });
  await expect
    .poll(() => terrainRequestCount)
    .toBeGreaterThan(terrainRequestCountBeforeReload);
  await expect(flatButton).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Developer diagnostics' }).click();
  await page.getByRole('tab', { name: /Logs/u }).click();
  await expect(page.getByText('map.terrain-compute.completed').first()).toBeVisible({
    timeout: 15_000,
  });
  const reloadedBundle = await downloadDiagnosticsBundle(page);
  const reloadedComputeEvents = successfulWorkerComputeEvents(reloadedBundle);
  expect(reloadedComputeEvents.length).toBeGreaterThan(0);
  expect(
    reloadedComputeEvents.some((event) =>
      ['dem', 'contour', 'mixed'].includes(String(event.data?.operation)),
    ),
  ).toBe(true);
  // A successful event from the replacement worker proves this is no longer the
  // backend's optimistic initial status value.
  await expect(workspace).toHaveAttribute('data-terrain-compute-status', 'worker');
});
