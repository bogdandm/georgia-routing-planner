export type Sky =
  'clear' | 'mostly_clear' | 'partly_cloudy' | 'mostly_cloudy' | 'overcast';

export type Precipitation =
  | 'none'
  | 'isolated_showers'
  | 'showers'
  | 'occasional_rain'
  | 'rain'
  | 'heavy_rain'
  | 'snow_showers'
  | 'occasional_snow'
  | 'snow'
  | 'mixed'
  | 'freezing';

export type Visibility = 'normal' | 'haze' | 'poor' | 'fog';

export type WeatherPeriodKind = 'current' | 'day' | 'night';

export type VisibilityPeriod =
  | 'none'
  | 'brief'
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'overnight'
  | 'intermittent'
  | 'most_of_period';

export interface WeatherIcon {
  readonly sky: Sky;
  readonly phenomenon: Exclude<Precipitation, 'none'> | null;
}

export interface VisibilityStatus {
  readonly level: Visibility;
  readonly period: VisibilityPeriod;
  readonly label: string | null;
  readonly icon: Exclude<Visibility, 'normal'> | null;
}

export interface WeatherPeriodHour {
  readonly time: string;
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

export interface VisibilityDurationDebug {
  readonly affectedHours: number;
  readonly affectedFraction: number;
  readonly longestAffectedRun: number;
  readonly firstAffectedHour: string | null;
  readonly lastAffectedHour: string | null;
}

export interface WeatherPeriodStatusDebug {
  readonly periodHours: number;
  readonly wetHours: number;
  readonly wetFraction: number;
  readonly precipTotal: number;
  readonly maxHourlyPrecip: number;
  readonly rainTotal: number;
  readonly showersTotal: number;
  readonly snowfallTotal: number;
  readonly longestWetRun: number;
  readonly clearFraction: number;
  readonly mostlyClearFraction: number;
  readonly partlyCloudyFraction: number;
  readonly mostlyCloudyFraction: number;
  readonly overcastFraction: number;
  readonly sunnyFraction: number;
  readonly cloudyFraction: number;
  readonly clearishFraction: number;
  readonly meanCloudCover: number;
  readonly showerRatio: number;
  readonly mixedHours: number;
  readonly snowTypeHours: number;
  readonly freezingHours: number;
  readonly visibility: Readonly<
    Record<Exclude<Visibility, 'normal'>, VisibilityDurationDebug>
  >;
}

export interface WeatherPeriodStatus {
  readonly primary: {
    readonly sky: Sky;
    readonly precipitation: Precipitation;
    readonly label: string;
    readonly icon: WeatherIcon;
  };
  readonly visibility: VisibilityStatus;
  readonly debug: WeatherPeriodStatusDebug;
}

export const WEATHER_PERIOD_STATUS_THRESHOLDS = {
  meaningfulWetMm: 0.1,
  traceTotalMm: 0.2,
  traceMaximumWetHours: 1,
  clearCloudCoverMaximum: 20,
  mostlyClearCloudCoverMaximum: 40,
  partlyCloudyCloudCoverMaximum: 65,
  mostlyCloudyCloudCoverMaximum: 85,
  clearFractionMinimum: 0.75,
  clearCloudyFractionMaximum: 0.15,
  mostlyClearSunnyFractionMinimum: 0.65,
  overcastFractionMinimum: 0.7,
  mostlyCloudyFractionMinimum: 0.65,
  ratioEpsilonMm: 0.000_001,
  mixedWetHourFraction: 0.25,
  snowDominanceWetHourFraction: 0.5,
  isolatedWetFractionMaximum: 0.2,
  isolatedWetRunMaximum: 1,
  intermittentWetFractionMaximum: 0.3,
  intermittentWetRunMaximum: 2,
  showerRatioMinimum: 0.4,
  showerWetFractionMaximum: 0.45,
  showerWetRunMaximum: 2,
  heavyRainHourlyMinimumMm: 4,
  heavyRainTotalMinimumMm: 12,
  fogVisibilityMeters: 1_000,
  poorVisibilityMeters: 5_000,
  hazeVisibilityMeters: 10_000,
  visibilitySignificantFractionMinimum: 0.25,
  visibilitySignificantRunMinimum: 2,
  visibilityMostOfPeriodFractionMinimum: 0.6,
  visibilitySegmentFractionMinimum: 2 / 3,
} as const;

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
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

function classifyHourlySky(cloudCover: number): Sky {
  if (cloudCover <= WEATHER_PERIOD_STATUS_THRESHOLDS.clearCloudCoverMaximum) {
    return 'clear';
  }
  if (cloudCover <= WEATHER_PERIOD_STATUS_THRESHOLDS.mostlyClearCloudCoverMaximum) {
    return 'mostly_clear';
  }
  if (cloudCover <= WEATHER_PERIOD_STATUS_THRESHOLDS.partlyCloudyCloudCoverMaximum) {
    return 'partly_cloudy';
  }
  if (cloudCover <= WEATHER_PERIOD_STATUS_THRESHOLDS.mostlyCloudyCloudCoverMaximum) {
    return 'mostly_cloudy';
  }
  return 'overcast';
}

interface SkyDistribution {
  readonly clearFraction: number;
  readonly mostlyClearFraction: number;
  readonly partlyCloudyFraction: number;
  readonly mostlyCloudyFraction: number;
  readonly overcastFraction: number;
  readonly sunnyFraction: number;
  readonly cloudyFraction: number;
  readonly clearishFraction: number;
}

function classifySky(hours: readonly WeatherPeriodHour[]): {
  readonly sky: Sky;
  readonly distribution: SkyDistribution;
} {
  const hourlySkies = hours.map((hour) => classifyHourlySky(hour.cloudCoverPercent));
  const fraction = (sky: Sky) =>
    hourlySkies.filter((hourlySky) => hourlySky === sky).length / hourlySkies.length;
  const clearFraction = fraction('clear');
  const mostlyClearFraction = fraction('mostly_clear');
  const partlyCloudyFraction = fraction('partly_cloudy');
  const mostlyCloudyFraction = fraction('mostly_cloudy');
  const overcastFraction = fraction('overcast');
  const sunnyFraction = clearFraction + mostlyClearFraction;
  const cloudyFraction = mostlyCloudyFraction + overcastFraction;
  const clearishFraction =
    clearFraction + mostlyClearFraction + partlyCloudyFraction * 0.5;

  let sky: Sky;
  if (
    clearFraction >= WEATHER_PERIOD_STATUS_THRESHOLDS.clearFractionMinimum &&
    cloudyFraction <= WEATHER_PERIOD_STATUS_THRESHOLDS.clearCloudyFractionMaximum
  ) {
    sky = 'clear';
  } else if (
    sunnyFraction >= WEATHER_PERIOD_STATUS_THRESHOLDS.mostlyClearSunnyFractionMinimum
  ) {
    sky = 'mostly_clear';
  } else if (
    overcastFraction >= WEATHER_PERIOD_STATUS_THRESHOLDS.overcastFractionMinimum
  ) {
    sky = 'overcast';
  } else if (
    cloudyFraction >= WEATHER_PERIOD_STATUS_THRESHOLDS.mostlyCloudyFractionMinimum
  ) {
    sky = 'mostly_cloudy';
  } else {
    sky = 'partly_cloudy';
  }

  return {
    sky,
    distribution: {
      clearFraction,
      mostlyClearFraction,
      partlyCloudyFraction,
      mostlyCloudyFraction,
      overcastFraction,
      sunnyFraction,
      cloudyFraction,
      clearishFraction,
    },
  };
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
    case 'isolated_showers':
      return `${skyLabels[sky]} with isolated showers`;
    case 'showers':
      return `${skyLabels[sky]} with showers`;
    case 'occasional_rain':
      return `${sky === 'clear' ? skyLabels.mostly_clear : skyLabels[sky]} with occasional rain`;
    case 'rain':
      return sky === 'clear' || sky === 'mostly_clear' || sky === 'partly_cloudy'
        ? 'Rain with sunny intervals'
        : 'Rain';
    case 'heavy_rain':
      return 'Heavy rain';
    case 'snow_showers':
      return 'Snow showers';
    case 'occasional_snow':
      return 'Occasional snow';
    case 'snow':
      return 'Snow';
    case 'mixed':
      return 'Rain and snow';
    case 'freezing':
      return 'Freezing precipitation';
  }
}

