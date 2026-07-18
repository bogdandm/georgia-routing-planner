import { ThemeProvider } from '@mui/material';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceErrorBoundary } from '@/presentation/shell/WorkspaceErrorBoundary';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { createTestServices } from '../../../test/helpers/createTestServices';

function FailingComponent(): never {
  throw new Error('Synthetic component failure');
}

afterEach(async () => {
  const services = createTestServices();
  services.database.close();
  await services.database.delete();
});

describe('WorkspaceErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    const services = createTestServices();
    render(
      <WorkspaceErrorBoundary
        diagnostics={services.diagnostics}
        logger={services.logger}
      >
        <div>Healthy child</div>
      </WorkspaceErrorBoundary>,
    );

    expect(screen.getByText('Healthy child')).toBeVisible();
  });

  it('captures a component error and offers diagnostics export', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const services = createTestServices();
    render(
      <ThemeProvider theme={createAppTheme()}>
        <WorkspaceErrorBoundary
          diagnostics={services.diagnostics}
          logger={services.logger}
        >
          <FailingComponent />
        </WorkspaceErrorBoundary>
      </ThemeProvider>,
    );

    expect(
      screen.getByRole('heading', { name: 'The application encountered an error' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download diagnostics' })).toBeVisible();
    expect(
      services.logger
        .getEvents()
        .some((event) => event.name === 'react.error-boundary.caught'),
    ).toBe(true);
  });
});
