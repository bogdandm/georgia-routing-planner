import type {
  TrailRouteSearchArc,
  TrailRouteSearchTrace,
} from '@/application/ports/TrailRouter';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import {
  EARTH_RADIUS_METERS,
  estimateHikingSeconds,
  geodesicDistanceMeters,
} from '@/domain/tracks/trackCalculations';

export const MVT_GRAPH_EXTENT = 4_096;
export const MAX_SNAP_DISTANCE_METERS = 200;
export const GRAPH_NODE_TOLERANCE_UNITS = 2;
export const GRAPH_NODE_BUCKET_UNITS = 512;
/** Longer edges get interior terrain samples so a hill between two vertices still counts. */
export const TERRAIN_SAMPLE_SPACING_METERS = 30;

const ROUTING_ZOOM = 14;
const fractionEpsilon = 1e-12;
const distanceTieEpsilonMeters = 1e-9;
const costTieEpsilonSeconds = 1e-9;

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

/** A loaded tile in the graph's unwrapped tile frame; `graphX` may leave `[0, 2^z)`. */
export interface RoutingGraphTile {
  readonly graphX: number;
  readonly y: number;
}

/** A node is on the boundary when it touches, or lies in, a tile outside the set. */
function isOnTileSetBoundary(
  coveredTileKeys: ReadonlySet<string>,
  globalX: number,
  globalY: number,
): boolean {
  const touchedIndexes = (global: number): readonly number[] => {
    const index = Math.floor(global / MVT_GRAPH_EXTENT);
    return global === index * MVT_GRAPH_EXTENT ? [index - 1, index] : [index];
  };
  const touchedYs = touchedIndexes(globalY);
  return touchedIndexes(globalX).some((tileX) =>
    touchedYs.some((tileY) => !coveredTileKeys.has(routingGraphTileKey(tileX, tileY))),
  );
}

