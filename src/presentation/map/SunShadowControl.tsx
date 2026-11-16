import { useLingui } from '@lingui/react/macro';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  ClickAwayListener,
  FormControlLabel,
  IconButton,
  Paper,
  Popper,
  Slider,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  Tooltip,
  Typography,
} from '@mui/material';
import lookupTimeZone from '@photostructure/tz-lookup';
import { type Ref, useState, useSyncExternalStore } from 'react';

import { ShortcutTooltipTitle } from '@/presentation/KeyboardShortcutKeys';
import {
  instantToZonedWallTime,
  zonedWallTimeToInstant,
  type ZonedWallTime,
} from '@/domain/time/zonedWallTime';
import type { SunShadowPlayback } from '@/presentation/map/mapLayerStore';
import type { MapViewportSnapshotStore } from '@/presentation/map/MapViewportSnapshotStore';
import {
  type DaylightWindow,
  daylightWindow,
  localDayBounds,
  sunlitNow,
} from '@/presentation/map/sunShadowDaylight';
import type {
  TerrainShadowAvailability,
  TerrainShadowTuning,
} from '@/presentation/map/TerrainShadowTileProvider';

export interface SunShadowChange {
  readonly enabled: boolean;
  readonly instantMs: number;
}

export interface SunShadowControlProps {
  readonly enabled: boolean;
  /** Shadow instant in epoch milliseconds. */
  readonly instantMs: number;
  readonly availability: TerrainShadowAvailability;
  readonly playback: SunShadowPlayback;
  /** Its center picks the time zone and the place of sunrise, sunset, and night. */
  readonly mapViewport: MapViewportSnapshotStore;
  readonly onChange: (value: SunShadowChange) => void;
  /** Precomputes and animates the shown day; the layer controller owns the playback. */
  readonly onPlay: () => void;
  /** Cancels the precomputation or stops the animation. */
  readonly onStop: () => void;
  /** Temporary experiment switch for terrain sky-view occlusion of sky light. */
  readonly skyOcclusion: boolean;
  readonly onSkyOcclusionChange: (enabled: boolean) => void;
  /** Temporary shading parameters, edited in numeric fields below the switch. */
  readonly tuning: TerrainShadowTuning;
  readonly onTuningChange: (tuning: TerrainShadowTuning) => void;
  /**
   * True while the time keys briefly show the panel: it opens without taking focus, so
   * the held key keeps reaching the global shortcuts.
   */
  readonly peek: boolean;
}

const minutesPerDay = 24 * 60;
// Two decimals (~1 km) keep the zone and day events stable while the map pans.
const centerPrecision = 100;

function formatWallMinutes(minutes: number): string {
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
  const minute = String(minutes % 60).padStart(2, '0');
  return `${hour}:${minute}`;
}

function formatWallDate(wall: ZonedWallTime): string {
  const month = String(wall.month).padStart(2, '0');
  const day = String(wall.day).padStart(2, '0');
  return `${String(wall.year).padStart(4, '0')}-${month}-${day}`;
}

/** Reads `YYYY-MM-DD` from a date input; null while the field is incomplete. */
function parseWallDate(
  value: string,
): Pick<ZonedWallTime, 'year' | 'month' | 'day'> | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

interface PlaceDay {
  readonly offsetLabel: string;
  readonly daylight: DaylightWindow | null;
  readonly sunrise: string | null;
  readonly sunset: string | null;
}

/* eslint-disable lingui/no-unlocalized-strings -- Intl option tokens. */
const offsetFormatOptions: Intl.DateTimeFormatOptions = { timeZoneName: 'shortOffset' };
const wallClockFormatOptions: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};
/* eslint-enable lingui/no-unlocalized-strings */

/** UTC offset, daylight window, and sunrise and sunset times of the local day of `instantMs`. */
function describePlaceDay(
  locale: string,
  timeZone: string,
  instantMs: number,
  place: { readonly latitude: number; readonly longitude: number } | null,
): PlaceDay {
  const { startMs } = localDayBounds(
    instantToZonedWallTime(new Date(instantMs), timeZone),
    timeZone,
  );
  const offsetLabel =
    new Intl.DateTimeFormat(locale, { ...offsetFormatOptions, timeZone })
      .formatToParts(startMs)
      .find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
  const daylight = place === null ? null : daylightWindow(instantMs, place, timeZone);
  if (daylight === null) return { offsetLabel, daylight, sunrise: null, sunset: null };
  const time = new Intl.DateTimeFormat(locale, { ...wallClockFormatOptions, timeZone });
  return {
    offsetLabel,
    daylight,
    sunrise: time.format(daylight.sunriseMs),
    sunset: time.format(daylight.sunsetMs),
  };
}

interface SunShadowButtonProps {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly panelId: string;
  /** Receives the button so a peeking panel can anchor to it while closed. */
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly onToggle: (button: HTMLElement) => void;
}