function classifyPrecipitation(input: {
  readonly precipTotal: number;
  readonly maxHourlyPrecip: number;
  readonly wetHours: number;
  readonly wetFraction: number;
  readonly longestWetRun: number;
  readonly showerRatio: number;
  readonly mixedHours: number;
  readonly rainTypeHours: number;
  readonly snowTypeHours: number;
  readonly freezingHours: number;
}): Precipitation {
  if (
    input.precipTotal < WEATHER_PERIOD_STATUS_THRESHOLDS.traceTotalMm &&
    input.wetHours <= WEATHER_PERIOD_STATUS_THRESHOLDS.traceMaximumWetHours
  ) {
    return 'none';
  }
  if (input.freezingHours > 0) return 'freezing';
  if (
    (input.wetHours > 0 &&
      input.mixedHours >=
        WEATHER_PERIOD_STATUS_THRESHOLDS.mixedWetHourFraction * input.wetHours) ||
    (input.rainTypeHours >=
      WEATHER_PERIOD_STATUS_THRESHOLDS.mixedWetHourFraction * input.wetHours &&
      input.snowTypeHours >=
        WEATHER_PERIOD_STATUS_THRESHOLDS.mixedWetHourFraction * input.wetHours)
  ) {
    return 'mixed';
  }
  if (
    input.wetHours > 0 &&
    input.snowTypeHours >=
      WEATHER_PERIOD_STATUS_THRESHOLDS.snowDominanceWetHourFraction * input.wetHours
  ) {
    if (
      input.wetFraction <=
        WEATHER_PERIOD_STATUS_THRESHOLDS.isolatedWetFractionMaximum &&
      input.longestWetRun <= WEATHER_PERIOD_STATUS_THRESHOLDS.isolatedWetRunMaximum
    ) {
      return 'snow_showers';
    }
    if (
      input.wetFraction <=
        WEATHER_PERIOD_STATUS_THRESHOLDS.intermittentWetFractionMaximum &&
      input.longestWetRun <= WEATHER_PERIOD_STATUS_THRESHOLDS.intermittentWetRunMaximum
    ) {
      return 'occasional_snow';
    }
    return 'snow';
  }
  if (
    input.showerRatio >= WEATHER_PERIOD_STATUS_THRESHOLDS.showerRatioMinimum &&
    input.wetFraction <= WEATHER_PERIOD_STATUS_THRESHOLDS.isolatedWetFractionMaximum &&
    input.longestWetRun <= WEATHER_PERIOD_STATUS_THRESHOLDS.isolatedWetRunMaximum
  ) {
    return 'isolated_showers';
  }
  if (
    input.showerRatio >= WEATHER_PERIOD_STATUS_THRESHOLDS.showerRatioMinimum &&
    (input.wetFraction <= WEATHER_PERIOD_STATUS_THRESHOLDS.showerWetFractionMaximum ||
      input.longestWetRun <= WEATHER_PERIOD_STATUS_THRESHOLDS.showerWetRunMaximum)
  ) {
    return 'showers';
  }
  if (
    input.wetFraction <=
      WEATHER_PERIOD_STATUS_THRESHOLDS.intermittentWetFractionMaximum &&
    input.longestWetRun <= WEATHER_PERIOD_STATUS_THRESHOLDS.intermittentWetRunMaximum
  ) {
    return 'occasional_rain';
  }
  if (
    input.maxHourlyPrecip >=
      WEATHER_PERIOD_STATUS_THRESHOLDS.heavyRainHourlyMinimumMm ||
    input.precipTotal >= WEATHER_PERIOD_STATUS_THRESHOLDS.heavyRainTotalMinimumMm
  ) {
    return 'heavy_rain';
  }
  return 'rain';
}

