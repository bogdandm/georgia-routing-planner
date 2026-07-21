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
    expect(configuration).toMatchObject({
      schemaVersion: 1,
      encoding: 'terrarium',
      maximumSourceZoom: 15,
      requestTimeoutMs: 10_000,
      filter: {
        spikeThresholdMeters: 500,
        negativeSpikeThresholdMeters: 300,
      },
    });
    expect(configuration).not.toHaveProperty('id');
    expect(configuration).not.toHaveProperty('label');
    expect(configuration).not.toHaveProperty('presentationNote');
    expect(configuration).not.toHaveProperty('overlays');
  });
});
