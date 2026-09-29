import { I18nProvider } from '@lingui/react';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

import { appI18n } from '@/presentation/localization/appI18n';

/** Renders with the application Lingui instance; activate the locale before calling. */
export function renderWithI18n(ui: ReactElement): RenderResult {
  return render(ui, {
    wrapper: ({ children }) => <I18nProvider i18n={appI18n}>{children}</I18nProvider>,
  });
}
