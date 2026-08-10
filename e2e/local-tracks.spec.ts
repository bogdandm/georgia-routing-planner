import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
    zeroLength: true,
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

interface StoredCamera {
  readonly longitude: number;
  readonly latitude: number;
  readonly zoom: number;
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
async function readStoredTrackSummary(
  page: Page,
  sourceFilename: string,
): Promise<{ readonly name: string; readonly pointCount: number }> {
  return page.evaluate(
    (filename) =>
      new Promise<{ readonly name: string; readonly pointCount: number }>(
        (resolve, reject) => {
          const openRequest = indexedDB.open('GeorgiaRoutingPlanner');
          openRequest.onerror = () => {
            reject(openRequest.error ?? new Error('Could not open fixture database.'));
          };
          openRequest.onsuccess = () => {
            const database = openRequest.result;
            const transaction = database.transaction('localTracks', 'readonly');
            const request = transaction.objectStore('localTracks').getAll();
            request.onerror = () => {
              database.close();
              reject(
                request.error ?? new Error('Could not read saved track summaries.'),
              );
            };
            request.onsuccess = () => {
              database.close();
              const summary = (
                request.result as {
                  sourceFilename?: string;
                  name?: string;
                  pointCount?: number;
                }[]
              ).find((candidate) => candidate.sourceFilename === filename);
              if (summary?.name === undefined || summary.pointCount === undefined) {
                reject(new Error(`Saved summary is unavailable for ${filename}.`));
                return;
              }
              resolve({ name: summary.name, pointCount: summary.pointCount });
            };
          };
        },
      ),
    sourceFilename,
  );
}

test.beforeEach(async ({ page }) => {
  await installMapProviderFixtures(page);
});

test('imports and frames a global drop after expanding collapsed navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('#satellite');
  const mapWorkspace = page.getByTestId('map-workspace');
  await expect(mapWorkspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 15_000,
  });

  const trackBytes = await readFile(trackFixturePath);
  const dataTransfer = await page.evaluateHandle(
    ({ bytes }) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(bytes)], 'Dropped.gpx', {
          type: 'application/gpx+xml',
        }),
      );
      return transfer;
    },
    { bytes: [...trackBytes] },
  );
  const workspaceShell = page.getByTestId('workspace-shell');
  const dropCard = page.getByRole('region', { name: 'Drop track file' });
  const dropTrack = async () => {
    await workspaceShell.dispatchEvent('dragenter', { dataTransfer });
    await expect(dropCard).toBeVisible();
    await dropCard.dispatchEvent('dragover', { dataTransfer });
    await dropCard.dispatchEvent('drop', { dataTransfer });
    await expect(page.getByRole('tab', { name: 'Tracks' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'New track' })).toBeVisible();
  };

  await expect(
    page.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
  ).toBeVisible();
  await expect(mapWorkspace).toBeVisible();
  await dropTrack();
  await expect
    .poll(async () => (await readStoredCamera(page))?.zoom ?? null)
    .toBeGreaterThan(10);
  const expandedFitCamera = await readStoredCamera(page);
  expect(expandedFitCamera).not.toBeNull();
  if (expandedFitCamera === null) return;

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('Discard this unsaved track?');
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'Back to tracks' }).click();
  await page.getByRole('tab', { name: 'Satellite' }).click();
  await page.getByTestId('navigation-collapse-toggle').click();
  await expect(
    page.getByRole('button', { name: 'Show navigation', exact: true }),
  ).toBeVisible();

  await page.locator('.maplibregl-canvas').press('-');
  await expect
    .poll(async () => {
      const camera = await readStoredCamera(page);
      return camera === null ? 0 : Math.abs(camera.zoom - expandedFitCamera.zoom);
    })
    .toBeGreaterThan(0.5);

  await workspaceShell.dispatchEvent('dragenter', { dataTransfer });
  await expect(dropCard).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Show navigation', exact: true }),
  ).toBeVisible();
  await dropCard.dispatchEvent('dragover', { dataTransfer });
  await dropCard.dispatchEvent('drop', { dataTransfer });
  await expect(page.getByRole('tab', { name: 'Tracks' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('heading', { name: 'New track' })).toBeVisible();
  await expect(page.getByTestId('navigation-collapse-toggle')).toBeVisible();
  await expect
    .poll(async () => {
      const camera = await readStoredCamera(page);
      return camera === null
        ? null
        : {
            longitude: camera.longitude.toFixed(6),
            latitude: camera.latitude.toFixed(6),
            zoom: camera.zoom.toFixed(6),
          };
    })
    .toEqual({
      longitude: expandedFitCamera.longitude.toFixed(6),
      latitude: expandedFitCamera.latitude.toFixed(6),
      zoom: expandedFitCamera.zoom.toFixed(6),
    });
});

