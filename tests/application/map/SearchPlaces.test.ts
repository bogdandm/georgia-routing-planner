import { describe, expect, it, vi } from 'vitest';

import { SearchPlaces, type PlaceSearchProgress } from '@/application/map/SearchPlaces';
import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { PlaceSearchGateway } from '@/application/ports/PlaceSearchGateway';

const initialBounds = { west: 44.7, south: 41.6, east: 44.9, north: 41.8 } as const;

function createSearchPlaces(
  gateway: PlaceSearchGateway,
  logger: DiagnosticLogger = { log: vi.fn(), getEvents: () => [] },
) {
  return new SearchPlaces(
    gateway,
    logger,
    { generate: () => 'place-search-operation' },
    { now: () => new Date(0), monotonicNow: () => 0 },
  );
}

describe('SearchPlaces', () => {
  it('keeps expanding after a match and appends unique results from wider areas', async () => {
    const nearbyResult = {
      id: 'batumi-street',
      label: 'Batumi Street, Gori, Georgia',
      coordinate: { longitude: 44.11, latitude: 41.98 },
      category: 'highway:residential',
      kind: 'other',
      bounds: null,
    } as const;
    const distantResult = {
      id: 'oni',
      label: 'Oni, Georgia',
      coordinate: { longitude: 43.4425, latitude: 42.5794 },
      category: 'place:town',
      kind: 'settlement',
      bounds: null,
    } as const;
    const duplicateNearbyWay = {
      ...nearbyResult,
      id: 'batumi-street-second-osm-way',
    } as const;
    const search = vi
      .fn()
      .mockResolvedValueOnce([nearbyResult])
      .mockResolvedValueOnce([duplicateNearbyWay, distantResult])
      .mockResolvedValue([duplicateNearbyWay, distantResult]);
    const progress: PlaceSearchProgress[] = [];

    await expect(
      createSearchPlaces({ search }).execute(
        'Oni',
        initialBounds,
        new AbortController().signal,
        (update) => progress.push(update),
      ),
    ).resolves.toEqual([nearbyResult, distantResult]);

    expect(search.mock.calls.length).toBeGreaterThan(2);
    expect(progress[0]).toMatchObject({ status: 'expanding', attempt: 2 });
    expect(progress[0]?.results).toEqual([nearbyResult]);
    expect(progress.at(-1)).toEqual({
      status: 'completed',
      attempt: search.mock.calls.length,
      results: [nearbyResult, distantResult],
    });
  });

  it('stops after searching a maximum 500 km radius', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const progress: PlaceSearchProgress[] = [];

    await expect(
      createSearchPlaces({ search }).execute(
        'missing',
        initialBounds,
        new AbortController().signal,
        (update) => progress.push(update),
      ),
    ).resolves.toEqual([]);

    expect(search.mock.calls.length).toBeGreaterThan(1);
    expect(search.mock.calls.length).toBeLessThanOrEqual(32);
    const finalProgress = progress.at(-1);
    expect(finalProgress).toMatchObject({ status: 'exhausted' });
    if (finalProgress?.status === 'exhausted') {
      expect(finalProgress.largerSideKm).toBeCloseTo(1_000, 0);
    }
  });

  it('does not contact the provider for a query shorter than two characters', async () => {
    const search = vi.fn();

    await expect(
      createSearchPlaces({ search }).execute(
        ' a ',
        initialBounds,
        new AbortController().signal,
      ),
    ).resolves.toEqual([]);

    expect(search).not.toHaveBeenCalled();
  });

  it('logs and rethrows cancellation without classifying it as provider failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const cancellation = new Error('cancelled');
    const search = vi.fn().mockRejectedValue(cancellation);
    const log = vi.fn();

    await expect(
      createSearchPlaces({ search }, { log, getEvents: () => [] }).execute(
        'Tbilisi',
        initialBounds,
        controller.signal,
      ),
    ).rejects.toBe(cancellation);

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'place-search.cancelled' }),
    );
    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'place-search.failed' }),
    );
  });

  it('recognizes an AbortError even before its signal is marked aborted', async () => {
    const cancellation = new DOMException('cancelled', 'AbortError');
    const search = vi.fn().mockRejectedValue(cancellation);
    const log = vi.fn();

    await expect(
      createSearchPlaces({ search }, { log, getEvents: () => [] }).execute(
        'Tbilisi',
        initialBounds,
        new AbortController().signal,
      ),
    ).rejects.toBe(cancellation);

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'place-search.cancelled' }),
    );
  });

  it('logs and rethrows provider failures with privacy-safe fields', async () => {
    const failure = new Error('provider failed');
    const search = vi.fn().mockRejectedValue(failure);
    const log = vi.fn();

    await expect(
      createSearchPlaces({ search }, { log, getEvents: () => [] }).execute(
        'private query',
        initialBounds,
        new AbortController().signal,
      ),
    ).rejects.toBe(failure);

    expect(log).toHaveBeenCalledWith({
      level: 'warn',
      name: 'place-search.failed',
      data: { operationId: 'place-search-operation', status: 'provider-error' },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private query');
  });

  it('keeps an extremely small viewport within the defensive attempt ceiling', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const tinyBounds = {
      west: 44.8,
      south: 41.7,
      east: 44.800_000_1,
      north: 41.700_000_1,
    };

    await createSearchPlaces({ search }).execute(
      'Tbilisi',
      tinyBounds,
      new AbortController().signal,
    );

    expect(search.mock.calls.length).toBeGreaterThan(1);
    expect(search.mock.calls.length).toBeLessThanOrEqual(32);
  });
});
