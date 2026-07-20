import { HTTPError, TimeoutError, type KyInstance } from 'ky';
import { z } from 'zod';

import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import {
  SatelliteCatalogError,
  type SatelliteCatalogGateway,
  type SatelliteCatalogQuery,
  type SatelliteCatalogRequestContext,
  type SatelliteCatalogResult,
} from '@/application/ports/SatelliteCatalogGateway';
import type {
  SentinelQueryDiagnostics,
  SentinelQueryStepId,
} from '@/application/ports/SentinelQueryDiagnostics';
import type { MapProviderConfiguration } from '@/bootstrap/configuration/MapProviderConfiguration';
import type { SatelliteProductLevel } from '@/domain/satellite/SatelliteSearchCriteria';
import type {
  SatelliteScene,
  SatelliteVisualAsset,
} from '@/domain/satellite/SatelliteScene';
import {
  earthSearchFeatureCollectionSchema,
  earthSearchItemSchema,
  earthSearchNextBodySchema,
  earthSearchPaginationEnvelopeSchema,
  type EarthSearchItem,
} from '@/infrastructure/stac/earthSearchSchemas';

interface EarthSearchRequestBody {
  readonly collections: readonly string[];
  readonly intersects: {
    readonly type: 'Point';
    readonly coordinates: readonly [number, number];
  };
  readonly datetime: string;
  readonly query: Readonly<Record<'eo:cloud_cover', { readonly lte: number }>>;
  readonly sortby: readonly [{ readonly field: string; readonly direction: 'desc' }];
  readonly fields: {
    readonly include: readonly string[];
  };
  readonly limit: number;
}

interface EarthSearchPageLink {
  readonly href: string;
  readonly method?: string | undefined;
  readonly body?: unknown;
  readonly rel: string;
}

const includedFields = [
  'id',
  'collection',
  'geometry',
  'properties.datetime',
  'properties.platform',
  'properties.eo:cloud_cover',
  'properties.proj:epsg',
  'properties.grid:code',
  'properties.s2:tile_id',
  'properties.s2:product_type',
  'properties.s2:product_uri',
  'properties.sat:relative_orbit',
  'assets.visual',
  'assets.red',
  'assets.green',
  'assets.blue',
  'assets.thumbnail',
  'links',
] as const;

