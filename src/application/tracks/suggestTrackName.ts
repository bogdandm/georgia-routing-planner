import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import {
  PlaceSearchFailure,
  type PlaceSearchFailureCode,
  type PlaceSearchResult,
} from '@/application/ports/PlaceSearchGateway';
import type { TrackCoordinate, TrackSegment } from '@/domain/tracks/gpx';
import {
  findDominantSummit,
  geodesicDistanceMeters,
} from '@/domain/tracks/trackCalculations';
import {
  classifyTrackNamingShape,
  composeTrackName,
  formatNamingLabel,
  type PoiCandidate,
  type TrackNameLandmarkAnchor,
} from '@/domain/tracks/trackNaming';

export interface TrackNamingPlaces {
  reverseSettlement(
    coordinate: { readonly longitude: number; readonly latitude: number },
    signal: AbortSignal,
  ): Promise<PlaceSearchResult | null>;
  nearby(
    coordinate: { readonly longitude: number; readonly latitude: number },
    signal: AbortSignal,
  ): Promise<readonly PlaceSearchResult[]>;
}

/** A place lookup that failed; the suggestion was built without it. */
export interface TrackNameLookupFailure {
  /** `landmark` is the nearby-feature (Overpass) lookup; `settlement` the reverse geocoder. */
  readonly lookup: 'settlement' | 'landmark';
  readonly reason: PlaceSearchFailureCode | 'unknown';
}

/** Provenance field names match the persisted `LocalTrackSummary`. */
export interface TrackNameSuggestion {
  readonly generatedName?: string;
  readonly middleAnchorKind?: TrackNameLandmarkAnchor;
  readonly startPoi?: PoiCandidate;
  /** Landmark at the dominant summit or closed-track turnaround. */
  readonly middlePoi?: PoiCandidate;
  readonly endPoi?: PoiCandidate;
  /** Distinct failed lookups, so the UI can explain a missing or partial name. */
  readonly lookupFailures?: readonly TrackNameLookupFailure[];
}

type TrackNameSuggestionBuilder = {
  -readonly [Key in keyof TrackNameSuggestion]: TrackNameSuggestion[Key];
};

type LocatedCandidate = PoiCandidate & { readonly distanceMeters: number };

/** A settlement this close to an endpoint names it without a landmark lookup. */
const SETTLEMENT_PREFERRED_METERS = 1_000;
/** Beyond this distance a settlement no longer describes the anchor. */
const SETTLEMENT_MAXIMUM_METERS = 3_000;

interface LandmarkRank {
  /** Distance multiplier: lower-weight classes win over nearer weaker landmarks. */
  readonly weight: number;
  readonly radiusMeters: number;
}

const summitRank: LandmarkRank = { weight: 1, radiusMeters: 1_000 };
const waterRank: LandmarkRank = { weight: 1.5, radiusMeters: 2_000 };
const featureRank: LandmarkRank = { weight: 2, radiusMeters: 2_000 };

const landmarkRanks: Readonly<Record<string, LandmarkRank>> = {
  'mountain_pass:yes': summitRank,
  'natural:peak': summitRank,
  'natural:volcano': summitRank,
  'natural:saddle': summitRank,
  'natural:water': waterRank,
  'natural:glacier': waterRank,
  'waterway:waterfall': waterRank,
  'natural:cave_entrance': featureRank,
  'tourism:alpine_hut': featureRank,
  'tourism:wilderness_hut': featureRank,
  'tourism:viewpoint': featureRank,
  'tourism:camp_site': featureRank,
  'tourism:attraction': featureRank,
  'amenity:shelter': featureRank,
  'amenity:place_of_worship': featureRank,
  'place:city': featureRank,
  'place:town': featureRank,
  'place:village': featureRank,
  'place:hamlet': featureRank,
  'place:isolated_dwelling': featureRank,
  'place:locality': featureRank,
};

function landmarkRank(category: string): LandmarkRank | undefined {
  return category.startsWith('historic:') ? featureRank : landmarkRanks[category];
}

function locate(
  result: PlaceSearchResult,
  anchor: TrackCoordinate,
  lookedUpAt: string,
): LocatedCandidate | null {
  const label = formatNamingLabel(result.label, result.category);
  if (label === null) return null;
  const matchedCoordinate: TrackCoordinate = [
    result.coordinate.longitude,
    result.coordinate.latitude,
  ];
  const { bounds } = result;
  // A city district's node can lie kilometres away while the anchor is inside it.
  const insideMatchedArea =
    bounds !== null &&
    anchor[0] >= bounds.west &&
    anchor[0] <= bounds.east &&
    anchor[1] >= bounds.south &&
    anchor[1] <= bounds.north;
  return {
    label,
    kind: result.kind,
    matchedCoordinate,
    distanceMeters: insideMatchedArea
      ? 0
      : geodesicDistanceMeters(anchor, matchedCoordinate),
    lookedUpAt,
  };
}

