import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

interface PackageMetadata {
  readonly version: string;
}

const packageMetadata = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as PackageMetadata;

function readCommitHash(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function normalizeBasePath(value: string | undefined): string {
  if (value === undefined || value.trim() === '' || value === '/') {
    return '/';
  }

  return `/${value.replace(/^\/+|\/+$/g, '')}/`;
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const base = normalizeBasePath(environment.BASE_PATH);

  return {
    base,
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(packageMetadata.version),
      __BUILD_COMMIT__: JSON.stringify(readCommitHash()),
      __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
      __BUILD_MODE__: JSON.stringify(mode),
    },
    build: {
      sourcemap: false,
    },
  };
});
