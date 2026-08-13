import {
  SHARE_TOKEN_PATTERN,
  TOKEN_NONCE_PATTERN,
  TrackShareFailure,
} from './contracts.ts';

let signingKey: Promise<CryptoKey> | undefined;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!SHARE_TOKEN_PATTERN.test(value)) {
    throw new TrackShareFailure(400, 'invalid_token', 'Share token is invalid.');
  }
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '=');
  if (binary.length !== 32) {
    throw new TrackShareFailure(400, 'invalid_token', 'Share token is invalid.');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function configuredSigningKey(): Promise<CryptoKey> {
  if (signingKey !== undefined) return signingKey;
  signingKey = (async () => {
    const secret = Deno.env.get('TRACK_SHARE_TOKEN_SECRET');
    if (secret === undefined || !TOKEN_NONCE_PATTERN.test(secret)) {
      throw new TrackShareFailure(
        500,
        'share_configuration_error',
        'Track sharing is not configured.',
      );
    }
    const bytes = base64UrlToBytes(secret);
    return await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(bytes),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  })();
  return signingKey;
}

export function createTokenNonce(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function tokenDigest(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function deriveShareToken(
  userId: string,
  nonce: string,
): Promise<{ readonly token: string; readonly digest: string }> {
  if (!TOKEN_NONCE_PATTERN.test(nonce)) {
    throw new TrackShareFailure(
      500,
      'share_integrity_error',
      'Track share is invalid.',
    );
  }
  const signed = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      await configuredSigningKey(),
      new TextEncoder().encode(`v1\0${userId}\0${nonce}`),
    ),
  );
  return { token: bytesToBase64Url(signed), digest: await tokenDigest(signed) };
}
