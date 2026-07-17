import { z } from 'zod';

const fieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const cliDiagnosticBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    exportedAt: z.iso.datetime(),
    build: z
      .object({
        appVersion: z.string(),
        commit: z.string(),
        timestamp: z.string(),
        mode: z.string(),
      })
      .strict(),
    runtime: z
      .object({
        userAgent: z.string(),
        language: z.string(),
        online: z.boolean(),
      })
      .strict(),
    reproductionNotes: z.string(),
    healthChecks: z.array(
      z
        .object({
          name: z.string(),
          status: z.enum(['pass', 'warn', 'fail']),
          durationMs: z.number().nonnegative(),
          summary: z.string(),
          remediation: z.string().optional(),
        })
        .strict(),
    ),
    events: z.array(
      z
        .object({
          id: z.string(),
          timestamp: z.iso.datetime(),
          level: z.enum(['debug', 'info', 'warn', 'error']),
          name: z.string(),
          message: z.string().optional(),
          data: z.record(z.string(), fieldValueSchema).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export function summarizeDiagnostics(input: unknown): string {
  const bundle = cliDiagnosticBundleSchema.parse(input);
  const failedChecks = bundle.healthChecks.filter((check) => check.status !== 'pass');
  const recentErrors = bundle.events
    .filter((event) => event.level === 'error')
    .slice(-5);
  const slowOperations = bundle.events.filter((event) => {
    const duration = event.data?.durationMs;
    return typeof duration === 'number' && duration >= 1_000;
  });
  const lines = [
    'Georgia Routing Planner diagnostics v1',
    `Build: ${bundle.build.appVersion} (${bundle.build.commit}, ${bundle.build.mode})`,
    `Browser: ${bundle.runtime.userAgent}`,
    `Exported: ${bundle.exportedAt}`,
    `Health: ${String(failedChecks.length)} warning/failure(s) of ${String(bundle.healthChecks.length)}`,
  ];

  for (const check of failedChecks) {
    lines.push(`- ${check.status.toUpperCase()} ${check.name}: ${check.summary}`);
  }

  lines.push(`Recent errors: ${String(recentErrors.length)}`);
  for (const event of recentErrors) {
    lines.push(`- ${event.name}: ${event.message ?? 'No safe message recorded.'}`);
  }

  lines.push(`Slow operations: ${String(slowOperations.length)}`);
  lines.push(
    failedChecks.length > 0 || recentErrors.length > 0
      ? 'Next: investigate failed health checks and the newest error events.'
      : 'Next: no immediate Phase 0 infrastructure failure is visible.',
  );

  return `${lines.join('\n')}\n`;
}
