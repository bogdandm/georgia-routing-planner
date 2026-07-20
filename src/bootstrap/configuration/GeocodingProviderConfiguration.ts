import { z } from 'zod';

const schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9-]+$/u),
    searchUrl: z.url().startsWith('https://'),
    attribution: z.string().trim().min(1).max(200),
    minimumRequestIntervalMs: z.number().int().min(1_000).max(60_000),
    requestTimeoutMs: z.number().int().min(1_000).max(30_000),
    maximumResults: z.number().int().min(1).max(10),
  })
  .strict();

export type GeocodingProviderConfiguration = z.infer<typeof schema>;
export type GeocodingProviderConfigurationResult =
  | { readonly status: 'valid'; readonly value: GeocodingProviderConfiguration }
  | { readonly status: 'invalid' };

export const defaultGeocodingProviderConfiguration = {
  schemaVersion: 1,
  id: 'osm-nominatim-public',
  searchUrl: 'https://nominatim.openstreetmap.org/search',
  attribution: 'Search data © OpenStreetMap contributors',
  minimumRequestIntervalMs: 1_000,
  requestTimeoutMs: 12_000,
  maximumResults: 10,
} as const satisfies GeocodingProviderConfiguration;

export function loadGeocodingProviderConfiguration(
  serialized: string | undefined,
): GeocodingProviderConfigurationResult {
  try {
    const input =
      serialized === undefined || serialized.trim() === ''
        ? defaultGeocodingProviderConfiguration
        : (JSON.parse(serialized) as unknown);
    return { status: 'valid', value: schema.parse(input) };
  } catch {
    return { status: 'invalid' };
  }
}
