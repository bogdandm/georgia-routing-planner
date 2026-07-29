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

  const disclosure = page.getByRole('button', { name: 'Expand track details' });
  await expect(disclosure).toBeVisible();
  const disclosureSurface = page.getByTestId('mobile-track-disclosure');
  expect(
    await disclosureSurface.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).transitionDuration),
    ),
  ).toBeGreaterThan(0);
  const disclosureBox = await disclosure.boundingBox();
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
  await expect(disclosure.getByLabel(/^Distance:/u)).toBeVisible();
  await expect(disclosure.getByLabel(/^Elevation gain:/u)).toBeVisible();
  await expect(disclosure.getByLabel(/^Elevation loss:/u)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 1218 });
  const narrowStatBoxes = await Promise.all([
    disclosure.getByLabel(/^Distance:/u).boundingBox(),
    disclosure.getByLabel(/^Elevation gain:/u).boundingBox(),
    disclosure.getByLabel(/^Elevation loss:/u).boundingBox(),
  ]);
  expect(new Set(narrowStatBoxes.map((box) => Math.round(box?.y ?? -1))).size).toBe(2);
  await page.setViewportSize({ width: 400, height: 1218 });
  await expect(disclosure).toBeVisible();
  const expandedChevronBox = await disclosure.locator('svg').first().boundingBox();

  const disclosureAccessibility = await new AxeBuilder({ page })
    .include('[aria-label="Expand track details"]')
    .analyze();
  expect(
    disclosureAccessibility.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);

  await disclosure.click();
  await expect(disclosureSurface).toHaveAttribute('aria-hidden', 'true');
  expect(
    await disclosureSurface.evaluate((element) => getComputedStyle(element).visibility),
  ).toBe('visible');
  const details = page.getByRole('complementary', { name: 'Track details' });
  await expect(page.getByRole('heading', { name: 'New track' })).toBeVisible();
  await expect(
    details.getByRole('button', { name: 'Collapse track details' }),
  ).toBeVisible();
  await expect(details.getByRole('button', { name: 'Close track' })).toBeVisible();
  const trackPanelTransition = page.getByTestId('mobile-track-details-transition');
  expect(
    await trackPanelTransition.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).transitionDuration),
    ),
  ).toBeGreaterThan(0);
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
  await expect(disclosure).toBeVisible();
  await expect(details).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'The application encountered an error' }),
  ).toHaveCount(0);

  await disclosure.click();
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('Discard this unsaved track?');
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'Close track' }).click();
  await expect(details).toHaveCount(0);
  await expect(disclosure).toHaveCount(0);

  await page.getByRole('button', { name: 'Open workspace' }).click();
  const savedChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse track file' }).click();
  const savedChooser = await savedChooserPromise;
  await savedChooser.setFiles(trackFixturePath);
  await disclosure.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(disclosure).toBeVisible();
  await disclosure.click();
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
  await expect(disclosure).toBeVisible();
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await page.getByRole('tab', { name: 'Satellite' }).click();
  await page.getByRole('button', { name: 'Show map' }).click();
  await page.reload();
  await expect(workspace).toHaveAttribute('data-map-state', 'ready', {
    timeout: 15_000,
  });
  await expect(disclosure).toBeVisible();
  await disclosure.click();
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
    await page.getByLabel('Track name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
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

test('persists and renders public real-world GPX exports including a 1 MB stress track', async ({
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
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Track actions' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to tracks' }).click();
  }

  await expect(page.getByRole('list', { name: 'Saved tracks' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Track actions' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to tracks' }).click();
  await expect(page.getByRole('list', { name: 'Saved tracks' })).toBeVisible();
  await page.getByRole('button', { name: /^sample-1mb/u }).click();
  const selectedDetails = page.getByRole('complementary', {
    name: 'Track details',
  });
  await expect(page.getByRole('button', { name: 'Track actions' })).toBeVisible();
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
