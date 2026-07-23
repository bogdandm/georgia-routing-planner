import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { installMapProviderFixtures } from './installMapProviderFixtures';

const trackFixturePath = fileURLToPath(
  new URL('../tests/fixtures/tracks/osmand-detailed-track.gpx', import.meta.url),
);

const realWorldTrackFixtures = [
  {
    path: fileURLToPath(
      new URL(
        '../tests/fixtures/tracks/real-world/garmin-connect-activity.gpx',
        import.meta.url,
      ),
    ),
    pointCount: 5_207,
    byteSize: 1_916_018,
  },
  {
    path: fileURLToPath(
      new URL(
        '../tests/fixtures/tracks/real-world/expertgps-fells-loop.gpx',
        import.meta.url,
      ),
    ),
    pointCount: 46,
    byteSize: 29_894,
  },
  {
    path: fileURLToPath(
      new URL(
        '../tests/fixtures/tracks/real-world/osmand-planinika.gpx',
        import.meta.url,
      ),
    ),
    pointCount: 892,
    byteSize: 179_149,
  },
  {
    path: fileURLToPath(
      new URL(
        '../tests/fixtures/tracks/real-world/osmand-july-track.gpx',
        import.meta.url,
      ),
    ),
    pointCount: 786,
    byteSize: 145_924,
  },
  {
    path: fileURLToPath(
      new URL('../tests/fixtures/tracks/real-world/sample-1mb.gpx', import.meta.url),
    ),
    pointCount: 18_078,
    byteSize: 1_048_617,
  },
  {
    path: fileURLToPath(
      new URL(
        '../tests/fixtures/tracks/real-world/osmand-track-with-route.gpx',
        import.meta.url,
      ),
    ),
    pointCount: 258,
    byteSize: 58_757,
    warningCode: 'track-preferred-over-route',
  },
  {
    path: fileURLToPath(
      new URL(
        '../tests/fixtures/tracks/real-world/shkedi-likheti.gpx',
        import.meta.url,
      ),
    ),
    pointCount: 877,
    byteSize: 121_526,
    generatedName: 'Kelida Pass',
  },
] as const;

interface StoredTrackState {
  readonly contentCount: number;
  readonly pointCount: number;
  readonly summaryCount: number;
  readonly sourceBlobCount: number;
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

async function readStoredTrackState(page: Page): Promise<StoredTrackState> {
  return page.evaluate(
    () =>
      new Promise<StoredTrackState>((resolve, reject) => {
        const openRequest = indexedDB.open('GeorgiaRoutingPlanner');
        openRequest.onerror = () => {
          reject(openRequest.error ?? new Error('Could not open fixture database.'));
        };
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const transaction = database.transaction(
            ['localTracks', 'localTrackContents'],
            'readonly',
          );
          const summaryCountRequest = transaction.objectStore('localTracks').count();
          const contentCursorRequest = transaction
            .objectStore('localTrackContents')
            .openCursor();
          let contentCount = 0;
          let pointCount = 0;
          let sourceBlobCount = 0;

          contentCursorRequest.onerror = () => {
            reject(
              contentCursorRequest.error ??
                new Error('Could not read stored GPX content.'),
            );
          };
          contentCursorRequest.onsuccess = () => {
            const cursor = contentCursorRequest.result;
            if (cursor === null) return;
            const value: unknown = cursor.value;
            if (typeof value !== 'object' || value === null) {
              reject(new Error('Stored track content has an invalid shape.'));
              return;
            }
            if ('originalGpx' in value && value.originalGpx instanceof Blob) {
              sourceBlobCount += 1;
            }
            if (!('trackPoints' in value) || !Array.isArray(value.trackPoints)) {
              reject(new Error('Stored track points are unavailable.'));
              return;
            }
            contentCount += 1;
            pointCount += value.trackPoints.reduce(
              (total: number, segment: unknown) =>
                total + (Array.isArray(segment) ? segment.length : 0),
              0,
            );
            cursor.continue();
          };
          transaction.onerror = () => {
            reject(
              transaction.error ?? new Error('Could not read stored GPX records.'),
            );
          };
          transaction.oncomplete = () => {
            database.close();
            resolve({
              contentCount,
              pointCount,
              summaryCount: summaryCountRequest.result,
              sourceBlobCount,
            });
          };
        };
      }),
  );
}

test.beforeEach(async ({ page }) => {
  await installMapProviderFixtures(page);
});

