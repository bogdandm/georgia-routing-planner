import { z } from 'zod';

const positionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const linearRingSchema = z
  .array(positionSchema)
  .min(4)
  .refine((ring) => {
    const first = ring[0];
    const last = ring.at(-1);
    return first?.[0] === last?.[0] && first?.[1] === last?.[1];
  }, 'Polygon rings must be closed.');

const earthSearchGeometrySchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('Polygon'),
      coordinates: z.array(linearRingSchema).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('MultiPolygon'),
      coordinates: z.array(z.array(linearRingSchema).min(1)).min(1),
    })
    .strict(),
]);

const assetSchema = z
  .object({
    href: z.string().trim().min(1),
    type: z.string().trim().min(1).optional(),
    roles: z.array(z.string()).optional(),
  })
  .loose();

const linkSchema = z
  .object({
    rel: z.string().trim().min(1),
    href: z.string().trim().min(1),
    method: z.string().trim().optional(),
    body: z.unknown().optional(),
    merge: z.boolean().optional(),
  })
  .loose();

export const earthSearchItemSchema = z
  .object({
    type: z.literal('Feature'),
    id: z.string().trim().min(1).max(300),
    collection: z.string().trim().min(1).max(100),
    geometry: earthSearchGeometrySchema,
    properties: z
      .object({
        datetime: z.iso.datetime({ offset: true }),
        platform: z.string().trim().min(1).max(80),
        'eo:cloud_cover': z.number().min(0).max(100),
        'proj:epsg': z.number().int().positive(),
        'grid:code': z.string().trim().min(1).max(100).optional(),
        's2:tile_id': z.string().trim().min(1).max(300).optional(),
        's2:product_type': z.string().trim().min(1).max(80).optional(),
        's2:product_uri': z.string().trim().min(1).max(500).optional(),
        'sat:relative_orbit': z.number().int().positive().max(999).optional(),
      })
      .loose(),
    assets: z.record(z.string(), assetSchema),
    links: z.array(linkSchema).default([]),
  })
  .loose();

const contextSchema = z
  .object({
    matched: z.number().int().nonnegative().optional(),
    returned: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
  })
  .loose();

export const earthSearchFeatureCollectionSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(earthSearchItemSchema),
    links: z.array(linkSchema).default([]),
    context: contextSchema.optional(),
    numberMatched: z.number().int().nonnegative().optional(),
    numberReturned: z.number().int().nonnegative().optional(),
  })
  .loose();

export const earthSearchPaginationEnvelopeSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(z.unknown()),
    links: z.array(linkSchema).default([]),
    context: contextSchema.optional(),
    numberMatched: z.number().int().nonnegative().optional(),
    numberReturned: z.number().int().nonnegative().optional(),
  })
  .loose();

export const earthSearchNextBodySchema = z
  .object({ next: z.string().trim().min(1).max(2_000) })
  // Earth Search repeats the original search fields beside the opaque token.
  // Only `next` is consumed; the gateway rebuilds every subsequent request.
  .loose();

type EarthSearchFeatureCollection = z.infer<typeof earthSearchFeatureCollectionSchema>;
export type EarthSearchItem = EarthSearchFeatureCollection['features'][number];
