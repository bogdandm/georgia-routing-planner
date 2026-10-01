import type { TrackCoordinate } from '@/domain/tracks/gpx';
import {
  EARTH_RADIUS_METERS,
  geodesicDistanceMeters,
  isLoop,
} from '@/domain/tracks/trackCalculations';

/** Place label resolved for one naming anchor of an imported track. */
export interface PoiCandidate {
  readonly label: string;
  readonly kind: string;
  readonly matchedCoordinate: TrackCoordinate;
  readonly distanceMeters?: number;
  readonly lookedUpAt: string;
}

/** Track position whose surroundings supplied the naming landmark. */
export type TrackNameLandmarkAnchor = 'dominant-summit' | 'farthest-point';

export type TrackNamingShape =
  | { readonly kind: 'one-way' }
  | {
      readonly kind: 'loop' | 'out-and-back';
      /** Turnaround used as the destination when no dominant summit exists. */
      readonly farthestCoordinate: TrackCoordinate;
    };

/** Longer provider labels are usually descriptions rather than usable place names. */
const MAXIMUM_LABEL_LENGTH = 60;
/** Optional `via`/`from` qualifiers are dropped once a name exceeds this length. */
const PREFERRED_NAME_LENGTH = 80;
/** Return-leg samples within this distance of the outbound leg count as retraced. */
const RETRACE_TOLERANCE_METERS = 60;
/** Share of retraced return-leg samples that makes a closed track out-and-back. */
const OUT_AND_BACK_RETRACED_SHARE = 0.7;
const RETURN_SAMPLE_COUNT = 200;
const OUTBOUND_SAMPLE_COUNT = 2_000;

// Georgian romanization as written on road signs, maps, and English-language guides:
// the national system (2002) without ejective apostrophes, and ყ as `k` rather than
// the standard's `q` (ყელიდა → Kelida, ყაზბეგი → Kazbegi). Indexed from U+10D0.
// prettier-ignore
const georgianLatin = [
  'a', 'b', 'g', 'd', 'e', 'v', 'z', 't', 'i', 'k', 'l', 'm', 'n', 'o', 'p', 'zh',
  'r', 's', 't', 'u', 'p', 'k', 'gh', 'k', 'sh', 'ch', 'ts', 'dz', 'ts', 'ch', 'kh',
  'j', 'h', 'e', 'y', 'w', 'k', 'o', 'f',
] as const;
const georgianStart = 0x10d0;
/** Mtavruli capitals share Mkhedruli order at this code-point offset. */
const mtavruliOffset = 0x1c90 - georgianStart;

// BGN/PCGN romanization of Russian without diacritics or soft/hard-sign marks, plus
// the Ukrainian and Belarusian letters that appear in regional OSM names.
// prettier-ignore
const cyrillicLatin: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e',
  ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u',
};
/** After these letters, and at a word start, BGN/PCGN writes `е`/`ё` as `ye`. */
const cyrillicIotatingPredecessors = 'аеёиоуыэюяйъьіїє';

