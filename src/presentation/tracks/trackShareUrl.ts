const sharePrefix = '#tracks/share/';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const staleMapParameters = [
  'map',
  'lat',
  'lon',
  'z',
  'zoom',
  'scene',
  'view',
  'bearing',
  'pitch',
] as const;

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

export function createTrackShareUrl(currentUrl: string, token: string): string {
  if (!tokenPattern.test(token)) throw new Error('Track share token is invalid.');
  const url = new URL(currentUrl);
  for (const parameter of staleMapParameters) url.searchParams.delete(parameter);
  url.hash = `tracks/share/1.${token}`;
  return url.toString();
}
