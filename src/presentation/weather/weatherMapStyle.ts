interface WeatherRgba {
  readonly 0: number;
  readonly 1: number;
  readonly 2: number;
  readonly 3: number;
}

interface WeatherBreakpointColorScale {
  readonly type: 'breakpoint';
  readonly unit: string;
  readonly breakpoints: number[];
  readonly colors: [number, number, number, number][];
}

export const weatherCloudCoverColorScale = {
  type: 'breakpoint',
  unit: '%',
  breakpoints: [0, 30, 31, 40, 50, 60, 70, 80, 90, 100],
  colors: [
    [66, 72, 78, 0],
    [66, 72, 78, 0],
    [224, 224, 224, 0.3],
    [210, 210, 210, 0.4],
    [196, 196, 196, 0.5],
    [182, 182, 182, 0.6],
    [168, 168, 168, 0.7],
    [154, 154, 154, 0.8],
    [140, 140, 140, 0.9],
    [128, 128, 128, 1],
  ],
} satisfies WeatherBreakpointColorScale;

export const weatherPrecipitationColorScale = {
  type: 'breakpoint',
  unit: 'mm',
  breakpoints: [0, 0.5, 1.5, 2, 3, 7, 10, 20, 30],
  colors: [
    [73, 124, 158, 0],
    [73, 124, 158, 0],
    [70, 131, 164, 0.55],
    [72, 145, 177, 0.62],
    [64, 160, 177, 0.7],
    [75, 177, 92, 0.8],
    [166, 190, 55, 0.86],
    [205, 92, 63, 0.94],
    [177, 54, 157, 1],
  ],
} satisfies WeatherBreakpointColorScale;

function rgbaCss(color: WeatherRgba): string {
  return `rgba(${String(color[0])}, ${String(color[1])}, ${String(color[2])}, ${String(color[3])})`;
}

export function weatherScaleGradient(scale: WeatherBreakpointColorScale): string {
  const minimum = scale.breakpoints[0] ?? 0;
  const maximum = scale.breakpoints.at(-1) ?? minimum;
  const range = maximum - minimum;
  const stops = scale.breakpoints.map((value, index) => {
    const color = scale.colors[index];
    if (color === undefined) throw new RangeError('Weather color scale is incomplete.');
    const position = range === 0 ? 0 : ((value - minimum) / range) * 100;
    return `${rgbaCss(color)} ${position.toFixed(2)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

interface WeatherLegendStop {
  readonly color: string;
  readonly value: number;
}

function legendStops(
  scale: WeatherBreakpointColorScale,
  indexes: readonly number[],
): readonly WeatherLegendStop[] {
  return indexes.map((index) => {
    const value = scale.breakpoints[index];
    const color = scale.colors[index];
    if (value === undefined || color === undefined) {
      throw new RangeError('Weather legend references an unavailable color stop.');
    }
    return { color: rgbaCss(color), value };
  });
}

export const weatherCloudLegendStops = legendStops(
  weatherCloudCoverColorScale,
  [0, 1, 2, 4, 6, 8, 9],
);
export const weatherPrecipitationLegendStops = legendStops(
  weatherPrecipitationColorScale,
  [1, 2, 3, 4, 5, 6, 7, 8],
);
