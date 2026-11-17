import { createStore } from 'zustand/vanilla';

import {
  defaultShadeLighting,
  shadeNeutralBrightness,
  terrainShadeExposure,
  terrainShadeShadowStrength,
  terrainShadeHighlightRolloff,
} from '@/infrastructure/terrainShadow/terrainShadowShaders';
import { mapVisualPalette } from '@/presentation/map/mapVisualPalette';
import {
  defaultSunShadowAtmosphere,
  type SunShadowAtmosphere,
} from '@/presentation/map/terrainOverlayStyle';
import {
  parseShadowColor,
  type TerrainShadowShading,
} from '@/presentation/map/TerrainShadowTileProvider';

/*
 * Temporary developer tuning of the sun-shadow lighting. Everything the lighting tuning
 * panel needs lives here and in `TerrainLightingTuningPanel`; the renderer, tile provider,
 * and sky take plain values, so removing both files and the layer controller's
 * subscription leaves the defaults below as the only lighting.
 */

export type TerrainLightingSection =
  'light' | 'ambient' | 'mountain' | 'colors' | 'sky';

/**
 * How a parameter reaches the map: `layer` is a MapLibre paint property and `sky` the
 * style sky, both immediate; `color` recolors cached direct/sky masks using source-color
 * coefficients in the worker; `gpu` recomputes masks from cached terrain geometry.
 */
export type TerrainLightingApply = 'layer' | 'sky' | 'color' | 'gpu';

interface NumberParameter {
  readonly kind: 'number';
  readonly section: TerrainLightingSection;
  readonly apply: TerrainLightingApply;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
}

interface ColorParameter {
  readonly kind: 'color';
  readonly section: TerrainLightingSection;
  readonly apply: TerrainLightingApply;
  /** `#RRGGBB`. */
  readonly defaultValue: string;
}

const palette = mapVisualPalette.terrain;
const sky = defaultSunShadowAtmosphere;

function unit(
  section: TerrainLightingSection,
  apply: TerrainLightingApply,
  defaultValue: number,
): NumberParameter {
  return { kind: 'number', section, apply, min: 0, max: 1, step: 0.01, defaultValue };
}

function color(
  section: TerrainLightingSection,
  apply: TerrainLightingApply,
  defaultValue: string,
): ColorParameter {
  return { kind: 'color', section, apply, defaultValue };
}

/**
 * Every tunable parameter in panel order. Names are the project constants they come from
 * (dotted paths for nested palette and sky values), so a copied configuration maps back
 * onto the defaults directly.
 */
export const terrainLightingParameters = {
  sunShadowOpacity: unit('light', 'layer', palette.sunShadowOpacity),
  sunHighlightOpacity: unit('light', 'color', palette.sunHighlightOpacity),
  shadeNeutralBrightness: {
    kind: 'number',
    section: 'light',
    apply: 'color',
    min: 0.8,
    max: 1.8,
    step: 0.01,
    defaultValue: shadeNeutralBrightness,
  },
  terrainShadeExposure: {
    kind: 'number',
    section: 'light',
    apply: 'color',
    min: -2,
    max: 2,
    step: 0.05,
    defaultValue: terrainShadeExposure,
  },
  terrainShadeShadowStrength: {
    kind: 'number',
    section: 'light',
    apply: 'color',
    min: 0,
    max: 4,
    step: 0.05,
    defaultValue: terrainShadeShadowStrength,
  },
  terrainShadeHighlightRolloff: {
    kind: 'number',
    section: 'light',
    apply: 'color',
    min: 0.05,
    max: 4,
    step: 0.05,
    defaultValue: terrainShadeHighlightRolloff,
  },
  terrainShadeSkyLightShare: {
    kind: 'number',
    section: 'light',
    apply: 'gpu',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: defaultShadeLighting.skyLightShare,
  },
  skyOcclusionStrength: {
    kind: 'number',
    section: 'ambient',
    apply: 'gpu',
    min: 0,
    max: 3,
    step: 0.05,
    defaultValue: defaultShadeLighting.skyOcclusionStrength,
  },
  terrainShadeNightSkyLight: unit('ambient', 'gpu', defaultShadeLighting.nightSkyLight),
  terrainShadeNightTopLight: {
    kind: 'number',
    section: 'ambient',
    apply: 'gpu',
    min: 0,
    max: 2,
    step: 0.01,
    defaultValue: defaultShadeLighting.nightTopLight,
  },
  terrainShadeNightTopLightFocus: {
    kind: 'number',
    section: 'ambient',
    apply: 'gpu',
    min: 0.5,
    max: 8,
    step: 0.05,
    defaultValue: defaultShadeLighting.nightTopLightFocus,
  },
  terrainShadeDiffuseSkyFraction: unit(
    'ambient',
    'gpu',
    defaultShadeLighting.diffuseSkyFraction,
  ),
  sunAlpenglowOpacity: unit('mountain', 'color', palette.sunAlpenglowOpacity),
  terrainShadowSoftEdgeSigmaPixels: {
    kind: 'number',
    section: 'mountain',
    apply: 'gpu',
    min: 0,
    max: 3,
    step: 0.05,
    defaultValue: defaultShadeLighting.softEdgeSigmaPixels,
  },
  sunShadow: color('colors', 'color', palette.sunShadow),
  sunHighlight: color('colors', 'color', palette.sunHighlight),
  sunGoldenShadow: color('colors', 'color', palette.sunGoldenShadow),
  sunLowShadow: color('colors', 'color', palette.sunLowShadow),
  sunAlpenglow: color('colors', 'color', palette.sunAlpenglow),
  'sunSky.day.sky': color('sky', 'sky', sky.day.sky),
  'sunSky.day.horizon': color('sky', 'sky', sky.day.horizon),
  'sunSky.day.fog': color('sky', 'sky', sky.day.fog),
  'sunSky.twilight.sky': color('sky', 'sky', sky.twilight.sky),
  'sunSky.twilight.horizon': color('sky', 'sky', sky.twilight.horizon),
  'sunSky.twilight.fog': color('sky', 'sky', sky.twilight.fog),
  'sunSky.night.sky': color('sky', 'sky', sky.night.sky),
  'sunSky.night.horizon': color('sky', 'sky', sky.night.horizon),
  'sunSky.night.fog': color('sky', 'sky', sky.night.fog),
  'sunSky.antisolarHorizon': color('sky', 'sky', sky.antisolarHorizon),
  'skyGlowStrength.horizon': unit('sky', 'sky', sky.glowStrength.horizon),
  'skyGlowStrength.fog': unit('sky', 'sky', sky.glowStrength.fog),
  'skyGlowStrength.awayHorizon': unit('sky', 'sky', sky.glowStrength.awayHorizon),
  'skyGlowStrength.awayFog': unit('sky', 'sky', sky.glowStrength.awayFog),
  skyAntisolarStrength: unit('sky', 'sky', sky.antisolarStrength),
  'skyBlends.fog-ground-blend': unit('sky', 'sky', sky.blends.fogGround),
  'skyBlends.horizon-fog-blend': unit('sky', 'sky', sky.blends.horizonFog),
  'skyBlends.sky-horizon-blend': unit('sky', 'sky', sky.blends.skyHorizon),
} as const satisfies Readonly<Record<string, NumberParameter | ColorParameter>>;

