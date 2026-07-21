import { describe, expect, it } from 'vitest';

import { shouldAutoFillResults } from '@/presentation/satellite-browser/shouldAutoFillResults';

describe('shouldAutoFillResults', () => {
  it('requests more imagery while less than 85 percent of the pane is occupied', () => {
    expect(shouldAutoFillResults(849, 1_000)).toBe(true);
    expect(shouldAutoFillResults(850, 1_000)).toBe(false);
  });

  it('does not auto-load without measurable layout height', () => {
    expect(shouldAutoFillResults(0, 0)).toBe(false);
  });
});
