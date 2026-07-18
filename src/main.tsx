import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';

import { createRuntimeServices } from '@/bootstrap/createRuntimeServices';
import { installGlobalErrorCapture } from '@/bootstrap/installGlobalErrorCapture';
import { mountBootstrapFallback } from '@/bootstrap/mountBootstrapFallback';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { WorkspaceErrorBoundary } from '@/presentation/shell/WorkspaceErrorBoundary';
import { WorkspaceShell } from '@/presentation/shell/WorkspaceShell';
import '@/presentation/styles/global.css';
import { createAppTheme } from '@/presentation/theme/createAppTheme';

const services = createRuntimeServices();
installGlobalErrorCapture(services.logger);

const rootElement = document.querySelector<HTMLElement>('#root');

if (rootElement === null) {
  throw new Error('The application root element is missing.');
}

try {
  createRoot(rootElement).render(
    <StrictMode>
      <RuntimeServicesProvider services={services}>
        <QueryClientProvider client={services.queryClient}>
          <ThemeProvider theme={createAppTheme()}>
            <CssBaseline />
            <WorkspaceErrorBoundary
              diagnostics={services.diagnostics}
              logger={services.logger}
            >
              <WorkspaceShell />
            </WorkspaceErrorBoundary>
          </ThemeProvider>
        </QueryClientProvider>
      </RuntimeServicesProvider>
    </StrictMode>,
  );
  services.logger.log({ level: 'info', name: 'app.bootstrap.render-requested' });
} catch (error) {
  services.logger.log({
    level: 'error',
    name: 'app.bootstrap.failed',
    message: error instanceof Error ? error.message : 'Unknown bootstrap failure',
  });
  mountBootstrapFallback(rootElement, services.diagnostics);
}
