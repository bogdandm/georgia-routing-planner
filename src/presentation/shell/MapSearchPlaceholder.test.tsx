import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { QueryClientProvider } from '@tanstack/react-query';
import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import {
  mapInteractionStore,
  resetMapInteractionStore,
} from '@/presentation/map/mapInteractionStore';
import { MapSearchPlaceholder } from '@/presentation/shell/MapSearchPlaceholder';
import { createTestServices } from '../../../test/helpers/createTestServices';

const testViewport = {
  bounds: { west: 44.1, south: 42.1, east: 44.9, north: 42.9 },
  center: { longitude: 44.5, latitude: 42.5 },
} as const;

describe('MapSearchPlaceholder', () => {
  beforeEach(() => {
    resetMapInteractionStore();
  });

  const renderSearch = (services: RuntimeServices) =>
    render(
      <QueryClientProvider client={services.queryClient}>
        <RuntimeServicesProvider services={services}>
          <MapSearchPlaceholder />
        </RuntimeServicesProvider>
      </QueryClientProvider>,
    );

  it('navigates locally for labelled coordinates without contacting a provider', async () => {
    const services = createTestServices();
    if (services.searchPlaces === null) return;
    const execute = vi.spyOn(services.searchPlaces, 'execute');
    const user = userEvent.setup();
    renderSearch(services);
    const input = screen.getByRole('textbox', {
      name: 'Search places or coordinates',
    });
    await user.type(input, 'lat: 41.7, lon: 44.8{Enter}');

    expect(execute).not.toHaveBeenCalled();
    expect(mapInteractionStore.getState().navigationCommand?.target).toEqual({
      latitude: 41.7,
      longitude: 44.8,
      zoom: 13,
    });
  });

  it('submits text only on request and navigates to the selected result', async () => {
    const services = createTestServices();
    if (services.searchPlaces === null) return;
    const execute = vi.spyOn(services.searchPlaces, 'execute').mockResolvedValue([
      {
        id: 'tbilisi',
        label: 'Tbilisi, Georgia',
        coordinate: { latitude: 41.7151, longitude: 44.8271 },
        category: 'place:city',
        kind: 'settlement',
        bounds: null,
      },
    ]);
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderSearch(services);
    const input = screen.getByRole('textbox', {
      name: 'Search places or coordinates',
    });
    await user.type(input, 'Tbilisi');
    expect(execute).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(execute).toHaveBeenCalledWith(
      'Tbilisi',
      testViewport.bounds,
      expect.any(AbortSignal),
      expect.any(Function),
    );
    await user.click(await screen.findByText('Tbilisi, Georgia'));

    expect(input).toHaveValue('Tbilisi');

    expect(mapInteractionStore.getState().navigationCommand?.target).toEqual({
      latitude: 41.7151,
      longitude: 44.8271,
      zoom: 13,
    });

    await user.click(screen.getByRole('button', { name: 'Clear map search' }));
    expect(input).toHaveValue('');
  });

  it('shows accumulated matches while the search continues into wider areas', async () => {
    const services = createTestServices();
    if (services.searchPlaces === null) return;
    const nearbyResult = {
      id: 'batumi-street',
      label: 'Batumi Street, Gori, Georgia',
      coordinate: { latitude: 41.98, longitude: 44.11 },
      category: 'highway:residential',
      kind: 'other',
      bounds: null,
    } as const;
    const cityResult = {
      id: 'batumi-city',
      label: 'Batumi, Georgia',
      coordinate: { latitude: 41.6461, longitude: 41.6405 },
      category: 'place:city',
      kind: 'settlement',
      bounds: null,
    } as const;
    let completeSearch:
      ((results: readonly [typeof nearbyResult, typeof cityResult]) => void) | null =
      null;
    vi.spyOn(services.searchPlaces, 'execute').mockImplementation(
      (_query, _bounds, _signal, onProgress) => {
        onProgress?.({
          status: 'expanding',
          attempt: 2,
          largerSideKm: 100,
          results: [nearbyResult],
        });
        return new Promise((resolve) => {
          completeSearch = resolve;
        });
      },
    );
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderSearch(services);

    await user.type(
      screen.getByRole('textbox', { name: 'Search places or coordinates' }),
      'Batumi{Enter}',
    );

    expect(screen.queryByText('Batumi Street, Gori, Georgia')).not.toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Expanding place search area' }),
    ).toHaveAttribute('aria-valuetext', '50 of 500 kilometres');

    await act(() => {
      completeSearch?.([nearbyResult, cityResult]);
      return Promise.resolve();
    });
    expect(await screen.findByText('Batumi, Georgia')).toBeVisible();
    expect(screen.getByText(/km away/u)).toBeVisible();
    expect(screen.queryByText('Batumi Street, Gori, Georgia')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show 1 other result' }));
    expect(screen.getByText('Batumi Street, Gori, Georgia')).toBeVisible();
  });

  it('keeps an active search running when a map control receives focus', async () => {
    const services = createTestServices();
    if (services.searchPlaces === null) return;
    const submittedSignals: AbortSignal[] = [];
    vi.spyOn(services.searchPlaces, 'execute').mockImplementation(
      (_query, _bounds, signal) => {
        submittedSignals.push(signal);
        return new Promise<never>(() => undefined);
      },
    );
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={services.queryClient}>
        <RuntimeServicesProvider services={services}>
          <button type="button">Map zoom in</button>
          <MapSearchPlaceholder />
        </RuntimeServicesProvider>
      </QueryClientProvider>,
    );

    await user.type(
      screen.getByRole('textbox', { name: 'Search places or coordinates' }),
      'Batumi{Enter}',
    );
    await screen.findByLabelText('Searching places');
    await user.click(screen.getByRole('button', { name: 'Map zoom in' }));

    expect(submittedSignals[0]?.aborted).toBe(false);
    expect(screen.getByLabelText('Searching places')).toBeVisible();
  });

  it('fits an area result without zooming closer than level 13', async () => {
    const services = createTestServices();
    if (services.searchPlaces === null) return;
    const bounds = { west: 43.9, south: 41.4, east: 45.1, north: 42.2 } as const;
    vi.spyOn(services.searchPlaces, 'execute').mockResolvedValue([
      {
        id: 'tbilisi-region',
        label: 'Tbilisi, Georgia',
        coordinate: { latitude: 41.7151, longitude: 44.8271 },
        category: 'boundary:administrative',
        kind: 'administrative-area',
        bounds,
      },
    ]);
    services.mapViewport.update(testViewport);
    const user = userEvent.setup();
    renderSearch(services);

    await user.type(
      screen.getByRole('textbox', { name: 'Search places or coordinates' }),
      'Tbilisi{Enter}',
    );
    await user.click(await screen.findByText('Tbilisi, Georgia'));

    expect(mapInteractionStore.getState().fitBoundsCommand).toMatchObject({
      bounds,
      maxZoom: 13,
    });
  });

  it('does not run a global place search before the map viewport is ready', async () => {
    const services = createTestServices();
    if (services.searchPlaces === null) return;
    const execute = vi.spyOn(services.searchPlaces, 'execute');
    const user = userEvent.setup();
    renderSearch(services);

    await user.type(
      screen.getByRole('textbox', { name: 'Search places or coordinates' }),
      'Oni{Enter}',
    );

    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Wait for the map viewport to become ready',
    );
  });

  it('explains ambiguous coordinate order instead of guessing', async () => {
    const user = userEvent.setup();
    renderSearch(createTestServices());
    await user.type(
      screen.getByRole('textbox', { name: 'Search places or coordinates' }),
      '41.7, 44.8{Enter}',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Coordinate order is ambiguous',
    );
  });
});
