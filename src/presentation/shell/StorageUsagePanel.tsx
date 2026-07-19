import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';

import type {
  StorageUsageReader,
  StorageUsageSnapshot,
} from '@/application/ports/StorageUsageReader';

interface StorageUsagePanelProps {
  readonly reader: StorageUsageReader;
}

type StorageUsageState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: StorageUsageSnapshot }
  | { readonly status: 'error' };

function formatMegabytes(bytes: number | null): string {
  return bytes === null ? 'Not reported' : `${(bytes / 1_048_576).toFixed(2)} MB`;
}

function MetricRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ minHeight: 28, alignItems: 'center', justifyContent: 'space-between' }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Stack>
  );
}

/** Compact read-only origin-storage and JS-heap summary for Settings. */
export function StorageUsagePanel({ reader }: StorageUsagePanelProps) {
  const [state, setState] = useState<StorageUsageState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', snapshot: await reader.read() });
    } catch {
      setState({ status: 'error' });
    }
  }, [reader]);

  useEffect(() => {
    let active = true;
    void reader
      .read()
      .then((snapshot) => {
        if (active) setState({ status: 'ready', snapshot });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [reader]);

  if (state.status === 'loading') {
    return (
      <Stack direction="row" spacing={1} sx={{ py: 2, alignItems: 'center' }}>
        <CircularProgress size={18} />
        <Typography variant="body2">Measuring browser storage…</Typography>
      </Stack>
    );
  }

  if (state.status === 'error') {
    return (
      <Alert
        severity="warning"
        action={
          <Button color="inherit" size="small" onClick={() => void refresh()}>
            Retry
          </Button>
        }
      >
        Browser storage usage could not be measured.
      </Alert>
    );
  }

  const snapshot = state.snapshot;
  return (
    <Stack spacing={1.25}>
      <Box>
        <MetricRow
          label="Total app storage"
          value={formatMegabytes(snapshot.totalStoredBytes)}
        />
        <MetricRow
          label="Local database (IndexedDB)"
          value={formatMegabytes(snapshot.indexedDbBytes)}
        />
        <MetricRow
          label="Cache Storage"
          value={formatMegabytes(snapshot.cacheStorageBytes)}
        />
        <MetricRow
          label="localStorage"
          value={formatMegabytes(snapshot.localStorageBytes)}
        />
        <MetricRow
          label="Other origin storage"
          value={formatMegabytes(snapshot.otherOriginStorageBytes)}
        />
        <MetricRow label="Origin quota" value={formatMegabytes(snapshot.quotaBytes)} />
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.25 }}>
          Approximate JavaScript memory
        </Typography>
        <MetricRow label="Used heap" value={formatMegabytes(snapshot.heapUsedBytes)} />
        <MetricRow
          label="Allocated heap"
          value={formatMegabytes(snapshot.heapAllocatedBytes)}
        />
        <MetricRow label="Heap limit" value={formatMegabytes(snapshot.heapLimitBytes)} />
      </Box>

      <Alert severity="info" icon={false} sx={{ py: 0.25 }}>
        Chrome manages HTTP and MapLibre tile caches internally. Web apps cannot measure
        or clear that browser cache. Applied raster sources are removed from MapLibre
        when they are replaced.
      </Alert>

      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary">
          Measured {new Date(snapshot.measuredAt).toLocaleTimeString()}
        </Typography>
        <Button
          size="small"
          startIcon={<RefreshOutlinedIcon />}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
      </Stack>
    </Stack>
  );
}
