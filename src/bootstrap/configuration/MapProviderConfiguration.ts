import { z } from 'zod';

const endpointSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      value.startsWith('https://') ||
      value.startsWith('/') ||
      value.startsWith('./') ||
      !value.includes('://'),
    'Endpoints must use HTTPS or a relative application path.',
  );

const safeAttributionSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => !/<script|javascript:|\son\w+\s*=/iu.test(value),
    'Attribution contains unsafe markup.',
  );

const sourceLayerMappingSchema = z
  .object({
    landcover: z.string().min(1),
    landuse: z.string().min(1),
    parks: z.string().min(1),
    water: z.string().min(1),
    waterways: z.string().min(1),
    boundaries: z.string().min(1),
    transportation: z.string().min(1),
    transportationNames: z.string().min(1),
    peaks: z.string().min(1),
    pois: z.string().min(1),
    places: z.string().min(1),
    waterNames: z.string().min(1),
  })
  .strict();

const mapProviderConfigurationInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    vector: z
      .object({
        id: z.string().regex(/^[a-z0-9-]+$/u),
        label: z.string().min(1).max(80),
        tileJsonUrl: endpointSchema,
        glyphsUrl: endpointSchema.refine(
          (value) => value.includes('{fontstack}') && value.includes('{range}'),
          'Glyph endpoint must contain {fontstack} and {range}.',
        ),
        attribution: safeAttributionSchema,
        sourceLayers: sourceLayerMappingSchema,
      })
      .strict(),
    terrain: z
      .object({
        id: z.string().regex(/^[a-z0-9-]+$/u),
        label: z.string().min(1).max(80),
        tileUrl: endpointSchema.refine(
          (value) =>
            value.includes('{z}') && value.includes('{x}') && value.includes('{y}'),
          'Terrain endpoint must contain {z}, {x}, and {y}.',
        ),
        encoding: z.enum(['mapbox', 'terrarium']),
        tileSize: z.union([z.literal(256), z.literal(512)]),
        minZoom: z.number().int().min(0).max(22),
        maxZoom: z.number().int().min(0).max(22),
        attribution: safeAttributionSchema,
        exaggeration: z.number().min(1).max(2),
      })
      .strict()
      .refine((terrain) => terrain.maxZoom > terrain.minZoom, {
        message: 'Terrain maxZoom must be greater than minZoom.',
        path: ['maxZoom'],
      }),
    satellite: z
      .object({
        id: z.string().regex(/^[a-z0-9-]+$/u),
        label: z.string().min(1).max(80),
        searchUrl: endpointSchema,
        collections: z
          .object({
            L1C: z.string().min(1).max(80),
            L2A: z.string().min(1).max(80),
          })
          .strict()
          .refine((collections) => collections.L1C !== collections.L2A, {
            message: 'Satellite collections must be distinct.',
          }),
        attribution: z.string().trim().min(1).max(200),
        maximumPages: z.number().int().min(1).max(10),
      })
      .strict(),
    policy: z
      .object({
        requestTimeoutMs: z.number().int().min(1_000).max(30_000),
        equivalentErrorWindowMs: z.number().int().min(1_000).max(60_000),
      })
      .strict(),
  })
  .strict();

interface MapProviderConfigurationInput {
  readonly schemaVersion: 1;
  readonly vector: {
    readonly id: string;
    readonly label: string;
    readonly tileJsonUrl: string;
    readonly glyphsUrl: string;
    readonly attribution: string;
    readonly sourceLayers: {
      readonly landcover: string;
      readonly landuse: string;
      readonly parks: string;
      readonly water: string;
      readonly waterways: string;
      readonly boundaries: string;
      readonly transportation: string;
      readonly transportationNames: string;
      readonly peaks: string;
      readonly pois: string;
      readonly places: string;
      readonly waterNames: string;
    };
  };
  readonly terrain: {
    readonly id: string;
    readonly label: string;
    readonly tileUrl: string;
    readonly encoding: 'mapbox' | 'terrarium';
    readonly tileSize: 256 | 512;
    readonly minZoom: number;
    readonly maxZoom: number;
    readonly attribution: string;
    readonly exaggeration: number;
  };
  readonly satellite: {
    readonly id: string;
    readonly label: string;
    readonly searchUrl: string;
    readonly collections: {
      readonly L1C: string;
      readonly L2A: string;
    };
    readonly attribution: string;
    readonly maximumPages: number;
  };
  readonly policy: {
    readonly requestTimeoutMs: number;
    readonly equivalentErrorWindowMs: number;
  };
}

export type MapProviderConfiguration = MapProviderConfigurationInput;

