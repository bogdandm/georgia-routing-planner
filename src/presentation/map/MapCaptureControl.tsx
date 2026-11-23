import { useLingui } from '@lingui/react/macro';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import WbTwilightIcon from '@mui/icons-material/WbTwilight';
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
import { keyframes } from '@mui/material/styles';
import { useEffect, useRef, useState } from 'react';

/** The camcorder recording light: on for half a second, off for half a second. */
const recordingBlink = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0; }
`;
/** The remaining time is shown once this much of the recording lies behind it. */
const minimumEstimateMs = 3_000;

export interface MapCaptureControlProps {
  /** Copies a PNG of the map, without controls, to the clipboard. */
  readonly onCopyScreenshot: () => Promise<void>;
  /**
   * Records the day cycle of sun shadows as an MP4 video and downloads it; null while
   * shadows are off. Rejects with an `AbortError` when `signal` or a map change stops it.
   */
  readonly onRecordDayVideo: RecordVideo | null;
  /**
   * Records a time-lapse of the open track's hike with its sun shadows and downloads it;
   * null while shadows are off or no single timed track is open. With
   * `lightingChanges` off, the shadows stay at the shown minute throughout, which
   * records much faster.
   */
  readonly onRecordTrackVideo:
    | ((
        signal: AbortSignal,
        onProgress: (fraction: number) => void,
        lightingChanges: boolean,
      ) => Promise<void>)
    | null;
}

type RecordVideo = (
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
) => Promise<void>;

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
type VideoStatus =
  | { readonly kind: 'idle' | 'saved' | 'stopped' | 'failed' }
  | {
      readonly kind: 'recording';
      readonly progress: number;
      /** Time left at the pace so far; null until there is enough to judge it. */
      readonly remainingMs: number | null;
    };

/** Non-modal like the sun panel: map gestures keep working while it is open. */
export function MapCapturePopover({
  anchorEl,
  panelId,
  onClose,
  onCopyScreenshot,
  onRecordDayVideo,
  onRecordTrackVideo,
}: MapCapturePopoverProps) {
  const { i18n, t } = useLingui();
  const videoAbort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      videoAbort.current?.abort();
    },
    [],
  );
  /* eslint-disable lingui/no-unlocalized-strings -- State tokens. */
  const [screenshot, setScreenshot] = useState<ScreenshotStatus>('idle');
  const [video, setVideo] = useState<VideoStatus>({ kind: 'idle' });
  const [lightingChanges, setLightingChanges] = useState(true);
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
  const recordVideo = (record: RecordVideo) => {
    const controller = new AbortController();
    videoAbort.current = controller;
    const startedAtMs = performance.now();
    setVideo({ kind: 'recording', progress: 0, remainingMs: null });
    record(controller.signal, (progress) => {
      const elapsedMs = performance.now() - startedAtMs;
      setVideo({
        kind: 'recording',
        progress,
        remainingMs:
          progress > 0 && elapsedMs >= minimumEstimateMs
            ? (elapsedMs * (1 - progress)) / progress
            : null,
      });
    }).then(
      () => {
        setVideo({ kind: 'saved' });
      },
      (error: unknown) => {
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        // Cancel is the user's own choice; any other stop is reported.
        if (controller.signal.aborted) setVideo({ kind: 'idle' });
        else setVideo({ kind: aborted ? 'stopped' : 'failed' });
      },
    );
  };
  const recording = video.kind === 'recording';
  // Whole percents, spaced as the locale writes them ("1 %" in Russian).
  const percent = new Intl.NumberFormat(i18n.locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(recording ? Math.floor(video.progress * 100) / 100 : 0);
  const remainingMs = recording ? video.remainingMs : null;
  const remaining =
    remainingMs === null
      ? null
      : remainingMs < 60_000
        ? new Intl.NumberFormat(i18n.locale, {
            style: 'unit',
            unit: 'second',
            unitDisplay: 'short',
          }).format(Math.max(5, Math.ceil(remainingMs / 5_000) * 5))
        : new Intl.NumberFormat(i18n.locale, {
            style: 'unit',
            unit: 'minute',
            unitDisplay: 'short',
          }).format(Math.round(remainingMs / 60_000));
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
              disabled={onRecordDayVideo === null || recording}
              onClick={() => {
                if (onRecordDayVideo !== null) recordVideo(onRecordDayVideo);
              }}
              size="small"
              startIcon={<VideocamOutlinedIcon fontSize="small" />}
              variant="outlined"
            >
              {t`Record a video of the day`}
            </Button>
            <Stack direction="row" spacing={1}>
              <Button
                disabled={onRecordTrackVideo === null || recording}
                onClick={() => {
                  if (onRecordTrackVideo === null) return;
                  recordVideo((signal, onProgress) =>
                    onRecordTrackVideo(signal, onProgress, lightingChanges),
                  );
                }}
                size="small"
                startIcon={<RouteOutlinedIcon fontSize="small" />}
                sx={{ flexGrow: 1 }}
                variant="outlined"
              >
                {t`Record a track video`}
              </Button>
              <Tooltip describeChild disableInteractive title={t`Change the lighting`}>
                {/* A disabled button fires no events, so the tooltip needs a wrapper. */}
                <Box component="span" sx={{ display: 'flex' }}>
                  <ToggleButton
                    aria-label={t`Change the lighting`}
                    disabled={onRecordTrackVideo === null || recording}
                    onChange={() => {
                      setLightingChanges((changes) => !changes);
                    }}
                    selected={lightingChanges}
                    size="small"
                    sx={{ px: 0.75, py: 0 }}
                    value="track-video-lighting"
                  >
                    <WbTwilightIcon fontSize="small" />
                  </ToggleButton>
                </Box>
              </Tooltip>
            </Stack>
            {onRecordDayVideo === null && !recording ? (
              <Typography color="text.secondary" variant="caption">
                {t`Turn on sun shadows to record a video.`}
              </Typography>
            ) : null}
            {onRecordDayVideo !== null && onRecordTrackVideo === null && !recording ? (
              <Typography color="text.secondary" variant="caption">
                {t`Open a track to record its video.`}
              </Typography>
            ) : null}
            {recording ? (
              <Stack spacing={0.5}>
                <LinearProgress
                  aria-label={t`Recording progress`}
                  value={video.progress * 100}
                  variant="determinate"
                />
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <FiberManualRecordIcon
                      aria-hidden
                      sx={{
                        color: 'error.main',
                        fontSize: 14,
                        animation: `${recordingBlink} 1s step-end infinite`,
                        '@media (prefers-reduced-motion: reduce)': {
                          animation: 'none',
                        },
                      }}
                    />
                    <Typography
                      role="status"
                      sx={{ fontWeight: 600 }}
                      variant="caption"
                    >
                      {t`Recording…`}
                    </Typography>
                  </Stack>
                  <Button
                    onClick={() => {
                      videoAbort.current?.abort();
                    }}
                    size="small"
                  >
                    {t`Cancel`}
                  </Button>
                </Stack>
              </Stack>
            ) : null}
            {remaining !== null ? (
              <Typography color="text.secondary" variant="caption">
                {t`${percent} · ${remaining} left`}
              </Typography>
            ) : null}
            {video.kind === 'saved' ? (
              <Typography color="text.secondary" role="status" variant="caption">
                {t`The video was downloaded.`}
              </Typography>
            ) : null}
            {video.kind === 'stopped' ? (
              <Typography color="text.secondary" role="status" variant="caption">
                {t`The recording stopped because the map or the time changed.`}
              </Typography>
            ) : null}
            {video.kind === 'failed' ? (
              <Typography color="error" role="alert" variant="caption">
                {t`The video could not be recorded.`}
              </Typography>
            ) : null}
          </Stack>
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
}
