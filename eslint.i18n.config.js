import lingui from 'eslint-plugin-lingui';

import baseConfig from './eslint.config.js';

export default [
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { lingui },
    rules: {
      'lingui/no-unlocalized-strings': [
        'error',
        {
          ignoreNames: [
            'className',
            'id',
            'data-testid',
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
            // Non-visible MUI presentation and layout enum values.
            'align',
            'alignContent',
            'alignItems',
            'color',
            'direction',
            'display',
            'elevation',
            'flexDirection',
            'justifyContent',
            'orientation',
            'placement',
            'position',
            'size',
            'spacing',
            'variant',
          ],
          // DOM selectors identify existing metadata and are never rendered as copy.
          ignoreFunctions: ['document.querySelector'],
          useTsTypes: true,
        },
      ],
    },
  },
];
