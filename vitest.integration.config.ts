import { fileURLToPath, URL } from 'node:url';

import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { lingui, linguiTransformerBabelPreset } from '@lingui/vite-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    react(),
    lingui(),
    babel({ presets: [linguiTransformerBabelPreset()] }),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@test': fileURLToPath(new URL('./tests', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __BUILD_COMMIT__: JSON.stringify('test-commit'),
    __BUILD_TIMESTAMP__: JSON.stringify('2026-07-18T00:00:00.000Z'),
    __BUILD_MODE__: JSON.stringify('test'),
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.integration.test.{ts,tsx}'],
    setupFiles: ['./tests/setup/vitest.setup.ts'],
  },
});
