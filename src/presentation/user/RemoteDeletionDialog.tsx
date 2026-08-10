import {
  Alert,
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

function RemoteTrackDeletionForm({
  candidates,
  busy,
  errorMessage,
  userData,
}: {
  readonly candidates: readonly RemoteTrackDeletionCandidate[];
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly userData: UserDataService;
}) {
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(
    () => new Set(),
  );
  const label = actionLabel(selectedTrackIds.size, candidates.length);

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    void userData.resolveRemoteTrackDeletions([...selectedTrackIds]);
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogContent>
        <Stack spacing={2}>
          <Typography>
            These items were deleted from your account. Select the items to delete from
            this browser. Unselected items will be uploaded again.
          </Typography>
          <Stack spacing={0.5}>
            {candidates.map((candidate) => (
              <FormControlLabel
                key={candidate.trackId}
                sx={{ m: 0 }}
                slotProps={{ typography: { variant: 'body2' } }}
                control={
                  <Checkbox
                    checked={selectedTrackIds.has(candidate.trackId)}
                    disabled={busy}
                    onChange={(_, checked) => {
                      setSelectedTrackIds((current) => {
                        const next = new Set(current);
                        if (checked) next.add(candidate.trackId);
                        else next.delete(candidate.trackId);
                        return next;
                      });
                    }}
                    size="small"
                    sx={{ p: 0, mr: 1 }}
                  />
                }
                label={candidate.name}
              />
            ))}
          </Stack>
          {errorMessage === null ? null : (
            <Alert severity="error">{errorMessage}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} type="submit" variant="contained">
          {label}
        </Button>
      </DialogActions>
    </form>
  );
}

/** Resolves a remote deletion without coupling the decision to a workspace tab. */
export function RemoteDeletionDialog() {
  const { userData } = useRuntimeServices();
  const snapshot = useUserDataSnapshot(userData);
  const candidates = snapshot.remoteTrackDeletions;
  const candidateKey = candidates.map((candidate) => candidate.trackId).join('|');

  return (
    <Dialog
      onClose={() => undefined}
      open={candidates.length > 0}
      aria-labelledby="remote-deletion-title"
    >
      <DialogTitle id="remote-deletion-title">
        Items deleted from cloud
      </DialogTitle>
      {candidates.length === 0 ? null : (
        <RemoteTrackDeletionForm
          key={candidateKey}
          busy={snapshot.busy}
          candidates={candidates}
          errorMessage={snapshot.errorMessage}
          userData={userData}
        />
      )}
    </Dialog>
  );
}
