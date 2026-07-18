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
});