function classifyHourlyVisibility(hour: WeatherPeriodHour): Visibility {
  if (
    hour.visibilityMeters < WEATHER_PERIOD_STATUS_THRESHOLDS.fogVisibilityMeters ||
    hour.weatherCode === 45 ||
    hour.weatherCode === 48
  ) {
    return 'fog';
  }
  if (hour.visibilityMeters < WEATHER_PERIOD_STATUS_THRESHOLDS.poorVisibilityMeters) {
    return 'poor';
  }
  if (hour.visibilityMeters < WEATHER_PERIOD_STATUS_THRESHOLDS.hazeVisibilityMeters) {
    return 'haze';
  }
  return 'normal';
}

interface VisibilityAnalysis {
  readonly debug: VisibilityDurationDebug;
  readonly affectedIndices: readonly number[];
  readonly affectedRuns: number;
}

function analyzeVisibility(
  hours: readonly WeatherPeriodHour[],
  hourlyVisibility: readonly Visibility[],
  level: Exclude<Visibility, 'normal'>,
): VisibilityAnalysis {
  const affectedIndices: number[] = [];
  let affectedRuns = 0;
  let inRun = false;

  hourlyVisibility.forEach((hourlyLevel, index) => {
    if (hourlyLevel === level) {
      affectedIndices.push(index);
      if (!inRun) affectedRuns += 1;
      inRun = true;
    } else {
      inRun = false;
    }
  });
  const firstAffectedIndex = affectedIndices[0];
  const lastAffectedIndex = affectedIndices.at(-1);

  return {
    debug: {
      affectedHours: affectedIndices.length,
      affectedFraction: affectedIndices.length / hourlyVisibility.length,
      longestAffectedRun: longestRun(hourlyVisibility, (value) => value === level),
      firstAffectedHour:
        firstAffectedIndex === undefined
          ? null
          : (hours[firstAffectedIndex]?.time ?? null),
      lastAffectedHour:
        lastAffectedIndex === undefined
          ? null
          : (hours[lastAffectedIndex]?.time ?? null),
    },
    affectedIndices,
    affectedRuns,
  };
}

