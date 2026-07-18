import { render, screen } from '@testing-library/react';
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
