import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';

import { runApplicationBootstrap } from '@/bootstrap/runApplicationBootstrap';
import { registerPageLifecycleDisposal } from '@/bootstrap/registerPageLifecycleDisposal';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { WorkspaceErrorBoundary } from '@/presentation/shell/WorkspaceErrorBoundary';
import { WorkspaceShell } from '@/presentation/shell/WorkspaceShell';
import '@/presentation/styles/global.css';
import { createAppTheme } from '@/presentation/theme/createAppTheme';

runApplicationBootstrap((rootElement, services) => {
  const root = createRoot(rootElement);
  const dispose = registerPageLifecycleDisposal(() => {
    root.unmount();
    services.dispose();
  });
  import.meta.hot?.dispose(dispose);
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
