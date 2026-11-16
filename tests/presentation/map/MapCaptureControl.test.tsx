import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activateAppLocale } from '@/presentation/localization/appI18n';
import {
  MapCapturePopover,
  type MapCaptureControlProps,
} from '@/presentation/map/MapCaptureControl';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

function renderPopover(props: MapCaptureControlProps) {
  const anchor = document.body.appendChild(document.createElement('button'));
  return renderWithI18n(
    <MapCapturePopover
      {...props}
      anchorEl={anchor}
      onClose={vi.fn()}
      panelId="capture"
    />,
  );
}

describe('MapCapturePopover', () => {
  beforeEach(() => {
    activateAppLocale('en');
  });

  it('reports whether the screenshot reached the clipboard', async () => {
    const user = userEvent.setup();
    const onCopyScreenshot = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('denied'));
    renderPopover({ onCopyScreenshot });

    const take = screen.getByRole('button', { name: 'Take a screenshot' });
    await user.click(take);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Map image copied to the clipboard',
    );

    await user.click(take);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The map image could not be copied.',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onCopyScreenshot).toHaveBeenCalledTimes(2);
  });
});
