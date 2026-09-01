import { ThemeProvider } from '@mui/material';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrackMarker } from '@/domain/tracks/localTrack';
import {
  mapInteractionStore,
  resetMapInteractionStore,
} from '@/presentation/map/mapInteractionStore';
import { TrackMarkersSection } from '@/presentation/tracks/TrackMarkersSection';
import { createAppTheme } from '@/presentation/theme/createAppTheme';

const marker: TrackMarker = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Summit flag',
  coordinate: [44.5, 42.25],
};

function renderSection(
  overrides: {
    readonly markers?: readonly TrackMarker[];
    readonly onAdd?: () => void;
    readonly onRename?: (markerId: string, name: string) => Promise<void>;
    readonly onDelete?: (markerId: string) => Promise<void>;
  } = {},
) {
  return render(
    <ThemeProvider theme={createAppTheme()}>
      <TrackMarkersSection
        markers={overrides.markers ?? []}
        onAdd={overrides.onAdd ?? vi.fn()}
        onRename={overrides.onRename ?? vi.fn().mockResolvedValue(undefined)}
        onDelete={overrides.onDelete ?? vi.fn().mockResolvedValue(undefined)}
      />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  resetMapInteractionStore();
});

describe('TrackMarkersSection', () => {
  it('starts collapsed with an independent add action and accessible empty state', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    renderSection({ onAdd });

    const disclosure = screen.getByRole('button', { name: 'Markers' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('No markers for this track.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add track marker' }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('No markers for this track.')).toBeVisible();
  });

  it('uses a fixed flag row and navigates to the marker without appearance controls', async () => {
    const user = userEvent.setup();
    renderSection({ markers: [marker] });

    await user.click(screen.getByRole('button', { name: 'Markers' }));
    expect(screen.getByRole('img', { name: 'Track marker flag' })).toBeVisible();
    expect(screen.getByText(marker.name)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Marker actions/u }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: 'Marker color' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText(marker.name));
    expect(mapInteractionStore.getState().navigationCommand?.target).toEqual({
      longitude: 44.5,
      latitude: 42.25,
    });
  });

  it('renames inline with the shared field, Save, Cancel, Enter, and Escape contract', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderSection({ markers: [marker], onRename });

    await user.click(screen.getByRole('button', { name: 'Markers' }));
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const name = screen.getByRole('textbox', { name: 'Marker name' });
    expect(name).toHaveValue(marker.name);
    expect(screen.getByRole('button', { name: 'Save' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();

    await user.clear(name);
    await user.type(name, 'Renamed summit{Enter}');
    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith(marker.id, 'Renamed summit');
    });

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.type(screen.getByRole('textbox', { name: 'Marker name' }), '{Escape}');
    expect(
      screen.queryByRole('textbox', { name: 'Marker name' }),
    ).not.toBeInTheDocument();
  });

  it('keeps inline actions open for validation and persistence failures', async () => {
    const onRename = vi.fn((_markerId: string, name: string) =>
      Promise.reject(
        new Error(
          name.trim() === '' ? 'Marker name is required.' : 'Rename unavailable',
        ),
      ),
    );
    const onDelete = vi.fn().mockRejectedValue(new Error('Delete unavailable'));
    const user = userEvent.setup();
    renderSection({ markers: [marker], onRename, onDelete });

    await user.click(screen.getByRole('button', { name: 'Markers' }));
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const name = screen.getByRole('textbox', { name: 'Marker name' });
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Marker name is required.')).toBeVisible();
    expect(onRename).toHaveBeenCalledWith(marker.id, '');

    await user.type(name, 'Valid name');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Rename unavailable')).toBeVisible();
    expect(name).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: `Delete ${marker.name}` }));
    await user.click(
      screen.getByRole('button', { name: `Confirm deletion of ${marker.name}` }),
    );
    expect(await screen.findByText('Delete unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: `Delete ${marker.name}` })).toBeVisible();
  });

  it('requires a second delete action before removing a marker', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderSection({ markers: [marker], onDelete });

    await user.click(screen.getByRole('button', { name: 'Markers' }));
    await user.click(screen.getByRole('button', { name: `Delete ${marker.name}` }));
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: `Confirm deletion of ${marker.name}` }),
    );
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(marker.id);
    });
  });
});
