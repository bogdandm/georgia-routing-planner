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
} from '@/application/user/UserDataService';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';

function useUserDataSnapshot(userData: UserDataService) {
  const subscribe = useCallback(
    (listener: () => void) => userData.subscribe(listener),
    [userData],
  );
  const getSnapshot = useCallback(() => userData.getSnapshot(), [userData]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function actionLabel(selectedCount: number, candidateCount: number): string {
  if (selectedCount === candidateCount) return 'Delete';
  if (selectedCount === 0) return 'Restore';
  return 'Delete selected, upload the rest again';
}

function RemoteDeletionForm({
  tracks,
  markers,
  busy,
  errorMessage,
  userData,
}: {
  readonly tracks: readonly RemoteTrackDeletionCandidate[];
  readonly markers: readonly RemoteMarkerDeletionCandidate[];
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly userData: UserDataService;
}) {
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
            These items were deleted from your account. Select the items to delete from
            this browser. Unselected items will be uploaded again.
          </Typography>
          {tracks.length === 0 ? null : (
            <Box component="section" aria-label="Tracks">
              <Typography component="h3" variant="subtitle2">
                Tracks
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
            <Box component="section" aria-label="Markers">
              <Typography component="h3" variant="subtitle2">
                Markers
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
          {errorMessage === null ? null : (
            <Alert severity="error">{errorMessage}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} type="submit" variant="contained">
          {actionLabel(selectedCount, candidateCount)}
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
    ...tracks.map((candidate) => `track:${candidate.trackId}`),
    ...markers.map((candidate) => `marker:${candidate.markerId}`),
  ].join('|');
  const open = tracks.length > 0 || markers.length > 0;
  return (
    <Dialog
      onClose={() => undefined}
      open={open}
      aria-labelledby="remote-deletion-title"
    >
      <DialogTitle id="remote-deletion-title">Items deleted from cloud</DialogTitle>
      {open ? (
        <RemoteDeletionForm
          key={candidateKey}
          busy={snapshot.busy}
          tracks={tracks}
          markers={markers}
          errorMessage={snapshot.errorMessage}
          userData={userData}
        />
      ) : null}
    </Dialog>
  );
}
