import { ThemeProvider } from '@mui/material';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { ElevationSample } from '@/application/ports/ElevationProvider';
import {
  SatelliteCatalogError,
  type SatelliteCatalogGateway,
  type SatelliteCatalogResult,
} from '@/application/ports/SatelliteCatalogGateway';
import type {
  UserDataService,
  UserDataSnapshot,
} from '@/application/user/UserDataService';
import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@/domain/tracks/localTrack';
import { mapLayerStore, resetMapLayerStore } from '@/presentation/map/mapLayerStore';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import {
  mapInteractionStore,
  resetMapInteractionStore,
  setSatelliteSearchAnchor,
} from '@/presentation/map/mapInteractionStore';
import { resetSatelliteRequestStatus } from '@/presentation/satellite-browser/satelliteRequestStatusStore';
import { OperationalStatus } from '@/presentation/shell/OperationalStatus';
import { useUiStore } from '@/presentation/shell/uiStore';
import { WorkspaceShell } from '@/presentation/shell/WorkspaceShell';
import { appColors } from '@/presentation/theme/appColors';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { FakeMapFacade } from '@test/helpers/FakeMapFacade';
import { createTestServices } from '@test/helpers/createTestServices';
function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolveValue: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
}

let services: RuntimeServices;

function mockViewportWidth(width: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      (query === '(width < 900px)' && width < 900) ||
      (query === '(width < 1900px)' && width < 1900),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

class TestResizeObserver implements ResizeObserver {
  private observedTarget: Element | null = null;

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.observedTarget = target;
    const entry = {
      target,
      contentRect: new DOMRect(0, 0, 420, 264),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    } satisfies ResizeObserverEntry;
    this.callback([entry], this);
  }

  unobserve(target: Element): void {
    if (this.observedTarget === target) {
      this.observedTarget = null;
    }
  }

  disconnect(): void {
    this.observedTarget = null;
  }
}

beforeEach(async () => {
  mockViewportWidth(1920);
  window.history.replaceState(null, '', '/');
  resetMapLayerStore();
  resetMapInteractionStore();
  resetSatelliteRequestStatus();
  services = createTestServices();
  await services.database.delete();
  services = createTestServices();
  useUiStore.setState({
    activeTab: 'satellite',
    developerDrawerOpen: false,
    developerMode: false,
    mapDebugOptions: { showCollisionBoxes: false, showTileBoundaries: false },
    mobileWorkspaceOpen: false,
    navigationCollapsed: false,
    settingsOpen: false,
  });
});

afterEach(async () => {
  services.database.close();
  await services.database.delete();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderWorkspaceShell(
  mapSurface: ReactNode = <div aria-label="Fake map">Local map ready</div>,
) {
  return render(
    <RuntimeServicesProvider services={services}>
      <ThemeProvider theme={createAppTheme()}>
        <WorkspaceShell mapSurface={mapSurface} />
      </ThemeProvider>
    </RuntimeServicesProvider>,
  );
}

function savedTrackSummary(id: string, name: string): LocalTrackSummary {
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    id,
    name,
    normalizedName: name.toLocaleLowerCase('en'),
    savedAt: '2026-07-22T10:00:00.000Z',
    updatedAt: '2026-07-22T10:00:00.000Z',
    contentHash: 'a'.repeat(64),
    sourceFilename: 'fixture.gpx',
    sourceFormat: 'gpx',
    favorite: false,
    geometryKind: 'track',
    pointCount: 2,
    segmentCount: 1,
    metrics: {
      distanceMeters: 1_000,
      distanceAlgorithmVersion: 1,
      startCoordinate: [44, 42],
      endCoordinate: [44.01, 42.01],
      bounds: {
        west: 44,
        south: 42,
        east: 44.01,
        north: 42.01,
        crossesAntimeridian: false,
      },
      center: [44.005, 42.005],
      elevationSource: 'dem-assisted',
      elevationAlgorithmVersion: 3,
    },
    metadata: { version: '1.1', links: [] },
    warnings: [],
  };
}

function savedTrackContent(trackId: string): LocalTrackContent {
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    trackId,
    trackPoints: [
      [
        { coordinate: [44, 42], elevationMeters: 1_000 },
        { coordinate: [44.01, 42.01], elevationMeters: 1_120 },
      ],
    ],
  };
}

const testViewport = {
  bounds: { west: 44.1, south: 42.1, east: 44.9, north: 42.9 },
  center: { longitude: 44.5, latitude: 42.5 },
} as const;

function catalogGatewayReturning(
  result: SatelliteCatalogResult,
): SatelliteCatalogGateway {
  return {
    search: () => Promise.resolve(result),
  };
}

function catalogGatewayFailing(error: SatelliteCatalogError): SatelliteCatalogGateway {
  return {
    search: () => Promise.reject(error),
  };
}

function syntheticSatelliteScene(id: string, acquiredAt: string): SatelliteScene {
  return {
    id,
    collection: 'sentinel-2-l2a',
    platform: 'sentinel-2a',
    productLevel: 'L2A',
    acquiredAt,
    cloudCoverPercent: 4,
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
    visualAsset: { kind: 'unavailable' },
    attribution: 'Synthetic test data',
  };
}

function gpxFile(name = 'Fixture track.gpx'): File {
  const xml = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Fixture trail</name><trkseg><trkpt lat="42" lon="44"><ele>1000</ele></trkpt><trkpt lat="42.01" lon="44.01"><ele>1120</ele></trkpt></trkseg></trk></gpx>`;
  const file = new File([xml], name, { type: 'application/gpx+xml' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(xml) });
  return file;
}

function elevationFreeGpxFile(): File {
  const xml = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Elevation-free trail</name><trkseg><trkpt lat="42" lon="44"/><trkpt lat="42.01" lon="44.01"/></trkseg></trk></gpx>`;
  const file = new File([xml], 'Elevation-free.gpx', {
    type: 'application/gpx+xml',
  });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(xml) });
  return file;
}

function gpxFileWithGradeBands(): File {
  const xml = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Fixture trail</name><trkseg><trkpt lat="42" lon="44"><ele>1000</ele></trkpt><trkpt lat="42.01" lon="44.01"><ele>1120</ele></trkpt><trkpt lat="42.02" lon="44.02"><ele>1000</ele></trkpt><trkpt lat="42.03" lon="44.03"><ele>1120</ele></trkpt></trkseg></trk></gpx>`;
  const file = new File([xml], 'Fixture track.gpx', {
    type: 'application/gpx+xml',
  });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(xml) });
  return file;
}

function flatGpxFile(): File {
  const points = Array.from(
    { length: 16 },
    (_, index) =>
      `<trkpt lat="42" lon="${String(44 + index * 0.001)}"><ele>1000</ele></trkpt>`,
  ).join('');
  const xml = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Flat fixture</name><trkseg>${points}</trkseg></trk></gpx>`;
  const file = new File([xml], 'Flat fixture.gpx', { type: 'application/gpx+xml' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(xml) });
  return file;
}