test('uses a map-first smartphone track disclosure without crashing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 1218 });
  await page.goto('#tracks');
  const workspace = page.getByTestId('map-workspace');
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Open workspace' }).click();
  const importPrompt = page.getByText('Drop GPX, FIT, or KML here');
  await expect(importPrompt).toBeVisible();
  const importPromptBox = await importPrompt.boundingBox();
  expect(importPromptBox?.height).toBeLessThanOrEqual(20);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse track file' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(trackFixturePath);

  const previewDisclosure = page.getByRole('button', {
    name: 'Expand unsaved track details',
  });
  await expect(previewDisclosure).toBeVisible();
  const disclosureBox = await previewDisclosure.boundingBox();
  expect(disclosureBox).not.toBeNull();
  expect(disclosureBox?.x).toBe(12);
  expect(disclosureBox?.width).toBe(376);
  expect(
    1218 - (disclosureBox?.y ?? 0) - (disclosureBox?.height ?? 0),
  ).toBeGreaterThanOrEqual(12);
  await expect(page.getByRole('complementary', { name: 'Track details' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('heading', { name: 'New track' })).toHaveCount(0);
  await expect(previewDisclosure.getByLabel(/^Distance:/u)).toBeVisible();
  await expect(previewDisclosure.getByLabel(/^Elevation gain:/u)).toBeVisible();
  await expect(previewDisclosure.getByLabel(/^Elevation loss:/u)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Track name' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 1218 });
  const narrowStatBoxes = await Promise.all([
    previewDisclosure.getByLabel(/^Distance:/u).boundingBox(),
    previewDisclosure.getByLabel(/^Elevation gain:/u).boundingBox(),
    previewDisclosure.getByLabel(/^Elevation loss:/u).boundingBox(),
  ]);
  expect(new Set(narrowStatBoxes.map((box) => Math.round(box?.y ?? -1))).size).toBe(2);
  await page.setViewportSize({ width: 400, height: 1218 });
  await expect(previewDisclosure).toBeVisible();
  const expandedChevronBox = await previewDisclosure
    .locator('svg')
    .first()
    .boundingBox();

  const disclosureAccessibility = await new AxeBuilder({ page })
    .include('[aria-label="Expand unsaved track details"]')
    .analyze();
  expect(
    disclosureAccessibility.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);

  await previewDisclosure.click();
  const details = page.getByRole('complementary', { name: 'Track details' });
  await expect(page.getByRole('heading', { name: 'New track' })).toBeVisible();
  await expect(
    details.getByRole('button', { name: 'Collapse track details' }),
  ).toBeVisible();
  await expect(details.getByRole('button', { name: 'Close track' })).toBeVisible();
  const collapsedChevronBox = await details
    .getByRole('button', { name: 'Collapse track details' })
    .locator('svg')
    .boundingBox();
  expect(collapsedChevronBox?.x).toBe(expandedChevronBox?.x);
  expect(collapsedChevronBox?.width).toBe(expandedChevronBox?.width);
  expect(collapsedChevronBox?.height).toBe(expandedChevronBox?.height);

  const detailsAccessibility = await new AxeBuilder({ page })
    .include('[aria-label="Track details"]')
    .analyze();
  expect(
    detailsAccessibility.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);

  await details.getByRole('button', { name: 'Collapse track details' }).click();
  await expect(previewDisclosure).toBeVisible();
  await expect(details).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'The application encountered an error' }),
  ).toHaveCount(0);

  await previewDisclosure.click();
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('Discard this unsaved track?');
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'Close track' }).click();
  await expect(details).toHaveCount(0);
  await expect(previewDisclosure).toHaveCount(0);

  await page.getByRole('button', { name: 'Open workspace' }).click();
  const savedChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse track file' }).click();
  const savedChooser = await savedChooserPromise;
  await savedChooser.setFiles(trackFixturePath);
  await previewDisclosure.click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const savedDisclosure = page.getByRole('button', {
    name: 'Expand track details',
  });
  await expect(savedDisclosure).toBeVisible();
  await savedDisclosure.click();
  await expect(page.getByRole('button', { name: 'Track actions' })).toBeVisible();
  const savedTrackName = await details.getByRole('heading', { level: 2 }).textContent();
  expect(savedTrackName).not.toBeNull();
  await page.getByRole('button', { name: 'Close track' }).click();
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('button', { name: 'Add to favorites' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Delete /u })).toBeVisible();
  await page
    .getByRole('list', { name: 'Saved tracks' })
    .getByText(savedTrackName ?? '', { exact: true })
    .click();
  await expect(savedDisclosure).toBeVisible();
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await page
    .getByRole('list', { name: 'Saved tracks' })
    .getByText(savedTrackName ?? '', { exact: true })
    .click();
  await expect(details).toBeVisible();
  await details.getByRole('button', { name: 'Collapse track details' }).click();
  await expect(savedDisclosure).toBeVisible();
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await page.getByRole('tab', { name: 'Satellite' }).click();
  await page.getByRole('button', { name: 'Show map' }).click();
  await page.reload();
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 15_000,
  });
  await expect(savedDisclosure).toBeVisible();
  await savedDisclosure.click();
  await expect(
    page.getByRole('complementary', { name: 'Track details' }),
  ).toBeVisible();
});

