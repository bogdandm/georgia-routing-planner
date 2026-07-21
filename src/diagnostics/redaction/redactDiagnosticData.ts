import type {
  DiagnosticFieldValue,
  DiagnosticInput,
} from '@/application/ports/DiagnosticLogger';

const exportableFieldNames = new Set([
  'appVersion',
  'attempt',
  'buildMode',
  'cameraZoom',
  'capability',
  'category',
  'code',
  'commit',
  'component',
  'count',
  'durationMs',
  'executionMode',
  'operationId',
  'operation',
  'origin',
  'impossibleCount',
  'noDataCount',
  'quotaBytes',
  'queueDurationMs',
  'computeDurationMs',
  'pendingCount',
  'ready',
  'reason',
  'recoveryState',
  'repairedCount',
  'schemaVersion',
  'satelliteId',
  'satelliteOrigin',
  'sourceId',
  'sentinelCount',
  'spikeCount',
  'status',
  'unrepairedCount',
  'usageBytes',
]);

const secretAssignmentPattern =
  /\b(authorization|cookie|password|secret|token|api[-_]?key)\s*[:=]\s*[^\s,;]+/giu;
const bearerPattern = /\bbearer\s+[a-z0-9._~+/=-]+/giu;
const windowsPathPattern = /\b[a-z]:\\[^\r\n"']+/giu;
const hierarchicalUriPattern = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu;
const opaqueSensitiveUriPattern = /\b(?:data|javascript|mailto):[^\s"'<>]+/giu;
const protocolRelativeUriPattern = /(^|[\s("'=])\/\/[^\s"'<>]+/gmu;
const posixPathPattern = /(^|[\s("'=])\/(?!\/)[^\s"'<>]+/gmu;
const gpxFilenamePattern = /\b[^\s/\\]+\.gpx\b/giu;
const coordinatePairPattern = /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/gu;

export function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(bearerPattern, 'Bearer [redacted]')
    .replace(secretAssignmentPattern, '$1=[redacted]')
    .replace(windowsPathPattern, '[local-path]')
    .replace(hierarchicalUriPattern, '[remote-url]')
    .replace(opaqueSensitiveUriPattern, '[uri]')
    .replace(protocolRelativeUriPattern, '$1[remote-url]')
    .replace(posixPathPattern, '$1[local-path]')
    .replace(gpxFilenamePattern, '[gpx-file]')
    .replace(coordinatePairPattern, '[coordinates]');
}

function sanitizeOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      value === parsed.origin
    ) {
      return parsed.origin;
    }
  } catch {
    // Invalid origin-shaped data falls through to the general text redactor.
  }
  return sanitizeDiagnosticText(value);
}

function sanitizeFieldValue(
  key: string,
  value: DiagnosticFieldValue,
): DiagnosticFieldValue {
  if (typeof value !== 'string') return value;
  return key === 'origin' || key.endsWith('Origin')
    ? sanitizeOrigin(value)
    : sanitizeDiagnosticText(value);
}

export function redactDiagnosticInput(input: DiagnosticInput): DiagnosticInput {
  const safeDataEntries = Object.entries(input.data ?? {})
    .filter(([key]) => exportableFieldNames.has(key))
    .map(([key, value]) => [key, sanitizeFieldValue(key, value)] as const);
  const safeData = Object.fromEntries(safeDataEntries);

  return {
    level: input.level,
    name: input.name,
    ...(input.message === undefined
      ? {}
      : { message: sanitizeDiagnosticText(input.message) }),
    ...(safeDataEntries.length === 0 ? {} : { data: safeData }),
  };
}
