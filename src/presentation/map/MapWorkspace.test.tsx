import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { MapWorkspace } from '@/presentation/map/MapWorkspace';
import { createTestServices } from '../../../test/helpers/createTestServices';
import { FakeMapFacade } from '../../../test/helpers/FakeMapFacade';

describe('MapWorkspace', () => {
  it('renders lifecycle feedback from a serializable facade snapshot', () => {
    const facade = new FakeMapFacade();
    const services = createTestServices();
    const { unmount } = render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace facade={facade} mapCanvas={<div>Controlled map canvas</div>} />
      </RuntimeServicesProvider>,
    );

    expect(screen.getByRole('status', { name: 'Loading map workspace' })).toBeVisible();

    act(() => {
      facade.setSnapshot({
        lifecycle: 'fatal',
        message: 'WebGL is unavailable for this browser.',
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'WebGL is unavailable for this browser.',
    );

    unmount();
    expect(facade.destroyed).toBe(true);
  });

  it('fails safely before mounting MapLibre when provider configuration is invalid', () => {
    const facade = new FakeMapFacade();
    const services = {
      ...createTestServices(),
      mapProviderConfiguration: {
        status: 'invalid' as const,
        message: 'Map provider configuration is invalid (1 validation issue).',
      },
    };

    render(
      <RuntimeServicesProvider services={services}>
        <MapWorkspace facade={facade} mapCanvas={<div>Must not mount</div>} />
      </RuntimeServicesProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The basemap was not started');
    expect(screen.queryByText('Must not mount')).not.toBeInTheDocument();
    expect(screen.getByTestId('map-workspace')).toHaveAttribute(
      'data-map-state',
      'fatal',
    );
  });
});
