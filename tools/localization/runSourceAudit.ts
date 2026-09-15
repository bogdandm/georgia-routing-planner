import { spawnSync } from 'node:child_process';

const paths = process.argv.slice(2);
if (paths.length === 0 || paths.some((path) => path.startsWith('-'))) {
  process.stderr.write('Usage: pnpm i18n:audit <path> [<path> ...]\n');
  process.exitCode = 1;
} else {
  const result = spawnSync(
    'eslint',
    ['--config', 'eslint.i18n.config.js', '--max-warnings', '0', ...paths],
    { stdio: 'inherit' },
  );
  if (result.error !== undefined) throw result.error;
  process.exitCode = result.status ?? 1;
}
