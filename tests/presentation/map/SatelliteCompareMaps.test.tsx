import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StyleSpecification } from 'maplibre-gl';
import { useEffect, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from 'zustand';

import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import { activateAppLocale } from '@/presentation/localization/appI18n';
import { mapLayerIds, satelliteBasemapLayerIds } from '@/presentation/map/mapIds';
import { resetMapLayerStore } from '@/presentation/map/mapLayerStore';
import { SatelliteCompareMaps } from '@/presentation/map/SatelliteCompareMaps';
import {
  openSharedComparison,
  resetSatelliteCompareStore,
  satelliteCompareStore,
  type ComparisonSlot,
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
      // Just enough of the native map for the pane: sync, rotation lock, tile progress,
      // and the visible area that anchors its date picker.
      const nativeMap = {
        keyboard: { disableRotation: () => undefined },
        touchZoomRotate: { disableRotation: () => undefined },
        setMissingStyleImageResolver: () => undefined,
        on: () => ({ unsubscribe: () => undefined }),
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
    const googleImagery = mapStyle.layers.find(
      (layer) => layer.id === satelliteBasemapLayerIds.imagery,
    );
    return (
      <div
        data-testid="compare-map"
        data-sentinel-tiles={source?.type === 'raster' ? source.tiles?.join(' ') : ''}
        data-landcover-visibility={landcover?.layout?.visibility ?? 'visible'}
        data-google-visibility={googleImagery?.layout?.visibility ?? 'visible'}
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
  AttributionControl: ({
    customAttribution,
  }: {
    readonly customAttribution?: readonly string[];
  }) => (
    <div
      data-testid="compare-attribution"
      data-attributions={customAttribution?.join(' | ') ?? ''}
    />
  ),
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

function renderGrid(
  services: RuntimeServices,
  slots: readonly ComparisonSlot[],
  onDirectFallback: () => void = () => undefined,
) {
  return (
    <RuntimeServicesProvider services={services}>
      <SatelliteCompareMaps
        slots={slots}
        initialCamera={camera}
        onCameraSettled={() => undefined}
        onDirectFallback={onDirectFallback}
      />
    </RuntimeServicesProvider>
  );
}

/** The grid as the shell shows it: driven by the comparison store. */
function StoreGrid() {
  const slots = useStore(satelliteCompareStore, (state) => state.slots);
  return (
    <SatelliteCompareMaps
      slots={slots}
      initialCamera={camera}
      onCameraSettled={() => undefined}
      onDirectFallback={() => undefined}
    />
  );
}

const [scene2019, scene2021, scene2023] = scenes as [
  SatelliteScene,
  SatelliteScene,
  SatelliteScene,
  SatelliteScene,
];

describe('SatelliteCompareMaps', () => {
  it('labels scene panes with their local date, time, and cloud, and plain panes as such', async () => {
    renderWithI18n(
      renderGrid(createTestServices(), [scene2019, scene2021, scene2023, null]),
    );

    const panes = await screen.findAllByRole('region');
    expect(panes.map((pane) => pane.getAttribute('aria-label'))).toEqual([
      'Sentinel-2 image from Aug 14, 2019',
      'Sentinel-2 image from Aug 9, 2021',
      'Sentinel-2 image from Aug 4, 2023',
      'Map without an image',
    ]);
    const [first, , , plain] = panes;
    if (first === undefined || plain === undefined) throw new Error('Missing panes.');
    expect(within(first).getByText('2019')).toBeInTheDocument();
    expect(within(first).getByText(/Aug 14/)).toBeInTheDocument();
    expect(within(first).getByText('11:52 GMT+4 · 4% cloud')).toBeInTheDocument();
    expect(
      within(plain).getByRole('button', { name: 'Pick image date' }),
    ).toBeVisible();
    expect(screen.getAllByTestId('compare-attribution')).toHaveLength(1);
    const attribution = within(plain).getByTestId('compare-attribution');
    // The plain last pane also credits the Sentinel imagery shown by the other panes.
    expect(attribution.dataset.attributions).toMatch(/Sentinel/u);
  });

  it('restyles position-keyed panes instead of recreating their maps', async () => {
    const services = createTestServices();
    const view = renderWithI18n(renderGrid(services, [scene2019, scene2021]));
    const [left] = await screen.findAllByTestId('compare-map');
    const leftTiles = left?.dataset.sentinelTiles;

    view.rerender(renderGrid(services, [scene2021, scene2019]));
    expect(screen.getAllByTestId('compare-map')[0]?.dataset.sentinelTiles).not.toBe(
      leftTiles,
    );
    view.rerender(renderGrid(services, [scene2021, scene2019, null, null]));

    expect(await screen.findAllByTestId('compare-map')).toHaveLength(4);
    expect(nativeMaps).toEqual({ created: 4, removed: 0 });
  });

  it('keeps a throttled scene on direct rendering after it moves to another pane', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    const onDirectFallback = vi.fn();
    const view = renderWithI18n(
      renderGrid(services, [scene2019, scene2021], onDirectFallback),
    );
    const [first, second] = await screen.findAllByTestId('compare-map');
    if (first === undefined || second === undefined) throw new Error('Missing panes.');
    expect(first.dataset.sentinelTiles).not.toMatch(/^test-satellite-cog:/);

    await user.click(within(second).getByRole('button', { name: 'Throttle imagery' }));

    expect(second.dataset.sentinelTiles).toMatch(/^test-satellite-cog:\/\/tiles\//);
    expect(first.dataset.sentinelTiles).not.toMatch(/^test-satellite-cog:/);
    expect(onDirectFallback).toHaveBeenCalledOnce();

    view.rerender(renderGrid(services, [scene2021, scene2019], onDirectFallback));

    const [swappedFirst, swappedSecond] = screen.getAllByTestId('compare-map');
    expect(swappedFirst?.dataset.sentinelTiles).toMatch(
      /^test-satellite-cog:\/\/tiles\//,
    );
    expect(swappedSecond?.dataset.sentinelTiles).not.toMatch(/^test-satellite-cog:/);
  });

  it('hides natural features over imagery but keeps them on plain maps', async () => {
    renderWithI18n(
      renderGrid(createTestServices(), [scene2019, scene2021, null, null]),
    );

    const panes = await screen.findAllByTestId('compare-map');
    expect(panes.map((pane) => pane.dataset.landcoverVisibility)).toEqual([
      'none',
      'none',
      'visible',
      'visible',
    ]);
    expect(panes.map((pane) => pane.dataset.sentinelTiles !== '')).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('shows the best-coverage scene of a day picked in a pane calendar at that position', async () => {
    const user = userEvent.setup();
    const replacement = scene('2019-later', '2019-08-29T07:52:00.000Z');
    openSharedComparison([scene2019, scene2021], camera);
    renderWithI18n(
      <RuntimeServicesProvider
        services={createTestServices({
          satelliteCatalogGateway: catalogGatewayReturning({
            totalMatched: 2,
            scenes: [scene2019, replacement],
          }),
        })}
      >
        <StoreGrid />
      </RuntimeServicesProvider>,
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
      satelliteCompareStore
        .getState()
        .slots.map((candidate) =>
          typeof candidate === 'string' ? candidate : (candidate?.id ?? null),
        ),
    ).toEqual(['2019-later', '2021']);
    expect(
      await screen.findByRole('region', { name: 'Sentinel-2 image from Aug 29, 2019' }),
    ).toBeInTheDocument();
    expect(nativeMaps.created).toBe(2);
  });

  it('reuses loaded months when a pane calendar pages back or opens again', async () => {
    const user = userEvent.setup();
    const search = vi.fn(() =>
      Promise.resolve({ totalMatched: 1, scenes: [scene2019] }),
    );
    openSharedComparison([scene2019, scene2021], camera);
    renderWithI18n(
      <RuntimeServicesProvider
        services={createTestServices({ satelliteCatalogGateway: { search } })}
      >
        <StoreGrid />
      </RuntimeServicesProvider>,
    );
    const openPicker = async () => {
      await user.click(
        await screen.findByRole('button', { name: 'Change image date, Aug 14, 2019' }),
      );
      await screen.findByRole('gridcell', {
        name: /^Aug 14, 2019, imagery available/u,
      });
    };

    await openPicker();
    await user.click(screen.getByRole('button', { name: 'Next acquisition month' }));
    await screen.findByText('September 2019');
    await user.click(
      screen.getByRole('button', { name: 'Previous acquisition month' }),
    );
    await screen.findByRole('gridcell', { name: /^Aug 14, 2019, imagery available/u });
    await user.keyboard('{Escape}');
    await openPicker();

    // August once, September once; the return and the reopen are served from memory.
    expect(search).toHaveBeenCalledTimes(2);
  });
  it('shows static imagery on the pane that picked it and credits it once', async () => {
    renderWithI18n(
      renderGrid(createTestServices(), [scene2019, 'google-satellite', null, null]),
    );

    const panes = await screen.findAllByTestId('compare-map');
    expect(panes.map((pane) => pane.dataset.googleVisibility)).toEqual([
      'none',
      'visible',
      'none',
      'none',
    ]);
    expect(panes.map((pane) => pane.dataset.landcoverVisibility)).toEqual([
      'none',
      'none',
      'visible',
      'visible',
    ]);
    expect(
      screen.getByRole('region', { name: 'Google Satellite' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('compare-attribution').dataset.attributions).toMatch(
      /Google/u,
    );
  });

  it('picks a layer from a pane menu that skips layers shown elsewhere and clears with Vector OSM', async () => {
    const user = userEvent.setup();
    openSharedComparison([scene2019, 'esri-satellite'], camera);
    renderWithI18n(
      <RuntimeServicesProvider services={createTestServices()}>
        <StoreGrid />
      </RuntimeServicesProvider>,
    );
    const openMenu = async () => {
      const [firstPane] = await screen.findAllByRole('region');
      if (firstPane === undefined) throw new Error('Missing pane.');
      await user.click(
        within(firstPane).getByRole('button', { name: 'Choose map layer preset' }),
      );
    };

    await openMenu();
    expect(
      screen.getByRole('menuitemradio', { name: 'Esri World Imagery' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('menuitemradio', { name: 'Soviet Topographic' }));

    expect(satelliteCompareStore.getState().slots).toEqual([
      'soviet-topographic',
      'esri-satellite',
    ]);
    expect(
      await screen.findByRole('region', { name: 'Soviet Topographic' }),
    ).toBeInTheDocument();

    await openMenu();
    await user.click(screen.getByRole('menuitemradio', { name: 'Vector OSM' }));

    expect(satelliteCompareStore.getState().slots).toEqual([null, 'esri-satellite']);
    expect(
      await screen.findByRole('region', { name: 'Map without an image' }),
    ).toBeInTheDocument();
  });

  it('opens every pane calendar on the month any pane calendar showed last', async () => {
    const user = userEvent.setup();
    openSharedComparison([scene2019, scene2021], camera);
    renderWithI18n(
      <RuntimeServicesProvider
        services={createTestServices({
          satelliteCatalogGateway: catalogGatewayReturning({
            totalMatched: 1,
            scenes: [scene2019],
          }),
        })}
      >
        <StoreGrid />
      </RuntimeServicesProvider>,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Change image date, Aug 14, 2019' }),
    );
    await screen.findByText('August 2019');
    await user.click(screen.getByRole('button', { name: 'Next acquisition month' }));
    await screen.findByText('September 2019');
    await user.keyboard('{Escape}');

    await user.click(
      screen.getByRole('button', { name: 'Change image date, Aug 9, 2021' }),
    );
    expect(await screen.findByText('September 2019')).toBeVisible();
  });
});
