import { describe, expect, it, vi } from 'vitest';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import {
  defaultMapProviderConfigurationInput,
  parseMapProviderConfiguration,
} from '@/bootstrap/configuration/MapProviderConfiguration';
import { InlineTerrainComputeBackend } from '@/infrastructure/elevation/InlineTerrainComputeBackend';
import { toTerrainComputeConfiguration } from '@/infrastructure/elevation/TerrainComputeConfiguration';

describe('InlineTerrainComputeBackend', () => {
  it('returns an owned contour buffer on every cache hit', async () => {
    const terrain = parseMapProviderConfiguration(
      defaultMapProviderConfigurationInput,
      'https://example.test/',
    ).terrain;
    const cachedBuffer = new Uint8Array([1, 2, 3]).buffer;
    const engine = {
      loaded: Promise.resolve(),
      fetchTile: vi.fn(),
      fetchContourTile: vi.fn(() => Promise.resolve({ arrayBuffer: cachedBuffer })),
      setFilterEnabled: vi.fn(),
      dispose: vi.fn(),
    };
    const logger: DiagnosticLogger = { log: vi.fn(), getEvents: () => [] };
    const backend = new InlineTerrainComputeBackend(
      toTerrainComputeConfiguration(terrain, 10_000),
      logger,
      {},
      () => engine,
    );

    const first = await backend.fetchContourTile(
      5,
      8,
      9,
      { levels: [50, 200] },
      new AbortController(),
    );
    const delivered = structuredClone(first.arrayBuffer, {
      transfer: [first.arrayBuffer],
    });
    const second = await backend.fetchContourTile(
      5,
      8,
      9,
      { levels: [50, 200] },
      new AbortController(),
    );

    expect(first.arrayBuffer.byteLength).toBe(0);
    expect(Array.from(new Uint8Array(delivered))).toEqual([1, 2, 3]);
    expect(cachedBuffer.byteLength).toBe(3);
    expect(Array.from(new Uint8Array(second.arrayBuffer))).toEqual([1, 2, 3]);
    expect(engine.fetchContourTile).toHaveBeenCalledTimes(2);
  });
});
