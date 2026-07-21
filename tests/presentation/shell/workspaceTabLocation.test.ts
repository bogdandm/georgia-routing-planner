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
});
