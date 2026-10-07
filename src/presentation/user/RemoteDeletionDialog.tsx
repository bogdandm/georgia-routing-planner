import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import {
  useCallback,
  useState,
  useSyncExternalStore,
  type SyntheticEvent,
} from 'react';

import type {
  RemoteMarkerDeletionCandidate,
  RemoteTrackDeletionCandidate,
  UserDataService,
  UserDataSnapshot,
} from '@/application/user/UserDataService';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { userDataProblemMessage } from '@/presentation/user/userDataMessages';

function useUserDataSnapshot(userData: UserDataService) {
  const subscribe = useCallback(
    (listener: () => void) => userData.subscribe(listener),
    [userData],
  );
  const getSnapshot = useCallback(() => userData.getSnapshot(), [userData]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function actionLabel(selectedCount: number, candidateCount: number): MessageDescriptor {
  if (selectedCount === candidateCount) return msg`Delete`;
  if (selectedCount === 0) return msg`Restore`;
  return msg`Delete selected, upload the rest again`;
}

function RemoteDeletionForm({
  tracks,
  markers,
  busy,
  problem,
  userData,
}: {
  readonly tracks: readonly RemoteTrackDeletionCandidate[];
  readonly markers: readonly RemoteMarkerDeletionCandidate[];
  readonly busy: boolean;
  readonly problem: UserDataSnapshot['problem'];
  readonly userData: UserDataService;
}) {
  const { i18n, t } = useLingui();
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedMarkerIds, setSelectedMarkerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const selectedCount = selectedTrackIds.size + selectedMarkerIds.size;
  const candidateCount = tracks.length + markers.length;
  const handleSubmit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    void userData.resolveRemoteDeletions({
      deleteTrackIds: [...selectedTrackIds],
      deleteMarkerIds: [...selectedMarkerIds],
    });
  };
  const toggle = (
    setSelected: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
    checked: boolean,
  ) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  return (
    <form onSubmit={handleSubmit}>
      <DialogContent>
        <Stack spacing={2}>
          <Typography>
            <Trans>
              These items were deleted from your account. Select the items to delete
              from this browser. Unselected items will be uploaded again.
            </Trans>
          </Typography>
          {tracks.length === 0 ? null : (
            <Box component="section" aria-label={t`Tracks`}>
              <Typography component="h3" variant="subtitle2">
                <Trans>Tracks</Trans>
              </Typography>
              <Stack spacing={0.5}>
                {tracks.map((candidate) => (
                  <FormControlLabel
                    key={candidate.trackId}
                    sx={{ m: 0 }}
                    slotProps={{ typography: { variant: 'body2' } }}
                    control={
                      <Checkbox
                        checked={selectedTrackIds.has(candidate.trackId)}
                        disabled={busy}
                        onChange={(_, checked) => {
                          toggle(setSelectedTrackIds, candidate.trackId, checked);
                        }}
                        size="small"
                        sx={{ p: 0, mr: 1 }}
                      />
                    }
                    label={candidate.name}
                  />
                ))}
              </Stack>
            </Box>
          )}
          {markers.length === 0 ? null : (
            <Box component="section" aria-label={t`Markers`}>
              <Typography component="h3" variant="subtitle2">
                <Trans>Markers</Trans>
              </Typography>
              <Stack spacing={0.5}>
                {markers.map((candidate) => (
                  <FormControlLabel
                    key={candidate.markerId}
                    sx={{ m: 0 }}
                    slotProps={{ typography: { variant: 'body2' } }}
                    control={
                      <Checkbox
                        checked={selectedMarkerIds.has(candidate.markerId)}
                        disabled={busy}
                        onChange={(_, checked) => {
                          toggle(setSelectedMarkerIds, candidate.markerId, checked);
                        }}
                        size="small"
                        sx={{ p: 0, mr: 1 }}
                      />
                    }
                    label={candidate.name}
                  />
                ))}
              </Stack>
            </Box>
          )}
          {problem === null ? null : (
            <Alert severity="error">{i18n._(userDataProblemMessage(problem))}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} type="submit" variant="contained">
          {i18n._(actionLabel(selectedCount, candidateCount))}
        </Button>
      </DialogActions>
    </form>
  );
}

/** Resolves a remote deletion without coupling the decision to a workspace tab. */
export function RemoteDeletionDialog() {
  const { userData } = useRuntimeServices();
  const snapshot = useUserDataSnapshot(userData);
  const tracks = snapshot.remoteTrackDeletions;
  const markers = snapshot.remoteMarkerDeletions;
  const candidateKey = [
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Stable candidate key.
    ...tracks.map((candidate) => `track:${candidate.trackId}`),
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Stable candidate key.
    ...markers.map((candidate) => `marker:${candidate.markerId}`),
  ].join('|');
  const open = tracks.length > 0 || markers.length > 0;
  return (
    <Dialog
      onClose={() => undefined}
      open={open}
      aria-labelledby="remote-deletion-title"
    >
      <DialogTitle id="remote-deletion-title">
        <Trans>Items deleted from cloud</Trans>
      </DialogTitle>
      {open ? (
        <RemoteDeletionForm
          key={candidateKey}
          busy={snapshot.busy}
          tracks={tracks}
          markers={markers}
          problem={snapshot.problem}
          userData={userData}
        />
      ) : null}
    </Dialog>
  );
}
