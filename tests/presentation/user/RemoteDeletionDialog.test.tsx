import { ThemeProvider } from '@mui/material';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type {
  UserDataService,
  UserDataSnapshot,
} from '@/application/user/UserDataService';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { RemoteDeletionDialog } from '@/presentation/user/RemoteDeletionDialog';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { createTestServices } from '@test/helpers/createTestServices';

const candidates = [
  { trackId: 'local:alpha', name: 'Alpha' },
  { trackId: 'local:beta', name: 'Beta' },
];

function snapshot(overrides: Partial<UserDataSnapshot> = {}): UserDataSnapshot {
  return {
    busy: false,
    email: 'user@example.test',
    userId: 'user-id',
    errorMessage: null,
    noticeMessage: null,
    status: 'signed-in',
    syncEnabled: true,
    syncStatus: 'needs-action',
    syncProgress: null,
    syncUsage: { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 },
    remoteTrackDeletions: candidates,
    remoteMarkerDeletions: [],
    ...overrides,
  };
}

function createService(initial: UserDataSnapshot) {
  let current = initial;
  const listeners = new Set<() => void>();
  const resolveRemoteDeletions = vi.fn().mockResolvedValue(undefined);
  const service: UserDataService = {
    dispose: vi.fn(),
    getSnapshot: () => current,
    resolveRemoteDeletions,
    setSyncEnabled: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue(undefined),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeTracksChanged: () => () => undefined,
    subscribeMarkersChanged: () => () => undefined,
    synchronizeNow: vi.fn().mockResolvedValue(undefined),
    trackDeleted: vi.fn().mockResolvedValue(undefined),
    trackMetadataChanged: vi.fn().mockResolvedValue(undefined),
    trackSaved: vi.fn().mockResolvedValue(undefined),
    markerChanged: vi.fn().mockResolvedValue(undefined),
    markerDeleted: vi.fn().mockResolvedValue(undefined),
  };
  return {
    resolveRemoteDeletions,
    service,
    set(next: UserDataSnapshot) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}

function renderDialog(userData: UserDataService) {
  return render(
    <RuntimeServicesProvider services={createTestServices({ userData })}>
      <ThemeProvider theme={createAppTheme()}>
        <RemoteDeletionDialog />
      </ThemeProvider>
    </RuntimeServicesProvider>,
  );
}

describe('RemoteDeletionDialog', () => {
  it('restores every track by default', async () => {
    const user = userEvent.setup();
    const fake = createService(snapshot());
    renderDialog(fake.service);

    expect(screen.getByRole('checkbox', { name: 'Alpha' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Beta' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(fake.resolveRemoteDeletions).toHaveBeenCalledWith({
      deleteTrackIds: [],
      deleteMarkerIds: [],
    });
  });

  it('partitions mixed track and marker selections in one decision', async () => {
    const user = userEvent.setup();
    const fake = createService(
      snapshot({
        remoteMarkerDeletions: [{ markerId: 'marker:alpha', name: 'Alpha' }],
      }),
    );
    renderDialog(fake.service);

    const tracks = within(screen.getByRole('region', { name: 'Tracks' }));
    const markers = within(screen.getByRole('region', { name: 'Markers' }));
    await user.click(tracks.getByRole('checkbox', { name: 'Alpha' }));
    expect(markers.getByRole('checkbox', { name: 'Alpha' })).not.toBeChecked();
    await user.click(
      screen.getByRole('button', { name: 'Delete selected, upload the rest again' }),
    );

    expect(fake.resolveRemoteDeletions).toHaveBeenCalledWith({
      deleteTrackIds: ['local:alpha'],
      deleteMarkerIds: [],
    });
  });

  it('updates its action label for partial and empty selections', async () => {
    const user = userEvent.setup();
    const fake = createService(snapshot());
    renderDialog(fake.service);

    expect(screen.getByRole('button', { name: 'Restore' })).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    expect(
      screen.getByRole('button', { name: 'Delete selected, upload the rest again' }),
    ).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Beta' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  it('remains open when Escape or its backdrop requests dismissal', () => {
    const fake = createService(snapshot());
    renderDialog(fake.service);

    fireEvent.keyDown(document, { key: 'Escape' });
    const dialog = screen.getByRole('dialog', { name: 'Items deleted from cloud' });
    fireEvent.mouseDown(dialog.parentElement?.parentElement ?? document.body);

    expect(
      screen.getByRole('dialog', { name: 'Items deleted from cloud' }),
    ).toBeVisible();
  });

  it('disables choices while resolving and shows the retained decision error', () => {
    const fake = createService(
      snapshot({
        busy: true,
        errorMessage:
          'Unable to apply the deletion decision. Your local data remains available.',
      }),
    );
    renderDialog(fake.service);

    expect(screen.getByRole('checkbox', { name: 'Alpha' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to apply the deletion decision. Your local data remains available.',
    );
  });
});
