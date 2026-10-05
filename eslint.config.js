import js from '@eslint/js';
import lingui from 'eslint-plugin-lingui';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
export const noUnlocalizedStringsRule = [
  'error',
  {
    ignoreNames: [
      'className',
      'id',
      'data-testid',
      // Onboarding tour anchor names are selectors, not copy.
      'data-tour',
      'href',
      'rel',
      'target',
      'type',
      'value',
      // Internal state token and ARIA ID reference; neither is user-visible copy.
      'defaultSettingsTab',
      'settingsPanelTitleId',
      'name',
      'component',
      'role',
      'sx',
      'key',
      'aria-haspopup',
      'aria-hidden',
      // Non-visible MUI presentation and layout enum values.
      'align',
      'alignContent',
      'alignItems',
      'anchorReference',
      'color',
      'direction',
      'display',
      'elevation',
      'flexDirection',
      'fontSize',
      'horizontal',
      'justifyContent',
      'maxWidth',
      'orientation',
      'placement',
      'position',
      'severity',
      'size',
      'spacing',
      'variant',
      'vertical',
    ],
    ignoreFunctions: [
      // DOM selectors, element tags, event names, and media queries are never copy.
      'document.querySelector',
      'document.createElement',
      '*.addEventListener',
      '*.removeEventListener',
      'useMediaQuery',
      // Thrown errors are diagnostics; presentation maps them to localized copy.
      'Error',
      'RangeError',
    ],
    useTsTypes: true,
  },
];

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      '.codex-worktrees/**',
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'supabase/functions/**',
      'supabase/tests/**/*.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.js'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: [
      'src/presentation/shell/WorkspaceRail.tsx',
      'src/presentation/shell/WorkspaceSidebar.tsx',
      'src/presentation/shell/WorkspaceShell.tsx',
      'src/presentation/shell/MapSearchPlaceholder.tsx',
      'src/presentation/shell/OperationalStatus.tsx',
      'src/presentation/shell/ShareMapDialog.tsx',
      'src/presentation/shell/StorageUsagePanel.tsx',
      'src/presentation/shell/AboutDialog.tsx',
      'src/presentation/shell/WorkspaceErrorBoundary.tsx',
      'src/presentation/shell/workspaceTabLocation.ts',
      'src/presentation/shell/formatPlaceSearchCategory.ts',
      'src/presentation/shell/SettingsDialog.tsx',
      'src/presentation/shell/OnboardingTour.tsx',
      'src/presentation/map/MapWorkspace.tsx',
      'src/presentation/map/MapViewControls.tsx',
      'src/presentation/map/ElevationGradeLegend.tsx',
      'src/presentation/map/MapLibrePointInspector.ts',
      'src/presentation/map/MapPointInspectorContent.tsx',
      'src/presentation/tracks/TracksWorkspace.tsx',
      'src/presentation/tracks/ElevationProfileChart.tsx',
      'src/presentation/tracks/RoutePlanControls.tsx',
      'src/presentation/tracks/TrackMarkersSection.tsx',
      'src/presentation/tracks/TrackWeatherSection.tsx',
      'src/presentation/tracks/ClimbsDescentsSection.tsx',
      'src/presentation/tracks/TrackSummary.tsx',
      'src/presentation/tracks/TrackThumbnailImage.tsx',
      'src/presentation/tracks/TrackFolderEditorDialog.tsx',
      'src/presentation/tracks/trackFormatters.ts',
      'src/presentation/markers/MarkersWorkspace.tsx',
      'src/presentation/markers/MarkerEditorDialog.tsx',
      'src/presentation/markers/MarkerIconPicker.tsx',
      'src/presentation/markers/MarkerWeatherSettingsDialog.tsx',
      'src/presentation/markers/markerCatalog.tsx',
    ],
    plugins: { lingui },
    rules: {
      'lingui/no-unlocalized-strings': noUnlocalizedStringsRule,
    },
  },
  {
    files: ['tools/**/*.ts', '*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message: 'Tests must live under tests/ and mirror the relevant src/ path.',
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.{ts,tsx}', 'src/application/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/bootstrap/**',
                '@/presentation/**',
                '@/infrastructure/**',
                '@mui/**',
                'dexie',
                'ky',
                'maplibre-gl',
                'react',
                'react-dom',
                'react-map-gl/**',
                'zustand',
              ],
              message: 'Keep domain/application code independent of UI and adapters.',
            },
          ],
        },
      ],
    },
  },
);
