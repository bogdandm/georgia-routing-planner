import { useLingui } from '@lingui/react/macro';
import { Box, Skeleton, Stack, Typography } from '@mui/material';
import { memo, useId, useMemo, useState, type ReactElement } from 'react';

import { solarPosition } from '@/domain/terrain/solarPosition';
import { instantToZonedWallTime } from '@/domain/time/zonedWallTime';
import {
  trackLightDurations,
  trackLightKinds,
  trackLightShares,
  trackLightingModel,
  type TrackLightKind,
  type TrackLightingSample,
} from '@/domain/tracks/trackLighting';
import { daylightWindow, localDayBounds } from '@/presentation/map/sunShadowDaylight';
import { appColors } from '@/presentation/theme/appColors';
import {
  formatTrackDistance,
  formatTrackDuration,
} from '@/presentation/tracks/trackFormatters';
import type { TrackLightingView } from '@/presentation/tracks/useTrackLighting';

const millisecondsPerHour = 3_600_000;
/** Labels under the strip: at most this many, at least this far apart. */
const maximumTickLabels = 7;
const minimumTickGapFraction = 0.09;
const hourTickSteps = [1, 2, 3, 4, 6, 12, 24] as const;
const distanceTickStepsMeters = [
  500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000,
] as const;

function hexChannels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const lightChannels = {
  sun: hexChannels(appColors.trackLight.sun),
  shade: hexChannels(appColors.trackLight.shade),
  twilight: hexChannels(appColors.trackLight.twilight),
  twilightEnd: hexChannels(appColors.trackLight.twilightEnd),
  dark: hexChannels(appColors.trackLight.dark),
};

/** Legend color of each light kind; the strip darkens twilight with depth. */
const trackLightColors: Readonly<Record<TrackLightKind, string>> = {
  sun: appColors.trackLight.sun,
  shade: appColors.trackLight.shade,
  twilight: appColors.trackLight.twilight,
  dark: appColors.trackLight.dark,
};

/**
 * Strip color of a sample: its light kinds blended by share, with the blue hour fading
 * from dusk blue at sunset to deep blue at the end of civil twilight.
 */
