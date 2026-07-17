import { ThemeProvider } from '@mui/material';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from '@/app/AppErrorBoundary';
import { createAppTheme } from '@/app/theme/createAppTheme';
import { createTestServices } from '../../test/helpers/createTestServices';

function FailingComponent(): never {
  throw new Error('Synthetic component failure');
}

afterEach(async () => {
  const services = createTestServices();
  services.database.close();
  await services.database.delete();
});

describe('AppErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    const services = createTestServices();
    render(
      <AppErrorBoundary diagnostics={services.diagnostics} logger={services.logger}>
        <div>Healthy child</div>
      </AppErrorBoundary>,
    );

    expect(screen.getByText('Healthy child')).toBeVisible();
  });

  it('captures a component error and offers diagnostics export', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const services = createTestServices();
    render(
      <ThemeProvider theme={createAppTheme()}>
        <AppErrorBoundary diagnostics={services.diagnostics} logger={services.logger}>
          <FailingComponent />
        </AppErrorBoundary>
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
