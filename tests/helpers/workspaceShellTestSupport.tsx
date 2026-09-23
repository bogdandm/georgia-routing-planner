/* eslint-disable react-refresh/only-export-components -- Test support deliberately re-exports shared fixture dependencies. */

import { I18nProvider } from '@lingui/react';
import { ThemeProvider } from '@mui/material';
import { render, screen, type RenderResult, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { type ReactNode } from 'react';
import type {
  SatelliteCatalogError,
  SatelliteCatalogGateway,
  SatelliteCatalogResult,
} from '@/application/ports/SatelliteCatalogGateway';
import {
  type UserDataService,
  type UserDataSnapshot,
} from '@/application/user/UserDataService';
import { type TrackShareService } from '@/application/tracks/TrackShareService';
import { type RuntimeServices } from '@/bootstrap/createRuntimeServices';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { type SatelliteScene } from '@/domain/satellite/SatelliteScene';
import {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@/domain/tracks/localTrack';
import { resetMapLayerStore } from '@/presentation/map/mapLayerStore';
import { resetMapInteractionStore } from '@/presentation/map/mapInteractionStore';
import { resetSatelliteRequestStatus } from '@/presentation/satellite-browser/satelliteRequestStatusStore';
import { activateAppLocale, appI18n } from '@/presentation/localization/appI18n';
import { useUiStore } from '@/presentation/shell/uiStore';
import { WorkspaceShell } from '@/presentation/shell/WorkspaceShell';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { createTestServices } from '@test/helpers/createTestServices';

export { strFromU8, unzipSync } from 'fflate';
export { I18nProvider } from '@lingui/react';
export { ThemeProvider } from '@mui/material';
export {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
export { userEvent } from '@testing-library/user-event';
export { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
export type { ReactNode } from 'react';
export type {
  ElevationCoordinate,
  ElevationProvider,
  ElevationSample,
  ElevationSamplingProgressListener,
} from '@/application/ports/ElevationProvider';
export type { TrailRouter, TrailRouteResult } from '@/application/ports/TrailRouter';
export {
  SatelliteCatalogError,
  type SatelliteCatalogGateway,
  type SatelliteCatalogResult,
} from '@/application/ports/SatelliteCatalogGateway';
export type { SatelliteMosaicResult } from '@/application/satellite/SearchSatelliteMosaic';
export type {
  UserDataService,
  UserDataSnapshot,
} from '@/application/user/UserDataService';
export {
  TrackShareError,
  type TrackShareService,
} from '@/application/tracks/TrackShareService';
export type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
export { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
export type { SatelliteScene } from '@/domain/satellite/SatelliteScene';
export { SAVED_MARKER_SCHEMA_VERSION } from '@/domain/markers/savedMarker';
export {
  LOCAL_TRACK_SCHEMA_VERSION,
  type LocalTrackContent,
  type LocalTrackSummary,
} from '@/domain/tracks/localTrack';
export { resolveAppLocale } from '@/domain/localization/appLocale';
export { mapLayerStore, resetMapLayerStore } from '@/presentation/map/mapLayerStore';
export { MapWorkspace } from '@/presentation/map/MapWorkspace';
export {
  completeMarkerPlacement,
  mapInteractionStore,
  resetMapInteractionStore,
  requestWeatherForecast,
  setSatelliteSearchAnchor,
} from '@/presentation/map/mapInteractionStore';
export { resetSatelliteRequestStatus } from '@/presentation/satellite-browser/satelliteRequestStatusStore';
export { activateAppLocale, appI18n } from '@/presentation/localization/appI18n';
export { OperationalStatus } from '@/presentation/shell/OperationalStatus';
export { useUiStore } from '@/presentation/shell/uiStore';
export { WorkspaceShell } from '@/presentation/shell/WorkspaceShell';
export { appColors } from '@/presentation/theme/appColors';
export { createAppTheme } from '@/presentation/theme/createAppTheme';
export { FakeMapFacade } from '@test/helpers/FakeMapFacade';
export { createTestServices } from '@test/helpers/createTestServices';

export interface SavedTrackSummaryOptions {
  readonly savedAt?: string;
  readonly favorite?: boolean;
  readonly center?: LocalTrackSummary['metrics']['center'];
}
export function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolveValue: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
}

export function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('Blob did not produce an ArrayBuffer.'));
        return;
      }
      resolve(new Uint8Array(reader.result));
    });
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('Blob read failed.'));
    });
    reader.readAsArrayBuffer(blob);
  });
}

export function requiredBlob(blob: Blob | null): Blob {
  expect(blob).not.toBeNull();
  if (blob === null) throw new Error('Download did not create a Blob.');
  return blob;
}

export let services: RuntimeServices;

export function setServices(next: RuntimeServices): void {
  services = next;
}

