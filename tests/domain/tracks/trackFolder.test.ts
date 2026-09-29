import { describe, expect, it } from 'vitest';

import { normalizeTrackFolderName } from '@/domain/tracks/trackFolder';

describe('track folder rules shared with the sync server', () => {
  it('rejects names the server would refuse to synchronize', () => {
    expect(() => normalizeTrackFolderName('Bell\u0007')).toThrow(
      expect.objectContaining({ problem: 'invalid-character' }),
    );
    expect(() => normalizeTrackFolderName('İ'.repeat(200))).toThrow(
      expect.objectContaining({ problem: 'too-long' }),
    );
    expect(() => normalizeTrackFolderName('   ')).toThrow(
      expect.objectContaining({ problem: 'required' }),
    );
    expect(normalizeTrackFolderName('  Day hikes\tnorth ')).toEqual({
      name: 'Day hikes\tnorth',
      normalizedName: 'day hikes\tnorth',
    });
  });
});
