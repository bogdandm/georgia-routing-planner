import { z } from 'zod';

import type {
  TrailRouteRequest,
  TrailRouteResult,
} from '@/application/ports/TrailRouter';

export const routingWorkerMethods = {
  initialize: 'initialize',
  route: 'route',
} as const;

export interface RoutingWorkerInitializeRequest {
  readonly tileJsonUrl: string;
  readonly transportationSourceLayer: string;
  readonly requestTimeoutMs: number;
}

export type RoutingWorkerInitializeResult =
  | { readonly initialized: true }
  | {
      readonly initialized: false;
      readonly reason: 'routing-data-unavailable' | 'routing-data-invalid';
    };

const coordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const routeRequestSchema = z
  .object({
    start: coordinateSchema,
    destination: coordinateSchema,
  })
  .strict();

const initializeRequestSchema = z
  .object({
    tileJsonUrl: z.url(),
    transportationSourceLayer: z.string().trim().min(1).max(200),
    requestTimeoutMs: z.number().int().min(1_000).max(30_000),
  })
  .strict();

const initializationResultSchema = z.discriminatedUnion('initialized', [
  z.object({ initialized: z.literal(true) }).strict(),
  z
    .object({
      initialized: z.literal(false),
      reason: z.enum(['routing-data-unavailable', 'routing-data-invalid']),
    })
    .strict(),
]);

const routeFailureSchema = z
  .object({
    status: z.literal('failed'),
    reason: z.enum([
      'no-nearby-trail',
      'no-route',
      'area-too-large',
      'routing-data-unavailable',
      'routing-data-invalid',
    ]),
    endpoint: z.enum(['start', 'destination', 'both']).optional(),
  })
  .strict();

const routeSuccessSchema = z
  .object({
    status: z.literal('ready'),
    geometry: z
      .object({
        type: z.literal('LineString'),
        coordinates: z.array(coordinateSchema).min(2),
      })
      .strict(),
    networkDistanceMeters: z.number().nonnegative(),
    snappedStart: coordinateSchema,
    snappedDestination: coordinateSchema,
    loadedTileCount: z.number().int().nonnegative(),
    graphNodeCount: z.number().int().nonnegative(),
    graphEdgeCount: z.number().int().nonnegative(),
    expandedAreaRetryUsed: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const first = value.geometry.coordinates[0];
    const last = value.geometry.coordinates.at(-1);
    if (first?.[0] !== value.snappedStart[0] || first[1] !== value.snappedStart[1]) {
      context.addIssue({
        code: 'custom',
        path: ['geometry', 'coordinates', 0],
        message: 'Route geometry must begin at snappedStart.',
      });
    }
    if (
      last?.[0] !== value.snappedDestination[0] ||
      last[1] !== value.snappedDestination[1]
    ) {
      context.addIssue({
        code: 'custom',
        path: ['geometry', 'coordinates', value.geometry.coordinates.length - 1],
        message: 'Route geometry must end at snappedDestination.',
      });
    }
  });

const routeResultSchema = z.union([routeSuccessSchema, routeFailureSchema]);

export function parseRoutingWorkerInitializeRequest(
  value: unknown,
): RoutingWorkerInitializeRequest {
  return initializeRequestSchema.parse(value);
}

export function parseRoutingWorkerInitializeResult(
  value: unknown,
): RoutingWorkerInitializeResult {
  return initializationResultSchema.parse(value);
}

export function parseTrailRouteRequest(value: unknown): TrailRouteRequest {
  const parsed = routeRequestSchema.parse(value);
  return {
    start: parsed.start,
    destination: parsed.destination,
  };
}

export function parseTrailRouteResult(value: unknown): TrailRouteResult {
  const parsed = routeResultSchema.parse(value);
  if (parsed.status === 'failed') {
    if (parsed.endpoint === undefined) {
      return { status: 'failed', reason: parsed.reason };
    }
    return {
      status: 'failed',
      reason: parsed.reason,
      endpoint: parsed.endpoint,
    };
  }
  return {
    status: 'ready',
    geometry: parsed.geometry,
    networkDistanceMeters: parsed.networkDistanceMeters,
    snappedStart: parsed.snappedStart,
    snappedDestination: parsed.snappedDestination,
    loadedTileCount: parsed.loadedTileCount,
    graphNodeCount: parsed.graphNodeCount,
    graphEdgeCount: parsed.graphEdgeCount,
    expandedAreaRetryUsed: parsed.expandedAreaRetryUsed,
  };
}
