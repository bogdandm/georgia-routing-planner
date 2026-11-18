import {
  atmosphericSunlightModel,
  directSunlightColor,
  horizonAirMass,
  kastenYoungAirMass,
} from '@/domain/terrain/atmosphericSunlight';
import { solarPositionAt, subsolarPoint } from '@/domain/terrain/solarPosition';
import {
  terrainShadowModel,
  terrainSkyViewModel,
  visibleSolarDiskFraction,
} from '@/domain/terrain/terrainShadow';
import {
  type TerrainShadowTileAddress,
  terrainShadowMosaicMarginTexels,
  terrainShadowMosaicSize,
  terrainShadowNightElevationDegrees,
  terrainShadowTileGeometry,
  terrainShadowTileSize,
} from '@/infrastructure/terrainShadow/terrainShadowTiles';

/** Each reduction pass folds an N×N block of texels into its maximum. */
export const maximumReductionFactor = 8;

function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${String(value)}.0` : String(value);
}

/** Single triangle covering the viewport; draw 3 vertices with an empty vertex array. */
export const fullscreenVertexShaderSource = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Terrarium RGB → meters: R·256 + G + B/256 − 32768 (exact in float32). */
export const terrariumDecodeFragmentShaderSource = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uEncoded;
layout(location = 0) out vec4 outElevation;
void main() {
  vec3 rgb = floor(texelFetch(uEncoded, ivec2(gl_FragCoord.xy), 0).rgb * 255.0 + 0.5);
  outElevation = vec4(rgb.r * 256.0 + rgb.g + rgb.b / 256.0 - 32768.0, 0.0, 0.0, 1.0);
}
`;

