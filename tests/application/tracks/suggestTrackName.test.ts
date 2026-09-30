import { describe, expect, it, vi, type Mock } from 'vitest';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type {
  PlaceSearchKind,
  PlaceSearchResult,
} from '@/application/ports/PlaceSearchGateway';
import {
  suggestTrackName,
  type TrackNamingPlaces,
} from '@/application/tracks/suggestTrackName';
import type { TrackCoordinate, TrackPoint, TrackSegment } from '@/domain/tracks/gpx';

const lookedUpAt = '2026-09-30T12:00:00.000Z';

function createLogger(): DiagnosticLogger & {
  readonly log: Mock<DiagnosticLogger['log']>;
} {
  return {
    log: vi.fn<DiagnosticLogger['log']>(),
    getEvents: () => [],
    subscribe: () => () => undefined,
  };
}

function line(
  from: TrackCoordinate,
  to: TrackCoordinate,
  steps: number,
  elevation?: (fraction: number) => number,
): TrackPoint[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const fraction = index / steps;
    const coordinate = [
      from[0] + (to[0] - from[0]) * fraction,
      from[1] + (to[1] - from[1]) * fraction,
    ] as const;
    return elevation === undefined
      ? { coordinate }
      : { coordinate, elevationMeters: elevation(fraction) };
  });
}

function place(
  label: string,
  category: string,
  kind: PlaceSearchKind,
  [longitude, latitude]: TrackCoordinate,
): PlaceSearchResult {
  return {
    id: `${category}/${label}`,
    label,
    category,
    kind,
    coordinate: { longitude, latitude },
    bounds: null,
  };
}

type Lookup<T> = readonly (readonly [TrackCoordinate, T])[];

/** Answers each lookup by the anchor coordinate it was requested for. */
function fakePlaces(
  settlements: Lookup<PlaceSearchResult>,
  landmarks: Lookup<readonly PlaceSearchResult[]>,
): TrackNamingPlaces & {
  readonly reverseSettlement: Mock<TrackNamingPlaces['reverseSettlement']>;
  readonly nearby: Mock<TrackNamingPlaces['nearby']>;
} {
  const find = <T>(
    lookup: Lookup<T>,
    coordinate: { longitude: number; latitude: number },
  ) =>
    lookup.find(
      ([anchor]) =>
        Math.abs(anchor[0] - coordinate.longitude) < 1e-9 &&
        Math.abs(anchor[1] - coordinate.latitude) < 1e-9,
    )?.[1];
  return {
    reverseSettlement: vi.fn<TrackNamingPlaces['reverseSettlement']>((coordinate) =>
      Promise.resolve(find(settlements, coordinate) ?? null),
    ),
    nearby: vi.fn<TrackNamingPlaces['nearby']>((coordinate) =>
      Promise.resolve(find(landmarks, coordinate) ?? []),
    ),
  };
}

const squareLoop: TrackSegment = {
  points: [
    ...line([44, 42], [44.01, 42], 20),
    ...line([44.01, 42], [44.01, 42.01], 20),
    ...line([44.01, 42.01], [44, 42.01], 20),
    ...line([44, 42.01], [44, 42], 20),
  ],
};

