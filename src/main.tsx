import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';

import { runApplicationBootstrap } from '@/bootstrap/runApplicationBootstrap';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { WorkspaceErrorBoundary } from '@/presentation/shell/WorkspaceErrorBoundary';
import { WorkspaceShell } from '@/presentation/shell/WorkspaceShell';
import '@/presentation/styles/global.css';
import { createAppTheme } from '@/presentation/theme/createAppTheme';

runApplicationBootstrap((rootElement, services) => {
  const root = createRoot(rootElement);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    root.unmount();
    services.dispose();
  };
  const handlePageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) dispose();
  };
  window.addEventListener('pagehide', handlePageHide, { once: true });
  import.meta.hot?.dispose(() => {
    window.removeEventListener('pagehide', handlePageHide);
    dispose();
  });
  root.render(
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
});