/** Writes the maximum of each factor×factor source block; `uTargetOrigin` offsets the viewport. */
export const maximumReductionFragmentShaderSource = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uSource;
uniform ivec2 uSourceSize;
uniform ivec2 uTargetOrigin;
layout(location = 0) out vec4 outMaximum;
const int factor = ${String(maximumReductionFactor)};
void main() {
  ivec2 start = (ivec2(gl_FragCoord.xy) - uTargetOrigin) * factor;
  float maximum = -3.0e38;
  for (int dy = 0; dy < factor; ++dy) {
    for (int dx = 0; dx < factor; ++dx) {
      ivec2 texel = start + ivec2(dx, dy);
      if (texel.x < uSourceSize.x && texel.y < uSourceSize.y) {
        maximum = max(maximum, texelFetch(uSource, texel, 0).r);
      }
    }
  }
  outMaximum = vec4(maximum, 0.0, 0.0, 1.0);
}
`;

/** Extra visibility texels around the tile so the soft-edge blur has full support. */
export const terrainShadowVisibilityMarginPixels = 2;
/** Side of the visibility texture: the 512 px tile plus the blur margin on both sides. */
export const terrainShadowVisibilitySize =
  terrainShadowTileSize + 2 * terrainShadowVisibilityMarginPixels;
/**
 * Sun elevation whose flat-ground brightness counts as full sun. Lower suns divide by
 * this floor instead of their own sine, so dawn and dusk darken flat ground gradually.
 * Sun-facing slopes may exceed 1; source energies stay linear and unclamped.
 */
export const terrainShadeFlatReferenceElevationDegrees = 10;
/** Gaussian σ of the cast-shadow soft edge, in output pixels. */
export const terrainShadowSoftEdgeSigmaPixels = 1.7;
/**
 * Share of flat ground's full-sun brightness that comes from the sky rather than the
 * direct Sun. The sky term keeps relief inside shadows; the twilight sky fades out
 * smoothly over civil twilight down to the night elevation, giving way to the faint
 * `terrainShadeNightSkyLight`.
 */
export const terrainShadeSkyLightShare = 0.45;
/**
 * The sky is brightest toward the Sun, so part of its light is a softly wrapped Lambert
 * light from the Sun's azimuth at this elevation, on slopes exaggerated by
 * `skyLightReliefExaggeration` so gentle relief still reads inside shadows.
 */
export const terrainShadeSkyLightElevationDegrees = 30;
const skyLightWrap = 0.2;
const skyLightReliefExaggeration = terrainSkyViewModel.reliefExaggeration;
/**
 * How strongly the terrain's occlusion of the sky dims the sky light: the shade pass uses
 * max(1 − strength · (1 − occlusion), 0), so above 1 gorges darken faster than the open
 * sky share alone would.
 */
const skyOcclusionStrength = 2.55;
/**
 * After sunset part of the sky light becomes diffuse, as from a thin cloud layer that
 * keeps scattering light: it depends only on how much sky a slope faces, not on the Sun's
 * azimuth, which softens the fade into night. While the Sun is up, the sun-side sky keeps
 * full contrast; the diffuse share grows to this fraction as the Sun crosses
 * ±`diffuseSkyTransitionDegrees` around the horizon.
 */
export const terrainShadeDiffuseSkyFraction = 0.52;
const diffuseSkyTransitionDegrees = 2;
/**
 * Share of the sky light that remains at night (airglow, starlight, and city glow seen as
 * one faint uniform sky). It replaces the twilight sky as that fades, lights a slope by
 * its diffuse visible sky only, and no longer depends on the Sun, so every night instant
 * of a tile shares one mask while gorges stay darker than ridges and open ground.
 */
export const terrainShadeNightSkyLight = 0.58;
/**
 * Light from overhead after the blue hour, so peaks and ridges stay readable at
 * night. Unlike the night sky it adds to the brightness directly, not through the sky-light
 * share, so it never changes daylight shading. It lights a slope by its (1.5×
 * exaggerated) zenith Lambert term times the terrain's sky occlusion raised to
 * `focus`: higher focus keeps it on open crests and out of valleys. It fades in from half
 * the night elevation (−3°) to the night elevation (−6°) and is constant below, so night
 * tiles still share one mask.
 */
export const terrainShadeNightTopLight = 0.25;
export const terrainShadeNightTopLightFocus = 3.9;

/** Shade-pass uniforms; changing colors or exposure reuses the separated source energies. */
export interface ShadeLighting {
  readonly skyLightShare: number;
  readonly skyOcclusionStrength: number;
  /** With `nightTopLight` 0, 0 lights night relief by nothing: the plain night mask. */
  readonly nightSkyLight: number;
  readonly nightTopLight: number;
  /** Exponent of the sky occlusion in the night top light; above 0. */
  readonly nightTopLightFocus: number;
  readonly diffuseSkyFraction: number;
  /** Truncated at `terrainShadowVisibilityMarginPixels`. */
  readonly softEdgeSigmaPixels: number;
}

export const defaultShadeLighting: ShadeLighting = {
  skyLightShare: terrainShadeSkyLightShare,
  skyOcclusionStrength,
  nightSkyLight: terrainShadeNightSkyLight,
  nightTopLight: terrainShadeNightTopLight,
  nightTopLightFocus: terrainShadeNightTopLightFocus,
  diffuseSkyFraction: terrainShadeDiffuseSkyFraction,
  softEdgeSigmaPixels: terrainShadowSoftEdgeSigmaPixels,
};

/**
 * The sunlight code says how low the Sun stands for a pixel, so the lookup table can tint
 * it. Codes 0…`sunlightAirMassMaximumCode` map the relative optical air mass from
 * `sunlightMinimumAirMass` to `horizonAirMass` logarithmically. Once the Sun is below the
 * pixel's sea-level horizon, the codes above step linearly down to
 * `terrainShadowNightElevationDegrees`, where `sunlightNightCode` means plain night shade;
 * night tiles therefore never meet a still-fading neighbor. Codes grow as the Sun sinks,
 * so interpolated codes stay continuous across both ranges.
 */
export const sunlightAirMassMaximumCode = 223;
export const sunlightNightCode = 255;
/** The unreddened zenith Sun: white direct light and the day sky, without any tint. */
export const sunlightNeutralCode = 0;
/** Below every reachable air mass: the zenith Sun over a summit near 5500 m. */
export const sunlightMinimumAirMass = 0.5;
/** Sunlight codes are kept for every 4th pixel in both directions and interpolated. */
export const sunlightGridStride = 4;
export const sunlightGridSize = terrainShadowTileSize / sunlightGridStride;
const tilePixels = terrainShadowTileSize * terrainShadowTileSize;
/** Linear relative irradiance, before source colors, exposure, or tone mapping. */
export interface ShadeMask {
  readonly direct: Float32Array;
  /** Diffuse sky plus the existing night overhead light. */
  readonly sky: Float32Array;
  readonly sunlight: Uint8Array;
}

/** Two float32 energies per pixel and the 128² optical-air-mass/twilight grid. */
export const shadeMaskBytes = tilePixels * 8 + sunlightGridSize * sunlightGridSize;

/**
 * GPU mirror of `horizonAngleTowardSun`, `seaLevelHorizonDegrees`, and
 * `visibleSolarDiskFraction` in `@/domain/terrain/terrainShadow` and `solarPositionAt` in
 * `@/domain/terrain/solarPosition`; function names match so a browser parity check can
 * compare them one-to-one.
 *
 * Mosaic texel coordinates grow east and south from the mosaic's north-west corner. Every
 * sample is placed relative to the observer (`observerTexels + offset · texelsPerRadian`).
 * The offset integrates the great circle step by step (midpoint rule) instead of
 * subtracting absolute `asin`/`atan` results: GPU inverse trigonometry is only accurate to
 * about 1e-5 rad, which would move near samples by several z12 texels.
 *
 * Output pixels are measured from the tile's north-west corner and both passes write
 * framebuffer row 0 as the northern edge, so `readPixels` rows match ImageData rows.
 */
const terrainShadowCommonShaderSource = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uMosaic0;
uniform sampler2D uMosaic1;
uniform sampler2D uMosaic2;
// Texel i holds the maximum elevation of level i.
uniform sampler2D uLevelMaximum;
uniform vec2 uLevelOrigin[3];
uniform float uLevelTexelsPerOutputPixel[3];
uniform float uLevelTexelsPerRadian[3];
// (west longitude, longitude span) and (north Mercator y, Mercator y span) in radians.
uniform vec2 uTileLongitude;
uniform vec2 uTileMercatorY;
// (declination, longitude) of the subsolar point in radians.
uniform vec2 uSubsolar;
// Finest DEM pixel ground size at the equator; scaled by cos(latitude) per observer.
uniform float uBaseResolutionEquatorMeters;

layout(location = 0) out vec4 outValue;

const float pi = 3.141592653589793;
const float earthRadiusMeters = ${glslFloat(terrainShadowModel.earthRadiusMeters)};
const float terrestrialRefractionCoefficient = ${glslFloat(terrainShadowModel.terrestrialRefractionCoefficient)};
const float solarDiskRadiusDegrees = ${glslFloat(terrainShadowModel.solarDiskRadiusDegrees)};
const float maximumShadowDistanceMeters = ${glslFloat(terrainShadowModel.maximumShadowDistanceMeters)};
const float angularStepRadians = ${glslFloat(terrainShadowModel.angularStepRadians)};
const float curvatureFactor = (1.0 - terrestrialRefractionCoefficient) / (2.0 * earthRadiusMeters);
const float tileSize = ${glslFloat(terrainShadowTileSize)};
const float mosaicLow = ${glslFloat(terrainShadowMosaicMarginTexels)};
const float mosaicHigh = ${glslFloat(terrainShadowMosaicSize - terrainShadowMosaicMarginTexels)};
// Safety bound only; the distance schedule ends long before it near the equator.
const int maximumSteps = 16384;

float atmosphericRefractionDegrees(float trueElevationDegrees) {
  float elevation = max(trueElevationDegrees, -1.0);
  return 1.02 / tan(radians(elevation + 10.3 / (elevation + 5.11))) / 60.0;
}

struct SolarPosition {
  float azimuthRadians;
  float apparentElevationDegrees;
};

SolarPosition solarPositionAt(float latitude, float longitude) {
  float hourAngle = longitude - uSubsolar.y;
  float sinDeclination = sin(uSubsolar.x);
  float cosDeclination = cos(uSubsolar.x);
  float sinLatitude = sin(latitude);
  float cosLatitude = cos(latitude);
  float cosHourAngle = cos(hourAngle);
  float sinElevation = sinLatitude * sinDeclination + cosLatitude * cosDeclination * cosHourAngle;
  float elevationDegrees = degrees(asin(clamp(sinElevation, -1.0, 1.0)));
  float azimuth = atan(
    -cosDeclination * sin(hourAngle),
    cosLatitude * sinDeclination - sinLatitude * cosDeclination * cosHourAngle
  );
  return SolarPosition(azimuth, elevationDegrees + atmosphericRefractionDegrees(elevationDegrees));
}

float curvatureDropMeters(float distanceMeters) {
  return distanceMeters * distanceMeters * curvatureFactor;
}

float visibleSolarDiskFraction(float apparentElevationDegrees, float horizonDegrees) {
  float u = clamp((apparentElevationDegrees - horizonDegrees) / solarDiskRadiusDegrees, -1.0, 1.0);
  return 0.5 + (u * sqrt(1.0 - u * u) + asin(u)) / pi;
}

float seaLevelHorizonDegrees(float elevationMeters) {
  return -degrees(atan(2.0 * sqrt(max(elevationMeters, 0.0) * curvatureFactor)));
}

float mosaicTexel(int level, ivec2 texel) {
  if (level == 0) return texelFetch(uMosaic0, texel, 0).r;
  if (level == 1) return texelFetch(uMosaic1, texel, 0).r;
  return texelFetch(uMosaic2, texel, 0).r;
}

// Manual bilinear filter: R32F textures are not filterable without an extension.
float mosaicElevation(int level, vec2 texels) {
  vec2 shifted = texels - 0.5;
  vec2 cell = floor(shifted);
  vec2 weight = shifted - cell;
  ivec2 base = ivec2(cell);
  float northWest = mosaicTexel(level, base);
  float northEast = mosaicTexel(level, base + ivec2(1, 0));
  float southWest = mosaicTexel(level, base + ivec2(0, 1));
  float southEast = mosaicTexel(level, base + ivec2(1, 1));
  return mix(mix(northWest, northEast, weight.x), mix(southWest, southEast, weight.x), weight.y);
}

bool mosaicContainsWithMargin(vec2 texels) {
  return all(greaterThanEqual(texels, vec2(mosaicLow))) && all(lessThanEqual(texels, vec2(mosaicHigh)));
}

float horizonAngleTowardSun(
  vec2 outputPixel,
  float latitude,
  float azimuthRadians,
  float apparentSunElevationDegrees,
  float observerElevation
) {
  vec2 observerTexels[3];
  for (int level = 0; level < 3; ++level) {
    observerTexels[level] = uLevelOrigin[level] + outputPixel * uLevelTexelsPerOutputPixel[level];
  }
  // Upper bound of every elevation still reachable once the march has left finer levels.
  float maximum2 = texelFetch(uLevelMaximum, ivec2(2, 0), 0).r;
  float maximum1 = max(texelFetch(uLevelMaximum, ivec2(1, 0), 0).r, maximum2);
  float maximum0 = max(texelFetch(uLevelMaximum, ivec2(0, 0), 0).r, maximum1);

  // Great-circle state relative to the observer: latitude, longitude, and Mercator y
  // offsets in radians, and the current heading.
  float latitudeOffset = 0.0;
  float longitudeOffset = 0.0;
  float mercatorOffset = 0.0;
  float heading = azimuthRadians;
  float travelledMeters = 0.0;
  float cosLatitude = cos(latitude);
  float baseStep = uBaseResolutionEquatorMeters * cosLatitude;
  float fullyHiddenDegrees = apparentSunElevationDegrees + solarDiskRadiusDegrees;
  float firstHidingDegrees = apparentSunElevationDegrees - solarDiskRadiusDegrees;

  float horizonDegrees = -90.0;
  int level = 0;
  float distanceMeters = baseStep;
  for (int stepIndex = 0; stepIndex < maximumSteps && distanceMeters <= maximumShadowDistanceMeters; ++stepIndex) {
    float reachableMaximum = level == 0 ? maximum0 : (level == 1 ? maximum1 : maximum2);
    float thresholdSlope = tan(radians(max(horizonDegrees, firstHidingDegrees)));
    if (
      distanceMeters * thresholdSlope + curvatureDropMeters(distanceMeters) > reachableMaximum - observerElevation &&
      thresholdSlope + 2.0 * curvatureFactor * distanceMeters >= 0.0
    ) {
      break;
    }

    float stepRadians = (distanceMeters - travelledMeters) / earthRadiusMeters;
    float currentLatitude = latitude + latitudeOffset;
    float middleLatitude = currentLatitude + 0.5 * stepRadians * cos(heading);
    float middleHeading = heading + 0.5 * stepRadians * sin(heading) * tan(currentLatitude);
    float secantMiddle = 1.0 / cos(middleLatitude);
    float northRadians = stepRadians * cos(middleHeading);
    latitudeOffset += northRadians;
    mercatorOffset += northRadians * secantMiddle;
    longitudeOffset += stepRadians * sin(middleHeading) * secantMiddle;
    heading += stepRadians * sin(middleHeading) * tan(middleLatitude);
    travelledMeters = distanceMeters;

    vec2 eastSouthRadians = vec2(longitudeOffset, -mercatorOffset);
    vec2 texels = observerTexels[level] + eastSouthRadians * uLevelTexelsPerRadian[level];
    while (level < 3 && !mosaicContainsWithMargin(texels)) {
      level += 1;
      if (level < 3) texels = observerTexels[level] + eastSouthRadians * uLevelTexelsPerRadian[level];
    }
    if (level >= 3) break;

    float relativeHeight = mosaicElevation(level, texels) - observerElevation - curvatureDropMeters(distanceMeters);
    horizonDegrees = max(horizonDegrees, degrees(atan(relativeHeight, distanceMeters)));
    if (horizonDegrees >= fullyHiddenDegrees) break;
    distanceMeters += max(baseStep, distanceMeters * angularStepRadians);
  }
  return horizonDegrees;
}

// (latitude, longitude) in radians of an output pixel measured from the tile's north-west corner.
vec2 pixelLatitudeLongitude(vec2 outputPixel) {
  float longitude = uTileLongitude.x + uTileLongitude.y * (outputPixel.x / tileSize);
  float mercatorY = uTileMercatorY.x - uTileMercatorY.y * (outputPixel.y / tileSize);
  return vec2(2.0 * atan(exp(mercatorY)) - 0.5 * pi, longitude);
}
`;