function sampleColor(sample: TrackLightingSample): string {
  const shares = trackLightShares(sample);
  const depth = Math.min(
    1,
    Math.max(
      0,
      sample.sunElevationDegrees / trackLightingModel.twilightEndElevationDegrees,
    ),
  );
  const twilight = lightChannels.twilight.map(
    (channel, index) =>
      channel + ((lightChannels.twilightEnd[index] ?? channel) - channel) * depth,
  );
  const channels = [0, 1, 2].map((index) =>
    Math.round(
      shares.sun * (lightChannels.sun[index] ?? 0) +
        shares.shade * (lightChannels.shade[index] ?? 0) +
        shares.twilight * (twilight[index] ?? 0) +
        shares.dark * (lightChannels.dark[index] ?? 0),
    ),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
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

/** Lighting between the two samples around `position` on the strip's axis. */
function sampleAt(
  samples: readonly TrackLightingSample[],
  positionOf: (sample: TrackLightingSample) => number,
  position: number,
): TrackLightingSample | null {
  const index = samples.findIndex((sample) => positionOf(sample) >= position);
  const after = samples[index] ?? samples.at(-1);
  const before = samples[index - 1] ?? after;
  if (after === undefined || before === undefined) return null;
  const span = positionOf(after) - positionOf(before);
  const fraction = span <= 0 ? 1 : (position - positionOf(before)) / span;
  const mix = (from: number, to: number) => from + (to - from) * fraction;
  return {
    distanceMeters: mix(before.distanceMeters, after.distanceMeters),
    elapsedSeconds: mix(before.elapsedSeconds, after.elapsedSeconds),
    sunlitFraction: mix(before.sunlitFraction, after.sunlitFraction),
    sunElevationDegrees: mix(before.sunElevationDegrees, after.sunElevationDegrees),
  };
}

interface TrackLightingStripProps {
  readonly lighting: TrackLightingView;
  /** The profile's axis: the strip runs over route distance or hike time like it. */
  readonly axis: 'distance' | 'time';
}

/**
 * Light along the route across the full width, over route distance or hike time like
 * the profile above, with distance or clock-hour labels and a hover readout.
 */
export const TrackLightingStrip = memo(function TrackLightingStrip({
  lighting,
  axis,
}: TrackLightingStripProps): ReactElement | null {
  const { i18n, t } = useLingui();
  const labels = useLightKindLabels();
  const clock = useClockFormat(lighting.timeZone);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG element ID.
  const gradientId = `track-light-${useId().replaceAll(':', '')}`;
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const { terrain } = lighting;
  if (terrain.status === 'off') return null;
  if (terrain.status === 'loading') {
    return (
      <Skeleton
        variant="rounded"
        height={10}
        aria-label={t`Calculating the light along the route`}
      />
    );
  }
  if (terrain.status === 'failed') {
    return (
      <Typography variant="caption" color="text.secondary">
        {t`The light along the route could not be calculated.`}
      </Typography>
    );
  }
  const { samples } = terrain;
  const positionOf = (sample: TrackLightingSample) =>
    axis === 'time' ? sample.elapsedSeconds : sample.distanceMeters;
  const firstPosition = samples[0] === undefined ? 0 : positionOf(samples[0]);
  const lastSample = samples.at(-1);
  const span = lastSample === undefined ? 0 : positionOf(lastSample) - firstPosition;
  const fractionOf = (position: number) =>
    span <= 0 ? 0 : (position - firstPosition) / span;

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
  if (axis === 'time') {
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
      if (
        instantToZonedWallTime(new Date(hourMs), lighting.timeZone).hour % step !==
        0
      ) {
        continue;
      }
      addTick(
        hourMs,
        fractionOf((hourMs - lighting.startMs) / 1_000),
        clock.format(new Date(hourMs)),
      );
    }
  } else {
    const step =
      distanceTickStepsMeters.find(
        (meters) => span / meters <= maximumTickLabels - 1,
      ) ?? Math.ceil(span / (maximumTickLabels - 1));
    for (let meters = 0; meters <= span; meters += step) {
      addTick(
        meters,
        fractionOf(firstPosition + meters),
        formatTrackDistance(meters, i18n),
      );
    }
  }

  const durations = trackLightDurations(samples);
  const description = trackLightKinds
    .filter((kind) => durations[kind] >= 60)
    .map((kind) => `${labels[kind]} ${formatTrackDuration(durations[kind], i18n)}`)
    .join(', ');
  const hovered =
    hoverFraction === null
      ? null
      : sampleAt(samples, positionOf, firstPosition + hoverFraction * span);
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
  const anchoredAt = (fraction: number) => ({
    left: `${String(fraction * 100)}%`,
    /* eslint-disable lingui/no-unlocalized-strings -- CSS values. */
    transform:
      fraction < 0.04
        ? 'none'
        : fraction > 0.96
          ? 'translateX(-100%)'
          : 'translateX(-50%)',
    /* eslint-enable lingui/no-unlocalized-strings */
  });

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        sx={{ position: 'relative', cursor: 'crosshair', touchAction: 'pan-y' }}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (bounds.width <= 0) return;
          setHoverFraction(
            Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
          );
        }}
        onPointerLeave={() => {
          setHoverFraction(null);
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
                  offset={`${String(fractionOf(positionOf(sample)) * 100)}%`}
                  stopColor={sampleColor(sample)}
                />
              ))}
            </linearGradient>
          </defs>
          <rect width="100" height="10" rx="1.5" fill={`url(#${gradientId})`} />
        </Box>
        {hoverFraction === null ? null : (
          <Box
            aria-hidden
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
});