function isSignificantVisibility(analysis: VisibilityAnalysis): boolean {
  return (
    analysis.debug.affectedFraction >=
      WEATHER_PERIOD_STATUS_THRESHOLDS.visibilitySignificantFractionMinimum ||
    analysis.debug.longestAffectedRun >=
      WEATHER_PERIOD_STATUS_THRESHOLDS.visibilitySignificantRunMinimum
  );
}

function classifyVisibilityPeriod(
  analysis: VisibilityAnalysis,
  periodHours: number,
  periodKind: WeatherPeriodKind,
): Exclude<VisibilityPeriod, 'none'> {
  if (
    analysis.debug.affectedFraction >=
    WEATHER_PERIOD_STATUS_THRESHOLDS.visibilityMostOfPeriodFractionMinimum
  ) {
    return 'most_of_period';
  }
  if (analysis.affectedRuns > 1) return 'intermittent';

  const segmentCounts = [0, 0, 0];
  for (const index of analysis.affectedIndices) {
    const segment = Math.min(2, Math.floor((index * 3) / periodHours));
    segmentCounts[segment] = (segmentCounts[segment] ?? 0) + 1;
  }
  const dominantCount = Math.max(...segmentCounts);
  if (
    periodKind === 'current' ||
    dominantCount / analysis.debug.affectedHours <
      WEATHER_PERIOD_STATUS_THRESHOLDS.visibilitySegmentFractionMinimum
  ) {
    return 'brief';
  }

  const dominantSegment = segmentCounts.indexOf(dominantCount);
  if (periodKind === 'night') {
    if (dominantSegment === 0) return 'evening';
    if (dominantSegment === 1) return 'overnight';
    return 'morning';
  }
  if (dominantSegment === 0) return 'morning';
  if (dominantSegment === 1) return 'afternoon';
  return 'evening';
}

function visibilityLabel(
  level: Exclude<Visibility, 'normal'>,
  period: Exclude<VisibilityPeriod, 'none'>,
  periodKind: WeatherPeriodKind,
): string {
  if (level === 'fog') {
    switch (period) {
      case 'brief':
        return 'Brief fog';
      case 'morning':
        return 'Morning fog';
      case 'afternoon':
        return 'Afternoon fog';
      case 'evening':
        return 'Evening fog';
      case 'overnight':
        return 'Fog overnight';
      case 'intermittent':
        return 'Intermittent fog';
      case 'most_of_period':
        return `Fog for most of ${periodKind === 'current' ? 'the interval' : `the ${periodKind}`}`;
    }
  }

  const description = level === 'poor' ? 'Poor visibility' : 'Reduced visibility';
  switch (period) {
    case 'brief':
      return `Brief ${description.toLocaleLowerCase('en')}`;
    case 'morning':
      return `${description} in the morning`;
    case 'afternoon':
      return `${description} in the afternoon`;
    case 'evening':
      return `${description} in the evening`;
    case 'overnight':
      return `${description} overnight`;
    case 'intermittent':
      return 'Intermittent reduced visibility';
    case 'most_of_period':
      return `${description} for most of ${periodKind === 'current' ? 'the interval' : `the ${periodKind}`}`;
  }
}