/**
 * Visible solar-disk fraction per pixel of the tile plus a blur margin. Texture row 0 is
 * the northern edge minus the margin; the shade pass reads it with matching offsets. The
 * horizon never sinks below the sea-level horizon, so summits keep the last light while
 * the Sun is already below the observer's level.
 */
export const terrainShadowVisibilityFragmentShaderSource = `${terrainShadowCommonShaderSource}
const float visibilityMargin = ${glslFloat(terrainShadowVisibilityMarginPixels)};

void main() {
  vec2 outputPixel = gl_FragCoord.xy - visibilityMargin;
  vec2 latitudeLongitude = pixelLatitudeLongitude(outputPixel);
  SolarPosition sun = solarPositionAt(latitudeLongitude.x, latitudeLongitude.y);
  float observerElevation = mosaicElevation(0, uLevelOrigin[0] + outputPixel * uLevelTexelsPerOutputPixel[0]);
  float seaLevelHorizon = seaLevelHorizonDegrees(observerElevation);
  float sunlitFraction = 0.0;
  if (sun.apparentElevationDegrees + solarDiskRadiusDegrees > seaLevelHorizon) {
    float horizonDegrees = max(
      horizonAngleTowardSun(
        outputPixel, latitudeLongitude.x, sun.azimuthRadians, sun.apparentElevationDegrees,
        observerElevation
      ),
      seaLevelHorizon
    );
    sunlitFraction = visibleSolarDiskFraction(sun.apparentElevationDegrees, horizonDegrees);
  }
  outValue = vec4(sunlitFraction, 0.0, 0.0, 1.0);
}
`;

