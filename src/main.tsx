import { I18nProvider } from '@lingui/react';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';

import { runApplicationBootstrap } from '@/bootstrap/runApplicationBootstrap';
import { registerPageLifecycleDisposal } from '@/bootstrap/registerPageLifecycleDisposal';
import { RuntimeServicesProvider } from '@/bootstrap/RuntimeServicesProvider';
import { WorkspaceErrorBoundary } from '@/presentation/shell/WorkspaceErrorBoundary';
import { WorkspaceShell } from '@/presentation/shell/WorkspaceShell';
import { activateAppLocale, appI18n } from '@/presentation/localization/appI18n';
import { resolveAppLocale } from '@/domain/localization/appLocale';
import type { MarkerSort } from '@/domain/markers/savedMarker';
import type { TrackSort } from '@/domain/tracks/localTrack';
import { useUiStore } from '@/presentation/shell/uiStore';
import '@/presentation/styles/global.css';
import { createAppTheme } from '@/presentation/theme/createAppTheme';

void runApplicationBootstrap(async (rootElement, services) => {
  const developerModeFromUrl =
    new URLSearchParams(window.location.search).get('developer') === '1';
  let developerMode = developerModeFromUrl;
  let navigationCollapsed = false;
  let elevationGradeLegendDismissed = false;
  let markerSort: MarkerSort = 'created';
  let trackSort: TrackSort = 'created';
  let locale = resolveAppLocale(null, navigator.languages);

  try {
    const preferences = await services.database.loadUiPreferences();
    developerMode = developerModeFromUrl || preferences.developerMode;
    navigationCollapsed = preferences.navigationCollapsed;
    elevationGradeLegendDismissed = preferences.elevationGradeLegendDismissed;
    markerSort = preferences.markerSort;
    trackSort = preferences.trackSort;
    locale = resolveAppLocale(preferences.locale, navigator.languages);
  } catch {
    services.logger.log({ level: 'warn', name: 'storage.settings.load-failed' });
  }

  activateAppLocale(locale);

  useUiStore.setState({
    developerMode,
    navigationCollapsed,
    elevationGradeLegendDismissed,
    markerSort,
    trackSort,
  });
  const root = createRoot(rootElement);
  const dispose = registerPageLifecycleDisposal(() => {
    root.unmount();
    services.dispose();
  });
  import.meta.hot?.dispose(dispose);
  root.render(
    <StrictMode>
      <I18nProvider i18n={appI18n}>
        <RuntimeServicesProvider services={services}>
          <ThemeProvider theme={createAppTheme()}>
            <CssBaseline />
            <WorkspaceErrorBoundary
              diagnostics={services.diagnostics}
              logger={services.logger}
            >
              <WorkspaceShell />
            </WorkspaceErrorBoundary>
          </ThemeProvider>
        </RuntimeServicesProvider>
      </I18nProvider>
    </StrictMode>,
  );
});
