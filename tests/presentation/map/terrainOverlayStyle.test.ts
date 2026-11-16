import { describe, expect, it } from 'vitest';

import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import { mapSourceIds, terrainOverlayLayerIds } from '@/presentation/map/mapIds';
import {
  createSunShadowLayer,
  createSunShadowSky,
  createSunShadowSource,
  createTerrainDemSource,
} from '@/presentation/map/terrainOverlayStyle';

function skyChannels(color: unknown): readonly number[] {
  const channels = /^rgb\((\d+), (\d+), (\d+)\)$/u.exec(String(color))?.slice(1);
  if (channels === undefined) throw new Error(`Not an rgb() color: ${String(color)}`);
  return channels.map(Number);
}

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

  it('turns the sky from day blue to a warm sunset horizon and dark night', () => {
    const day = createSunShadowSky(45, 0);
    expect(day).toMatchObject({
      'sky-color': 'rgb(93, 155, 219)',
      'horizon-color': 'rgb(213, 228, 240)',
      'fog-color': 'rgb(207, 220, 231)',
    });

    const [red, green, blue] = skyChannels(createSunShadowSky(1, 0)['horizon-color']);
    expect(red).toBeGreaterThan(green ?? 255);
    expect(green).toBeGreaterThan(blue ?? 255);
    // Thinner air above a summit reddens the same low Sun less.
    const summit = skyChannels(createSunShadowSky(1, 6000)['horizon-color']);
    expect(summit[1]).toBeGreaterThan(green ?? 255);

    expect(createSunShadowSky(-8, 0)).toMatchObject({
      'sky-color': 'rgb(10, 15, 30)',
      'horizon-color': 'rgb(22, 30, 54)',
      'fog-color': 'rgb(18, 26, 44)',
    });
  });
});
