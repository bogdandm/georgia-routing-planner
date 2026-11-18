import WbTwilightIcon from '@mui/icons-material/WbTwilight';
import { useLingui } from '@lingui/react/macro';
import { Box, Skeleton, Stack, Typography } from '@mui/material';
import { useId, useMemo, useState, type ReactElement } from 'react';
import { useStore } from 'zustand';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { solarPosition } from '@/domain/terrain/solarPosition';
import {
  instantToZonedWallTime,
  zonedWallTimeToInstant,
} from '@/domain/time/zonedWallTime';
import {
  trackLightDurations,
  trackLightKinds,
  trackLightShares,
  type TrackLightKind,
  type TrackLightingSample,
} from '@/domain/tracks/trackLighting';
import { mapLayerStore } from '@/presentation/map/mapLayerStore';
import { daylightWindow, localDayBounds } from '@/presentation/map/sunShadowDaylight';
import { appColors } from '@/presentation/theme/appColors';
import {
  formatTrackDistance,
  formatTrackDuration,
} from '@/presentation/tracks/trackFormatters';
import { trackLightColor } from '@/presentation/tracks/trackLightColor';
import type { TrackLightingView } from '@/presentation/tracks/useTrackLighting';

const millisecondsPerHour = 3_600_000;
/** Labels under the strip: at most this many, at least this far apart. */
const maximumTickLabels = 7;
const minimumTickGapFraction = 0.09;
/** The strip's 12 px bar plus its 16 px label row, kept by every loading state. */
const stripHeight = 28;
const hourTickSteps = [1, 2, 3, 4, 6, 12, 24] as const;

/** Legend color of each light kind; the strip shades them by the map's light model. */
const trackLightColors: Readonly<Record<TrackLightKind, string>> = {
  sun: appColors.trackLight.sun,
  shade: appColors.trackLight.shade,
  twilight: appColors.trackLight.twilight,
  dark: appColors.trackLight.dark,
};

/** `WbTwilight`'s 24-unit path: a half sun with rays over the horizon. */
const halfSunPath =
  // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG path data.
  'm16.9541 8.6624 2.1206-2.122 1.4147 1.4137-2.1206 2.122zM2 18h20v2H2zm9-14h2v3h-2zM3.5427 7.9249l1.4142-1.4142L7.0782 8.632 5.664 10.0462zM5 16h14c0-3.87-3.13-7-7-7s-7 3.13-7 7';

/** Sunrise in amber and sunset in orange, like the low Sun on the map. */
const sunEventColors = {
  sunrise: appColors.brand.amber,
  sunset: appColors.brand.tigerOrange,
} as const;

/**
 * Sunrise or sunset mark at the top of a profile chart line: the half-sun icon with its
 * time beside it, right of a sunrise and left of a sunset so it stays inside the plot.
 */
export function SunEventChartMark({
  x,
  y,
  kind,
  time,
  label,
}: {
  readonly x: number;
  readonly y: number;
  readonly kind: 'sunrise' | 'sunset';
  readonly time: string;
  readonly label: string;
}): ReactElement {
  const color = sunEventColors[kind];
  return (
    <g className="elevation-profile-sun-event-mark">
      <title>{label}</title>
      {/* A nested icon <svg> ignores its CSS size inside the chart, so draw its path. */}
      <path
        d={halfSunPath}
        fill={color}
        transform={`translate(${String(x - 10)} ${String(y + 1)}) scale(${String(20 / 24)})`}
      />
      <text
        x={kind === 'sunrise' ? x + 12 : x - 12}
        y={y + 16}
        fill={color}
        fontSize={11}
        fontWeight={700}
        textAnchor={kind === 'sunrise' ? 'start' : 'end'}
      >
        {time}
      </text>
    </g>
  );
}

function useClockFormat(timeZone: string): Intl.DateTimeFormat {
  const { i18n } = useLingui();
  return useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale, {
        /* eslint-disable lingui/no-unlocalized-strings -- Intl option tokens. */
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        /* eslint-enable lingui/no-unlocalized-strings */
        timeZone,
      }),
    [i18n.locale, timeZone],
  );
}

/** Localized names of the light kinds. */
function useLightKindLabels(): Readonly<Record<TrackLightKind, string>> {
  const { t } = useLingui();
  return {
    sun: t`In the sun`,
    shade: t`In the shade`,
    twilight: t`Blue hour`,
    dark: t`After dark`,
  };
}