/** Sky-view grid: one sample per 4 × 4 output pixels, read back with linear filtering. */
export const terrainSkyViewSize = terrainShadowTileSize / 4;
const {
  directions: skyViewDirections,
  maximumDistanceMeters: skyViewMaximumDistanceMeters,
  stepFraction: skyViewStepFraction,
} = terrainSkyViewModel;

/**
 * Share of a level surface's cosine-weighted sky that the surrounding terrain leaves
 * open, sampled every 4th output pixel: 1 on open ground and ridges, lower in valleys
 * and gorges. Each of 16 azimuths marches out to 20 km (straight lines, which over this
 * distance differ from the great circle by far less than a texel) and keeps its highest
 * terrain elevation angle h, with heights exaggerated like the sky light's slopes; the
 * sample averages cos²(max(h, 0)). It depends only on the DEM, so it is computed once
 * per assembled mosaic and read by every shade pass of that tile.
 */
export const terrainSkyViewFragmentShaderSource = `${terrainShadowCommonShaderSource}
const float skyViewScale = tileSize / ${glslFloat(terrainSkyViewSize)};
const int skyViewDirections = ${String(skyViewDirections)};
const float skyViewMaximumDistanceMeters = ${glslFloat(skyViewMaximumDistanceMeters)};
const float skyViewStepFraction = ${glslFloat(skyViewStepFraction)};
const float skyLightReliefExaggeration = ${glslFloat(skyLightReliefExaggeration)};

void main() {
  vec2 outputPixel = gl_FragCoord.xy * skyViewScale;
  vec2 latitudeLongitude = pixelLatitudeLongitude(outputPixel);
  float cosLatitude = cos(latitudeLongitude.x);
  vec2 observerTexels[3];
  for (int level = 0; level < 3; ++level) {
    observerTexels[level] = uLevelOrigin[level] + outputPixel * uLevelTexelsPerOutputPixel[level];
  }
  float observerElevation = mosaicElevation(0, observerTexels[0]);
  float reachableMaximum = texelFetch(uLevelMaximum, ivec2(0, 0), 0).r;
  reachableMaximum = max(reachableMaximum, texelFetch(uLevelMaximum, ivec2(1, 0), 0).r);
  reachableMaximum = max(reachableMaximum, texelFetch(uLevelMaximum, ivec2(2, 0), 0).r);
  float baseStep = uBaseResolutionEquatorMeters * cosLatitude;

  float openSky = 0.0;
  for (int direction = 0; direction < skyViewDirections; ++direction) {
    float azimuth = 2.0 * pi * (float(direction) + 0.5) / float(skyViewDirections);
    // East and south offsets in radians of longitude and Mercator y per metre.
    vec2 radiansPerMeter = vec2(sin(azimuth), -cos(azimuth)) / (earthRadiusMeters * cosLatitude);
    float horizonSlope = 0.0;
    int level = 0;
    for (
      float distanceMeters = baseStep;
      distanceMeters <= skyViewMaximumDistanceMeters;
      distanceMeters += max(baseStep, distanceMeters * skyViewStepFraction)
    ) {
      // Nothing farther can rise above the horizon found so far.
      if (
        (distanceMeters * horizonSlope / skyLightReliefExaggeration)
          + curvatureDropMeters(distanceMeters) > reachableMaximum - observerElevation
      ) {
        break;
      }
      vec2 eastSouthRadians = radiansPerMeter * distanceMeters;
      vec2 texels = observerTexels[level] + eastSouthRadians * uLevelTexelsPerRadian[level];
      while (level < 3 && !mosaicContainsWithMargin(texels)) {
        level += 1;
        if (level < 3) texels = observerTexels[level] + eastSouthRadians * uLevelTexelsPerRadian[level];
      }
      if (level >= 3) break;
      float relativeHeight = mosaicElevation(level, texels) - observerElevation - curvatureDropMeters(distanceMeters);
      horizonSlope = max(horizonSlope, skyLightReliefExaggeration * relativeHeight / distanceMeters);
    }
    // cos²(atan(s)) = 1 / (1 + s²).
    openSky += 1.0 / (1.0 + horizonSlope * horizonSlope);
  }
  outValue = vec4(openSky / float(skyViewDirections), 0.0, 0.0, 1.0);
}
`;

