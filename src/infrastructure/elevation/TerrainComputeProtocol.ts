import { z } from 'zod';

import type { TerrainContourOptions } from '@/infrastructure/elevation/TerrainComputeBackend';
import {
  terrainComputeConfigurationSchema,
  type TerrainComputeConfiguration,
} from '@/infrastructure/elevation/TerrainComputeConfiguration';

const contourOptionsSchema = z.strictObject({
  levels: z.array(z.number()),
  multiplier: z.number().optional(),
  overzoom: z.number().int().nonnegative().optional(),
  elevationKey: z.string().optional(),
  levelKey: z.string().optional(),
  contourLayer: z.string().optional(),
  extent: z.number().int().positive().optional(),
  buffer: z.number().int().nonnegative().optional(),
  subsampleBelow: z.number().int().positive().optional(),
});

const contourRequestSchema = z.strictObject({
  zoom: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  options: contourOptionsSchema,
});

export interface TerrainWorkerInitializeRequest {
  readonly configuration: TerrainComputeConfiguration;
  readonly interactionActive: boolean;
}

export interface TerrainWorkerContourRequest {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
  readonly options: TerrainContourOptions;
}

interface TerrainWorkerInteractionRequest {
  readonly active: boolean;
}

export interface TerrainWorkerContourResult {
  readonly kind: 'contour';
  readonly data: ArrayBuffer;
}

export const terrainWorkerEventNames = {
  metrics: 'terrain-metrics',
  queueState: 'terrain-queue-state',
} as const;

export function parseTerrainWorkerInitializeRequest(
  value: unknown,
): TerrainWorkerInitializeRequest {
  return z
    .strictObject({
      configuration: terrainComputeConfigurationSchema,
      interactionActive: z.boolean(),
    })
    .parse(value);
}

export function parseTerrainWorkerContourRequest(
  value: unknown,
): TerrainWorkerContourRequest {
  const parsed = contourRequestSchema.parse(value);
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
    options,
  };
}

export function parseTerrainWorkerInteractionRequest(
  value: unknown,
): TerrainWorkerInteractionRequest {
  return z.strictObject({ active: z.boolean() }).parse(value);
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
    isArrayBuffer(value.data)
  );
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  // The built-in method performs a cross-realm internal-slot brand check that cannot
  // be spoofed with Symbol.toStringTag as Object.prototype.toString can.
  try {
    ArrayBuffer.prototype.slice.call(value, 0, 0);
    return true;
  } catch {
    return false;
  }
}
