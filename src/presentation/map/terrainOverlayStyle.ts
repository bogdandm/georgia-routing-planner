import type {
  HillshadeLayerSpecification,
  LineLayerSpecification,
  RasterDEMSourceSpecification,
  RasterLayerSpecification,
  RasterSourceSpecification,
  SkySpecification,
  SymbolLayerSpecification,
  VectorSourceSpecification,
} from 'maplibre-gl';

import type { TerrainDemTileSize } from '@/application/ports/MapLayerPreferencesRepository';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import {
  directSunlightColor,
  relativeOpticalAirMass,
} from '@/domain/terrain/atmosphericSunlight';
import { terrainShadowNightElevationDegrees } from '@/infrastructure/terrainShadow/terrainShadowTiles';
import { mapSourceIds, terrainOverlayLayerIds } from '@/presentation/map/mapIds';
import {
  mapVisualModePaint,
  mapVisualPalette,
} from '@/presentation/map/mapVisualPalette';
import { parseShadowColor } from '@/presentation/map/TerrainShadowTileProvider';

// Contour vector tiles stop at the DEM's z12 and are overzoomed; line widths keep growing
// to this display zoom so close-up contours stay as legible as before.
const contourLineFullWidthZoom = 15;

/** Relief and isolines exactly as the main map draws them, read once for another map. */
export interface TerrainOverlaySnapshot {
  readonly demSource: RasterDEMSourceSpecification;
  readonly contourSource: VectorSourceSpecification;
  readonly contourMinZoom: number;
  readonly reliefVisible: boolean;
  readonly isolinesVisible: boolean;
}

/**
 * Builds the provider DEM source that MapLibre loads directly for 3D terrain and relief
 * shading, declared with the user's `TerrainDemTileSize` rather than the image size.
 * Elevation decoding reads the real image size either way.
 */
export function createTerrainDemSource(
  terrain: MapProviderConfiguration['terrain'],
  tileSize: TerrainDemTileSize,
): RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    tiles: [terrain.tileUrl],
    tileSize,
    minzoom: terrain.minZoom,
    maxzoom: terrain.maxZoom,
    encoding: terrain.encoding,
    attribution: terrain.attribution,
  };
}

/** Contour vector tiles served by the app-wide contour protocol at `tileUrl`. */
export function createTerrainContourSource(
  terrain: MapProviderConfiguration['terrain'],
  tileUrl: string,
): VectorSourceSpecification {
  return {
    type: 'vector',
    tiles: [tileUrl],
    minzoom: terrain.overlays.contourMinZoom,
    maxzoom: terrain.overlays.contourMaxZoom,
    attribution: terrain.attribution,
  };
}

/**
 * Cast-shadow raster for one sun instant at every zoom up to the DEM's; `tileUrl` comes
 * from the shadow tile provider. Tiles below `terrainShadowReliefMinZoom` shade flat
 * ground, so distant 3D terrain and low zooms are never left unshaded.
 */
export function createSunShadowSource(
  terrain: MapProviderConfiguration['terrain'],
  tileUrl: string,
): RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: [tileUrl],
    tileSize: 512,
    maxzoom: terrain.maxZoom,
    attribution: terrain.attribution,
  };
}

/** `opacity` is the layer's `raster-opacity`; the palette's `sunShadowOpacity` by default. */
export function createSunShadowLayer(opacity: number): RasterLayerSpecification {
  return {
    id: terrainOverlayLayerIds.sunShadow,
    type: 'raster',
    source: mapSourceIds.terrainSunShadow,
    paint: {
      'raster-opacity': opacity,
      'raster-fade-duration': 0,
      'raster-resampling': 'linear',
    },
  };
}

type SkyRgb = readonly [red: number, green: number, blue: number];

interface SkyTone {
  readonly sky: string;
  readonly horizon: string;
  readonly fog: string;
}

function parseSkyTone(tone: SkyTone): Record<keyof SkyTone, SkyRgb> {
  return {
    sky: parseShadowColor(tone.sky),
    horizon: parseShadowColor(tone.horizon),
    fog: parseShadowColor(tone.fog),
  };
}

/** The day sky turns into the twilight blue as the Sun sinks through this range. */
const skyDayDegrees = { full: 10, end: -1 };
/** The sunlight-colored horizon glow fades in below `fadeIn` and out below `fadeOut`. */
const skyGlowDegrees = { fadeIn: 14, full: 1, fadeOut: -4 };
/**
 * The rose antisolar band rises from 6° above the horizon, is strongest from just before
 * sunset to 2° below it, and sinks into the Earth's shadow by 5° below.
 */
const skyAntisolarDegrees = { fadeIn: 6, full: 1, fullEnd: -2, fadeOut: -5 };

