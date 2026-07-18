import { Alert, Box, Button, CircularProgress } from '@mui/material';

import type { MapDiagnosticsSnapshot } from '@/presentation/map/mapTypes';

interface MapStatusOverlayProps {
  readonly snapshot: MapDiagnosticsSnapshot;
  readonly onRetry: () => void;
}

export function MapStatusOverlay({ snapshot, onRetry }: MapStatusOverlayProps) {
  if (snapshot.lifecycle === 'loading') {
    return (
      <Box
        role="status"
        aria-label="Loading map workspace"
        sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}
      >
        <CircularProgress aria-hidden />
      </Box>
    );
  }

  if (snapshot.lifecycle === 'fatal') {
    return (
      <Alert
        severity="error"
        sx={{ position: 'absolute', inset: 16, height: 'fit-content' }}
      >
        {snapshot.message ?? 'The map workspace is unavailable.'}
      </Alert>
    );
  }

  const latestFailure = snapshot.recoverableFailures.at(-1);
  if (
    snapshot.lifecycle === 'degraded' &&
    snapshot.message !== null &&
    latestFailure?.category !== 'terrain'
  ) {
    return (
      <Alert
        severity="warning"
        action={
          <Button color="inherit" size="small" onClick={onRetry}>
            Retry map data
          </Button>
        }
        sx={{ position: 'absolute', top: 72, left: 12, right: 12, zIndex: 1 }}
      >
        {snapshot.message}
      </Alert>
    );
  }

  return null;
}
