import { describe, expect, it } from 'vitest';

import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import {
  terrainComputeConfigurationSchema,
  toTerrainComputeConfiguration,
} from '@/infrastructure/elevation/TerrainComputeConfiguration';

describe('TerrainComputeConfiguration', () => {
  it('maps the current canonical provider configuration to a narrow worker DTO', () => {
    const terrain = parseMapProviderConfiguration(
      defaultMapProviderConfigurationInput,
      'https://example.test/',
    ).terrain;
    const providerWithUnrelatedMetadata = {
      ...terrain,
      presentationNote: 'must not cross the worker boundary',
    };

    const configuration = toTerrainComputeConfiguration(
      providerWithUnrelatedMetadata,
      10_000,
    );

    expect(terrainComputeConfigurationSchema.parse(configuration)).toEqual(
      configuration,
    );
    expect(configuration).toEqual({
      schemaVersion: 2,
      tileUrl: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
      encoding: 'terrarium',
      maximumSourceZoom: 12,
      contourCacheSize: 32,
      requestTimeoutMs: 10_000,
    });
  });
});
