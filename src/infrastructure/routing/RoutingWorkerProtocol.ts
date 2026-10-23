import { z } from 'zod';

import {
  MAXIMUM_TRAIL_ROUTE_WAYPOINTS,
  type TrailRouteFailure,
  type TrailRouteProgress,
  type TrailRouteRequest,
  type TrailRouteResult,
  type TrailRouteSuccess,
} from '@/application/ports/TrailRouter';

export const routingWorkerMethods = {
  initialize: 'initialize',
  route: 'route',
} as const;

export const routingWorkerEvents = {
  progress: 'route-progress',
} as const;

export interface RoutingWorkerRouteRequest {
  readonly request: TrailRouteRequest;
  readonly progressToken: number;
}

export interface RoutingWorkerProgressEvent {
  readonly progressToken: number;
  readonly progress: TrailRouteProgress;
}

export interface RoutingWorkerInitializeRequest {
  readonly tileJsonUrl: string;
  readonly transportationSourceLayer: string;
  readonly requestTimeoutMs: number;
  /** Raster DEM the worker samples so routes weigh climbs by hiking time. */
  readonly terrain: {
    readonly tileUrl: string;
    readonly encoding: 'mapbox' | 'terrarium';
    readonly tileSize: 256 | 512;
    readonly maxZoom: number;
  };
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

const searchTraceSchema = z
  .object({
    forward: z.array(z.tuple([coordinateSchema, coordinateSchema])),
    backward: z.array(z.tuple([coordinateSchema, coordinateSchema])),
  })
  .strict();

const routeRequestSchema = z
  .object({
    request: z
      .object({
        waypoints: z.array(coordinateSchema).min(2).max(MAXIMUM_TRAIL_ROUTE_WAYPOINTS),
        includeSearchTrace: z.boolean(),
      })
      .strict(),
    progressToken: z.number().int().positive(),
  })
  .strict();

const initializeRequestSchema = z
  .object({
    tileJsonUrl: z.url(),
    transportationSourceLayer: z.string().trim().min(1).max(200),
    requestTimeoutMs: z.number().int().min(1_000).max(30_000),
    terrain: z
      .object({
        tileUrl: z.url(),
        encoding: z.enum(['mapbox', 'terrarium']),
        tileSize: z.union([z.literal(256), z.literal(512)]),
        maxZoom: z.number().int().min(0).max(22),
      })
      .strict(),
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

const progressEventSchema = z
  .object({
    progressToken: z.number().int().positive(),
    progress: z
      .object({
        phase: z.enum([
          'loading-tiles',
          'building-graph',
          'loading-terrain',
          'searching-route',
        ]),
        attempt: z.union([z.literal(1), z.literal(2)]),
        loadedTileCount: z.number().int().nonnegative(),
        totalTileCount: z.number().int().nonnegative(),
        graphProgress: z.number().min(0).max(1),
      })
      .strict(),
  })
  .strict();

const routeFailureSchema = z
  .object({
    status: z.literal('failed'),
    reason: z.enum([
      'no-nearby-trail',
      'no-route',
      'area-too-large',
      'routing-data-unavailable',
      'routing-data-invalid',
      'routing-timeout',
    ]),
    waypointIndexes: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(MAXIMUM_TRAIL_ROUTE_WAYPOINTS - 1),
      )
      .min(1)
      .optional(),
    legIndex: z
      .number()
      .int()
      .min(0)
      .max(MAXIMUM_TRAIL_ROUTE_WAYPOINTS - 2)
      .optional(),
    searchTrace: searchTraceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.waypointIndexes !== undefined) {
      if (value.reason !== 'no-nearby-trail') {
        context.addIssue({
          code: 'custom',
          path: ['waypointIndexes'],
          message: 'Waypoint indexes describe only no-nearby-trail failures.',
        });
      }
      const indexes = value.waypointIndexes;
      if (
        indexes.some(
          (index, position) => position > 0 && index <= (indexes[position - 1] ?? -1),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['waypointIndexes'],
          message: 'Waypoint indexes must be strictly ascending.',
        });
      }
    }
    if (value.legIndex !== undefined && value.reason !== 'no-route') {
      context.addIssue({
        code: 'custom',
        path: ['legIndex'],
        message: 'A leg index describes only no-route failures.',
      });
    }
  });