/** Lighting between the two samples around `elapsedSeconds` on the hike's timeline. */
function sampleAt(
  samples: readonly TrackLightingSample[],
  elapsedSeconds: number,
): TrackLightingSample | null {
  const index = samples.findIndex((sample) => sample.elapsedSeconds >= elapsedSeconds);
  const after = samples[index] ?? samples.at(-1);
  const before = samples[index - 1] ?? after;
  if (after === undefined || before === undefined) return null;
  const span = after.elapsedSeconds - before.elapsedSeconds;
  const fraction = span <= 0 ? 1 : (elapsedSeconds - before.elapsedSeconds) / span;
  const mix = (from: number, to: number) => from + (to - from) * fraction;
  return {
    distanceMeters: mix(before.distanceMeters, after.distanceMeters),
    elapsedSeconds: mix(before.elapsedSeconds, after.elapsedSeconds),
    sunlitFraction: mix(before.sunlitFraction, after.sunlitFraction),
    sunElevationDegrees: mix(before.sunElevationDegrees, after.sunElevationDegrees),
    skyView: mix(before.skyView, after.skyView),
    groundElevationMeters: mix(
      before.groundElevationMeters,
      after.groundElevationMeters,
    ),
  };
}

/** Pointer position across an element's width in [0, 1]; null for an unlaid-out element. */
function pointerFraction(event: {
  readonly clientX: number;
  readonly currentTarget: Element;
}): number | null {
  const bounds = event.currentTarget.getBoundingClientRect();
  if (bounds.width <= 0) return null;
  return Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
}

interface TrackLightingStripProps {
  readonly lighting: TrackLightingView;
  /** The route point under the pointer, to trace on the map; null when it leaves. */
  readonly onHoverSample: (
    sample: Pick<TrackLightingSample, 'distanceMeters' | 'elapsedSeconds'> | null,
  ) => void;
  /** The route distance clicked, to go to on the map. */
  readonly onSelectDistance: (distanceMeters: number) => void;
}

/**
 * Light along the route across the full width, over the hike's clock with hour labels,
 * sunrise and sunset marks, and a hover readout. Hovering traces the route point on the
 * map and a click goes to it.
 */
