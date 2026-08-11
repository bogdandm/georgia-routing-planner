import { describe, expect, it } from 'vitest';

import {
  createTrackShareUrl,
  parseTrackShareLocation,
} from '@/presentation/tracks/trackShareUrl';

const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('track share URLs', () => {
  it('round-trips the canonical fragment', () => {
    const url = createTrackShareUrl(
      'https://example.test/planner/?developer=1&lat=42&zoom=10#satellite',
      token,
    );
    expect(url).toBe(
      `https://example.test/planner/?developer=1#tracks/share/1.${token}`,
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
