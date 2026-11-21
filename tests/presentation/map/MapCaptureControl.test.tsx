import { act, screen, waitFor } from '@testing-library/react';
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
    renderPopover({
      onCopyScreenshot,
      onRecordDayVideo: null,
      onRecordTrackVideo: null,
    });

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

  it('asks for sun shadows, then for an open track, before recording', () => {
    const { unmount } = renderPopover({
      onCopyScreenshot: vi.fn(),
      onRecordDayVideo: null,
      onRecordTrackVideo: null,
    });

    expect(
      screen.getByRole('button', { name: 'Record a video of the day' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record a track video' })).toBeDisabled();
    expect(screen.getByText('Turn on sun shadows to record a video.')).toBeVisible();
    expect(
      screen.queryByText('Open a track to record its video.'),
    ).not.toBeInTheDocument();
    unmount();

    renderPopover({
      onCopyScreenshot: vi.fn(),
      onRecordDayVideo: vi.fn(),
      onRecordTrackVideo: null,
    });
    expect(
      screen.getByRole('button', { name: 'Record a video of the day' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Record a track video' })).toBeDisabled();
    expect(screen.getByText('Open a track to record its video.')).toBeVisible();
  });

  it('shows recording progress and tells a cancel from a stop and a failure', async () => {
    const user = userEvent.setup();
    const runs: {
      readonly signal: AbortSignal;
      readonly onProgress: (fraction: number) => void;
      readonly resolve: () => void;
      readonly reject: (error: unknown) => void;
    }[] = [];
    const onRecordDayVideo = vi.fn(
      (signal: AbortSignal, onProgress: (fraction: number) => void) =>
        new Promise<void>((resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted.', 'AbortError'));
          });
          runs.push({ signal, onProgress, resolve, reject });
        }),
    );
    const onRecordTrackVideo = vi.fn<() => Promise<void>>();
    renderPopover({ onCopyScreenshot: vi.fn(), onRecordDayVideo, onRecordTrackVideo });
    const record = screen.getByRole('button', { name: 'Record a video of the day' });
    const recordTrack = screen.getByRole('button', { name: 'Record a track video' });

    let nowMs = 1_000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    await user.click(record);
    expect(record).toBeDisabled();
    // One recording at a time: the other kind waits for this one to end.
    expect(recordTrack).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Recording…');
    act(() => {
      nowMs = 2_000;
      runs[0]?.onProgress(0.1);
    });
    // One second is too little to judge the pace.
    expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
    act(() => {
      nowMs = 41_000;
      runs[0]?.onProgress(0.25);
    });
    expect(screen.getByText('25% · 2 min left')).toBeVisible();
    act(() => {
      nowMs = 81_000;
      runs[0]?.onProgress(0.95);
    });
    expect(screen.getByText('95% · 5 sec left')).toBeVisible();
    clock.mockRestore();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(runs[0]?.signal.aborted).toBe(true);
    await waitFor(() => {
      expect(record).toBeEnabled();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.click(record);
    act(() => {
      runs[1]?.resolve();
    });
    expect(await screen.findByText('The video was downloaded.')).toHaveAttribute(
      'role',
      'status',
    );

    await user.click(record);
    act(() => {
      runs[2]?.reject(new DOMException('Aborted.', 'AbortError'));
    });
    expect(
      await screen.findByText(
        'The recording stopped because the map or the time changed.',
      ),
    ).toHaveAttribute('role', 'status');

    await user.click(record);
    act(() => {
      runs[3]?.reject(new Error('No 2D canvas.'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The video could not be recorded.',
    );
  });
});
