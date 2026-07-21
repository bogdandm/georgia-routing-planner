import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

/** Coverage combines normal and infrastructure tests while their focused commands stay separate. */
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
    // Four to six concurrent agent workstreams can make V8 instrumentation several
    // times slower on the managed Windows workstation. Use one stable ceiling instead
    // of forcing each agent through incremental timeout increases.
    testTimeout: 30_000,
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'src/application/**/*.ts',
        'src/diagnostics/**/*.ts',
        'src/domain/**/*.ts',
        'src/infrastructure/**/*.ts',
        'src/presentation/satellite-browser/**/*.{ts,tsx}',
        'src/presentation/shell/**/*.{ts,tsx}',
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
        'src/application/**/*.ts': {
          statements: 90,
          lines: 90,
          branches: 85,
        },
        'src/domain/**/*.ts': {
          statements: 90,
          lines: 90,
          branches: 85,
        },
      },
    },
  },
});
