import { I18nProvider } from '@lingui/react';
import { ThemeProvider } from '@mui/material';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';
import type { DiagnosticsService } from '@/diagnostics/export/DiagnosticsService';
import { activateAppLocale, appI18n } from '@/presentation/localization/appI18n';
import { WorkspaceErrorBoundary } from '@/presentation/shell/WorkspaceErrorBoundary';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { createTestServices } from '@test/helpers/createTestServices';

function FailingComponent(): never {
  throw new Error('Synthetic component failure');
}

function renderFailure(diagnostics: DiagnosticsService, logger: DiagnosticLogger) {
  return render(
    <I18nProvider i18n={appI18n}>
      <ThemeProvider theme={createAppTheme()}>
        <WorkspaceErrorBoundary diagnostics={diagnostics} logger={logger}>
          <FailingComponent />
        </WorkspaceErrorBoundary>
      </ThemeProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  activateAppLocale('en');
});

afterEach(async () => {
  const services = createTestServices();
  services.database.close();
  await services.database.delete();
});

describe('WorkspaceErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    const services = createTestServices();
    render(
      <I18nProvider i18n={appI18n}>
        <ThemeProvider theme={createAppTheme()}>
          <WorkspaceErrorBoundary
            diagnostics={services.diagnostics}
            logger={services.logger}
          >
            <div>Healthy child</div>
          </WorkspaceErrorBoundary>
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(screen.getByText('Healthy child')).toBeVisible();
  });

  it('captures a component error and offers diagnostics export', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const services = createTestServices();
    renderFailure(services.diagnostics, services.logger);

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

  it('offers the localized recovery action in Russian', () => {
    activateAppLocale('ru');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const services = createTestServices();
    renderFailure(services.diagnostics, services.logger);

    expect(
      screen.getByRole('heading', { name: 'Приложение столкнулось с ошибкой' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Скачать диагностику' })).toBeVisible();
  });
});
