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
