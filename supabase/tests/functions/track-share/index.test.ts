import { assertEquals, assertMatch } from 'jsr:@std/assert@1.0.14';
import type { SupabaseContext } from 'npm:@supabase/server@1.4.1';

import {
  base64UrlToBytes,
  deriveShareToken,
  tokenDigest,
} from '../../../functions/track-share/internal/share-token.ts';
import { handleTrackShare } from '../../../functions/track-share/track-share.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

Deno.test('derives a stable token and digest from owner and nonce', async () => {
  Deno.env.set('TRACK_SHARE_TOKEN_SECRET', SECRET);
  const nonce = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const first = await deriveShareToken(USER_ID, nonce);
  const second = await deriveShareToken(USER_ID, nonce);
  assertEquals(first, second);
  assertMatch(first.token, /^[A-Za-z0-9_-]{43}$/);
  assertEquals(first.digest, await tokenDigest(base64UrlToBytes(first.token)));
});

Deno.test('converges unknown public capabilities without storage access', async () => {
  let storageCalled = false;
  const context = {
    supabaseAdmin: {
      rpc: async () => ({ data: null, error: null }),
      storage: {
        from: () => ({
          download: async () => {
            storageCalled = true;
            return { data: null, error: { message: 'unexpected' } };
          },
        }),
      },
    },
  } as unknown as SupabaseContext;
  const response = await handleTrackShare(
    new Request('https://example.test/functions/v1/track-share', {
      headers: {
        accept: 'application/json',
        'x-track-share-token': 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      },
    }),
    context,
  );
  assertEquals(response.status, 404);
  assertEquals(storageCalled, false);
  assertEquals(await response.json(), {
    error: { code: 'share_not_found', message: 'Shared track was not found.' },
  });
});
