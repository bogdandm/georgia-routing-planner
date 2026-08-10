import type { TrackCoordinate } from '@/domain/tracks/gpx';
import {
  EARTH_RADIUS_METERS,
  geodesicDistanceMeters,
} from '@/domain/tracks/trackCalculations';

export const MVT_GRAPH_EXTENT = 4_096;
export const MAX_SNAP_DISTANCE_METERS = 200;

const ROUTING_ZOOM = 14;
const fractionEpsilon = 1e-12;
const distanceTieEpsilonMeters = 1e-9;

export interface RoutingLineMetadata {
  readonly class?: string;
  readonly subclass?: string;
  readonly surface?: string;
  readonly foot?: string;
  readonly brunnel?: string;
  readonly layer?: string | number;
  readonly featureId?: number;
}

export interface RoutingMvtPoint {
  readonly x: number;
  readonly y: number;
}

export interface RoutingLineInput {
  readonly tileX: number;
  readonly tileY: number;
  readonly extent: number;
  readonly points: readonly RoutingMvtPoint[];
  readonly metadata: RoutingLineMetadata;
}

export interface RoutingTileRectangle {
  readonly minTileX: number;
  readonly maxTileX: number;
  readonly minTileY: number;
  readonly maxTileY: number;
}

export interface TrailGraphNode {
  readonly key: string;
  readonly coordinate: TrackCoordinate;
  readonly boundary: boolean;
}

export interface TrailGraphEdge {
  readonly key: string;
  readonly nodeA: string;
  readonly nodeB: string;
  readonly distanceMeters: number;
  readonly metadata: RoutingLineMetadata;
}

export interface TrailGraphArc {
  readonly edgeKey: string;
  readonly from: string;
  readonly to: string;
  readonly distanceMeters: number;
}

export interface TrailGraph {
  readonly nodes: ReadonlyMap<string, TrailGraphNode>;
  readonly edges: ReadonlyMap<string, TrailGraphEdge>;
  readonly adjacency: ReadonlyMap<string, readonly TrailGraphArc[]>;
}

export interface EdgeProjection {
  readonly fraction: number;
  readonly coordinate: TrackCoordinate;
  readonly distanceMeters: number;
}

export type TrailGraphRouteResult =
  | {
      readonly status: 'ready';
      readonly coordinates: readonly TrackCoordinate[];
      readonly networkDistanceMeters: number;
      readonly snappedStart: TrackCoordinate;
      readonly snappedDestination: TrackCoordinate;
      readonly visitedBoundary: boolean;
    }
  | {
      readonly status: 'failed';
      readonly reason: 'no-nearby-trail';
      readonly endpoint: 'start' | 'destination' | 'both';
      readonly visitedBoundary: false;
    }
  | {
      readonly status: 'failed';
      readonly reason: 'no-route';
      readonly visitedBoundary: boolean;
    };

type TransportationProperties = Readonly<Record<string, string | number | boolean>>;

interface CandidateEdge {
  readonly key: string;
  readonly nodeA: string;
  readonly nodeB: string;
  readonly globalA: readonly [x: number, y: number];
  readonly globalB: readonly [x: number, y: number];
  readonly metadata: RoutingLineMetadata;
  readonly metadataKey: string;
}

interface NearestEdge {
  readonly edge: TrailGraphEdge;
  readonly projection: EdgeProjection;
}

interface AssignedSnap extends NearestEdge {
  readonly role: 'start' | 'destination';
  nodeKey: string;
  coordinate: TrackCoordinate;
}

interface QueueEntry {
  readonly nodeKey: string;
  readonly score: number;
}

const allowedClasses: Readonly<Record<string, true>> = {
  path: true,
  track: true,
  minor: true,
  service: true,
  tertiary: true,
};

const allowedSubclasses: Readonly<Record<string, true>> = {
  path: true,
  footway: true,
  pedestrian: true,
  bridleway: true,
  cycleway: true,
  steps: true,
};

const allowedTrunkFootValues: Readonly<Record<string, true>> = {
  yes: true,
  designated: true,
  permissive: true,
};

