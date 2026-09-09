export type Sky =
  'clear' | 'mostly_clear' | 'partly_cloudy' | 'mostly_cloudy' | 'overcast';

export type Precipitation =
  | 'none'
  | 'light_rain'
  | 'showers'
  | 'rain'
  | 'heavy_rain'
  | 'snow_showers'
  | 'snow'
  | 'mixed'
  | 'freezing';

export type Visibility = 'normal' | 'haze' | 'poor' | 'fog';

export interface WeatherIcon {
  readonly sky: Sky;
  readonly phenomenon: Exclude<Precipitation, 'none'> | null;
  readonly visibility: Exclude<Visibility, 'normal'> | null;
}

export interface DailyWeatherHour {
  readonly precipitationMm: number;
  readonly rainMm: number;
  readonly showersMm: number;
  readonly snowfallCm: number;
  readonly precipitationType: number;
  readonly weatherCode: number;
  readonly cloudCoverPercent: number;
  readonly visibilityMeters: number;
  readonly isDay: boolean;
}

export interface DailyWeatherStatusDebug {
  readonly daylightHours: number;
  readonly wetHours: number;
  readonly wetFraction: number;
  readonly precipTotal: number;
  readonly maxHourlyPrecip: number;
  readonly rainTotal: number;
  readonly showersTotal: number;
  readonly snowfallTotal: number;
  readonly longestWetRun: number;
  readonly longestFogRun: number;
  readonly fogFraction: number;
  readonly hazeFraction: number;
  readonly medianVisibility: number;
  readonly hazeMedianVisibility: number;
  readonly minVisibility: number;
  readonly fractionBelow10km: number;
  readonly fractionBelow5km: number;
  readonly fractionBelow1km: number;
  readonly meanCloudCover: number;
  readonly showerRatio: number;
  readonly mixedHours: number;
  readonly snowTypeHours: number;
  readonly freezingHours: number;
}

export interface DailyWeatherStatus {
  readonly sky: Sky;
  readonly precipitation: Precipitation;
  readonly visibility: Visibility;
  readonly label: string;
  readonly icon: WeatherIcon;
  readonly debug: DailyWeatherStatusDebug;
}