describe('suggestTrackName', () => {
  it('names a multi-segment one-way crossing from both settlements via the summit landmark', async () => {
    // Triangular profile peaking at 44.75°E; the recording is split into two segments.
    const points = line([44.7, 42.6], [44.8, 42.6], 40, (fraction) =>
      fraction <= 0.5 ? 1_000 + fraction * 3_000 : 2_500 - (fraction - 0.5) * 2_600,
    );
    const segments = [{ points: points.slice(0, 26) }, { points: points.slice(26) }];
    const summit: TrackCoordinate = [44.75, 42.6];
    const places = fakePlaces(
      [
        [[44.7, 42.6], place('Juta', 'place:village', 'settlement', [44.702, 42.6])],
        [[44.8, 42.6], place('როშკა', 'place:village', 'settlement', [44.798, 42.6])],
      ],
      [
        [
          summit,
          [
            place('Café', 'amenity:cafe', 'other', [44.7501, 42.6]),
            place('Chaukhi', 'natural:peak', 'mountain', [44.75, 42.6063]),
            place('Abudelauri Lakes', 'natural:water', 'water', [44.7537, 42.6]),
            place('ჭაუხი', 'mountain_pass:yes', 'mountain', [44.75, 42.6018]),
          ],
        ],
      ],
    );

    const suggestion = await suggestTrackName({
      segments,
      places,
      logger: createLogger(),
      lookedUpAt,
      signal: new AbortController().signal,
    });

    expect(suggestion.generatedName).toBe('Juta → Roshka via Chaukhi Pass');
    expect(suggestion.middleAnchorKind).toBe('dominant-summit');
    expect(suggestion.middlePoi).toMatchObject({
      label: 'Chaukhi Pass',
      kind: 'mountain',
      matchedCoordinate: [44.75, 42.6018],
      lookedUpAt,
    });
    expect(suggestion.middlePoi?.distanceMeters).toBeCloseTo(200, -1);
    expect(suggestion.startPoi?.label).toBe('Juta');
    expect(suggestion.endPoi?.label).toBe('Roshka');
    // Settlements within 1 km name the endpoints without a landmark lookup.
    expect(places.nearby).toHaveBeenCalledOnce();
  });

  it('prefers an endpoint landmark over a distant settlement and ignores settlements beyond 3 km', async () => {
    const segments = [{ points: line([44, 42], [44.05, 42], 20) }];
    const places = fakePlaces(
      [
        [[44, 42], place('Ushguli', 'place:village', 'settlement', [44, 42.0135])],
        [
          [44.05, 42],
          place('Zhabeshi', 'place:village', 'settlement', [44.05, 42.0225]),
        ],
      ],
      [[[44, 42], [place('Koruldi Lakes', 'natural:water', 'water', [44.003, 42])]]],
    );
    const tooFar = fakePlaces(
      [
        [[44, 42], place('Ushguli', 'place:village', 'settlement', [44, 42.03])],
        [[44.05, 42], place('Zhabeshi', 'place:village', 'settlement', [44.05, 42.03])],
      ],
      [],
    );
    const request = {
      segments,
      logger: createLogger(),
      lookedUpAt,
      signal: new AbortController().signal,
    };

    await expect(suggestTrackName({ ...request, places })).resolves.toMatchObject({
      generatedName: 'Koruldi Lakes → Zhabeshi',
    });
    const unnamed = await suggestTrackName({ ...request, places: tooFar });
    expect(unnamed).toEqual({});
  });

  it('names an endpoint inside a large settlement area even when its node is far away', async () => {
    const city: PlaceSearchResult = {
      ...place('Tbilisi', 'place:city', 'settlement', [44.03, 42]),
      bounds: { west: 43.9, south: 41.9, east: 44.1, north: 42.1 },
    };
    const places = fakePlaces([[[44, 42], city]], []);

    const suggestion = await suggestTrackName({
      segments: [{ points: line([44, 42], [44.3, 42], 20) }],
      places,
      logger: createLogger(),
      lookedUpAt,
      signal: new AbortController().signal,
    });

    expect(suggestion.generatedName).toBe('Tbilisi');
    expect(suggestion.startPoi?.distanceMeters).toBe(0);
  });

  it('names a loop without a summit by its farthest landmark and skips the finish', async () => {
    const places = fakePlaces(
      [[[44, 42], place('Mestia', 'place:town', 'settlement', [44.001, 42])]],
      [
        [
          [44.01, 42.01],
          [place('Koruldi Lakes', 'natural:water', 'water', [44.0105, 42.0105])],
        ],
      ],
    );

    const suggestion = await suggestTrackName({
      segments: [squareLoop],
      places,
      logger: createLogger(),
      lookedUpAt,
      signal: new AbortController().signal,
    });

    expect(suggestion.generatedName).toBe('Koruldi Lakes loop from Mestia');
    expect(suggestion.middleAnchorKind).toBe('farthest-point');
    expect(suggestion.endPoi).toBeUndefined();
    expect(places.reverseSettlement).toHaveBeenCalledOnce();
  });

  it('logs a failed landmark lookup and falls back to the nearest settlement', async () => {
    const outbound = line([44, 42], [44.02, 42], 40);
    const inbound = line([44.02, 42.0002], [44, 42.0002], 40);
    const places = fakePlaces(
      [
        [[44, 42], place('Stepantsminda', 'place:town', 'settlement', [44.0005, 42])],
        [
          [44.02, 42.0002],
          place('Gergeti', 'place:village', 'settlement', [44.03, 42.0002]),
        ],
      ],
      [],
    );
    places.nearby.mockRejectedValue(new Error('Overpass unavailable'));
    const logger = createLogger();

    const suggestion = await suggestTrackName({
      segments: [{ points: [...outbound, ...inbound] }],
      places,
      logger,
      lookedUpAt,
      signal: new AbortController().signal,
    });

    expect(suggestion.generatedName).toBe('Gergeti from Stepantsminda');
    expect(logger.log).toHaveBeenCalledWith({
      level: 'warn',
      name: 'local-track.nearby-poi.failed',
    });
  });

  it('propagates settlement failures and cancellation', async () => {
    const failing = fakePlaces([], []);
    failing.reverseSettlement.mockRejectedValue(new Error('Nominatim unavailable'));
    await expect(
      suggestTrackName({
        segments: [squareLoop],
        places: failing,
        logger: createLogger(),
        lookedUpAt,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('Nominatim unavailable');

    const controller = new AbortController();
    const cancelled = fakePlaces([], []);
    cancelled.nearby.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('Cancelled.', 'AbortError'));
    });
    const logger = createLogger();
    await expect(
      suggestTrackName({
        segments: [squareLoop],
        places: cancelled,
        logger,
        lookedUpAt,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('returns no suggestion for a track without points', async () => {
    const places = fakePlaces([], []);
    await expect(
      suggestTrackName({
        segments: [{ points: [] }],
        places,
        logger: createLogger(),
        lookedUpAt,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({});
    expect(places.reverseSettlement).not.toHaveBeenCalled();
  });
});