function normalizeLongitude(longitude: number): number {
  const normalized = (((longitude + 180) % 360) + 360) % 360;
  return normalized - 180;
}

function metadataKey(metadata: RoutingLineMetadata): string {
  return JSON.stringify([
    metadata.class ?? '',
    metadata.subclass ?? '',
    metadata.surface ?? '',
    metadata.foot ?? '',
    metadata.brunnel ?? '',
    metadata.layer ?? '',
    metadata.featureId ?? '',
  ]);
}

function unorderedEdgeKey(nodeA: string, nodeB: string): string {
  return nodeA < nodeB ? `${nodeA}|${nodeB}` : `${nodeB}|${nodeA}`;
}

export function isWalkableTransportation(
  properties: TransportationProperties,
): boolean {
  const featureClass = properties.class;
  const subclass = properties.subclass;
  const foot = properties.foot;
  if (foot === 'no' || foot === 'private') return false;
  if (typeof featureClass === 'string' && featureClass.endsWith('_construction')) {
    return false;
  }
  if (featureClass === 'trunk') {
    return typeof foot === 'string' && allowedTrunkFootValues[foot] === true;
  }
  return (
    (typeof featureClass === 'string' && allowedClasses[featureClass] === true) ||
    (typeof subclass === 'string' && allowedSubclasses[subclass] === true)
  );
}

export function toRoutingLineMetadata(
  properties: TransportationProperties,
  featureId: number | undefined,
): RoutingLineMetadata {
  const metadata: {
    class?: string;
    subclass?: string;
    surface?: string;
    foot?: string;
    brunnel?: string;
    layer?: string | number;
    featureId?: number;
  } = {};
  if (typeof properties.class === 'string') metadata.class = properties.class;
  if (typeof properties.subclass === 'string') metadata.subclass = properties.subclass;
  if (typeof properties.surface === 'string') metadata.surface = properties.surface;
  if (typeof properties.foot === 'string') metadata.foot = properties.foot;
  if (typeof properties.brunnel === 'string') metadata.brunnel = properties.brunnel;
  if (typeof properties.layer === 'string' || typeof properties.layer === 'number') {
    metadata.layer = properties.layer;
  }
  if (featureId !== undefined) metadata.featureId = featureId;
  return metadata;
}

export function globalMvtVertexToCoordinate(
  globalX: number,
  globalY: number,
  zoom = ROUTING_ZOOM,
): TrackCoordinate {
  const tileCount = 2 ** zoom;
  const worldUnits = tileCount * MVT_GRAPH_EXTENT;
  const longitude = (globalX / worldUnits) * 360 - 180;
  const mercatorY = globalY / worldUnits;
  const latitude =
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * mercatorY))) * 180) / Math.PI;
  return [normalizeLongitude(longitude), latitude];
}

export function coordinateToGlobalMvtVertex(
  coordinate: TrackCoordinate,
  zoom = ROUTING_ZOOM,
): readonly [x: number, y: number] {
  const tileCount = 2 ** zoom;
  const worldUnits = tileCount * MVT_GRAPH_EXTENT;
  const latitude = Math.max(-85.051_128_78, Math.min(85.051_128_78, coordinate[1]));
  const latitudeRadians = (latitude * Math.PI) / 180;
  const x = Math.round(((coordinate[0] + 180) / 360) * worldUnits);
  const y = Math.round(
    ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * worldUnits,
  );
  return [x, y];
}

