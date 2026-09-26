import { Trans } from '@lingui/react/macro';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { DiagnosticsService } from '@/diagnostics/export/DiagnosticsService';

/* eslint-disable -- Diagnostic reason is support data, not presentation copy. */
const diagnosticDownloadReason =
  'React error boundary displayed after a component failure.';
/* eslint-enable */

interface WorkspaceErrorBoundaryProps {
  readonly children: ReactNode;
  readonly diagnostics: DiagnosticsService;
  readonly logger: DiagnosticLogger;
}

interface WorkspaceErrorBoundaryState {
  readonly failed: boolean;
}

export class WorkspaceErrorBoundary extends Component<
  WorkspaceErrorBoundaryProps,
  WorkspaceErrorBoundaryState
> {
  public override state: WorkspaceErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): WorkspaceErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    this.props.logger.log({
      level: 'error',
      name: 'react.error-boundary.caught',
      message: error.message,
      data: { component: 'application-root' },
    });
  }

  public override render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <Box
        component="main"
        sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 3 }}
      >
        <Paper sx={{ maxWidth: 560, p: 4 }}>
          <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
            {/* MUI display tokens are not user-visible copy. */}
            {/* eslint-disable-next-line -- MUI display token, not user-visible copy. */}
            <ErrorOutlineIcon color="error" fontSize="large" />
            <Typography component="h1" variant="h5">
              <Trans>The application encountered an error</Trans>
            </Typography>
            {/* eslint-disable-next-line -- MUI severity token, not user-visible copy. */}
            <Alert severity="error">
              <Trans>
                The failure was captured locally. Download a privacy-safe bundle to help
                investigate it.
              </Trans>
            </Alert>
            <Button
              variant="contained"
              onClick={() => {
                this.props.diagnostics.downloadBundle(diagnosticDownloadReason);
              }}
            >
              <Trans>Download diagnostics</Trans>
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }
}