function capitalize(value: string): string {
  return value.length === 0
    ? value
    : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

function georgianIndex(character: string): number | null {
  const codePoint = character.codePointAt(0) ?? 0;
  const index =
    codePoint >= 0x1c90 && codePoint <= 0x1cbf
      ? codePoint - mtavruliOffset - georgianStart
      : codePoint - georgianStart;
  return index >= 0 && index < georgianLatin.length ? index : null;
}

/**
 * Returns a Latin-script form of a place label. Georgian and Cyrillic are romanized;
 * a label that still contains letters from another script is rejected.
 */
export function romanizePlaceLabel(label: string): string | null {
  let result = '';
  let previous = '';
  for (const character of label) {
    const atWordStart = !/\p{L}/u.test(previous);
    const georgian = georgianIndex(character);
    const lower = character.toLowerCase();
    if (georgian !== null) {
      const latin = georgianLatin[georgian] ?? '';
      // Georgian is unicase; title-case each romanized word for English use.
      result += atWordStart ? capitalize(latin) : latin;
    } else if (lower === 'е' || lower === 'ё') {
      const latin =
        atWordStart || cyrillicIotatingPredecessors.includes(previous.toLowerCase())
          ? 'ye'
          : 'e';
      result += lower === character ? latin : capitalize(latin);
    } else if (cyrillicLatin[lower] !== undefined) {
      const latin = cyrillicLatin[lower];
      result += lower === character ? latin : capitalize(latin);
    } else if (/\p{L}/u.test(character) && !/\p{Script=Latin}/u.test(character)) {
      return null;
    } else {
      result += character;
    }
    previous = character;
  }
  return result;
}

/**
 * Converts a provider place label into a usable English name part: whitespace is
 * collapsed, the label is romanized, and peaks and passes are qualified.
 */
export function formatNamingLabel(label: string, category: string): string | null {
  const romanized = romanizePlaceLabel(label.trim().replace(/\s+/gu, ' '));
  if (
    romanized === null ||
    romanized.length === 0 ||
    romanized.length > MAXIMUM_LABEL_LENGTH
  ) {
    return null;
  }
  if (category === 'mountain_pass:yes' && !/\bpass\b/iu.test(romanized)) {
    return `${romanized} Pass`;
  }
  if (
    (category === 'natural:peak' || category === 'natural:volcano') &&
    !/^(?:mt\.?|mount)\s/iu.test(romanized)
  ) {
    return `Mt. ${romanized}`;
  }
  return romanized;
}

interface PlanarPoint {
  readonly x: number;
  readonly y: number;
}

function planarProjection(
  origin: TrackCoordinate,
): (coordinate: TrackCoordinate) => PlanarPoint {
  const metersPerDegree = (EARTH_RADIUS_METERS * Math.PI) / 180;
  const longitudeScale = metersPerDegree * Math.cos((origin[1] * Math.PI) / 180);
  return (coordinate) => ({
    x: (coordinate[0] - origin[0]) * longitudeScale,
    y: (coordinate[1] - origin[1]) * metersPerDegree,
  });
}

function segmentDistanceMeters(
  point: PlanarPoint,
  a: PlanarPoint,
  b: PlanarPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * Resamples a polyline at equal path-length intervals so retrace shares measure distance
 * rather than GPS recording density, and bounds the cost of dense recordings.
 */
function resampleByDistance(
  points: readonly PlanarPoint[],
  count: number,
): readonly PlanarPoint[] {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const accumulated = cumulative[index - 1] ?? 0;
    cumulative.push(
      previous === undefined || current === undefined
        ? accumulated
        : accumulated + Math.hypot(current.x - previous.x, current.y - previous.y),
    );
  }
  const total = cumulative.at(-1) ?? 0;
  const first = points[0];
  if (first === undefined || total === 0) return first === undefined ? [] : [first];
  const samples: PlanarPoint[] = [];
  let segment = 1;
  for (let sample = 0; sample < count; sample += 1) {
    const target = (total * sample) / (count - 1);
    while (segment < points.length - 1 && (cumulative[segment] ?? total) < target) {
      segment += 1;
    }
    const a = points[segment - 1] ?? first;
    const b = points[segment] ?? a;
    const start = cumulative[segment - 1] ?? 0;
    const length = (cumulative[segment] ?? start) - start;
    const t = length === 0 ? 0 : (target - start) / length;
    samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return samples;
}

/**
 * Classifies the joined track for naming. A closed track is out-and-back when most of
 * the return leg after its farthest point retraces the outbound leg; otherwise a loop.
 */
export function classifyTrackNamingShape(
  segments: readonly (readonly TrackCoordinate[])[],
): TrackNamingShape {
  const path = segments.flat();
  const start = path[0];
  if (start === undefined || !isLoop(segments)) return { kind: 'one-way' };

  let turnaroundIndex = 0;
  let farthestMeters = -1;
  for (const [index, coordinate] of path.entries()) {
    const distance = geodesicDistanceMeters(start, coordinate);
    if (distance > farthestMeters) {
      farthestMeters = distance;
      turnaroundIndex = index;
    }
  }
  const farthestCoordinate = path[turnaroundIndex] ?? start;

  const project = planarProjection(start);
  const outbound = resampleByDistance(
    path.slice(0, turnaroundIndex + 1).map(project),
    OUTBOUND_SAMPLE_COUNT,
  );
  const inbound = resampleByDistance(
    path.slice(turnaroundIndex).map(project),
    RETURN_SAMPLE_COUNT,
  );
  let retraced = 0;
  for (const sample of inbound) {
    for (let index = 0; index < outbound.length; index += 1) {
      const a = outbound[index];
      const b = outbound[index + 1] ?? a;
      if (
        a !== undefined &&
        b !== undefined &&
        segmentDistanceMeters(sample, a, b) <= RETRACE_TOLERANCE_METERS
      ) {
        retraced += 1;
        break;
      }
    }
  }
  const kind =
    inbound.length > 0 && retraced / inbound.length >= OUT_AND_BACK_RETRACED_SHARE
      ? 'out-and-back'
      : 'loop';
  return { kind, farthestCoordinate };
}

function sameLabel(left: string, right: string): boolean {
  return left.localeCompare(right, 'en', { sensitivity: 'base' }) === 0;
}

function withOptionalQualifier(base: string, qualifier: string): string {
  const full = `${base}${qualifier}`;
  return full.length > PREFERRED_NAME_LENGTH ? base : full;
}

/**
 * Builds the suggested English name from formatted anchor labels:
 * one-way `A → B via X`, loop `X loop from A`, out-and-back `X from A`.
 */
export function composeTrackName(input: {
  readonly shape: TrackNamingShape['kind'];
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  readonly landmark?: string | undefined;
}): string | null {
  const { start } = input;
  const end =
    input.end !== undefined && (start === undefined || !sameLabel(start, input.end))
      ? input.end
      : undefined;
  const landmark =
    input.landmark !== undefined &&
    [start, input.end].every(
      (label) => label === undefined || !sameLabel(label, input.landmark ?? ''),
    )
      ? input.landmark
      : undefined;
  // A one-way track that finishes in its starting settlement reads as out-and-back.
  const shape =
    input.shape === 'one-way' && input.end !== undefined && end === undefined
      ? 'out-and-back'
      : input.shape;

  if (shape === 'one-way') {
    if (start !== undefined && end !== undefined) {
      const base = `${start} \u2192 ${end}`;
      return landmark === undefined
        ? base
        : withOptionalQualifier(base, ` via ${landmark}`);
    }
    const parts = [start, landmark, end].filter((part) => part !== undefined);
    return parts.length === 0 ? null : parts.join(' \u2192 ');
  }
  const destination =
    landmark === undefined
      ? undefined
      : shape === 'loop'
        ? `${landmark} loop`
        : landmark;
  if (destination === undefined) {
    if (start === undefined) return null;
    return shape === 'loop' ? `${start} loop` : start;
  }
  return start === undefined
    ? destination
    : withOptionalQualifier(destination, ` from ${start}`);
}