/** Rail button; `selected` shows that shadows are on, not that the panel is open. */
export function SunShadowButton({
  enabled,
  open,
  panelId,
  buttonRef,
  onToggle,
}: SunShadowButtonProps) {
  const { t } = useLingui();
  return (
    <Tooltip
      describeChild
      disableInteractive
      placement="left"
      title={
        <ShortcutTooltipTitle
          label={t`Sun shadows`}
          shortcut={{ action: 'toggle-sun-shadows' }}
        />
      }
    >
      <Box component="span" sx={{ display: 'block' }}>
        <ToggleButton
          aria-controls={open ? panelId : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={t`Sun shadows`}
          ref={buttonRef}
          onClick={(event) => {
            onToggle(event.currentTarget);
          }}
          selected={enabled}
          sx={{ borderRadius: 0, mt: '-1px', width: 40, height: 36, p: 0 }}
          value="sun-shadow"
        >
          <WbSunnyOutlinedIcon fontSize="small" />
        </ToggleButton>
      </Box>
    </Tooltip>
  );
}

interface SunShadowPopoverProps extends SunShadowControlProps {
  /** The rail button while the panel is open, otherwise null. */
  readonly anchorEl: HTMLElement | null;
  readonly panelId: string;
  readonly onClose: () => void;
}

/**
 * Non-modal like the layer chooser: map gestures keep working while it is open, and a
 * press elsewhere closes it without being swallowed. Opening it never enables shadows.
 */
export function SunShadowPopover({
  anchorEl,
  panelId,
  onClose,
  ...props
}: SunShadowPopoverProps) {
  const { t } = useLingui();
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
          aria-label={t`Sun shadows`}
          elevation={8}
          id={panelId}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            // Escape closes only this panel, not an active map operation.
            event.preventDefault();
            event.stopPropagation();
            onClose();
            anchorEl?.focus();
          }}
          role="dialog"
          sx={{ px: 2, py: 1.5, width: 280 }}
        >
          <SunShadowPanel {...props} />
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
}

