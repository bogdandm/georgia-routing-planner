import { useLingui } from '@lingui/react/macro';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import GifBoxOutlinedIcon from '@mui/icons-material/GifBoxOutlined';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import {
  Box,
  Button,
  ClickAwayListener,
  LinearProgress,
  Paper,
  Popper,
  Stack,
  ToggleButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';

export interface MapCaptureControlProps {
  /** Copies a PNG of the map, without controls, to the clipboard. */
  readonly onCopyScreenshot: () => Promise<void>;
  /**
   * Records the day cycle of sun shadows as a GIF and downloads it; null while shadows
   * are off. Rejects with an `AbortError` when `signal` or a map change stops it.
   */
  readonly onRecordDayGif:
    | ((signal: AbortSignal, onProgress: (fraction: number) => void) => Promise<void>)
    | null;
}

interface MapCaptureButtonProps {
  readonly open: boolean;
  readonly panelId: string;
  readonly onToggle: (button: HTMLElement) => void;
}

export function MapCaptureButton({ open, panelId, onToggle }: MapCaptureButtonProps) {
  const { t } = useLingui();
  return (
    <Tooltip
      describeChild
      disableInteractive
      placement="left"
      title={t`Capture the map`}
    >
      <Box component="span" sx={{ display: 'block' }}>
        <ToggleButton
          aria-controls={open ? panelId : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={t`Capture the map`}
          onClick={(event) => {
            onToggle(event.currentTarget);
          }}
          selected={false}
          sx={{ borderRadius: 0, mt: '-1px', width: 40, height: 36, p: 0 }}
          value="map-capture"
        >
          <PhotoCameraOutlinedIcon fontSize="small" />
        </ToggleButton>
      </Box>
    </Tooltip>
  );
}

interface MapCapturePopoverProps extends MapCaptureControlProps {
  /** The rail button while the panel is open, otherwise null. */
  readonly anchorEl: HTMLElement | null;
  readonly panelId: string;
  readonly onClose: () => void;
}

type ScreenshotStatus = 'idle' | 'copying' | 'copied' | 'failed';
type GifStatus =
  | { readonly kind: 'idle' | 'saved' | 'stopped' | 'failed' }
  | { readonly kind: 'recording'; readonly progress: number };

/** Non-modal like the sun panel: map gestures keep working while it is open. */
export function MapCapturePopover({
  anchorEl,
  panelId,
  onClose,
  onCopyScreenshot,
  onRecordDayGif,
}: MapCapturePopoverProps) {
  const { t } = useLingui();
  const gifAbort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      gifAbort.current?.abort();
    },
    [],
  );
  /* eslint-disable lingui/no-unlocalized-strings -- State tokens. */
  const [screenshot, setScreenshot] = useState<ScreenshotStatus>('idle');
  const [gif, setGif] = useState<GifStatus>({ kind: 'idle' });
  const copyScreenshot = () => {
    setScreenshot('copying');
    onCopyScreenshot().then(
      () => {
        setScreenshot('copied');
      },
      () => {
        setScreenshot('failed');
      },
    );
  };
  const recordGif = (record: NonNullable<typeof onRecordDayGif>) => {
    const controller = new AbortController();
    gifAbort.current = controller;
    setGif({ kind: 'recording', progress: 0 });
    record(controller.signal, (progress) => {
      setGif({ kind: 'recording', progress });
    }).then(
      () => {
        setGif({ kind: 'saved' });
      },
      (error: unknown) => {
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        // Cancel is the user's own choice; any other stop is reported.
        if (controller.signal.aborted) setGif({ kind: 'idle' });
        else setGif({ kind: aborted ? 'stopped' : 'failed' });
      },
    );
  };
  const recording = gif.kind === 'recording';
  const percent = recording ? Math.floor(gif.progress * 100) : 0;
  /* eslint-enable lingui/no-unlocalized-strings */
  return (
    <Popper
      anchorEl={anchorEl}
      disablePortal
      modifiers={[
        { name: 'offset', options: { offset: [0, 8] } },
        { name: 'preventOverflow', options: { padding: 8 } },
      ]}
      open={anchorEl !== null}
      placement="left-start"
      // Closing the panel keeps a recording and its result.
      keepMounted
    >
      <ClickAwayListener
        // eslint-disable-next-line lingui/no-unlocalized-strings -- React event prop name.
        mouseEvent="onPointerDown"
        touchEvent={false}
        onClickAway={(event) => {
          // The rail button toggles the panel itself.
          if (event.target instanceof Node && anchorEl?.contains(event.target)) return;
          onClose();
        }}
      >
        <Paper
          aria-label={t`Capture the map`}
          elevation={8}
          id={panelId}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
            anchorEl?.focus();
          }}
          role="dialog"
          sx={{ px: 2, py: 1.5, width: 240 }}
        >
          <Stack spacing={1}>
            <Button
              disabled={screenshot === 'copying'}
              onClick={copyScreenshot}
              size="small"
              startIcon={<ContentCopyRoundedIcon fontSize="small" />}
              variant="outlined"
            >
              {t`Take a screenshot`}
            </Button>
            {screenshot === 'copied' ? (
              <Typography color="text.secondary" role="status" variant="caption">
                {t`Map image copied to the clipboard`}
              </Typography>
            ) : null}
            {screenshot === 'failed' ? (
              <Typography color="error" role="alert" variant="caption">
                {t`The map image could not be copied.`}
              </Typography>
            ) : null}
            <Button
              disabled={onRecordDayGif === null || recording}
              onClick={() => {
                if (onRecordDayGif !== null) recordGif(onRecordDayGif);
              }}
              size="small"
              startIcon={<GifBoxOutlinedIcon fontSize="small" />}
              variant="outlined"
            >
              {t`Record a GIF of the day`}
            </Button>
            {onRecordDayGif === null && !recording ? (
              <Typography color="text.secondary" variant="caption">
                {t`Turn on sun shadows to record the day.`}
              </Typography>
            ) : null}
            {recording ? (
              <Stack spacing={0.5}>
                <LinearProgress
                  aria-label={t`Recording the day`}
                  value={gif.progress * 100}
                  variant="determinate"
                />
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Typography color="text.secondary" role="status" variant="caption">
                    {t`Recording the day: ${percent}%`}
                  </Typography>
                  <Button
                    onClick={() => {
                      gifAbort.current?.abort();
                    }}
                    size="small"
                  >
                    {t`Cancel`}
                  </Button>
                </Stack>
              </Stack>
            ) : null}
            {gif.kind === 'saved' ? (
              <Typography color="text.secondary" role="status" variant="caption">
                {t`The GIF was downloaded.`}
              </Typography>
            ) : null}
            {gif.kind === 'stopped' ? (
              <Typography color="text.secondary" role="status" variant="caption">
                {t`The recording stopped because the map or the time changed.`}
              </Typography>
            ) : null}
            {gif.kind === 'failed' ? (
              <Typography color="error" role="alert" variant="caption">
                {t`The GIF could not be recorded.`}
              </Typography>
            ) : null}
          </Stack>
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
}
