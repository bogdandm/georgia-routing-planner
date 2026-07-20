import { describe, expect, it } from 'vitest';

import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import { mapSourceIds, terrainOverlayLayerIds } from '@/presentation/map/mapIds';
import { createTerrainDemSource } from '@/presentation/map/terrainOverlayStyle';

describe('terrain overlay style contracts', () => {
  it('creates a bounded raster DEM source from validated provider configuration', () => {
    const configuration = parseMapProviderConfiguration(
      defaultMapProviderConfigurationInput,
      'https://example.test/app/',
    );

    expect(
      createTerrainDemSource(
        configuration.terrain,
        'georgia-terrain-shared://{z}/{x}/{y}',
      ),
    ).toEqual({
      type: 'raster-dem',
      tiles: ['georgia-terrain-shared://{z}/{x}/{y}'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 15,
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
