import { useLingui } from '@lingui/react/macro';
import { Box, Skeleton, Stack, Typography } from '@mui/material';
import { useId, useMemo, type ReactElement } from 'react';

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
import { formatTrackDuration } from '@/presentation/tracks/trackFormatters';
import type { TrackLightingView } from '@/presentation/tracks/useTrackLighting';

const millisecondsPerHour = 3_600_000;
/** Clock labels under the strip: at most this many, at least this far apart. */
const maximumHourLabels = 7;
const minimumHourLabelGapFraction = 0.09;
const hourLabelSteps = [1, 2, 3, 4, 6, 12, 24] as const;

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

interface TrackLightingStripProps {
  readonly lighting: TrackLightingView;
  /** Horizontal chart position of a route distance on the profile's current axis. */
  readonly xOfDistance: (distanceMeters: number) => number;
}

/**
 * Light along the route under the profile, aligned with its plot area, with the clock
 * hours the hiker passes. Stops sit at each sample's chart position, so the strip
 * follows the Distance or Time axis above it.
 */
export function TrackLightingStrip({
  lighting,
  xOfDistance,
}: TrackLightingStripProps): ReactElement | null {
  const { i18n, t } = useLingui();
  const labels = useLightKindLabels();
  const clock = useClockFormat(lighting.timeZone);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG element ID.
  const gradientId = `track-light-${useId().replaceAll(':', '')}`;
  const { terrain } = lighting;
  if (terrain.status === 'off') return null;
  // Matches the chart: an 8 px bleed, a 64 px axis plus 4 px margin, and 16 px at right.
  const plotInset = { mx: -1, pl: 8.5, pr: 2 };
  if (terrain.status === 'loading') {
    return (
      <Box sx={plotInset}>
        <Skeleton
          variant="rounded"
          height={10}
          aria-label={t`Calculating the light along the route`}
        />
      </Box>
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
  const firstX = xOfDistance(samples[0]?.distanceMeters ?? 0);
  const width = xOfDistance(samples.at(-1)?.distanceMeters ?? 0) - firstX;
  const fractionOf = (distanceMeters: number) =>
    width <= 0 ? 0 : (xOfDistance(distanceMeters) - firstX) / width;
  const elapsedSpanMs = lighting.finishMs - lighting.startMs;
  const step =
    hourLabelSteps.find(
      (hours) => elapsedSpanMs / (hours * millisecondsPerHour) <= maximumHourLabels,
    ) ?? 24;
  const hourLabels: { readonly fraction: number; readonly label: string }[] = [];
  // Whole local hours on the step grid, placed where the hiker is at that time.
  const startWall = instantToZonedWallTime(
    new Date(lighting.startMs),
    lighting.timeZone,
  );
  let hourMs =
    lighting.startMs - startWall.minute * 60_000 - (lighting.startMs % 60_000);
  if (hourMs < lighting.startMs) hourMs += millisecondsPerHour;
  for (; hourMs <= lighting.finishMs; hourMs += millisecondsPerHour) {
    const hour = instantToZonedWallTime(new Date(hourMs), lighting.timeZone).hour;
    if (hour % step !== 0) continue;
    const elapsedSeconds = (hourMs - lighting.startMs) / 1_000;
    const index = samples.findIndex(
      (sample) => sample.elapsedSeconds >= elapsedSeconds,
    );
    const after = samples[index];
    const before = samples[index - 1] ?? after;
    if (after === undefined || before === undefined) continue;
    const span = after.elapsedSeconds - before.elapsedSeconds;
    const distanceMeters =
      span <= 0
        ? after.distanceMeters
        : before.distanceMeters +
          ((after.distanceMeters - before.distanceMeters) *
            (elapsedSeconds - before.elapsedSeconds)) /
            span;
    const fraction = fractionOf(distanceMeters);
    if (
      hourLabels.length > 0 &&
      fraction - (hourLabels.at(-1)?.fraction ?? 0) < minimumHourLabelGapFraction
    ) {
      continue;
    }
    hourLabels.push({ fraction, label: clock.format(new Date(hourMs)) });
  }
  const durations = trackLightDurations(samples);
  const description = trackLightKinds
    .filter((kind) => durations[kind] >= 60)
    .map((kind) => `${labels[kind]} ${formatTrackDuration(durations[kind], i18n)}`)
    .join(', ');

  return (
    <Box sx={plotInset}>
      <Box
        role="img"
        aria-label={t`Light along the route: ${description}`}
        component="svg"
        sx={{ display: 'block', width: '100%', height: 10, borderRadius: 1 }}
        // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG attribute value.
        preserveAspectRatio="none"
        viewBox="0 0 100 10"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            {samples.map((sample) => (
              <stop
                key={sample.distanceMeters}
                offset={`${String(fractionOf(sample.distanceMeters) * 100)}%`}
                stopColor={sampleColor(sample)}
              />
            ))}
          </linearGradient>
        </defs>
        <rect width="100" height="10" rx="1.5" fill={`url(#${gradientId})`} />
      </Box>
      <Box sx={{ position: 'relative', height: 16 }}>
        {hourLabels.map(({ fraction, label }) => (
          <Typography
            key={label}
            variant="caption"
            color="text.secondary"
            sx={{
              position: 'absolute',
              top: 0,
              left: `${String(fraction * 100)}%`,
              transform:
                fraction < 0.04
                  ? 'none'
                  : fraction > 0.96
                    ? 'translateX(-100%)'
                    : 'translateX(-50%)',
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

/** Seconds of each light kind and how the finish relates to sunset. */
export function TrackLightingSummary({
  lighting,
}: {
  readonly lighting: TrackLightingView;
}): ReactElement {
  const { i18n, t } = useLingui();
  const labels = useLightKindLabels();
  const { terrain } = lighting;
  const daylight = daylightWindow(
    lighting.finishMs,
    {
      latitude: lighting.finishCoordinate[1],
      longitude: lighting.finishCoordinate[0],
    },
    lighting.timeZone,
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
        <Stack
          component="ul"
          direction="row"
          sx={{ flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25, m: 0, p: 0 }}
        >
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
      {finishLine === null ? null : (
        <Typography variant="body2">{finishLine}</Typography>
      )}
      <SunDayChart lighting={lighting} />
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
  const [longitude, latitude] = lighting.startCoordinate;
  const day = localDayBounds(
    instantToZonedWallTime(new Date(lighting.startMs), lighting.timeZone),
    lighting.timeZone,
  );
  const daylight = daylightWindow(
    lighting.startMs,
    { latitude, longitude },
    lighting.timeZone,
  );
  const spanMs = day.endMs - day.startMs;
  const xOf = (instantMs: number) =>
    Math.min(
      chartWidth,
      Math.max(0, ((instantMs - day.startMs) / spanMs) * chartWidth),
    );
  const curve: { readonly instantMs: number; readonly elevation: number }[] = [];
  for (
    let instantMs = day.startMs;
    instantMs <= day.endMs;
    instantMs += sampleStepMinutes * 60_000
  ) {
    curve.push({
      instantMs,
      elevation: solarPosition(new Date(instantMs), latitude, longitude)
        .apparentElevationDegrees,
    });
  }
  const peak = curve.reduce(
    (highest, point) => (point.elevation > highest.elevation ? point : highest),
    curve[0] ?? { instantMs: day.startMs, elevation: 0 },
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
        sx={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}
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
        {peak.elevation > 0 ? (
          <circle
            cx={xOf(peak.instantMs)}
            cy={yOf(peak.elevation)}
            r={6}
            fill={appColors.brand.amber}
          />
        ) : null}
        <text x={0} y={22} fill={lightColor} fontSize={18} fontWeight={700}>
          {peakDegrees}°
        </text>
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