test('clears saved-track hovers after favorite sorting', async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1000 });
  await page.goto('#tracks');
  await expect(page.getByTestId('map-workspace')).toHaveAttribute(
    'data-map-state',
    'ready',
    { timeout: 15_000 },
  );

  for (const name of ['Pinned track', 'Movable track']) {
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Browse track file' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(trackFixturePath);
    await expect(page.getByRole('heading', { name: 'New track' })).toBeVisible();
    await page
      .getByRole('complementary', { name: 'Track details' })
      .getByLabel('Track name')
      .fill(name);
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole('button', { name: 'Track actions' })).toBeVisible();

    if (name === 'Pinned track') {
      await page.getByRole('button', { name: 'Track actions' }).click();
      await page.getByRole('menuitem', { name: 'Add to favorites' }).click();
    }

    await page.getByRole('button', { name: 'Close track' }).click();
  }

  const savedTracks = page.getByRole('list', { name: 'Saved tracks' });
  const pinnedRow = savedTracks
    .getByRole('button', { name: /^Pinned track/u })
    .locator('xpath=..');
  const movableRow = savedTracks
    .getByRole('button', { name: /^Movable track/u })
    .locator('xpath=..');
  const movableFavorite = movableRow.getByRole('button', {
    name: 'Add to favorites',
  });
  const pinnedDelete = pinnedRow.getByRole('button', {
    name: 'Delete Pinned track',
  });
  const unhoveredBackground = await pinnedRow.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  await movableRow.hover();
  await movableFavorite.hover();
  await expect(page.getByRole('tooltip', { name: 'Add to favorites' })).toBeVisible();
  await movableFavorite.click();
  await expect(
    movableRow.getByRole('button', { name: 'Remove from favorites' }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const [movableBox, pinnedBox] = await Promise.all([
        movableRow.boundingBox(),
        pinnedRow.boundingBox(),
      ]);
      return movableBox !== null && pinnedBox !== null && movableBox.y < pinnedBox.y;
    })
    .toBe(true);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(pinnedRow).toHaveCSS('background-color', unhoveredBackground);
  await expect(pinnedDelete).toHaveCSS('opacity', '0');

  await pinnedRow.hover();
  await expect(pinnedDelete).toHaveCSS('opacity', '1');
});

