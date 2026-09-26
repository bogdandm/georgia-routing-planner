import lingui from 'eslint-plugin-lingui';

import baseConfig, { noUnlocalizedStringsRule } from './eslint.config.js';

export default [
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { lingui },
    rules: {
      'lingui/no-unlocalized-strings': noUnlocalizedStringsRule,
    },
  },
];