/**
 * Separate direct and sky irradiance, retaining the visibility, Lambert, and sky-view
 * model. RGBA32F output is weighted direct, weighted sky (including night overhead),
 * sunlight code, and 1. No color, exposure, compression, or clipping occurs here.
 */
export const terrainShadowShadeFragmentShaderSource = `${terrainShadowCommonShaderSource}
uniform sampler2D uVisibility;
// Open-sky share of a level surface on the 4 × 4 pixel sky-view grid, linearly filtered.
uniform sampler2D uSkyView;
// ShadeLighting; uSoftEdgeSigma is clamped above 0, so 0 means no blur.
uniform float uSkyLightShare;
uniform float uSkyOcclusionStrength;
uniform float uNightSkyLight;
uniform float uNightTopLight;
uniform float uNightTopLightFocus;
uniform float uDiffuseSkyFraction;
uniform float uSoftEdgeSigma;

const int visibilityMargin = ${String(terrainShadowVisibilityMarginPixels)};
const float flatReferenceElevationDegrees = ${glslFloat(terrainShadeFlatReferenceElevationDegrees)};
const float rayleighScaleHeightMeters = ${glslFloat(atmosphericSunlightModel.rayleighScaleHeightMeters)};
const float horizonAirMass = ${glslFloat(horizonAirMass)};
const float minimumAirMass = ${glslFloat(sunlightMinimumAirMass)};
const float airMassMaximumCode = ${glslFloat(sunlightAirMassMaximumCode)};
const float nightCode = ${glslFloat(sunlightNightCode)};
const float nightElevationDegrees = ${glslFloat(terrainShadowNightElevationDegrees)};
const float skyLightElevationDegrees = ${glslFloat(terrainShadeSkyLightElevationDegrees)};
const float skyLightWrap = ${glslFloat(skyLightWrap)};
const float skyLightReliefExaggeration = ${glslFloat(skyLightReliefExaggeration)};
const float diffuseSkyTransitionDegrees = ${glslFloat(diffuseSkyTransitionDegrees)};

float kastenYoungAirMass(float apparentElevationDegrees) {
  return 1.0 / (sin(radians(apparentElevationDegrees)) + 0.50572 * pow(apparentElevationDegrees + 6.07995, -1.6364));
}

float relativeOpticalAirMass(float apparentElevationDegrees, float elevationMeters) {
  float height = max(elevationMeters, 0.0);
  if (apparentElevationDegrees >= 0.0) {
    return kastenYoungAirMass(apparentElevationDegrees) * exp(-height / rayleighScaleHeightMeters);
  }
  float horizonSlope = tan(radians(-seaLevelHorizonDegrees(height)));
  if (horizonSlope == 0.0) return horizonAirMass;
  float ratio = tan(radians(-apparentElevationDegrees)) / horizonSlope;
  float tangentHeight = height * max(0.0, 1.0 - ratio * ratio);
  return horizonAirMass * exp(-tangentHeight / rayleighScaleHeightMeters);
}

float sunlightCode(float apparentElevationDegrees, float elevationMeters) {
  float seaLevelHorizon = seaLevelHorizonDegrees(elevationMeters);
  if (apparentElevationDegrees < seaLevelHorizon) {
    float twilight = clamp(
      (apparentElevationDegrees - nightElevationDegrees) / max(seaLevelHorizon - nightElevationDegrees, 1e-3),
      0.0,
      1.0
    );
    return airMassMaximumCode + 1.0 + floor((nightCode - airMassMaximumCode - 1.0) * (1.0 - twilight) + 0.5);
  }
  float airMass = relativeOpticalAirMass(apparentElevationDegrees, elevationMeters);
  float position = clamp(log(airMass / minimumAirMass) / log(horizonAirMass / minimumAirMass), 0.0, 1.0);
  return floor(airMassMaximumCode * position + 0.5);
}

void main() {
  vec2 outputPixel = gl_FragCoord.xy;
  vec2 latitudeLongitude = pixelLatitudeLongitude(outputPixel);
  SolarPosition sun = solarPositionAt(latitudeLongitude.x, latitudeLongitude.y);

  ivec2 center = ivec2(gl_FragCoord.xy) + visibilityMargin;
  float sigma = max(uSoftEdgeSigma, 0.01);
  float weightSum = 0.0;
  float visibility = 0.0;
  for (int dy = -visibilityMargin; dy <= visibilityMargin; ++dy) {
    for (int dx = -visibilityMargin; dx <= visibilityMargin; ++dx) {
      float weight = exp(-float(dx * dx + dy * dy) / (2.0 * sigma * sigma));
      visibility += weight * texelFetch(uVisibility, center + ivec2(dx, dy), 0).r;
      weightSum += weight;
    }
  }
  visibility /= weightSum;

  // Mosaic y grows south, so north is the negative texel direction.
  vec2 texels = uLevelOrigin[0] + outputPixel * uLevelTexelsPerOutputPixel[0];
  float texelMeters = uBaseResolutionEquatorMeters * cos(latitudeLongitude.x);
  float dzEast = (mosaicElevation(0, texels + vec2(1.0, 0.0)) - mosaicElevation(0, texels - vec2(1.0, 0.0))) / (2.0 * texelMeters);
  float dzNorth = (mosaicElevation(0, texels - vec2(0.0, 1.0)) - mosaicElevation(0, texels + vec2(0.0, 1.0))) / (2.0 * texelMeters);
  vec3 normal = normalize(vec3(-dzEast, -dzNorth, 1.0));

  float elevation = radians(sun.apparentElevationDegrees);
  float azimuth = sun.azimuthRadians;
  vec3 toSun = vec3(sin(azimuth) * cos(elevation), cos(azimuth) * cos(elevation), sin(elevation));
  float direct = visibility * max(dot(normal, toSun), 0.0)
    / max(toSun.z, sin(radians(flatReferenceElevationDegrees)));
  float skyElevation = radians(skyLightElevationDegrees);
  vec3 toSky = vec3(sin(azimuth) * cos(skyElevation), cos(azimuth) * cos(skyElevation), sin(skyElevation));
  float skyTwilight = smoothstep(nightElevationDegrees, 0.0, sun.apparentElevationDegrees);
  vec3 skyNormal = normalize(vec3(-dzEast, -dzNorth, 1.0 / skyLightReliefExaggeration));
  // Visible sky of the slope's own plane, 1 on flat ground. Terrain beyond that plane hides
  // the share of it that the sky-view pass found missing; the sky-view average of
  // cos²(max(h, 0)) already includes the slope itself, so it is compared to the plane.
  float planeSky = 0.5 * (1.0 + skyNormal.z);
  float occlusion = max(
    1.0 - uSkyOcclusionStrength * (1.0 - min(texture(uSkyView, outputPixel / tileSize).r / planeSky, 1.0)),
    0.0
  );
  float sunSideSky = occlusion * max(dot(skyNormal, toSky) + skyLightWrap, 0.0) / (toSky.z + skyLightWrap);
  float diffuseSky = occlusion * planeSky;
  float diffuseShare = uDiffuseSkyFraction * (1.0 - smoothstep(
    -diffuseSkyTransitionDegrees, diffuseSkyTransitionDegrees, sun.apparentElevationDegrees
  ));
  float sky = skyTwilight * mix(sunSideSky, diffuseSky, diffuseShare)
    + (1.0 - skyTwilight) * uNightSkyLight * diffuseSky;
  // Overhead light after the blue hour: none above half the night elevation, full from
  // the night elevation down, so night masks stay independent of the instant.
  float nightTop = 1.0 - smoothstep(
    nightElevationDegrees, 0.5 * nightElevationDegrees, sun.apparentElevationDegrees
  );
  float directEnergy = (1.0 - uSkyLightShare) * direct;
  float skyEnergy = uSkyLightShare * sky
    + uNightTopLight * nightTop * pow(occlusion, uNightTopLightFocus) * skyNormal.z;
  float code = sunlightCode(sun.apparentElevationDegrees, mosaicElevation(0, texels));
  outValue = vec4(directEnergy, skyEnergy, code, 1.0);
}
`;