test('persists and renders public real-world GPX exports including a 1 MB stress track', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('?developer=1#layers');
  const workspace = page.getByTestId('map-workspace');
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 15_000,
  });
  const relief = page.getByRole('checkbox', { name: 'Relief shading' });
  const isolines = page.getByRole('checkbox', { name: 'Elevation isolines' });
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
  await page.getByRole('tab', { name: 'Tracks' }).click();

  for (const fixture of realWorldTrackFixtures) {
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Browse track file' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixture.path);

    const details = page.getByRole('complementary', { name: 'Track details' });
    await expect(page.getByRole('heading', { name: 'New track' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(details).toContainText(
      `${fixture.pointCount.toLocaleString('en')} points`,
    );
    if ('warningCode' in fixture) {
      await expect(details.getByText(fixture.warningCode)).toBeVisible();
      await expect(details).toContainText(
        'Detailed track geometry was used instead of companion route geometry.',
      );
    }
    if ('generatedName' in fixture) {
      await expect(page.getByLabel('English place name')).toHaveValue(
        new RegExp(fixture.generatedName, 'u'),
      );
    }
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Selected track' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to tracks' }).click();
  }

  await expect(page.getByText('7 saved tracks')).toBeVisible();
  const expectedStoredPoints = realWorldTrackFixtures.reduce(
    (total, fixture) => total + fixture.pointCount,
    0,
  );
  expect(await readStoredTrackState(page)).toEqual({
    contentCount: 7,
    pointCount: expectedStoredPoints,
    summaryCount: 7,
    sourceBlobCount: 0,
  });

  await page.reload();
  await expect(page.getByText('7 saved tracks')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Selected track' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to tracks' }).click();
  await page.getByRole('button', { name: /^sample-1mb/u }).click();
  const selectedDetails = page.getByRole('complementary', {
    name: 'Track details',
  });
  await expect(page.getByRole('heading', { name: 'Selected track' })).toBeVisible();
  await expect(selectedDetails).toContainText('18,078 points');

  await page
    .getByRole('button', { name: 'Developer diagnostics', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Map' }).click();
  await expect(page.getByRole('list', { name: 'Ordered map sources' })).toContainText(
    'imported-track',
  );
});

test('imports, retains, reopens, renames, and deletes a local GPX track', async ({
  page,
}) => {
  await page.goto('#tracks');
  await expect(page.getByTestId('map-workspace')).toHaveAttribute(
    'data-map-state',
    'ready',
    { timeout: 15_000 },
  );

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse track file' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(trackFixturePath);

  await expect(page.getByRole('heading', { name: 'New track' })).toBeVisible();
  const trackName = page.getByLabel('Track name');
  const applyPlaceName = page.getByRole('button', { name: 'Apply place name' });
  const englishPlaceName = page.getByLabel('English place name');
  const saveTrack = page.getByRole('button', { name: 'Save' });
  await expect(trackName).toHaveValue('Mon 13 Jul 2026');
  await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);
  await expect(applyPlaceName).toHaveText('↑ Apply place name ↑');
  await expect(englishPlaceName).toHaveValue('Kazbegi Municipality');
  const trackNameBox = await trackName.boundingBox();
  const applyPlaceNameBox = await applyPlaceName.boundingBox();
  const englishPlaceNameBox = await englishPlaceName.boundingBox();
  const saveTrackBox = await saveTrack.boundingBox();
  expect(trackNameBox).not.toBeNull();
  expect(applyPlaceNameBox).not.toBeNull();
  expect(englishPlaceNameBox).not.toBeNull();
  expect(saveTrackBox).not.toBeNull();
  if (
    trackNameBox !== null &&
    applyPlaceNameBox !== null &&
    englishPlaceNameBox !== null &&
    saveTrackBox !== null
  ) {
    expect(applyPlaceNameBox.height).toBe(saveTrackBox.height);
    const applyLeadingGap =
      applyPlaceNameBox.y - (trackNameBox.y + trackNameBox.height);
    const saveLeadingGap =
      saveTrackBox.y - (englishPlaceNameBox.y + englishPlaceNameBox.height);
    expect(Math.abs(applyLeadingGap - saveLeadingGap)).toBeLessThanOrEqual(1);
    expect(trackNameBox.y + trackNameBox.height).toBeLessThan(applyPlaceNameBox.y);
    expect(applyPlaceNameBox.y + applyPlaceNameBox.height).toBeLessThan(
      englishPlaceNameBox.y,
    );
  }

  const previewResults = await new AxeBuilder({ page })
    .include('[aria-label="Track details"]')
    .analyze();
  expect(
    previewResults.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Selected track' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to tracks' }).click();
  await expect(page.getByRole('heading', { name: 'Selected track' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Selected track' })).toBeVisible();
  await expect(page.getByLabel('Track name')).toHaveValue('Mon 13 Jul 2026');

  await page.getByLabel('Track name').fill('Kazbegi ridge walk');
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByLabel('Track name')).toHaveValue('Kazbegi ridge walk');

  await page.getByRole('tab', { name: 'Layers' }).click();
  await page.getByRole('checkbox', { name: 'Imported tracks' }).uncheck();
  await page.getByRole('slider', { name: 'Track opacity' }).fill('65');
  await expect(
    page.getByRole('checkbox', { name: 'Imported tracks' }),
  ).not.toBeChecked();
  await expect(page.getByRole('slider', { name: 'Track opacity' })).toHaveValue('65');

  await page.getByRole('tab', { name: 'Tracks' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Selected track' })).toHaveCount(0);

  await expect(page.getByText('0 saved tracks')).toBeVisible();
});
