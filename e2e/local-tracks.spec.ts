import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { installMapProviderFixtures } from './installMapProviderFixtures';

const trackFixturePath = fileURLToPath(
  new URL('../tests/fixtures/tracks/osmand-detailed-track.gpx', import.meta.url),
);

test.beforeEach(async ({ page }) => {
  await installMapProviderFixtures(page);
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
  await page.getByRole('button', { name: 'Import GPX' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(trackFixturePath);

  await expect(page.getByRole('heading', { name: 'New track' })).toBeVisible();
  await expect(page.getByLabel('Track name')).toHaveValue('Mon 13 Jul 2026');
  await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Generated name')).toHaveValue('Kazbegi Municipality');

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
