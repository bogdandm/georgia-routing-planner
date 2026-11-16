import { useLingui } from '@lingui/react/macro';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import {
  Box,
  Button,
  ClickAwayListener,
  Paper,
  Popper,
  Stack,
  ToggleButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';

export interface MapCaptureControlProps {
  /** Copies a PNG of the map, without controls, to the clipboard. */
  readonly onCopyScreenshot: () => Promise<void>;
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

/** Non-modal like the sun panel: map gestures keep working while it is open. */
export function MapCapturePopover({
  anchorEl,
  panelId,
  onClose,
  onCopyScreenshot,
}: MapCapturePopoverProps) {
  const { t } = useLingui();
  /* eslint-disable lingui/no-unlocalized-strings -- State tokens. */
  const [screenshot, setScreenshot] = useState<ScreenshotStatus>('idle');
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
          </Stack>
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
}
