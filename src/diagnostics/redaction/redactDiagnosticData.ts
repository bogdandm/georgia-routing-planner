import type {
  DiagnosticFieldValue,
  DiagnosticInput,
} from '@/application/ports/DiagnosticLogger';

const exportableFieldNames = new Set([
  'appVersion',
  'buildMode',
  'cameraZoom',
  'capability',
  'category',
  'code',
  'commit',
  'component',
  'count',
  'durationMs',
  'operationId',
  'quotaBytes',
  'ready',
  'reason',
  'schemaVersion',
  'satelliteId',
  'satelliteOrigin',
  'sourceId',
  'status',
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

function sanitizeFieldValue(value: DiagnosticFieldValue): DiagnosticFieldValue {
  return typeof value === 'string' ? sanitizeDiagnosticText(value) : value;
}

export function redactDiagnosticInput(input: DiagnosticInput): DiagnosticInput {
  const safeDataEntries = Object.entries(input.data ?? {})
    .filter(([key]) => exportableFieldNames.has(key))
    .map(([key, value]) => [key, sanitizeFieldValue(value)] as const);
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
