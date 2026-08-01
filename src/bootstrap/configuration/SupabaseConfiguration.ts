import { z } from 'zod';

const supabaseConfigurationSchema = z.object({
  publishableKey: z.string().trim().min(1),
  url: z.url().startsWith('https://'),
});

export type SupabaseConfiguration = z.infer<typeof supabaseConfigurationSchema>;

export type SupabaseConfigurationResult =
  | { readonly status: 'configured'; readonly value: SupabaseConfiguration }
  | { readonly status: 'unconfigured' };

/**
 * Validates the public build-time Supabase settings without exposing their values.
 * Missing or invalid configuration keeps the application fully local-first.
 */
export function loadSupabaseConfiguration(
  url: string | undefined,
  publishableKey: string | undefined,
): SupabaseConfigurationResult {
  const parsed = supabaseConfigurationSchema.safeParse({ publishableKey, url });
  return parsed.success
    ? { status: 'configured', value: parsed.data }
    : { status: 'unconfigured' };
}
