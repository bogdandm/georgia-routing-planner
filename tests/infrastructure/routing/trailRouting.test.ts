import { describe, expect, it, vi } from 'vitest';

import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { geodesicDistanceMeters } from '@/domain/tracks/trackCalculations';
import { executeTrailRoute } from '@/infrastructure/routing/RoutingWorkerServer';
import {
  MAX_ROUTING_TILES,
  ROUTING_TILE_CACHE_ENTRIES,
  ROUTING_TILE_FETCH_CONCURRENCY,
  ROUTING_ZOOM,
  RoutingTileLoader,
  coverRoutingBounds,
  expandRoutingBounds,
  routingPaddingMeters,
  type LoadedRoutingArea,
} from '@/infrastructure/routing/routingTiles';
import {
  MVT_GRAPH_EXTENT,
  buildTrailGraph,
  coordinateToGlobalMvtVertex,
  globalMvtVertexToCoordinate,
  isWalkableTransportation,
  projectCoordinateToEdge,
  routeTrailGraph,
  type RoutingLineInput,
  type TrailGraph,
  type TrailGraphArc,
  type TrailGraphEdge,
  type TrailGraphNode,
} from '@/infrastructure/routing/trailGraph';

const TILE_JSON_URL = 'https://routing.test/tilejson.json';
const TILE_TEMPLATE = 'https://routing.test/tiles/{z}/{x}/{y}.pbf';

function fetchInputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  do {
    const byte = remaining & 0x7f;
    remaining >>>= 7;
    bytes.push(remaining === 0 ? byte : byte | 0x80);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}

function encodeField(field: number, wireType: 0 | 2, value: number | Buffer): Buffer {
  const tag = encodeVarint((field << 3) | wireType);
  if (typeof value === 'number') return Buffer.concat([tag, encodeVarint(value)]);
  return Buffer.concat([tag, encodeVarint(value.length), value]);
}

function encodePacked(values: readonly number[]): Buffer {
  return Buffer.concat(values.map((value) => encodeVarint(value)));
}

function zigZag(value: number): number {
  return ((value << 1) ^ (value >> 31)) >>> 0;
}

function vectorFeature(
  id: number,
  type: 2 | 3,
  tags: readonly number[],
  geometry: readonly number[],
): Buffer {
  return Buffer.concat([
    encodeField(1, 0, id),
    encodeField(2, 2, encodePacked(tags)),
    encodeField(3, 0, type),
    encodeField(4, 2, encodePacked(geometry)),
  ]);
}

function vectorTileFixture(extent = MVT_GRAPH_EXTENT): Buffer {
  const path = vectorFeature(
    1,
    2,
    [0, 0],
    [9, zigZag(2_048), zigZag(2_048), 10, zigZag(512), zigZag(0)],
  );
  const polygon = vectorFeature(
    2,
    3,
    [0, 0],
    [9, zigZag(100), zigZag(100), 10, zigZag(100), zigZag(0), 15],
  );
  const malformedLine = vectorFeature(3, 2, [0, 0], [9, zigZag(100)]);
  const value = encodeField(1, 2, Buffer.from('path'));
  const layer = Buffer.concat([
    encodeField(1, 2, Buffer.from('transportation')),
    encodeField(2, 2, path),
    encodeField(2, 2, polygon),
    encodeField(2, 2, malformedLine),
    encodeField(3, 2, Buffer.from('class')),
    encodeField(4, 2, value),
    encodeField(5, 0, extent),
    encodeField(15, 0, 2),
  ]);
  return Buffer.concat([encodeField(3, 2, layer)]);
}

function tileJsonResponse(overrides: Readonly<Record<string, unknown>> = {}): Response {
  return Response.json({
    tilejson: '3.0.0',
    tiles: [TILE_TEMPLATE],
    minzoom: 0,
    maxzoom: ROUTING_ZOOM,
    ...overrides,
  });
}