function classifyVisibility(
  hours: readonly WeatherPeriodHour[],
  periodKind: WeatherPeriodKind,
): {
  readonly status: VisibilityStatus;
  readonly debug: Readonly<
    Record<Exclude<Visibility, 'normal'>, VisibilityDurationDebug>
  >;
} {
  const hourlyVisibility = hours.map(classifyHourlyVisibility);
  const analyses = {
    fog: analyzeVisibility(hours, hourlyVisibility, 'fog'),
    poor: analyzeVisibility(hours, hourlyVisibility, 'poor'),
    haze: analyzeVisibility(hours, hourlyVisibility, 'haze'),
  } as const;
  const level = (['fog', 'poor', 'haze'] as const).find((candidate) =>
    isSignificantVisibility(analyses[candidate]),
  );

  let status: VisibilityStatus = {
    level: 'normal',
    period: 'none',
    label: null,
    icon: null,
  };
  if (level !== undefined) {
    const period = classifyVisibilityPeriod(analyses[level], hours.length, periodKind);
    status = {
      level,
      period,
      label: visibilityLabel(level, period, periodKind),
      icon: level,
    };
  }

  return {
    status,
    debug: {
      fog: analyses.fog.debug,
      poor: analyses.poor.debug,
      haze: analyses.haze.debug,
    },
  };
}

export function aggregateWeatherPeriodStatus(
  orderedPeriodHours: readonly WeatherPeriodHour[],
  periodKind: WeatherPeriodKind = 'day',
): WeatherPeriodStatus {
  if (orderedPeriodHours.length === 0) {
    throw new RangeError('Weather period status requires at least one hourly sample.');
  }

  const isWet = (hour: WeatherPeriodHour) =>
    hour.precipitationMm >= WEATHER_PERIOD_STATUS_THRESHOLDS.meaningfulWetMm;
  const wet = orderedPeriodHours.filter(isWet);
  const dry = orderedPeriodHours.filter((hour) => !isWet(hour));
  const skyHours = dry.length > 0 ? dry : orderedPeriodHours;
  const periodHours = orderedPeriodHours.length;
  const wetHours = wet.length;
  const wetFraction = wetHours / periodHours;
  const precipTotal = orderedPeriodHours.reduce(
    (total, hour) => total + hour.precipitationMm,
    0,
  );
  const maxHourlyPrecip = Math.max(
    ...orderedPeriodHours.map((hour) => hour.precipitationMm),
  );
  const rainTotal = orderedPeriodHours.reduce((total, hour) => total + hour.rainMm, 0);
  const showersTotal = orderedPeriodHours.reduce(
    (total, hour) => total + hour.showersMm,
    0,
  );
  const snowfallTotal = orderedPeriodHours.reduce(
    (total, hour) => total + hour.snowfallCm,
    0,
  );
  const longestWetRun = longestRun(orderedPeriodHours, isWet);
  const showerRatio =
    showersTotal /
    Math.max(precipTotal, WEATHER_PERIOD_STATUS_THRESHOLDS.ratioEpsilonMm);
  const mixedHours = wet.filter(
    (hour) => hour.precipitationType === 6 || hour.precipitationType === 7,
  ).length;
  const rainTypeHours = wet.filter((hour) => hour.precipitationType === 1).length;
  const snowTypeHours = wet.filter(
    (hour) => hour.precipitationType === 5 || hour.precipitationType === 6,
  ).length;
  const freezingHours = wet.filter(
    (hour) =>
      hour.precipitationType === 3 ||
      hour.precipitationType === 8 ||
      hour.precipitationType === 12,
  ).length;
  const skyResult = classifySky(skyHours);
  const precipitation = classifyPrecipitation({
    precipTotal,
    maxHourlyPrecip,
    wetHours,
    wetFraction,
    longestWetRun,
    showerRatio,
    mixedHours,
    rainTypeHours,
    snowTypeHours,
    freezingHours,
  });
  const visibility = classifyVisibility(orderedPeriodHours, periodKind);
  const label = precipitationLabel(precipitation, skyResult.sky);

  return {
    primary: {
      sky: skyResult.sky,
      precipitation,
      label,
      icon: {
        sky: skyResult.sky,
        phenomenon: precipitation === 'none' ? null : precipitation,
      },
    },
    visibility: visibility.status,
    debug: {
      periodHours,
      wetHours,
      wetFraction,
      precipTotal,
      maxHourlyPrecip,
      rainTotal,
      showersTotal,
      snowfallTotal,
      longestWetRun,
      ...skyResult.distribution,
      meanCloudCover: mean(skyHours.map((hour) => hour.cloudCoverPercent)),
      showerRatio,
      mixedHours,
      snowTypeHours,
      freezingHours,
      visibility: visibility.debug,
    },
  };
}
