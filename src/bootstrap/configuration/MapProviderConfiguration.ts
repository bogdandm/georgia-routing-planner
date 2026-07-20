import { z } from 'zod';

function isApplicationRelativeEndpoint(value: string): boolean {
  if (value.startsWith('//') || value.includes('\\')) return false;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) return false;
  return /^(?:\/|\.\.?\/|[a-z0-9_{])/iu.test(value);
}

const endpointSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => value.startsWith('https://') || isApplicationRelativeEndpoint(value),
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
        filter: z
          .object({
            minimumElevationMeters: z.number().min(-12_000).max(0),
            maximumElevationMeters: z.number().min(1_000).max(12_000),
            sentinelElevationsMeters: z.array(z.number()).max(8),
            spikeThresholdMeters: z.number().positive().max(5_000),
            maximumNeighborMadMeters: z.number().positive().max(1_000),
            minimumConsensusNeighbors: z.number().int().min(3).max(8),
            maximumSpikeSupportNeighbors: z.number().int().min(0).max(3),
            cacheSize: z.number().int().min(8).max(128),
          })
          .strict(),
        overlays: z
          .object({
            contourMinZoom: z.number().int().min(0).max(22),
            contourMaxZoom: z.number().int().min(0).max(22),
            contourCacheSize: z.number().int().min(8).max(128),
          })
          .strict(),
      })
      .strict()
      .superRefine((terrain, context) => {
        if (terrain.maxZoom <= terrain.minZoom) {
          context.addIssue({
            code: 'custom',
            message: 'Terrain maxZoom must be greater than minZoom.',
            path: ['maxZoom'],
          });
        }
        if (terrain.overlays.contourMaxZoom < terrain.overlays.contourMinZoom) {
          context.addIssue({
            code: 'custom',
            message: 'Contour maxZoom must not be less than contourMinZoom.',
            path: ['overlays', 'contourMaxZoom'],
          });
        }
        if (terrain.overlays.contourMaxZoom > terrain.maxZoom) {
          context.addIssue({
            code: 'custom',
            message: 'Contour maxZoom must not exceed the terrain provider maxZoom.',
            path: ['overlays', 'contourMaxZoom'],
          });
        }
        if (
          terrain.filter.minimumElevationMeters >= terrain.filter.maximumElevationMeters
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Terrain filter minimum elevation must be below its maximum.',
            path: ['filter', 'maximumElevationMeters'],
          });
        }
        if (
          terrain.filter.minimumConsensusNeighbors +
            terrain.filter.maximumSpikeSupportNeighbors >
          8
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Terrain filter neighbor thresholds must fit an 8-pixel window.',
            path: ['filter', 'minimumConsensusNeighbors'],
          });
        }
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
        renderer: z
          .object({
            id: z.string().regex(/^[a-z0-9-]+$/u),
            tileUrlTemplate: endpointSchema.refine(
              (value) =>
                value.includes('{z}') &&
                value.includes('{x}') &&
                value.includes('{y}') &&
                value.includes('{itemUrl}') &&
                value.includes('{reflectanceMax}') &&
                value.includes('{gamma}') &&
                value.includes('{saturation}'),
              'Satellite renderer endpoint must contain map, item, and rendering-tuning tokens.',
            ),
            tileSize: z.union([z.literal(256), z.literal(512)]),
            minZoom: z.number().int().min(0).max(22),
            maxZoom: z.number().int().min(0).max(22),
            requestTimeoutMs: z.number().int().min(5_000).max(180_000),
            attribution: safeAttributionSchema,
          })
          .strict()
          .refine((renderer) => renderer.maxZoom > renderer.minZoom, {
            message: 'Satellite renderer maxZoom must be greater than minZoom.',
            path: ['maxZoom'],
          }),
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
    /** Conservative Terrarium repair policy, expressed in decoded elevation metres. */
    readonly filter: {
      readonly minimumElevationMeters: number;
      readonly maximumElevationMeters: number;
      readonly sentinelElevationsMeters: readonly number[];
      readonly spikeThresholdMeters: number;
      readonly maximumNeighborMadMeters: number;
      readonly minimumConsensusNeighbors: number;
      readonly maximumSpikeSupportNeighbors: number;
      readonly cacheSize: number;
    };
    readonly overlays: {
      readonly contourMinZoom: number;
      readonly contourMaxZoom: number;
      readonly contourCacheSize: number;
    };
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
    readonly renderer: {
      readonly id: string;
      readonly tileUrlTemplate: string;
      readonly tileSize: 256 | 512;
      readonly minZoom: number;
      readonly maxZoom: number;
      /** Maximum wait for visible rendered imagery tiles on slow connections. */
      readonly requestTimeoutMs: number;
      readonly attribution: string;
    };
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
  readonly satelliteRendererId: string;
  readonly satelliteRendererOrigin: string;
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
    filter: {
      minimumElevationMeters: -500,
      maximumElevationMeters: 9_000,
      sentinelElevationsMeters: [-32_768],
      spikeThresholdMeters: 500,
      maximumNeighborMadMeters: 80,
      minimumConsensusNeighbors: 5,
      maximumSpikeSupportNeighbors: 1,
      cacheSize: 48,
    },
    overlays: {
      contourMinZoom: 11,
      contourMaxZoom: 15,
      contourCacheSize: 32,
    },
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
    maximumPages: 10,
    renderer: {
      id: 'titiler-demo-stac-rgb',
      tileUrlTemplate:
        'https://titiler.xyz/stac/tiles/WebMercatorQuad/{z}/{x}/{y}.webp?url={itemUrl}&assets=red&assets=green&assets=blue&asset_as_band=true&rescale=0%2C{reflectanceMax}&rescale=0%2C{reflectanceMax}&rescale=0%2C{reflectanceMax}&color_formula=Gamma%20RGB%20{gamma}%2C%20Saturation%20{saturation}&resampling=bilinear&reproject=bilinear',
      tileSize: 256,
      minZoom: 5,
      maxZoom: 16,
      requestTimeoutMs: 60_000,
      attribution:
        'Copernicus Sentinel data · COG tiles rendered by TiTiler / Development Seed',
    },
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
      renderer: {
        ...parsed.satellite.renderer,
        tileUrlTemplate: resolveEndpoint(
          parsed.satellite.renderer.tileUrlTemplate,
          baseUrl,
        ),
      },
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
    satelliteRendererId: configuration.satellite.renderer.id,
    satelliteRendererOrigin: new URL(configuration.satellite.renderer.tileUrlTemplate)
      .origin,
  };
}
