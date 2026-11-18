import {
  directSunlightColor,
  relativeOpticalAirMass,
} from '@/domain/terrain/atmosphericSunlight';
import type { TrackLightingSample } from '@/domain/tracks/trackLighting';
import {
  terrainShadeFlatReferenceElevationDegrees,
  terrainShadeSkyLightShare,
} from '@/infrastructure/terrainShadow/terrainShadowShaders';
import { mapVisualPalette } from '@/presentation/map/mapVisualPalette';
import { appColors } from '@/presentation/theme/appColors';

type Rgb = readonly [number, number, number];

function srgbToLinear(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (byte: number) => {
    const unit = byte / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return [
    channel((value >> 16) & 255),
    channel((value >> 8) & 255),
    channel(value & 255),
  ];
}

function luminance(color: Rgb): number {
  return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
}

/** `color`'s hue at `reference`'s luminance. */
function atLuminance(color: Rgb, reference: Rgb): Rgb {
  const scale = luminance(reference) / Math.max(luminance(color), 1e-6);
  return [color[0] * scale, color[1] * scale, color[2] * scale];
}

function mix(from: Rgb, to: Rgb, weight: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * weight,
    from[1] + (to[1] - from[1]) * weight,
    from[2] + (to[2] - from[2]) * weight,
  ];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

const sun = srgbToLinear(appColors.trackLight.sun);
const daySky = srgbToLinear(appColors.trackLight.shade);
// Halfway to the map's lilac low-Sun sky hue, at the strip's day-sky luminance.
const goldenSky = mix(
  daySky,
  atLuminance(srgbToLinear(mapVisualPalette.terrain.sunGoldenShadow), daySky),
  0.5,
);
const twilightSky = srgbToLinear(appColors.trackLight.twilight);
const dark = srgbToLinear(appColors.trackLight.dark);
const radiansPerDegree = Math.PI / 180;
const flatReferenceSine = Math.sin(
  terrainShadeFlatReferenceElevationDegrees * radiansPerDegree,
);
/** Twilight sky light falls tenfold per this many degrees of solar depression. */
const twilightDecayDegrees = 4;
/** Share of the high-Sun sky light that remains when the Sun reaches the horizon. */
const horizonSkyLight = 0.35;

/**
 * Strip color of a sample from the map's sun-shadow light model on flat ground. The
 * light's hue mixes the sky color with the sun color by the share of full direct light
 * (visible disk, dimmed below a 10° Sun like the map's flat reference), and the sun color
 * is reddened by the map's Rayleigh air mass, so the golden hour shows. Its brightness,
 * relative to open ground with the same direct light, falls with the station's open sky
 * (squared, so a gorge's shade reads darker than a boulder's) and as the Sun sinks. The
 * map keeps its sky light up to sunset, then a night sky light and an overhead light so
 * relief stays readable; real twilight is far darker, so here sky light falls tenfold
 * every 4° below the horizon onto the night color.
 */
export function trackLightColor(
  sample: Pick<
    TrackLightingSample,
    'sunlitFraction' | 'sunElevationDegrees' | 'skyView' | 'groundElevationMeters'
  >,
): string {
  const elevation = sample.sunElevationDegrees;
  const sine = Math.sin(elevation * radiansPerDegree);
  const directShare = 1 - terrainShadeSkyLightShare;
  // Sunlight sets the hue wherever the disk is visible; how low it stands only dims it.
  const directWeight =
    (sample.sunlitFraction * Math.max(sine, 0)) / Math.max(sine, flatReferenceSine);
  // The map keeps its sky light constant until sunset; real sky light weakens as the
  // Sun sinks (about a third remains at the horizon), then fades through twilight.
  const skyWeight =
    sample.skyView ** 2 *
    (horizonSkyLight + (1 - horizonSkyLight) * smoothstep(0, 20, elevation)) *
    (elevation >= 0 ? 1 : 10 ** (elevation / twilightDecayDegrees));

  const sunlight = directSunlightColor(
    relativeOpticalAirMass(elevation, sample.groundElevationMeters),
  );
  // As in the map, the sky turns golden as the Sun loses blue, then twilight blue.
  const lowSun = Math.max(0, 1 - sunlight[2] / sunlight[0]);
  const skyColor =
    elevation >= 0
      ? mix(daySky, goldenSky, lowSun)
      : mix(goldenSky, twilightSky, smoothstep(0, -2, elevation));
  const brightness =
    (directShare * directWeight + terrainShadeSkyLightShare * skyWeight) /
    (directShare * sample.sunlitFraction + terrainShadeSkyLightShare);
  const channels = [0, 1, 2].map((channel) => {
    const skyChannel = skyColor[channel] ?? 0;
    const sunChannel = (sun[channel] ?? 0) * (sunlight[channel] ?? 0);
    const lit =
      (skyChannel + (sunChannel - skyChannel) * sample.sunlitFraction) * brightness;
    // The night color is the floor light never falls below.
    const linear = Math.min(1, Math.max(dark[channel] ?? 0, lit));
    const encoded =
      linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