test('persists valid public GPX exports and rejects zero-length geometry', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
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
    if ('zeroLength' in fixture) {
      await expect(details).toContainText('route length is zero');
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
      await page.getByRole('button', { name: 'Discard' }).click();
      continue;
    }
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Track actions' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to tracks' }).click();
  }

  await expect(page.getByRole('list', { name: 'Saved tracks' })).toBeVisible();
  const expectedSourcePointCount = realWorldTrackFixtures.reduce(
    (total, fixture) => total + ('zeroLength' in fixture ? 0 : fixture.pointCount),
    0,
  );
  const garminSummary = await readStoredTrackSummary(
    page,
    'garmin-connect-activity.gpx',
  );
  expect(await readStoredTrackState(page)).toEqual({
    contentCount: 6,
    pointCount: expectedSourcePointCount,
    summaryCount: 6,
    sourceBlobCount: 0,
  });

  await page.reload();
  await expect(page.getByRole('list', { name: 'Saved tracks' })).toBeVisible();
  await page
    .getByRole('button', { name: new RegExp(`^${garminSummary.name}`, 'u') })
    .click();
  const selectedDetails = page.getByRole('complementary', {
    name: 'Track details',
  });
  await expect(page.getByRole('button', { name: 'Track actions' })).toBeVisible();
  await expect(selectedDetails).toContainText(
    `${garminSummary.pointCount.toLocaleString('en')} points`,
  );

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
  await page.setViewportSize({ width: 2048, height: 1000 });
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
  const trackDetails = page.getByRole('complementary', { name: 'Track details' });
  const trackName = trackDetails.getByLabel('Track name');
  const applyPlaceName = page.getByRole('button', { name: 'Apply place name' });
  const englishPlaceName = page.getByLabel('English place name');
  const saveTrack = page.getByRole('button', { name: 'Save', exact: true });
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
  const savedDetails = page.getByLabel('Track details');
  const trackDetailsHeading = savedDetails.getByRole('heading', {
    name: 'Mon 13 Jul 2026',
    level: 2,
  });
  const closeTrack = savedDetails.getByRole('button', { name: 'Close track' });
  await expect(page.getByRole('button', { name: 'Track actions' })).toBeVisible();
  await expect(savedDetails.getByRole('separator')).toHaveCount(0);
  await expect(
    savedDetails.getByRole('button', { name: 'Add to favorites' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Track actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Add to favorites' })).toBeVisible();
  await page.keyboard.press('Escape');
  const [headingBox, closeBox] = await Promise.all([
    trackDetailsHeading.boundingBox(),
    closeTrack.boundingBox(),
  ]);
  expect(headingBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  if (headingBox !== null && closeBox !== null) {
    expect(
      Math.abs(
        closeBox.y + closeBox.height / 2 - (headingBox.y + headingBox.height / 2),
      ),
    ).toBeLessThanOrEqual(1);
  }
  await closeTrack.click();
  await expect(page.getByRole('button', { name: 'Track actions' })).toHaveCount(0);
  const savedTracks = page.getByRole('list', { name: 'Saved tracks' });
  const savedTrackButton = savedTracks.getByRole('button', {
    name: /^Mon 13 Jul 2026/u,
  });
  const favoriteButton = savedTracks.getByRole('button', {
    name: 'Add to favorites',
  });
  const deleteButton = savedTracks.getByRole('button', {
    name: 'Delete Mon 13 Jul 2026',
  });
  const savedRow = savedTrackButton.locator('xpath=..');
  await expect(favoriteButton).toHaveCSS('opacity', '0');
  await expect(deleteButton).toHaveCSS('opacity', '0');
  const unselectedBackground = await savedRow.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await savedRow.hover();
  await expect(favoriteButton).toHaveCSS('opacity', '1');
  await expect(deleteButton).toHaveCSS('opacity', '1');
  const hoveredBackground = await savedRow.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(hoveredBackground).not.toBe(unselectedBackground);

  await savedTrackButton.focus();
  await page.keyboard.press('Tab');
  await expect(favoriteButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(deleteButton).toBeFocused();
  await savedTrackButton.click();
  await page.mouse.move(0, 0);
  await expect(page.getByRole('button', { name: 'Track actions' })).toBeVisible();
  const selectedBackground = await savedRow.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await savedRow.hover();
  const selectedHoveredBackground = await savedRow.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(selectedBackground).not.toBe(unselectedBackground);
  expect(selectedHoveredBackground).not.toBe(selectedBackground);

  await favoriteButton.click();
  await expect(
    savedTracks.getByRole('button', { name: 'Remove from favorites' }),
  ).toBeVisible();
  const savedTracksResults = await new AxeBuilder({ page })
    .include('[aria-label="Saved tracks"]')
    .analyze();
  expect(
    savedTracksResults.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Track actions' })).toBeVisible();
  await expect(
    page.getByLabel('Track details').getByRole('heading', { name: 'Mon 13 Jul 2026' }),
  ).toBeVisible();
  await expect(page.getByLabel('Track name')).toHaveCount(0);
  await page.getByRole('button', { name: 'Track actions' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Remove from favorites' }),
  ).toBeVisible();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const savedTrackName = page.getByLabel('Track name');
  await expect(savedTrackName).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm rename' })).toBeVisible();
  await savedTrackName.fill('Kazbegi ridge walk');
  await page.getByRole('button', { name: 'Confirm rename' }).click();
  await expect(
    page
      .getByLabel('Track details')
      .getByRole('heading', { name: 'Kazbegi ridge walk' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Track actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete track' }).click();
  await expect(page.getByRole('button', { name: 'Confirm delete' })).toBeVisible();
  const confirmationResults = await new AxeBuilder({ page })
    .include('[aria-label="Track details"]')
    .analyze();
  expect(
    confirmationResults.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Confirm delete' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Track actions' })).toBeVisible();

  await page.getByRole('tab', { name: 'Layers' }).click();
  await page.getByRole('checkbox', { name: 'Imported tracks' }).uncheck();
  await page.getByRole('slider', { name: 'Track opacity' }).fill('65');
  await expect(
    page.getByRole('checkbox', { name: 'Imported tracks' }),
  ).not.toBeChecked();
  await expect(page.getByRole('slider', { name: 'Track opacity' })).toHaveValue('65');

  await page.getByRole('tab', { name: 'Tracks' }).click();
  await page.getByRole('button', { name: 'Close track' }).click();
  await savedTracks
    .getByRole('button', { name: /^Kazbegi ridge walk Distance:/u })
    .hover();
  const renamedDeleteButton = savedTracks.getByRole('button', {
    name: 'Delete Kazbegi ridge walk',
  });
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await renamedDeleteButton.click();
  await expect(
    savedTracks.getByRole('button', {
      name: 'Confirm deletion of Kazbegi ridge walk',
    }),
  ).toBeVisible();
  const rowDeleteConfirmation = savedTracks.getByRole('button', {
    name: 'Confirm deletion of Kazbegi ridge walk',
  });
  await rowDeleteConfirmation.focus();
  await page.keyboard.press('Escape');
  await expect(renamedDeleteButton).toBeVisible();
  await renamedDeleteButton.click();
  await savedTracks
    .getByRole('button', {
      name: 'Confirm deletion of Kazbegi ridge walk',
    })
    .click();
  await expect(page.getByRole('list', { name: 'Saved tracks' })).toHaveCount(0);
  expect(dialogs).toEqual([]);
});
