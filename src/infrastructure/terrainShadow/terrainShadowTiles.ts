/** Edge length of every DEM tile and of every rendered shade tile, in pixels. */
export const terrainShadowTileSize = 512;

/** Each LOD level is a 3×3 DEM mosaic centered on the ancestor of the output tile. */
export const terrainShadowMosaicTiles = 3;
export const terrainShadowMosaicSize = terrainShadowMosaicTiles * terrainShadowTileSize;

/** Bilinear sampling needs one texel of mosaic data around every sample position. */
export const terrainShadowMosaicMarginTexels = 1;

export interface TerrainShadowTileAddress {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/**
 * One LOD level of an output tile. Texel coordinates grow east and south from the
 * mosaic's north-west corner; texel centers sit at `i + 0.5`.
 */
export interface TerrainShadowMosaicLevel {
  readonly zoom: number;
  /** Row-major 3×3 from north-west; `null` rows lie outside the world (sea level). */
  readonly tiles: readonly (TerrainShadowTileAddress | null)[];
  /** North-west corner of the output tile in mosaic texels. */
  readonly outputOriginTexels: readonly [x: number, y: number];
  readonly texelsPerOutputPixel: number;
  /** Mosaic texels per radian of longitude and per unit of Mercator y. */
  readonly texelsPerRadian: number;
}

/** Output-tile edges in radians of longitude and Web Mercator y (north positive). */
export interface TerrainShadowTileGeometry {
  readonly westLongitudeRadians: number;
  readonly longitudeSpanRadians: number;
  readonly northMercatorY: number;
  readonly mercatorYSpan: number;
}

/** DEM zooms for L0, L1, L2: z, z − 2, z − 4, clamped to the provider zoom range. */
export function terrainShadowLevelZooms(
  z: number,
  demMinZoom: number,
  demMaxZoom: number,
): readonly [number, number, number] {
  const clamp = (zoom: number) => Math.min(Math.max(zoom, demMinZoom), demMaxZoom);
  return [clamp(z), clamp(z - 2), clamp(z - 4)];
}

/** Plans the 3×3 DEM mosaic at `zoom` (≤ output zoom) that surrounds the output tile. */
export function terrainShadowMosaicLevel(
  output: TerrainShadowTileAddress,
  zoom: number,
): TerrainShadowMosaicLevel {
  if (zoom > output.z)
    throw new RangeError('A DEM level cannot be finer than its tile.');
  const tileCount = 2 ** zoom;
  const descendants = 2 ** (output.z - zoom);
  const ancestorX = Math.floor(output.x / descendants);
  const ancestorY = Math.floor(output.y / descendants);
  const tiles: (TerrainShadowTileAddress | null)[] = [];
  for (let row = -1; row <= 1; row += 1) {
    for (let column = -1; column <= 1; column += 1) {
      const y = ancestorY + row;
      const x = (((ancestorX + column) % tileCount) + tileCount) % tileCount;
      tiles.push(y < 0 || y >= tileCount ? null : { z: zoom, x, y });
    }
  }
  const texelsPerOutputPixel = 1 / descendants;
  const outputStepTexels = terrainShadowTileSize * texelsPerOutputPixel;
  return {
    zoom,
    tiles,
    // The ancestor occupies the center slot, one DEM tile from the mosaic corner.
    outputOriginTexels: [
      terrainShadowTileSize + (output.x - ancestorX * descendants) * outputStepTexels,
      terrainShadowTileSize + (output.y - ancestorY * descendants) * outputStepTexels,
    ],
    texelsPerOutputPixel,
    texelsPerRadian: (tileCount * terrainShadowTileSize) / (2 * Math.PI),
  };
}

/** Mirrors the GLSL coverage test: a sample needs a full bilinear footprint. */
export function mosaicContainsWithMargin(xTexels: number, yTexels: number): boolean {
  const low = terrainShadowMosaicMarginTexels;
  const high = terrainShadowMosaicSize - terrainShadowMosaicMarginTexels;
  return xTexels >= low && xTexels <= high && yTexels >= low && yTexels <= high;
}

export function terrainShadowTileGeometry(
  output: TerrainShadowTileAddress,
): TerrainShadowTileGeometry {
  const span = (2 * Math.PI) / 2 ** output.z;
  return {
    westLongitudeRadians: output.x * span - Math.PI,
    longitudeSpanRadians: span,
    northMercatorY: Math.PI - output.y * span,
    mercatorYSpan: span,
  };
}

export function demTileUrl(template: string, tile: TerrainShadowTileAddress): string {
  return template
    .replaceAll('{z}', String(tile.z))
    .replaceAll('{x}', String(tile.x))
    .replaceAll('{y}', String(tile.y));
}