export function buildTrailGraph(
  lines: readonly RoutingLineInput[],
  boundary: RoutingTileRectangle,
): TrailGraph {
  const candidates: CandidateEdge[] = [];
  const nodeCoordinates = new Map<string, readonly [x: number, y: number]>();

  for (const line of lines) {
    if (!Number.isFinite(line.extent) || line.extent <= 0 || line.points.length < 2) {
      continue;
    }
    const normalized = line.points
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map((point) => {
        const globalX =
          line.tileX * MVT_GRAPH_EXTENT +
          Math.round((point.x * MVT_GRAPH_EXTENT) / line.extent);
        const globalY =
          line.tileY * MVT_GRAPH_EXTENT +
          Math.round((point.y * MVT_GRAPH_EXTENT) / line.extent);
        return {
          key: `${String(globalX)},${String(globalY)}`,
          global: [globalX, globalY] as const,
        };
      });

    for (let index = 1; index < normalized.length; index += 1) {
      const previous = normalized[index - 1];
      const current = normalized[index];
      if (
        previous === undefined ||
        current === undefined ||
        previous.key === current.key
      ) {
        continue;
      }
      nodeCoordinates.set(previous.key, previous.global);
      nodeCoordinates.set(current.key, current.global);
      const edgeKey = unorderedEdgeKey(previous.key, current.key);
      candidates.push({
        key: edgeKey,
        nodeA: previous.key < current.key ? previous.key : current.key,
        nodeB: previous.key < current.key ? current.key : previous.key,
        globalA: previous.key < current.key ? previous.global : current.global,
        globalB: previous.key < current.key ? current.global : previous.global,
        metadata: line.metadata,
        metadataKey: metadataKey(line.metadata),
      });
    }
  }

  candidates.sort(
    (left, right) =>
      left.key.localeCompare(right.key) ||
      left.metadataKey.localeCompare(right.metadataKey),
  );
  const edges = new Map<string, TrailGraphEdge>();
  for (const candidate of candidates) {
    if (edges.has(candidate.key)) continue;
    const coordinateA = globalMvtVertexToCoordinate(
      candidate.globalA[0],
      candidate.globalA[1],
    );
    const coordinateB = globalMvtVertexToCoordinate(
      candidate.globalB[0],
      candidate.globalB[1],
    );
    const distanceMeters = geodesicDistanceMeters(coordinateA, coordinateB);
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) continue;
    edges.set(candidate.key, {
      key: candidate.key,
      nodeA: candidate.nodeA,
      nodeB: candidate.nodeB,
      distanceMeters,
      metadata: candidate.metadata,
    });
  }

  const minimumGlobalX = boundary.minTileX * MVT_GRAPH_EXTENT;
  const maximumGlobalX = (boundary.maxTileX + 1) * MVT_GRAPH_EXTENT;
  const minimumGlobalY = boundary.minTileY * MVT_GRAPH_EXTENT;
  const maximumGlobalY = (boundary.maxTileY + 1) * MVT_GRAPH_EXTENT;
  const nodes = new Map<string, TrailGraphNode>();
  for (const [key, global] of [...nodeCoordinates].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    nodes.set(key, {
      key,
      coordinate: globalMvtVertexToCoordinate(global[0], global[1]),
      boundary:
        global[0] <= minimumGlobalX ||
        global[0] >= maximumGlobalX ||
        global[1] <= minimumGlobalY ||
        global[1] >= maximumGlobalY,
    });
  }

  const adjacency = new Map<string, TrailGraphArc[]>();
  for (const nodeKey of nodes.keys()) adjacency.set(nodeKey, []);
  for (const edge of edges.values()) {
    adjacency.get(edge.nodeA)?.push({
      edgeKey: edge.key,
      from: edge.nodeA,
      to: edge.nodeB,
      distanceMeters: edge.distanceMeters,
    });
    adjacency.get(edge.nodeB)?.push({
      edgeKey: edge.key,
      from: edge.nodeB,
      to: edge.nodeA,
      distanceMeters: edge.distanceMeters,
    });
  }
  for (const arcs of adjacency.values()) {
    arcs.sort(
      (left, right) =>
        left.to.localeCompare(right.to) || left.edgeKey.localeCompare(right.edgeKey),
    );
  }
  return { nodes, edges, adjacency };
}

