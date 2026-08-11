import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type TrackShareService,
  TrackShareError,
} from '@/application/tracks/TrackShareService';
import { createTrackShareUrl } from '@/presentation/tracks/trackShareUrl';

interface TrackShareDialogProps {
  readonly contentHash: string;
  readonly open: boolean;
  readonly service: TrackShareService;
  readonly onClose: () => void;
}

type DialogState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'disabled'; readonly notice?: string }
  | { readonly kind: 'enabled'; readonly url: string; readonly copyFailed: boolean }
  | { readonly kind: 'error'; readonly message: string };

function messageFor(error: unknown): string {
  if (
    error instanceof TrackShareError &&
    (error.category === 'track-not-found' || error.category === 'track-not-ready')
  ) {
    return 'Sync this track before sharing.';
  }
  return 'Sharing could not be updated. Try again.';
}

export function TrackShareDialog({
  contentHash,
  open,
  service,
  onClose,
}: TrackShareDialogProps) {
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState<DialogState>({ kind: 'loading' });

  const loadStatus = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: 'loading' });
    try {
      const status = await service.status(contentHash, controller.signal);
      if (controller.signal.aborted) return;
      setState(
        status.enabled
          ? {
              kind: 'enabled',
              url: createTrackShareUrl(window.location.href, status.token),
              copyFailed: false,
            }
          : { kind: 'disabled' },
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof TrackShareError &&
        (error.category === 'track-not-found' || error.category === 'track-not-ready')
      ) {
        setState({ kind: 'disabled', notice: 'Sync this track before sharing.' });
      } else {
        setState({ kind: 'error', message: messageFor(error) });
      }
    }
  }, [contentHash, service]);

  useEffect(() => {
    if (!open) return undefined;
    const timeout = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      request.current?.abort();
    };
  }, [loadStatus, open]);

  const copy = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setState({ kind: 'enabled', url, copyFailed: false });
    } catch {
      setState({ kind: 'enabled', url, copyFailed: true });
    }
  };

  const enable = async (): Promise<void> => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: 'loading' });
    try {
      const status = await service.enable(contentHash, controller.signal);
      if (controller.signal.aborted) return;
      const url = createTrackShareUrl(window.location.href, status.token);
      setState({ kind: 'enabled', url, copyFailed: false });
      await copy(url);
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({ kind: 'error', message: messageFor(error) });
      }
    }
  };

  const disable = async (): Promise<void> => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: 'loading' });
    try {
      await service.disable(contentHash, controller.signal);
      if (!controller.signal.aborted) setState({ kind: 'disabled' });
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({ kind: 'error', message: messageFor(error) });
      }
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Share track</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {state.kind === 'loading' ? 'Loading sharing status…' : null}
          {state.kind === 'disabled' && state.notice !== undefined ? (
            <Alert severity="warning">{state.notice}</Alert>
          ) : null}
          {state.kind === 'error' ? (
            <Alert severity="error">{state.message}</Alert>
          ) : null}
          {state.kind === 'enabled' ? (
            <>
              <TextField
                label="Share link"
                value={state.url}
                slotProps={{ input: { readOnly: true } }}
              />
              {state.copyFailed ? (
                <Alert severity="warning">
                  Sharing is enabled, but the link could not be copied.
                </Alert>
              ) : null}
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {state.kind === 'disabled' ? (
          <Button variant="contained" onClick={() => void enable()}>
            Share
          </Button>
        ) : null}
        {state.kind === 'enabled' ? (
          <Button onClick={() => void copy(state.url)}>Copy link</Button>
        ) : null}
        {state.kind === 'enabled' ? (
          <Button color="error" onClick={() => void disable()}>
            Disable share
          </Button>
        ) : null}
        {state.kind === 'error' ? (
          <Button onClick={() => void loadStatus()}>Retry</Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
