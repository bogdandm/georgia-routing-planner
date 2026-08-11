import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TrackShareService } from '@/application/tracks/TrackShareService';
import { TrackShareDialog } from '@/presentation/tracks/TrackShareDialog';

const contentHash = 'a'.repeat(64);
const token = 'A'.repeat(43);

afterEach(() => {
  vi.unstubAllGlobals();
});

function service(overrides: Partial<TrackShareService> = {}): TrackShareService {
  return {
    status: vi.fn().mockResolvedValue({ enabled: false }),
    enable: vi.fn().mockResolvedValue({ enabled: true, token }),
    disable: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn(),
    ...overrides,
  };
}

describe('TrackShareDialog', () => {
  it('enables one link and leaves a manual copy path after clipboard denial', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const enable = vi.fn().mockResolvedValue({ enabled: true, token });
    const trackShares = service({ enable });

    render(
      <TrackShareDialog
        contentHash={contentHash}
        open
        service={trackShares}
        onClose={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Share' }));

    await waitFor(() => {
      expect(enable).toHaveBeenCalledWith(contentHash, expect.any(AbortSignal));
    });
    expect(screen.getByLabelText('Share link')).toHaveValue(
      `${window.location.origin}/#tracks/share/1.${token}`,
    );
    expect(
      screen.getByText('Sharing is enabled, but the link could not be copied.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Disable share' })).toBeVisible();
  });

  it('does not restore a link after disabling it during a clipboard operation', async () => {
    const user = userEvent.setup();
    let resolveCopy: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const disable = vi.fn().mockResolvedValue(undefined);
    const trackShares = service({
      status: vi.fn().mockResolvedValue({ enabled: true, token }),
      disable,
    });

    render(
      <TrackShareDialog
        contentHash={contentHash}
        open
        service={trackShares}
        onClose={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Copy link' }));
    await user.click(screen.getByRole('button', { name: 'Disable share' }));
    await waitFor(() => {
      expect(disable).toHaveBeenCalledWith(contentHash, expect.any(AbortSignal));
    });
    resolveCopy?.();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Share' })).toBeVisible();
    });
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  });
});