export const DAILY_WEATHER_STATUS_THRESHOLDS = {
  meaningfulWetMm: 0.1,
  traceTotalMm: 0.2,
  traceMaximumWetHours: 1,
  fogVisibilityMeters: 1_000,
  hazeVisibilityMeters: 10_000,
  clearCloudCoverMaximum: 20,
  mostlyClearCloudCoverMaximum: 40,
  partlyCloudyCloudCoverMaximum: 65,
  mostlyCloudyCloudCoverMaximum: 85,
  ratioEpsilonMm: 0.000_001,
  mixedWetHourFraction: 0.25,
  snowDominanceWetHourFraction: 0.5,
  intermittentWetFractionMaximum: 0.35,
  intermittentWetRunMaximum: 2,
  showerRatioMinimum: 0.4,
  showerWetFractionMaximum: 0.5,
  showerWetRunMaximum: 2,
  lightRainTotalMm: 1,
  lightRainHourlyMaximumMm: 0.5,
  heavyRainHourlyMinimumMm: 4,
  heavyRainTotalMinimumMm: 12,
  fogFractionMinimum: 0.25,
  fogRunMinimum: 2,
  fogMedianVisibilityMeters: 1_000,
  poorMedianVisibilityMeters: 5_000,
  poorFractionBelow5kmMinimum: 0.33,
  hazeMedianVisibilityMeters: 10_000,
  hazeFractionMinimum: 0.33,
} as const;

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] as number;
  return ((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2;
}

function longestRun<T>(values: readonly T[], matches: (value: T) => boolean): number {
  let longest = 0;
  let current = 0;
  for (const value of values) {
    if (matches(value)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function classifySky(meanCloudCover: number): Sky {
  if (meanCloudCover <= DAILY_WEATHER_STATUS_THRESHOLDS.clearCloudCoverMaximum) {
    return 'clear';
  }
  if (meanCloudCover <= DAILY_WEATHER_STATUS_THRESHOLDS.mostlyClearCloudCoverMaximum) {
    return 'mostly_clear';
  }
  if (meanCloudCover <= DAILY_WEATHER_STATUS_THRESHOLDS.partlyCloudyCloudCoverMaximum) {
    return 'partly_cloudy';
  }
  if (meanCloudCover <= DAILY_WEATHER_STATUS_THRESHOLDS.mostlyCloudyCloudCoverMaximum) {
    return 'mostly_cloudy';
  }
  return 'overcast';
}

const skyLabels: Readonly<Record<Sky, string>> = {
  clear: 'Clear',
  mostly_clear: 'Mostly clear',
  partly_cloudy: 'Partly cloudy',
  mostly_cloudy: 'Mostly cloudy',
  overcast: 'Overcast',
};

function precipitationLabel(precipitation: Precipitation, sky: Sky): string {
  switch (precipitation) {
    case 'none':
      return skyLabels[sky];
    case 'showers':
      return `${skyLabels[sky]} with showers`;
    case 'light_rain':
      return 'Light rain';
    case 'rain':
      return sky === 'clear' || sky === 'mostly_clear' || sky === 'partly_cloudy'
        ? 'Rain with sunny intervals'
        : 'Overcast with rain';
    case 'heavy_rain':
      return 'Heavy rain';
    case 'snow_showers':
      return sky === 'clear' || sky === 'mostly_clear' || sky === 'partly_cloudy'
        ? 'Snow showers'
        : 'Mostly cloudy with snow showers';
    case 'snow':
      return 'Snow';
    case 'mixed':
      return 'Rain and snow';
    case 'freezing':
      return 'Freezing precipitation';
  }
}

export function aggregateDailyWeatherStatus(
  orderedLocalDayHours: readonly DailyWeatherHour[],
): DailyWeatherStatus {
  const daylight = orderedLocalDayHours.filter((hour) => hour.isDay);
  if (daylight.length === 0) {
    throw new RangeError('Daily weather status requires at least one daylight hour.');
  }

  const isWet = (hour: DailyWeatherHour) =>
    hour.precipitationMm >= DAILY_WEATHER_STATUS_THRESHOLDS.meaningfulWetMm;
  const isFog = (hour: DailyWeatherHour) =>
    hour.visibilityMeters < DAILY_WEATHER_STATUS_THRESHOLDS.fogVisibilityMeters ||
    hour.weatherCode === 45 ||
    hour.weatherCode === 48;
  const wet = daylight.filter(isWet);
  const dry = daylight.filter((hour) => !isWet(hour));
  const skyHours = dry.length > 0 ? dry : daylight;
  const fog = daylight.filter(isFog);
  const haze = daylight.filter(
    (hour) =>
      !isWet(hour) &&
      !isFog(hour) &&
      hour.visibilityMeters >= DAILY_WEATHER_STATUS_THRESHOLDS.fogVisibilityMeters &&
      hour.visibilityMeters < DAILY_WEATHER_STATUS_THRESHOLDS.hazeVisibilityMeters,
  );
  const dryNonFog = daylight.filter((hour) => !isWet(hour) && !isFog(hour));
  const visibilities = daylight.map((hour) => hour.visibilityMeters);
  const daylightHours = daylight.length;
  const wetHours = wet.length;
  const wetFraction = wetHours / daylightHours;
  const precipTotal = daylight.reduce((total, hour) => total + hour.precipitationMm, 0);
  const maxHourlyPrecip = Math.max(...daylight.map((hour) => hour.precipitationMm));
  const rainTotal = daylight.reduce((total, hour) => total + hour.rainMm, 0);
  const showersTotal = daylight.reduce((total, hour) => total + hour.showersMm, 0);
  const snowfallTotal = daylight.reduce((total, hour) => total + hour.snowfallCm, 0);
  const longestWetRun = longestRun(daylight, isWet);
  const longestFogRun = longestRun(daylight, isFog);
  const fogFraction = fog.length / daylightHours;
  const hazeFraction = haze.length / daylightHours;
  const medianVisibility = median(visibilities);
  const hazeMedianVisibility =
    dryNonFog.length > 0
      ? median(dryNonFog.map((hour) => hour.visibilityMeters))
      : medianVisibility;
  const minVisibility = Math.min(...visibilities);
  const fractionBelow10km =
    daylight.filter((hour) => hour.visibilityMeters < 10_000).length / daylightHours;
  const fractionBelow5km =
    daylight.filter((hour) => hour.visibilityMeters < 5_000).length / daylightHours;
  const fractionBelow1km =
    daylight.filter((hour) => hour.visibilityMeters < 1_000).length / daylightHours;
  const meanCloudCover = mean(skyHours.map((hour) => hour.cloudCoverPercent));
  const showerRatio =
    showersTotal /
    Math.max(precipTotal, DAILY_WEATHER_STATUS_THRESHOLDS.ratioEpsilonMm);
  const meaningfulTypeHours = wet;
  const mixedHours = meaningfulTypeHours.filter(
    (hour) => hour.precipitationType === 6 || hour.precipitationType === 7,
  ).length;
  const rainTypeHours = meaningfulTypeHours.filter(
    (hour) => hour.precipitationType === 1,
  ).length;
  const snowTypeHours = meaningfulTypeHours.filter(
    (hour) => hour.precipitationType === 5 || hour.precipitationType === 6,
  ).length;
  const freezingHours = meaningfulTypeHours.filter(
    (hour) =>
      hour.precipitationType === 3 ||
      hour.precipitationType === 8 ||
      hour.precipitationType === 12,
  ).length;
  const sky = classifySky(meanCloudCover);

  let precipitation: Precipitation;
  if (
    precipTotal < DAILY_WEATHER_STATUS_THRESHOLDS.traceTotalMm &&
    wetHours <= DAILY_WEATHER_STATUS_THRESHOLDS.traceMaximumWetHours
  ) {
    precipitation = 'none';
  } else if (freezingHours > 0) {
    precipitation = 'freezing';
  } else if (
    (wetHours > 0 &&
      mixedHours >= DAILY_WEATHER_STATUS_THRESHOLDS.mixedWetHourFraction * wetHours) ||
    (rainTypeHours >= DAILY_WEATHER_STATUS_THRESHOLDS.mixedWetHourFraction * wetHours &&
      snowTypeHours >= DAILY_WEATHER_STATUS_THRESHOLDS.mixedWetHourFraction * wetHours)
  ) {
    precipitation = 'mixed';
  } else if (
    wetHours > 0 &&
    snowTypeHours >=
      DAILY_WEATHER_STATUS_THRESHOLDS.snowDominanceWetHourFraction * wetHours
  ) {
    precipitation =
      wetFraction <= DAILY_WEATHER_STATUS_THRESHOLDS.intermittentWetFractionMaximum &&
      longestWetRun <= DAILY_WEATHER_STATUS_THRESHOLDS.intermittentWetRunMaximum
        ? 'snow_showers'
        : 'snow';
  } else if (
    showerRatio >= DAILY_WEATHER_STATUS_THRESHOLDS.showerRatioMinimum &&
    (wetFraction <= DAILY_WEATHER_STATUS_THRESHOLDS.showerWetFractionMaximum ||
      longestWetRun <= DAILY_WEATHER_STATUS_THRESHOLDS.showerWetRunMaximum)
  ) {
    precipitation = 'showers';
  } else if (
    precipTotal < DAILY_WEATHER_STATUS_THRESHOLDS.lightRainTotalMm &&
    maxHourlyPrecip < DAILY_WEATHER_STATUS_THRESHOLDS.lightRainHourlyMaximumMm
  ) {
    precipitation = 'light_rain';
  } else if (
    maxHourlyPrecip >= DAILY_WEATHER_STATUS_THRESHOLDS.heavyRainHourlyMinimumMm ||
    precipTotal >= DAILY_WEATHER_STATUS_THRESHOLDS.heavyRainTotalMinimumMm
  ) {
    precipitation = 'heavy_rain';
  } else {
    precipitation = 'rain';
  }

  let visibility: Visibility;
  if (
    fogFraction >= DAILY_WEATHER_STATUS_THRESHOLDS.fogFractionMinimum ||
    longestFogRun >= DAILY_WEATHER_STATUS_THRESHOLDS.fogRunMinimum ||
    medianVisibility < DAILY_WEATHER_STATUS_THRESHOLDS.fogMedianVisibilityMeters
  ) {
    visibility = 'fog';
  } else if (
    medianVisibility < DAILY_WEATHER_STATUS_THRESHOLDS.poorMedianVisibilityMeters ||
    fractionBelow5km >= DAILY_WEATHER_STATUS_THRESHOLDS.poorFractionBelow5kmMinimum
  ) {
    visibility = 'poor';
  } else if (
    hazeMedianVisibility < DAILY_WEATHER_STATUS_THRESHOLDS.hazeMedianVisibilityMeters ||
    hazeFraction >= DAILY_WEATHER_STATUS_THRESHOLDS.hazeFractionMinimum
  ) {
    visibility = 'haze';
  } else {
    visibility = 'normal';
  }

  const baseLabel = precipitationLabel(precipitation, sky);
  const label =
    visibility === 'fog'
      ? precipitation === 'none'
        ? 'Fog'
        : `${baseLabel} · Fog`
      : visibility === 'poor'
        ? `${baseLabel} · Poor visibility`
        : visibility === 'haze'
          ? `${baseLabel} · Haze`
          : baseLabel;

  return {
    sky,
    precipitation,
    visibility,
    label,
    icon: {
      sky,
      phenomenon: precipitation === 'none' ? null : precipitation,
      visibility: visibility === 'normal' ? null : visibility,
    },
    debug: {
      daylightHours,
      wetHours,
      wetFraction,
      precipTotal,
      maxHourlyPrecip,
      rainTotal,
      showersTotal,
      snowfallTotal,
      longestWetRun,
      longestFogRun,
      fogFraction,
      hazeFraction,
      medianVisibility,
      hazeMedianVisibility,
      minVisibility,
      fractionBelow10km,
      fractionBelow5km,
      fractionBelow1km,
      meanCloudCover,
      showerRatio,
      mixedHours,
      snowTypeHours,
      freezingHours,
    },
  };
}
