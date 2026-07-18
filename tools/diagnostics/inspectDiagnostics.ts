import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ZodError } from 'zod';

import { summarizeDiagnostics } from './summarizeDiagnostics';

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2).filter((value) => value !== '--');
  const bundlePath = arguments_[0];
  if (bundlePath === undefined || arguments_.length !== 1) {
    throw new Error('Usage: pnpm diagnostics:inspect -- <diagnostics-bundle.json>');
  }

  const raw = await readFile(resolve(bundlePath), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  process.stdout.write(summarizeDiagnostics(parsed));
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof ZodError
      ? 'Unsupported or invalid diagnostics bundle. Expected schema version 1 or 2.'
      : error instanceof Error
        ? error.message
        : 'Unknown diagnostics inspection failure.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
