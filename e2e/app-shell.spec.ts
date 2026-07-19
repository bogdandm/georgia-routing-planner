import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import {
  installMapProviderFixtures,
  isConfiguredProviderRequest,
} from './installMapProviderFixtures';

test.beforeEach(async ({ page }) => {
  await installMapProviderFixtures(page);
});

test('loads the production map style and reloads under a repository subpath', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.protocol.startsWith('http') &&
      url.hostname !== '127.0.0.1' &&
      !isConfiguredProviderRequest(url)
    ) {
      externalRequests.push(request.url());
    }
  });

  await page.goto('?developer=1');

  await expect(page.getByRole('heading', { name: 'Tracks', level: 1 })).toBeVisible();
  await expect(page.getByTestId('map-workspace')).toBeVisible();
  await expect(page.getByTestId('map-workspace')).toHaveAttribute(
    'data-map-state',
    'ready',
  );
  await expect(page.getByText('OpenFreeMap')).toBeVisible();
  const attributionLink = page.getByRole('link', { name: 'OpenFreeMap' });
  await attributionLink.focus();
  await expect(attributionLink).toBeFocused();
  await expect(attributionLink).toHaveAttribute('href', 'https://openfreemap.org');
  await expect(page.getByRole('tab', { name: 'Tracks' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await expect(page.getByRole('tab', { name: 'Plan' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Markers' }).click();
  await expect(page.getByRole('heading', { name: 'No saved markers' })).toBeVisible();
  await page.getByRole('tab', { name: 'Layers' }).click();
  await expect(
    page.getByRole('heading', { name: 'Layer controls are not available yet' }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Layer controls are not available yet' }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#layers');
  expect(externalRequests).toEqual([]);
});

test('has no serious accessibility violations in the shell and settings', async ({
  page,
}) => {
  await page.goto('?developer=1');
  await expect(page.getByRole('heading', { name: 'Tracks', level: 1 })).toBeVisible();

  const shellResults = await new AxeBuilder({ page }).analyze();
  expect(
    shellResults.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);

  await page.getByRole('button', { name: 'Open settings' }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(settingsDialog).toBeVisible();
  await expect
    .poll(() =>
      settingsDialog.evaluate((dialog) => {
        let element: Element | null = dialog;

        while (element) {
          if (Number.parseFloat(getComputedStyle(element).opacity) < 1) {
            return false;
          }
          element = element.parentElement;
        }

        return true;
      }),
    )
    .toBe(true);
  const settingsResults = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(
    settingsResults.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);
});