const routeLegSchema = z
  .object({
    geometry: z
      .object({
        type: z.literal('LineString'),
        coordinates: z.array(coordinateSchema).min(2),
      })
      .strict(),
    networkDistanceMeters: z.number().nonnegative(),
    snappedStart: coordinateSchema,
    snappedDestination: coordinateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const first = value.geometry.coordinates[0];
    const last = value.geometry.coordinates.at(-1);
    if (first?.[0] !== value.snappedStart[0] || first[1] !== value.snappedStart[1]) {
      context.addIssue({
        code: 'custom',
        path: ['geometry', 'coordinates', 0],
        message: 'Leg geometry must begin at snappedStart.',
      });
    }
    if (
      last?.[0] !== value.snappedDestination[0] ||
      last[1] !== value.snappedDestination[1]
    ) {
      context.addIssue({
        code: 'custom',
        path: ['geometry', 'coordinates', value.geometry.coordinates.length - 1],
        message: 'Leg geometry must end at snappedDestination.',
      });
    }
  });

const routeSuccessSchema = z
  .object({
    status: z.literal('ready'),
    legs: z
      .array(routeLegSchema)
      .min(1)
      .max(MAXIMUM_TRAIL_ROUTE_WAYPOINTS - 1),
    loadedTileCount: z.number().int().nonnegative(),
    graphNodeCount: z.number().int().nonnegative(),
    graphEdgeCount: z.number().int().nonnegative(),
    expandedAreaRetryUsed: z.boolean(),
    searchTrace: searchTraceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [index, leg] of value.legs.entries()) {
      const previous = value.legs[index - 1];
      if (
        previous !== undefined &&
        (previous.snappedDestination[0] !== leg.snappedStart[0] ||
          previous.snappedDestination[1] !== leg.snappedStart[1])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['legs', index, 'snappedStart'],
          message: 'Each leg must begin where the previous leg ends.',
        });
      }
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

export function parseRoutingWorkerRouteRequest(
  value: unknown,
): RoutingWorkerRouteRequest {
  return routeRequestSchema.parse(value);
}

export function parseRoutingWorkerProgressEvent(
  value: unknown,
): RoutingWorkerProgressEvent {
  return progressEventSchema.parse(value);
}

export function parseTrailRouteResult(value: unknown): TrailRouteResult {
  const parsed = routeResultSchema.parse(value);
  if (parsed.status === 'failed') {
    const failure: {
      -readonly [Key in keyof TrailRouteFailure]: TrailRouteFailure[Key];
    } = { status: 'failed', reason: parsed.reason };
    if (parsed.waypointIndexes !== undefined) {
      failure.waypointIndexes = parsed.waypointIndexes;
    }
    if (parsed.legIndex !== undefined) failure.legIndex = parsed.legIndex;
    if (parsed.searchTrace !== undefined) failure.searchTrace = parsed.searchTrace;
    return failure;
  }
  const success: {
    -readonly [Key in keyof TrailRouteSuccess]: TrailRouteSuccess[Key];
  } = {
    status: 'ready',
    legs: parsed.legs.map((leg) => ({
      geometry: leg.geometry,
      networkDistanceMeters: leg.networkDistanceMeters,
      snappedStart: leg.snappedStart,
      snappedDestination: leg.snappedDestination,
    })),
    loadedTileCount: parsed.loadedTileCount,
    graphNodeCount: parsed.graphNodeCount,
    graphEdgeCount: parsed.graphEdgeCount,
    expandedAreaRetryUsed: parsed.expandedAreaRetryUsed,
  };
  if (parsed.searchTrace !== undefined) success.searchTrace = parsed.searchTrace;
  return success;
}
