import { terrainShadowModel } from '@/domain/terrain/terrainShadow';
import {
  terrainShadowMosaicMarginTexels,
  terrainShadowMosaicSize,
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

/**
 * GPU mirror of `horizonAngleTowardSun` and `visibleSolarDiskFraction` in
 * `@/domain/terrain/terrainShadow` and `solarPositionAt` in `@/domain/terrain/solarPosition`;
 * function names match so a browser parity check can compare them one-to-one.
 *
 * Mosaic texel coordinates grow east and south from the mosaic's north-west corner. Every
 * sample is placed relative to the observer (`observerTexels + offset · texelsPerRadian`).
 * The offset integrates the great circle step by step (midpoint rule) instead of
 * subtracting absolute `asin`/`atan` results: GPU inverse trigonometry is only accurate to
 * about 1e-5 rad, which would move near samples by several z12 texels.
 */
export const terrainShadowFragmentShaderSource = `#version 300 es
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
uniform vec3 uColor;

layout(location = 0) out vec4 outColor;

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
  if (apparentElevationDegrees <= -solarDiskRadiusDegrees) return 0.0;
  float u = clamp((apparentElevationDegrees - horizonDegrees) / solarDiskRadiusDegrees, -1.0, 1.0);
  return 0.5 + (u * sqrt(1.0 - u * u) + asin(u)) / pi;
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
  float apparentSunElevationDegrees
) {
  vec2 observerTexels[3];
  for (int level = 0; level < 3; ++level) {
    observerTexels[level] = uLevelOrigin[level] + outputPixel * uLevelTexelsPerOutputPixel[level];
  }
  // Upper bound of every elevation still reachable once the march has left finer levels.
  float maximum2 = texelFetch(uLevelMaximum, ivec2(2, 0), 0).r;
  float maximum1 = max(texelFetch(uLevelMaximum, ivec2(1, 0), 0).r, maximum2);
  float maximum0 = max(texelFetch(uLevelMaximum, ivec2(0, 0), 0).r, maximum1);

  float observerElevation = mosaicElevation(0, observerTexels[0]);
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

void main() {
  // Output pixel center measured from the tile's north-west corner (canvas rows are bottom-up).
  vec2 outputPixel = vec2(gl_FragCoord.x, tileSize - gl_FragCoord.y);
  float longitude = uTileLongitude.x + uTileLongitude.y * (outputPixel.x / tileSize);
  float mercatorY = uTileMercatorY.x - uTileMercatorY.y * (outputPixel.y / tileSize);
  float latitude = 2.0 * atan(exp(mercatorY)) - 0.5 * pi;

  SolarPosition sun = solarPositionAt(latitude, longitude);
  float sunlitFraction = 0.0;
  if (sun.apparentElevationDegrees > -solarDiskRadiusDegrees) {
    float horizonDegrees = horizonAngleTowardSun(
      outputPixel, latitude, sun.azimuthRadians, sun.apparentElevationDegrees
    );
    sunlitFraction = visibleSolarDiskFraction(sun.apparentElevationDegrees, horizonDegrees);
  }
  float shade = 1.0 - sunlitFraction;
  outColor = vec4(uColor * shade, shade);
}
`;