async function initializedLoader(
  tileBytes: Buffer = vectorTileFixture(),
  tileJson: Response = tileJsonResponse(),
): Promise<RoutingTileLoader> {
  const tileBody = tileBytes.buffer.slice(
    tileBytes.byteOffset,
    tileBytes.byteOffset + tileBytes.byteLength,
  ) as ArrayBuffer;
  const fetcher = vi.fn<typeof fetch>((input) =>
    Promise.resolve(
      fetchInputUrl(input) === TILE_JSON_URL
        ? tileJson.clone()
        : new Response(tileBody),
    ),
  );
  const initialization = await RoutingTileLoader.initialize(
    {
      tileJsonUrl: TILE_JSON_URL,
      transportationSourceLayer: 'transportation',
      requestTimeoutMs: 5_000,
    },
    new AbortController().signal,
    fetcher,
  );
  if (initialization.status === 'failed') throw new Error(initialization.reason);
  return initialization.loader;
}

function line(
  tileX: number,
  tileY: number,
  points: readonly (readonly [number, number])[],
  extent = MVT_GRAPH_EXTENT,
): RoutingLineInput {
  return {
    tileX,
    tileY,
    extent,
    points: points.map(([x, y]) => ({ x, y })),
    metadata: { class: 'path' },
  };
}

function graphFromCoordinates(
  coordinates: Readonly<Record<string, TrackCoordinate>>,
  edgePairs: readonly (readonly [string, string])[],
  boundaryNodes: readonly string[] = [],
): TrailGraph {
  const nodes = new Map<string, TrailGraphNode>();
  for (const [key, coordinate] of Object.entries(coordinates)) {
    nodes.set(key, { key, coordinate, boundary: boundaryNodes.includes(key) });
  }
  const edges = new Map<string, TrailGraphEdge>();
  const adjacency = new Map<string, TrailGraphArc[]>();
  for (const key of nodes.keys()) adjacency.set(key, []);
  for (const [nodeA, nodeB] of edgePairs) {
    const coordinateA = coordinates[nodeA];
    const coordinateB = coordinates[nodeB];
    if (coordinateA === undefined || coordinateB === undefined) continue;
    const key = nodeA < nodeB ? `${nodeA}|${nodeB}` : `${nodeB}|${nodeA}`;
    const distanceMeters = geodesicDistanceMeters(coordinateA, coordinateB);
    edges.set(key, {
      key,
      nodeA,
      nodeB,
      distanceMeters,
      metadata: { class: 'path' },
    });
    adjacency.get(nodeA)?.push({
      key,
      edgeKey: key,
      from: nodeA,
      to: nodeB,
      distanceMeters,
    } as TrailGraphArc & { key: string });
    adjacency.get(nodeB)?.push({
      key,
      edgeKey: key,
      from: nodeB,
      to: nodeA,
      distanceMeters,
    } as TrailGraphArc & { key: string });
  }
  return { nodes, edges, adjacency };
}

function loadedArea(
  lines: readonly RoutingLineInput[],
  tileX: number,
  tileY: number,
): LoadedRoutingArea {
  return {
    tiles: [
      {
        z: ROUTING_ZOOM,
        x: tileX,
        y: tileY,
        key: [ROUTING_ZOOM, tileX, tileY].join('/'),
      },
    ],
    rectangle: {
      minTileX: tileX,
      maxTileX: tileX,
      minTileY: tileY,
      maxTileY: tileY,
    },
    lines,
  };
}

