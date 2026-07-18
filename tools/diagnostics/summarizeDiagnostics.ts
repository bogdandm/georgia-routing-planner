import { z } from 'zod';

import {
  diagnosticBundleSchema,
  diagnosticBundleV1Schema,
  type DiagnosticBundle,
} from '../../src/diagnostics/export/diagnosticBundleSchema';

export const cliDiagnosticBundleSchema = z.discriminatedUnion('schemaVersion', [
  diagnosticBundleV1Schema,
  diagnosticBundleSchema,
]);

export function migrateDiagnosticsBundle(input: unknown): {
  readonly bundle: DiagnosticBundle;
  readonly sourceVersion: 1 | 2;
} {
  const parsed = cliDiagnosticBundleSchema.parse(input);
  if (parsed.schemaVersion === 2) {
    return { bundle: parsed, sourceVersion: 2 };
  }

  return {
    sourceVersion: 1,
    bundle: { ...parsed, schemaVersion: 2, map: null },
  };
}

export function summarizeDiagnostics(input: unknown): string {
  const { bundle, sourceVersion } = migrateDiagnosticsBundle(input);
  const failedChecks = bundle.healthChecks.filter((check) => check.status !== 'pass');
  const recentErrors = bundle.events
    .filter((event) => event.level === 'error')
    .slice(-5);
  const slowOperations = bundle.events.filter((event) => {
    const duration = event.data?.durationMs;
    return typeof duration === 'number' && duration >= 1_000;
  });
  const lines = [
    `Georgia Routing Planner diagnostics v2${sourceVersion === 1 ? ' (migrated from v1)' : ''}`,
    `Build: ${bundle.build.appVersion} (${bundle.build.commit}, ${bundle.build.mode})`,
    `Browser: ${bundle.runtime.userAgent}`,
    `Exported: ${bundle.exportedAt}`,
    `Health: ${String(failedChecks.length)} warning/failure(s) of ${String(bundle.healthChecks.length)}`,
  ];

  for (const check of failedChecks) {
    lines.push(`- ${check.status.toUpperCase()} ${check.name}: ${check.summary}`);
  }

  if (bundle.map === null) {
    lines.push('Map: not captured in this bundle.');
  } else {
    lines.push(
      `Map: ${bundle.map.lifecycle}, ${bundle.map.terrainMode}, ${String(bundle.map.recoverableFailures.length)} recoverable failure category(s)`,
    );
    lines.push(
      `Map style: ${bundle.map.styleId}; ${String(bundle.map.sourceIds.length)} source(s), ${String(bundle.map.layerIds.length)} layer(s)`,
    );
  }

  lines.push(`Recent errors: ${String(recentErrors.length)}`);
  for (const event of recentErrors) {
    lines.push(`- ${event.name}: ${event.message ?? 'No safe message recorded.'}`);
  }

  lines.push(`Slow operations: ${String(slowOperations.length)}`);
  lines.push(
    failedChecks.length > 0 || recentErrors.length > 0
      ? 'Next: investigate failed health checks and the newest error events.'
      : 'Next: no immediate map-foundation failure is visible.',
  );

  return `${lines.join('\n')}\n`;
}
