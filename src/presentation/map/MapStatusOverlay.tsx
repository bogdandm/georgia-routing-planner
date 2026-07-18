import { Alert, Box, CircularProgress } from '@mui/material';

import type { MapDiagnosticsSnapshot } from '@/presentation/map/mapTypes';

interface MapStatusOverlayProps {
  readonly snapshot: MapDiagnosticsSnapshot;
}

export function MapStatusOverlay({ snapshot }: MapStatusOverlayProps) {
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

  return null;
}
