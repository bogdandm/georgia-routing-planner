import { describe, expect, it } from 'vitest';

import {
  workspaceHashForTab,
  workspaceTabFromHash,
} from '@/presentation/shell/workspaceTabLocation';

describe('workspace tab location', () => {
  it('generates the correctly spelled Satellite anchor', () => {
    expect(workspaceHashForTab('satellite')).toBe('#satellite');
  });

  it('retains the previous misspelled Satellite anchor as an inbound alias', () => {
    expect(workspaceTabFromHash('#satelite')).toBe('satellite');
  });

  it('round-trips the User anchor', () => {
    expect(workspaceHashForTab('user')).toBe('#user');
    expect(workspaceTabFromHash('#USER')).toBe('user');
  });

  it('selects Tracks for valid and invalid share fragments', () => {
    expect(workspaceTabFromHash('#tracks/share/1.invalid')).toBe('tracks');
    expect(workspaceTabFromHash('#tracks/share/2.invalid')).toBe('tracks');
  });
});
