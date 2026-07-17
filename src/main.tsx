import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';

import { App } from '@/app/App';
import { AppErrorBoundary } from '@/app/AppErrorBoundary';
import { ApplicationServicesProvider } from '@/app/bootstrap/ApplicationServicesProvider';
import { createApplicationServices } from '@/app/bootstrap/createApplicationServices';
import { installGlobalErrorCapture } from '@/app/bootstrap/installGlobalErrorCapture';
import { mountBootstrapFallback } from '@/app/bootstrap/mountBootstrapFallback';
import { createAppTheme } from '@/app/theme/createAppTheme';
import '@/styles/global.css';

const services = createApplicationServices();
installGlobalErrorCapture(services.logger);

const rootElement = document.querySelector<HTMLElement>('#root');

if (rootElement === null) {
  throw new Error('The application root element is missing.');
}

try {
  createRoot(rootElement).render(
    <StrictMode>
      <ApplicationServicesProvider services={services}>
        <QueryClientProvider client={services.queryClient}>
          <ThemeProvider theme={createAppTheme()}>
            <CssBaseline />
            <AppErrorBoundary
              diagnostics={services.diagnostics}
              logger={services.logger}
            >
              <App />
            </AppErrorBoundary>
          </ThemeProvider>
        </QueryClientProvider>
      </ApplicationServicesProvider>
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
