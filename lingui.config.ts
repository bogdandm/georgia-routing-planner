import { defineConfig, type LinguiConfig } from '@lingui/conf';
import { formatter } from '@lingui/format-po';

const config: LinguiConfig = {
  sourceLocale: 'en',
  locales: ['en', 'ru'],
  format: formatter({
    printLinguiId: true,
    printPlaceholdersInComments: true,
  }),
  catalogsMergePath: '<rootDir>/node_modules/.tmp/locales/{locale}',
  catalogs: [
    {
      name: 'core',
      path: '<rootDir>/src/locales/{locale}/core',
      include: ['<rootDir>/src/main.tsx', '<rootDir>/src/presentation/localization/**'],
    },
    {
      name: 'shell',
      path: '<rootDir>/src/locales/{locale}/shell',
      include: ['<rootDir>/src/presentation/shell/**'],
    },
    {
      name: 'map',
      path: '<rootDir>/src/locales/{locale}/map',
      include: ['<rootDir>/src/presentation/map/**'],
    },
    {
      name: 'tracks',
      path: '<rootDir>/src/locales/{locale}/tracks',
      include: ['<rootDir>/src/presentation/tracks/**'],
    },
    {
      name: 'satellite',
      path: '<rootDir>/src/locales/{locale}/satellite',
      include: ['<rootDir>/src/presentation/satellite-browser/**'],
    },
    {
      name: 'markers',
      path: '<rootDir>/src/locales/{locale}/markers',
      include: ['<rootDir>/src/presentation/markers/**'],
    },
    {
      name: 'layers',
      path: '<rootDir>/src/locales/{locale}/layers',
      include: ['<rootDir>/src/presentation/layers/**'],
    },
    {
      name: 'user',
      path: '<rootDir>/src/locales/{locale}/user',
      include: ['<rootDir>/src/presentation/user/**'],
    },
  ],
};

export default defineConfig(config);
