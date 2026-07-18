import { execFileSync } from 'node:child_process';

import { findTrackedArtifactViolations } from './artifactPolicy.ts';

function readTrackedPaths(): readonly string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.length > 0);
}

const violations = findTrackedArtifactViolations(readTrackedPaths());

if (violations.length > 0) {
  process.stderr.write('Repository audit failed. Forbidden tracked artifacts:\n');
  for (const violation of violations) {
    process.stderr.write(`- ${violation.path}: ${violation.reason}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write('Repository audit passed: no forbidden tracked artifacts.\n');
}