function gpxFileWithCompanionRoute(): File {
  const xml = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Detailed track</name><trkseg><trkpt lat="42" lon="44"><ele>1000</ele><time>2026-07-13T08:00:00Z</time></trkpt><trkpt lat="42.01" lon="44.01"><ele>1120</ele><time>2026-07-13T08:02:00Z</time></trkpt></trkseg></trk><rte><name>Companion route</name><rtept lat="42" lon="44"/><rtept lat="42.01" lon="44.01"/></rte></gpx>`;
  const file = new File([xml], 'Track and route.gpx', {
    type: 'application/gpx+xml',
  });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(xml) });
  return file;
}

describe('WorkspaceShell', () => {
  it('creates a share link only after the explicit rail action', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      camera: {
        longitude: 44.80123,
        latitude: 41.71234,
        zoom: 12.35,
        bearing: 18,
        pitch: 35,
      },
    });
    renderWorkspaceShell();

    expect(window.location.search).toBe('');
    await user.click(screen.getByRole('button', { name: 'Share map view' }));
    expect(screen.getByRole('dialog', { name: 'Share this map view' })).toBeVisible();
    const link = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: '2D share link',
    });
    expect(link.value).toContain('map=2');
    expect(link.value).toContain('lat=41.71234');
    expect(link.value).toContain('view=2d');
    expect(link.value).not.toContain('bearing=');
    expect(screen.getByRole('button', { name: 'Copy 3D link' })).toBeDisabled();
    expect(window.location.search).toBe('');
    await user.click(screen.getByRole('button', { name: 'Copy 2D link' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('z=12.35'));
    expect(await screen.findByText('2D share link copied')).toBeVisible();
  });

  it('opens public site information from the rail action below Settings', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    const settingsButton = screen.getByRole('button', { name: 'Open settings' });
    const aboutButton = screen.getByRole('button', { name: 'About this site' });
    expect(
      settingsButton.compareDocumentPosition(aboutButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(aboutButton);

    const about = screen.getByRole('dialog', {
      name: 'About Trail Planner',
    });
    expect(about).toBeVisible();
    expect(within(about).getByText('Bogdan Kalashnikov')).toBeVisible();
    expect(
      within(about).getByRole('link', { name: 'GitHub repository' }),
    ).toHaveAttribute('href', 'https://github.com/bogdandm/georgia-routing-planner');
    expect(
      within(about).getByRole('link', { name: 'nominatim.openstreetmap.org' }),
    ).toBeVisible();
    expect(
      within(about).getByText(
        'OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors',
      ),
    ).toBeVisible();
    expect(
      within(about).getByText('Copernicus Sentinel data · Earth Search / Element 84'),
    ).toBeVisible();
    expect(about).not.toHaveTextContent('@');
    expect(about).toHaveStyle({
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    });

    expect(
      within(about).getByRole('button', { name: 'Close site information' }),
    ).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(about).not.toBeInTheDocument();
    await waitFor(() => {
      expect(aboutButton).toHaveFocus();
    });
  });
  it('deduplicates a custom vector attribution that already credits OpenStreetMap', async () => {
    const configuredMapProviders = services.mapProviderConfiguration;
    if (configuredMapProviders.status !== 'valid') {
      throw new Error('Expected configured map providers');
    }
    services = {
      ...services,
      mapProviderConfiguration: {
        status: 'valid',
        value: {
          ...configuredMapProviders.value,
          vector: {
            ...configuredMapProviders.value.vector,
            attribution:
              '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
          },
        },
      },
    };
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'About this site' }));

    const about = screen.getByRole('dialog', {
      name: 'About Trail Planner',
    });
    expect(
      within(about).getByText(
        'OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors',
      ),
    ).toBeVisible();
  });

  it('enables 3D sharing only in terrain mode and uses the selected scene', async () => {
    const user = userEvent.setup();
    const selectedScene = syntheticSatelliteScene(
      'selected-while-rendering',
      '2026-07-20T10:12:00.000Z',
    );
    mapLayerStore.setState({
      selectedScene,
      appliedImagery: {
        status: 'loading',
        sceneKey: 'sentinel-2-l2a:selected-while-rendering',
        previousSceneKey: 'sentinel-2-l2a:previously-rendered',
        stage: 'rendering',
        message: 'Rendering selected scene',
        startedAt: 1,
      },
    });
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      terrainMode: 'terrain',
      camera: {
        longitude: 44.8,
        latitude: 41.7,
        zoom: 12.35,
        bearing: 18.12,
        pitch: 35.56,
      },
    });
    renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Share map view' }));

    const link2d = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: '2D share link',
    });
    const link3d = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: '3D share link',
    });
    const includeSatellite = screen.getByRole('checkbox', {
      name: 'Include selected satellite image',
    });
    expect(
      link3d.compareDocumentPosition(includeSatellite) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(includeSatellite).toBeChecked();
    expect(link2d.value).toContain('scene=sentinel-2-l2a%3Aselected-while-rendering');
    expect(link2d.value).not.toContain('bearing=');
    expect(link3d.value).toContain('bearing=18.12');
    expect(link3d.value).toContain('pitch=35.56');
    expect(screen.getByRole('button', { name: 'Copy 3D link' })).toBeEnabled();

    await user.click(includeSatellite);
    expect(link2d.value).not.toContain('scene=');
    expect(link3d.value).not.toContain('scene=');
  });

  it('shows a shared selected-scene card before the map viewport or raster is ready', async () => {
    window.history.replaceState(null, '', '/#satellite');
    const selectedScene = syntheticSatelliteScene(
      'shared-before-raster',
      '2026-07-20T10:12:00.000Z',
    );
    mapLayerStore.setState({
      selectedScene,
      appliedImagery: {
        status: 'loading',
        sceneKey: 'sentinel-2-l2a:shared-before-raster',
        previousSceneKey: null,
        stage: 'preparing',
        message: 'Preparing the selected scene',
        startedAt: 1,
      },
    });
    useUiStore.setState({ activeTab: 'satellite' });

    renderWorkspaceShell();

    expect(await screen.findByText('Product S2A_shared-before-raster')).toBeVisible();
    expect(screen.getByText(/Applying true-color imagery/)).toBeVisible();
  });

  it('navigates the contextual feature panels without covering the map', async () => {
    const user = userEvent.setup();
    services.mapViewport.update(testViewport);
    renderWorkspaceShell();

    expect(
      screen.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'More satellite actions' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search images' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Settings', level: 3 })).toBeVisible();
    expect(screen.getByLabelText('Fake map')).toHaveTextContent('Local map ready');

    expect(screen.queryByRole('tab', { name: 'Plan' })).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole('tab')
        .map((tab) => tab.getAttribute('aria-label') ?? tab.textContent),
    ).toEqual(['Satellite', 'Tracks', 'Layers', 'Markers']);
    expect(screen.getByRole('button', { name: 'User' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Tracks' })).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(screen.getByRole('tab', { name: 'Markers' })).not.toHaveAttribute(
      'aria-disabled',
    );
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    expect(screen.getByRole('heading', { name: 'Tracks', level: 1 })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Browse track file' })).toBeEnabled();
    expect(screen.getByText('Drop GPX, FIT, or KML here')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Create GPX' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Markers' }));
    expect(await screen.findByRole('heading', { name: 'Markers' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Sort markers. Current: Newest' }),
    ).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Layers' }));
    expect(
      screen.queryByRole('heading', { name: 'Map visibility' }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('complementary', { name: 'Layers tools' })).getAllByRole(
        'separator',
      ),
    ).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Satellites', level: 3 })).toBeVisible();
    expect(
      screen.getByRole('heading', {
        name: 'Copernicus Sentinel-2 via Earth Search',
        level: 4,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', {
        name: 'OpenStreetMap via OpenFreeMap + OSM Shortbread',
      }),
    ).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Natural features' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Restricted areas' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'OSM detail' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Hiking paths' })).toBeChecked();
    expect(screen.getByRole('slider', { name: 'Opacity' })).toHaveValue('100');
    expect(screen.getByRole('slider', { name: 'Opacity' })).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: 'Google satellite imagery' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('checkbox', { name: 'Google satellite imagery' }),
    ).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'NAPR Orthophoto' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'NAPR Orthophoto' })).not.toBeChecked();
    expect(
      screen.getByText(
        'Newest available NAPR orthophoto: 2025, then 2020, then 2016–2017.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Satellite imagery' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Relief shading' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Elevation isolines' })).toBeChecked();
    expect(screen.queryByText(/<a href=/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    expect(window.location.hash).toBe('#satellite');
    expect(
      screen.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Search images' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'L1C' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'L2A' })).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Maximum cloud' })).toHaveValue('50');
    expect(screen.getByLabelText('Sentinel acquisition calendar')).toBeVisible();
    const acquisitionCalendar = screen.getByRole('grid', { name: 'July 2026' });
    expect(within(acquisitionCalendar).getAllByRole('columnheader')).toHaveLength(7);
    expect(within(acquisitionCalendar).getAllByRole('gridcell')).toHaveLength(31);
    expect(
      screen.getByRole('gridcell', { name: '1 Jul 2026, no loaded imagery' }),
    ).toHaveStyle({ height: '40px' });
    const searchAreaSource = screen.getByRole('combobox', {
      name: 'Search area source',
    });
    expect(searchAreaSource).toHaveTextContent('Point');
    expect(searchAreaSource).toHaveTextContent('42.5000, 44.5000');
    const satelliteRender = screen.getByRole('combobox', {
      name: 'Satellite render',
    });
    expect(
      searchAreaSource.compareDocumentPosition(satelliteRender) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(searchAreaSource);
    expect(screen.getByRole('option', { name: 'Point' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'Custom' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Marker' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByTestId('elevation-panel')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Imported tracks will stay in this browser/u),
    ).not.toBeInTheDocument();
  }, 10_000);

  it('opens smartphone tools over the mounted map without persisting navigation state', async () => {
    mockViewportWidth(899);
    const user = userEvent.setup();
    const saveUiPreferences = vi.spyOn(services.database, 'saveUiPreferences');
    const { container } = renderWorkspaceShell();
    const map = screen.getByLabelText('Fake map');
    const openWorkspace = screen.getByRole('button', { name: 'Open workspace' });

    expect(openWorkspace).toHaveAttribute('aria-controls', 'mobile-workspace');
    expect(openWorkspace).toHaveAttribute('aria-expanded', 'false');
    expect(map).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).not.toBeInTheDocument();

    await user.click(openWorkspace);

    expect(openWorkspace).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).toBeVisible();
    expect(
      screen
        .getByRole('button', { name: 'Show map' })
        .querySelector('[data-testid="ChevronLeftOutlinedIcon"]'),
    ).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show map' }));

    expect(screen.getByLabelText('Fake map')).toBe(map);
    expect(useUiStore.getState().navigationCollapsed).toBe(false);
    expect(saveUiPreferences).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    expect(container.querySelector('#mobile-workspace')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('returns smartphone track imports to a collapsible map disclosure', async () => {
    mockViewportWidth(899);
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm');
    const { container } = renderWorkspaceShell();
    const map = screen.getByLabelText('Fake map');

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(getComputedStyle(screen.getByRole('navigation')).borderRadius).toBe('0px');
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    await user.upload(input, gpxFile());

    const disclosure = await screen.findByRole('button', {
      name: 'Expand unsaved track details',
    });
    expect(screen.getByRole('textbox', { name: 'Track name' })).toHaveValue(
      'Fixture trail',
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(within(disclosure).getByLabelText('Distance: 1.4 km')).toBeVisible();
    expect(within(disclosure).getByLabelText('Elevation gain: 120 m')).toBeVisible();
    expect(within(disclosure).getByLabelText('Elevation loss: 0 m')).toBeVisible();
    expect(within(disclosure).getByTestId('compact-elevation-profile')).toBeVisible();
    expect(screen.getByLabelText('Fake map')).toBe(map);
    expect(
      screen.queryByRole('complementary', { name: 'Track details' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'New track' }),
    ).not.toBeInTheDocument();

    await user.click(disclosure);

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    const collapse = within(details).getByRole('button', {
      name: 'Collapse track details',
    });
    const close = within(details).getByRole('button', { name: 'Close track' });
    expect(collapse).toBeVisible();
    expect(close).toBeVisible();

    await user.click(collapse);

    expect(confirm).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('complementary', { name: 'Track details' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand unsaved track details' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Fake map')).toBe(map);

    await user.click(
      screen.getByRole('button', { name: 'Expand unsaved track details' }),
    );
    confirm.mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Close track' }));
    expect(confirm).toHaveBeenCalledWith('Discard this unsaved track?');
    expect(screen.getByRole('complementary', { name: 'Track details' })).toBeVisible();

    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Close track' }));
    expect(
      screen.queryByRole('complementary', { name: 'Track details' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Expand unsaved track details' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Fake map')).toBe(map);
  });

  it('saves a named preview from the smartphone disclosure', async () => {
    mockViewportWidth(899);
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    await user.upload(input, gpxFile());

    const nameInput = await screen.findByRole('textbox', { name: 'Track name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Mobile trail');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => {
      await expect(services.database.listLocalTracks()).resolves.toEqual([
        expect.objectContaining({ name: 'Mobile trail' }),
      ]);
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('textbox', { name: 'Track name' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    });
    const disclosure = screen.getByRole('button', {
      name: 'Expand track details',
    });
    expect(within(disclosure).getByLabelText('Distance: 1.4 km')).toBeVisible();
  });

  it('opens active saved track details from the smartphone track list', async () => {
    const summary = savedTrackSummary('local:mobile-active', 'Mobile active trail');
    await services.database.saveLocalTrack(summary, savedTrackContent(summary.id));
    await services.database.saveLatestOpenedTrackId(summary.id);
    useUiStore.setState({ activeTab: 'tracks' });
    mockViewportWidth(899);
    const user = userEvent.setup();
    const loadLocalTrackContent = vi.spyOn(services.database, 'loadLocalTrackContent');
    renderWorkspaceShell();

    await screen.findByRole(
      'button',
      { name: 'Expand track details' },
      { timeout: 5_000 },
    );
    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    loadLocalTrackContent.mockClear();
    await user.click(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
        name: /^Mobile active trail/u,
      }),
    );

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(details).getByRole('heading', { name: 'Mobile active trail' }),
    ).toBeVisible();
    expect(loadLocalTrackContent).not.toHaveBeenCalled();
  });

  it('shows mobile track preparation in the collapsed disclosure until metrics are ready', async () => {
    mockViewportWidth(899);
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const pending = deferred<readonly ElevationSample[]>();
    vi.spyOn(provider, 'sampleMany').mockImplementation(() => pending.promise);
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Preparing.gpx'));

    const disclosure = await screen.findByRole('button', {
      name: 'Expand unsaved track details',
    });
    const status = within(disclosure).getByRole('status');
    expect(within(status).getByText('Preparing terrain and elevation…')).toBeVisible();
    expect(within(status).getByRole('progressbar')).toBeVisible();

    act(() => {
      pending.resolve([{ status: 'unavailable' }, { status: 'unavailable' }]);
    });

    await waitFor(() => {
      expect(within(disclosure).getByLabelText('Distance: 1.4 km')).toBeVisible();
    });
    expect(within(disclosure).getByLabelText('Elevation gain: 120 m')).toBeVisible();
    expect(within(disclosure).queryByRole('status')).not.toBeInTheDocument();
  });

  it('overlays track details below 1900px and keeps them adjacent at 1900px and 1920px', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockViewportWidth(1899);
    let user = userEvent.setup();
    let rendered = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    let input =
      rendered.container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    await user.upload(input, gpxFile('Overlay track.gpx'));

    const overlayDetails = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(overlayDetails).getByRole('button', { name: 'Back to tracks' }),
    ).toBeVisible();
    expect(screen.getByRole('navigation')).toBeVisible();
    expect(
      screen.queryByRole('complementary', { name: 'Tracks tools' }),
    ).not.toBeInTheDocument();
    await user.click(
      within(overlayDetails).getByRole('button', { name: 'Back to tracks' }),
    );
    expect(confirm).toHaveBeenCalledWith('Discard this unsaved track?');
    expect(screen.getByRole('region', { name: 'Import track file' })).toBeVisible();
    rendered.unmount();

    for (const width of [1900, 1920]) {
      mockViewportWidth(width);
      user = userEvent.setup();
      rendered = renderWorkspaceShell();
      await user.click(screen.getByRole('tab', { name: 'Tracks' }));
      input = rendered.container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input).not.toBeNull();
      if (input === null) return;
      await user.upload(input, gpxFile(`Adjacent ${String(width)}.gpx`));
      const adjacentDetails = await screen.findByRole('complementary', {
        name: 'Track details',
      });
      expect(
        within(adjacentDetails).getByRole('button', { name: 'Close track' }),
      ).toBeVisible();
      expect(screen.getByRole('complementary', { name: 'Tracks tools' })).toBeVisible();
      if (width === 1900) {
        await user.click(
          screen.getByRole('button', {
            name: 'Hide navigation from Trail Planner logo',
          }),
        );
        expect(adjacentDetails).not.toBeVisible();
        expect(
          screen.queryByRole('heading', { name: 'New track' }),
        ).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Show navigation' }));
        expect(adjacentDetails).toBeVisible();
      }
      await user.click(
        within(adjacentDetails).getByRole('button', { name: 'Close track' }),
      );
      rendered.unmount();
    }
  });

  it('overlays imagery results below 1900px and keeps them adjacent at 1900px', async () => {
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: catalogGatewayReturning({
        totalMatched: 1,
        scenes: [
          syntheticSatelliteScene('responsive-scene', '2026-07-12T10:12:00.000Z'),
        ],
      }),
    });
    services.mapViewport.update(testViewport);
    mockViewportWidth(1899);
    let user = userEvent.setup();
    let rendered = renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Search images' }));
    const overlayResults = await screen.findByRole('complementary', {
      name: 'Sentinel imagery results',
    });
    expect(
      within(overlayResults).getByRole('button', {
        name: 'Back to satellite search',
      }),
    ).toBeVisible();
    expect(screen.getByRole('navigation')).toBeVisible();
    expect(
      screen.queryByRole('complementary', { name: 'Satellite imagery tools' }),
    ).not.toBeInTheDocument();
    await user.click(
      within(overlayResults).getByRole('button', {
        name: 'Back to satellite search',
      }),
    );
    expect(screen.getByRole('button', { name: 'Search images' })).toBeVisible();
    rendered.unmount();

    mockViewportWidth(1900);
    user = userEvent.setup();
    rendered = renderWorkspaceShell();
    await user.click(screen.getByRole('button', { name: 'Search images' }));
    const adjacentResults = await screen.findByRole('complementary', {
      name: 'Sentinel imagery results',
    });
    expect(
      within(adjacentResults).getByRole('button', {
        name: 'Close imagery results',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('complementary', { name: 'Satellite imagery tools' }),
    ).toBeVisible();
    await user.click(
      within(adjacentResults).getByRole('button', {
        name: 'Apply 12 Jul 2026 imagery',
      }),
    );
    expect(adjacentResults).toBeVisible();
    expect(
      screen.getByRole('complementary', { name: 'Satellite imagery tools' }),
    ).toBeVisible();
    rendered.unmount();
  });

  it('returns smartphone satellite scene selection to the map', async () => {
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: catalogGatewayReturning({
        totalMatched: 1,
        scenes: [syntheticSatelliteScene('mobile-scene', '2026-07-09T10:12:00.000Z')],
      }),
    });
    services.mapViewport.update(testViewport);
    mockViewportWidth(899);
    const user = userEvent.setup();
    renderWorkspaceShell();
    const map = screen.getByLabelText('Fake map');

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    await user.click(screen.getByRole('button', { name: 'Search images' }));
    await user.click(
      await screen.findByRole('button', { name: 'Apply 9 Jul 2026 imagery' }),
    );

    expect(screen.getByLabelText('Fake map')).toBe(map);
    expect(useUiStore.getState().mobileWorkspaceOpen).toBe(false);
    expect(screen.getByRole('button', { name: 'Open workspace' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(
      screen.queryByRole('complementary', { name: 'Sentinel imagery results' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(
      screen.getByRole('complementary', { name: 'Sentinel imagery results' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Search images' }),
    ).not.toBeInTheDocument();
  });

  it('shows preparation progress and aborts on cancel and unmount', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const signals: AbortSignal[] = [];
    vi.spyOn(provider, 'sampleMany').mockImplementation(
      (_coordinates, signal, onProgress) => {
        signals.push(signal);
        onProgress?.({
          completedTiles: 0,
          totalTiles: 3,
          indices: [],
          samples: [],
        });
        onProgress?.({
          completedTiles: 1,
          totalTiles: 3,
          indices: [0],
          samples: [{ status: 'available', meters: 1_000 }],
        });
        return deferred<readonly ElevationSample[]>().promise;
      },
    );
    const user = userEvent.setup();
    const rendered = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input =
      rendered.container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Cancel.gpx'));
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    expect(
      within(screen.getByRole('complementary', { name: 'Track details' })).getByText(
        'Loading elevation tiles: 1 of 3',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('img', {
        name: 'Elevation profile loading: 1 of 3 tiles',
      }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(signals[0]?.aborted).toBe(true);
    expect(
      screen.queryByRole('heading', { name: 'New track' }),
    ).not.toBeInTheDocument();

    await user.upload(input, gpxFile('Unmount.gpx'));
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    expect(
      within(screen.getByRole('complementary', { name: 'Track details' })).getByText(
        'Preparing terrain and elevation…',
      ),
    ).toBeVisible();
    rendered.unmount();
    expect(signals[1]?.aborted).toBe(true);
  });

  it('keeps the parsed New track panel when terrain preparation fails', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const sampleMany = vi
      .spyOn(provider, 'sampleMany')
      .mockRejectedValueOnce(new Error('Terrain unavailable'))
      .mockImplementation((coordinates) =>
        Promise.resolve(coordinates.map(() => ({ status: 'unavailable' as const }))),
      );
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Terrain failure.gpx'));

    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    expect(await screen.findByText('Terrain unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Terrain failure.gpx · GPX')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Recalculate elevation' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
    expect(sampleMany).toHaveBeenCalledTimes(2);
  });

  it('places calculated elevation below point and segment metadata', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    let demMeters = 400;
    vi.spyOn(provider, 'sampleMany').mockImplementation((coordinates) =>
      Promise.resolve(
        coordinates.map(() => ({ status: 'available' as const, meters: demMeters })),
      ),
    );
    const saveLocalTrack = vi.spyOn(services.database, 'saveLocalTrack');
    const replaceCalculatedTrackElevation = vi.spyOn(
      services.database,
      'replaceCalculatedTrackElevation',
    );
    const trackSaved = vi.spyOn(services.userData, 'trackSaved');
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Dual elevation.gpx'));
    let details = await screen.findByRole('complementary', { name: 'Track details' });
    expect(within(details).getByLabelText('Elevation gain: 120 m')).toBeVisible();
    expect(within(details).getByLabelText('Elevation loss: 0 m')).toBeVisible();
    const pointAndSegmentCount = within(details).getByText('2 points · 1 segment');
    const calculatedGain = within(details).getByLabelText(
      'Elevation gain (calculated): 0 m',
    );
    const calculatedLoss = within(details).getByLabelText(
      'Elevation loss (calculated): 0 m',
    );
    expect(calculatedGain).toBeVisible();
    expect(calculatedLoss).toBeVisible();
    expect(
      pointAndSegmentCount.compareDocumentPosition(calculatedGain) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(calculatedGain.querySelector('svg')).toBeNull();
    expect(calculatedLoss.querySelector('svg')).toBeNull();
    expect(
      within(details).getByRole('img', {
        name: 'Elevation profile from 1000 to 1120 metres',
      }),
    ).toBeVisible();

    await user.click(within(details).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(saveLocalTrack).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(trackSaved).toHaveBeenCalledOnce();
    });
    const savedContent = saveLocalTrack.mock.calls[0]?.[1];
    expect(savedContent?.trackPoints).toEqual([
      [
        { coordinate: [44, 42], elevationMeters: 1_000 },
        { coordinate: [44.01, 42.01], elevationMeters: 1_120 },
      ],
    ]);
    expect(
      savedContent?.calculatedTrackPoints?.[0]?.every(
        (point) => point.elevationMeters === 400,
      ),
    ).toBe(true);
    const savedTrackId = savedContent?.trackId ?? '';
    const sourceContentHash = (await services.database.localTracks.get(savedTrackId))
      ?.contentHash;
    expect(sourceContentHash).toMatch(/^[0-9a-f]{64}$/u);
    trackSaved.mockClear();
    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      },
      { timeout: 5_000 },
    );

    demMeters = 500;
    details = screen.getByRole('complementary', { name: 'Track details' });
    await user.click(
      within(details).getByRole('button', { name: 'Recalculate elevation' }),
    );
    await waitFor(() => {
      expect(replaceCalculatedTrackElevation).toHaveBeenCalledOnce();
    });
    const recalculatedContent =
      await services.database.loadLocalTrackContent(savedTrackId);
    expect(recalculatedContent.trackPoints).toEqual(savedContent?.trackPoints);
    expect(
      recalculatedContent.calculatedTrackPoints?.[0]?.every(
        (point) => point.elevationMeters === 500,
      ),
    ).toBe(true);
    expect((await services.database.localTracks.get(savedTrackId))?.contentHash).toBe(
      sourceContentHash,
    );
    expect(trackSaved).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('img', {
        name: 'Elevation profile from 1000 to 1120 metres',
      }),
    ).toBeVisible();
    details = screen.getByRole('complementary', { name: 'Track details' });

    await user.click(within(details).getByRole('button', { name: 'Close track' }));
    const nextInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(nextInput).not.toBeNull();
    if (nextInput === null) return;
    await user.upload(nextInput, elevationFreeGpxFile());
    details = await screen.findByRole('complementary', { name: 'Track details' });
    expect(
      within(details).queryByLabelText(/^Elevation gain: /u),
    ).not.toBeInTheDocument();
    expect(
      within(details).queryByLabelText(/^Elevation loss: /u),
    ).not.toBeInTheDocument();
    expect(
      within(details).getByLabelText('Elevation gain (calculated): 0 m'),
    ).toBeVisible();
    expect(
      within(details).getByLabelText('Elevation loss (calculated): 0 m'),
    ).toBeVisible();
    expect(
      within(details).getByRole('img', {
        name: 'Elevation profile from 500 to 500 metres',
      }),
    ).toBeVisible();
  });

  it('keeps the newest import when an older preparation completes late', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const pending: {
      readonly count: number;
      readonly resolve: (samples: readonly ElevationSample[]) => void;
    }[] = [];
    vi.spyOn(provider, 'sampleMany').mockImplementation((coordinates) => {
      const pendingResult = deferred<readonly ElevationSample[]>();
      pending.push({ count: coordinates.length, resolve: pendingResult.resolve });
      return pendingResult.promise;
    });
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('First.gpx'));
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    expect(
      within(screen.getByRole('complementary', { name: 'Track details' })).getAllByText(
        'Preparing terrain and elevation…',
      ),
    ).not.toHaveLength(0);
    await user.upload(input, gpxFile('Second.gpx'));
    expect(pending).toHaveLength(2);
    act(() => {
      const latest = pending[1];
      latest?.resolve(
        Array.from({ length: latest.count }, () => ({
          status: 'unavailable' as const,
        })),
      );
    });
    expect(await screen.findByText('Second.gpx · GPX')).toBeVisible();

    act(() => {
      const stale = pending[0];
      stale?.resolve(
        Array.from({ length: stale.count }, () => ({ status: 'unavailable' as const })),
      );
    });
    expect(screen.getByText('Second.gpx · GPX')).toBeVisible();
    expect(screen.queryByText('First.gpx · GPX')).not.toBeInTheDocument();
  });

  it('preserves a manually edited preview name through preparation', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const pending = deferred<readonly ElevationSample[]>();
    vi.spyOn(provider, 'sampleMany').mockImplementation((_coordinates) => {
      return pending.promise;
    });
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Manual name.gpx'));
    const nameInput = await screen.findByRole('textbox', { name: 'Track name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Manual trail');
    pending.resolve(
      Array.from({ length: 3 }, () => ({ status: 'unavailable' as const })),
    );

    await waitFor(() => {
      expect(nameInput).toHaveValue('Manual trail');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
  });

  it('recalculates preview and saved elevation without toggling disclosure', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const pendingRecalculations: {
      readonly count: number;
      readonly resolve: (samples: readonly ElevationSample[]) => void;
    }[] = [];
    let requestCount = 0;
    vi.spyOn(provider, 'sampleMany').mockImplementation(
      (coordinates, _signal, onProgress) => {
        requestCount += 1;
        if (requestCount === 1) {
          return Promise.resolve(
            coordinates.map(() => ({ status: 'unavailable' as const })),
          );
        }
        onProgress?.({
          completedTiles: 0,
          totalTiles: 3,
          indices: [],
          samples: [],
        });
        onProgress?.({
          completedTiles: 1,
          totalTiles: 3,
          indices: [0],
          samples: [{ status: 'available', meters: 1_000 }],
        });
        const pending = deferred<readonly ElevationSample[]>();
        pendingRecalculations.push({
          count: coordinates.length,
          resolve: pending.resolve,
        });
        return pending.promise;
      },
    );
    const saveLocalTrack = vi.spyOn(services.database, 'saveLocalTrack');
    const replaceCalculatedTrackElevation = vi.spyOn(
      services.database,
      'replaceCalculatedTrackElevation',
    );
    const trackMetadataChanged = vi.spyOn(services.userData, 'trackMetadataChanged');
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Recalculate.gpx'));
    const disclosure = await screen.findByRole('button', {
      name: 'Climbs & Descents',
    });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    const previewRecalculate = screen.getByRole('button', {
      name: 'Recalculate elevation',
    });
    await user.click(previewRecalculate);
    expect(previewRecalculate).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(previewRecalculate).toContainElement(
      within(previewRecalculate).getByRole('progressbar'),
    );
    expect(await screen.findByText('Loading elevation tiles: 1 of 3')).toBeVisible();
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    const previewPending = pendingRecalculations[0];
    expect(previewPending).toBeDefined();
    act(() => {
      previewPending?.resolve(
        Array.from({ length: previewPending.count }, () => ({
          status: 'unavailable' as const,
        })),
      );
    });
    await waitFor(() => {
      expect(previewRecalculate).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(saveLocalTrack).toHaveBeenCalledOnce();
    });
    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      },
      { timeout: 5_000 },
    );
    const savedDisclosure = screen.getByRole('button', {
      name: 'Climbs & Descents',
    });
    const savedRecalculate = screen.getByRole('button', {
      name: 'Recalculate elevation',
    });
    expect(savedDisclosure).toHaveAttribute('aria-expanded', 'true');
    await user.click(savedDisclosure);
    expect(savedDisclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(savedDisclosure);
    expect(savedDisclosure).toHaveAttribute('aria-expanded', 'true');

    await user.click(savedRecalculate);
    expect(await screen.findByText('Loading elevation tiles: 1 of 3')).toBeVisible();
    const savedPending = pendingRecalculations[1];
    expect(savedPending).toBeDefined();
    act(() => {
      savedPending?.resolve(
        Array.from({ length: savedPending.count }, () => ({
          status: 'unavailable' as const,
        })),
      );
    });
    await waitFor(() => {
      expect(replaceCalculatedTrackElevation).toHaveBeenCalledOnce();
    });
    expect(trackMetadataChanged).not.toHaveBeenCalled();
    expect(savedDisclosure).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not recalculate a preview while its save is pending', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const sampleMany = vi
      .spyOn(provider, 'sampleMany')
      .mockImplementation((coordinates) =>
        Promise.resolve(coordinates.map(() => ({ status: 'unavailable' as const }))),
      );
    const savePending = deferred<undefined>();
    const saveLocalTrack = vi
      .spyOn(services.database, 'saveLocalTrack')
      .mockImplementation(() => savePending.promise);
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Save race.gpx'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(saveLocalTrack).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole('button', { name: 'Recalculate elevation' }));
    expect(sampleMany).toHaveBeenCalledOnce();

    act(() => {
      savePending.resolve(undefined);
    });
  });

  it('cancels saved-track recalculation before deleting that track', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    let requestCount = 0;
    vi.spyOn(provider, 'sampleMany').mockImplementation((coordinates, signal) => {
      requestCount += 1;
      if (requestCount === 1) {
        return Promise.resolve(
          coordinates.map(() => ({ status: 'unavailable' as const })),
        );
      }
      return new Promise((_, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    });
    const replaceCalculatedTrackElevation = vi.spyOn(
      services.database,
      'replaceCalculatedTrackElevation',
    );
    const deleteLocalTrack = vi.spyOn(services.database, 'deleteLocalTrack');
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Delete race.gpx'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      },
      { timeout: 5_000 },
    );
    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    await user.click(
      within(details).getByRole('button', { name: 'Recalculate elevation' }),
    );
    await waitFor(() => {
      expect(requestCount).toBe(2);
    });

    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete track' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => {
      expect(deleteLocalTrack).toHaveBeenCalledOnce();
    });
    expect(replaceCalculatedTrackElevation).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Elevation could not be recalculated.'),
    ).not.toBeInTheDocument();
  });

  it('publishes whole-track grade colors for flat macro ranges', async () => {
    const mapLayers = services.mapLayers;
    expect(mapLayers).not.toBeNull();
    if (mapLayers === null) return;
    const setImportedTrackHighlight = vi.spyOn(mapLayers, 'setImportedTrackHighlight');
    const { container } = renderWorkspaceShell();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, 420, 264),
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, flatGpxFile());
    await waitFor(() => {
      const highlightedSegments = setImportedTrackHighlight.mock.lastCall?.[0];
      expect(highlightedSegments).toHaveLength(1);
      expect(highlightedSegments?.[0]?.color).toBe(appColors.elevationGrade.flat);
      expect(highlightedSegments?.[0]?.coordinates).toHaveLength(16);
      expect(highlightedSegments?.[0]?.coordinates[0]).toEqual([44, 42]);
      expect(highlightedSegments?.[0]?.coordinates.at(-1)).toEqual([44.015, 42]);
    });
  });

  it('reloads synchronized source elevation without replacing it from DEM', async () => {
    const base = savedTrackSummary('local:synchronized', 'Synchronized trail');
    const summary: LocalTrackSummary = {
      ...base,
      metrics: {
        ...base.metrics,
        minimumElevationMeters: 1_000,
        maximumElevationMeters: 1_120,
        ascentMeters: 120,
        descentMeters: 0,
        elevationSource: 'gpx',
        elevationAlgorithmVersion: 3,
      },
    };
    const sourceContent = savedTrackContent(summary.id);
    await services.database.saveLocalTrack(summary, sourceContent);
    await services.database.saveLatestOpenedTrackId(summary.id);
    useUiStore.setState({ activeTab: 'tracks' });
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const sampleMany = vi.spyOn(provider, 'sampleMany');
    const replaceCalculatedTrackElevation = vi.spyOn(
      services.database,
      'replaceCalculatedTrackElevation',
    );
    const listLocalTracks = vi.spyOn(services.database, 'listLocalTracks');
    let notifyTracksChanged: (() => void) | undefined;
    vi.spyOn(services.userData, 'subscribeTracksChanged').mockImplementation(
      (listener) => {
        notifyTracksChanged = listener;
        return () => undefined;
      },
    );
    renderWorkspaceShell();

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(details).getByRole('img', {
        name: 'Elevation profile from 1000 to 1120 metres',
      }),
    ).toBeVisible();
    await waitFor(() => {
      expect(notifyTracksChanged).toBeDefined();
    });
    const initialListCalls = listLocalTracks.mock.calls.length;
    act(() => {
      notifyTracksChanged?.();
    });
    await waitFor(() => {
      expect(listLocalTracks.mock.calls.length).toBeGreaterThan(initialListCalls);
    });

    await expect(services.database.loadLocalTrackContent(summary.id)).resolves.toEqual(
      sourceContent,
    );
    expect(
      within(
        screen.getByRole('complementary', { name: 'Track details' }),
      ).getByLabelText('Elevation gain: 120 m'),
    ).toBeVisible();
    expect(sampleMany).not.toHaveBeenCalled();
    expect(replaceCalculatedTrackElevation).not.toHaveBeenCalled();
  });

  it('does not restore a closed saved track after remount', async () => {
    const summary = savedTrackSummary('local:closed', 'Closed trail');
    await services.database.saveLocalTrack(summary, savedTrackContent(summary.id));
    await services.database.saveLatestOpenedTrackId(summary.id);
    useUiStore.setState({ activeTab: 'tracks' });
    const user = userEvent.setup();
    const firstRender = renderWorkspaceShell();

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(details).getByRole('heading', { name: 'Closed trail' }),
    ).toBeVisible();
    await user.click(within(details).getByRole('button', { name: 'Close track' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', { name: 'Track details' }),
      ).not.toBeInTheDocument();
    });
    await expect(services.database.loadLatestOpenedTrackId()).resolves.toBeNull();

    firstRender.unmount();
    renderWorkspaceShell();

    const savedTracks = await screen.findByRole('list', { name: 'Saved tracks' });
    expect(
      within(savedTracks).getByRole('button', { name: /^Closed trail/u }),
    ).toBeVisible();
    expect(
      screen.queryByRole('complementary', { name: 'Track details' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a saved track open when its restoration marker cannot be cleared', async () => {
    const summary = savedTrackSummary('local:clear-failure', 'Unclosed trail');
    await services.database.saveLocalTrack(summary, savedTrackContent(summary.id));
    await services.database.saveLatestOpenedTrackId(summary.id);
    useUiStore.setState({ activeTab: 'tracks' });
    const user = userEvent.setup();
    renderWorkspaceShell();

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    expect(
      within(details).getByRole('heading', { name: 'Unclosed trail' }),
    ).toBeVisible();
    const saveLatestOpenedTrackId = vi
      .spyOn(services.database, 'saveLatestOpenedTrackId')
      .mockRejectedValueOnce(new Error('Storage unavailable'));

    await user.click(within(details).getByRole('button', { name: 'Close track' }));

    expect(saveLatestOpenedTrackId).toHaveBeenCalledWith(null);
    expect(screen.getByRole('complementary', { name: 'Track details' })).toBeVisible();
    const tracksTools = await screen.findByRole('complementary', {
      name: 'Tracks tools',
    });
    expect(
      within(tracksTools).getByText('The track could not be closed.'),
    ).toBeVisible();
    await expect(services.database.loadLatestOpenedTrackId()).resolves.toBe(summary.id);
  });

  it('keeps a newer selection when closing the previous saved track is pending', async () => {
    const closingSummary = savedTrackSummary('local:closing', 'Closing trail');
    const replacementSummary = savedTrackSummary(
      'local:replacement',
      'Replacement trail',
    );
    await services.database.saveLocalTrack(
      closingSummary,
      savedTrackContent(closingSummary.id),
    );
    await services.database.saveLocalTrack(
      replacementSummary,
      savedTrackContent(replacementSummary.id),
    );
    await services.database.saveLatestOpenedTrackId(closingSummary.id);
    useUiStore.setState({ activeTab: 'tracks' });
    const user = userEvent.setup();
    renderWorkspaceShell();

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    const clear = deferred<undefined>();
    const saveLatestOpenedTrackId = services.database.saveLatestOpenedTrackId.bind(
      services.database,
    );
    vi.spyOn(services.database, 'saveLatestOpenedTrackId').mockImplementation(
      (trackId) =>
        trackId === null ? clear.promise : saveLatestOpenedTrackId(trackId),
    );
    const loadLocalTrackContent = vi.spyOn(services.database, 'loadLocalTrackContent');

    await user.click(within(details).getByRole('button', { name: 'Close track' }));
    await user.click(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
        name: /^Replacement trail/u,
      }),
    );
    await waitFor(() => {
      expect(loadLocalTrackContent).toHaveBeenCalledWith(replacementSummary.id);
    });

    clear.resolve(undefined);

    await waitFor(() => {
      expect(
        within(details).getByRole('heading', { name: 'Replacement trail' }),
      ).toBeVisible();
    });
    await expect(services.database.loadLatestOpenedTrackId()).resolves.toBe(
      replacementSummary.id,
    );
  });

  it('restores the open marker when a pending replacement selection fails', async () => {
    const closingSummary = savedTrackSummary('local:closing', 'Closing trail');
    const replacementSummary = savedTrackSummary(
      'local:replacement',
      'Replacement trail',
    );
    await services.database.saveLocalTrack(
      closingSummary,
      savedTrackContent(closingSummary.id),
    );
    await services.database.saveLocalTrack(
      replacementSummary,
      savedTrackContent(replacementSummary.id),
    );
    await services.database.saveLatestOpenedTrackId(closingSummary.id);
    useUiStore.setState({ activeTab: 'tracks' });
    const user = userEvent.setup();
    renderWorkspaceShell();

    const details = await screen.findByRole('complementary', {
      name: 'Track details',
    });
    const clear = deferred<undefined>();
    const saveLatestOpenedTrackId = services.database.saveLatestOpenedTrackId.bind(
      services.database,
    );
    vi.spyOn(services.database, 'saveLatestOpenedTrackId').mockImplementation(
      (trackId) =>
        trackId === null ? clear.promise : saveLatestOpenedTrackId(trackId),
    );
    vi.spyOn(services.database, 'loadLocalTrackContent').mockRejectedValueOnce(
      new Error('Replacement unavailable'),
    );

    await user.click(within(details).getByRole('button', { name: 'Close track' }));
    await user.click(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
        name: /^Replacement trail/u,
      }),
    );
    expect(await screen.findByText('Replacement unavailable')).toBeVisible();

    clear.resolve(undefined);

    await waitFor(async () => {
      await expect(services.database.loadLatestOpenedTrackId()).resolves.toBe(
        closingSummary.id,
      );
    });
    expect(
      within(details).getByRole('heading', { name: 'Closing trail' }),
    ).toBeVisible();
  });

  it('restores the last opened track without overriding the restored camera', async () => {
    const summary = savedTrackSummary('local:restored', 'Restored trail');
    await services.database.saveLocalTrack(summary, savedTrackContent(summary.id));
    await services.database.saveLatestOpenedTrackId(summary.id);
    await services.mapCameraRepository.save({
      longitude: 45.2,
      latitude: 42.4,
      zoom: 10,
      bearing: 0,
      pitch: 0,
    });
    const mapLayers = services.mapLayers;
    expect(mapLayers).not.toBeNull();
    if (mapLayers === null) return;
    const setImportedTrackGeometry = vi.spyOn(mapLayers, 'setImportedTrackGeometry');
    const fakeFacade = new FakeMapFacade();
    const user = userEvent.setup();
    useUiStore.setState({ activeTab: 'tracks' });

    const expectedFitBoundsRequest = {
      bounds: { west: 44, south: 42, east: 44.01, north: 42.01 },
      maxZoom: 15,
      padding: undefined,
    };
    renderWorkspaceShell(
      <MapWorkspace
        facade={fakeFacade}
        mapCanvas={(initialCamera) => (
          <div>
            Restored camera {initialCamera.longitude}/{initialCamera.latitude}/
            {initialCamera.zoom}
          </div>
        )}
      />,
    );

    expect(await screen.findByText('Restored camera 45.2/42.4/10')).toBeVisible();
    expect(
      await screen.findByRole('heading', { name: 'Restored trail' }),
    ).toBeVisible();
    await waitFor(() => {
      expect(setImportedTrackGeometry).toHaveBeenCalled();
    });
    expect(mapInteractionStore.getState().fitBoundsCommand).toBeNull();

    act(() => {
      fakeFacade.setSnapshot({ lifecycle: 'ready' });
    });

    await waitFor(() => {
      expect(mapInteractionStore.getState().fitBoundsCommand).toBeNull();
      expect(fakeFacade.fitBoundsRequests).toEqual([]);
    });

    await user.click(screen.getByRole('button', { name: /^Restored trail/u }));
    expect(fakeFacade.fitBoundsRequests).toEqual([]);

    fakeFacade.fitBoundsRequests.splice(0);
    await user.click(screen.getByRole('button', { name: 'Close track' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', { name: 'Track details' }),
      ).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /^Restored trail/u }));

    await waitFor(() => {
      expect(fakeFacade.fitBoundsRequests).toEqual([expectedFitBoundsRequest]);
    });
  });

  it('imports, saves, closes, reopens, renames, and deletes a local GPX track', async () => {
    const user = userEvent.setup();
    const trackSaved = vi.spyOn(services.userData, 'trackSaved');
    const trackMetadataChanged = vi.spyOn(services.userData, 'trackMetadataChanged');
    const trackDeleted = vi.spyOn(services.userData, 'trackDeleted');
    const mapLayers = services.mapLayers;
    expect(mapLayers).not.toBeNull();
    if (mapLayers === null) return;
    const setImportedTrackHighlight = vi.spyOn(mapLayers, 'setImportedTrackHighlight');
    vi.spyOn(services.database, 'loadLocalTrackContent').mockResolvedValue({
      schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
      trackId: 'local:test-1',
      trackPoints: [
        [
          { coordinate: [44, 42], elevationMeters: 1_000 },
          { coordinate: [44.005, 42.005], elevationMeters: 1_010 },
          { coordinate: [44.008, 42.008] },
          { coordinate: [44.01, 42.01], elevationMeters: 1_110 },
          { coordinate: [44.02, 42.02], elevationMeters: 1_120 },
        ],
      ],
    });
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, 420, 264),
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFileWithGradeBands());
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    const trackNameInput = screen.getByRole('textbox', { name: 'Track name' });
    expect(trackNameInput).toHaveValue('Fixture trail');
    expect(screen.getByText('Fixture track.gpx · GPX')).toBeVisible();
    expect(screen.queryByText('Recorded time')).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    let details = screen.getByRole('complementary', { name: 'Track details' });
    const elevationProfile = within(details).getByRole('img', {
      name: 'Elevation profile from 1000 to 1120 metres',
    });
    expect(elevationProfile).toBeVisible();
    await waitFor(() => {
      const highlightedSegments = setImportedTrackHighlight.mock.lastCall?.[0];
      expect(highlightedSegments).not.toBeNull();
      expect(highlightedSegments?.length).toBeGreaterThan(0);
      expect(
        new Set(highlightedSegments?.map((segment) => segment.color)).size,
      ).toBeGreaterThan(1);
    });
    const highlightedSegments = setImportedTrackHighlight.mock.lastCall?.[0];
    if (highlightedSegments === undefined || highlightedSegments === null) {
      throw new Error(
        'Expected the prepared elevation profile to publish grade bands.',
      );
    }
    const highlightCallCount = setImportedTrackHighlight.mock.calls.length;
    const elevationDisclosure = within(details).getByRole('button', {
      name: 'Climbs & Descents',
    });
    expect(elevationDisclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(elevationDisclosure);
    const climb = within(details).getByRole('button', { name: /^Climb 1/u });
    await user.click(climb);
    expect(climb).toHaveAttribute('aria-pressed', 'true');
    expect(setImportedTrackHighlight).toHaveBeenCalledTimes(highlightCallCount);
    expect(setImportedTrackHighlight.mock.lastCall?.[0]).toEqual(highlightedSegments);
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    expect(setImportedTrackHighlight.mock.lastCall?.[0]).toEqual(highlightedSegments);
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    details = screen.getByRole('complementary', { name: 'Track details' });
    const elevationGain = within(details).getByLabelText(
      /^Elevation gain: (?:23[5-9]|24[0-5]) m$/u,
    );
    expect(elevationGain).toBeVisible();
    const elevationGainIcon = elevationGain.querySelector('svg');
    expect(elevationGainIcon).not.toBeNull();
    if (elevationGainIcon !== null) {
      await user.hover(elevationGainIcon);
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Elevation gain');
      await user.unhover(elevationGainIcon);
    }
    expect(
      within(details).queryByLabelText(/^Average speed:/u),
    ).not.toBeInTheDocument();
    expect(within(details).getByText(/\d+ points · 1 segment/u)).toBeVisible();
    const discard = screen.getByRole('button', { name: 'Discard' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(
      discard.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const fitBoundsCommand = mapInteractionStore.getState().fitBoundsCommand;
    expect(fitBoundsCommand).toMatchObject({
      bounds: { west: 44, south: 42, east: 44.03, north: 42.03 },
    });
    expect(fitBoundsCommand?.padding).toBeUndefined();
    const leaveEvent = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(leaveEvent)).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(
        within(screen.getByRole('list', { name: 'Saved tracks' })).getByRole('button', {
          name: /^Fixture trail/u,
        }),
      ).toBeVisible();
    });
    await waitFor(() => {
      expect(trackSaved).toHaveBeenCalledOnce();
    });
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Saved tracks' })).getByLabelText(
        /^Elevation gain: (?:23[5-9]|24[0-5]) m$/u,
      ),
    ).toBeVisible();
    expect(
      within(details).getByRole('heading', { name: 'Fixture trail' }),
    ).toBeVisible();
    expect(
      within(details).getByText(/^Saved \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/u),
    ).toBeVisible();
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(
      true,
    );
    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Add to favorites' }),
    ).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: 'Add to favorites' }));
    await waitFor(() => {
      expect(trackMetadataChanged).toHaveBeenCalledOnce();
    });
    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Remove from favorites' }),
    ).toBeVisible();
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('textbox', { name: 'Track name' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Use relief elevation')).not.toBeInTheDocument();
    expect(screen.queryByText('Source file')).not.toBeInTheDocument();
    expect(
      within(details).getByRole('img', {
        name: 'Elevation profile from 1000 to 1120 metres',
      }),
    ).toBeVisible();

    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const nameInput = await screen.findByRole('textbox', { name: 'Track name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Rejected trail');
    vi.spyOn(services.database, 'renameLocalTrack').mockRejectedValueOnce(
      new Error('Rename unavailable'),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm rename' }));
    expect(await screen.findByText('Rename unavailable')).toBeVisible();
    expect(nameInput).toHaveValue('Rejected trail');
    await user.clear(nameInput);
    await user.type(nameInput, 'Final trail');
    await user.keyboard('{Enter}');
    expect(
      await within(details).findByRole('heading', { name: 'Final trail' }),
    ).toBeVisible();
    await waitFor(() => {
      expect(trackMetadataChanged).toHaveBeenCalledTimes(2);
    });

    await user.click(within(details).getByRole('button', { name: 'Track actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete track' }));
    const detailConfirm = screen.getByRole('button', { name: 'Confirm delete' });
    expect(detailConfirm).toBeVisible();
    if (detailConfirm.parentElement !== null) {
      fireEvent.mouseLeave(detailConfirm.parentElement);
    }
    expect(
      within(details).getByRole('button', { name: 'Track actions' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Close track' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', { name: 'Track details' }),
      ).not.toBeInTheDocument();
    });
    const savedTracks = screen.getByRole('list', { name: 'Saved tracks' });
    const deleteTrack = within(savedTracks).getByRole('button', {
      name: 'Delete Final trail',
    });
    const savedRow = deleteTrack.closest('li');
    expect(savedRow).not.toBeNull();
    if (savedRow !== null) await user.hover(savedRow);
    const deleteLocalTrack = vi.spyOn(services.database, 'deleteLocalTrack');
    fireEvent.click(deleteTrack);
    expect(deleteLocalTrack).not.toHaveBeenCalled();
    expect(
      within(savedTracks).getByRole('button', {
        name: 'Confirm deletion of Final trail',
      }),
    ).toBeVisible();

    if (savedRow !== null) fireEvent.mouseLeave(savedRow);
    expect(
      within(savedTracks).getByRole('button', { name: 'Delete Final trail' }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(savedTracks).getByRole('button', { name: 'Delete Final trail' }),
    );
    fireEvent.keyDown(
      within(savedTracks).getByRole('button', {
        name: 'Confirm deletion of Final trail',
      }),
      { key: 'Escape' },
    );
    expect(
      within(savedTracks).getByRole('button', { name: 'Delete Final trail' }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(savedTracks).getByRole('button', { name: 'Delete Final trail' }),
    );
    fireEvent.click(document.body);
    expect(
      within(savedTracks).getByRole('button', { name: 'Delete Final trail' }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(savedTracks).getByRole('button', { name: 'Delete Final trail' }),
    );
    fireEvent.click(
      within(savedTracks).getByRole('button', {
        name: 'Confirm deletion of Final trail',
      }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole('list', { name: 'Saved tracks' }),
      ).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(trackDeleted).toHaveBeenCalledOnce();
    });
  }, 30_000);

  it('explains GPX validation warnings with their parser code and message', async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFileWithCompanionRoute());

    expect(await screen.findByText('track-preferred-over-route')).toBeVisible();
    expect(
      screen.getByText(
        /Detailed track geometry was used instead of companion route geometry\./u,
      ),
    ).toBeVisible();
    expect(screen.getByText('Track and route.gpx · GPX')).toBeVisible();
    expect(screen.getByLabelText(/^Average speed:/u)).toBeVisible();
  }, 10_000);

  it('keeps import errors inside the drop zone and dismisses them', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWorkspaceShell();
      fireEvent.click(screen.getByRole('tab', { name: 'Tracks' }));
      const input = container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input).not.toBeNull();
      if (input === null) return;

      fireEvent.change(input, {
        target: { files: [new File(['not gpx'], 'notes.txt')] },
      });

      const importZone = screen.getByRole('region', { name: 'Import track file' });
      expect(within(importZone).getByRole('alert')).toHaveTextContent(
        'Choose a file with a .gpx, .fit, or .kml extension.',
      );
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(within(importZone).queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('shows the track drop target over another tab and opens the imported track', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = renderWorkspaceShell();
    const workspace = container.firstElementChild;
    expect(workspace).not.toBeNull();
    if (workspace === null) return;
    const file = gpxFile('Dropped.gpx');

    fireEvent.dragEnter(workspace, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    const dropTarget = screen.getByRole('region', { name: 'Drop track file' });
    expect(dropTarget).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Satellite imagery', level: 1 }),
    ).toBeVisible();
    expect(screen.getByLabelText('Fake map')).toBeVisible();

    fireEvent.drop(dropTarget, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(screen.getByRole('heading', { name: 'Tracks', level: 1 })).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Close track' }));
    expect(confirm).toHaveBeenCalledWith('Discard this unsaved track?');
  });

  it('shows the track drop target while navigation is collapsed and expands for the imported track', async () => {
    useUiStore.setState({ navigationCollapsed: true });
    const { container } = renderWorkspaceShell();
    const workspace = container.firstElementChild;
    expect(workspace).not.toBeNull();
    if (workspace === null) return;
    const file = gpxFile('Collapsed.gpx');

    fireEvent.dragEnter(workspace, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    const dropTarget = screen.getByRole('region', { name: 'Drop track file' });
    expect(dropTarget).toBeVisible();

    fireEvent.drop(dropTarget, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(screen.getByRole('heading', { name: 'Tracks', level: 1 })).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'New track' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeVisible();
  });

  it('ignores a file drop outside the track drop target', () => {
    useUiStore.setState({ navigationCollapsed: true });
    const { container } = renderWorkspaceShell();
    const workspace = container.firstElementChild;
    expect(workspace).not.toBeNull();
    if (workspace === null) return;
    const file = gpxFile('Outside.gpx');

    fireEvent.dragEnter(workspace, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(screen.getByRole('region', { name: 'Drop track file' })).toBeVisible();

    fireEvent.drop(workspace, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(
      screen.queryByRole('region', { name: 'Drop track file' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'New track' }),
    ).not.toBeInTheDocument();
    expect(useUiStore.getState().activeTab).toBe('satellite');
    expect(useUiStore.getState().navigationCollapsed).toBe(true);
  });

  it('offers calendar navigation tooltips, current-month return, and month-year selection', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    const previousMonth = screen.getByRole('button', {
      name: 'Previous acquisition month',
    });
    const nextMonth = screen.getByRole('button', { name: 'Next acquisition month' });
    const currentMonth = screen.getByRole('button', {
      name: 'Return to current acquisition month',
    });
    expect(currentMonth).toBeDisabled();

    await user.click(previousMonth);
    expect(screen.getByRole('grid', { name: 'June 2026' })).toBeVisible();
    expect(currentMonth).toBeEnabled();

    for (const [control, tooltip] of [
      [previousMonth, 'Previous month'],
      [nextMonth, 'Next month'],
      [currentMonth, 'Return to current month'],
    ] as const) {
      await user.hover(control);
      expect(await screen.findByRole('tooltip', { name: tooltip })).toBeVisible();
      await user.unhover(control);
    }

    await user.click(currentMonth);
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeVisible();

    const monthYearTrigger = screen.getByRole('button', {
      name: 'Choose acquisition month and year, July 2026',
    });
    expect(within(monthYearTrigger).getByTestId('KeyboardArrowDownIcon')).toBeVisible();
    await user.hover(monthYearTrigger);
    expect(
      await screen.findByRole('tooltip', { name: 'Choose month and year' }),
    ).toBeVisible();
    await user.unhover(monthYearTrigger);
    await user.click(monthYearTrigger);

    const acquisitionCalendar = screen.getByLabelText('Sentinel acquisition calendar');
    expect(
      within(acquisitionCalendar).queryByRole('group', {
        name: 'Choose acquisition month and year',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Choose acquisition month and year' }),
    ).toBeVisible();
    const yearSelect = screen.getByRole('combobox', { name: 'Acquisition year' });
    await user.click(yearSelect);
    await user.click(screen.getByRole('option', { name: '2025' }));
    expect(
      screen.getByRole('button', { name: 'Choose Jul 2025', pressed: true }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Choose Dec 2025' }));
    expect(screen.getByRole('grid', { name: 'December 2025' })).toBeVisible();

    await user.click(currentMonth);
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeVisible();

    await user.click(monthYearTrigger);
    expect(
      screen.getByRole('group', { name: 'Choose acquisition month and year' }),
    ).toBeVisible();
    await user.click(previousMonth);
    expect(
      screen.queryByRole('group', { name: 'Choose acquisition month and year' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'June 2026' })).toBeVisible();
  });

  it('keeps a context-menu search custom until the user selects Point', async () => {
    const user = userEvent.setup();
    setSatelliteSearchAnchor({ latitude: 42.1, longitude: 43.4 });
    renderWorkspaceShell();

    const searchAreaSource = screen.getByRole('combobox', {
      name: 'Search area source',
    });
    expect(searchAreaSource).toHaveTextContent('Custom');
    expect(searchAreaSource).toHaveTextContent('42.1000, 43.4000');

    await user.click(searchAreaSource);
    expect(screen.getByRole('option', { name: 'Custom' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('option', { name: 'Marker' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(screen.getByRole('option', { name: 'Point' }));

    expect(searchAreaSource).toHaveTextContent('Point');
  });

  it('resets a context-menu search point when the map viewport moves', async () => {
    services.mapViewport.update(testViewport);
    setSatelliteSearchAnchor({ latitude: 42.1, longitude: 43.4 });
    renderWorkspaceShell();

    const searchAreaSource = screen.getByRole('combobox', {
      name: 'Search area source',
    });
    expect(searchAreaSource).toHaveTextContent('Custom');

    act(() => {
      services.mapViewport.update({
        bounds: { west: 44.3, south: 42.3, east: 45.1, north: 43.1 },
        center: { longitude: 44.7, latitude: 42.7 },
      });
    });

    await waitFor(() => {
      expect(searchAreaSource).toHaveTextContent('Point');
      expect(searchAreaSource).toHaveTextContent('42.7000, 44.7000');
    });
  });

  it('restores the persisted maximum cloud cover after remounting', async () => {
    const user = userEvent.setup();
    const firstRender = renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    const slider = screen.getByRole('slider', { name: 'Maximum cloud' });
    await waitFor(() => {
      expect(slider).toHaveValue('50');
    });
    fireEvent.change(slider, { target: { value: '75' } });
    fireEvent.mouseUp(slider);
    await waitFor(async () => {
      await expect(services.database.loadMaximumCloudCoverPercent()).resolves.toBe(75);
    });

    firstRender.unmount();
    renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await waitFor(() => {
      expect(screen.getByRole('slider', { name: 'Maximum cloud' })).toHaveValue('75');
    });
  });

  it('restores every workspace tab from its URL anchor', async () => {
    window.history.replaceState(null, '', '/#markers');
    renderWorkspaceShell();

    expect(await screen.findByRole('heading', { name: 'Markers' })).toBeVisible();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Layers' }));
    expect(window.location.hash).toBe('#layers');
    expect(
      screen.queryByRole('heading', { name: 'Map visibility' }),
    ).not.toBeInTheDocument();
  });

  it('sends one shared OpenStreetMap opacity command from Layers', async () => {
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    const setOpacity = vi
      .spyOn(mapLayers, 'setOpenStreetMapOpacity')
      .mockReturnValue({ status: 'success' });
    mapLayerStore.setState({
      appliedImagery: {
        status: 'ready',
        sceneKey: 'test-scene-key',
        sceneId: 'test-scene',
        visible: true,
      },
    });
    renderWorkspaceShell();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Layers' }));

    fireEvent.change(screen.getByRole('slider', { name: 'Opacity' }), {
      target: { value: '60' },
    });

    expect(setOpacity).toHaveBeenLastCalledWith(0.6);
  });

  it('sends satellite checkbox changes and reflects mutually exclusive state', async () => {
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    vi.spyOn(mapLayers, 'restorePersistedState').mockResolvedValue(undefined);
    const setVisibility = vi
      .spyOn(mapLayers, 'setLayerVisibility')
      .mockReturnValue({ status: 'success' });
    mapLayerStore.setState({
      appliedImagery: {
        status: 'ready',
        sceneKey: 'test-scene-key',
        sceneId: 'test-scene',
        visible: true,
      },
    });
    renderWorkspaceShell();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Layers' }));

    const google = screen.getByRole('checkbox', { name: 'Google satellite imagery' });
    await user.click(google);
    expect(setVisibility).toHaveBeenCalledWith('google-satellite', true);
    act(() => {
      mapLayerStore.setState({
        visibility: {
          ...mapLayerStore.getState().visibility,
          'google-satellite': true,
          'satellite-imagery': false,
        },
      });
    });
    await waitFor(() => {
      expect(
        screen.getByRole('checkbox', { name: 'Google satellite imagery' }),
      ).toBeChecked();
    });
    expect(
      screen.getByRole('checkbox', { name: 'Satellite imagery' }),
    ).not.toBeChecked();
    expect(screen.getByRole('slider', { name: 'Opacity' })).toBeEnabled();

    await user.click(screen.getByRole('checkbox', { name: 'Satellite imagery' }));
    expect(setVisibility).toHaveBeenCalledWith('satellite-imagery', true);
    act(() => {
      mapLayerStore.setState({
        visibility: {
          ...mapLayerStore.getState().visibility,
          'google-satellite': false,
          'satellite-imagery': true,
        },
      });
    });
    expect(
      screen.getByRole('checkbox', { name: 'Google satellite imagery' }),
    ).not.toBeChecked();
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Satellite imagery' })).toBeChecked();
    });
  });

  it('controls all imported tracks and their elevation gradient through Layers', async () => {
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    const setVisibility = vi
      .spyOn(mapLayers, 'setLayerVisibility')
      .mockReturnValue({ status: 'success' });
    const setOpacity = vi
      .spyOn(mapLayers, 'setImportedTrackOpacity')
      .mockReturnValue({ status: 'success' });
    renderWorkspaceShell();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Layers' }));

    const elevationGradient = screen.getByRole('checkbox', {
      name: 'Elevation gradient',
    });
    expect(elevationGradient).toBeChecked();
    fireEvent.click(elevationGradient);
    expect(setVisibility).toHaveBeenLastCalledWith('track-elevation-gradient', false);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Imported tracks' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Track opacity' }), {
      target: { value: '35' },
    });

    expect(setVisibility).toHaveBeenLastCalledWith('imported-tracks', false);
    expect(setOpacity).toHaveBeenLastCalledWith(0.35);
  });

  it('searches the captured viewport and renders grouped Sentinel scenes', async () => {
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: catalogGatewayReturning({
        totalMatched: 1,
        scenes: [
          {
            id: 'synthetic-scene',
            collection: 'sentinel-2-l2a',
            platform: 'sentinel-2a',
            productLevel: 'L2A',
            acquiredAt: '2026-07-12T10:12:00.000Z',
            cloudCoverPercent: 4,
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
            productId: 'S2A_SYNTHETIC',
            thumbnailHref: null,
            visualAsset: { kind: 'unavailable' },
            attribution: 'Synthetic test data',
          },
        ],
      }),
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(screen.getByRole('button', { name: 'Search images' }));

    expect(
      await screen.findByRole('heading', {
        name: 'Images near 42.5000, 44.5000',
      }),
    ).toBeVisible();
    expect(screen.getByText(/12 Jul 2026 · 14:12 GMT\+4/u)).toBeVisible();
    expect(screen.queryByText('Sentinel-2a')).not.toBeInTheDocument();
    expect(screen.getByText('100% coverage')).toBeVisible();
    expect(screen.queryByLabelText(/Low viewport coverage/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/High cloud cover/u)).not.toBeInTheDocument();
    expect(screen.queryByText('38TMN')).not.toBeInTheDocument();
    expect(screen.queryByText('R036')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Apply imagery' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('gridcell', {
        name: /12 Jul 2026, imagery available/u,
      }),
    );
    expect(screen.getByText('Image failed to apply')).toBeVisible();
    expect(services.sentinelQueryDiagnostics.getSnapshot().status).toBe('success');
    await user.click(screen.getByRole('tab', { name: 'Layers' }));
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    expect(
      screen.getByRole('heading', { name: 'Images near 42.5000, 44.5000' }),
    ).toBeVisible();
    expect(screen.getByText('Image failed to apply')).toBeVisible();
  });

  it('loads preceding months through the same persistent load-more action', async () => {
    const requestedStarts: string[] = [];
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: {
        search: ({ criteria }) => {
          requestedStarts.push(criteria.startDate);
          const isCurrentMonth = criteria.startDate === '2026-07-01';
          return Promise.resolve({
            totalMatched: 1,
            scenes: [
              syntheticSatelliteScene(
                isCurrentMonth ? 'july-scene' : 'june-scene',
                isCurrentMonth
                  ? '2026-07-12T10:12:00.000Z'
                  : '2026-06-18T10:12:00.000Z',
              ),
            ],
          });
        },
      },
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(screen.getByRole('button', { name: 'Search images' }));
    expect(await screen.findByText(/12 Jul 2026 · 14:12 GMT\+4/u)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Load more images' }));

    expect(await screen.findByText(/18 Jun 2026 · 14:12 GMT\+4/u)).toBeVisible();
    expect(requestedStarts).toEqual(['2026-07-01', '2026-06-01']);
    expect(screen.getByRole('button', { name: 'Load more images' })).toBeVisible();
  });

  it('shares and removes a selected applied scene with distinct actions', async () => {
    const restoredScene = syntheticSatelliteScene(
      'restored-scene',
      '2026-06-18T10:12:00.000Z',
    );
    const mapLayers = services.mapLayers;
    if (mapLayers === null) return;
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    services.mapViewport.update(testViewport);
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      camera: {
        longitude: 44.5,
        latitude: 42.5,
        zoom: 10,
        bearing: 0,
        pitch: 0,
      },
    });
    const clearScene = vi.spyOn(mapLayers, 'clearScene').mockImplementation(() => {
      mapLayerStore.setState({
        appliedImagery: { status: 'empty' },
        selectedScene: null,
      });
      return { status: 'success' };
    });
    mapLayerStore.setState({
      selectedScene: restoredScene,
      appliedImagery: {
        status: 'ready',
        sceneKey: 'sentinel-2-l2a:restored-scene',
        sceneId: 'restored-scene',
        visible: true,
      },
    });
    window.history.replaceState(null, '', '/#satellite');

    renderWorkspaceShell();

    expect(await screen.findByText('1 image · 1 acquisition day')).toBeVisible();
    const restoredCard = screen.getByRole('button', {
      name: 'Remove 18 Jun 2026 imagery from map',
    });
    expect(restoredCard).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.queryByRole('button', { name: 'Hide imagery' }),
    ).not.toBeInTheDocument();
    const productMetadata = screen.getByText('Product S2A_restored-scene');
    expect(productMetadata).toHaveStyle({ wordBreak: 'break-all' });

    await user.click(screen.getByRole('button', { name: 'Share link' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('scene=sentinel-2-l2a%3Arestored-scene'),
    );
    expect(await screen.findByText('Scene link copied')).toBeVisible();
    expect(clearScene).not.toHaveBeenCalled();

    await user.click(productMetadata);

    expect(clearScene).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Apply 18 Jun 2026 imagery' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('searches May, loads June and July on navigation, and reuses complete months', async () => {
    const requests: { readonly startDate: string; readonly endDate: string }[] = [];
    const scenesByMonth = new Map([
      ['2026-05', syntheticSatelliteScene('may-scene', '2026-05-14T10:12:00.000Z')],
      ['2026-06', syntheticSatelliteScene('june-scene', '2026-06-18T10:12:00.000Z')],
      ['2026-07', syntheticSatelliteScene('july-scene', '2026-07-12T10:12:00.000Z')],
    ]);
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: {
        search: ({ criteria }) => {
          requests.push({
            startDate: criteria.startDate,
            endDate: criteria.endDate,
          });
          const scene = scenesByMonth.get(criteria.startDate.slice(0, 7));
          return Promise.resolve({
            totalMatched: scene === undefined ? 0 : 1,
            scenes: scene === undefined ? [] : [scene],
          });
        },
      },
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(
      screen.getByRole('button', { name: 'Previous acquisition month' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Previous acquisition month' }),
    );
    expect(screen.getByRole('grid', { name: 'May 2026' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Search images' }));
    expect(await screen.findByText(/14 May 2026.*14:12 GMT\+4/u)).toBeVisible();
    expect(screen.getByRole('grid', { name: 'May 2026' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Next acquisition month' }));
    expect(await screen.findByText(/18 Jun 2026.*14:12 GMT\+4/u)).toBeVisible();
    expect(screen.getByRole('grid', { name: 'June 2026' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Next acquisition month' }));
    expect(await screen.findByText(/12 Jul 2026.*14:12 GMT\+4/u)).toBeVisible();
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeVisible();

    expect(screen.getByText(/14 May 2026.*14:12 GMT\+4/u)).toBeVisible();
    expect(screen.getByText(/18 Jun 2026.*14:12 GMT\+4/u)).toBeVisible();
    expect(requests).toEqual([
      { startDate: '2026-05-01', endDate: '2026-05-31' },
      { startDate: '2026-06-01', endDate: '2026-06-30' },
      { startDate: '2026-07-01', endDate: '2026-07-18' },
    ]);

    await user.click(
      screen.getByRole('button', { name: 'Previous acquisition month' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Previous acquisition month' }),
    );
    expect(screen.getByRole('grid', { name: 'May 2026' })).toBeVisible();
    expect(requests).toHaveLength(3);
  });

  it('keeps calendar navigation responsive and skips superseded month loads', async () => {
    const requestedMonths: string[] = [];
    let resolveJune!: (result: SatelliteCatalogResult) => void;
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: {
        search: ({ criteria }) => {
          const month = criteria.startDate.slice(0, 7);
          requestedMonths.push(month);
          if (month === '2026-06') {
            return new Promise<SatelliteCatalogResult>((resolve) => {
              resolveJune = resolve;
            });
          }
          return Promise.resolve({ totalMatched: 0, scenes: [] });
        },
      },
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(
      screen.getByRole('button', { name: 'Previous acquisition month' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Previous acquisition month' }),
    );
    await user.click(screen.getByRole('button', { name: 'Search images' }));
    await waitFor(() => {
      expect(requestedMonths).toEqual(['2026-05']);
    });

    await user.click(screen.getByRole('button', { name: 'Next acquisition month' }));
    await waitFor(() => {
      expect(requestedMonths).toEqual(['2026-05', '2026-06']);
    });
    expect(screen.getByLabelText('Loading June 2026 imagery')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Next acquisition month' }),
    ).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next acquisition month' }));
    expect(screen.getByRole('grid', { name: 'July 2026' })).toBeVisible();
    resolveJune({ totalMatched: 0, scenes: [] });
    await waitFor(() => {
      expect(requestedMonths).toEqual(['2026-05', '2026-06', '2026-07']);
    });
  });

  it('uses a calendar date as a best-coverage card shortcut without reopening the pane', async () => {
    const lowCoverageScene = syntheticSatelliteScene(
      'later-low-coverage',
      '2026-07-12T11:12:00.000Z',
    );
    const bestCoverageScene = syntheticSatelliteScene(
      'earlier-best-coverage',
      '2026-07-12T10:12:00.000Z',
    );
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: catalogGatewayReturning({
        totalMatched: 2,
        scenes: [
          {
            ...lowCoverageScene,
            attribution: 'Low coverage scene',
            footprint: {
              type: 'Polygon',
              coordinates: [
                [
                  [44.1, 42.1],
                  [44.3, 42.1],
                  [44.3, 42.9],
                  [44.1, 42.9],
                  [44.1, 42.1],
                ],
              ],
            },
          },
          { ...bestCoverageScene, attribution: 'Best coverage scene' },
        ],
      }),
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(screen.getByRole('button', { name: 'Search images' }));
    const dateShortcut = await screen.findByRole('gridcell', {
      name: /12 Jul 2026, imagery available/u,
    });
    await user.click(dateShortcut);
    expect(screen.getByText('Best coverage scene')).toBeVisible();
    expect(screen.queryByText('Low coverage scene')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close imagery results' }));
    await user.click(dateShortcut);
    expect(
      screen.queryByRole('heading', { name: 'Images near 42.5000, 44.5000' }),
    ).not.toBeInTheDocument();
  });

  it('keeps all dates but filters scene cards by cloud cover client-side', async () => {
    const highCloudScene = syntheticSatelliteScene(
      'threshold-scene',
      '2026-07-12T10:12:00.000Z',
    );
    const lowCloudScene = syntheticSatelliteScene(
      'matching-scene',
      '2026-07-09T10:12:00.000Z',
    );
    const search = vi.fn<SatelliteCatalogGateway['search']>(() =>
      Promise.resolve({
        totalMatched: 2,
        scenes: [
          {
            ...highCloudScene,
            cloudCoverPercent: 70,
            footprint: {
              type: 'Polygon',
              coordinates: [
                [
                  [44.1, 42.1],
                  [44.42, 42.1],
                  [44.42, 42.9],
                  [44.1, 42.9],
                  [44.1, 42.1],
                ],
              ],
            },
          },
          { ...lowCloudScene, cloudCoverPercent: 10 },
        ],
      }),
    );
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: { search },
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(screen.getByRole('button', { name: 'Search images' }));

    expect(search).toHaveBeenCalledOnce();
    expect(search.mock.calls[0]?.[0].criteria.maxCloudCoverPercent).toBe(100);
    expect(
      await screen.findByRole('button', { name: 'Apply 9 Jul 2026 imagery' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Apply 12 Jul 2026 imagery' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('gridcell', {
        name: /12 Jul 2026, imagery available, 70 percent weighted cloud, exceeds/u,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('gridcell', {
        name: /9 Jul 2026, imagery available, 10 percent weighted cloud, matches/u,
      }),
    ).toBeVisible();
    await user.click(
      screen.getByRole('gridcell', {
        name: /12 Jul 2026, imagery available, 70 percent weighted cloud, exceeds/u,
      }),
    );
    expect(
      screen.getByRole('button', { name: 'Apply 12 Jul 2026 imagery' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Apply 9 Jul 2026 imagery' }));
    expect(
      screen.queryByRole('button', { name: 'Apply 12 Jul 2026 imagery' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: 'Maximum cloud' }), {
      target: { value: '100' },
    });
    expect(
      screen.getByRole('button', { name: 'Apply 12 Jul 2026 imagery' }),
    ).toBeVisible();
    expect(screen.getByLabelText('High cloud cover: 70%')).toBeVisible();
    expect(screen.getByLabelText(/Low viewport coverage: 40%/u)).toBeVisible();
    expect(
      screen.getByRole('gridcell', {
        name: /12 Jul 2026, imagery available, 70 percent weighted cloud, matches/u,
      }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Search images' }));
    expect(search).toHaveBeenCalledOnce();
  });

  it('shows the safe provider error without removing the search controls', async () => {
    services.database.close();
    await services.database.delete();
    services = createTestServices({
      satelliteCatalogGateway: catalogGatewayFailing(
        new SatelliteCatalogError(
          'provider-rate-limited',
          'Earth Search is rate limiting requests. Wait and try again.',
        ),
      ),
    });
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(screen.getByRole('button', { name: 'Search images' }));

    expect(
      await screen.findAllByText(
        'Earth Search is rate limiting requests. Wait and try again.',
      ),
    ).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Search images' })).toBeEnabled();
  });

  it('persists developer mode and opens the diagnostics drawer', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await user.click(
      screen.getByRole('checkbox', { name: 'Enable developer diagnostics' }),
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));

    const developerButton = await screen.findByRole('button', {
      name: 'Developer diagnostics',
    });
    await user.click(developerButton);
    expect(
      screen.getByRole('heading', { name: 'Developer diagnostics' }),
    ).toBeVisible();
    expect(developerButton).toHaveAttribute('aria-pressed', 'true');

    await user.click(developerButton);
    expect(useUiStore.getState().developerDrawerOpen).toBe(false);
    expect(developerButton).toHaveAttribute('aria-pressed', 'false');

    await waitFor(async () => {
      await expect(services.database.loadUiPreferences()).resolves.toEqual({
        developerMode: true,
        navigationCollapsed: false,
        elevationGradeLegendDismissed: false,
        markerSort: 'created',
      });
    });
  });

  it('keeps the logo fixed and restores from its attached chevron', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();

    const navigation = screen.getByRole('navigation');
    const projectLogo = screen.getByRole('button', {
      name: 'Hide navigation from Trail Planner logo',
    });
    expect(navigation).toHaveStyle({ width: '64px' });
    expect(projectLogo).toHaveStyle({
      width: '52px',
      height: '52px',
      marginTop: '6px',
      marginLeft: '6px',
      flexShrink: '0',
    });
    expect(screen.getByTestId('project-logo-image')).toHaveAttribute(
      'src',
      '/favicon.png',
    );
    expect(screen.getByTestId('project-logo-image')).toHaveStyle({
      width: '52px',
      height: '52px',
    });
    await user.hover(projectLogo);
    expect(await screen.findByRole('tooltip', { name: 'Trail Planner' })).toBeVisible();
    await user.unhover(projectLogo);

    const collapseToggle = screen.getByTestId('navigation-collapse-toggle');
    expect(collapseToggle).toHaveStyle({
      width: '36px',
      height: '64px',
      top: '0px',
      right: '-35px',
      borderLeftWidth: '0px',
      borderBottomWidth: '1px',
      borderRadius: '0 8px 8px 0',
      backgroundColor: appColors.surface.subtle,
    });
    await user.click(projectLogo);

    const showNavigation = screen.getByRole('button', { name: 'Show navigation' });
    const collapsedProjectLogo = screen.getByRole('button', {
      name: 'Show navigation from Trail Planner logo',
    });
    const collapsedLogoImage =
      within(collapsedProjectLogo).getByTestId('project-logo-image');
    expect(navigation).toBeVisible();
    expect(navigation).toHaveStyle({ width: '94px' });
    expect(collapsedLogoImage).toHaveStyle({
      width: '52px',
      height: '52px',
    });
    expect(collapsedProjectLogo).toHaveStyle({
      backgroundColor: appColors.brand.deepSpace,
    });
    expect(showNavigation).not.toBe(collapseToggle);
    expect(showNavigation).toHaveStyle({
      width: '36px',
      height: '52px',
    });
    expect(screen.queryByTestId('compact-elevation-profile')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Distance:/u)).not.toBeInTheDocument();
    await user.hover(collapsedProjectLogo);
    expect(await screen.findByRole('tooltip', { name: 'Trail Planner' })).toBeVisible();
    await user.unhover(collapsedProjectLogo);
    await user.hover(showNavigation);
    expect(
      await screen.findByRole('tooltip', { name: 'Show navigation' }),
    ).toBeVisible();
    expect(screen.getByRole('complementary', { hidden: true })).not.toBeVisible();
    await user.click(showNavigation);
    expect(screen.getByRole('navigation')).toBeVisible();
    expect(screen.getByRole('complementary')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    expect(
      screen.queryByRole('switch', { name: 'Collapse left navigation' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Storage' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Rendering' })).not.toBeInTheDocument();
    expect(
      within(settings).queryByRole('heading', { name: 'Sentinel imagery stretch' }),
    ).not.toBeInTheDocument();
    expect(
      within(settings).queryByRole('combobox', { name: 'Satellite render' }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('.MuiBackdrop-root')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Storage' }));
    expect(await screen.findByText('Local database (IndexedDB)')).toBeVisible();
    expect(screen.getByText('Cache Storage')).toBeVisible();
    expect(screen.getByText('3.00 MB')).toBeVisible();
    expect(screen.getByText('4.00 MB')).toBeVisible();
    expect(screen.getByText('48.00 MB')).toBeVisible();
    expect(screen.getByText(/HTTP and MapLibre tile caches/i)).toBeVisible();
  });

  it.each([900, 1900])(
    'joins the active-track summary into collapsed navigation at %i pixels',
    async (width) => {
      mockViewportWidth(width);
      const user = userEvent.setup();
      const { container } = renderWorkspaceShell();
      await user.click(screen.getByRole('tab', { name: 'Tracks' }));
      const input = container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input).not.toBeNull();
      if (input === null) return;

      await user.upload(input, gpxFile());
      await screen.findByRole('heading', { name: 'New track' });
      await user.click(screen.getByRole('button', { name: 'Hide navigation' }));

      const trackSummary = screen.getByRole('button', { name: 'Open tracks' });
      const showNavigation = screen.getByRole('button', { name: 'Show navigation' });
      const collapsedProjectLogo = screen.getByRole('button', {
        name: 'Show navigation from Trail Planner logo',
      });
      const navigation = screen.getByRole('navigation');
      const compactProfile = within(trackSummary).getByTestId(
        'compact-elevation-profile',
      );
      const logo = within(collapsedProjectLogo).getByTestId('project-logo-image');
      expect(navigation).toHaveStyle({ width: '414px' });
      expect(trackSummary).toHaveStyle({ width: '320px', height: '52px' });
      expect(showNavigation).toHaveStyle({ width: '36px', height: '52px' });
      expect(within(trackSummary).getByLabelText('Distance: 1.4 km')).toBeVisible();
      expect(
        within(trackSummary).getByLabelText('Elevation gain: 120 m'),
      ).toBeVisible();
      expect(within(trackSummary).getByLabelText('Elevation loss: 0 m')).toBeVisible();
      expect(compactProfile).toBeVisible();
      expect(logo).toHaveStyle({ width: '52px', height: '52px' });
      expect(screen.getAllByRole('button', { name: 'Show navigation' })).toHaveLength(
        1,
      );
      const tracksTools = container.querySelector<HTMLElement>(
        'aside[aria-label="Tracks tools"]',
      );
      expect(tracksTools).not.toBeNull();
      expect(tracksTools).not.toBeVisible();

      await user.click(showNavigation);
      await waitFor(() => {
        expect(
          within(navigation).queryByTestId('compact-elevation-profile'),
        ).not.toBeInTheDocument();
      });
      if (width < 1900) {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        await user.click(screen.getByRole('button', { name: 'Back to tracks' }));
      }
      await waitFor(() => {
        expect(tracksTools).toBeVisible();
      });
    },
  );

  it('opens tracks from the collapsed track summary without changing other expand controls', async () => {
    mockViewportWidth(1900);
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile());
    await screen.findByRole('heading', { name: 'New track' });
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(screen.getByRole('button', { name: 'Hide navigation' }));
    await user.click(
      screen.getByRole('button', { name: 'Show navigation from Trail Planner logo' }),
    );
    expect(screen.getByRole('tab', { name: 'Satellite' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Hide navigation' }));
    await user.click(screen.getByRole('button', { name: 'Show navigation' }));
    expect(screen.getByRole('tab', { name: 'Satellite' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Hide navigation' }));
    await user.click(screen.getByRole('button', { name: 'Open tracks' }));
    expect(screen.getByRole('tab', { name: 'Tracks' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('keeps the smartphone disclosure expandable without profile data after failure', async () => {
    mockViewportWidth(899);
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    const sampleMany = vi
      .spyOn(provider, 'sampleMany')
      .mockRejectedValue(new Error('Terrain unavailable'));
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Terrain failure.gpx'));
    const disclosure = await screen.findByRole('button', {
      name: 'Expand unsaved track details',
    });
    await waitFor(() => {
      expect(sampleMany).toHaveBeenCalledOnce();
    });
    expect(
      within(disclosure).queryByTestId('compact-elevation-profile'),
    ).not.toBeInTheDocument();
    expect(within(disclosure).queryByLabelText(/^Distance:/u)).not.toBeInTheDocument();
  });

  it('omits the desktop summary when profile preparation fails', async () => {
    const provider = services.elevationProvider;
    expect(provider).not.toBeNull();
    if (provider === null) return;
    vi.spyOn(provider, 'sampleMany').mockRejectedValue(
      new Error('Terrain unavailable'),
    );
    const user = userEvent.setup();
    const { container } = renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Tracks' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;

    await user.upload(input, gpxFile('Terrain failure.gpx'));
    expect(await screen.findByText('Terrain unavailable')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hide navigation' }));

    const navigation = screen.getByRole('navigation');
    const showNavigation = screen.getByRole('button', { name: 'Show navigation' });
    expect(navigation).toHaveStyle({ width: '94px' });
    expect(showNavigation).toHaveStyle({ width: '36px', height: '52px' });
    expect(
      screen.queryByRole('button', { name: 'Open tracks' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('compact-elevation-profile')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Distance:/u)).not.toBeInTheDocument();
  });

  it('opens the complete current map error from the lightweight status line', async () => {
    const user = userEvent.setup();
    mapLayerStore.setState({
      errorMessage:
        'The imagery renderer rejected these stretch values. Reset the imagery stretch or try less extreme values.',
    });
    render(
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <OperationalStatus />
        </ThemeProvider>
      </RuntimeServicesProvider>,
    );

    const statusButton = await screen.findByRole('button', {
      name: 'Show current error details',
    });
    await user.hover(
      screen.getByLabelText(
        'The imagery renderer rejected these stretch values. Reset the imagery stretch or try less extreme values.',
      ),
    );
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'The imagery renderer rejected these stretch values. Reset the imagery stretch or try less extreme values.',
    );
    expect(screen.getByRole('status')).toHaveStyle({
      backgroundColor: 'rgba(255, 255, 255, 0.42)',
    });
    await user.click(statusButton);

    expect(screen.getByText('Current map error')).toBeVisible();
    expect(
      screen.getAllByText(/renderer rejected these stretch values/i).at(-1),
    ).toBeVisible();
  });

  it('UI-wires accessible terrain overlay settings and persists all choices', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();
    await act(async () => {
      await services.mapLayers?.restorePersistedState();
    });

    await user.click(screen.getByRole('tab', { name: 'Layers' }));

    expect(
      screen.getByRole('heading', { name: 'AWS Open Data Terrain Tiles' }),
    ).toBeVisible();
    const isolines = screen.getByRole('checkbox', { name: 'Elevation isolines' });
    const contourDistance = screen.getByRole('slider', {
      name: 'Isolines distance',
    });
    expect(contourDistance).toHaveAttribute('aria-valuetext', '50 metres');
    expect(
      screen.queryByText(/labeled index contours remain every 200 m/u),
    ).not.toBeInTheDocument();
    const demFilter = screen.getByRole('checkbox', {
      name: 'Repair invalid DEM elevation pixels',
    });
    expect(demFilter).toBeChecked();
    expect(
      isolines.compareDocumentPosition(contourDistance) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      contourDistance.compareDocumentPosition(demFilter) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.change(contourDistance, { target: { value: '1' } });
    await waitFor(() => {
      expect(
        services.mapLayers?.getTerrainOverlayPreferences().contourIntervalMeters,
      ).toBe(25);
    });
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Repair invalid DEM elevation pixels',
      }),
    );
    await waitFor(() => {
      expect(services.mapLayers?.getTerrainOverlayPreferences()).toMatchObject({
        contourIntervalMeters: 25,
        filterInvalidDemPixels: false,
      });
    });
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Show relief shading above satellite imagery',
      }),
    );
    await waitFor(() => {
      expect(services.mapLayers?.getTerrainOverlayPreferences()).toMatchObject({
        contourIntervalMeters: 25,
        shadeAboveSatellite: true,
      });
    });

    expect(services.mapLayers?.getTerrainOverlayPreferences()).toEqual({
      contourIntervalMeters: 25,
      filterInvalidDemPixels: false,
      shadeAboveSatellite: true,
    });
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        terrainOverlays: {
          contourIntervalMeters: 25,
          filterInvalidDemPixels: false,
          shadeAboveSatellite: true,
        },
      });
    });
  });

  it('persists the satellite rendering mode only from Satellite', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));
    const satelliteTools = screen.getByRole('complementary', {
      name: 'Satellite imagery tools',
    });
    const sidebarMode = within(satelliteTools).getByRole('combobox', {
      name: 'Satellite render',
    });
    expect(sidebarMode).toHaveTextContent('Auto');
    act(() => {
      mapLayerStore.setState({
        appliedImagery: {
          status: 'loading',
          sceneKey: 'sentinel-2-l2a:in-flight',
          previousSceneKey: null,
          stage: 'rendering',
          message: 'Rendering in progress',
          startedAt: Date.now(),
        },
      });
    });
    expect(sidebarMode).toBeEnabled();
    await user.click(sidebarMode);
    await user.click(screen.getByRole('option', { name: 'Server' }));
    await waitFor(() => {
      expect(services.mapLayers?.getRenderingMode()).toBe('server');
    });

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    expect(
      within(settings).queryByRole('combobox', { name: 'Satellite render' }),
    ).not.toBeInTheDocument();
    expect(
      within(settings).queryByRole('tab', { name: 'Rendering' }),
    ).not.toBeInTheDocument();
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        satelliteRenderingMode: 'server',
      });
    });
  });

  it('persists Sentinel stretch controls from Satellite', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Satellite' }));

    const stretchDisclosure = screen.getByRole('button', {
      name: 'Sentinel imagery stretch',
    });
    expect(stretchDisclosure).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('slider', { name: 'Sentinel reflectance ceiling' }),
    ).not.toBeInTheDocument();
    await user.click(stretchDisclosure);
    expect(stretchDisclosure).toHaveAttribute('aria-expanded', 'true');
    const ceiling = screen.getByRole('slider', {
      name: 'Sentinel reflectance ceiling',
    });
    expect(ceiling).toBeVisible();
    fireEvent.keyDown(ceiling, { key: 'Home' });
    fireEvent.keyUp(ceiling, { key: 'Home' });
    await waitFor(() => {
      expect(services.mapLayers?.getRenderingTuning().reflectanceMax).toBe(3_000);
    });
    await waitFor(async () => {
      await expect(services.database.loadMapLayerPreferences()).resolves.toMatchObject({
        renderingTuning: { reflectanceMax: 3_000 },
      });
    });

    const saturation = screen.getByRole('slider', { name: 'Sentinel saturation' });
    fireEvent.keyDown(saturation, { key: 'End' });
    fireEvent.keyUp(saturation, { key: 'End' });
    await waitFor(() => {
      expect(services.mapLayers?.getRenderingTuning().saturation).toBe(5);
    });
  });

  it('shows compatibility mode only while terrain compute uses the inline backend', async () => {
    const user = userEvent.setup();
    renderWorkspaceShell();
    await user.click(screen.getByRole('tab', { name: 'Layers' }));

    expect(
      screen.queryByText(/Terrain processing is running/u),
    ).not.toBeInTheDocument();
    act(() => {
      mapLayerStore.setState({ terrainComputeStatus: 'inline' });
    });
    expect(
      screen.getByText(/Terrain processing is running in compatibility mode/u),
    ).toBeVisible();

    act(() => {
      mapLayerStore.setState({ terrainComputeStatus: 'worker' });
    });
    expect(
      screen.queryByText(/Terrain processing is running/u),
    ).not.toBeInTheDocument();
  });

  it('shows the live bounded terrain queue beneath Ready', () => {
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      lifecycle: 'ready',
    });
    render(
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <OperationalStatus />
        </ThemeProvider>
      </RuntimeServicesProvider>,
    );

    expect(screen.getByText('Ready')).toBeVisible();
    expect(
      screen.queryByLabelText('Terrain compute queue state'),
    ).not.toBeInTheDocument();

    act(() => {
      mapLayerStore.setState({
        terrainComputeQueue: {
          executionMode: 'worker',
          activeCount: 1,
          queuedContourCount: 4,
          queueCapacity: 32,
        },
      });
    });
    expect(screen.getByLabelText('Terrain compute queue state')).toHaveTextContent(
      'Terrain worker · queue 4/32 · 1 active',
    );
  });

  it('replaces Ready with a warning after automatic provider fallback', () => {
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      lifecycle: 'ready',
    });
    mapLayerStore.setState({ automaticAlternativeProviderState: 'active' });
    render(
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <OperationalStatus />
        </ThemeProvider>
      </RuntimeServicesProvider>,
    );

    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'TiTiler is unavailable. Direct pre-rendered Sentinel imagery is active.',
    );
  });

  it('prioritizes the provider-switch warning over the transient map error', () => {
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      lifecycle: 'degraded',
      message: 'The satellite imagery renderer is rate-limiting requests.',
    });
    mapLayerStore.setState({ automaticAlternativeProviderState: 'switching' });
    render(
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <OperationalStatus />
        </ThemeProvider>
      </RuntimeServicesProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'TiTiler is unavailable. Switching to direct pre-rendered Sentinel imagery.',
    );
    expect(
      screen.queryByText('The satellite imagery renderer is rate-limiting requests.'),
    ).not.toBeInTheDocument();
  });

  it('announces fatal map failures assertively', () => {
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      lifecycle: 'fatal',
      message: 'The browser lost the WebGL context.',
    });
    render(
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <OperationalStatus />
        </ThemeProvider>
      </RuntimeServicesProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The browser lost the WebGL context.',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('places User before Settings and activates it without an unmatched Tabs value', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useUiStore.setState({ developerMode: true });
    renderWorkspaceShell();

    const userButton = screen.getByRole('button', { name: 'User' });
    const settingsButton = screen.getByRole('button', { name: 'Open settings' });
    expect(
      userButton.compareDocumentPosition(settingsButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const diagnosticsButton = screen.getByRole('button', {
      name: 'Developer diagnostics',
    });
    expect(
      diagnosticsButton.compareDocumentPosition(userButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(userButton);
    expect(userButton).toHaveAttribute('aria-pressed', 'true');

    expect(window.location.hash).toBe('#user');
    expect(screen.getByText(/Account features are not configured/)).toBeVisible();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('The `value` provided to the Tabs component is invalid'),
    );
  });

  it('renders muted default rail controls and white selected controls', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ developerMode: true });
    renderWorkspaceShell();

    const userButton = screen.getByRole('button', { name: 'User' });
    const satelliteTab = screen.getByRole('tab', { name: 'Satellite' });
    const mutedControls = [
      screen.getByRole('tab', { name: 'Tracks' }),
      screen.getByRole('tab', { name: 'Layers' }),
      screen.getByRole('tab', { name: 'Markers' }),
      screen.getByRole('button', { name: 'Share map view' }),
      screen.getByRole('button', { name: 'Developer diagnostics' }),
      userButton,
      screen.getByRole('button', { name: 'Open settings' }),
      screen.getByRole('button', { name: 'About this site' }),
    ];

    for (const control of mutedControls) {
      expect(control).toHaveStyle({ color: appColors.text.inverseMuted });
    }

    expect(satelliteTab).toHaveStyle({
      backgroundColor: appColors.interaction.navigationSelectedBackground,
      color: appColors.text.inverse,
    });

    await user.click(userButton);

    expect(satelliteTab).toHaveStyle({ color: appColors.text.inverseMuted });
    expect(userButton).toHaveAttribute('aria-pressed', 'true');
    expect(userButton).toHaveStyle({
      backgroundColor: appColors.interaction.navigationSelectedBackground,
      color: appColors.text.inverse,
    });
  });

  it('shows error, active, and successful synchronization colors on User', async () => {
    let snapshot: UserDataSnapshot = {
      busy: false,
      email: 'sync@example.test',
      userId: 'user-id',
      errorMessage: 'Synchronization failed.',
      noticeMessage: null,
      status: 'signed-in',
      syncEnabled: true,
      syncStatus: 'error',
      syncProgress: null,
      syncUsage: { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 },
      remoteTrackDeletions: [],
    };
    const listeners = new Set<() => void>();
    const userData = {
      ...services.userData,
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } satisfies UserDataService;
    services = { ...services, userData };
    renderWorkspaceShell();

    const expectIndicator = (label: string, color: string) => {
      const button = screen.getByRole('button', { name: label });
      const indicator = button.querySelector('.MuiBadge-badge');
      expect(indicator).not.toBeNull();
      expect(indicator).toHaveStyle({ backgroundColor: color });
    };
    const setSyncStatus = (syncStatus: UserDataSnapshot['syncStatus']) => {
      act(() => {
        snapshot = { ...snapshot, syncStatus };
        for (const listener of listeners) listener();
      });
    };

    expectIndicator('User synchronization failed', appColors.status.error);
    setSyncStatus('syncing');
    await waitFor(() => {
      expectIndicator('User synchronization in progress', appColors.brand.tigerOrange);
    });
    setSyncStatus('success');
    await waitFor(() => {
      expectIndicator('User synchronization successful', appColors.status.success);
    });
  });

  it('returns to the map before beginning mobile marker placement and cancels on tab change', async () => {
    mockViewportWidth(899);
    services.mapViewport.update(testViewport);
    useUiStore.setState({ activeTab: 'markers', mobileWorkspaceOpen: true });
    renderWorkspaceShell();

    const createMarker = await screen.findByRole('button', { name: 'New marker' });
    await waitFor(() => {
      expect(createMarker).toBeEnabled();
    });
    fireEvent.click(createMarker);
    expect(useUiStore.getState().mobileWorkspaceOpen).toBe(false);
    expect(mapInteractionStore.getState().markerPlacement).not.toBeNull();

    act(() => {
      useUiStore.getState().setActiveTab('satellite');
    });
    await waitFor(() => {
      expect(mapInteractionStore.getState().markerPlacement).toBeNull();
    });
  });
});
