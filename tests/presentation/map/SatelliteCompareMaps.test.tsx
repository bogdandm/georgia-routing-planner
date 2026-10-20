import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StyleSpecification } from 'maplibre-gl';
import { useEffect, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import { activateAppLocale } from '@/presentation/localization/appI18n';
import { mapLayerIds } from '@/presentation/map/mapIds';
import { resetMapLayerStore } from '@/presentation/map/mapLayerStore';
import { SatelliteCompareMaps } from '@/presentation/map/SatelliteCompareMaps';
import {
  openSharedComparison,
  resetSatelliteCompareStore,
  satelliteCompareStore,
} from '@/presentation/satellite-browser/satelliteCompareStore';
import { createTestServices } from '@test/helpers/createTestServices';
import { renderWithI18n } from '@test/helpers/renderWithI18n';
import { catalogGatewayReturning } from '@test/helpers/workspaceShellTestSupport';

const nativeMaps = vi.hoisted(() => ({ created: 0, removed: 0 }));

vi.mock('react-map-gl/maplibre', () => ({
  default: function MockMap({
    children,
    mapStyle,
    onError,
    ref,
  }: {
    readonly children?: ReactNode;
    readonly mapStyle: StyleSpecification;
    readonly onError?: (event: unknown) => void;
    readonly ref?: (handle: { getMap: () => unknown } | null) => void;
  }) {
    useEffect(() => {
      nativeMaps.created += 1;
      // Just enough of the native map for the pane: sync, rotation lock, and the
      // visible area that anchors its date picker.
      const nativeMap = {
        keyboard: { disableRotation: () => undefined },
        touchZoomRotate: { disableRotation: () => undefined },
        setMissingStyleImageResolver: () => undefined,
        jumpTo: () => undefined,
        getCenter: () => ({ lng: 44.5, lat: 42.5 }),
        getBounds: () => ({
          getWest: () => 44,
          getSouth: () => 42,
          getEast: () => 45,
          getNorth: () => 43,
        }),
      };
      ref?.({ getMap: () => nativeMap });
      return () => {
        ref?.(null);
        nativeMaps.removed += 1;
      };
    }, [ref]);
    const source = mapStyle.sources['sentinel-raster-a'];
    const landcover = mapStyle.layers.find(
      (layer) => layer.id === mapLayerIds.landcover,
    );
    return (
      <div
        data-testid="compare-map"
        data-sentinel-tiles={source?.type === 'raster' ? source.tiles?.join(' ') : ''}
        data-landcover-visibility={landcover?.layout?.visibility ?? 'visible'}
      >
        <button
          type="button"
          onClick={() => {
            onError?.({
              type: 'error',
              sourceId: 'sentinel-raster-a',
              error: { message: 'AJAXError: Too Many Requests', status: 429 },
            });
          }}
        >
          Throttle imagery
        </button>
        {children}
      </div>
    );
  },
  AttributionControl: () => <div data-testid="compare-attribution" />,
}));

function scene(id: string, acquiredAt: string): SatelliteScene {
  return {
    id,
    collection: 'sentinel-2-l2a',
    platform: 'sentinel-2a',
    productLevel: 'L2A',
    acquiredAt,
    cloudCoverPercent: 4.4,
    footprint: {
      type: 'Polygon',
      coordinates: [
        [
          [44, 42],
          [45, 42],
          [45, 43],
          [44, 43],
          [44, 42],
        ],
      ],
    },
    tileId: '38TMN',
    orbit: 'R036',
    productId: `S2A_${id}`,
    thumbnailHref: null,
    visualAsset: {
      kind: 'sentinel-l2a',
      itemHref: `https://earth-search.example.test/items/${id}`,
      visualHref: `https://sentinel.example.test/${id}/TCI.tif`,
      mediaType: 'image/tiff; application=geotiff; profile=cloud-optimized',
      projectionEpsg: 32638,
    },
    attribution: 'Synthetic test data',
  };
}

const scenes = [
  scene('2019', '2019-08-14T07:52:00.000Z'),
  scene('2021', '2021-08-09T07:46:00.000Z'),
  scene('2023', '2023-08-04T07:56:00.000Z'),
  scene('2025', '2025-08-08T07:49:00.000Z'),
];
const camera = { center: { longitude: 44.5, latitude: 42.5 }, zoom: 11 };

beforeEach(() => {
  activateAppLocale('en');
  resetMapLayerStore();
  nativeMaps.created = 0;
  nativeMaps.removed = 0;
  resetSatelliteCompareStore();
});

function renderGrid(services: RuntimeServices, count: number) {
  return (
    <RuntimeServicesProvider services={services}>
      <SatelliteCompareMaps
        scenes={scenes.slice(0, count)}
        initialCamera={camera}
        onCameraSettled={() => undefined}
      />
    </RuntimeServicesProvider>
  );
}

describe('SatelliteCompareMaps', () => {
  it('labels each pane with its local acquisition date, time, and cloud cover', async () => {
    renderWithI18n(renderGrid(createTestServices(), 3));

    const panes = await screen.findAllByRole('region', {
      name: /^Sentinel-2 image from/,
    });
    expect(panes.map((pane) => pane.getAttribute('aria-label'))).toEqual([
      'Sentinel-2 image from Aug 14, 2019',
      'Sentinel-2 image from Aug 9, 2021',
      'Sentinel-2 image from Aug 4, 2023',
    ]);
    const [first] = panes;
    if (first === undefined) throw new Error('Missing first pane.');
    expect(within(first).getByText('2019')).toBeInTheDocument();
    expect(within(first).getByText(/Aug 14/)).toBeInTheDocument();
    expect(within(first).getByText('11:52 GMT+4 · 4% cloud')).toBeInTheDocument();
    expect(screen.getAllByTestId('compare-attribution')).toHaveLength(1);
    expect(
      within(panes[2] ?? first).getByTestId('compare-attribution'),
    ).toBeInTheDocument();
  });

  it('adds and removes panes without recreating the other maps', async () => {
    const services = createTestServices();
    const view = renderWithI18n(renderGrid(services, 2));
    await screen.findAllByTestId('compare-map');
    expect(nativeMaps.created).toBe(2);

    view.rerender(renderGrid(services, 4));
    expect(await screen.findAllByTestId('compare-map')).toHaveLength(4);
    view.rerender(renderGrid(services, 3));

    expect(screen.getAllByTestId('compare-map')).toHaveLength(3);
    expect(nativeMaps).toEqual({ created: 4, removed: 1 });
  });

  it('moves only a throttled pane to direct rendering in automatic mode', async () => {
    const user = userEvent.setup();
    renderWithI18n(renderGrid(createTestServices(), 2));
    const [first, second] = await screen.findAllByTestId('compare-map');
    if (first === undefined || second === undefined) throw new Error('Missing panes.');
    expect(first.dataset.sentinelTiles).not.toMatch(/^test-satellite-cog:/);

    await user.click(within(second).getByRole('button', { name: 'Throttle imagery' }));

    expect(second.dataset.sentinelTiles).toMatch(/^test-satellite-cog:\/\/tiles\//);
    expect(first.dataset.sentinelTiles).not.toMatch(/^test-satellite-cog:/);
  });

  it('hides natural features in every pane while the main map shows them', async () => {
    renderWithI18n(renderGrid(createTestServices(), 2));

    const panes = await screen.findAllByTestId('compare-map');
    expect(panes.map((pane) => pane.dataset.landcoverVisibility)).toEqual([
      'none',
      'none',
    ]);
  });

  it('swaps a pane to the best-coverage scene of a day picked in its calendar', async () => {
    const user = userEvent.setup();
    const [first, second] = scenes;
    if (first === undefined || second === undefined) throw new Error('Missing scenes.');
    const replacement = scene('2019-later', '2019-08-29T07:52:00.000Z');
    openSharedComparison([first, second], camera);
    renderWithI18n(
      renderGrid(
        createTestServices({
          satelliteCatalogGateway: catalogGatewayReturning({
            totalMatched: 2,
            scenes: [first, replacement],
          }),
        }),
        2,
      ),
    );

    await user.click(
      await screen.findByRole('button', { name: 'Change image date, Aug 14, 2019' }),
    );
    expect(await screen.findByText('August 2019')).toBeVisible();
    await user.click(
      await screen.findByRole('gridcell', {
        name: /^Aug 29, 2019, imagery available/u,
      }),
    );

    expect(
      satelliteCompareStore.getState().scenes.map((candidate) => candidate.id),
    ).toEqual(['2019-later', '2021']);
    expect(screen.queryByText('Change image date')).not.toBeInTheDocument();
  });
});
