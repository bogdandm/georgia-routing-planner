import { Trans, useLingui } from '@lingui/react/macro';
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

const warningSeverity = 'warning' as const;
const infoSeverity = 'info' as const;
function formatMegabytes(locale: string, bytes: number): string {
  /* eslint-disable -- Intl option values are locale-independent formatting tokens. */
  const formatter = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'megabyte',
    unitDisplay: 'short',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(bytes / 1_048_576);
  /* eslint-enable */
}

function MetricRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ minHeight: 28, alignItems: 'center', justifyContent: 'space-between' }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function OptionalMetricRow({
  label,
  bytes,
}: {
  readonly label: string;
  readonly bytes: number | null;
}) {
  const { i18n } = useLingui();
  return bytes === null ? null : (
    <MetricRow label={label} value={formatMegabytes(i18n.locale, bytes)} />
  );
}

/** Compact read-only origin-storage and JS-heap summary for Settings. */
export function StorageUsagePanel({ reader }: StorageUsagePanelProps) {
  const { i18n, t } = useLingui();
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
        <Typography variant="body2">
          <Trans>Measuring browser storage…</Trans>
        </Typography>
      </Stack>
    );
  }

  if (state.status === 'error') {
    return (
      <Alert
        severity={warningSeverity}
        action={
          <Button color="inherit" size="small" onClick={() => void refresh()}>
            <Trans>Retry</Trans>
          </Button>
        }
      >
        <Trans>Browser storage usage could not be measured.</Trans>
      </Alert>
    );
  }

  const snapshot = state.snapshot;
  const hasHeapMetrics =
    snapshot.heapUsedBytes !== null ||
    snapshot.heapAllocatedBytes !== null ||
    snapshot.heapLimitBytes !== null;
  /* eslint-disable -- Intl option token, not user-visible copy. */
  const measuredAt = new Intl.DateTimeFormat(i18n.locale, {
    timeStyle: 'medium',
  }).format(new Date(snapshot.measuredAt));
  /* eslint-enable */
  return (
    <Stack spacing={1.25}>
      <Box>
        <OptionalMetricRow
          label={t`Total app storage`}
          bytes={snapshot.totalStoredBytes}
        />
        <OptionalMetricRow
          label={t`Local database (IndexedDB)`}
          bytes={snapshot.indexedDbBytes}
        />
        <OptionalMetricRow
          label={t`Cache Storage`}
          bytes={snapshot.cacheStorageBytes}
        />
        <MetricRow
          label={t`localStorage`}
          value={formatMegabytes(i18n.locale, snapshot.localStorageBytes)}
        />
        <OptionalMetricRow
          label={t`Other origin storage`}
          bytes={snapshot.otherOriginStorageBytes}
        />
        <OptionalMetricRow label={t`Origin quota`} bytes={snapshot.quotaBytes} />
      </Box>

      {hasHeapMetrics ? <Divider /> : null}

      {hasHeapMetrics ? (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.25 }}>
            <Trans>Approximate JavaScript memory</Trans>
          </Typography>
          <OptionalMetricRow label={t`Used heap`} bytes={snapshot.heapUsedBytes} />
          <OptionalMetricRow
            label={t`Allocated heap`}
            bytes={snapshot.heapAllocatedBytes}
          />
          <OptionalMetricRow label={t`Heap limit`} bytes={snapshot.heapLimitBytes} />
        </Box>
      ) : null}

      <Alert severity={infoSeverity} icon={false} sx={{ py: 0.25 }}>
        <Trans>
          Chrome manages HTTP and MapLibre tile caches internally. Web apps cannot
          measure or clear that browser cache. Applied raster sources are removed from
          MapLibre when they are replaced.
        </Trans>
      </Alert>

      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant="caption" color="text.secondary">
          <Trans>Measured {measuredAt}</Trans>
        </Typography>
        <Button
          size="small"
          startIcon={<RefreshOutlinedIcon />}
          onClick={() => void refresh()}
        >
          <Trans>Refresh</Trans>
        </Button>
      </Stack>
    </Stack>
  );
}
