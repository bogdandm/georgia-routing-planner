import {
  atmosphericRefractionDegrees,
  subsolarPoint,
} from '@/domain/terrain/solarPosition';
import {
  terrainShadowModel,
  visibleSolarDiskFraction,
} from '@/domain/terrain/terrainShadow';
import {
  type TerrainShadowTileAddress,
  terrainShadowMosaicMarginTexels,
  terrainShadowMosaicSize,
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
 */
export const terrainShadeFlatReferenceElevationDegrees = 10;
/** Gaussian σ of the cast-shadow soft edge, in output pixels. */
export const terrainShadowSoftEdgeSigmaPixels = 1;

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

// (latitude, longitude) in radians of an output pixel measured from the tile's north-west corner.
vec2 pixelLatitudeLongitude(vec2 outputPixel) {
  float longitude = uTileLongitude.x + uTileLongitude.y * (outputPixel.x / tileSize);
  float mercatorY = uTileMercatorY.x - uTileMercatorY.y * (outputPixel.y / tileSize);
  return vec2(2.0 * atan(exp(mercatorY)) - 0.5 * pi, longitude);
}
`;

/**
 * Visible solar-disk fraction per pixel of the tile plus a blur margin. Texture row 0 is
 * the northern edge minus the margin; the shade pass reads it with matching offsets.
 */
export const terrainShadowVisibilityFragmentShaderSource = `${terrainShadowCommonShaderSource}
const float visibilityMargin = ${glslFloat(terrainShadowVisibilityMarginPixels)};

void main() {
  vec2 outputPixel = gl_FragCoord.xy - visibilityMargin;
  vec2 latitudeLongitude = pixelLatitudeLongitude(outputPixel);
  SolarPosition sun = solarPositionAt(latitudeLongitude.x, latitudeLongitude.y);
  float sunlitFraction = 0.0;
  if (sun.apparentElevationDegrees > -solarDiskRadiusDegrees) {
    float horizonDegrees = horizonAngleTowardSun(
      outputPixel, latitudeLongitude.x, sun.azimuthRadians, sun.apparentElevationDegrees
    );
    sunlitFraction = visibleSolarDiskFraction(sun.apparentElevationDegrees, horizonDegrees);
  }
  outValue = vec4(sunlitFraction, 0.0, 0.0, 1.0);
}
`;

/**
 * Real-sun relief brightness: blurred cast-shadow visibility times Lambert slope lighting,
 * normalized so flat ground in full sun is 1. The slope term reaches 0 exactly where the
 * horizon march starts reporting self-shadow, so terminators stay continuous. Output is
 * brightness × `shadeBrightnessScale` / 255 in the red channel.
 */
export const terrainShadowShadeFragmentShaderSource = `${terrainShadowCommonShaderSource}
uniform sampler2D uVisibility;

const int visibilityMargin = ${String(terrainShadowVisibilityMarginPixels)};
const float softEdgeSigma = ${glslFloat(terrainShadowSoftEdgeSigmaPixels)};
const float flatReferenceElevationDegrees = ${glslFloat(terrainShadeFlatReferenceElevationDegrees)};
const float brightnessScale = ${glslFloat(shadeBrightnessScale)};

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
  float brightness = visibility * max(dot(normal, toSun), 0.0)
    / max(toSun.z, sin(radians(flatReferenceElevationDegrees)));
  outValue = vec4(clamp(brightness * brightnessScale / 255.0, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

type Rgb = readonly [number, number, number];

/**
 * RGBA8 colors for every shade byte, written byte-wise so the table is endian-safe when
 * read through a `Uint32Array`. Bytes up to 127 fade `shadowColor` in as brightness drops;
 * brighter bytes fade `highlightColor` in up to `highlightOpacity`. Colors are not
 * premultiplied (ImageData semantics).
 */
export function createShadeLookupTable(
  shadowColor: Rgb,
  highlightColor: Rgb,
  highlightOpacity: number,
): Uint32Array {
  const table = new Uint32Array(256);
  const bytes = new Uint8Array(table.buffer);
  for (let value = 0; value < 256; value += 1) {
    const brightness = value / shadeBrightnessScale;
    const [color, alpha] =
      brightness <= 1
        ? [shadowColor, 1 - brightness]
        : [highlightColor, Math.min(brightness - 1, 1) * highlightOpacity];
    bytes.set([color[0], color[1], color[2], Math.round(alpha * 255)], value * 4);
  }
  return table;
}

/** Expands a one-byte-per-pixel 512 px shade mask into ImageData RGBA bytes. */
export function expandShadeMask(
  mask: Uint8Array,
  table: Uint32Array,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(
    terrainShadowTileSize * terrainShadowTileSize * 4,
  );
  const pixels32 = new Uint32Array(pixels.buffer);
  for (let index = 0; index < pixels32.length; index += 1) {
    pixels32[index] = table[mask[index] ?? 0] ?? 0;
  }
  return pixels;
}

/** Below this true elevation even the refracted upper limb is under a flat horizon. */
const flatGroundNightElevationDegrees = -2;

/**
 * The shade pass's flat-ground brightness, computed on the CPU for tiles too coarse for
 * terrain shadows: the visible solar-disk fraction above a level horizon times the Sun's
 * height normalized like the GPU pass, so zoomed-out maps show day, twilight, and night.
 */
export function flatGroundShadeMask(
  output: TerrainShadowTileAddress,
  instantMs: number,
): Uint8Array {
  const size = terrainShadowTileSize;
  const geometry = terrainShadowTileGeometry(output);
  const sun = subsolarPoint(new Date(instantMs));
  const sinDeclination = Math.sin(sun.declinationRadians);
  const cosDeclination = Math.cos(sun.declinationRadians);
  const fullSunSine = Math.sin(
    (terrainShadeFlatReferenceElevationDegrees * Math.PI) / 180,
  );
  const nightSine = Math.sin((flatGroundNightElevationDegrees * Math.PI) / 180);
  // Pixel centers, as in the GPU passes: row 0 is the northern edge.
  const cosHourAngles = Float64Array.from({ length: size }, (_, column) =>
    Math.cos(
      geometry.westLongitudeRadians +
        (geometry.longitudeSpanRadians * (column + 0.5)) / size -
        sun.longitudeRadians,
    ),
  );
  const mask = new Uint8Array(size * size);
  for (let row = 0; row < size; row += 1) {
    const mercatorY =
      geometry.northMercatorY - (geometry.mercatorYSpan * (row + 0.5)) / size;
    const latitude = 2 * Math.atan(Math.exp(mercatorY)) - Math.PI / 2;
    const sinTerm = Math.sin(latitude) * sinDeclination;
    const cosTerm = Math.cos(latitude) * cosDeclination;
    for (let column = 0; column < size; column += 1) {
      const sinElevation = sinTerm + cosTerm * (cosHourAngles[column] ?? 0);
      let value = 0;
      if (sinElevation >= fullSunSine) {
        // Refraction only raises the Sun, so flat ground is in full sun.
        value = shadeBrightnessScale;
      } else if (sinElevation > nightSine) {
        const elevationDegrees = (Math.asin(sinElevation) * 180) / Math.PI;
        const apparentDegrees =
          elevationDegrees + atmosphericRefractionDegrees(elevationDegrees);
        const apparentSine = Math.sin((apparentDegrees * Math.PI) / 180);
        const brightness =
          (visibleSolarDiskFraction(apparentDegrees, 0) * Math.max(apparentSine, 0)) /
          Math.max(apparentSine, fullSunSine);
        value = Math.round(Math.min(brightness * shadeBrightnessScale, 255));
      }
      mask[row * size + column] = value;
    }
  }
  return mask;
}