type Rgb = readonly [number, number, number];

/**
 * Source chromaticities are sRGB picker colors; energies never use 0–255 color values.
 * Colors and display transfer controls recolor cached linear masks.
 */
export interface ShadePalette {
  readonly shadowColor: Rgb;
  readonly highlightColor: Rgb;
  readonly highlightOpacity: number;
  readonly goldenShadowColor: Rgb;
  readonly lowSunShadowColor: Rgb;
  readonly alpenglowColor: Rgb;
  readonly alpenglowOpacity: number;
  readonly neutralBrightness: number;
  /** Fixed EV exposure, identical across tiles and animation frames. */
  readonly exposure: number;
  readonly shadowStrength: number;
  readonly highlightRolloff: number;
}

function mixRgb(from: Rgb, to: Rgb, weight: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * weight,
    from[1] + (to[1] - from[1]) * weight,
    from[2] + (to[2] - from[2]) * weight,
  ];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

/** Normalize picker brightness away: the shade pass, not the picker, owns energy. */
function linearChromaticity(color: Rgb): Rgb {
  const red = srgbToLinear(color[0]);
  const green = srgbToLinear(color[1]);
  const blue = srgbToLinear(color[2]);
  const maximum = Math.max(red, green, blue);
  return maximum === 0 ? [0, 0, 0] : [red / maximum, green / maximum, blue / maximum];
}

export const shadeNeutralBrightness = 1;
export const terrainShadeExposure = -0.1;
export const terrainShadeShadowStrength = 2.25;
export const terrainShadeHighlightRolloff = 1.05;

export interface ShadeColorizer {
  /** Six linear coefficients per code: direct RGB, sky RGB. Not a brightness LUT. */
  readonly sources: Float32Array;
  readonly palette: ShadePalette;
  readonly exposure: number;
}

/**
 * Precompute only source colors. The normalized Rayleigh sunlight hue is a relative
 * illuminant, not absolute solar radiometry; diffuse sky remains the existing artistic
 * day/twilight model. Alpenglow changes that sky, never adds an independent fill.
 */
