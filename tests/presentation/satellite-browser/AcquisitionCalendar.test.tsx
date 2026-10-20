import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { AcquisitionCalendar } from '@/presentation/satellite-browser/AcquisitionCalendar';
import { activateAppLocale, appI18n } from '@/presentation/localization/appI18n';

const pickerName = 'Choose acquisition month and year';

/** ClickAwayListener starts listening one macrotask after the picker opens. */
async function activateClickAway() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function CalendarHarness({
  initialMonth,
  navigationDisabled = false,
}: {
  readonly initialMonth: string;
  readonly navigationDisabled?: boolean;
}) {
  const [displayMonth, setDisplayMonth] = useState(initialMonth);
  return (
    <AcquisitionCalendar
      displayMonth={displayMonth}
      maximumMonth="2026-10"
      navigationDisabled={navigationDisabled}
      onMonthChange={setDisplayMonth}
      today={new Date('2026-10-20T12:00:00.000Z')}
      mode={{
        kind: 'scene',
        loadingMonth: null,
        maxCloudCoverPercent: 100,
        result: null,
        onSelectDate: () => undefined,
      }}
    />
  );
}

function renderCalendar(initialMonth: string, navigationDisabled = false) {
  return render(
    <I18nProvider i18n={appI18n}>
      <CalendarHarness
        initialMonth={initialMonth}
        navigationDisabled={navigationDisabled}
      />
    </I18nProvider>,
  );
}

describe('AcquisitionCalendar', () => {
  beforeEach(() => {
    activateAppLocale('en');
  });

  it('keeps the month-year picker open while the year menu opens on mousedown and the click lands on body', async () => {
    const user = userEvent.setup();
    renderCalendar('2026-10');

    const trigger = screen.getByRole('button', { name: `${pickerName}, October 2026` });
    await user.click(trigger);
    await activateClickAway();

    // Real browsers open the Select on mousedown, then dispatch click on the common
    // ancestor of the mousedown and mouseup targets (the Menu backdrop): body.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Acquisition year' }));
    fireEvent.click(document.body);

    // The open year menu is modal, so the picker behind it is aria-hidden meanwhile.
    expect(screen.getByRole('group', { name: pickerName, hidden: true })).toBeVisible();
    expect(screen.getByRole('listbox')).toBeVisible();
    await user.click(screen.getByRole('option', { name: '2016' }));

    expect(screen.getByRole('grid', { name: 'October 2016' })).toBeVisible();
    expect(screen.getByRole('group', { name: pickerName })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Choose Oct 2016', pressed: true }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Choose Mar 2016' }));
    expect(screen.getByRole('grid', { name: 'March 2016' })).toBeVisible();
    expect(screen.queryByRole('group', { name: pickerName })).not.toBeInTheDocument();
  });

  it('closes the month-year picker on an outside press and toggles it from its trigger', async () => {
    const user = userEvent.setup();
    renderCalendar('2026-10');
    const trigger = screen.getByRole('button', { name: `${pickerName}, October 2026` });

    await user.click(trigger);
    await activateClickAway();
    await user.click(document.body);
    expect(screen.queryByRole('group', { name: pickerName })).not.toBeInTheDocument();

    await user.click(trigger);
    await activateClickAway();
    expect(screen.getByRole('group', { name: pickerName })).toBeVisible();
    await user.click(trigger);
    expect(screen.queryByRole('group', { name: pickerName })).not.toBeInTheDocument();
  });

  it('moves the visible month by one year within the archive and current-month bounds', async () => {
    const user = userEvent.setup();
    renderCalendar('2026-10');
    const previousYear = screen.getByRole('button', {
      name: 'Previous acquisition year',
    });
    const nextYear = screen.getByRole('button', { name: 'Next acquisition year' });

    for (const [control, tooltip] of [
      [previousYear, 'Previous year'],
      [nextYear, 'Next year'],
    ] as const) {
      await user.hover(control.parentElement ?? control);
      expect(await screen.findByRole('tooltip', { name: tooltip })).toBeVisible();
      await user.unhover(control.parentElement ?? control);
    }

    expect(nextYear).toBeDisabled();
    await user.click(previousYear);
    expect(screen.getByRole('grid', { name: 'October 2025' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next acquisition month' }));
    await user.click(screen.getByRole('button', { name: 'Next acquisition month' }));
    expect(screen.getByRole('grid', { name: 'December 2025' })).toBeVisible();

    await user.click(nextYear);
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeVisible();
    expect(nextYear).toBeDisabled();
  });

  it('clamps the previous year to the Sentinel archive start', async () => {
    const user = userEvent.setup();
    renderCalendar('2016-03');
    const previousYear = screen.getByRole('button', {
      name: 'Previous acquisition year',
    });

    await user.click(previousYear);
    expect(screen.getByRole('grid', { name: 'June 2015' })).toBeVisible();
    expect(previousYear).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Previous acquisition month' }),
    ).toBeDisabled();
  });

  it('disables year navigation while navigation is disabled', () => {
    renderCalendar('2020-05', true);

    expect(
      screen.getByRole('button', { name: 'Previous acquisition year' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Next acquisition year' }),
    ).toBeDisabled();
  });
});
