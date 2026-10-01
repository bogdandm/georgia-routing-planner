import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ElevationProvider,
  ElevationSample,
} from '@/application/ports/ElevationProvider';
import type { TrackCoordinate } from '@/domain/tracks/gpx';
import { activateAppLocale } from '@/presentation/localization/appI18n';
import { MapMeasurementPanel } from '@/presentation/map/MapMeasurementPanel';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

// Each step is 0.001° of latitude, about 111 m.
const start: TrackCoordinate = [44, 42];
const middle: TrackCoordinate = [44, 42.001];
const end: TrackCoordinate = [44, 42.002];
function elevationProviderFor(elevations: ReadonlyMap<string, ElevationSample>) {
  const sampleMany = vi.fn<ElevationProvider['sampleMany']>((coordinates) =>
    Promise.resolve(
      coordinates.map(
        ({ latitude }) =>
          elevations.get(String(latitude)) ?? { status: 'unavailable' as const },
      ),
    ),
  );
  const provider: ElevationProvider = { sample: vi.fn(), sampleMany };
  return { provider, sampleMany };
}

function panel(
  points: readonly TrackCoordinate[],
  elevationProvider: ElevationProvider,
) {
  return (
    <MapMeasurementPanel
      points={points}
      elevationProvider={elevationProvider}
      onUndo={vi.fn()}
      onClear={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

function readout(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`Missing value for ${label}.`);
  return value;
}

describe('MapMeasurementPanel', () => {
  beforeEach(() => {
    activateAppLocale('en');
  });

  it('reports distance, end-to-end elevation difference, and climbs between points', async () => {
    const { provider, sampleMany } = elevationProviderFor(
      new Map([
        ['42', { status: 'available', meters: 1_000 }],
        ['42.001', { status: 'available', meters: 1_250 }],
        ['42.002', { status: 'available', meters: 1_180.4 }],
      ]),
    );
    const view = renderWithI18n(panel([start, middle, end], provider));

    expect(readout('Distance')).toHaveTextContent('222 m');
    expect(
      await within(readout('Elevation difference')).findByText('+180 m'),
    ).toBeVisible();
    expect(readout('Ascent / descent')).toHaveTextContent('+250 m / -70 m');

    // Undo keeps the already sampled points instead of querying terrain again.
    view.rerender(panel([start, middle], provider));
    expect(readout('Distance')).toHaveTextContent('111 m');
    expect(readout('Elevation difference')).toHaveTextContent('+250 m');
    expect(screen.queryByText('Ascent / descent')).toBeNull();
    expect(sampleMany).toHaveBeenCalledOnce();
  });

  it('keeps the distance when terrain has no value for an endpoint', async () => {
    const { provider } = elevationProviderFor(
      new Map([['42', { status: 'available', meters: 1_000 }]]),
    );
    renderWithI18n(panel([start, middle], provider));

    expect(
      await within(readout('Elevation difference')).findByText('Unavailable'),
    ).toBeVisible();
    expect(readout('Distance')).toHaveTextContent('111 m');
  });
});