/**
 * Colors and strengths of the 3D sky while sun shadows draw. The tones and the rose
 * `antisolarHorizon` are `mapVisualPalette.terrain.sunSky` `#RRGGBB` colors.
 */
export interface SunShadowAtmosphere {
  readonly day: SkyTone;
  readonly twilight: SkyTone;
  readonly night: SkyTone;
  readonly antisolarHorizon: string;
  /**
   * Share of the direct sunlight color in the horizon band and the haze at full glow when
   * looking at the Sun, and the part of it that remains when looking away: sunlit haze
   * still warms the far side a little, while the glow of the horizon belongs to the Sun's
   * side.
   */
  readonly glowStrength: {
    readonly horizon: number;
    readonly fog: number;
    readonly awayHorizon: number;
    readonly awayFog: number;
  };
  /** Share of `antisolarHorizon` in the horizon band when looking straight away from the Sun. */
  readonly antisolarStrength: number;
  /**
   * Fog starts at `fogGround` of the way to the far plane and turns toward the horizon
   * color over its last `1 − horizonFog`; the sky blends from the horizon color over
   * `skyHorizon` of the half screen above the horizon.
   */
  readonly blends: {
    readonly fogGround: number;
    readonly horizonFog: number;
    readonly skyHorizon: number;
  };
}

export const defaultSunShadowAtmosphere: SunShadowAtmosphere = {
  ...mapVisualPalette.terrain.sunSky,
  glowStrength: { horizon: 0.85, fog: 0.6, awayHorizon: 0.15, awayFog: 0.35 },
  antisolarStrength: 0.6,
  blends: { fogGround: 0.5, horizonFog: 0.8, skyHorizon: 0.8 },
};

/**
 * MapLibre keeps every sky property that a later `setSky` omits, so both specifications
 * below set all of them. The atmosphere only draws on the globe.
 */
const skyBlends = {
  'fog-ground-blend': defaultSunShadowAtmosphere.blends.fogGround,
  'horizon-fog-blend': defaultSunShadowAtmosphere.blends.horizonFog,
  'sky-horizon-blend': defaultSunShadowAtmosphere.blends.skyHorizon,
  'atmosphere-blend': 0,
} as const satisfies SkySpecification;

/** Transparent sky and no fog: what MapLibre draws for a style without `sky`. */
export const sunShadowSkyOff: SkySpecification = {
  'sky-color': 'transparent',
  'horizon-color': 'transparent',
  'fog-color': 'transparent',
  ...skyBlends,
  'fog-ground-blend': 1,
};

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function mixSkyRgb(from: SkyRgb, to: SkyRgb, weight: number): SkyRgb {
  return [
    from[0] + (to[0] - from[0]) * weight,
    from[1] + (to[1] - from[1]) * weight,
    from[2] + (to[2] - from[2]) * weight,
  ];
}

function skyColor(rgb: SkyRgb): string {
  return `rgb(${rgb.map((channel) => String(Math.round(channel))).join(', ')})`;
}

/**
 * 3D sky and distant haze for the Sun at `apparentElevationDegrees` seen from
 * `elevationMeters`, for a camera whose bearing is at `cosineToSun` (cosine of the angle
 * between the bearing and the Sun's azimuth: 1 facing the Sun, −1 facing away). MapLibre
 * draws one gradient for the whole screen, so the direction comes from the camera.
 *
 * The day palette turns into twilight blue as the Sun sinks from 10° to 1° below the
 * horizon and into night by the shadows' night elevation (end of civil twilight). From 14°
 * down to 4° below the horizon, strongest about 1° above it, the horizon band and the haze
 * take on the direct sunlight color of `directSunlightColor`, the same Rayleigh extinction
 * that tints the shadows; the glow follows the square of how much the camera faces the
 * Sun. Facing away near sunset, the horizon turns rose instead. `atmosphere` supplies the
 * colors, glow and antisolar strengths, and blends. Channels are rounded, so nearby
 * instants and bearings give an identical specification.
 */