export type MapProviderConfigurationResult =
  | { readonly status: 'valid'; readonly value: MapProviderConfiguration }
  | { readonly status: 'invalid'; readonly message: string };

export interface MapProviderConfigurationSummary {
  readonly schemaVersion: 1;
  readonly vectorId: string;
  readonly vectorOrigin: string;
  readonly terrainId: string;
  readonly terrainOrigin: string;
  readonly satelliteId: string;
  readonly satelliteOrigin: string;
}

/** Anonymous, credential-free provider defaults used when no public override is supplied. */
export const defaultMapProviderConfigurationInput = {
  schemaVersion: 1,
  vector: {
    id: 'openfreemap-openmaptiles',
    label: 'OpenFreeMap',
    tileJsonUrl: 'https://tiles.openfreemap.org/planet',
    glyphsUrl: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    attribution:
      '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> · Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    sourceLayers: {
      landcover: 'landcover',
      landuse: 'landuse',
      parks: 'park',
      water: 'water',
      waterways: 'waterway',
      boundaries: 'boundary',
      transportation: 'transportation',
      transportationNames: 'transportation_name',
      peaks: 'mountain_peak',
      pois: 'poi',
      places: 'place',
      waterNames: 'water_name',
    },
  },
  terrain: {
    id: 'aws-mapzen-terrarium',
    label: 'AWS Open Data Terrain Tiles',
    tileUrl: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    encoding: 'terrarium',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 15,
    attribution:
      'Terrain data: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">Mapzen/AWS Open Data providers</a>',
    exaggeration: 1.15,
  },
  satellite: {
    id: 'earth-search-v1',
    label: 'Earth Search',
    searchUrl: 'https://earth-search.aws.element84.com/v1/search',
    collections: {
      L1C: 'sentinel-2-l1c',
      L2A: 'sentinel-2-l2a',
    },
    attribution: 'Copernicus Sentinel data · Earth Search / Element 84',
    maximumPages: 5,
  },
  policy: {
    requestTimeoutMs: 15_000,
    equivalentErrorWindowMs: 10_000,
  },
} as const satisfies MapProviderConfigurationInput;

function resolveEndpoint(value: string, baseUrl: string): string {
  return new URL(value, baseUrl)
    .toString()
    .replaceAll('%7B', '{')
    .replaceAll('%7D', '}');
}

/** Validates provider input and resolves application-relative endpoints against `baseUrl`. */
export function parseMapProviderConfiguration(
  input: unknown,
  baseUrl: string,
): MapProviderConfiguration {
  const parsed = mapProviderConfigurationInputSchema.parse(input);
  return {
    ...parsed,
    vector: {
      ...parsed.vector,
      tileJsonUrl: resolveEndpoint(parsed.vector.tileJsonUrl, baseUrl),
      glyphsUrl: resolveEndpoint(parsed.vector.glyphsUrl, baseUrl),
    },
    terrain: {
      ...parsed.terrain,
      tileUrl: resolveEndpoint(parsed.terrain.tileUrl, baseUrl),
    },
    satellite: {
      ...parsed.satellite,
      searchUrl: resolveEndpoint(parsed.satellite.searchUrl, baseUrl),
    },
  };
}

/**
 * Loads the optional serialized Vite override and fails closed with a payload-safe
 * message. The returned error never echoes provider URLs or configuration contents.
 */
export function loadMapProviderConfiguration(
  serializedOverride: string | undefined,
  baseUrl: string,
): MapProviderConfigurationResult {
  try {
    const input =
      serializedOverride === undefined || serializedOverride.trim() === ''
        ? defaultMapProviderConfigurationInput
        : (JSON.parse(serializedOverride) as unknown);
    return { status: 'valid', value: parseMapProviderConfiguration(input, baseUrl) };
  } catch (error) {
    const issueCount = error instanceof z.ZodError ? error.issues.length : 1;
    return {
      status: 'invalid',
      message: `Map provider configuration is invalid (${String(issueCount)} validation issue${issueCount === 1 ? '' : 's'}). Check the public VITE_MAP_PROVIDER_CONFIGURATION setting.`,
    };
  }
}

/** Reduces provider configuration to identifiers and origins safe for diagnostics. */
export function summarizeMapProviderConfiguration(
  configuration: MapProviderConfiguration,
): MapProviderConfigurationSummary {
  return {
    schemaVersion: 1,
    vectorId: configuration.vector.id,
    vectorOrigin: new URL(configuration.vector.tileJsonUrl).origin,
    terrainId: configuration.terrain.id,
    terrainOrigin: new URL(configuration.terrain.tileUrl).origin,
    satelliteId: configuration.satellite.id,
    satelliteOrigin: new URL(configuration.satellite.searchUrl).origin,
  };
}
