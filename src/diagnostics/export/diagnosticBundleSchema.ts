import { z } from 'zod';

export const diagnosticFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const diagnosticEventSchema = z
  .object({
    id: z.string(),
    timestamp: z.iso.datetime(),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    name: z.string(),
    message: z.string().optional(),
    data: z.record(z.string(), diagnosticFieldValueSchema).optional(),
  })
  .strict();

export const healthCheckSchema = z
  .object({
    name: z.string(),
    status: z.enum(['pass', 'warn', 'fail']),
    durationMs: z.number().nonnegative(),
    summary: z.string(),
    remediation: z.string().optional(),
  })
  .strict();

export const diagnosticBundleSchema = z
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
    healthChecks: z.array(healthCheckSchema),
    events: z.array(diagnosticEventSchema),
  })
  .strict();

export type DiagnosticBundle = z.infer<typeof diagnosticBundleSchema>;
export type HealthCheckResult = z.infer<typeof healthCheckSchema>;
