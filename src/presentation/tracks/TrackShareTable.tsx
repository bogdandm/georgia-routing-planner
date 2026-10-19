import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import {
  Box,
  CircularProgress,
  Divider,
  IconButton,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { TrackShareError } from '@/application/tracks/TrackShareService';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { CopyLinkButton } from '@/presentation/map/CopyLinkButton';
import { useOptionalTracksWorkspace } from '@/presentation/tracks/TracksWorkspace';
import { createTrackShareUrl } from '@/presentation/tracks/trackShareUrl';

/** A track drawn on the map; only a synchronized saved track has a content hash. */
interface DisplayedTrack {
  readonly id: string;
  readonly name: string;
  readonly saved: boolean;
  readonly contentHash: string | null;
}

type TrackShareState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'enabled'; readonly token: string }
  /** The server has no ready synchronized record for this hash yet. */
  | { readonly kind: 'unsynced' }
  | { readonly kind: 'status-failed' };

function isUnsyncedTrackError(error: unknown): boolean {
  return (
    error instanceof TrackShareError &&
    (error.category === 'track-not-found' || error.category === 'track-not-ready')
  );
}

function TrackShareRow({
  track,
  signedIn,
  mapUrl,
}: {
  readonly track: DisplayedTrack;
  readonly signedIn: boolean;
  readonly mapUrl: string;
}) {
  const { t, i18n } = useLingui();
  const { trackShares } = useRuntimeServices();
  const { name } = track;
  const contentHash = signedIn ? track.contentHash : null;
  // The row remounts when its hash or sign-in changes, so the first status load needs
  // no synchronous state reset.
  const [state, setState] = useState<TrackShareState>(
    contentHash === null ? { kind: 'disabled' } : { kind: 'loading' },
  );
  const [problem, setProblem] = useState<MessageDescriptor | null>(null);
  const operation = useRef<AbortController | null>(null);
  const beginOperation = () => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    return controller;
  };

  // Settles to the next row state, so callers apply it only while still current.
  const readStatus = useCallback(
    async (hash: string, signal: AbortSignal): Promise<TrackShareState> => {
      if (trackShares === null) return { kind: 'disabled' };
      try {
        const status = await trackShares.status(hash, signal);
        return status.enabled
          ? { kind: 'enabled', token: status.token }
          : { kind: 'disabled' };
      } catch (error) {
        return isUnsyncedTrackError(error)
          ? { kind: 'unsynced' }
          : { kind: 'status-failed' };
      }
    },
    [trackShares],
  );
  useEffect(() => {
    if (contentHash === null) return undefined;
    const controller = new AbortController();
    operation.current = controller;
    void readStatus(contentHash, controller.signal).then((next) => {
      if (operation.current === controller) setState(next);
    });
    return () => {
      controller.abort();
      if (operation.current === controller) operation.current = null;
    };
  }, [contentHash, readStatus]);
  const retryStatus = () => {
    if (contentHash === null) return;
    const controller = beginOperation();
    setState({ kind: 'loading' });
    void readStatus(contentHash, controller.signal).then((next) => {
      if (operation.current === controller) setState(next);
    });
  };

  const toggleShare = async () => {
    if (
      trackShares === null ||
      contentHash === null ||
      (state.kind !== 'disabled' && state.kind !== 'enabled')
    ) {
      return;
    }
    const previous = state;
    const controller = beginOperation();
    setState({ kind: 'loading' });
    setProblem(null);
    try {
      if (previous.kind === 'disabled') {
        const enabled = await trackShares.enable(contentHash, controller.signal);
        if (operation.current !== controller) return;
        setState({ kind: 'enabled', token: enabled.token });
      } else {
        await trackShares.disable(contentHash, controller.signal);
        if (operation.current !== controller) return;
        setState({ kind: 'disabled' });
      }
    } catch (error) {
      if (operation.current !== controller) return;
      if (isUnsyncedTrackError(error)) {
        setState({ kind: 'unsynced' });
        return;
      }
      setState(previous);
      setProblem(msg`Sharing could not be updated. Try again.`);
    }
  };

  const copyLink = async (): Promise<boolean> => {
    if (state.kind !== 'enabled') return false;
    try {
      await navigator.clipboard.writeText(createTrackShareUrl(mapUrl, state.token));
      setProblem(null);
      return true;
    } catch {
      setProblem(msg`The link could not be copied. Try again.`);
      return false;
    }
  };

  let note: string | null = null;
  if (problem !== null) {
    note = i18n._(problem);
  } else if (state.kind === 'status-failed') {
    note = t`Sharing status could not be loaded.`;
  } else if (!track.saved) {
    note = t`Save the track to share it.`;
  } else if (state.kind === 'unsynced' || (signedIn && track.contentHash === null)) {
    note = t`Sync this track before sharing.`;
  }

  return (
    <Box
      component="li"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 48px auto',
        columnGap: 1,
        alignItems: 'center',
        py: 0.5,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap title={name}>
          {name}
        </Typography>
        {note === null ? null : (
          <Typography
            variant="caption"
            color={problem === null ? 'text.secondary' : 'error'}
            sx={{ display: 'block' }}
          >
            {note}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        {state.kind === 'loading' ? (
          <CircularProgress aria-label={t`Loading sharing status`} size={20} />
        ) : state.kind === 'status-failed' ? (
          <Tooltip title={t`Retry sharing status`}>
            <IconButton
              size="small"
              aria-label={t`Retry sharing status`}
              onClick={() => {
                retryStatus();
              }}
            >
              <RefreshOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          <Switch
            size="small"
            checked={state.kind === 'enabled'}
            disabled={contentHash === null || state.kind === 'unsynced'}
            slotProps={{
              input: { 'aria-label': t`Share ${name} publicly` },
            }}
            onChange={() => {
              void toggleShare();
            }}
          />
        )}
      </Box>
      <CopyLinkButton
        label={t`Copy link`}
        variant="outlined"
        disabled={state.kind !== 'enabled' || mapUrl === ''}
        copy={copyLink}
      />
    </Box>
  );
}

/**
 * The Share dialog's public-link table for the tracks drawn on the map: the open track
 * or every multi-track selection. Each copied link is `mapUrl` plus the track, so the
 * recipient gets the same layer and 2D/3D mode. Renders nothing without cloud sharing
 * or a displayed track.
 */
export function TrackShareTable({ mapUrl }: { readonly mapUrl: string }) {
  const { t } = useLingui();
  const workspace = useOptionalTracksWorkspace();
  const { trackShares, userData } = useRuntimeServices();
  const subscribeUser = useCallback(
    (listener: () => void) => userData.subscribe(listener),
    [userData],
  );
  const getUserSnapshot = useCallback(() => userData.getSnapshot(), [userData]);
  const signedIn =
    useSyncExternalStore(subscribeUser, getUserSnapshot, getUserSnapshot).status ===
    'signed-in';

  const tracks: DisplayedTrack[] = [];
  if (workspace?.multiTrackMode === true) {
    for (const selection of workspace.multiTrackSelections) {
      const contentHash = selection.summary.contentHash ?? null;
      // A public share belongs to the content hash, so tracks with identical geometry
      // share one row instead of showing diverging states for one server share.
      if (
        contentHash !== null &&
        tracks.some((track) => track.contentHash === contentHash)
      ) {
        continue;
      }
      tracks.push({
        id: selection.summary.id,
        name: selection.summary.name,
        saved: true,
        contentHash,
      });
    }
  } else if (workspace?.active?.kind === 'saved') {
    const { summary } = workspace.active;
    tracks.push({
      id: summary.id,
      name: summary.name,
      saved: true,
      contentHash: summary.contentHash ?? null,
    });
  } else if (workspace !== null && workspace.active !== null) {
    const { active } = workspace;
    tracks.push({
      id: active.id,
      name: active.name.trim() === '' ? t`New track` : active.name,
      saved: false,
      contentHash: null,
    });
  }
  if (trackShares === null || tracks.length === 0) return null;

  return (
    <>
      <Divider />
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          <Trans>Tracks</Trans>
        </Typography>
        {signedIn ? null : (
          <Typography variant="caption" color="text.secondary">
            <Trans>Sign in to share tracks publicly.</Trans>
          </Typography>
        )}
        <Box component="ul" aria-label={t`Tracks`} sx={{ m: 0, mt: 0.5, p: 0 }}>
          {tracks.map((track) => (
            <TrackShareRow
              // Remount on a new hash or sign-in so the row reloads its own status.
              key={`${track.id}:${track.contentHash ?? ''}:${String(signedIn)}`}
              track={track}
              signedIn={signedIn}
              mapUrl={mapUrl}
            />
          ))}
        </Box>
      </Box>
    </>
  );
}