describe('routing tile coverage and decoding', () => {
  it('covers half-open sorted XYZ rectangles, expands padding, clamps latitude, and rejects more than 256 tiles', () => {
    const tileX = 10_240;
    const tileY = 6_000;
    const northWest = globalMvtVertexToCoordinate(
      tileX * MVT_GRAPH_EXTENT,
      tileY * MVT_GRAPH_EXTENT,
    );
    const southEast = globalMvtVertexToCoordinate(
      (tileX + 1) * MVT_GRAPH_EXTENT,
      (tileY + 1) * MVT_GRAPH_EXTENT,
    );
    const oneTile = coverRoutingBounds({
      west: northWest[0],
      north: northWest[1],
      east: southEast[0],
      south: southEast[1],
    });
    expect(oneTile).toEqual({
      status: 'ready',
      coverage: {
        tiles: [
          {
            z: ROUTING_ZOOM,
            x: tileX,
            y: tileY,
            key: [ROUTING_ZOOM, tileX, tileY].join('/'),
          },
        ],
        rectangle: {
          minTileX: tileX,
          maxTileX: tileX,
          minTileY: tileY,
          maxTileY: tileY,
        },
      },
    });

    const start: TrackCoordinate = [44.64, 42.66];
    const destination: TrackCoordinate = [44.65, 42.67];
    const padding = routingPaddingMeters(start, destination);
    const expanded = expandRoutingBounds(start, destination, padding);
    expect(padding).toBe(2_000);
    expect(expanded.west).toBeLessThan(start[0]);
    expect(expanded.east).toBeGreaterThan(destination[0]);
    expect(expanded.south).toBeLessThan(start[1]);
    expect(expanded.north).toBeGreaterThan(destination[1]);

    const polar = coverRoutingBounds({ west: 0, east: 0.01, south: 85, north: 90 });
    expect(polar.status).toBe('ready');
    if (polar.status === 'ready') {
      expect(polar.coverage.tiles.every((tile) => tile.y >= 0)).toBe(true);
      expect(polar.coverage.tiles.map((tile) => tile.key)).toEqual(
        [...new Set(polar.coverage.tiles.map((tile) => tile.key))].sort(),
      );
    }
    expect(
      coverRoutingBounds({ west: -180, east: 180, south: -80, north: 80 }),
    ).toEqual({ status: 'failed', reason: 'area-too-large' });
    expect(MAX_ROUTING_TILES).toBe(256);
  });

  it('decodes valid line parts while skipping polygons and malformed geometry', async () => {
    const loader = await initializedLoader();
    const result = await loader.loadArea(
      [44.64, 42.66],
      [44.64, 42.66],
      10,
      new AbortController().signal,
    );
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.area.lines.length).toBe(result.area.tiles.length);
      expect(result.area.lines.every((item) => item.metadata.class === 'path')).toBe(
        true,
      );
    }
  });

  it('bounds concurrent routing tile requests', async () => {
    const tileBody = Buffer.alloc(0);
    const gate = (
      Promise as PromiseConstructor & {
        withResolvers<T>(): {
          readonly promise: Promise<T>;
          readonly resolve: (value: T | PromiseLike<T>) => void;
        };
      }
    ).withResolvers<undefined>();
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (fetchInputUrl(input) === TILE_JSON_URL) return tileJsonResponse();
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await gate.promise;
      activeRequests -= 1;
      return new Response(tileBody);
    });
    const initialized = await RoutingTileLoader.initialize(
      {
        tileJsonUrl: TILE_JSON_URL,
        transportationSourceLayer: 'transportation',
        requestTimeoutMs: 5_000,
      },
      new AbortController().signal,
      fetcher,
    );
    if (initialized.status === 'failed') throw new Error(initialized.reason);

    const pending = initialized.loader.loadArea(
      [44.64, 42.66],
      [44.64, 42.66],
      8_000,
      new AbortController().signal,
    );
    expect(maximumActiveRequests).toBe(ROUTING_TILE_FETCH_CONCURRENCY);
    gate.resolve(undefined);
    const result = await pending;
    expect(result.status).toBe('ready');
    expect(fetcher.mock.calls.length).toBeGreaterThan(
      ROUTING_TILE_FETCH_CONCURRENCY + 1,
    );
    expect(maximumActiveRequests).toBe(ROUTING_TILE_FETCH_CONCURRENCY);
  });

  it.each([
    [{ class: 'path' }, true],
    [{ class: 'track' }, true],
    [{ class: 'minor' }, true],
    [{ class: 'service' }, true],
    [{ class: 'tertiary' }, true],
    [{ subclass: 'footway' }, true],
    [{ subclass: 'pedestrian' }, true],
    [{ subclass: 'bridleway' }, true],
    [{ subclass: 'cycleway' }, true],
    [{ subclass: 'steps' }, true],
    [{ class: 'trunk', foot: 'yes' }, true],
    [{ class: 'trunk', foot: 'designated' }, true],
    [{ class: 'trunk', foot: 'permissive' }, true],
    [{ class: 'trunk' }, false],
    [{ class: 'path', foot: 'no' }, false],
    [{ class: 'path', foot: 'private' }, false],
    [{ class: 'minor_construction' }, false],
    [{ class: 'trunk_construction', foot: 'yes' }, false],
    [{ class: 'motorway' }, false],
  ])(
    'applies the exact walkable transportation policy to %o',
    (properties, eligible) => {
      expect(isWalkableTransportation(properties)).toBe(eligible);
    },
  );

  it('normalizes different layer extents onto one global 4096 grid and round-trips within one unit', () => {
    const tileX = 10_000;
    const tileY = 6_000;
    const graph = buildTrailGraph(
      [
        line(tileX, tileY, [
          [2_048, 2_048],
          [4_096, 2_048],
        ]),
        line(
          tileX,
          tileY,
          [
            [1_024, 1_024],
            [2_048, 1_024],
          ],
          2_048,
        ),
      ],
      { minTileX: tileX, maxTileX: tileX, minTileY: tileY, maxTileY: tileY },
    );
    const centerKey = `${String(tileX * MVT_GRAPH_EXTENT + 2_048)},${String(tileY * MVT_GRAPH_EXTENT + 2_048)}`;
    expect(graph.nodes.has(centerKey)).toBe(true);
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.size).toBe(1);
    const center = graph.nodes.get(centerKey)?.coordinate;
    expect(center).toEqual(
      globalMvtVertexToCoordinate(
        tileX * MVT_GRAPH_EXTENT + 2_048,
        tileY * MVT_GRAPH_EXTENT + 2_048,
      ),
    );
    if (center !== undefined) {
      const roundTrip = coordinateToGlobalMvtVertex(center);
      expect(
        Math.abs(roundTrip[0] - (tileX * MVT_GRAPH_EXTENT + 2_048)),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(roundTrip[1] - (tileY * MVT_GRAPH_EXTENT + 2_048)),
      ).toBeLessThanOrEqual(1);
    }
  });

  it('deduplicates reversed tile-buffer overlap into one undirected graph edge', () => {
    const tileX = 100;
    const tileY = 200;
    const graph = buildTrailGraph(
      [
        line(tileX, tileY, [
          [4_000, 2_000],
          [4_200, 2_000],
        ]),
        line(tileX + 1, tileY, [
          [104, 2_000],
          [-96, 2_000],
        ]),
        line(tileX + 1, tileY, [
          [104, 2_000],
          [500, 2_500],
        ]),
      ],
      {
        minTileX: tileX,
        maxTileX: tileX + 1,
        minTileY: tileY,
        maxTileY: tileY,
      },
    );
    expect(graph.nodes.size).toBe(3);
    expect(graph.edges.size).toBe(2);
    expect(
      [...graph.adjacency.values()].reduce((total, arcs) => total + arcs.length, 0),
    ).toBe(4);
  });

  it('bounds the decoded access-ordered LRU at 128 entries', async () => {
    const loader = await initializedLoader(Buffer.alloc(0));
    for (let index = 0; index < 40; index += 1) {
      const longitude = -10 + index * 0.1;
      const result = await loader.loadArea(
        [longitude, 0],
        [longitude, 0],
        2_000,
        new AbortController().signal,
      );
      expect(result.status).toBe('ready');
    }
    expect(loader.cacheSize).toBe(ROUTING_TILE_CACHE_ENTRIES);
    expect(new Set(loader.cacheKeys).size).toBe(ROUTING_TILE_CACHE_ENTRIES);
  });

  it('classifies invalid TileJSON, unsupported zoom, and invalid PBF without retrying', async () => {
    const invalidTileJson = await RoutingTileLoader.initialize(
      {
        tileJsonUrl: TILE_JSON_URL,
        transportationSourceLayer: 'transportation',
        requestTimeoutMs: 5_000,
      },
      new AbortController().signal,
      vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ tiles: [] }))),
    );
    expect(invalidTileJson).toEqual({
      status: 'failed',
      reason: 'routing-data-invalid',
    });

    const unsupportedZoom = await RoutingTileLoader.initialize(
      {
        tileJsonUrl: TILE_JSON_URL,
        transportationSourceLayer: 'transportation',
        requestTimeoutMs: 5_000,
      },
      new AbortController().signal,
      vi.fn<typeof fetch>(() => Promise.resolve(tileJsonResponse({ maxzoom: 13 }))),
    );
    expect(unsupportedZoom).toEqual({
      status: 'failed',
      reason: 'routing-data-unavailable',
    });

    const loader = await initializedLoader(Buffer.from([255]));
    const invalidPbf = await loader.loadArea(
      [44.64, 42.66],
      [44.64, 42.66],
      2_000,
      new AbortController().signal,
    );
    expect(invalidPbf).toEqual({ status: 'failed', reason: 'routing-data-invalid' });
  });

  it('propagates caller cancellation through in-flight tile requests', async () => {
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      if (fetchInputUrl(input) === TILE_JSON_URL) {
        return Promise.resolve(tileJsonResponse());
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            reject(new DOMException('Canceled.', 'AbortError'));
          },
          { once: true },
        );
      });
    });
    const initialized = await RoutingTileLoader.initialize(
      {
        tileJsonUrl: TILE_JSON_URL,
        transportationSourceLayer: 'transportation',
        requestTimeoutMs: 5_000,
      },
      new AbortController().signal,
      fetcher,
    );
    if (initialized.status === 'failed') throw new Error(initialized.reason);
    const controller = new AbortController();
    const pending = initialized.loader.loadArea(
      [44.64, 42.66],
      [44.65, 42.67],
      2_000,
      controller.signal,
    );
    await Promise.resolve();
    controller.abort(new DOMException('Canceled.', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('trail graph snapping and routing', () => {
  it('projects to an edge midpoint with fraction 0.5 and rejects points beyond 200 metres', () => {
    const projection = projectCoordinateToEdge([0, 0.001], [-0.01, 0], [0.01, 0]);
    expect(projection.fraction).toBeCloseTo(0.5, 12);
    expect(projection.coordinate[0]).toBeCloseTo(0, 12);

    const graph = graphFromCoordinates({ a: [-0.01, 0], b: [0.01, 0] }, [['a', 'b']]);
    expect(routeTrailGraph(graph, [0, 0.01], [0.005, 0.01])).toEqual({
      status: 'failed',
      reason: 'no-nearby-trail',
      endpoint: 'both',
      visitedBoundary: false,
    });
  });

  it('uses the stable edge key for equal-distance ties and splits one edge in route order', () => {
    const tieGraph = graphFromCoordinates(
      {
        a: [-0.01, 0.001],
        b: [0.01, 0.001],
        c: [-0.01, -0.001],
        d: [0.01, -0.001],
      },
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
    );
    const tied = routeTrailGraph(tieGraph, [-0.005, 0], [0.005, 0]);
    expect(tied.status).toBe('ready');
    if (tied.status === 'ready') {
      expect(tied.snappedStart[1]).toBeCloseTo(0.001, 12);
    }

    const oneEdge = graphFromCoordinates({ a: [0, 0], b: [0.01, 0] }, [['a', 'b']]);
    const routed = routeTrailGraph(oneEdge, [0.0025, 0.0001], [0.0075, 0.0001]);
    expect(routed.status).toBe('ready');
    if (routed.status === 'ready') {
      expect(routed.coordinates[0]).toEqual(routed.snappedStart);
      expect(routed.coordinates.at(-1)).toEqual(routed.snappedDestination);
      expect(routed.snappedStart[0]).toBeLessThan(routed.snappedDestination[0]);
    }
  });

  it('chooses the shorter connected branch and reports a disconnected route', () => {
    const connected = graphFromCoordinates(
      { a: [0, 0], b: [0.01, 0], c: [0.005, 0.01] },
      [
        ['a', 'b'],
        ['a', 'c'],
        ['c', 'b'],
      ],
    );
    const shorter = routeTrailGraph(connected, [0, 0], [0.01, 0]);
    expect(shorter.status).toBe('ready');
    if (shorter.status === 'ready') expect(shorter.coordinates).toHaveLength(2);

    const disconnected = graphFromCoordinates(
      {
        a: [0, 0],
        b: [0.001, 0],
        c: [0.01, 0],
        d: [0.011, 0],
      },
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
    );
    expect(routeTrailGraph(disconnected, [0, 0], [0.011, 0])).toEqual({
      status: 'failed',
      reason: 'no-route',
      visitedBoundary: false,
    });
  });

  it('retries once only when the disconnected search touches the covered boundary', async () => {
    const tileX = 10_000;
    const tileY = 6_000;
    const p0: readonly [number, number] = [0, 2_000];
    const p1: readonly [number, number] = [50, 2_000];
    const p2: readonly [number, number] = [500, 2_000];
    const p3: readonly [number, number] = [550, 2_000];
    const firstLines = [line(tileX, tileY, [p0, p1]), line(tileX, tileY, [p2, p3])];
    const secondLines = [...firstLines, line(tileX, tileY, [p1, p2])];
    const start = globalMvtVertexToCoordinate(
      tileX * MVT_GRAPH_EXTENT + p0[0],
      tileY * MVT_GRAPH_EXTENT + p0[1],
    );
    const destination = globalMvtVertexToCoordinate(
      tileX * MVT_GRAPH_EXTENT + p3[0],
      tileY * MVT_GRAPH_EXTENT + p3[1],
    );
    const loadArea = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'ready',
        area: loadedArea(firstLines, tileX, tileY),
      })
      .mockResolvedValueOnce({
        status: 'ready',
        area: loadedArea(secondLines, tileX, tileY),
      });
    const result = await executeTrailRoute(
      { loadArea },
      { start, destination },
      new AbortController().signal,
    );
    expect(loadArea).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.expandedAreaRetryUsed).toBe(true);
      expect(result.geometry.coordinates[0]).toEqual(result.snappedStart);
      expect(result.geometry.coordinates.at(-1)).toEqual(result.snappedDestination);
    }

    const snapFailureLoader = {
      loadArea: vi.fn().mockResolvedValue({
        status: 'ready',
        area: loadedArea([], tileX, tileY),
      }),
    };
    const snapFailure = await executeTrailRoute(
      snapFailureLoader,
      { start, destination },
      new AbortController().signal,
    );
    expect(snapFailure).toEqual({
      status: 'failed',
      reason: 'no-nearby-trail',
      endpoint: 'both',
    });
    expect(snapFailureLoader.loadArea).toHaveBeenCalledOnce();

    const dataFailureLoader = {
      loadArea: vi.fn().mockResolvedValue({
        status: 'failed',
        reason: 'routing-data-unavailable',
      }),
    };
    await expect(
      executeTrailRoute(
        dataFailureLoader,
        { start, destination },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: 'failed', reason: 'routing-data-unavailable' });
    expect(dataFailureLoader.loadArea).toHaveBeenCalledOnce();
  });
});
