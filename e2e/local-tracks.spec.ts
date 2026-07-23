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
  readonly summaryCount: number;
  readonly totalOriginalGpxBytes: number;
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
          let totalOriginalGpxBytes = 0;

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
            if (
              typeof value !== 'object' ||
              value === null ||
              !('originalGpx' in value) ||
              !(value.originalGpx instanceof Blob)
            ) {
              reject(new Error('Stored GPX content has an invalid shape.'));
              return;
            }
            contentCount += 1;
            totalOriginalGpxBytes += value.originalGpx.size;
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
              summaryCount: summaryCountRequest.result,
              totalOriginalGpxBytes,
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
  await page.reload();
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 15_000,
  });
  await expect(relief).not.toBeChecked();
  await expect(isolines).not.toBeChecked();
  await page.getByRole('tab', { name: 'Tracks' }).click();

  for (const fixture of realWorldTrackFixtures) {
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Browse GPX file' }).click();
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
    await page.getByRole('button', { name: 'Close track' }).click();
  }

  await expect(page.getByText('7 saved tracks')).toBeVisible();
  const expectedStoredBytes = realWorldTrackFixtures.reduce(
    (total, fixture) => total + fixture.byteSize,
    0,
  );
  expect(await readStoredTrackState(page)).toEqual({
    contentCount: 7,
    summaryCount: 7,
    totalOriginalGpxBytes: expectedStoredBytes,
  });

  await page.reload();
  await expect(page.getByText('7 saved tracks')).toBeVisible();
  await page.getByRole('button', { name: /sample-1mb/u }).click();
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
  await page.getByRole('button', { name: 'Browse GPX file' }).click();
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
  await page.getByRole('button', { name: 'Close track' }).click();
  await expect(page.getByRole('heading', { name: 'Selected track' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('Mon 13 Jul 2026', { exact: true })).toBeVisible();
  await page.getByText('Mon 13 Jul 2026', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Selected track' })).toBeVisible();

  await page.getByLabel('Track name').fill('Kazbegi ridge walk');
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByText('Kazbegi ridge walk', { exact: true })).toBeVisible();

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
