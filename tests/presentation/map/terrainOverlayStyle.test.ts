import { describe, expect, it } from 'vitest';

import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import { mapSourceIds, terrainOverlayLayerIds } from '@/presentation/map/mapIds';
import { createTerrainDemSource } from '@/presentation/map/terrainOverlayStyle';

describe('terrain overlay style contracts', () => {
  it('loads the provider raster DEM directly from validated configuration', () => {
    const configuration = parseMapProviderConfiguration(
      defaultMapProviderConfigurationInput,
      'https://example.test/app/',
    );

    expect(createTerrainDemSource(configuration.terrain)).toEqual({
      type: 'raster-dem',
      tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
      tileSize: 512,
      minzoom: 0,
      maxzoom: 12,
      encoding: 'terrarium',
      attribution: configuration.terrain.attribution,
    });
  });

  it('keeps terrain source and overlay layer IDs unique', () => {
    const ids = [
      ...Object.values(mapSourceIds),
      ...Object.values(terrainOverlayLayerIds),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
