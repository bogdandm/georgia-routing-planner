import { describe, expect, it, vi } from 'vitest';

import { loadSupabaseConfiguration } from '@/bootstrap/configuration/SupabaseConfiguration';

describe('Supabase configuration', () => {
  it('accepts a valid public URL and publishable key', () => {
    expect(
      loadSupabaseConfiguration('https://project.supabase.co', 'publishable-key'),
    ).toEqual({
      status: 'configured',
      value: {
        publishableKey: 'publishable-key',
        url: 'https://project.supabase.co',
      },
    });
  });

  it.each([
    [undefined, 'publishable-key'],
    ['https://project.supabase.co', undefined],
    ['http://project.supabase.co', 'publishable-key'],
  ])('fails closed for missing or invalid public settings', (url, key) => {
    expect(loadSupabaseConfiguration(url, key)).toEqual({ status: 'unconfigured' });
  });

  it('does not log public configuration values when validation fails', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const key = 'publishable-key-that-must-not-be-logged';

    expect(loadSupabaseConfiguration('not-a-url', key)).toEqual({
      status: 'unconfigured',
    });
    expect(error).not.toHaveBeenCalled();
  });
});