export function projectCoordinateToEdge(
  raw: TrackCoordinate,
  edgeStart: TrackCoordinate,
  edgeEnd: TrackCoordinate,
): EdgeProjection {
  const latitudeRadians = (raw[1] * Math.PI) / 180;
  const longitudeScale = Math.max(1e-12, Math.cos(latitudeRadians));
  const toLocal = (coordinate: TrackCoordinate): readonly [x: number, y: number] => {
    const longitudeDelta = normalizeLongitude(coordinate[0] - raw[0]);
    return [
      (longitudeDelta * Math.PI * EARTH_RADIUS_METERS * longitudeScale) / 180,
      ((coordinate[1] - raw[1]) * Math.PI * EARTH_RADIUS_METERS) / 180,
    ];
  };
  const start = toLocal(edgeStart);
  const end = toLocal(edgeEnd);
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const squaredLength = deltaX * deltaX + deltaY * deltaY;
  const fraction =
    squaredLength === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, -(start[0] * deltaX + start[1] * deltaY) / squaredLength),
        );
  const nearestX = start[0] + deltaX * fraction;
  const nearestY = start[1] + deltaY * fraction;
  const coordinate: TrackCoordinate = [
    normalizeLongitude(
      raw[0] + (nearestX * 180) / (Math.PI * EARTH_RADIUS_METERS * longitudeScale),
    ),
    raw[1] + (nearestY * 180) / (Math.PI * EARTH_RADIUS_METERS),
  ];
  return {
    fraction,
    coordinate,
    distanceMeters: Math.hypot(nearestX, nearestY),
  };
}

function nearestEdge(
  graph: TrailGraph,
  coordinate: TrackCoordinate,
): NearestEdge | null {
  let nearest: NearestEdge | null = null;
  for (const edge of graph.edges.values()) {
    const nodeA = graph.nodes.get(edge.nodeA);
    const nodeB = graph.nodes.get(edge.nodeB);
    if (nodeA === undefined || nodeB === undefined) continue;
    const projection = projectCoordinateToEdge(
      coordinate,
      nodeA.coordinate,
      nodeB.coordinate,
    );
    if (
      nearest === null ||
      projection.distanceMeters <
        nearest.projection.distanceMeters - distanceTieEpsilonMeters ||
      (Math.abs(projection.distanceMeters - nearest.projection.distanceMeters) <=
        distanceTieEpsilonMeters &&
        edge.key < nearest.edge.key)
    ) {
      nearest = { edge, projection };
    }
  }
  return nearest;
}

class MinimumQueue {
  readonly #entries: QueueEntry[] = [];

  public push(entry: QueueEntry): void {
    this.#entries.push(entry);
    let index = this.#entries.length - 1;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.#entries[parentIndex];
      if (parent === undefined || !this.before(entry, parent)) break;
      this.#entries[index] = parent;
      index = parentIndex;
    }
    this.#entries[index] = entry;
  }

  public pop(): QueueEntry | undefined {
    const first = this.#entries[0];
    const last = this.#entries.pop();
    if (first === undefined || last === undefined || this.#entries.length === 0) {
      return first;
    }
    let index = 0;
    this.#entries[0] = last;
    for (;;) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      const left = this.#entries[leftIndex];
      const right = this.#entries[rightIndex];
      if (left === undefined) break;
      const nextIndex =
        right !== undefined && this.before(right, left) ? rightIndex : leftIndex;
      const next = this.#entries[nextIndex];
      const current = this.#entries[index];
      if (next === undefined || current === undefined || !this.before(next, current))
        break;
      this.#entries[index] = next;
      this.#entries[nextIndex] = current;
      index = nextIndex;
    }
    return first;
  }

  private before(left: QueueEntry, right: QueueEntry): boolean {
    return (
      left.score < right.score ||
      (left.score === right.score && left.nodeKey < right.nodeKey)
    );
  }
}

function addArc(
  overrides: Map<string, TrailGraphArc[]>,
  graph: TrailGraph,
  from: string,
  to: string,
  edgeKey: string,
  distanceMeters: number,
): void {
  const arcs = overrides.get(from) ?? [...(graph.adjacency.get(from) ?? [])];
  arcs.push({ edgeKey, from, to, distanceMeters });
  arcs.sort(
    (left, right) =>
      left.to.localeCompare(right.to) || left.edgeKey.localeCompare(right.edgeKey),
  );
  overrides.set(from, arcs);
}

