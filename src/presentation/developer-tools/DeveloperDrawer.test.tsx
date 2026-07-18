import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { DeveloperDrawer } from '@/presentation/developer-tools/DeveloperDrawer';
import { useUiStore } from '@/presentation/shell/uiStore';
import { createTestServices } from '../../../test/helpers/createTestServices';
import { FakeMapFacade } from '../../../test/helpers/FakeMapFacade';

beforeEach(() => {
  useUiStore.setState({
    developerMode: true,
    mapDebugOptions: { showCollisionBoxes: false, showTileBoundaries: false },
  });
});

describe('DeveloperDrawer', () => {
  it('stays non-modal and closes only from its explicit control', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const services = createTestServices();
    render(
      <RuntimeServicesProvider services={services}>
        <DeveloperDrawer open onClose={onClose} onTriggerFailure={vi.fn()} />
      </RuntimeServicesProvider>,
    );

    expect(
      screen.getByRole('complementary', { name: 'Developer diagnostics' }),
    ).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.MuiBackdrop-root')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: 'Close developer diagnostics' }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the exact live map snapshot and controls safe MapLibre debug flags', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    services.mapDiagnostics.update({
      ...new FakeMapFacade().snapshot,
      lifecycle: 'ready',
      camera: {
        longitude: 44.82712,
        latitude: 41.71514,
        zoom: 8.25,
        bearing: 12,
        pitch: 35,
      },
      sourceIds: ['basemap-vector'],
      layerIds: ['background', 'water'],
      webGlContext: 'available',
      webGlCapabilities: {
        contextType: 'webgl2',
        version: 'WebGL 2.0',
        maxTextureSize: 16_384,
        antialias: true,
      },
    });
    render(
      <RuntimeServicesProvider services={services}>
        <DeveloperDrawer open onClose={vi.fn()} onTriggerFailure={vi.fn()} />
      </RuntimeServicesProvider>,
    );

    await user.click(screen.getByRole('tab', { name: 'Map' }));
    expect(screen.getByText(/Longitude 44\.82712, latitude 41\.71514/)).toBeVisible();
    expect(screen.getByRole('list', { name: 'Ordered map sources' })).toHaveTextContent(
      'basemap-vector',
    );
    expect(screen.getByText('Max texture: 16384; last idle: not yet')).toBeVisible();

    await user.click(screen.getByRole('switch', { name: 'Show tile boundaries' }));
    expect(useUiStore.getState().mapDebugOptions.showTileBoundaries).toBe(true);
  });

  it('shows each Sentinel step with its current status and duration', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    services.sentinelQueryDiagnostics.beginOperation('sentinel-test');
    services.sentinelQueryDiagnostics.beginStep('query-stac-catalog');
    services.sentinelQueryDiagnostics.completeStep('query-stac-catalog');
    services.sentinelQueryDiagnostics.beginStep('fetch-result-pages');

    render(
      <RuntimeServicesProvider services={services}>
        <DeveloperDrawer open onClose={vi.fn()} onTriggerFailure={vi.fn()} />
      </RuntimeServicesProvider>,
    );

    await user.click(screen.getByRole('tab', { name: 'Sentinel query' }));

    const catalogStep = screen.getByTestId('sentinel-query-step-query-stac-catalog');
    expect(within(catalogStep).getByText('Completed')).toBeVisible();
    expect(within(catalogStep).getByText(/\d+ ms/u)).toBeVisible();

    const paginationStep = screen.getByTestId('sentinel-query-step-fetch-result-pages');
    expect(within(paginationStep).getByText('Running')).toBeVisible();
    expect(
      within(paginationStep).getByText(
        'Follow provider next links within the pagination limit.',
      ),
    ).toBeVisible();
  });

  it('runs configured provider probes only after the explicit action', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    const probe = vi
      .spyOn(services.diagnostics, 'runProviderHealthChecks')
      .mockResolvedValue([
        {
          name: 'Vector provider reachability',
          status: 'pass',
          durationMs: 1,
          summary: 'The configured provider responded successfully.',
        },
      ]);
    render(
      <RuntimeServicesProvider services={services}>
        <DeveloperDrawer open onClose={vi.fn()} onTriggerFailure={vi.fn()} />
      </RuntimeServicesProvider>,
    );

    expect(probe).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Check configured providers' }),
    );

    expect(probe).toHaveBeenCalledOnce();
    expect(
      screen.getByText('The configured provider responded successfully.'),
    ).toBeVisible();
  });
});
