import { describe, expect, it } from 'vitest';

import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import { mapSourceIds, terrainOverlayLayerIds } from '@/presentation/map/mapIds';
import {
  createSunShadowLayer,
  createSunShadowSource,
  createTerrainDemSource,
} from '@/presentation/map/terrainOverlayStyle';

describe('terrain overlay style contracts', () => {
  it('loads the provider raster DEM with the requested declared tile size', () => {
    const configuration = parseMapProviderConfiguration(
      defaultMapProviderConfigurationInput,
      'https://example.test/app/',
    );

    expect(createTerrainDemSource(configuration.terrain, 256)).toEqual({
      type: 'raster-dem',
      tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 12,
      encoding: 'terrarium',
      attribution: configuration.terrain.attribution,
    });
  });

  it('keeps map source IDs and terrain overlay layer IDs unique', () => {
    const sourceIds = Object.values(mapSourceIds);
    const layerIds = Object.values(terrainOverlayLayerIds);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
    expect(new Set(layerIds).size).toBe(layerIds.length);
  });

  it('serves sun shadows from the shadow zoom up to the DEM maximum without fading', () => {
    const configuration = parseMapProviderConfiguration(
      defaultMapProviderConfigurationInput,
      'https://example.test/app/',
    );
    const tileUrl = 'terrain-shadow://29000000/{z}/{x}/{y}';

    expect(createSunShadowSource(configuration.terrain, tileUrl)).toEqual({
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 512,
      minzoom: 7,
      maxzoom: 12,
      attribution: configuration.terrain.attribution,
    });
    expect(createSunShadowLayer()).toMatchObject({
      source: mapSourceIds.terrainSunShadow,
      paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
    });
  });
});