function createRequestBody(
  query: SatelliteCatalogQuery,
  collection: string,
): EarthSearchRequestBody {
  const { criteria } = query;
  return {
    collections: [collection],
    // Search only for scenes containing the immutable anchor. The full submitted
    // viewport is intentionally retained for client-side coverage calculations.
    intersects: {
      type: 'Point',
      coordinates: [
        criteria.viewport.center.longitude,
        criteria.viewport.center.latitude,
      ],
    },
    datetime: `${criteria.startDate}T00:00:00.000Z/${criteria.endDate}T23:59:59.999Z`,
    query: { 'eo:cloud_cover': { lte: criteria.maxCloudCoverPercent } },
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    fields: { include: includedFields },
    // Keep provider pages small and follow validated next links under the hood.
    limit: Math.min(query.maximumItems, 100),
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function mapTransportError(error: unknown): SatelliteCatalogError {
  if (error instanceof SatelliteCatalogError) return error;
  if (error instanceof TimeoutError) {
    return new SatelliteCatalogError(
      'provider-timeout',
      'Earth Search did not respond before the request deadline.',
    );
  }
  if (error instanceof HTTPError) {
    if (error.response.status === 429) {
      return new SatelliteCatalogError(
        'provider-rate-limited',
        'Earth Search is rate limiting requests. Wait and try again.',
      );
    }
    return new SatelliteCatalogError(
      'provider-http',
      'Earth Search returned an unsuccessful HTTP response.',
    );
  }
  if (error instanceof z.ZodError) {
    return new SatelliteCatalogError(
      'provider-invalid-response',
      'Earth Search returned data that does not match the supported STAC contract.',
    );
  }
  return new SatelliteCatalogError(
    'provider-network',
    'Earth Search could not be reached from this browser.',
  );
}

function parseAssetUrl(href: string, label: string): URL {
  try {
    return new URL(href);
  } catch {
    throw new SatelliteCatalogError(
      'provider-invalid-response',
      `Earth Search returned an invalid ${label} location.`,
    );
  }
}

function publicL1cHttpsUrl(href: string): string {
  const url = parseAssetUrl(href, 'L1C visual asset');
  if (url.protocol === 's3:' && url.hostname === 'sentinel-s2-l1c') {
    return `https://sentinel-s2-l1c.s3.amazonaws.com${url.pathname}`;
  }
  if (
    url.protocol === 'https:' &&
    url.hostname === 'sentinel-s2-l1c.s3.amazonaws.com'
  ) {
    return url.toString();
  }
  throw new SatelliteCatalogError(
    'provider-invalid-response',
    'Earth Search returned an unsupported L1C visual asset location.',
  );
}

function httpsUrl(href: string, label: string): string {
  const url = parseAssetUrl(href, label);
  if (url.protocol !== 'https:') {
    throw new SatelliteCatalogError(
      'provider-invalid-response',
      `Earth Search returned an insecure ${label} location.`,
    );
  }
  return url.toString();
}

function mapVisualAsset(
  item: EarthSearchItem,
  productLevel: SatelliteProductLevel,
): SatelliteVisualAsset {
  const projectionEpsg = item.properties['proj:epsg'];

  if (productLevel === 'L1C') {
    const visual = item.assets.visual;
    if (visual === undefined) return { kind: 'unavailable' };
    const mediaType = visual.type ?? '';
    if (!mediaType.toLowerCase().includes('image/jp2')) {
      throw new SatelliteCatalogError(
        'provider-invalid-response',
        'Earth Search returned an unexpected L1C visual asset format.',
      );
    }
    return {
      kind: 'unsupported-jp2',
      href: publicL1cHttpsUrl(visual.href),
      mediaType,
      projectionEpsg,
    };
  }

  const bands = ['red', 'green', 'blue'] as const;
  const bandAssets = bands.map((band) => item.assets[band]);
  if (bandAssets.some((asset) => asset === undefined)) return { kind: 'unavailable' };
  for (const asset of bandAssets) {
    const mediaType = asset?.type?.toLowerCase() ?? '';
    if (!mediaType.includes('image/tiff') || !mediaType.includes('cloud-optimized')) {
      throw new SatelliteCatalogError(
        'provider-invalid-response',
        'Earth Search returned an unexpected L2A reflectance-band format.',
      );
    }
  }
  const itemHref = item.links.find((link) => link.rel === 'self')?.href;
  if (itemHref === undefined) return { kind: 'unavailable' };
  return {
    kind: 'sentinel-rgb-cogs',
    itemHref: httpsUrl(itemHref, 'L2A STAC item'),
    redHref: httpsUrl(bandAssets[0]?.href ?? '', 'L2A red band'),
    greenHref: httpsUrl(bandAssets[1]?.href ?? '', 'L2A green band'),
    blueHref: httpsUrl(bandAssets[2]?.href ?? '', 'L2A blue band'),
    projectionEpsg,
  };
}

function readOrbit(item: EarthSearchItem): string | null {
  const relativeOrbit = item.properties['sat:relative_orbit'];
  if (relativeOrbit !== undefined) {
    return `R${String(relativeOrbit).padStart(3, '0')}`;
  }
  const productUri = item.properties['s2:product_uri'];
  const parsed = productUri === undefined ? null : /_R(\d{3})_/u.exec(productUri);
  return parsed?.[1] === undefined ? null : `R${parsed[1]}`;
}

function mapItem(
  item: EarthSearchItem,
  productLevel: SatelliteProductLevel,
  expectedCollection: string,
  attribution: string,
): SatelliteScene {
  if (item.collection !== expectedCollection) {
    throw new SatelliteCatalogError(
      'provider-invalid-response',
      'Earth Search mixed collections in one search response.',
    );
  }
  const thumbnail = item.assets.thumbnail;
  const gridCode = item.properties['grid:code'];
  return {
    id: item.id,
    collection: item.collection,
    platform: item.properties.platform,
    productLevel,
    acquiredAt: new Date(item.properties.datetime).toISOString(),
    cloudCoverPercent: item.properties['eo:cloud_cover'],
    footprint: item.geometry,
    tileId: gridCode?.replace(/^MGRS-/u, '') ?? item.properties['s2:tile_id'] ?? null,
    orbit: readOrbit(item),
    productId: item.properties['s2:product_uri'] ?? null,
    thumbnailHref:
      thumbnail === undefined ? null : httpsUrl(thumbnail.href, 'thumbnail'),
    visualAsset: mapVisualAsset(item, productLevel),
    attribution,
  };
}

/** Validated, bounded Earth Search STAC adapter for an anonymous static browser client. */
export class EarthSearchSatelliteCatalogGateway implements SatelliteCatalogGateway {
  public constructor(
    private readonly httpClient: KyInstance,
    private readonly configuration: MapProviderConfiguration['satellite'],
    private readonly requestTimeoutMs: number,
    private readonly diagnostics: SentinelQueryDiagnostics,
    private readonly logger: DiagnosticLogger,
    private readonly clock: Clock,
  ) {}

  public async search(
    query: SatelliteCatalogQuery,
    context: SatelliteCatalogRequestContext,
  ): Promise<SatelliteCatalogResult> {
    const startedAt = this.clock.monotonicNow();
    let activeStep: SentinelQueryStepId | null = null;
    const beginStep = (stepId: SentinelQueryStepId) => {
      activeStep = stepId;
      this.diagnostics.beginStep(context.operationId, stepId);
    };
    const completeStep = () => {
      if (activeStep === null) return;
      this.diagnostics.completeStep(context.operationId, activeStep);
      activeStep = null;
    };
    const failStep = () => {
      if (activeStep === null) return;
      this.diagnostics.failStep(context.operationId, activeStep);
      activeStep = null;
    };

    this.logger.log({
      level: 'info',
      name: 'satellite.catalog.request.started',
      data: { operationId: context.operationId },
    });

    try {
      const expectedCollection =
        this.configuration.collections[query.criteria.productLevel];
      const initialBody = createRequestBody(query, expectedCollection);

      beginStep('query-stac-catalog');
      const rawPages: unknown[] = [
        await this.fetchPage(initialBody, context.operationId, context.signal),
      ];
      completeStep();

      beginStep('fetch-result-pages');
      let envelope = earthSearchPaginationEnvelopeSchema.parse(rawPages[0]);
      const initialMatched = this.readMatched(rawPages[0]);
      const initialReturned = this.readReturned(rawPages[0]);
      const initialNext = this.readNext(envelope.links);
      let next =
        initialMatched !== null &&
        initialReturned !== null &&
        initialReturned >= initialMatched
          ? null
          : initialNext;
      while (next !== null) {
        if (rawPages.length >= this.configuration.maximumPages) {
          throw new SatelliteCatalogError(
            'provider-pagination',
            'Earth Search exceeded the configured pagination limit.',
          );
        }
        const knownMatched = this.readMatched(rawPages[0]);
        if (knownMatched !== null && knownMatched > query.maximumItems) break;
        const itemCount = rawPages.reduce<number>((count, page) => {
          const parsed = earthSearchPaginationEnvelopeSchema.parse(page);
          return count + parsed.features.length;
        }, 0);
        if (itemCount >= query.maximumItems) {
          throw new SatelliteCatalogError(
            'result-limit-exceeded',
            'Too many scenes matched the bounded catalog request.',
          );
        }
        rawPages.push(
          await this.fetchPage(
            { ...initialBody, next: next.token },
            context.operationId,
            context.signal,
          ),
        );
        envelope = earthSearchPaginationEnvelopeSchema.parse(rawPages.at(-1));
        const fetchedItemCount = rawPages.reduce<number>((count, page) => {
          const parsed = earthSearchPaginationEnvelopeSchema.parse(page);
          return count + parsed.features.length;
        }, 0);
        next =
          knownMatched !== null && fetchedItemCount >= knownMatched
            ? null
            : this.readNext(envelope.links);
      }
      completeStep();

      beginStep('validate-stac-json');
      const pages = rawPages.map((page) =>
        earthSearchFeatureCollectionSchema.parse(page),
      );
      completeStep();

      beginStep('map-scene-metadata');
      const scenes = pages.flatMap((page) =>
        page.features.map((item) =>
          mapItem(
            item,
            query.criteria.productLevel,
            expectedCollection,
            this.configuration.attribution,
          ),
        ),
      );
      const totalMatched = this.readMatched(pages[0]) ?? scenes.length;
      if (totalMatched < scenes.length) {
        throw new SatelliteCatalogError(
          'provider-invalid-response',
          'Earth Search returned inconsistent result counts.',
        );
      }
      completeStep();

      this.logger.log({
        level: 'info',
        name: 'satellite.catalog.request.completed',
        data: {
          operationId: context.operationId,
          count: scenes.length,
          durationMs: Math.max(0, this.clock.monotonicNow() - startedAt),
        },
      });
      return { scenes, totalMatched };
    } catch (error) {
      if (isAbortError(error) || context.signal.aborted) {
        this.diagnostics.cancelOperation(context.operationId);
        this.logger.log({
          level: 'info',
          name: 'satellite.catalog.request.cancelled',
          data: { operationId: context.operationId },
        });
        throw error;
      }

      failStep();
      const safeError = mapTransportError(error);
      this.logger.log({
        level: 'error',
        name: 'satellite.catalog.request.failed',
        data: { operationId: context.operationId, code: safeError.code },
      });
      throw safeError;
    }
  }

  public async getScene(
    collection: string,
    id: string,
    context: SatelliteCatalogRequestContext,
  ): Promise<SatelliteScene | null> {
    const productLevel =
      collection === this.configuration.collections.L2A
        ? 'L2A'
        : collection === this.configuration.collections.L1C
          ? 'L1C'
          : null;
    if (productLevel === null || !/^[a-z0-9._-]{1,300}$/iu.test(id)) return null;
    const endpoint = new URL(this.configuration.searchUrl);
    endpoint.pathname = `${endpoint.pathname.replace(/\/search\/?$/u, '')}/collections/${encodeURIComponent(collection)}/items/${encodeURIComponent(id)}`;
    endpoint.search = '';
    endpoint.hash = '';
    try {
      const raw = await this.httpClient
        .get(endpoint, {
          context: { operationId: context.operationId },
          signal: context.signal,
          timeout: this.requestTimeoutMs,
        })
        .json<unknown>();
      const item = earthSearchItemSchema.parse(raw);
      return mapItem(item, productLevel, collection, this.configuration.attribution);
    } catch (error) {
      if (isAbortError(error) || context.signal.aborted) throw error;
      if (error instanceof HTTPError && error.response.status === 404) return null;
      throw mapTransportError(error);
    }
  }

  private fetchPage(
    body: unknown,
    operationId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    return this.httpClient
      .post(this.configuration.searchUrl, {
        context: { operationId },
        json: body,
        signal,
        timeout: this.requestTimeoutMs,
      })
      .json<unknown>();
  }

  private readNext(
    links: readonly EarthSearchPageLink[],
  ): { readonly token: string } | null {
    const nextLinks = links.filter((link) => link.rel === 'next');
    if (nextLinks.length === 0) return null;
    if (nextLinks.length !== 1) {
      throw new SatelliteCatalogError(
        'provider-pagination',
        'Earth Search returned ambiguous pagination links.',
      );
    }
    const next = nextLinks[0];
    if (next === undefined || (next.method ?? 'GET').toUpperCase() !== 'POST') {
      throw new SatelliteCatalogError(
        'provider-pagination',
        'Earth Search returned an unsupported pagination method.',
      );
    }
    let configured: URL;
    let href: URL;
    try {
      configured = new URL(this.configuration.searchUrl);
      href = new URL(next.href);
    } catch {
      throw new SatelliteCatalogError(
        'provider-pagination',
        'Earth Search returned an invalid pagination target.',
      );
    }
    if (
      href.protocol !== 'https:' ||
      href.origin !== configured.origin ||
      href.pathname !== configured.pathname ||
      href.search !== '' ||
      href.hash !== ''
    ) {
      throw new SatelliteCatalogError(
        'provider-pagination',
        'Earth Search returned an untrusted pagination target.',
      );
    }
    return { token: earthSearchNextBodySchema.parse(next.body).next };
  }

  private readMatched(page: unknown): number | null {
    const parsed = earthSearchPaginationEnvelopeSchema.safeParse(page);
    if (!parsed.success) return null;
    return parsed.data.context?.matched ?? parsed.data.numberMatched ?? null;
  }

  private readReturned(page: unknown): number | null {
    const parsed = earthSearchPaginationEnvelopeSchema.safeParse(page);
    if (!parsed.success) return null;
    return parsed.data.context?.returned ?? parsed.data.numberReturned ?? null;
  }
}