export function mockViewportWidth(width: number) {
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

export class TestResizeObserver implements ResizeObserver {
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

export function setupWorkspaceShellTest(): void {
  beforeEach(async () => {
    mockViewportWidth(1920);
    window.history.replaceState(null, '', '/');
    resetMapLayerStore();
    resetMapInteractionStore();
    resetSatelliteRequestStatus();
    activateAppLocale('en');
    setServices(createTestServices());
    await services.database.delete();
    setServices(createTestServices());
    useUiStore.setState({
      activeTab: 'satellite',
      developerDrawerOpen: false,
      developerMode: false,
      mapDebugOptions: { showCollisionBoxes: false, showTileBoundaries: false },
      mobileWorkspaceOpen: false,
      navigationCollapsed: false,
      settingsOpen: false,
      markerSort: 'created',
      trackSort: 'created',
    });
  });

  afterEach(async () => {
    services.database.close();
    await services.database.delete();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
}

export function renderWorkspaceShell(
  mapSurface: ReactNode = <div aria-label="Fake map">Local map ready</div>,
): RenderResult {
  return render(
    <I18nProvider i18n={appI18n}>
      <RuntimeServicesProvider services={services}>
        <ThemeProvider theme={createAppTheme()}>
          <WorkspaceShell mapSurface={mapSurface} />
        </ThemeProvider>
      </RuntimeServicesProvider>
    </I18nProvider>,
  );
}

export function savedTrackSummary(
  id: string,
  name: string,
  options: SavedTrackSummaryOptions = {},
): LocalTrackSummary {
  const savedAt = options.savedAt ?? '2026-07-22T10:00:00.000Z';
  const favorite = options.favorite ?? false;
  const center = options.center ?? [44.005, 42.005];
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    id,
    name,
    normalizedName: name.toLocaleLowerCase('en'),
    savedAt,
    updatedAt: savedAt,
    contentHash: 'a'.repeat(64),
    sourceFilename: 'fixture.gpx',
    sourceFormat: 'gpx',
    favorite,
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
      center,
      elevationSource: 'dem-assisted',
      elevationAlgorithmVersion: 3,
    },
    metadata: { version: '1.1', links: [] },
    warnings: [],
  };
}

export function savedTrackContent(trackId: string): LocalTrackContent {
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    trackId,
    trackPoints: [
      [
        { coordinate: [44, 42], elevationMeters: 1_000 },
        { coordinate: [44.01, 42.01], elevationMeters: 1_120 },
      ],
    ],
    markers: [],
  };
}

export const trackShareToken = 'A'.repeat(43);

export function createTrackShareService(
  overrides: Partial<TrackShareService> = {},
): TrackShareService {
  return {
    status: vi.fn().mockResolvedValue({ enabled: false }),
    enable: vi.fn().mockResolvedValue({ enabled: true, token: trackShareToken }),
    disable: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn(),
    ...overrides,
  };
}

export function signedInUserData(): UserDataService {
  const snapshot: UserDataSnapshot = {
    busy: false,
    email: 'share@example.test',
    userId: 'share-user',
    errorMessage: null,
    noticeMessage: null,
    status: 'signed-in',
    syncEnabled: true,
    syncStatus: 'success',
    syncProgress: null,
    syncUsage: { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 },
    remoteTrackDeletions: [],
    remoteMarkerDeletions: [],
  };
  return {
    ...services.userData,
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
  };
}

export async function renderSavedTrackForSharing(
  trackShares: TrackShareService,
): Promise<{
  readonly details: HTMLElement;
  readonly summary: LocalTrackSummary;
}> {
  setServices({
    ...services,
    trackShares,
    userData: signedInUserData(),
  });
  const summary = savedTrackSummary('local:share-track', 'Shared trail');
  await services.database.saveLocalTrack(summary, savedTrackContent(summary.id));
  useUiStore.setState({ activeTab: 'tracks' });
  await services.database.saveLatestOpenedTrackId(summary.id);
  renderWorkspaceShell();
  const details = await screen.findByRole('complementary', {
    name: 'Track details',
  });
  return { details, summary };
}
export function multiTrackSummary(
  id: string,
  name: string,
  distanceMeters: number,
  elapsedSeconds: number,
  ascentMeters: number,
  descentMeters: number,
  longitude: number,
): LocalTrackSummary {
  const base = savedTrackSummary(id, name);
  return {
    ...base,
    metrics: {
      ...base.metrics,
      distanceMeters,
      elapsedSeconds,
      ascentMeters,
      descentMeters,
      startCoordinate: [longitude, 42],
      endCoordinate: [longitude + 0.01, 42.01],
      bounds: {
        west: longitude,
        south: 42,
        east: longitude + 0.01,
        north: 42.01,
        crossesAntimeridian: false,
      },
      center: [longitude + 0.005, 42.005],
      minimumElevationMeters: 1_000,
      maximumElevationMeters: 1_120,
      elevationSource: 'gpx',
    },
  };
}

export function multiTrackContent(
  trackId: string,
  longitude: number,
): LocalTrackContent {
  return {
    schemaVersion: LOCAL_TRACK_SCHEMA_VERSION,
    trackId,
    trackPoints: [
      [
        { coordinate: [longitude, 42], elevationMeters: 1_000 },
        { coordinate: [longitude + 0.01, 42.01], elevationMeters: 1_120 },
      ],
    ],
    markers: [],
  };
}
export async function saveMultiTrackPair(): Promise<{
  readonly alpha: LocalTrackSummary;
  readonly alphaContent: LocalTrackContent;
  readonly beta: LocalTrackSummary;
  readonly betaContent: LocalTrackContent;
}> {
  const alpha = multiTrackSummary(
    'local:alpha',
    'Alpha trail',
    1_000,
    1_800,
    100,
    80,
    44,
  );
  const beta = multiTrackSummary(
    'local:beta',
    'Beta trail',
    2_000,
    3_600,
    200,
    160,
    45,
  );
  const alphaContent = multiTrackContent(alpha.id, 44);
  const betaContent = multiTrackContent(beta.id, 45);
  await services.database.saveLocalTrack(alpha, alphaContent);
  await services.database.saveLocalTrack(beta, betaContent);
  await services.database.saveLatestOpenedTrackId(alpha.id);
  return { alpha, alphaContent, beta, betaContent };
}

export const testViewport = {
  bounds: { west: 44.1, south: 42.1, east: 44.9, north: 42.9 },
  center: { longitude: 44.5, latitude: 42.5 },
} as const;

export const trackSortTestNames = [
  'Alpha',
  'Bravo',
  'East',
  'Mike',
  'November',
  'West',
  'Yankee',
  'Zulu',
] as const;

export function savedTrackNames(): readonly string[] {
  return within(screen.getByRole('list', { name: 'Saved tracks' }))
    .getAllByRole('listitem')
    .map((row) => {
      const [trackButton] = within(row).getAllByRole('button');
      if (trackButton === undefined) throw new Error('Expected a track row button.');
      const label = trackButton.textContent;
      const name = trackSortTestNames.find((candidate) => label.startsWith(candidate));
      if (name === undefined) throw new Error(`Unknown track row label: ${label}`);
      return name;
    });
}

export function catalogGatewayReturning(
  result: SatelliteCatalogResult,
): SatelliteCatalogGateway {
  return {
    search: () => Promise.resolve(result),
  };
}

export function catalogGatewayFailing(
  error: SatelliteCatalogError,
): SatelliteCatalogGateway {
  return {
    search: () => Promise.reject(error),
  };
}

export function syntheticSatelliteScene(
  id: string,
  acquiredAt: string,
): SatelliteScene {
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

export function gpxFile(name = 'Fixture track.gpx'): File {
  const xml = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Fixture trail</name><trkseg><trkpt lat="42" lon="44"><ele>1000</ele></trkpt><trkpt lat="42.01" lon="44.01"><ele>1120</ele></trkpt></trkseg></trk></gpx>`;
  const file = new File([xml], name, { type: 'application/gpx+xml' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(xml) });
  return file;
}

export function elevationFreeGpxFile(): File {
  const xml = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Elevation-free trail</name><trkseg><trkpt lat="42" lon="44"/><trkpt lat="42.01" lon="44.01"/></trkseg></trk></gpx>`;
  const file = new File([xml], 'Elevation-free.gpx', {
    type: 'application/gpx+xml',
  });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(xml) });
  return file;
}