export function createShadeColorizer(
  palette: ShadePalette,
  skyLightShare: number,
): ShadeColorizer {
  const sources = new Float32Array(256 * 6);
  const whiteBalance = linearChromaticity(palette.highlightColor);
  const daySky = linearChromaticity(palette.shadowColor);
  const goldenSky = linearChromaticity(palette.goldenShadowColor);
  const twilightSky = linearChromaticity(palette.lowSunShadowColor);
  const alpenglow = linearChromaticity(palette.alpenglowColor);
  // Fixed daylight white balance, not per-tile/frame normalization: a flat surface
  // under the reference zenith Sun and open day sky must retain its basemap colors.
  const daylightWhite: Rgb = [
    (1 - skyLightShare) * whiteBalance[0] + skyLightShare * daySky[0],
    (1 - skyLightShare) * whiteBalance[1] + skyLightShare * daySky[1],
    (1 - skyLightShare) * whiteBalance[2] + skyLightShare * daySky[2],
  ];
  for (let code = 0; code < 256; code += 1) {
    const twilightDepth =
      code > sunlightAirMassMaximumCode
        ? (code - sunlightAirMassMaximumCode - 1) /
          (sunlightNightCode - sunlightAirMassMaximumCode - 1)
        : 0;
    const airMass =
      sunlightMinimumAirMass *
      (horizonAirMass / sunlightMinimumAirMass) **
        (Math.min(code, sunlightAirMassMaximumCode) / sunlightAirMassMaximumCode);
    // This function already returns linear relative transmission, not sRGB.
    const sunlight = directSunlightColor(airMass);
    const lowSun = Math.max(0, 1 - sunlight[2] / sunlight[0]);
    let skyColor: Rgb;
    if (code <= sunlightAirMassMaximumCode) {
      skyColor = mixRgb(daySky, goldenSky, lowSun);
    } else if (twilightDepth < 0.5) {
      skyColor = mixRgb(goldenSky, twilightSky, twilightDepth / 0.5);
    } else {
      skyColor = mixRgb(twilightSky, daySky, (twilightDepth - 0.5) / 0.5);
    }
    const rose =
      palette.alpenglowOpacity *
      smoothstep(0, 0.15, twilightDepth) *
      (1 - smoothstep(0.15, 0.55, twilightDepth));
    for (let channel = 0; channel < 3; channel += 1) {
      const reference = daylightWhite[channel] ?? 0;
      sources[code * 6 + channel] =
        reference === 0
          ? 0
          : ((sunlight[channel] ?? 0) * (whiteBalance[channel] ?? 0)) / reference;
      sources[code * 6 + 3 + channel] =
        reference === 0
          ? 0
          : ((skyColor[channel] ?? 0) * (1 - rose) + (alpenglow[channel] ?? 0) * rose) /
            reference;
    }
  }
  return {
    sources,
    palette,
    exposure: 2 ** palette.exposure / palette.neutralBrightness,
  };
}

// A raster overlay cannot read the basemap's albedo. Its RGBA approximation is exact
// for this middle-grey sRGB surface only; arbitrary basemap colors are not physical.
const referenceSurface = 0.5;
const referenceSurfaceLinear = srgbToLinear(referenceSurface * 255);

/** One fixed display transfer, applied only after direct and sky have been added. */
function displayChannel(energy: number, colorizer: ShadeColorizer): number {
  const value = energy * colorizer.exposure;
  const { shadowStrength, highlightOpacity, highlightRolloff } = colorizer.palette;
  const mapped =
    value <= 1
      ? (referenceSurfaceLinear * value) / (1 + shadowStrength * (1 - value) ** 2)
      : referenceSurfaceLinear +
        ((1 - referenceSurfaceLinear) * highlightOpacity * (value - 1)) /
          (highlightRolloff + value - 1);
  return linearToSrgb(mapped);
}

/** For each output row or column: the grid sample at or before it and the next one's weight in quarters. */
const sunlightGridLower = new Uint8Array(terrainShadowTileSize);
const sunlightGridWeight = new Uint8Array(terrainShadowTileSize);
for (let pixel = 0; pixel < terrainShadowTileSize; pixel += 1) {
  const offset = Math.max(pixel - sunlightGridStride / 2, 0);
  const lower = Math.min(Math.floor(offset / sunlightGridStride), sunlightGridSize - 1);
  sunlightGridLower[pixel] = lower;
  sunlightGridWeight[pixel] =
    lower === sunlightGridSize - 1 ? 0 : offset - lower * sunlightGridStride;
}

/**
 * Add linear source RGB, expose and tone map once, then encode sRGB and derive a
 * straight-alpha overlay against reference grey. Source identity is never inferred
 * from brightness. Only the final display result is quantized to RGBA8.
 */
export function expandShadeMask(
  mask: ShadeMask,
  colorizer: ShadeColorizer,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(tilePixels * 4);
  const weightSum = sunlightGridStride * sunlightGridStride;
  for (let row = 0; row < terrainShadowTileSize; row += 1) {
    const southWeight = sunlightGridWeight[row] ?? 0;
    const northStart = (sunlightGridLower[row] ?? 0) * sunlightGridSize;
    const southStart = northStart + (southWeight === 0 ? 0 : sunlightGridSize);
    const northWeight = sunlightGridStride - southWeight;
    for (let column = 0; column < terrainShadowTileSize; column += 1) {
      const eastWeight = sunlightGridWeight[column] ?? 0;
      const west = sunlightGridLower[column] ?? 0;
      const east = west + (eastWeight === 0 ? 0 : 1);
      const westWeight = sunlightGridStride - eastWeight;
      const code = Math.round(
        ((mask.sunlight[northStart + west] ?? 0) * westWeight * northWeight +
          (mask.sunlight[northStart + east] ?? 0) * eastWeight * northWeight +
          (mask.sunlight[southStart + west] ?? 0) * westWeight * southWeight +
          (mask.sunlight[southStart + east] ?? 0) * eastWeight * southWeight) /
          weightSum,
      );
      const index = row * terrainShadowTileSize + column;
      const direct = mask.direct[index] ?? 0;
      const sky = mask.sky[index] ?? 0;
      const offset = code * 6;
      const red = displayChannel(
        direct * (colorizer.sources[offset] ?? 0) +
          sky * (colorizer.sources[offset + 3] ?? 0),
        colorizer,
      );
      const green = displayChannel(
        direct * (colorizer.sources[offset + 1] ?? 0) +
          sky * (colorizer.sources[offset + 4] ?? 0),
        colorizer,
      );
      const blue = displayChannel(
        direct * (colorizer.sources[offset + 2] ?? 0) +
          sky * (colorizer.sources[offset + 5] ?? 0),
        colorizer,
      );
      const alpha = Math.max(
        1 - Math.min(red, green, blue) / referenceSurface,
        (Math.max(red, green, blue) - referenceSurface) / (1 - referenceSurface),
        0,
      );
      if (alpha < 1 / 510) continue;
      const retainedBase = referenceSurface * (1 - alpha);
      pixels[index * 4] = ((red - retainedBase) / alpha) * 255;
      pixels[index * 4 + 1] = ((green - retainedBase) / alpha) * 255;
      pixels[index * 4 + 2] = ((blue - retainedBase) / alpha) * 255;
      pixels[index * 4 + 3] = alpha * 255;
    }
  }
  return pixels;
}