function TrackLightingStrip({
  lighting,
  onHoverSample,
  onSelectDistance,
}: TrackLightingStripProps): ReactElement | null {
  const { i18n, t } = useLingui();
  const labels = useLightKindLabels();
  const clock = useClockFormat(lighting.timeZone);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG element ID.
  const gradientId = `track-light-${useId().replaceAll(':', '')}`;
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const { terrain } = lighting;
  if (terrain.status === 'off') return null;
  // Loading and failure keep the strip's final size (12 px bar, 16 px labels): no shift.
  if (terrain.status === 'loading') {
    return (
      <Box sx={{ height: stripHeight }}>
        <Skeleton
          variant="rounded"
          height={12}
          aria-label={t`Calculating the light along the route`}
        />
      </Box>
    );
  }
  if (terrain.status === 'failed') {
    return (
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          display: 'block',
          height: stripHeight,
          lineHeight: `${String(stripHeight)}px`,
        }}
      >
        {t`The light along the route could not be calculated.`}
      </Typography>
    );
  }
  const { samples } = terrain;
  const firstSeconds = samples[0]?.elapsedSeconds ?? 0;
  const span = (samples.at(-1)?.elapsedSeconds ?? firstSeconds) - firstSeconds;
  const fractionOf = (elapsedSeconds: number) =>
    span <= 0 ? 0 : (elapsedSeconds - firstSeconds) / span;
  const ticks: {
    readonly key: number;
    readonly fraction: number;
    readonly label: string;
  }[] = [];
  const addTick = (key: number, fraction: number, label: string) => {
    const previous = ticks.at(-1);
    if (
      fraction > 1 ||
      (previous !== undefined && fraction - previous.fraction < minimumTickGapFraction)
    ) {
      return;
    }
    ticks.push({ key, fraction, label });
  };
  // Whole local hours on a step grid that keeps the labels few.
  const spanMs = lighting.finishMs - lighting.startMs;
  const step =
    hourTickSteps.find(
      (hours) => spanMs / (hours * millisecondsPerHour) <= maximumTickLabels,
    ) ?? 24;
  const startWall = instantToZonedWallTime(
    new Date(lighting.startMs),
    lighting.timeZone,
  );
  let hourMs =
    lighting.startMs - startWall.minute * 60_000 - (lighting.startMs % 60_000);
  if (hourMs < lighting.startMs) hourMs += millisecondsPerHour;
  for (; hourMs <= lighting.finishMs; hourMs += millisecondsPerHour) {
    if (instantToZonedWallTime(new Date(hourMs), lighting.timeZone).hour % step !== 0) {
      continue;
    }
    addTick(
      hourMs,
      fractionOf((hourMs - lighting.startMs) / 1_000),
      clock.format(new Date(hourMs)),
    );
  }

  const durations = trackLightDurations(samples);
  const description = trackLightKinds
    .filter((kind) => durations[kind] >= 60)
    .map((kind) => `${labels[kind]} ${formatTrackDuration(durations[kind], i18n)}`)
    .join(', ');
  const hovered =
    hoverFraction === null
      ? null
      : sampleAt(samples, firstSeconds + hoverFraction * span);
  let hoverLabel: string | null = null;
  if (hovered !== null) {
    const shares = trackLightShares(hovered);
    const kind = trackLightKinds.reduce((best, candidate) =>
      shares[candidate] > shares[best] ? candidate : best,
    );
    hoverLabel = [
      clock.format(new Date(lighting.startMs + hovered.elapsedSeconds * 1_000)),
      formatTrackDistance(hovered.distanceMeters, i18n),
      labels[kind],
    ].join(' · ');
  }
  // Shifting by the same share as the position keeps a label inside the strip's width.
  const anchoredAt = (fraction: number) => ({
    left: `${String(fraction * 100)}%`,
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS value.
    transform: `translateX(${String(-fraction * 100)}%)`,
  });
  const sunMarks = lighting.sunEvents.map((event) => {
    const time = clock.format(new Date(event.instantMs));
    return {
      key: event.instantMs,
      kind: event.kind,
      fraction: fractionOf((event.instantMs - lighting.startMs) / 1_000),
      label: event.kind === 'sunrise' ? t`Sunrise ${time}` : t`Sunset ${time}`,
    };
  });

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        sx={{ position: 'relative', cursor: 'crosshair', touchAction: 'pan-y' }}
        onPointerMove={(event) => {
          const fraction = pointerFraction(event);
          if (fraction === null) return;
          setHoverFraction(fraction);
          const sample = sampleAt(samples, firstSeconds + fraction * span);
          if (sample !== null) onHoverSample(sample);
        }}
        onClick={(event) => {
          const fraction = pointerFraction(event);
          if (fraction === null) return;
          const sample = sampleAt(samples, firstSeconds + fraction * span);
          if (sample !== null) onSelectDistance(sample.distanceMeters);
        }}
        onPointerLeave={() => {
          setHoverFraction(null);
          onHoverSample(null);
        }}
      >
        <Box
          role="img"
          aria-label={t`Light along the route: ${description}`}
          component="svg"
          sx={{ display: 'block', width: '100%', height: 12, borderRadius: 1 }}
          // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG attribute value.
          preserveAspectRatio="none"
          viewBox="0 0 100 10"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              {samples.map((sample) => (
                <stop
                  key={`${String(sample.distanceMeters)}:${String(sample.elapsedSeconds)}`}
                  offset={`${String(fractionOf(sample.elapsedSeconds) * 100)}%`}
                  stopColor={trackLightColor(sample)}
                />
              ))}
            </linearGradient>
          </defs>
          <rect width="100" height="10" rx="1.5" fill={`url(#${gradientId})`} />
        </Box>
        {sunMarks.map((mark) => (
          <Box
            key={mark.key}
            role="img"
            aria-label={mark.label}
            className="track-light-sun-event"
            sx={{
              position: 'absolute',
              top: -4,
              left: `${String(mark.fraction * 100)}%`,
              transform: 'translateX(-50%)',
              display: 'flex',
              bgcolor: 'background.paper',
              borderRadius: '50%',
              boxShadow: 1,
              pointerEvents: 'none',
            }}
          >
            <WbTwilightIcon sx={{ fontSize: 20, color: sunEventColors[mark.kind] }} />
          </Box>
        ))}
        {hoverFraction === null ? null : (
          <Box
            aria-hidden
            className="track-light-cursor"
            sx={{
              position: 'absolute',
              top: -2,
              bottom: -2,
              left: `${String(hoverFraction * 100)}%`,
              width: 2,
              ml: '-1px',
              bgcolor: 'text.primary',
              pointerEvents: 'none',
            }}
          />
        )}
        {hoverLabel === null || hoverFraction === null ? null : (
          <Typography
            variant="caption"
            sx={{
              position: 'absolute',
              bottom: 'calc(100% + 6px)',
              ...anchoredAt(hoverFraction),
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              bgcolor: 'background.paper',
              boxShadow: 2,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            {hoverLabel}
          </Typography>
        )}
      </Box>
      <Box sx={{ position: 'relative', height: 16 }}>
        {ticks.map(({ key, fraction, label }) => (
          <Typography
            key={key}
            variant="caption"
            color="text.secondary"
            sx={{
              position: 'absolute',
              top: 0,
              ...anchoredAt(fraction),
              lineHeight: '16px',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

/** How the hike's duration was found, as `Route timing` describes its timeline. */
export type TrackLightingPace = 'recorded' | 'estimated' | 'adjusted';

/**
 * The day's sun graph, the light strip along the hike, then the seconds of each light
 * kind and the finish against sunset.
 */
export function TrackLightingSummary({
  lighting,
  pace,
  onHoverSample,
  onSelectDistance,
}: {
  readonly lighting: TrackLightingView;
  readonly pace: TrackLightingPace;
} & Pick<TrackLightingStripProps, 'onHoverSample' | 'onSelectDistance'>): ReactElement {
  const { i18n, t } = useLingui();
  const labels = useLightKindLabels();
  const { terrain, finishMs, timeZone } = lighting;
  const [finishLongitude, finishLatitude] = lighting.finishCoordinate;
  const daylight = useMemo(
    () =>
      daylightWindow(
        finishMs,
        { latitude: finishLatitude, longitude: finishLongitude },
        timeZone,
      ),
    [finishLatitude, finishLongitude, finishMs, timeZone],
  );
  let sunsetNote: string | null = null;
  let finishLine: string | null = null;
  if (daylight !== null) {
    const margin = formatTrackDuration(
      Math.abs(daylight.sunsetMs - lighting.finishMs) / 1_000,
      i18n,
    );
    const beforeSunset = lighting.finishMs <= daylight.sunsetMs;
    sunsetNote = beforeSunset ? t`${margin} before sunset` : t`${margin} after sunset`;
    finishLine = beforeSunset
      ? t`Finishing ${margin} before sunset.`
      : t`Finishing ${margin} after sunset.`;
  }
  const durations =
    terrain.status === 'ready' ? trackLightDurations(terrain.samples) : null;
  // The finish's sunset margin annotates the light the hike ends in.
  const lastSample = terrain.status === 'ready' ? terrain.samples.at(-1) : undefined;
  let finishKind: TrackLightKind | undefined;
  if (lastSample !== undefined) {
    const shares = trackLightShares(lastSample);
    finishKind = trackLightKinds.reduce((best, candidate) =>
      shares[candidate] > shares[best] ? candidate : best,
    );
  }
  return (
    // The sun graph, the strip, and the light rows, 8 px apart.
    <Stack spacing={1}>
      <SunDayChart lighting={lighting} pace={pace} />
      <TrackLightingStrip
        lighting={lighting}
        onHoverSample={onHoverSample}
        onSelectDistance={onSelectDistance}
      />
      {/* Every kind keeps its row while the light loads, so nothing below moves. */}
      {terrain.status === 'off' ? null : (
        // Rows share grid columns (dot, kind, hours, minutes, note), aligned like a table
        // down to the hour and minute digits.
        <Box
          component="ul"
          sx={{
            m: 0,
            p: 0,
            display: 'grid',
            gridTemplateColumns: '10px max-content max-content max-content 1fr',
            columnGap: 1,
            rowGap: 0.25,
            alignItems: 'center',
          }}
        >
          {trackLightKinds.map((kind) => {
            const seconds = durations?.[kind];
            const totalMinutes = seconds === undefined ? 0 : Math.round(seconds / 60);
            // Dimmed exactly when the shown duration rounds to nothing.
            const met = totalMinutes > 0;
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            /* eslint-disable lingui/no-unlocalized-strings -- CSS values. */
            const durationSx = {
              fontWeight: 600,
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            } as const;
            /* eslint-enable lingui/no-unlocalized-strings */
            return (
              <Box
                key={kind}
                component="li"
                role="listitem"
                sx={{
                  display: 'contents',
                  color:
                    met || seconds === undefined ? 'text.primary' : 'text.secondary',
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: trackLightColors[kind],
                    opacity: met || seconds === undefined ? 1 : 0.4,
                  }}
                />
                <Typography variant="body2">{labels[kind]}</Typography>{' '}
                {terrain.status === 'loading' ? (
                  <Skeleton variant="text" width={48} sx={{ gridColumn: 'span 2' }} />
                ) : seconds === undefined ? (
                  <Typography
                    variant="body2"
                    sx={{ ...durationSx, gridColumn: 'span 2' }}
                  >
                    —
                  </Typography>
                ) : (
                  <>
                    <Typography variant="body2" sx={durationSx}>
                      {t`${hours}h`}
                    </Typography>{' '}
                    <Typography variant="body2" sx={{ ...durationSx, ml: -0.5 }}>
                      {t`${minutes}m`}
                    </Typography>
                  </>
                )}
                <Typography variant="body2" color="text.secondary">
                  {kind === finishKind && sunsetNote !== null
                    ? ` (${sunsetNote})`
                    : null}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
      {/* Without the light list, the sunset margin needs a sentence of its own. */}
      {terrain.status !== 'off' || finishLine === null ? null : (
        <Typography variant="body2">{finishLine}</Typography>
      )}
    </Stack>
  );
}

const chartWidth = 300;
const chartHeight = 120;
/** Plot rows: room for the elevation readout above, the time labels below. */
const plotTop = 30;
const plotBottom = chartHeight - 4;
const sampleStepMinutes = 10;
/** Standard twilight limits: civil, nautical, and astronomical, Sun centre below the horizon. */
const twilightBands = [
  { from: 0, to: -6, opacity: 0.28 },
  { from: -6, to: -12, opacity: 0.16 },
  { from: -12, to: -18, opacity: 0.08 },
] as const;
/** The sun graph's lowest elevation: astronomical twilight ends here. */
const sunGraphFloorDegrees = -18;

/**
 * Garmin-style sun graph for the hike's start day: the Sun's elevation over the local
 * day on one linear scale against the horizon, shaded civil, nautical, and astronomical
 * twilight bands, sunrise and sunset marks, and the hike's span highlighted. The Sun
 * dot stands at the map's sun-shadow time of day, and a click moves the map there.
 */
function SunDayChart({
  lighting,
  pace,
}: {
  readonly lighting: TrackLightingView;
  readonly pace: TrackLightingPace;
}): ReactElement {
  const { i18n, t } = useLingui();
  const clock = useClockFormat(lighting.timeZone);
  const { startMs, timeZone } = lighting;
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const { mapLayers } = useRuntimeServices();
  const mapSunMs = useStore(mapLayerStore, (state) => state.sunShadow.instantMs);
  const [longitude, latitude] = lighting.startCoordinate;
  // A day of sun positions and its sunrise and sunset; slider drags re-render often.
  const { day, daylight, curve, peak, lowest } = useMemo(() => {
    const bounds = localDayBounds(
      instantToZonedWallTime(new Date(startMs), timeZone),
      timeZone,
    );
    const points: { readonly instantMs: number; readonly elevation: number }[] = [];
    for (
      let instantMs = bounds.startMs;
      instantMs <= bounds.endMs;
      instantMs += sampleStepMinutes * 60_000
    ) {
      points.push({
        instantMs,
        elevation: solarPosition(new Date(instantMs), latitude, longitude)
          .apparentElevationDegrees,
      });
    }
    return {
      day: bounds,
      daylight: daylightWindow(startMs, { latitude, longitude }, timeZone),
      curve: points,
      peak: points.reduce(
        (highest, point) => (point.elevation > highest.elevation ? point : highest),
        points[0] ?? { instantMs: bounds.startMs, elevation: 0 },
      ),
      lowest: points.reduce(
        (minimum, point) => Math.min(minimum, point.elevation),
        Number.POSITIVE_INFINITY,
      ),
    };
  }, [latitude, longitude, startMs, timeZone]);
  const spanMs = day.endMs - day.startMs;
  const xOf = (instantMs: number) =>
    Math.min(
      chartWidth,
      Math.max(0, ((instantMs - day.startMs) / spanMs) * chartWidth),
    );
  const pointerInstant = (event: Parameters<typeof pointerFraction>[0]) => {
    const fraction = pointerFraction(event);
    return fraction === null ? null : day.startMs + fraction * spanMs;
  };
  // One linear scale from the day's highest Sun down to the end of twilight; deeper
  // night says nothing more about light, so the curve rests on the floor there.
  const highestDegrees = Math.max(peak.elevation, 1);
  const lowestDegrees = Math.max(Math.min(lowest, -1), sunGraphFloorDegrees);
  const yOf = (elevation: number) =>
    plotTop +
    ((highestDegrees - Math.max(elevation, lowestDegrees)) /
      (highestDegrees - lowestDegrees)) *
      (plotBottom - plotTop);
  const horizonY = yOf(0);
  const labelY = Math.min(horizonY + 18, chartHeight - 2);
  const durationText = formatTrackDuration(
    (lighting.finishMs - lighting.startMs) / 1_000,
    i18n,
  );
  const paceLabel =
    pace === 'recorded'
      ? t`Recorded pace`
      : pace === 'estimated'
        ? t`Estimated pace`
        : t`Adjusted pace`;
  const pointsOf = (points: readonly { instantMs: number; elevation: number }[]) =>
    points
      .map(
        (point) =>
          `${xOf(point.instantMs).toFixed(1)},${yOf(point.elevation).toFixed(1)}`,
      )
      .join(' ');
  const hikePoints = curve.filter(
    (point) =>
      point.instantMs >= lighting.startMs && point.instantMs <= lighting.finishMs,
  );
  const hikeStartX = xOf(lighting.startMs);
  const hikeEndX = xOf(lighting.finishMs);
  const peakDegrees = new Intl.NumberFormat(i18n.locale, {
    maximumFractionDigits: 0,
  }).format(Math.max(0, peak.elevation));
  const sunrise = daylight === null ? null : clock.format(new Date(daylight.sunriseMs));
  const sunset = daylight === null ? null : clock.format(new Date(daylight.sunsetMs));
  const dayLength =
    daylight === null
      ? null
      : formatTrackDuration((daylight.sunsetMs - daylight.sunriseMs) / 1_000, i18n);
  const description =
    sunrise === null || sunset === null || dayLength === null
      ? t`Sun elevation over the hike day; the Sun reaches ${peakDegrees}°.`
      : t`Sun elevation over the hike day: sunrise ${sunrise}, sunset ${sunset}, ${dayLength} of daylight; the Sun reaches ${peakDegrees}°.`;
  // The map's sun time of day on the graph's day; zero until the map sets its instant.
  let mapSunOnDayMs: number | null = null;
  if (mapSunMs > 0) {
    const dayWall = instantToZonedWallTime(new Date(day.startMs), timeZone);
    const mapWall = instantToZonedWallTime(new Date(mapSunMs), timeZone);
    mapSunOnDayMs = zonedWallTimeToInstant(
      { ...mapWall, year: dayWall.year, month: dayWall.month, day: dayWall.day },
      timeZone,
    ).getTime();
  }
  // Hovering reads the Sun at any time of the day; otherwise the map's sun time shows.
  const shownMs = hoverMs ?? mapSunOnDayMs;
  const shown =
    shownMs === null
      ? peak
      : {
          instantMs: shownMs,
          elevation: solarPosition(new Date(shownMs), latitude, longitude)
            .apparentElevationDegrees,
        };
  const shownDegrees = new Intl.NumberFormat(i18n.locale, {
    maximumFractionDigits: 0,
  }).format(shownMs === null ? Math.max(0, shown.elevation) : shown.elevation);
  const lightColor = appColors.text.inverse;
  const mutedColor = appColors.text.inverseMuted;

  return (
    <Box
      sx={{
        bgcolor: appColors.brand.deepSpace,
        color: lightColor,
        borderRadius: 2,
        px: 1.5,
        pt: 1,
        pb: 1.25,
      }}
    >
      <Box
        role="img"
        aria-label={description}
        component="svg"
        viewBox={`0 0 ${String(chartWidth)} ${String(chartHeight)}`}
        sx={{
          display: 'block',
          width: '100%',
          height: 'auto',
          overflow: 'visible',
          cursor: 'crosshair',
          touchAction: 'pan-y',
        }}
        onPointerMove={(event) => {
          const instantMs = pointerInstant(event);
          if (instantMs !== null) setHoverMs(instantMs);
        }}
        onPointerLeave={() => {
          setHoverMs(null);
        }}
        onClick={(event) => {
          const instantMs = pointerInstant(event);
          if (mapLayers === null || instantMs === null) return;
          // Whole minutes, like the map's sun panel; its on or off state stays.
          mapLayers.setSunShadow({
            enabled: mapLayerStore.getState().sunShadow.enabled,
            instantMs: Math.round(instantMs / 60_000) * 60_000,
          });
        }}
      >
        {[3, 6, 9, 12, 15, 18, 21].map((hour) => (
          <line
            key={hour}
            x1={(hour / 24) * chartWidth}
            x2={(hour / 24) * chartWidth}
            y1={plotTop - 22}
            y2={chartHeight}
            stroke={mutedColor}
            strokeOpacity={0.18}
          />
        ))}
        {twilightBands
          .filter((band) => band.from > lowestDegrees)
          .map((band) => (
            <rect
              key={band.from}
              x={0}
              y={yOf(band.from)}
              width={chartWidth}
              height={yOf(Math.max(band.to, lowestDegrees)) - yOf(band.from)}
              fill={appColors.trackLight.twilight}
              fillOpacity={band.opacity}
            />
          ))}
        <rect
          x={hikeStartX}
          y={plotTop - 22}
          width={Math.max(1, hikeEndX - hikeStartX)}
          height={chartHeight - plotTop + 22}
          fill={appColors.brand.amber}
          fillOpacity={0.16}
        />
        <line
          x1={0}
          x2={chartWidth}
          y1={horizonY}
          y2={horizonY}
          stroke={appColors.brand.blueGreen}
          strokeWidth={1.5}
        />
        <polyline
          points={pointsOf(curve)}
          fill="none"
          stroke={appColors.brand.tigerOrange}
          strokeWidth={1.5}
        />
        {hikePoints.length < 2 ? null : (
          <polyline
            points={pointsOf(hikePoints)}
            fill="none"
            stroke={appColors.brand.amber}
            strokeWidth={4}
            strokeLinecap="round"
          />
        )}
        {daylight === null
          ? null
          : [daylight.sunriseMs, daylight.sunsetMs].map((instantMs) => (
              <rect
                key={instantMs}
                x={xOf(instantMs) - 4}
                y={horizonY - 3}
                width={8}
                height={5}
                fill={appColors.marker.red}
              />
            ))}
        {hoverMs === null ? null : (
          <line
            x1={xOf(hoverMs)}
            x2={xOf(hoverMs)}
            y1={plotTop - 22}
            y2={chartHeight}
            stroke={lightColor}
            strokeOpacity={0.6}
          />
        )}
        <circle
          cx={xOf(shown.instantMs)}
          cy={yOf(shown.elevation)}
          r={6}
          fill={appColors.brand.amber}
        />
        <text x={0} y={22} fill={lightColor} fontSize={18} fontWeight={700}>
          {shownDegrees}°
        </text>
        {shownMs === null ? null : (
          <text
            x={chartWidth}
            y={22}
            fill={lightColor}
            fontSize={15}
            fontWeight={700}
            textAnchor="end"
          >
            {clock.format(new Date(shownMs))}
          </text>
        )}
        {daylight === null || sunrise === null || sunset === null ? null : (
          <>
            <text
              x={xOf(daylight.sunriseMs) + 6}
              y={labelY}
              fill={lightColor}
              fontSize={13}
              fontWeight={600}
            >
              {sunrise}
            </text>
            <text
              x={xOf(daylight.sunsetMs) - 6}
              y={labelY}
              fill={lightColor}
              fontSize={13}
              fontWeight={600}
              textAnchor="end"
            >
              {sunset}
            </text>
          </>
        )}
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }}>
        <Box>
          <Typography variant="caption" sx={{ color: mutedColor, display: 'block' }}>
            {t`Daylight`}
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {dayLength ?? '—'}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="caption" sx={{ color: mutedColor, display: 'block' }}>
            {paceLabel}
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {pace === 'recorded' ? durationText : `≈ ${durationText}`}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="caption" sx={{ color: mutedColor, display: 'block' }}>
            {t`Hike`}
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {clock.format(new Date(lighting.startMs))}–
            {clock.format(new Date(lighting.finishMs))}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}
