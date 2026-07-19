import { Box, Chip, Stack, Typography } from '@mui/material';

import type {
  SentinelQueryDiagnosticsSnapshot,
  SentinelQueryStatus,
  SentinelQueryStepStatus,
} from '@/diagnostics/snapshots/SentinelQueryDiagnosticsStore';

interface SentinelQueryTimelineProps {
  readonly snapshot: SentinelQueryDiagnosticsSnapshot;
}

const operationLabels: Readonly<Record<SentinelQueryStatus, string>> = {
  idle: 'Not run',
  running: 'Running',
  success: 'Completed',
  error: 'Failed',
  cancelled: 'Cancelled',
};

const stepLabels: Readonly<Record<SentinelQueryStepStatus, string>> = {
  waiting: 'Waiting',
  running: 'Running',
  success: 'Completed',
  error: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

function statusColor(
  status: SentinelQueryStatus | SentinelQueryStepStatus,
): 'default' | 'info' | 'success' | 'error' {
  switch (status) {
    case 'running':
      return 'info';
    case 'success':
      return 'success';
    case 'error':
      return 'error';
    case 'idle':
    case 'waiting':
    case 'cancelled':
    case 'skipped':
      return 'default';
  }
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '—';
  if (durationMs < 1_000) return `${String(Math.round(durationMs))} ms`;
  return `${(durationMs / 1_000).toFixed(1)} s`;
}

export function SentinelQueryTimeline({ snapshot }: SentinelQueryTimelineProps) {
  return (
    <Stack spacing={1.5} aria-label="Sentinel query timeline">
      <Box>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Typography component="h3" variant="subtitle2">
            Sentinel query
          </Typography>
          <Chip
            size="small"
            color={statusColor(snapshot.status)}
            label={operationLabels[snapshot.status]}
          />
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          sx={{ mt: 0.5, justifyContent: 'space-between' }}
        >
          <Typography variant="body2" color="text.secondary">
            {snapshot.operationId === null
              ? 'No Sentinel operation has run in this browser.'
              : `Operation ${snapshot.operationId}`}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
          >
            {formatDuration(snapshot.durationMs)}
          </Typography>
        </Stack>
      </Box>

      <Box
        sx={{ overflow: 'hidden', border: 1, borderColor: 'divider', borderRadius: 1 }}
      >
        {snapshot.steps.map((step, index) => (
          <Box
            key={step.id}
            data-testid={`sentinel-query-step-${step.id}`}
            sx={{
              p: 1.5,
              borderBottom: index === snapshot.steps.length - 1 ? 0 : 1,
              borderColor: 'divider',
              bgcolor:
                step.status === 'running' ? 'action.selected' : 'background.paper',
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {step.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {step.detail}
                </Typography>
              </Box>
              <Stack spacing={0.5} sx={{ alignItems: 'flex-end', flexShrink: 0 }}>
                <Chip
                  size="small"
                  color={statusColor(step.status)}
                  label={stepLabels[step.status]}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatDuration(step.durationMs)}
                </Typography>
              </Stack>
            </Stack>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}