/**
 * Flat sea-level draft/coarse mask, without DEM or a GPU. Evaluate the same direct
 * and sky terms at 128² solar positions, then interpolate each energy separately.
 */
export function createFlatShadeMask(
  tile: TerrainShadowTileAddress,
  instantMs: number,
  lighting: Pick<ShadeLighting, 'skyLightShare' | 'nightSkyLight' | 'nightTopLight'>,
): ShadeMask {
  const { skyLightShare, nightSkyLight, nightTopLight } = lighting;
  const mask: ShadeMask = {
    direct: new Float32Array(tilePixels),
    sky: new Float32Array(tilePixels),
    sunlight: new Uint8Array(sunlightGridSize * sunlightGridSize),
  };
  const gridDirect = new Float32Array(sunlightGridSize * sunlightGridSize);
  const gridSky = new Float32Array(sunlightGridSize * sunlightGridSize);
  const sun = subsolarPoint(new Date(instantMs));
  const geometry = terrainShadowTileGeometry(tile);
  const degreesPerRadian = 180 / Math.PI;
  const flatReferenceSine = Math.sin(
    terrainShadeFlatReferenceElevationDegrees / degreesPerRadian,
  );
  const night = terrainShadowNightElevationDegrees;
  // GPU pixel centers sit at 0.5; grid samples are pixel (4i + 2, 4j + 2).
  const sampleOffset = sunlightGridStride / 2 + 0.5;
  for (let row = 0; row < sunlightGridSize; row += 1) {
    const mercatorY =
      geometry.northMercatorY -
      (geometry.mercatorYSpan * (row * sunlightGridStride + sampleOffset)) /
        terrainShadowTileSize;
    const latitude =
      (2 * Math.atan(Math.exp(mercatorY)) - Math.PI / 2) * degreesPerRadian;
    for (let column = 0; column < sunlightGridSize; column += 1) {
      const longitude =
        (geometry.westLongitudeRadians +
          (geometry.longitudeSpanRadians *
            (column * sunlightGridStride + sampleOffset)) /
            terrainShadowTileSize) *
        degreesPerRadian;
      const elevation = solarPositionAt(
        sun,
        latitude,
        longitude,
      ).apparentElevationDegrees;
      const sine = Math.sin(elevation / degreesPerRadian);
      const direct =
        (visibleSolarDiskFraction(elevation, 0) * Math.max(sine, 0)) /
        Math.max(sine, flatReferenceSine);
      const twilight = Math.min(Math.max((elevation - night) / -night, 0), 1);
      const twilightSky = twilight * twilight * (3 - 2 * twilight);
      // Flat ground sees the whole sky, so the night sky and the top light add in full.
      const sky = twilightSky + (1 - twilightSky) * nightSkyLight;
      const index = row * sunlightGridSize + column;
      gridDirect[index] = (1 - skyLightShare) * direct;
      gridSky[index] =
        skyLightShare * sky +
        nightTopLight * (1 - smoothstep(night, night / 2, elevation));
      // `sunlightCode` of the shade shader at sea level, where the horizon is 0°.
      mask.sunlight[index] =
        elevation < 0
          ? sunlightAirMassMaximumCode +
            1 +
            Math.floor(
              (sunlightNightCode - sunlightAirMassMaximumCode - 1) * (1 - twilight) +
                0.5,
            )
          : Math.floor(
              sunlightAirMassMaximumCode *
                Math.min(
                  Math.max(
                    Math.log(kastenYoungAirMass(elevation) / sunlightMinimumAirMass) /
                      Math.log(horizonAirMass / sunlightMinimumAirMass),
                    0,
                  ),
                  1,
                ) +
                0.5,
            );
    }
  }
  const weightSum = sunlightGridStride * sunlightGridStride;
  for (let row = 0; row < terrainShadowTileSize; row += 1) {
    const southWeight = sunlightGridWeight[row] ?? 0;
    const northStart = (sunlightGridLower[row] ?? 0) * sunlightGridSize;
    const southStart = northStart + (southWeight === 0 ? 0 : sunlightGridSize);
    const northWeight = sunlightGridStride - southWeight;
    for (let column = 0; column < terrainShadowTileSize; column += 1) {
      const eastWeight = sunlightGridWeight[column] ?? 0;
      const west = sunlightGridLower[column] ?? 0;
      const east = west + (eastWeight === 0 ? 0 : 1);
      const westWeight = sunlightGridStride - eastWeight;
      const index = row * terrainShadowTileSize + column;
      mask.direct[index] =
        ((gridDirect[northStart + west] ?? 0) * westWeight * northWeight +
          (gridDirect[northStart + east] ?? 0) * eastWeight * northWeight +
          (gridDirect[southStart + west] ?? 0) * westWeight * southWeight +
          (gridDirect[southStart + east] ?? 0) * eastWeight * southWeight) /
        weightSum;
      mask.sky[index] =
        ((gridSky[northStart + west] ?? 0) * westWeight * northWeight +
          (gridSky[northStart + east] ?? 0) * eastWeight * northWeight +
          (gridSky[southStart + west] ?? 0) * westWeight * southWeight +
          (gridSky[southStart + east] ?? 0) * eastWeight * southWeight) /
        weightSum;
    }
  }
  return mask;
}