/** Seconds of each light kind and how the finish relates to sunset. */
export function TrackLightingSummary({
  lighting,
}: {
  readonly lighting: TrackLightingView;
}): ReactElement {
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
  let finishLine: string | null = null;
  if (daylight !== null) {
    const margin = formatTrackDuration(
      Math.abs(daylight.sunsetMs - lighting.finishMs) / 1_000,
      i18n,
    );
    finishLine =
      lighting.finishMs <= daylight.sunsetMs
        ? t`Finishing ${margin} before sunset.`
        : t`Finishing ${margin} after sunset.`;
  }
  const durations =
    terrain.status === 'ready' ? trackLightDurations(terrain.samples) : null;
  return (
    <Stack spacing={0.75}>
      {durations === null ? null : (
        <Stack component="ul" spacing={0.25} sx={{ m: 0, p: 0 }}>
          {trackLightKinds
            .filter((kind) => durations[kind] >= 60)
            .map((kind) => (
              <Stack
                key={kind}
                component="li"
                direction="row"
                spacing={0.75}
                sx={{ alignItems: 'center', listStyle: 'none' }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: trackLightColors[kind],
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2">
                  {labels[kind]}{' '}
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {formatTrackDuration(durations[kind], i18n)}
                  </Box>
                </Typography>
              </Stack>
            ))}
        </Stack>
      )}
      <SunDayChart lighting={lighting} />
      {finishLine === null ? null : (
        <Typography variant="body2">{finishLine}</Typography>
      )}
    </Stack>
  );
}

const chartWidth = 300;
const chartHeight = 112;
const horizonY = 72;
const daylightHeight = 56;
const sampleStepMinutes = 10;

/**
 * Garmin-style sun graph for the hike's start day: the Sun's elevation over the local
 * day against the horizon, sunrise and sunset marks, and the hike's span highlighted.
 */
function SunDayChart({
  lighting,
}: {
  readonly lighting: TrackLightingView;
}): ReactElement {
  const { i18n, t } = useLingui();
  const clock = useClockFormat(lighting.timeZone);
  const { startMs, timeZone } = lighting;
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [longitude, latitude] = lighting.startCoordinate;
  // A day of sun positions and its sunrise and sunset; slider drags re-render often.
  const { day, daylight, curve, peak } = useMemo(() => {
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
    };
  }, [latitude, longitude, startMs, timeZone]);
  const spanMs = day.endMs - day.startMs;
  const xOf = (instantMs: number) =>
    Math.min(
      chartWidth,
      Math.max(0, ((instantMs - day.startMs) / spanMs) * chartWidth),
    );
  const scale = daylightHeight / Math.max(peak.elevation, 10);
  const yOf = (elevation: number) =>
    Math.min(chartHeight - 2, horizonY - elevation * scale);
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
  // Hovering reads the Sun's elevation at any time of the day; otherwise its peak shows.
  const shown =
    hoverMs === null
      ? peak
      : {
          instantMs: hoverMs,
          elevation: solarPosition(new Date(hoverMs), latitude, longitude)
            .apparentElevationDegrees,
        };
  const shownDegrees = new Intl.NumberFormat(i18n.locale, {
    maximumFractionDigits: 0,
  }).format(hoverMs === null ? Math.max(0, shown.elevation) : shown.elevation);
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
          const bounds = event.currentTarget.getBoundingClientRect();
          if (bounds.width <= 0) return;
          const fraction = Math.min(
            1,
            Math.max(0, (event.clientX - bounds.left) / bounds.width),
          );
          setHoverMs(day.startMs + fraction * spanMs);
        }}
        onPointerLeave={() => {
          setHoverMs(null);
        }}
      >
        {[3, 6, 9, 12, 15, 18, 21].map((hour) => (
          <line
            key={hour}
            x1={(hour / 24) * chartWidth}
            x2={(hour / 24) * chartWidth}
            y1={8}
            y2={chartHeight}
            stroke={mutedColor}
            strokeOpacity={0.18}
          />
        ))}
        <rect
          x={hikeStartX}
          y={8}
          width={Math.max(1, hikeEndX - hikeStartX)}
          height={chartHeight - 8}
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
            y1={8}
            y2={chartHeight}
            stroke={lightColor}
            strokeOpacity={0.6}
          />
        )}
        {shown.elevation > -6 ? (
          <circle
            cx={xOf(shown.instantMs)}
            cy={yOf(shown.elevation)}
            r={6}
            fill={appColors.brand.amber}
          />
        ) : null}
        <text x={0} y={22} fill={lightColor} fontSize={18} fontWeight={700}>
          {shownDegrees}°
        </text>
        {hoverMs === null ? null : (
          <text
            x={chartWidth}
            y={22}
            fill={lightColor}
            fontSize={15}
            fontWeight={700}
            textAnchor="end"
          >
            {clock.format(new Date(hoverMs))}
          </text>
        )}
        {daylight === null || sunrise === null || sunset === null ? null : (
          <>
            <text
              x={xOf(daylight.sunriseMs) + 6}
              y={horizonY + 18}
              fill={lightColor}
              fontSize={13}
              fontWeight={600}
            >
              {sunrise}
            </text>
            <text
              x={xOf(daylight.sunsetMs) - 6}
              y={horizonY + 18}
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
