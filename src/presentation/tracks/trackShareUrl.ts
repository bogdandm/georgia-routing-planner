const sharePrefix = '#tracks/share/';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function parseTrackShareLocation(
  hash: string,
):
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'shared'; readonly token: string } {
  if (!hash.toLowerCase().startsWith(sharePrefix)) return { kind: 'none' };
  if (!hash.startsWith(sharePrefix)) return { kind: 'invalid' };
  const value = hash.slice(sharePrefix.length);
  const [version, token, extra] = value.split('.');
  if (
    version !== '1' ||
    token === undefined ||
    extra !== undefined ||
    !tokenPattern.test(token)
  ) {
    return { kind: 'invalid' };
  }
  return { kind: 'shared', token };
}

/**
 * Adds a track capability to a map share link. The recipient's map starts with the
 * link's view, layer, and 2D/3D mode, then fits to the track once it loads.
 */
export function createTrackShareUrl(mapShareUrl: string, token: string): string {
  if (!tokenPattern.test(token)) throw new Error('Track share token is invalid.');
  const url = new URL(mapShareUrl);
  url.hash = `tracks/share/1.${token}`;
  return url.toString();
}