export function gpxFileWithGradeBands(): File {
  const xml = `<?xml version="1.0"?><gpx version="1.1"><wpt lat="42.015" lon="44.015"><name>Imported summit</name></wpt><trk><name>Fixture trail</name><trkseg><trkpt lat="42" lon="44"><ele>1000</ele></trkpt><trkpt lat="42.01" lon="44.01"><ele>1120</ele></trkpt><trkpt lat="42.02" lon="44.02"><ele>1000</ele></trkpt><trkpt lat="42.03" lon="44.03"><ele>1120</ele></trkpt></trkseg></trk></gpx>`;
  const file = new File([xml], 'Fixture track.gpx', {
    type: 'application/gpx+xml',
  });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(xml) });
  return file;
}

export function flatGpxFile(): File {
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

export function gpxFileWithCompanionRoute(): File {
  const xml = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Detailed track</name><trkseg><trkpt lat="42" lon="44"><ele>1000</ele><time>2026-07-13T08:00:00Z</time></trkpt><trkpt lat="42.01" lon="44.01"><ele>1120</ele><time>2026-07-13T08:02:00Z</time></trkpt></trkseg></trk><rte><name>Companion route</name><rtept lat="42" lon="44"/><rtept lat="42.01" lon="44.01"/></rte></gpx>`;
  const file = new File([xml], 'Track and route.gpx', {
    type: 'application/gpx+xml',
  });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(xml) });
  return file;
}
