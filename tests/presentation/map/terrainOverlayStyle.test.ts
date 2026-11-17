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
  defaultSunShadowAtmosphere,
  type SunShadowAtmosphere,
} from '@/presentation/map/terrainOverlayStyle';

const atmosphere = defaultSunShadowAtmosphere;

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

  it('serves sun shadows from the world view up to the DEM maximum without fading', () => {
    const configuration = parseMapProviderConfiguration(
      defaultMapProviderConfigurationInput,
      'https://example.test/app/',
    );
    const tileUrl = 'terrain-shadow://29000000/{z}/{x}/{y}';

    expect(createSunShadowSource(configuration.terrain, tileUrl)).toEqual({
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 512,
      maxzoom: 12,
      attribution: configuration.terrain.attribution,
    });
    expect(createSunShadowLayer(0.5)).toMatchObject({
      source: mapSourceIds.terrainSunShadow,
      paint: {
        'raster-opacity': 0.5,
        'raster-fade-duration': 0,
        'raster-resampling': 'linear',
      },
    });
  });

  it('turns the sky from day blue to a warm sunset horizon and dark night', () => {
    // By day and night the camera direction does not matter.
    for (const cosineToSun of [1, -1]) {
      expect(createSunShadowSky(45, 0, cosineToSun, atmosphere)).toMatchObject({
        'sky-color': 'rgb(93, 155, 219)',
        'horizon-color': 'rgb(213, 228, 240)',
        'fog-color': 'rgb(207, 220, 231)',
      });
      expect(createSunShadowSky(-8, 0, cosineToSun, atmosphere)).toMatchObject({
        'sky-color': 'rgb(10, 15, 30)',
        'horizon-color': 'rgb(22, 30, 54)',
        'fog-color': 'rgb(18, 26, 44)',
      });
    }

    const [red, green, blue] = skyChannels(
      createSunShadowSky(1, 0, 1, atmosphere)['horizon-color'],
    );
    expect(red).toBeGreaterThan(green ?? 255);
    expect(green).toBeGreaterThan(blue ?? 255);
    // Thinner air above a summit reddens the same low Sun less.
    const summit = skyChannels(
      createSunShadowSky(1, 6000, 1, atmosphere)['horizon-color'],
    );
    expect(summit[1]).toBeGreaterThan(green ?? 255);
  });

  it('puts the sunset glow on the Sun side and a rose band on the far side', () => {
    const toward = createSunShadowSky(1, 0, 1, atmosphere);
    const away = createSunShadowSky(1, 0, -1, atmosphere);
    const [towardRed = 0, , towardBlue = 0] = skyChannels(toward['horizon-color']);
    const [awayRed = 0, awayGreen = 0, awayBlue = 0] = skyChannels(
      away['horizon-color'],
    );
    expect(towardRed - towardBlue).toBeGreaterThan(awayRed - awayBlue);
    expect(awayBlue).toBeGreaterThan(awayGreen);
    // Sunlit haze stays warmer than blue on both sides; with a stronger glow toward the
    // Sun than away from it, it is warmest toward the Sun.
    const [awayFogRed = 0, , awayFogBlue = 0] = skyChannels(away['fog-color']);
    expect(awayFogRed).toBeGreaterThan(awayFogBlue);
    const directional: SunShadowAtmosphere = {
      ...atmosphere,
      glowStrength: { ...atmosphere.glowStrength, fog: 0.8, awayFog: 0.3 },
    };
    const [towardFogRed = 0, , towardFogBlue = 0] = skyChannels(
      createSunShadowSky(1, 0, 1, directional)['fog-color'],
    );
    const [directionalAwayRed = 0, , directionalAwayBlue = 0] = skyChannels(
      createSunShadowSky(1, 0, -1, directional)['fog-color'],
    );
    expect(towardFogRed - towardFogBlue).toBeGreaterThan(
      directionalAwayRed - directionalAwayBlue,
    );
  });

  it('draws a tuned atmosphere: its colors, glow strengths, and blends', () => {
    const tuned: SunShadowAtmosphere = {
      ...atmosphere,
      day: { sky: '#102030', horizon: '#405060', fog: '#708090' },
      glowStrength: { horizon: 0, fog: 0, awayHorizon: 0, awayFog: 0 },
      blends: { fogGround: 0.1, horizonFog: 0.2, skyHorizon: 0.3 },
    };
    expect(createSunShadowSky(45, 0, 1, tuned)).toEqual({
      'sky-color': 'rgb(16, 32, 48)',
      'horizon-color': 'rgb(64, 80, 96)',
      'fog-color': 'rgb(112, 128, 144)',
      'fog-ground-blend': 0.1,
      'horizon-fog-blend': 0.2,
      'sky-horizon-blend': 0.3,
      'atmosphere-blend': 0,
    });
  });
});
