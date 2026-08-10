import type { TrackCoordinate } from '@/domain/tracks/gpx';
import {
  EARTH_RADIUS_METERS,
  geodesicDistanceMeters,
} from '@/domain/tracks/trackCalculations';

export const MVT_GRAPH_EXTENT = 4_096;
export const MAX_SNAP_DISTANCE_METERS = 200;
export const GRAPH_NODE_TOLERANCE_UNITS = 2;
export const GRAPH_NODE_BUCKET_UNITS = 512;

const ROUTING_ZOOM = 14;
const fractionEpsilon = 1e-12;
const distanceTieEpsilonMeters = 1e-9;

export interface RoutingLineMetadata {
  readonly class?: string;
  readonly kind?: string;
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

type GlobalMvtPoint = readonly [x: number, y: number];

interface PrimitiveSegment {
  readonly key: string;
  readonly nodeA: string;
  readonly nodeB: string;
  readonly globalA: GlobalMvtPoint;
  readonly globalB: GlobalMvtPoint;
  readonly metadata: RoutingLineMetadata;
  readonly metadataKey: string;
  readonly splitTokens: Map<string, number>;
}

interface CandidateEdge {
  readonly key: string;
  readonly nodeA: string;
  readonly nodeB: string;
  readonly globalA: GlobalMvtPoint;
  readonly globalB: GlobalMvtPoint;
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

const excludedNonRoadClasses: Readonly<Record<string, true>> = {
  aerialway: true,
  ferry: true,
  rail: true,
  transit: true,
};

const excludedNonRoadKinds: Readonly<Record<string, true>> = {
  apron: true,
  construction: true,
  platform: true,
  proposed: true,
  rail: true,
  runway: true,
  taxiway: true,
};

const allowedSubclasses: Readonly<Record<string, true>> = {
  path: true,
  footway: true,
  pedestrian: true,
  bridleway: true,
  cycleway: true,
  steps: true,
};

function normalizeLongitude(longitude: number): number {
  const normalized = (((longitude + 180) % 360) + 360) % 360;
  return normalized - 180;
}

function metadataKey(metadata: RoutingLineMetadata): string {
  return JSON.stringify([
    metadata.class ?? '',
    metadata.subclass ?? '',
    metadata.kind ?? '',
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

function globalPointKey(point: GlobalMvtPoint): string {
  return `${String(point[0])},${String(point[1])}`;
}

function compareGlobalPoints(left: GlobalMvtPoint, right: GlobalMvtPoint): number {
  return globalPointKey(left).localeCompare(globalPointKey(right));
}

function roundedGlobalPoint(x: number, y: number): GlobalMvtPoint {
  return [Math.round(x), Math.round(y)];
}

function segmentFraction(
  point: GlobalMvtPoint,
  start: GlobalMvtPoint,
  end: GlobalMvtPoint,
): number {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const squaredLength = deltaX * deltaX + deltaY * deltaY;
  if (squaredLength === 0) return 0;
  return Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / squaredLength,
    ),
  );
}

function projectGlobalPointToSegment(
  point: GlobalMvtPoint,
  start: GlobalMvtPoint,
  end: GlobalMvtPoint,
): {
  readonly fraction: number;
  readonly point: GlobalMvtPoint;
  readonly squaredDistance: number;
} {
  const fraction = segmentFraction(point, start, end);
  const projectedX = start[0] + (end[0] - start[0]) * fraction;
  const projectedY = start[1] + (end[1] - start[1]) * fraction;
  const deltaX = point[0] - projectedX;
  const deltaY = point[1] - projectedY;
  return {
    fraction,
    point: roundedGlobalPoint(projectedX, projectedY),
    squaredDistance: deltaX * deltaX + deltaY * deltaY,
  };
}

function normalizedLayer(metadata: RoutingLineMetadata): string {
  if (metadata.layer === undefined) return '0';
  if (typeof metadata.layer === 'number') {
    return metadata.layer === 0 ? '0' : String(metadata.layer);
  }
  const layer = metadata.layer.trim().toLowerCase();
  if (layer.length === 0 || Number(layer) === 0) return '0';
  return layer;
}

function inferredJunctionCompatible(
  left: RoutingLineMetadata,
  right: RoutingLineMetadata,
): boolean {
  return (
    normalizedLayer(left) === normalizedLayer(right) &&
    (left.brunnel?.trim().toLowerCase() ?? '') ===
      (right.brunnel?.trim().toLowerCase() ?? '')
  );
}

interface JunctionToken {
  readonly coordinate: GlobalMvtPoint;
  readonly originalEndpoint: boolean;
}

class JunctionClusters {
  readonly #parents: number[] = [];
  readonly #tokens: JunctionToken[] = [];

  public create(coordinate: GlobalMvtPoint, originalEndpoint: boolean): number {
    const token = this.#tokens.length;
    this.#parents.push(token);
    this.#tokens.push({ coordinate, originalEndpoint });
    return token;
  }

  public find(token: number): number {
    const parent = this.#parents[token];
    if (parent === undefined) throw new Error('Unknown routing junction token.');
    if (parent === token) return token;
    const root = this.find(parent);
    this.#parents[token] = root;
    return root;
  }

  public union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (leftRoot < rightRoot) this.#parents[rightRoot] = leftRoot;
    else this.#parents[leftRoot] = rightRoot;
  }

  public canonicalCoordinates(): ReadonlyMap<number, GlobalMvtPoint> {
    const endpointCandidates = new Map<number, GlobalMvtPoint>();
    const otherCandidates = new Map<number, GlobalMvtPoint>();
    for (const [token, value] of this.#tokens.entries()) {
      const root = this.find(token);
      const candidates = value.originalEndpoint ? endpointCandidates : otherCandidates;
      const current = candidates.get(root);
      if (current === undefined || compareGlobalPoints(value.coordinate, current) < 0) {
        candidates.set(root, value.coordinate);
      }
    }
    const result = new Map<number, GlobalMvtPoint>();
    for (const root of new Set(this.#parents.map((_, token) => this.find(token)))) {
      const coordinate = endpointCandidates.get(root) ?? otherCandidates.get(root);
      if (coordinate !== undefined) result.set(root, coordinate);
    }
    return result;
  }
}

function addPrimitiveSplit(
  primitive: PrimitiveSegment,
  coordinate: GlobalMvtPoint,
  originalEndpoint: boolean,
  clusters: JunctionClusters,
): number {
  const key = globalPointKey(coordinate);
  const existing = primitive.splitTokens.get(key);
  if (existing !== undefined) return existing;
  const token = clusters.create(coordinate, originalEndpoint);
  primitive.splitTokens.set(key, token);
  return token;
}

function normalizedPrimitive(
  start: GlobalMvtPoint,
  end: GlobalMvtPoint,
  metadata: RoutingLineMetadata,
): PrimitiveSegment {
  const startKey = globalPointKey(start);
  const endKey = globalPointKey(end);
  const startsFirst = startKey < endKey;
  const nodeA = startsFirst ? startKey : endKey;
  const nodeB = startsFirst ? endKey : startKey;
  return {
    key: unorderedEdgeKey(nodeA, nodeB),
    nodeA,
    nodeB,
    globalA: startsFirst ? start : end,
    globalB: startsFirst ? end : start,
    metadata,
    metadataKey: metadataKey(metadata),
    splitTokens: new Map(),
  };
}

function collectPrimitives(lines: readonly RoutingLineInput[]): PrimitiveSegment[] {
  const primitives: PrimitiveSegment[] = [];
  for (const line of lines) {
    if (!Number.isFinite(line.extent) || line.extent <= 0 || line.points.length < 2) {
      continue;
    }
    for (let index = 1; index < line.points.length; index += 1) {
      const previous = line.points[index - 1];
      const current = line.points[index];
      if (
        previous === undefined ||
        current === undefined ||
        !Number.isFinite(previous.x) ||
        !Number.isFinite(previous.y) ||
        !Number.isFinite(current.x) ||
        !Number.isFinite(current.y)
      ) {
        continue;
      }
      const start = roundedGlobalPoint(
        line.tileX * MVT_GRAPH_EXTENT + (previous.x * MVT_GRAPH_EXTENT) / line.extent,
        line.tileY * MVT_GRAPH_EXTENT + (previous.y * MVT_GRAPH_EXTENT) / line.extent,
      );
      const end = roundedGlobalPoint(
        line.tileX * MVT_GRAPH_EXTENT + (current.x * MVT_GRAPH_EXTENT) / line.extent,
        line.tileY * MVT_GRAPH_EXTENT + (current.y * MVT_GRAPH_EXTENT) / line.extent,
      );
      if (globalPointKey(start) !== globalPointKey(end)) {
        primitives.push(normalizedPrimitive(start, end, line.metadata));
      }
    }
  }
  primitives.sort(
    (left, right) =>
      left.key.localeCompare(right.key) ||
      left.metadataKey.localeCompare(right.metadataKey),
  );
  return primitives;
}

function candidatePrimitivePairs(
  primitives: readonly PrimitiveSegment[],
): readonly (readonly [left: number, right: number])[] {
  const buckets = new Map<string, number[]>();
  const pairKeys = new Set<string>();
  const pairs: (readonly [number, number])[] = [];
  for (const [index, primitive] of primitives.entries()) {
    const minimumX =
      Math.min(primitive.globalA[0], primitive.globalB[0]) - GRAPH_NODE_TOLERANCE_UNITS;
    const maximumX =
      Math.max(primitive.globalA[0], primitive.globalB[0]) + GRAPH_NODE_TOLERANCE_UNITS;
    const minimumY =
      Math.min(primitive.globalA[1], primitive.globalB[1]) - GRAPH_NODE_TOLERANCE_UNITS;
    const maximumY =
      Math.max(primitive.globalA[1], primitive.globalB[1]) + GRAPH_NODE_TOLERANCE_UNITS;
    const minimumBucketX = Math.floor(minimumX / GRAPH_NODE_BUCKET_UNITS);
    const maximumBucketX = Math.floor(maximumX / GRAPH_NODE_BUCKET_UNITS);
    const minimumBucketY = Math.floor(minimumY / GRAPH_NODE_BUCKET_UNITS);
    const maximumBucketY = Math.floor(maximumY / GRAPH_NODE_BUCKET_UNITS);
    for (let bucketX = minimumBucketX; bucketX <= maximumBucketX; bucketX += 1) {
      for (let bucketY = minimumBucketY; bucketY <= maximumBucketY; bucketY += 1) {
        const bucketKey = `${String(bucketX)},${String(bucketY)}`;
        const occupants = buckets.get(bucketKey);
        if (occupants !== undefined) {
          for (const otherIndex of occupants) {
            const pairKey = `${String(otherIndex)}:${String(index)}`;
            if (pairKeys.has(pairKey)) continue;
            pairKeys.add(pairKey);
            pairs.push([otherIndex, index]);
          }
          occupants.push(index);
        } else {
          buckets.set(bucketKey, [index]);
        }
      }
    }
  }
  pairs.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  return pairs;
}

function connectEndpointToPrimitive(
  endpointCoordinate: GlobalMvtPoint,
  endpointToken: number,
  source: PrimitiveSegment,
  target: PrimitiveSegment,
  clusters: JunctionClusters,
): void {
  if (target.nodeA === globalPointKey(endpointCoordinate)) return;
  if (target.nodeB === globalPointKey(endpointCoordinate)) return;
  const projection = projectGlobalPointToSegment(
    endpointCoordinate,
    target.globalA,
    target.globalB,
  );
  if (
    projection.squaredDistance >
    GRAPH_NODE_TOLERANCE_UNITS * GRAPH_NODE_TOLERANCE_UNITS + fractionEpsilon
  ) {
    return;
  }
  const projectionIsInterior =
    projection.fraction > fractionEpsilon && projection.fraction < 1 - fractionEpsilon;
  if (
    projectionIsInterior &&
    !inferredJunctionCompatible(source.metadata, target.metadata)
  ) {
    return;
  }
  const projectedToken = addPrimitiveSplit(target, projection.point, false, clusters);
  clusters.union(endpointToken, projectedToken);
}

function connectUniqueIntersection(
  left: PrimitiveSegment,
  right: PrimitiveSegment,
  clusters: JunctionClusters,
): void {
  const leftDeltaX = left.globalB[0] - left.globalA[0];
  const leftDeltaY = left.globalB[1] - left.globalA[1];
  const rightDeltaX = right.globalB[0] - right.globalA[0];
  const rightDeltaY = right.globalB[1] - right.globalA[1];
  const denominator = leftDeltaX * rightDeltaY - leftDeltaY * rightDeltaX;
  if (Math.abs(denominator) <= fractionEpsilon) return;
  const originDeltaX = right.globalA[0] - left.globalA[0];
  const originDeltaY = right.globalA[1] - left.globalA[1];
  const leftFraction =
    (originDeltaX * rightDeltaY - originDeltaY * rightDeltaX) / denominator;
  const rightFraction =
    (originDeltaX * leftDeltaY - originDeltaY * leftDeltaX) / denominator;
  if (
    leftFraction < -fractionEpsilon ||
    leftFraction > 1 + fractionEpsilon ||
    rightFraction < -fractionEpsilon ||
    rightFraction > 1 + fractionEpsilon
  ) {
    return;
  }
  const leftInterior =
    leftFraction > fractionEpsilon && leftFraction < 1 - fractionEpsilon;
  const rightInterior =
    rightFraction > fractionEpsilon && rightFraction < 1 - fractionEpsilon;
  if (
    (leftInterior || rightInterior) &&
    !inferredJunctionCompatible(left.metadata, right.metadata)
  ) {
    return;
  }
  const coordinate = roundedGlobalPoint(
    left.globalA[0] + leftDeltaX * leftFraction,
    left.globalA[1] + leftDeltaY * leftFraction,
  );
  const leftToken = addPrimitiveSplit(left, coordinate, false, clusters);
  const rightToken = addPrimitiveSplit(right, coordinate, false, clusters);
  clusters.union(leftToken, rightToken);
}

function nodePrimitives(primitives: readonly PrimitiveSegment[]): JunctionClusters {
  const clusters = new JunctionClusters();
  const endpointTokens = new Map<string, number>();
  for (const primitive of primitives) {
    for (const [key, coordinate] of [
      [primitive.nodeA, primitive.globalA],
      [primitive.nodeB, primitive.globalB],
    ] as const) {
      let token = endpointTokens.get(key);
      if (token === undefined) {
        token = clusters.create(coordinate, true);
        endpointTokens.set(key, token);
      }
      primitive.splitTokens.set(key, token);
    }
  }

  for (const [leftIndex, rightIndex] of candidatePrimitivePairs(primitives)) {
    const left = primitives[leftIndex];
    const right = primitives[rightIndex];
    if (left === undefined || right === undefined) continue;
    connectUniqueIntersection(left, right, clusters);
    const leftStartToken = left.splitTokens.get(left.nodeA);
    const leftEndToken = left.splitTokens.get(left.nodeB);
    const rightStartToken = right.splitTokens.get(right.nodeA);
    const rightEndToken = right.splitTokens.get(right.nodeB);
    if (
      leftStartToken === undefined ||
      leftEndToken === undefined ||
      rightStartToken === undefined ||
      rightEndToken === undefined
    ) {
      continue;
    }
    connectEndpointToPrimitive(left.globalA, leftStartToken, left, right, clusters);
    connectEndpointToPrimitive(left.globalB, leftEndToken, left, right, clusters);
    connectEndpointToPrimitive(right.globalA, rightStartToken, right, left, clusters);
    connectEndpointToPrimitive(right.globalB, rightEndToken, right, left, clusters);
  }
  return clusters;
}

function splitPrimitiveEdges(
  primitives: readonly PrimitiveSegment[],
  clusters: JunctionClusters,
): {
  readonly candidates: readonly CandidateEdge[];
  readonly nodeCoordinates: ReadonlyMap<string, GlobalMvtPoint>;
} {
  const canonicalCoordinates = clusters.canonicalCoordinates();
  const candidates: CandidateEdge[] = [];
  const nodeCoordinates = new Map<string, GlobalMvtPoint>();
  for (const primitive of primitives) {
    const splits = new Map<
      string,
      { readonly coordinate: GlobalMvtPoint; readonly fraction: number }
    >();
    for (const token of primitive.splitTokens.values()) {
      const coordinate = canonicalCoordinates.get(clusters.find(token));
      if (coordinate === undefined) continue;
      const key = globalPointKey(coordinate);
      splits.set(key, {
        coordinate,
        fraction: segmentFraction(coordinate, primitive.globalA, primitive.globalB),
      });
    }
    const ordered = [...splits.entries()].sort(
      ([leftKey, left], [rightKey, right]) =>
        left.fraction - right.fraction || leftKey.localeCompare(rightKey),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (
        previous === undefined ||
        current === undefined ||
        previous[0] === current[0]
      ) {
        continue;
      }
      const startsFirst = previous[0] < current[0];
      const nodeA = startsFirst ? previous[0] : current[0];
      const nodeB = startsFirst ? current[0] : previous[0];
      const globalA = startsFirst ? previous[1].coordinate : current[1].coordinate;
      const globalB = startsFirst ? current[1].coordinate : previous[1].coordinate;
      nodeCoordinates.set(nodeA, globalA);
      nodeCoordinates.set(nodeB, globalB);
      candidates.push({
        key: unorderedEdgeKey(nodeA, nodeB),
        nodeA,
        nodeB,
        globalA,
        globalB,
        metadata: primitive.metadata,
        metadataKey: primitive.metadataKey,
      });
    }
  }
  candidates.sort(
    (left, right) =>
      left.key.localeCompare(right.key) ||
      left.metadataKey.localeCompare(right.metadataKey),
  );
  return { candidates, nodeCoordinates };
}

export function isWalkableTransportation(
  properties: TransportationProperties,
): boolean {
  const featureClass = properties.class;
  const kind = properties.kind;
  const foot = properties.foot;
  if (foot === 'no' || foot === 'private') return false;
  if (properties.rail === true) return false;
  if (
    (typeof featureClass === 'string' && featureClass.endsWith('_construction')) ||
    (typeof kind === 'string' && kind.endsWith('_construction'))
  ) {
    return false;
  }
  if (typeof featureClass === 'string') {
    return excludedNonRoadClasses[featureClass] !== true;
  }
  if (typeof kind === 'string') return excludedNonRoadKinds[kind] !== true;
  const subclass = properties.subclass;
  return typeof subclass === 'string' && allowedSubclasses[subclass] === true;
}

export function toRoutingLineMetadata(
  properties: TransportationProperties,
  featureId: number | undefined,
): RoutingLineMetadata {
  const metadata: {
    class?: string;
    kind?: string;
    subclass?: string;
    surface?: string;
    foot?: string;
    brunnel?: string;
    layer?: string | number;
    featureId?: number;
  } = {};
  if (typeof properties.class === 'string') metadata.class = properties.class;
  if (typeof properties.kind === 'string') metadata.kind = properties.kind;
  if (typeof properties.subclass === 'string') metadata.subclass = properties.subclass;
  if (typeof properties.surface === 'string') metadata.surface = properties.surface;
  if (typeof properties.foot === 'string') metadata.foot = properties.foot;
  if (typeof properties.brunnel === 'string') metadata.brunnel = properties.brunnel;
  if (properties.bridge === true) metadata.brunnel = 'bridge';
  else if (properties.tunnel === true) metadata.brunnel = 'tunnel';
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
  const primitives = collectPrimitives(lines);
  const clusters = nodePrimitives(primitives);
  const { candidates, nodeCoordinates } = splitPrimitiveEdges(primitives, clusters);
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
