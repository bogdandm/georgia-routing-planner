import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __BUILD_COMMIT__: JSON.stringify('test-commit'),
    __BUILD_TIMESTAMP__: JSON.stringify('2026-07-18T00:00:00.000Z'),
    __BUILD_MODE__: JSON.stringify('test'),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    exclude: ['**/*.integration.test.{ts,tsx}'],
    setupFiles: ['./test/setup/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'src/application/**/*.ts',
        'src/diagnostics/**/*.ts',
        'src/infrastructure/**/*.ts',
        'src/features/app-shell/**/*.{ts,tsx}',
        'src/app/App.tsx',
        'src/app/AppErrorBoundary.tsx',
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        'src/diagnostics/snapshots/HealthCheckService.ts',
      ],
      thresholds: {
        statements: 80,
        lines: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});
