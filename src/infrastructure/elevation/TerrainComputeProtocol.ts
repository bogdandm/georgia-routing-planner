import { z } from 'zod';

import type { DiagnosticInput } from '@/application/ports/DiagnosticLogger';
import type {
  TerrainComputeMetrics,
  TerrainComputeQueueState,
  TerrainContourOptions,
} from '@/infrastructure/elevation/TerrainComputeBackend';
import {
  terrainComputeConfigurationSchema,
  type TerrainComputeConfiguration,
} from '@/infrastructure/elevation/TerrainComputeConfiguration';

const coordinateSchema = z.strictObject({
  zoom: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
});

const contourOptionsSchema = z.strictObject({
  levels: z.array(z.number()),
  // maplibre-contour decodes every query parameter into its options object. This
  // source-reload cache-buster belongs to MapLibre, so validate it here and omit it
  // from the compute engine options assembled below.
  demFilterRevision: z.string().regex(/^\d+$/u).optional(),
  multiplier: z.number().optional(),
  overzoom: z.number().int().nonnegative().optional(),
  elevationKey: z.string().optional(),
  levelKey: z.string().optional(),
  contourLayer: z.string().optional(),
  extent: z.number().int().positive().optional(),
  buffer: z.number().int().nonnegative().optional(),
  subsampleBelow: z.number().int().positive().optional(),
});

export interface TerrainWorkerInitializeRequest {
  readonly configuration: TerrainComputeConfiguration;
  readonly filterEnabled: boolean;
  readonly revision: number;
  readonly interactionActive: boolean;
}

export interface TerrainWorkerTileRequest {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
  readonly revision: number;
}

export interface TerrainWorkerContourRequest extends TerrainWorkerTileRequest {
  readonly options: TerrainContourOptions;
}

export interface TerrainWorkerSetFilterRequest {
  readonly enabled: boolean;
  readonly revision: number;
}

export interface TerrainWorkerInteractionRequest {
  readonly active: boolean;
}

export interface TerrainWorkerDemResult {
  readonly kind: 'dem';
  readonly data: ArrayBuffer;
  readonly cacheControl?: string;
  readonly expires?: string;
}

export interface TerrainWorkerContourResult {
  readonly kind: 'contour';
  readonly data: ArrayBuffer;
}

export const terrainWorkerEventNames = {
  diagnostic: 'terrain-diagnostic',
  metrics: 'terrain-metrics',
  queueState: 'terrain-queue-state',
} as const;

export type TerrainWorkerDiagnosticEvent = DiagnosticInput;
export type TerrainWorkerMetricsEvent = TerrainComputeMetrics;
export type TerrainWorkerQueueStateEvent = TerrainComputeQueueState;

export function parseTerrainWorkerInitializeRequest(
  value: unknown,
): TerrainWorkerInitializeRequest {
  return z
    .strictObject({
      configuration: terrainComputeConfigurationSchema,
      filterEnabled: z.boolean(),
      revision: z.number().int().nonnegative(),
      interactionActive: z.boolean(),
    })
    .parse(value);
}

export function parseTerrainWorkerTileRequest(
  value: unknown,
): TerrainWorkerTileRequest {
  return coordinateSchema.parse(value);
}

export function parseTerrainWorkerContourRequest(
  value: unknown,
): TerrainWorkerContourRequest {
  const parsed = coordinateSchema
    .extend({ options: contourOptionsSchema })
    .parse(value);
  const options: TerrainContourOptions = {
    levels: parsed.options.levels,
    ...(parsed.options.multiplier === undefined
      ? {}
      : { multiplier: parsed.options.multiplier }),
    ...(parsed.options.overzoom === undefined
      ? {}
      : { overzoom: parsed.options.overzoom }),
    ...(parsed.options.elevationKey === undefined
      ? {}
      : { elevationKey: parsed.options.elevationKey }),
    ...(parsed.options.levelKey === undefined
      ? {}
      : { levelKey: parsed.options.levelKey }),
    ...(parsed.options.contourLayer === undefined
      ? {}
      : { contourLayer: parsed.options.contourLayer }),
    ...(parsed.options.extent === undefined ? {} : { extent: parsed.options.extent }),
    ...(parsed.options.buffer === undefined ? {} : { buffer: parsed.options.buffer }),
    ...(parsed.options.subsampleBelow === undefined
      ? {}
      : { subsampleBelow: parsed.options.subsampleBelow }),
  };
  return {
    zoom: parsed.zoom,
    x: parsed.x,
    y: parsed.y,
    revision: parsed.revision,
    options,
  };
}

export function parseTerrainWorkerSetFilterRequest(
  value: unknown,
): TerrainWorkerSetFilterRequest {
  return z
    .strictObject({
      enabled: z.boolean(),
      revision: z.number().int().nonnegative(),
    })
    .parse(value);
}

export function parseTerrainWorkerInteractionRequest(
  value: unknown,
): TerrainWorkerInteractionRequest {
  return z.strictObject({ active: z.boolean() }).parse(value);
}

export function isTerrainWorkerDemResult(
  value: unknown,
): value is TerrainWorkerDemResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'dem' &&
    'data' in value &&
    value.data instanceof ArrayBuffer
  );
}

export function isTerrainWorkerContourResult(
  value: unknown,
): value is TerrainWorkerContourResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'contour' &&
    'data' in value &&
    value.data instanceof ArrayBuffer
  );
}