type Parameters = typeof terrainLightingParameters;
export type TerrainLightingKey = keyof Parameters;
export type TerrainLightingNumberKey = {
  [K in TerrainLightingKey]: Parameters[K]['kind'] extends 'number' ? K : never;
}[TerrainLightingKey];
export type TerrainLightingColorKey = Exclude<
  TerrainLightingKey,
  TerrainLightingNumberKey
>;

export type TerrainLightingTuning = Readonly<
  Record<TerrainLightingNumberKey, number> & Record<TerrainLightingColorKey, string>
>;

export const terrainLightingKeys = Object.keys(
  terrainLightingParameters,
) as readonly TerrainLightingKey[];

export const defaultTerrainLightingTuning = Object.fromEntries(
  terrainLightingKeys.map((key) => [key, terrainLightingParameters[key].defaultValue]),
) as TerrainLightingTuning;

export interface TerrainLightingTuningState {
  /** The tuned values; kept while `showDefaults` draws the defaults instead. */
  readonly values: TerrainLightingTuning;
  /** Before/After comparison: true draws `defaultTerrainLightingTuning`. */
  readonly showDefaults: boolean;
  readonly panelOpen: boolean;
}

/** localStorage key of the tuned values; the Before toggle and panel are session only. */
export const terrainLightingStorageKey = 'trail-planner.terrain-lighting-tuning';

const hexColorPattern = /^#[0-9a-f]{6}$/iu;

/** Stored values over the defaults; unknown keys and invalid values are ignored. */
export function parseStoredTerrainLightingTuning(
  stored: string | null,
): TerrainLightingTuning {
  let parsed: unknown;
  try {
    parsed = stored === null ? null : JSON.parse(stored);
  } catch {
    return defaultTerrainLightingTuning;
  }
  if (typeof parsed !== 'object' || parsed === null)
    return defaultTerrainLightingTuning;
  const record = parsed as Readonly<Record<string, unknown>>;
  const values: Record<string, number | string> = { ...defaultTerrainLightingTuning };
  for (const key of terrainLightingKeys) {
    const parameter: NumberParameter | ColorParameter = terrainLightingParameters[key];
    const value = record[key];
    if (parameter.kind === 'number') {
      if (
        typeof value === 'number' &&
        value >= parameter.min &&
        value <= parameter.max
      ) {
        values[key] = value;
      }
    } else if (typeof value === 'string' && hexColorPattern.test(value)) {
      values[key] = value;
    }
  }
  return values as TerrainLightingTuning;
}

function readStoredTuning(): TerrainLightingTuning {
  try {
    return parseStoredTerrainLightingTuning(
      localStorage.getItem(terrainLightingStorageKey),
    );
  } catch {
    return defaultTerrainLightingTuning;
  }
}

