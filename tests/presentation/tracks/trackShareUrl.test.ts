import { describe, expect, it } from 'vitest';

import {
  createTrackShareUrl,
  parseTrackShareLocation,
} from '@/presentation/tracks/trackShareUrl';

const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('track share URLs', () => {
  it('adds the capability fragment to a map link and round-trips it', () => {
    const url = createTrackShareUrl(
      'https://example.test/planner/?developer=1&map=2&lat=42&lon=44&z=10&view=3d&bearing=12&pitch=50&scene=sentinel-2-l2a:S2A#satellite',
      token,
    );
    expect(url).toBe(
      `https://example.test/planner/?developer=1&map=2&lat=42&lon=44&z=10&view=3d&bearing=12&pitch=50&scene=sentinel-2-l2a:S2A#tracks/share/1.${token}`,
    );
    expect(parseTrackShareLocation(new URL(url).hash)).toEqual({
      kind: 'shared',
      token,
    });
  });

  it('fails closed for malformed capability fragments', () => {
    expect(parseTrackShareLocation('#tracks/share/2.abc')).toEqual({ kind: 'invalid' });
    expect(parseTrackShareLocation('#tracks/share/1.invalid/extra')).toEqual({
      kind: 'invalid',
    });
    expect(parseTrackShareLocation(`#TRACKS/share/1.${token}`)).toEqual({
      kind: 'invalid',
    });
    expect(parseTrackShareLocation('#tracks')).toEqual({ kind: 'none' });
  });
});
