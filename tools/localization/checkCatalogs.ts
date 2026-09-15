import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  findChangedCatalogPaths,
  LOCALIZATION_CATALOGS,
  type CatalogPair,
  type LocalizationCatalog,
  validateCatalogs,
} from './catalogValidator.ts';
import { translationAllowlist } from './translationAllowlist.ts';

function isLocalizationCatalog(
  value: string | undefined,
): value is LocalizationCatalog {
  return (
    value !== undefined && LOCALIZATION_CATALOGS.some((catalog) => catalog === value)
  );
}

function parseCatalogArgument(args: readonly string[]): readonly LocalizationCatalog[] {
  if (args.length === 0) return LOCALIZATION_CATALOGS;
  if (args.length !== 2 || args[0] !== '--catalog') {
    throw new Error('Usage: pnpm i18n:check [--catalog <name>]');
  }
  const catalog = args[1];
  if (!isLocalizationCatalog(catalog)) {
    throw new Error(`Unknown localization catalog: ${catalog ?? ''}`);
  }
  return [catalog];
}

function allPoPaths(root: string): readonly string[] {
  return execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ':(glob)**/*.po',
    ],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter((entry) => entry !== '');
}

function snapshotPoFiles(root: string): ReadonlyMap<string, Uint8Array> {
  const paths = allPoPaths(root);
  const snapshot = new Map<string, Uint8Array>();
  for (const relativePath of paths) {
    const absolutePath = path.join(root, relativePath);
    if (existsSync(absolutePath))
      snapshot.set(relativePath, readFileSync(absolutePath));
  }
  return snapshot;
}

function readCatalogPairs(
  root: string,
  catalogs: readonly LocalizationCatalog[],
): readonly CatalogPair[] {
  return catalogs.map((catalog) => ({
    catalog,
    englishPo: readFileSync(path.join(root, 'src/locales/en', `${catalog}.po`), 'utf8'),
    russianPo: readFileSync(path.join(root, 'src/locales/ru', `${catalog}.po`), 'utf8'),
  }));
}

function main(): void {
  const root = process.cwd();
  const catalogs = parseCatalogArgument(process.argv.slice(2));
  const beforeExtraction = snapshotPoFiles(root);

  execFileSync('pnpm', ['i18n:extract'], { cwd: root, stdio: 'inherit' });

  const afterExtraction = snapshotPoFiles(root);
  const changedCatalogs = findChangedCatalogPaths(beforeExtraction, afterExtraction);
  if (changedCatalogs.length > 0) {
    process.stderr.write('Localization extraction changed catalogs:\n');
    for (const catalogPath of changedCatalogs) process.stderr.write(`${catalogPath}\n`);
    process.exitCode = 1;
    return;
  }

  execFileSync('pnpm', ['i18n:compile'], { cwd: root, stdio: 'inherit' });

  const errors = validateCatalogs(
    readCatalogPairs(root, catalogs),
    translationAllowlist,
  );
  if (errors.length > 0) {
    process.stderr.write('Localization catalog validation failed:\n');
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Localization catalog validation passed: ${catalogs.join(', ')}.\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
