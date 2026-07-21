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

const buildSchema = z
  .object({
    appVersion: z.string(),
    commit: z.string(),
    timestamp: z.string(),
    mode: z.string(),
  })
  .strict();

const runtimeSchema = z
  .object({
    userAgent: z.string(),
    language: z.string(),
    online: z.boolean(),
  })
  .strict();

const commonBundleShape = {
  exportedAt: z.iso.datetime(),
  build: buildSchema,
  runtime: runtimeSchema,
  reproductionNotes: z.string(),
  healthChecks: z.array(healthCheckSchema),
  events: z.array(diagnosticEventSchema),
};

export const diagnosticBundleV1Schema = z
  .object({ schemaVersion: z.literal(1), ...commonBundleShape })
  .strict();

const mapDiagnosticSnapshotV2Schema = z
  .object({
    lifecycle: z.enum(['loading', 'ready', 'degraded', 'fatal']),
    camera: z
      .object({
        longitude: z.number().min(-180).max(180),
        latitude: z.number().min(-85).max(85),
        zoom: z.number(),
        bearing: z.number(),
        pitch: z.number(),
      })
      .strict(),
    terrainMode: z.enum(['flat', 'terrain']),
    styleId: z.string(),
    sourceIds: z.array(z.string()),
    layerIds: z.array(z.string()),
    lastIdleAt: z.iso.datetime().nullable(),
    webGlContext: z.enum(['available', 'lost', 'restored', 'unknown']),
    webGlCapabilities: z
      .object({
        contextType: z.enum(['webgl2', 'webgl', 'unavailable', 'unknown']),
        version: z.string().nullable(),
        maxTextureSize: z.number().nullable(),
        antialias: z.boolean().nullable(),
      })
      .strict(),
    recoverableFailures: z.array(
      z
        .object({
          category: z.enum([
            'base-vector',
            'glyph-sprite',
            'terrain',
            'style',
            'webgl',
            'unknown',
          ]),
          sourceId: z.string().nullable(),
          count: z.number().int().nonnegative(),
          lastOccurredAt: z.iso.datetime(),
        })
        .strict(),
    ),
    message: z.string().nullable(),
  })
  .strict();

export const diagnosticBundleV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...commonBundleShape,
    map: mapDiagnosticSnapshotV2Schema.nullable(),
  })
  .strict();

export const mapDiagnosticSnapshotSchema = mapDiagnosticSnapshotV2Schema.extend({
  recoverableFailures: z.array(
    z
      .object({
        category: z.enum([
          'base-vector',
          'glyph-sprite',
          'satellite-raster',
          'terrain',
          'style',
          'webgl',
          'unknown',
        ]),
        sourceId: z.string().nullable(),
        reason: z.enum([
          'http-client',
          'http-server',
          'network',
          'no-response',
          'rate-limit',
          'timeout',
          'unknown',
        ]),
        httpStatus: z.number().int().min(100).max(599).nullable(),
        count: z.number().int().nonnegative(),
        lastOccurredAt: z.iso.datetime(),
        recoveryState: z.enum([
          'alternative-provider',
          'exhausted',
          'not-applicable',
          'not-retryable',
          'recovered',
          'scheduled',
        ]),
        retryAttempt: z.number().int().nonnegative(),
      })
      .strict(),
  ),
});

export const diagnosticBundleSchema = z
  .object({
    schemaVersion: z.literal(3),
    ...commonBundleShape,
    map: mapDiagnosticSnapshotSchema.nullable(),
  })
  .strict();

export type DiagnosticBundleV1 = z.infer<typeof diagnosticBundleV1Schema>;
export type DiagnosticBundleV2 = z.infer<typeof diagnosticBundleV2Schema>;
export type DiagnosticBundle = z.infer<typeof diagnosticBundleSchema>;
export type HealthCheckResult = z.infer<typeof healthCheckSchema>;
