import type { KyInstance } from 'ky';
import { z } from 'zod';

const requiredWeatherMapVariables = [
  'cloud_cover',
  'precipitation',
  'wind_u_component_10m',
] as const;

const spatialMetadataSchema = z
  .object({
    completed: z.literal(true),
    reference_time: z.iso.datetime({ offset: true }),
    valid_times: z.array(z.iso.datetime({ offset: true })).min(1),
    variables: z.array(z.string()),
  })
  .loose()
  .superRefine((metadata, context) => {
    for (const variable of requiredWeatherMapVariables) {
      if (!metadata.variables.includes(variable)) {
        context.addIssue({
          code: 'custom',
          message: `Open-Meteo spatial metadata is missing ${variable}.`,
          path: ['variables'],
        });
      }
    }
  });

export interface OpenMeteoSpatialMetadata {
  readonly referenceTime: string;
  readonly validTimes: readonly string[];
}

export async function loadOpenMeteoSpatialMetadata(
  httpClient: KyInstance,
  metadataUrl: string,
  requestTimeoutMs: number,
  signal: AbortSignal,
): Promise<OpenMeteoSpatialMetadata> {
  const raw = await httpClient
    .get(metadataUrl, {
      cache: 'no-store',
      retry: 0,
      signal,
      timeout: requestTimeoutMs,
    })
    .json<unknown>();
  const metadata = spatialMetadataSchema.parse(raw);
  return {
    referenceTime: metadata.reference_time,
    validTimes: metadata.valid_times,
  };
}