export const terrainLightingTuningStore = createStore<TerrainLightingTuningState>()(
  () => ({ values: readStoredTuning(), showDefaults: false, panelOpen: false }),
);

terrainLightingTuningStore.subscribe((state, previous) => {
  if (state.values === previous.values) return;
  try {
    localStorage.setItem(terrainLightingStorageKey, JSON.stringify(state.values));
  } catch {
    // Storage may be full or disabled; tuning still works for the session.
  }
});

/** Edits one value; editing while Before is shown returns to After. */
export function setTerrainLightingValue(
  key: TerrainLightingKey,
  value: number | string,
): void {
  const { values } = terrainLightingTuningStore.getState();
  terrainLightingTuningStore.setState({
    values: { ...values, [key]: value },
    showDefaults: false,
  });
}

/** Restores the defaults of one section, or of every section without one. */
export function resetTerrainLighting(section?: TerrainLightingSection): void {
  const { values } = terrainLightingTuningStore.getState();
  const next: Record<string, number | string> = { ...values };
  for (const key of terrainLightingKeys) {
    if (section === undefined || terrainLightingParameters[key].section === section) {
      next[key] = defaultTerrainLightingTuning[key];
    }
  }
  terrainLightingTuningStore.setState({
    values: next as TerrainLightingTuning,
    showDefaults: false,
  });
}

/** What the map draws: the defaults while Before is shown, otherwise the tuned values. */
export function effectiveTerrainLightingTuning(
  state: TerrainLightingTuningState,
): TerrainLightingTuning {
  return state.showDefaults ? defaultTerrainLightingTuning : state.values;
}

/** The copied configuration: every parameter name and its value. */
export function formatTerrainLightingTuning(values: TerrainLightingTuning): string {
  return JSON.stringify(values, null, 2);
}

/**
 * Shadow-tile shading of `tuning`, built in the field order of
 * `defaultTerrainShadowShading`, so the defaults map back to the provider's first variant.
 * `terrainShadeSkyLightShare` weights the direct and sky irradiance stored by the
 * shade pass, independently of their source-color coefficients.
 */
export function terrainShadowShadingFromTuning(
  tuning: TerrainLightingTuning,
): TerrainShadowShading {
  return {
    palette: {
      shadowColor: parseShadowColor(tuning.sunShadow),
      highlightColor: parseShadowColor(tuning.sunHighlight),
      highlightOpacity: tuning.sunHighlightOpacity,
      goldenShadowColor: parseShadowColor(tuning.sunGoldenShadow),
      lowSunShadowColor: parseShadowColor(tuning.sunLowShadow),
      alpenglowColor: parseShadowColor(tuning.sunAlpenglow),
      alpenglowOpacity: tuning.sunAlpenglowOpacity,
      neutralBrightness: tuning.shadeNeutralBrightness,
      exposure: tuning.terrainShadeExposure,
      shadowStrength: tuning.terrainShadeShadowStrength,
      highlightRolloff: tuning.terrainShadeHighlightRolloff,
    },
    lighting: {
      skyLightShare: tuning.terrainShadeSkyLightShare,
      skyOcclusionStrength: tuning.skyOcclusionStrength,
      nightSkyLight: tuning.terrainShadeNightSkyLight,
      nightTopLight: tuning.terrainShadeNightTopLight,
      nightTopLightFocus: tuning.terrainShadeNightTopLightFocus,
      diffuseSkyFraction: tuning.terrainShadeDiffuseSkyFraction,
      softEdgeSigmaPixels: tuning.terrainShadowSoftEdgeSigmaPixels,
    },
  };
}

export function sunShadowAtmosphereFromTuning(
  tuning: TerrainLightingTuning,
): SunShadowAtmosphere {
  return {
    day: {
      sky: tuning['sunSky.day.sky'],
      horizon: tuning['sunSky.day.horizon'],
      fog: tuning['sunSky.day.fog'],
    },
    twilight: {
      sky: tuning['sunSky.twilight.sky'],
      horizon: tuning['sunSky.twilight.horizon'],
      fog: tuning['sunSky.twilight.fog'],
    },
    night: {
      sky: tuning['sunSky.night.sky'],
      horizon: tuning['sunSky.night.horizon'],
      fog: tuning['sunSky.night.fog'],
    },
    antisolarHorizon: tuning['sunSky.antisolarHorizon'],
    glowStrength: {
      horizon: tuning['skyGlowStrength.horizon'],
      fog: tuning['skyGlowStrength.fog'],
      awayHorizon: tuning['skyGlowStrength.awayHorizon'],
      awayFog: tuning['skyGlowStrength.awayFog'],
    },
    antisolarStrength: tuning.skyAntisolarStrength,
    blends: {
      fogGround: tuning['skyBlends.fog-ground-blend'],
      horizonFog: tuning['skyBlends.horizon-fog-blend'],
      skyHorizon: tuning['skyBlends.sky-horizon-blend'],
    },
  };
}