function assignSnapNodes(
  graph: TrailGraph,
  start: NearestEdge,
  destination: NearestEdge,
): {
  readonly start: AssignedSnap;
  readonly destination: AssignedSnap;
  readonly coordinates: ReadonlyMap<string, TrackCoordinate>;
  readonly adjacency: ReadonlyMap<string, readonly TrailGraphArc[]>;
} {
  const assigned: [AssignedSnap, AssignedSnap] = [
    {
      ...start,
      role: 'start',
      nodeKey: '@route-start',
      coordinate: start.projection.coordinate,
    },
    {
      ...destination,
      role: 'destination',
      nodeKey: '@route-destination',
      coordinate: destination.projection.coordinate,
    },
  ];
  const temporaryCoordinates = new Map<string, TrackCoordinate>();
  const interiorByEdge = new Map<string, AssignedSnap[]>();

  for (const snap of assigned) {
    if (snap.projection.fraction <= fractionEpsilon) {
      snap.nodeKey = snap.edge.nodeA;
      snap.coordinate = graph.nodes.get(snap.edge.nodeA)?.coordinate ?? snap.coordinate;
      continue;
    }
    if (snap.projection.fraction >= 1 - fractionEpsilon) {
      snap.nodeKey = snap.edge.nodeB;
      snap.coordinate = graph.nodes.get(snap.edge.nodeB)?.coordinate ?? snap.coordinate;
      continue;
    }
    const peers = interiorByEdge.get(snap.edge.key) ?? [];
    const colocated = peers.find(
      (peer) =>
        Math.abs(peer.projection.fraction - snap.projection.fraction) <=
        fractionEpsilon,
    );
    if (colocated !== undefined) {
      snap.nodeKey = colocated.nodeKey;
      snap.coordinate = colocated.coordinate;
    } else {
      peers.push(snap);
      interiorByEdge.set(snap.edge.key, peers);
      temporaryCoordinates.set(snap.nodeKey, snap.coordinate);
    }
  }

  const adjacencyOverrides = new Map<string, TrailGraphArc[]>();
  for (const [edgeKey, snaps] of interiorByEdge) {
    const edge = graph.edges.get(edgeKey);
    if (edge === undefined) continue;
    adjacencyOverrides.set(
      edge.nodeA,
      (graph.adjacency.get(edge.nodeA) ?? []).filter((arc) => arc.edgeKey !== edgeKey),
    );
    adjacencyOverrides.set(
      edge.nodeB,
      (graph.adjacency.get(edge.nodeB) ?? []).filter((arc) => arc.edgeKey !== edgeKey),
    );
    snaps.sort(
      (left, right) =>
        left.projection.fraction - right.projection.fraction ||
        left.role.localeCompare(right.role),
    );
    const chain = [edge.nodeA, ...snaps.map((snap) => snap.nodeKey), edge.nodeB];
    for (let index = 1; index < chain.length; index += 1) {
      const from = chain[index - 1];
      const to = chain[index];
      if (from === undefined || to === undefined || from === to) continue;
      const fromCoordinate =
        temporaryCoordinates.get(from) ?? graph.nodes.get(from)?.coordinate;
      const toCoordinate =
        temporaryCoordinates.get(to) ?? graph.nodes.get(to)?.coordinate;
      if (fromCoordinate === undefined || toCoordinate === undefined) continue;
      const distanceMeters = geodesicDistanceMeters(fromCoordinate, toCoordinate);
      const splitEdgeKey = unorderedEdgeKey(from, to);
      addArc(adjacencyOverrides, graph, from, to, splitEdgeKey, distanceMeters);
      addArc(adjacencyOverrides, graph, to, from, splitEdgeKey, distanceMeters);
    }
  }

  return {
    start: assigned[0],
    destination: assigned[1],
    coordinates: temporaryCoordinates,
    adjacency: adjacencyOverrides,
  };
}