function SunShadowPanel({
  enabled,
  instantMs,
  availability,
  playback,
  mapViewport,
  onChange,
  onPlay,
  onStop,
  skyOcclusion,
  onSkyOcclusionChange,
  tuning,
  onTuningChange,
  peek,
}: SunShadowControlProps) {
  const { i18n, t } = useLingui();
  const viewport = useSyncExternalStore(
    (listener) => mapViewport.subscribe(listener),
    () => mapViewport.getViewportSnapshot(),
  );
  const latitude =
    viewport === null
      ? null
      : Math.round(viewport.center.latitude * centerPrecision) / centerPrecision;
  const longitude =
    viewport === null
      ? null
      : Math.round(viewport.center.longitude * centerPrecision) / centerPrecision;
  const timeZone =
    latitude === null || longitude === null
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : lookupTimeZone(latitude, longitude);
  const wall = instantToZonedWallTime(new Date(instantMs), timeZone);
  const [draftMinutes, setDraftMinutes] = useState<number | null>(null);
  const unavailable = availability === 'unavailable';
  const { offsetLabel, daylight, sunrise, sunset } = describePlaceDay(
    i18n.locale,
    timeZone,
    instantMs,
    latitude === null || longitude === null ? null : { latitude, longitude },
  );
  const toWallMinutes = (instant: number) => {
    const time = instantToZonedWallTime(new Date(instant), timeZone);
    return time.hour * 60 + time.minute;
  };
  // The slider offers two hours around daylight in whole minutes; the layer controller
  // clamps every commit to the same range.
  const minimumMinutes = daylight === null ? 0 : toWallMinutes(daylight.firstMinuteMs);
  const maximumMinutes =
    daylight === null ? minutesPerDay - 1 : toWallMinutes(daylight.lastMinuteMs);
  const wallMinutes = Math.min(
    Math.max(wall.hour * 60 + wall.minute, minimumMinutes),
    maximumMinutes,
  );

  const commitWall = (next: ZonedWallTime) => {
    onChange({ enabled, instantMs: zonedWallTimeToInstant(next, timeZone).getTime() });
  };
  const percent =
    playback.status === 'loading' ? Math.round(playback.progress * 100) : 0;

  return (
    <Stack spacing={1}>
      <FormControlLabel
        control={
          <Switch
            // Focus enters the panel so Escape and Tab work from the keyboard.
            autoFocus={!peek && !unavailable}
            checked={enabled && !unavailable}
            disabled={unavailable}
            onChange={(_event, checked) => {
              onChange({ enabled: checked, instantMs });
            }}
          />
        }
        label={<Typography variant="body2">{t`Sun shadows`}</Typography>}
        sx={{ mx: 0 }}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={skyOcclusion}
            disabled={!enabled || unavailable}
            onChange={(_event, checked) => {
              onSkyOcclusionChange(checked);
            }}
            size="small"
          />
        }
        label={
          <Typography variant="body2">{t`Global illumination (experiment)`}</Typography>
        }
        sx={{ mx: 0 }}
      />
      <Stack direction="row" sx={{ columnGap: 1, flexWrap: 'wrap', rowGap: 1.5 }}>
        {
          /* eslint-disable lingui/no-unlocalized-strings -- Tuning keys, not UI text. */
          (
            [
              ['neutralBrightness', t`Neutral`, 1, 1.95, 0.05],
              ['lowSunGlowOpacity', t`Glow`, 0, 1, 0.05],
              ['skyOcclusionStrength', t`GI strength`, 0, 4, 0.25],
            ] as const
          )
            /* eslint-enable lingui/no-unlocalized-strings */
            .map(([key, label, min, max, step]) => (
              <TextField
                defaultValue={tuning[key]}
                disabled={!enabled || unavailable}
                key={key}
                label={label}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (event.target.value === '' || !(value >= min && value <= max))
                    return;
                  onTuningChange({ ...tuning, [key]: value });
                }}
                size="small"
                slotProps={{ htmlInput: { max, min, step } }}
                sx={{ width: 120 }}
                type="number"
              />
            ))
        }
      </Stack>
      {unavailable ? (
        <Typography color="text.secondary" variant="caption">
          {t`This browser cannot compute shadows: WebGL2 float rendering is unavailable.`}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField
          autoFocus={!peek && unavailable}
          label={t`Date`}
          onChange={(event) => {
            const date = parseWallDate(event.target.value);
            if (date === null) return;
            commitWall({ ...date, hour: wall.hour, minute: wall.minute });
          }}
          size="small"
          sx={{ flex: 1 }}
          type="date"
          value={formatWallDate(wall)}
        />
        <Button
          onClick={() => {
            const nowMs = Date.now();
            onChange({
              enabled,
              instantMs:
                latitude === null || longitude === null
                  ? nowMs
                  : sunlitNow(nowMs, { latitude, longitude }, timeZone),
            });
          }}
          size="small"
          variant="outlined"
        >
          {t`Now`}
        </Button>
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        {playback.status === 'loading' ? (
          <IconButton
            aria-label={t`Cancel`}
            color="primary"
            onClick={onStop}
            size="small"
          >
            <CircularProgress size={20} value={percent} variant="determinate" />
          </IconButton>
        ) : playback.status === 'playing' ? (
          <IconButton
            aria-label={t`Stop`}
            color="primary"
            onClick={onStop}
            size="small"
          >
            <StopRoundedIcon fontSize="small" />
          </IconButton>
        ) : (
          <IconButton
            aria-label={t`Play the day`}
            // Enabled actions use the primary ink like the switch and slider; grey means disabled.
            color="primary"
            disabled={!enabled || unavailable}
            onClick={onPlay}
            size="small"
          >
            <PlayArrowRoundedIcon fontSize="small" />
          </IconButton>
        )}
        <Slider
          aria-label={t`Time of day`}
          getAriaValueText={formatWallMinutes}
          max={maximumMinutes}
          min={minimumMinutes}
          onChange={(_event, value) => {
            setDraftMinutes(value);
          }}
          onChangeCommitted={(_event, value) => {
            setDraftMinutes(null);
            commitWall({ ...wall, hour: Math.floor(value / 60), minute: value % 60 });
          }}
          size="small"
          step={1}
          sx={{ flex: 1 }}
          value={draftMinutes ?? wallMinutes}
          valueLabelDisplay="auto"
          valueLabelFormat={formatWallMinutes}
        />
        <Typography sx={{ minWidth: 40 }} variant="body2">
          {formatWallMinutes(draftMinutes ?? wallMinutes)}
        </Typography>
      </Stack>
      <Stack direction="row" sx={{ columnGap: 1.5, flexWrap: 'wrap' }}>
        <Typography color="text.secondary" variant="caption">
          {offsetLabel}
        </Typography>
        {sunrise === null ? null : (
          <Typography color="text.secondary" variant="caption">
            {t`Sunrise ${sunrise}`}
          </Typography>
        )}
        {sunset === null ? null : (
          <Typography color="text.secondary" variant="caption">
            {t`Sunset ${sunset}`}
          </Typography>
        )}
      </Stack>
      {playback.status === 'loading' ? (
        <Typography color="text.secondary" variant="caption">
          {t`Computing shadows for the day: ${percent}%`}
        </Typography>
      ) : null}
      {playback.status === 'too-many-tiles' ? (
        <Typography color="text.secondary" variant="caption">
          {t`Too much of the map is in view to animate the day. Zoom in and try again.`}
        </Typography>
      ) : null}
      {playback.status === 'failed' ? (
        <Typography color="text.secondary" variant="caption">
          {t`Shadows for the day could not be computed.`}
        </Typography>
      ) : null}
    </Stack>
  );
}
