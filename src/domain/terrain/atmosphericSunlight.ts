import { seaLevelHorizonDegrees } from '@/domain/terrain/terrainShadow';

/**
 * Clear-sky direct sunlight shared by this CPU model and the GPU shadow shader: Rayleigh
 * extinction only. Aerosols and ozone are ignored, so hazy evenings are redder than this.
 */
export const atmosphericSunlightModel = {
  /** Rayleigh scattering scale height of the standard atmosphere. */
  rayleighScaleHeightMeters: 8_000,
  /** Representative wavelengths of the sRGB red, green, and blue primaries. */
  wavelengthsMicrometers: [0.612, 0.549, 0.465],
} as const;

export type SunlightColor = readonly [red: number, green: number, blue: number];

const radiansPerDegree = Math.PI / 180;

/** Kasten & Young (1989) sea-level relative air mass for an apparent elevation ≥ 0°. */
export function kastenYoungAirMass(apparentElevationDegrees: number): number {
  return (
    1 /
    (Math.sin(apparentElevationDegrees * radiansPerDegree) +
      0.50572 * (apparentElevationDegrees + 6.07995) ** -1.6364)
  );
}

/** Sea-level air mass of a horizontal ray (about 38): the most `relativeOpticalAirMass` returns. */
export const horizonAirMass = kastenYoungAirMass(0);

/**
 * Optical air mass of the direct-sun path to a ground point, relative to the sea-level
 * zenith path (1). With the Sun above the observer's level the sea-level Kasten–Young air
 * mass scales with the pressure ratio exp(−h / H), so summits see whiter light than
 * valleys. Below that level the ray dips to the tangent height h·(1 − (tan δ / tan d)²),
 * where δ is the Sun's depression and d the sea-level horizon's; the summit's last light
 * then crosses the horizontal air mass at that height.
 */
export function relativeOpticalAirMass(
  apparentElevationDegrees: number,
  elevationMeters: number,
): number {
  const height = Math.max(elevationMeters, 0);
  const scaleHeight = atmosphericSunlightModel.rayleighScaleHeightMeters;
  if (apparentElevationDegrees >= 0) {
    return (
      kastenYoungAirMass(apparentElevationDegrees) * Math.exp(-height / scaleHeight)
    );
  }
  const horizonSlope = Math.tan(-seaLevelHorizonDegrees(height) * radiansPerDegree);
  if (horizonSlope === 0) return horizonAirMass;
  const ratio = Math.tan(-apparentElevationDegrees * radiansPerDegree) / horizonSlope;
  const tangentHeight = height * Math.max(0, 1 - ratio * ratio);
  return horizonAirMass * Math.exp(-tangentHeight / scaleHeight);
}

/** Hansen & Travis (1974) sea-level Rayleigh optical depth. */
function rayleighOpticalDepth(wavelengthMicrometers: number): number {
  const inverseSquare = wavelengthMicrometers ** -2;
  return (
    0.008569 *
    inverseSquare *
    inverseSquare *
    (1 + 0.0113 * inverseSquare + 0.00013 * inverseSquare * inverseSquare)
  );
}

const [redWavelength, greenWavelength, blueWavelength] =
  atmosphericSunlightModel.wavelengthsMicrometers;
const redDepth = rayleighOpticalDepth(redWavelength);
const greenDepth = rayleighOpticalDepth(greenWavelength);
const blueDepth = rayleighOpticalDepth(blueWavelength);

/**
 * Hue of direct sunlight after `airMass`, relative to the sea-level zenith Sun (white) and
 * scaled so the brightest channel is 1: white at noon, then yellow, orange, and red toward
 * the horizon. Brightness comes from the slope lighting, not from this color.
 */
export function directSunlightColor(airMass: number): SunlightColor {
  const extraAirMass = airMass - 1;
  const red = Math.exp(-redDepth * extraAirMass);
  const green = Math.exp(-greenDepth * extraAirMass);
  const blue = Math.exp(-blueDepth * extraAirMass);
  const brightest = Math.max(red, green, blue);
  return [red / brightest, green / brightest, blue / brightest];
}