export function routeTrailGraph(
  graph: TrailGraph,
  startCoordinate: TrackCoordinate,
  destinationCoordinate: TrackCoordinate,
): TrailGraphRouteResult {
  const startNearest = nearestEdge(graph, startCoordinate);
  const destinationNearest = nearestEdge(graph, destinationCoordinate);
  const startUnavailable =
    startNearest === null ||
    startNearest.projection.distanceMeters > MAX_SNAP_DISTANCE_METERS;
  const destinationUnavailable =
    destinationNearest === null ||
    destinationNearest.projection.distanceMeters > MAX_SNAP_DISTANCE_METERS;
  if (startUnavailable || destinationUnavailable) {
    return {
      status: 'failed',
      reason: 'no-nearby-trail',
      endpoint:
        startUnavailable && destinationUnavailable
          ? 'both'
          : startUnavailable
            ? 'start'
            : 'destination',
      visitedBoundary: false,
    };
  }

  const prepared = assignSnapNodes(graph, startNearest, destinationNearest);
  const coordinateForNode = (nodeKey: string): TrackCoordinate | undefined =>
    prepared.coordinates.get(nodeKey) ?? graph.nodes.get(nodeKey)?.coordinate;
  const destinationSnapCoordinate = coordinateForNode(prepared.destination.nodeKey);
  const startSnapCoordinate = coordinateForNode(prepared.start.nodeKey);
  if (startSnapCoordinate === undefined || destinationSnapCoordinate === undefined) {
    return { status: 'failed', reason: 'no-route', visitedBoundary: false };
  }

  const queue = new MinimumQueue();
  const distances = new Map<string, number>([[prepared.start.nodeKey, 0]]);
  const previous = new Map<string, string>();
  const visited = new Set<string>();
  let visitedBoundary = false;
  queue.push({
    nodeKey: prepared.start.nodeKey,
    score: geodesicDistanceMeters(startSnapCoordinate, destinationSnapCoordinate),
  });

  for (;;) {
    const currentEntry = queue.pop();
    if (currentEntry === undefined) break;
    if (visited.has(currentEntry.nodeKey)) continue;
    visited.add(currentEntry.nodeKey);
    if (graph.nodes.get(currentEntry.nodeKey)?.boundary === true)
      visitedBoundary = true;
    if (currentEntry.nodeKey === prepared.destination.nodeKey) {
      const path = [currentEntry.nodeKey];
      while (path[0] !== prepared.start.nodeKey) {
        const predecessor = previous.get(path[0] ?? '');
        if (predecessor === undefined) break;
        path.unshift(predecessor);
      }
      const coordinates = path
        .map((nodeKey) => coordinateForNode(nodeKey))
        .filter(
          (coordinate): coordinate is TrackCoordinate => coordinate !== undefined,
        );
      const onlyCoordinate = coordinates[0];
      if (coordinates.length === 1 && onlyCoordinate !== undefined) {
        coordinates.push(onlyCoordinate);
      }
      return {
        status: 'ready',
        coordinates,
        networkDistanceMeters: distances.get(currentEntry.nodeKey) ?? 0,
        snappedStart: startSnapCoordinate,
        snappedDestination: destinationSnapCoordinate,
        visitedBoundary,
      };
    }

    const currentDistance = distances.get(currentEntry.nodeKey);
    if (currentDistance === undefined) continue;
    const arcs =
      prepared.adjacency.get(currentEntry.nodeKey) ??
      graph.adjacency.get(currentEntry.nodeKey) ??
      [];
    for (const arc of arcs) {
      if (visited.has(arc.to)) continue;
      const nextCoordinate = coordinateForNode(arc.to);
      if (nextCoordinate === undefined) continue;
      const candidateDistance = currentDistance + arc.distanceMeters;
      const knownDistance = distances.get(arc.to);
      if (
        knownDistance !== undefined &&
        candidateDistance >= knownDistance - distanceTieEpsilonMeters
      ) {
        continue;
      }
      distances.set(arc.to, candidateDistance);
      previous.set(arc.to, currentEntry.nodeKey);
      queue.push({
        nodeKey: arc.to,
        score:
          candidateDistance +
          geodesicDistanceMeters(nextCoordinate, destinationSnapCoordinate),
      });
    }
  }

  return { status: 'failed', reason: 'no-route', visitedBoundary };
}
