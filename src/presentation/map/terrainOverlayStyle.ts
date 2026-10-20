import type {
  HillshadeLayerSpecification,
  LineLayerSpecification,
  RasterDEMSourceSpecification,
  SymbolLayerSpecification,
  VectorSourceSpecification,
} from 'maplibre-gl';

import type { TerrainDemTileSize } from '@/application/ports/MapLayerPreferencesRepository';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import { mapSourceIds, terrainOverlayLayerIds } from '@/presentation/map/mapIds';
import {
  mapVisualModePaint,
  mapVisualPalette,
} from '@/presentation/map/mapVisualPalette';

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
