import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TrackShareError } from '@/application/tracks/TrackShareService';
import { SupabaseTrackShareService } from '@/infrastructure/supabase/SupabaseTrackShareService';

const contentHash = 'a'.repeat(64);
const accessToken = 'owner-access-token';

afterEach(() => {
  vi.unstubAllGlobals();
});

function serviceFor(session: { readonly access_token: string } | null) {
  return new SupabaseTrackShareService(
    {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session } }) },
    } as never,
    'https://project.example.test',
    'publishable-key',
  );
}

describe('SupabaseTrackShareService', () => {
  it('uses an owner JWT only for owner commands', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ enabled: false }, { headers: { 'Cache-Control': 'no-store' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      serviceFor({ access_token: accessToken }).status(contentHash),
    ).resolves.toEqual({
      enabled: false,
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.headers).toMatchObject({
      authorization: `Bearer ${accessToken}`,
      apikey: 'publishable-key',
    });
  });

  it('requires an owner session before calling the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(serviceFor(null).enable(contentHash)).rejects.toMatchObject({
      category: 'auth-required',
    } satisfies Partial<TrackShareError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an unavailable capability to share-not-found', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      serviceFor({ access_token: accessToken }).resolve('A'.repeat(43)),
    ).rejects.toMatchObject({
      category: 'share-not-found',
    } satisfies Partial<TrackShareError>);
    const [, metadataRequest] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(metadataRequest.headers).toMatchObject({
      apikey: 'publishable-key',
      'x-track-share-token': 'A'.repeat(43),
    });
    expect(metadataRequest.headers).not.toHaveProperty('authorization');
  });
});
