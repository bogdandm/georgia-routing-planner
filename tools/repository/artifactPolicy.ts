const forbiddenDirectoryNames = new Set([
  '.idea',
  '.pnpm-store',
  '.turbo',
  '.vite',
  'blob-report',
  'catalog-output',
  'catalog-report',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const forbiddenFileSuffixes = [
  '.bak',
  '.crash',
  '.dmp',
  '.log',
  '.pid',
  '.pid.lock',
  '.swp',
  '.temp',
  '.tmp',
  '.tsbuildinfo',
  '~',
] as const;

const secretFileNames = new Set([
  '.npmrc',
  'credentials.json',
  'id_ed25519',
  'id_rsa',
  'service-account.json',
]);

export interface ArtifactPolicyViolation {
  readonly path: string;
  readonly reason: string;
}

export function classifyTrackedPath(
  trackedPath: string,
): ArtifactPolicyViolation | null {
  const normalizedPath = trackedPath.replaceAll('\\', '/').replace(/^\.\//, '');
  const lowerPath = normalizedPath.toLowerCase();
  const segments = lowerPath.split('/');
  const fileName = segments.at(-1) ?? '';

  const forbiddenDirectory = segments.find((segment) =>
    forbiddenDirectoryNames.has(segment),
  );
  if (forbiddenDirectory !== undefined) {
    return {
      path: normalizedPath,
      reason: `generated or local-only directory: ${forbiddenDirectory}`,
    };
  }

  if (segments[0] === '.vscode' && fileName !== 'extensions.json') {
    return { path: normalizedPath, reason: 'personal editor state' };
  }

  if (
    (fileName === '.env' || fileName.startsWith('.env.')) &&
    fileName !== '.env.example'
  ) {
    return { path: normalizedPath, reason: 'environment or secret file' };
  }

  if (secretFileNames.has(fileName) || fileName.endsWith('.pem')) {
    return { path: normalizedPath, reason: 'credential-like file' };
  }

  if (forbiddenFileSuffixes.some((suffix) => fileName.endsWith(suffix))) {
    return { path: normalizedPath, reason: 'generated or temporary file' };
  }

  if (/^diagnostics-.*\.json$/u.test(fileName)) {
    return { path: normalizedPath, reason: 'personal diagnostics export' };
  }

  return null;
}

export function findTrackedArtifactViolations(
  trackedPaths: readonly string[],
): readonly ArtifactPolicyViolation[] {
  return trackedPaths
    .map((trackedPath) => classifyTrackedPath(trackedPath))
    .filter((violation): violation is ArtifactPolicyViolation => violation !== null);
}