/** Shared by the covered set and its lookups so both use one key format. */
function routingGraphTileKey(graphX: number, y: number): string {
  return `${String(graphX)}/${String(y)}`;
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

export interface TrailGraphTerrain {
  readonly nodeElevationMeters: ReadonlyMap<string, number>;
  /** Elevations evenly spaced along each edge from `nodeA` to `nodeB`, endpoints included. */
  readonly edgeProfiles: ReadonlyMap<string, readonly number[]>;
}

export interface TrailGraphRouteOptions {
  /** Null minimizes walking distance; otherwise DIN 33466 hiking time. */
  readonly terrain: TrailGraphTerrain | null;
  readonly includeSearchTrace: boolean;
}

export type TrailGraphRouteResult =
  | {
      readonly status: 'ready';
      readonly coordinates: readonly TrackCoordinate[];
      readonly networkDistanceMeters: number;
      readonly snappedStart: TrackCoordinate;
      readonly snappedDestination: TrackCoordinate;
      readonly searchTrace?: TrailRouteSearchTrace;
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
      /** The exhausted search side reached the loaded area's edge, so a larger area may connect. */
      readonly visitedBoundary: boolean;
      readonly searchTrace?: TrailRouteSearchTrace;
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

/** A temporary arc piece of an edge split at snap points. */
interface SplitPiece {
  readonly parentEdgeKey: string;
  /** The piece end nearer the parent's `nodeA`. */
  readonly nodeA: string;
  /** Piece ends as fractions along the parent edge from its `nodeA`. */
  readonly fromFraction: number;
  readonly toFraction: number;
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

type TrailGraphBuildProgressListener = (progress: number) => void | Promise<void>;

async function candidatePrimitivePairs(
  primitives: readonly PrimitiveSegment[],
  onProgress?: TrailGraphBuildProgressListener,
): Promise<readonly (readonly [left: number, right: number])[]> {
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
    await onProgress?.((index + 1) / primitives.length);
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

async function nodePrimitives(
  primitives: readonly PrimitiveSegment[],
  onProgress?: TrailGraphBuildProgressListener,
): Promise<JunctionClusters> {
  const clusters = new JunctionClusters();
  const endpointTokens = new Map<string, number>();
  for (const [primitiveIndex, primitive] of primitives.entries()) {
    await onProgress?.((primitiveIndex / primitives.length) * 0.15);
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

  await onProgress?.(0.15);
  const pairs = await candidatePrimitivePairs(primitives, async (progress) => {
    await onProgress?.(0.15 + progress * 0.3);
  });
  for (const [pairIndex, [leftIndex, rightIndex]] of pairs.entries()) {
    await onProgress?.(0.45 + (pairIndex / pairs.length) * 0.55);
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
  await onProgress?.(1);
  return clusters;
}

async function splitPrimitiveEdges(
  primitives: readonly PrimitiveSegment[],
  clusters: JunctionClusters,
  onProgress?: TrailGraphBuildProgressListener,
): Promise<{
  readonly candidates: readonly CandidateEdge[];
  readonly nodeCoordinates: ReadonlyMap<string, GlobalMvtPoint>;
}> {
  const canonicalCoordinates = clusters.canonicalCoordinates();
  const candidates: CandidateEdge[] = [];
  const nodeCoordinates = new Map<string, GlobalMvtPoint>();
  for (const [primitiveIndex, primitive] of primitives.entries()) {
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
    await onProgress?.((primitiveIndex + 1) / primitives.length);
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

export async function buildTrailGraph(
  lines: readonly RoutingLineInput[],
  tiles: readonly RoutingGraphTile[],
  onProgress?: TrailGraphBuildProgressListener,
): Promise<TrailGraph> {
  let reportedPercentage = -1;
  const reportProgress = async (progress: number): Promise<void> => {
    const percentage = Math.floor(progress * 100);
    if (percentage === reportedPercentage) return;
    reportedPercentage = percentage;
    await onProgress?.(percentage / 100);
  };
  const primitives = collectPrimitives(lines);
  await reportProgress(0.15);
  const clusters = await nodePrimitives(primitives, async (progress) => {
    await reportProgress(0.15 + progress * 0.45);
  });
  await reportProgress(0.6);
  const { candidates, nodeCoordinates } = await splitPrimitiveEdges(
    primitives,
    clusters,
    async (progress) => {
      await reportProgress(0.6 + progress * 0.15);
    },
  );
  await reportProgress(0.75);
  const edges = new Map<string, TrailGraphEdge>();
  for (const [candidateIndex, candidate] of candidates.entries()) {
    await reportProgress(0.75 + (candidateIndex / candidates.length) * 0.15);
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
  await reportProgress(0.9);

  const coveredTileKeys = new Set(
    tiles.map((tile) => routingGraphTileKey(tile.graphX, tile.y)),
  );
  const nodes = new Map<string, TrailGraphNode>();
  for (const [key, global] of [...nodeCoordinates].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    nodes.set(key, {
      key,
      coordinate: globalMvtVertexToCoordinate(global[0], global[1]),
      boundary: isOnTileSetBoundary(coveredTileKeys, global[0], global[1]),
    });
  }
  await reportProgress(0.95);

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
  await reportProgress(1);
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

/**
 * The coordinate `routeTrailGraph` snaps `coordinate` to, or null beyond
 * `MAX_SNAP_DISTANCE_METERS`. Deterministic for one graph, so consecutive legs that share
 * a waypoint join exactly.
 */
export function snapCoordinateToTrailGraph(
  graph: TrailGraph,
  coordinate: TrackCoordinate,
): TrackCoordinate | null {
  const nearest = nearestEdge(graph, coordinate);
  if (
    nearest === null ||
    nearest.projection.distanceMeters > MAX_SNAP_DISTANCE_METERS
  ) {
    return null;
  }
  const { fraction } = nearest.projection;
  if (fraction <= fractionEpsilon) {
    return (
      graph.nodes.get(nearest.edge.nodeA)?.coordinate ?? nearest.projection.coordinate
    );
  }
  if (fraction >= 1 - fractionEpsilon) {
    return (
      graph.nodes.get(nearest.edge.nodeB)?.coordinate ?? nearest.projection.coordinate
    );
  }
  return nearest.projection.coordinate;
}

class MinimumQueue {
  readonly #entries: QueueEntry[] = [];

  public get size(): number {
    return this.#entries.length;
  }

  public peek(): QueueEntry | undefined {
    return this.#entries[0];
  }

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
  readonly splitPieces: ReadonlyMap<string, SplitPiece>;
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
  const splitPieces = new Map<string, SplitPiece>();
  const splitEdgeKeys = new Set(interiorByEdge.keys());
  for (const edgeKey of splitEdgeKeys) {
    const edge = graph.edges.get(edgeKey);
    if (edge === undefined) continue;
    for (const nodeKey of [edge.nodeA, edge.nodeB]) {
      if (adjacencyOverrides.has(nodeKey)) continue;
      adjacencyOverrides.set(
        nodeKey,
        (graph.adjacency.get(nodeKey) ?? []).filter(
          (arc) => !splitEdgeKeys.has(arc.edgeKey),
        ),
      );
    }
  }
  for (const [edgeKey, snaps] of interiorByEdge) {
    const edge = graph.edges.get(edgeKey);
    if (edge === undefined) continue;
    snaps.sort(
      (left, right) =>
        left.projection.fraction - right.projection.fraction ||
        left.role.localeCompare(right.role),
    );
    const chain = [edge.nodeA, ...snaps.map((snap) => snap.nodeKey), edge.nodeB];
    const fractions = [0, ...snaps.map((snap) => snap.projection.fraction), 1];
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
      splitPieces.set(splitEdgeKey, {
        parentEdgeKey: edgeKey,
        nodeA: from,
        fromFraction: fractions[index - 1] ?? 0,
        toFraction: fractions[index] ?? 1,
      });
      addArc(adjacencyOverrides, graph, from, to, splitEdgeKey, distanceMeters);
      addArc(adjacencyOverrides, graph, to, from, splitEdgeKey, distanceMeters);
    }
  }

  return {
    start: assigned[0],
    destination: assigned[1],
    coordinates: temporaryCoordinates,
    adjacency: adjacencyOverrides,
    splitPieces,
  };
}

/**
 * Samples terrain at every node and at evenly spaced interior points of edges longer than
 * `TERRAIN_SAMPLE_SPACING_METERS`. Returns null when any sample is unavailable, so one
 * search never mixes hiking-time and distance-only costs.
 */
export async function sampleTrailGraphTerrain(
  graph: TrailGraph,
  sampleElevations: (
    coordinates: readonly TrackCoordinate[],
  ) => Promise<readonly (number | null)[]>,
): Promise<TrailGraphTerrain | null> {
  const nodes = [...graph.nodes.values()];
  const coordinates: TrackCoordinate[] = nodes.map((node) => node.coordinate);
  const edges: { readonly edge: TrailGraphEdge; readonly firstInterior: number }[] = [];
  for (const edge of graph.edges.values()) {
    const start = graph.nodes.get(edge.nodeA)?.coordinate;
    const end = graph.nodes.get(edge.nodeB)?.coordinate;
    if (start === undefined || end === undefined) continue;
    edges.push({ edge, firstInterior: coordinates.length });
    const segmentCount = Math.ceil(edge.distanceMeters / TERRAIN_SAMPLE_SPACING_METERS);
    const longitudeDelta = normalizeLongitude(end[0] - start[0]);
    for (let index = 1; index < segmentCount; index += 1) {
      const fraction = index / segmentCount;
      coordinates.push([
        normalizeLongitude(start[0] + longitudeDelta * fraction),
        start[1] + (end[1] - start[1]) * fraction,
      ]);
    }
  }

  const elevations = await sampleElevations(coordinates);
  if (elevations.length !== coordinates.length) return null;
  const nodeElevationMeters = new Map<string, number>();
  for (const [index, node] of nodes.entries()) {
    const elevation = elevations[index];
    if (elevation === null || elevation === undefined) return null;
    nodeElevationMeters.set(node.key, elevation);
  }
  const edgeProfiles = new Map<string, readonly number[]>();
  for (const [position, { edge, firstInterior }] of edges.entries()) {
    const interiorEnd = edges[position + 1]?.firstInterior ?? coordinates.length;
    const profile = [
      nodeElevationMeters.get(edge.nodeA),
      ...elevations.slice(firstInterior, interiorEnd),
      nodeElevationMeters.get(edge.nodeB),
    ];
    if (
      !profile.every((elevation): elevation is number => typeof elevation === 'number')
    ) {
      return null;
    }
    edgeProfiles.set(edge.key, profile);
  }
  return { nodeElevationMeters, edgeProfiles };
}

/** Linearly interpolated elevation at `fraction` of an evenly sampled edge profile. */
function profileElevation(profile: readonly number[], fraction: number): number {
  const position = fraction * (profile.length - 1);
  const index = Math.max(0, Math.min(Math.floor(position), profile.length - 2));
  const start = profile[index] ?? 0;
  const end = profile[index + 1] ?? start;
  return start + (end - start) * (position - index);
}

/**
 * Climb and descent walking an edge profile from `fromFraction` to `toFraction`. The
 * walked sub-profile includes its interpolated ends, so the relief always covers the net
 * elevation change the search heuristics assume.
 */
function profileRelief(
  profile: readonly number[],
  fromFraction: number,
  toFraction: number,
): readonly [ascentMeters: number, descentMeters: number] {
  const low = Math.min(fromFraction, toFraction);
  const high = Math.max(fromFraction, toFraction);
  const lastIndex = profile.length - 1;
  const walked = [profileElevation(profile, low)];
  for (
    let index = Math.floor(low * lastIndex) + 1;
    index < high * lastIndex;
    index += 1
  ) {
    walked.push(profile[index] ?? 0);
  }
  walked.push(profileElevation(profile, high));
  let climb = 0;
  let drop = 0;
  for (let index = 1; index < walked.length; index += 1) {
    const change = (walked[index] ?? 0) - (walked[index - 1] ?? 0);
    if (change > 0) climb += change;
    else drop -= change;
  }
  return fromFraction <= toFraction ? [climb, drop] : [drop, climb];
}

interface SearchSide {
  readonly queue: MinimumQueue;
  readonly costSeconds: Map<string, number>;
  /** The arc that reached each node; its `from` is one step nearer this side's origin. */
  readonly previousArc: Map<string, TrailGraphArc>;
  readonly trace: TrailRouteSearchArc[];
  /** The backward side walks every adjacency arc in reverse, from `to` toward `from`. */
  readonly reversed: boolean;
  /** Lowest queued score; the opposite side prunes with it. */
  lowestScore: number;
  touchedBoundary: boolean;
}

/**
 * Bidirectional A* (NBA*, Pijls & Post 2009). Arc cost is the DIN 33466 hiking time used
 * for track estimates, so a short climb loses to a slightly longer level detour; without
 * terrain every arc is flat and the search minimizes distance.
 *
 * Both heuristics are DIN times for the straight-line distance and the net elevation
 * change to the side's target. DIN time is monotone and subadditive in distance, ascent,
 * and descent, and every arc covers at least its share of both, so the heuristics are
 * consistent and the meeting cost is optimal.
 */
export function routeTrailGraph(
  graph: TrailGraph,
  startCoordinate: TrackCoordinate,
  destinationCoordinate: TrackCoordinate,
  options: TrailGraphRouteOptions,
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
  const startKey = prepared.start.nodeKey;
  const destinationKey = prepared.destination.nodeKey;
  const destinationSnapCoordinate = coordinateForNode(destinationKey);
  const startSnapCoordinate = coordinateForNode(startKey);
  if (startSnapCoordinate === undefined || destinationSnapCoordinate === undefined) {
    return { status: 'failed', reason: 'no-route', visitedBoundary: false };
  }

  const { terrain } = options;
  const elevationForNode = (nodeKey: string): number => {
    if (terrain === null) return 0;
    const known = terrain.nodeElevationMeters.get(nodeKey);
    if (known !== undefined) return known;
    // Temporary snap nodes read their edge's sampled profile, matching the relief of the
    // split pieces that end at them.
    const snap = nodeKey === startKey ? prepared.start : prepared.destination;
    return profileElevation(
      terrain.edgeProfiles.get(snap.edge.key) ?? [0, 0],
      snap.projection.fraction,
    );
  };
  const walkSeconds = (arc: TrailGraphArc, reversed: boolean): number => {
    if (terrain === null) return estimateHikingSeconds(arc.distanceMeters, 0, 0);
    const piece = prepared.splitPieces.get(arc.edgeKey);
    const edgeKey = piece?.parentEdgeKey ?? arc.edgeKey;
    const nearEnd = piece?.fromFraction ?? 0;
    const farEnd = piece?.toFraction ?? 1;
    const leavesNearEnd =
      (arc.from === (piece?.nodeA ?? graph.edges.get(edgeKey)?.nodeA)) !== reversed;
    const [ascentMeters, descentMeters] = profileRelief(
      terrain.edgeProfiles.get(edgeKey) ?? [0, 0],
      leavesNearEnd ? nearEnd : farEnd,
      leavesNearEnd ? farEnd : nearEnd,
    );
    return estimateHikingSeconds(arc.distanceMeters, ascentMeters, descentMeters);
  };
  const startElevation = elevationForNode(startKey);
  const destinationElevation = elevationForNode(destinationKey);
  const heuristicSeconds = (side: SearchSide, nodeKey: string): number => {
    const coordinate = coordinateForNode(nodeKey);
    if (coordinate === undefined) return 0;
    const climbMeters = side.reversed
      ? elevationForNode(nodeKey) - startElevation
      : destinationElevation - elevationForNode(nodeKey);
    return estimateHikingSeconds(
      geodesicDistanceMeters(
        coordinate,
        side.reversed ? startSnapCoordinate : destinationSnapCoordinate,
      ),
      Math.max(0, climbMeters),
      Math.max(0, -climbMeters),
    );
  };

  const createSide = (origin: string, reversed: boolean): SearchSide => {
    const side: SearchSide = {
      queue: new MinimumQueue(),
      costSeconds: new Map([[origin, 0]]),
      previousArc: new Map(),
      trace: [],
      reversed,
      lowestScore: 0,
      touchedBoundary: false,
    };
    side.lowestScore = heuristicSeconds(side, origin);
    side.queue.push({ nodeKey: origin, score: side.lowestScore });
    return side;
  };
  const forward = createSide(startKey, false);
  const backward = createSide(destinationKey, true);
  const closed = new Set<string>();
  let bestSeconds = startKey === destinationKey ? 0 : Number.POSITIVE_INFINITY;
  let meetingNode: string | null = startKey === destinationKey ? startKey : null;

  let lastSide: SearchSide = backward;
  while (forward.queue.size > 0 && backward.queue.size > 0) {
    // Pijls & Post alternate the two processes every iteration; the smaller frontier
    // goes first, and ties alternate so a corridor still advances from both ends.
    const side =
      forward.queue.size === backward.queue.size
        ? lastSide === forward
          ? backward
          : forward
        : forward.queue.size < backward.queue.size
          ? forward
          : backward;
    lastSide = side;
    const opposite = side === forward ? backward : forward;
    const nodeKey = side.queue.pop()?.nodeKey;
    if (nodeKey !== undefined && !closed.has(nodeKey)) {
      closed.add(nodeKey);
      if (graph.nodes.get(nodeKey)?.boundary === true) side.touchedBoundary = true;
      const nodeCost = side.costSeconds.get(nodeKey) ?? Number.POSITIVE_INFINITY;
      const nodeCoordinate = coordinateForNode(nodeKey);
      // NBA* closes a node without expanding it when no path through it can beat the
      // best meeting found so far.
      const promising =
        nodeCost + heuristicSeconds(side, nodeKey) <
          bestSeconds - costTieEpsilonSeconds &&
        nodeCost + opposite.lowestScore - heuristicSeconds(opposite, nodeKey) <
          bestSeconds - costTieEpsilonSeconds;
      const arcs = promising
        ? (prepared.adjacency.get(nodeKey) ?? graph.adjacency.get(nodeKey) ?? [])
        : [];
      for (const arc of arcs) {
        if (closed.has(arc.to)) continue;
        const nextCoordinate = coordinateForNode(arc.to);
        if (nodeCoordinate === undefined || nextCoordinate === undefined) continue;
        const candidateCost = nodeCost + walkSeconds(arc, side.reversed);
        const knownCost = side.costSeconds.get(arc.to);
        if (
          knownCost !== undefined &&
          candidateCost >= knownCost - costTieEpsilonSeconds
        ) {
          continue;
        }
        side.costSeconds.set(arc.to, candidateCost);
        side.previousArc.set(arc.to, arc);
        side.queue.push({
          nodeKey: arc.to,
          score: candidateCost + heuristicSeconds(side, arc.to),
        });
        if (options.includeSearchTrace)
          side.trace.push([nodeCoordinate, nextCoordinate]);
        const oppositeCost = opposite.costSeconds.get(arc.to);
        if (oppositeCost !== undefined && candidateCost + oppositeCost < bestSeconds) {
          bestSeconds = candidateCost + oppositeCost;
          meetingNode = arc.to;
        }
      }
    }
    let top = side.queue.peek();
    while (top !== undefined && closed.has(top.nodeKey)) {
      side.queue.pop();
      top = side.queue.peek();
    }
    side.lowestScore = top?.score ?? Number.POSITIVE_INFINITY;
  }

  const searchTrace = options.includeSearchTrace
    ? { searchTrace: { forward: forward.trace, backward: backward.trace } }
    : {};
  if (meetingNode === null) {
    return {
      status: 'failed',
      reason: 'no-route',
      // Only the exhausted side has explored its whole component.
      visitedBoundary:
        forward.queue.size === 0 ? forward.touchedBoundary : backward.touchedBoundary,
      ...searchTrace,
    };
  }

  const path = [meetingNode];
  let networkDistanceMeters = 0;
  for (let arc = forward.previousArc.get(meetingNode); arc !== undefined;) {
    path.unshift(arc.from);
    networkDistanceMeters += arc.distanceMeters;
    arc = arc.from === startKey ? undefined : forward.previousArc.get(arc.from);
  }
  for (let arc = backward.previousArc.get(meetingNode); arc !== undefined;) {
    path.push(arc.from);
    networkDistanceMeters += arc.distanceMeters;
    arc = arc.from === destinationKey ? undefined : backward.previousArc.get(arc.from);
  }
  const coordinates = path
    .map((nodeKey) => coordinateForNode(nodeKey))
    .filter((coordinate): coordinate is TrackCoordinate => coordinate !== undefined);
  const onlyCoordinate = coordinates[0];
  if (coordinates.length === 1 && onlyCoordinate !== undefined) {
    coordinates.push(onlyCoordinate);
  }
  return {
    status: 'ready',
    coordinates,
    networkDistanceMeters,
    snappedStart: startSnapCoordinate,
    snappedDestination: destinationSnapCoordinate,
    ...searchTrace,
  };
}