export function createSunShadowSky(
  apparentElevationDegrees: number,
  elevationMeters: number,
  cosineToSun: number,
  atmosphere: SunShadowAtmosphere,
): SkySpecification {
  const { glowStrength, blends } = atmosphere;
  const tones = {
    day: parseSkyTone(atmosphere.day),
    twilight: parseSkyTone(atmosphere.twilight),
    night: parseSkyTone(atmosphere.night),
  };
  const elevation = apparentElevationDegrees;
  const twilight = smoothstep(
    terrainShadowNightElevationDegrees,
    skyDayDegrees.end,
    elevation,
  );
  const day = smoothstep(skyDayDegrees.end, skyDayDegrees.full, elevation);
  const glow =
    smoothstep(skyGlowDegrees.fadeOut, skyGlowDegrees.full, elevation) *
    (1 - smoothstep(skyGlowDegrees.full, skyGlowDegrees.fadeIn, elevation));
  const antisolar =
    smoothstep(skyAntisolarDegrees.fadeOut, skyAntisolarDegrees.fullEnd, elevation) *
    (1 - smoothstep(skyAntisolarDegrees.full, skyAntisolarDegrees.fadeIn, elevation));
  const towardSun = ((1 + cosineToSun) / 2) ** 2;
  const awayFromSun = ((1 - cosineToSun) / 2) ** 2;
  const [red, green, blue] = directSunlightColor(
    relativeOpticalAirMass(elevation, elevationMeters),
  );
  const sunlight: SkyRgb = [red * 255, green * 255, blue * 255];
  const tone = (part: keyof SkyTone) =>
    mixSkyRgb(
      mixSkyRgb(tones.night[part], tones.twilight[part], twilight),
      tones.day[part],
      day,
    );
  const horizonGlow =
    glow *
    (glowStrength.awayHorizon +
      (glowStrength.horizon - glowStrength.awayHorizon) * towardSun);
  const fogGlow =
    glow *
    (glowStrength.awayFog + (glowStrength.fog - glowStrength.awayFog) * towardSun);
  return {
    'sky-color': skyColor(tone('sky')),
    'horizon-color': skyColor(
      mixSkyRgb(
        mixSkyRgb(tone('horizon'), sunlight, horizonGlow),
        parseShadowColor(atmosphere.antisolarHorizon),
        atmosphere.antisolarStrength * antisolar * awayFromSun,
      ),
    ),
    'fog-color': skyColor(mixSkyRgb(tone('fog'), sunlight, fogGlow)),
    ...skyBlends,
    'fog-ground-blend': blends.fogGround,
    'horizon-fog-blend': blends.horizonFog,
    'sky-horizon-blend': blends.skyHorizon,
  };
}

function layoutVisibility(visible: boolean): 'visible' | 'none' {
  return visible ? 'visible' : 'none';
}

export function createReliefShadeLayer(visible: boolean): HillshadeLayerSpecification {
  return {
    id: terrainOverlayLayerIds.reliefShade,
    type: 'hillshade',
    source: mapSourceIds.terrainDem,
    layout: { visibility: layoutVisibility(visible) },
    paint: {
      ...mapVisualModePaint.vector[terrainOverlayLayerIds.reliefShade],
      'hillshade-shadow-color': mapVisualPalette.terrain.shadow,
      'hillshade-highlight-color': mapVisualPalette.terrain.highlight,
      'hillshade-accent-color': mapVisualPalette.terrain.accent,
      'hillshade-illumination-anchor': 'map',
    },
  };
}

/** Minor contours are level 0; index contours carry the labelled elevations. */
export function createContourLineLayer(
  kind: 'minor' | 'index',
  minzoom: number,
  visible: boolean,
): LineLayerSpecification {
  const minor = kind === 'minor';
  const id = minor
    ? terrainOverlayLayerIds.contourMinor
    : terrainOverlayLayerIds.contourIndex;
  return {
    id,
    type: 'line',
    source: mapSourceIds.terrainContours,
    'source-layer': 'contours',
    minzoom,
    filter: minor ? ['==', ['get', 'level'], 0] : ['>', ['get', 'level'], 0],
    layout: { visibility: layoutVisibility(visible) },
    paint: {
      'line-color': minor
        ? mapVisualPalette.terrain.contourMinor
        : mapVisualPalette.terrain.contourIndex,
      ...mapVisualModePaint.vector[id],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        minzoom,
        minor ? 0.42 : 0.72,
        contourLineFullWidthZoom,
        minor ? 0.72 : 1.15,
      ],
    },
  };
}

export function createContourLabelLayer(
  minzoom: number,
  visible: boolean,
): SymbolLayerSpecification {
  return {
    id: terrainOverlayLayerIds.contourLabels,
    type: 'symbol',
    source: mapSourceIds.terrainContours,
    'source-layer': 'contours',
    minzoom,
    filter: ['>', ['get', 'level'], 0],
    layout: {
      visibility: layoutVisibility(visible),
      'symbol-placement': 'line',
      'symbol-spacing': 360,
      'text-field': [
        'concat',
        ['number-format', ['get', 'ele'], { 'max-fraction-digits': 0 }],
        ' m',
      ],
      'text-font': ['Noto Sans Regular'],
      'text-size': 10,
    },
    paint: {
      'text-color': mapVisualPalette.terrain.contourLabel,
      ...mapVisualModePaint.vector[terrainOverlayLayerIds.contourLabels],
      'text-halo-width': 1.2,
    },
  };
}