/**
 * Suggests an English name for an imported track from its start, finish, and one
 * landmark: the dominant summit, or the turnaround of a closed track. Multiple
 * segments are joined into one journey. Failed lookups are logged, reported in
 * `lookupFailures`, and treated as missing parts: a failed settlement falls back to a
 * landmark and vice versa. Cancellation propagates.
 */
export async function suggestTrackName(input: {
  readonly segments: readonly TrackSegment[];
  readonly places: TrackNamingPlaces;
  readonly logger: DiagnosticLogger;
  readonly lookedUpAt: string;
  readonly signal: AbortSignal;
}): Promise<TrackNameSuggestion> {
  const { places, logger, lookedUpAt, signal } = input;
  const points = input.segments.flatMap((segment) => segment.points);
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return {};

  const lookupFailures: TrackNameLookupFailure[] = [];
  const recordFailure = (lookup: TrackNameLookupFailure['lookup'], error: unknown) => {
    signal.throwIfAborted();
    const reason = error instanceof PlaceSearchFailure ? error.code : 'unknown';
    logger.log({
      level: 'warn',
      name:
        lookup === 'landmark'
          ? 'local-track.nearby-poi.failed'
          : 'local-track.settlement-lookup.failed',
      data: { reason },
    });
    if (!lookupFailures.some((f) => f.lookup === lookup && f.reason === reason)) {
      lookupFailures.push({ lookup, reason });
    }
  };
  const settlementNear = async (anchor: TrackCoordinate) => {
    let result: PlaceSearchResult | null;
    try {
      result = await places.reverseSettlement(
        { longitude: anchor[0], latitude: anchor[1] },
        signal,
      );
    } catch (error) {
      recordFailure('settlement', error);
      return null;
    }
    return result === null ? null : locate(result, anchor, lookedUpAt);
  };
  const landmarkNear = async (anchor: TrackCoordinate) => {
    let results: readonly PlaceSearchResult[];
    try {
      results = await places.nearby(
        { longitude: anchor[0], latitude: anchor[1] },
        signal,
      );
    } catch (error) {
      recordFailure('landmark', error);
      return null;
    }
    let best: LocatedCandidate | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const result of results) {
      const rank = landmarkRank(result.category);
      const candidate = rank === undefined ? null : locate(result, anchor, lookedUpAt);
      if (rank === undefined || candidate === null) continue;
      const score = candidate.distanceMeters * rank.weight;
      if (candidate.distanceMeters <= rank.radiusMeters && score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  };
  const endpointPoi = async (anchor: TrackCoordinate) => {
    const settlement = await settlementNear(anchor);
    if (
      settlement !== null &&
      settlement.distanceMeters <= SETTLEMENT_PREFERRED_METERS
    ) {
      return settlement;
    }
    const landmark = await landmarkNear(anchor);
    if (landmark !== null) return landmark;
    return settlement !== null && settlement.distanceMeters <= SETTLEMENT_MAXIMUM_METERS
      ? settlement
      : null;
  };
  const landmarkPoiAt = async (anchor: TrackCoordinate) => {
    const landmark = await landmarkNear(anchor);
    if (landmark !== null) return landmark;
    const settlement = await settlementNear(anchor);
    return settlement !== null && settlement.distanceMeters <= SETTLEMENT_MAXIMUM_METERS
      ? settlement
      : null;
  };

  const shape = classifyTrackNamingShape(
    input.segments.map((segment) => segment.points.map((point) => point.coordinate)),
  );
  const summit = findDominantSummit(points);
  let landmarkAnchor: TrackNameLandmarkAnchor | undefined;
  let landmarkCoordinate: TrackCoordinate | undefined;
  if (summit !== null) {
    landmarkAnchor = 'dominant-summit';
    landmarkCoordinate = summit.coordinate;
  } else if (shape.kind !== 'one-way') {
    landmarkAnchor = 'farthest-point';
    landmarkCoordinate = shape.farthestCoordinate;
  }

  // The landmark goes first: it is the most informative part of the name.
  const landmarkPoi =
    landmarkCoordinate === undefined ? null : await landmarkPoiAt(landmarkCoordinate);
  const startPoi = await endpointPoi(first.coordinate);
  // A closed track finishes beside its start, so its finish adds no information.
  const endPoi = shape.kind === 'one-way' ? await endpointPoi(last.coordinate) : null;

  const result: TrackNameSuggestionBuilder = {};
  const generatedName = composeTrackName({
    shape: shape.kind,
    start: startPoi?.label,
    end: endPoi?.label,
    landmark: landmarkPoi?.label,
  });
  if (generatedName !== null) result.generatedName = generatedName;
  if (landmarkAnchor !== undefined) result.middleAnchorKind = landmarkAnchor;
  if (startPoi !== null) result.startPoi = startPoi;
  if (landmarkPoi !== null) result.middlePoi = landmarkPoi;
  if (endPoi !== null) result.endPoi = endPoi;
  if (lookupFailures.length > 0) result.lookupFailures = lookupFailures;
  return result;
}
