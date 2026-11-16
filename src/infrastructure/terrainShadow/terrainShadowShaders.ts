import {
  atmosphericSunlightModel,
  directSunlightColor,
  horizonAirMass,
  kastenYoungAirMass,
  type SunlightColor,
} from '@/domain/terrain/atmosphericSunlight';
import { solarPositionAt, subsolarPoint } from '@/domain/terrain/solarPosition';
import {
  terrainShadowModel,
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
/** Stored shade byte = round(brightness × 127): flat ground in full sun is exactly 127. */
export const shadeBrightnessScale = 127;
/**
 * Sun elevation whose flat-ground brightness counts as full sun. Lower suns divide by
 * this floor instead of their own sine, so dawn and dusk darken flat ground gradually.
 * Slopes facing a low Sun then exceed 1 several times; the shade pass compresses
 * brightness above 1 into [1, 2) so they keep their order instead of clipping.
 */
export const terrainShadeFlatReferenceElevationDegrees = 10;
/** Gaussian σ of the cast-shadow soft edge, in output pixels. */
export const terrainShadowSoftEdgeSigmaPixels = 1;
/**
 * Share of flat ground's full-sun brightness that comes from the sky rather than the
 * direct Sun. The sky term keeps relief inside shadows; it fades out smoothly over civil
 * twilight down to the night elevation, so night tiles stay plain shade.
 */
export const terrainShadeSkyLightShare = 0.35;
/**
 * The sky is brightest toward the Sun, so part of its light is a softly wrapped Lambert
 * light from the Sun's azimuth at this elevation, on slopes exaggerated by
 * `skyLightReliefExaggeration` so gentle relief still reads inside shadows.
 */
export const terrainShadeSkyLightElevationDegrees = 30;
const skyLightWrap = 0.2;
const skyLightReliefExaggeration = 1.5;
/**
 * How strongly the terrain's occlusion of the sky dims the sky light: the shade pass uses
 * max(1 − strength · (1 − occlusion), 0), so above 1 gorges darken faster than the open
 * sky share alone would.
 */
const skyOcclusionStrength = 1.75;
/**
 * After sunset part of the sky light becomes diffuse, as from a thin cloud layer that
 * keeps scattering light: it depends only on how much sky a slope faces, not on the Sun's
 * azimuth, which softens the fade into night. While the Sun is up, the sun-side sky keeps
 * full contrast; the diffuse share grows to this fraction as the Sun crosses
 * ±`diffuseSkyTransitionDegrees` around the horizon.
 */
export const terrainShadeDiffuseSkyFraction = 0.5;
const diffuseSkyTransitionDegrees = 2;

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
/** Below every reachable air mass: the zenith Sun over a summit near 5500 m. */
export const sunlightMinimumAirMass = 0.5;
/** Sunlight codes are kept for every 4th pixel in both directions and interpolated. */
export const sunlightGridStride = 4;
export const sunlightGridSize = terrainShadowTileSize / sunlightGridStride;
const tilePixels = terrainShadowTileSize * terrainShadowTileSize;
/**
 * Cached shade mask: one brightness byte per pixel, rows from the northern edge, followed
 * by the `sunlightGridSize`² sunlight codes sampled at pixel (4i + 2, 4j + 2).
 */
export const shadeMaskBytes = tilePixels + sunlightGridSize * sunlightGridSize;

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
/** Horizon directions per sky-view sample. */
const skyViewDirections = 16;
/** Terrain farther than this does not hide sky; deep valleys are a few kilometres wide. */
const skyViewMaximumDistanceMeters = 20_000;
/** Each sky-view march step grows by this fraction of the distance travelled. */
const skyViewStepFraction = 0.08;

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
 * Real-sun relief brightness, normalized so flat ground in full sun is 1. The direct part
 * is blurred cast-shadow visibility times Lambert slope lighting; its slope term reaches 0
 * exactly where the horizon march starts reporting self-shadow, so terminators stay
 * continuous. The sky part is a wrapped Lambert light from the Sun's azimuth, so relief
 * stays visible inside shadows, dimmed by the terrain that hides sky beyond the slope's
 * own plane (`terrainSkyViewFragmentShaderSource`), so gorges darken and ridges stay
 * lit. Output is brightness × `shadeBrightnessScale` / 255 in the
 * red channel and the sunlight code / 255 in the green channel. `kastenYoungAirMass` and
 * `relativeOpticalAirMass` mirror `@/domain/terrain/atmosphericSunlight`.
 */
export const terrainShadowShadeFragmentShaderSource = `${terrainShadowCommonShaderSource}
uniform sampler2D uVisibility;
// Open-sky share of a level surface on the 4 × 4 pixel sky-view grid, linearly filtered.
uniform sampler2D uSkyView;
const float skyOcclusionStrength = ${glslFloat(skyOcclusionStrength)};

const int visibilityMargin = ${String(terrainShadowVisibilityMarginPixels)};
const float softEdgeSigma = ${glslFloat(terrainShadowSoftEdgeSigmaPixels)};
const float flatReferenceElevationDegrees = ${glslFloat(terrainShadeFlatReferenceElevationDegrees)};
const float brightnessScale = ${glslFloat(shadeBrightnessScale)};
const float rayleighScaleHeightMeters = ${glslFloat(atmosphericSunlightModel.rayleighScaleHeightMeters)};
const float horizonAirMass = ${glslFloat(horizonAirMass)};
const float minimumAirMass = ${glslFloat(sunlightMinimumAirMass)};
const float airMassMaximumCode = ${glslFloat(sunlightAirMassMaximumCode)};
const float nightCode = ${glslFloat(sunlightNightCode)};
const float nightElevationDegrees = ${glslFloat(terrainShadowNightElevationDegrees)};
const float skyLightShare = ${glslFloat(terrainShadeSkyLightShare)};
const float skyLightElevationDegrees = ${glslFloat(terrainShadeSkyLightElevationDegrees)};
const float skyLightWrap = ${glslFloat(skyLightWrap)};
const float skyLightReliefExaggeration = ${glslFloat(skyLightReliefExaggeration)};
const float diffuseSkyFraction = ${glslFloat(terrainShadeDiffuseSkyFraction)};
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
  float weightSum = 0.0;
  float visibility = 0.0;
  for (int dy = -visibilityMargin; dy <= visibilityMargin; ++dy) {
    for (int dx = -visibilityMargin; dx <= visibilityMargin; ++dx) {
      float weight = exp(-float(dx * dx + dy * dy) / (2.0 * softEdgeSigma * softEdgeSigma));
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
    1.0 - skyOcclusionStrength * (1.0 - min(texture(uSkyView, outputPixel / tileSize).r / planeSky, 1.0)),
    0.0
  );
  float sunSideSky = occlusion * max(dot(skyNormal, toSky) + skyLightWrap, 0.0) / (toSky.z + skyLightWrap);
  float diffuseSky = occlusion * planeSky;
  float diffuseShare = diffuseSkyFraction * (1.0 - smoothstep(
    -diffuseSkyTransitionDegrees, diffuseSkyTransitionDegrees, sun.apparentElevationDegrees
  ));
  float sky = skyTwilight * mix(sunSideSky, diffuseSky, diffuseShare);
  float brightness = (1.0 - skyLightShare) * direct + skyLightShare * sky;
  // Above full sun, x ↦ 1 + x / (1 + x) keeps sun-facing slopes ordered below 2 instead
  // of clipping them all to one tone.
  float overExposure = max(brightness - 1.0, 0.0);
  brightness = min(brightness, 1.0) + overExposure / (1.0 + overExposure);
  float code = sunlightCode(sun.apparentElevationDegrees, mosaicElevation(0, texels));
  outValue = vec4(clamp(brightness * brightnessScale / 255.0, 0.0, 1.0), code / 255.0, 0.0, 1.0);
}
`;

type Rgb = readonly [number, number, number];

/** Colors the worker applies to shade masks; `#RRGGBB` channels and 0–1 opacities. */
export interface ShadePalette {
  readonly shadowColor: Rgb;
  readonly highlightColor: Rgb;
  readonly highlightOpacity: number;
  readonly lowSunShadowColor: Rgb;
  readonly lowSunShadowLift: number;
  readonly lowSunGlowOpacity: number;
}

interface SunlightTone {
  readonly color: SunlightColor;
  /** 0 for a high Sun, 1 at the horizon, back to 0 at `sunlightNightCode`. */
  readonly lowSun: number;
}

/**
 * Decodes a sunlight code. Above the sea-level horizon `lowSun` is the blue deficit of the
 * sunlight color, so it follows the same atmosphere; below it eases out (smoothstep) over
 * the twilight codes, so night returns to the plain shadow without a visible step.
 */
function sunlightTone(code: number): SunlightTone {
  if (code > sunlightAirMassMaximumCode) {
    const depth =
      (code - sunlightAirMassMaximumCode - 1) /
      (sunlightNightCode - sunlightAirMassMaximumCode - 1);
    return {
      color: directSunlightColor(horizonAirMass),
      lowSun: 1 - depth * depth * (3 - 2 * depth),
    };
  }
  const airMass =
    sunlightMinimumAirMass *
    (horizonAirMass / sunlightMinimumAirMass) ** (code / sunlightAirMassMaximumCode);
  const color = directSunlightColor(airMass);
  return { color, lowSun: Math.max(0, 1 - color[2] / color[0]) };
}

/**
 * How much of the physical sunlight hue reaches the overlay. Eyes and cameras adapt to the
 * warm light, and a fully saturated tint reads as orange paint over imagery.
 */
const sunlightTintStrength = 0.75;

/**
 * Default brightness the overlay leaves untouched. It sits above flat ground in full sun
 * (1), so flat ground keeps a light shade and slopes turned to the Sun can still brighten
 * in two steps: first the shade fades, then the highlight grows up to the compressed
 * maximum of 2. With the neutral at 1, every lit slope already had no shade left to lose.
 */
export const shadeNeutralBrightness = 1.45;
const shadeMaximumBrightness = 2;

/**
 * RGBA8 colors indexed by `sunlightCode × 256 + shadeByte`, written byte-wise so the table
 * is endian-safe when read through a `Uint32Array`. Colors are not premultiplied
 * (ImageData semantics).
 *
 * Shade fades `shadowColor` in as brightness drops below `shadeNeutralBrightness`. Light
 * is the highlight color tinted by the sunlight color, up to `highlightOpacity` from the
 * neutral to the compressed maximum of 2, plus a glow of up to `lowSunGlowOpacity` ×
 * `lowSun` that grows with the direct
 * share of the brightness up to the compressed maximum of 2, so slopes facing a low Sun
 * keep their relief instead of one saturated tone. As the Sun sinks, shade turns toward
 * `lowSunShadowColor` and loses up to `lowSunShadowLift` of its opacity, as the sky lights
 * shadows more than the dimming Sun lights the slopes. Light is composited over shade. A
 * high Sun keeps the plain shadow and highlight.
 */
export function createShadeLookupTable(palette: ShadePalette): Uint32Array {
  const table = new Uint32Array(256 * 256);
  const bytes = new Uint8Array(table.buffer);
  const { shadowColor, highlightColor, lowSunShadowColor } = palette;
  const tint = (sunlight: number) =>
    1 - sunlightTintStrength + sunlightTintStrength * sunlight;
  for (let code = 0; code < 256; code += 1) {
    const { color: sunlight, lowSun } = sunlightTone(code);
    const lightColor: Rgb = [
      highlightColor[0] * tint(sunlight[0]),
      highlightColor[1] * tint(sunlight[1]),
      highlightColor[2] * tint(sunlight[2]),
    ];
    const shadeColor: Rgb = [
      shadowColor[0] + (lowSunShadowColor[0] - shadowColor[0]) * lowSun,
      shadowColor[1] + (lowSunShadowColor[1] - shadowColor[1]) * lowSun,
      shadowColor[2] + (lowSunShadowColor[2] - shadowColor[2]) * lowSun,
    ];
    const shadeOpacity = 1 - lowSun * palette.lowSunShadowLift;
    const neutral = shadeNeutralBrightness;
    for (let value = 0; value < 256; value += 1) {
      const brightness = value / shadeBrightnessScale;
      const directShare = Math.min(
        Math.max(
          (brightness - terrainShadeSkyLightShare) /
            (shadeMaximumBrightness - terrainShadeSkyLightShare),
          0,
        ),
        1,
      );
      const lightAlpha = Math.min(
        1,
        directShare * lowSun * palette.lowSunGlowOpacity +
          Math.min(
            Math.max((brightness - neutral) / (shadeMaximumBrightness - neutral), 0),
            1,
          ) *
            palette.highlightOpacity,
      );
      const shadeWeight =
        Math.max(1 - brightness / neutral, 0) * shadeOpacity * (1 - lightAlpha);
      const alpha = lightAlpha + shadeWeight;
      if (alpha === 0) continue;
      const blend = (channel: 0 | 1 | 2) =>
        Math.round(
          (lightColor[channel] * lightAlpha + shadeColor[channel] * shadeWeight) /
            alpha,
        );
      bytes.set(
        [blend(0), blend(1), blend(2), Math.round(alpha * 255)],
        (code * 256 + value) * 4,
      );
    }
  }
  return table;
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
 * Expands a shade mask (`shadeMaskBytes` layout) into 512 px ImageData RGBA bytes,
 * interpolating the sunlight code bilinearly between its grid samples.
 */
export function expandShadeMask(
  mask: Uint8Array,
  table: Uint32Array,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(tilePixels * 4);
  const pixels32 = new Uint32Array(pixels.buffer);
  const weightSum = sunlightGridStride * sunlightGridStride;
  for (let row = 0; row < terrainShadowTileSize; row += 1) {
    const southWeight = sunlightGridWeight[row] ?? 0;
    const northStart = tilePixels + (sunlightGridLower[row] ?? 0) * sunlightGridSize;
    const southStart = northStart + (southWeight === 0 ? 0 : sunlightGridSize);
    const northWeight = sunlightGridStride - southWeight;
    for (let column = 0; column < terrainShadowTileSize; column += 1) {
      const eastWeight = sunlightGridWeight[column] ?? 0;
      const west = sunlightGridLower[column] ?? 0;
      const east = west + (eastWeight === 0 ? 0 : 1);
      const westWeight = sunlightGridStride - eastWeight;
      const code = Math.round(
        ((mask[northStart + west] ?? 0) * westWeight * northWeight +
          (mask[northStart + east] ?? 0) * eastWeight * northWeight +
          (mask[southStart + west] ?? 0) * westWeight * southWeight +
          (mask[southStart + east] ?? 0) * eastWeight * southWeight) /
          weightSum,
      );
      const index = row * terrainShadowTileSize + column;
      pixels32[index] = table[code * 256 + (mask[index] ?? 0)] ?? 0;
    }
  }
  return pixels;
}

/**
 * Shade mask of flat sea-level ground for a tile below `terrainShadowReliefMinZoom`,
 * without DEM, slopes, or cast shadows: the shade pass's terms for a flat pixel whose
 * horizon is the sea-level horizon (0°), so the direct Sun is the visible disk fraction
 * normalized like the GPU and the sky term is its twilight fade. Brightness and sunlight
 * codes are evaluated at the sunlight grid samples, as the GPU codes are, and brightness
 * is interpolated bilinearly to pixels, so a tile costs 128² solar positions on the CPU.
 */
export function createFlatShadeMask(
  tile: TerrainShadowTileAddress,
  instantMs: number,
): Uint8Array {
  const mask = new Uint8Array(shadeMaskBytes);
  const gridBrightness = new Float32Array(sunlightGridSize * sunlightGridSize);
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
      const sky = twilight * twilight * (3 - 2 * twilight);
      const index = row * sunlightGridSize + column;
      gridBrightness[index] =
        (1 - terrainShadeSkyLightShare) * direct + terrainShadeSkyLightShare * sky;
      // `sunlightCode` of the shade shader at sea level, where the horizon is 0°.
      mask[tilePixels + index] =
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
      const brightness =
        ((gridBrightness[northStart + west] ?? 0) * westWeight * northWeight +
          (gridBrightness[northStart + east] ?? 0) * eastWeight * northWeight +
          (gridBrightness[southStart + west] ?? 0) * westWeight * southWeight +
          (gridBrightness[southStart + east] ?? 0) * eastWeight * southWeight) /
        weightSum;
      mask[row * terrainShadowTileSize + column] = Math.round(
        brightness * shadeBrightnessScale,
      );
    }
  }
  return mask;
}
