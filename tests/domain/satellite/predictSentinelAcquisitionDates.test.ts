import { describe, expect, it } from 'vitest';

import { predictSentinelAcquisitionDates } from '@/domain/satellite/predictSentinelAcquisitionDates';

describe('predictSentinelAcquisitionDates', () => {
  it('repeats a 2-2-1-2-3 day pattern every 10 days through 30 days after today', () => {
    const observed = [
      '2026-09-02',
      '2026-09-04',
      '2026-09-05',
      '2026-09-07',
      '2026-09-10',
      '2026-09-12',
      '2026-09-14',
      '2026-09-15',
      '2026-09-17',
    ];

    expect([...predictSentinelAcquisitionDates(observed, '2026-09-18')]).toEqual([
      '2026-09-20',
      '2026-09-22',
      '2026-09-24',
      '2026-09-25',
      '2026-09-27',
      '2026-09-30',
      '2026-10-02',
      '2026-10-04',
      '2026-10-05',
      '2026-10-07',
      '2026-10-10',
      '2026-10-12',
      '2026-10-14',
      '2026-10-15',
      '2026-10-17',
    ]);
  });

  it('keeps a repeating day missing from the latest cycle and predicts unprocessed past days', () => {
    // 5-2-3 pattern; 2026-09-30 is missing and 2026-10-05 is not processed yet.
    const observed = [
      '2026-09-15',
      '2026-09-20',
      '2026-09-22',
      '2026-09-25',
      '2026-10-02',
    ];

    expect([...predictSentinelAcquisitionDates(observed, '2026-10-08')]).toEqual([
      '2026-10-05',
      '2026-10-10',
      '2026-10-12',
      '2026-10-15',
      '2026-10-20',
      '2026-10-22',
      '2026-10-25',
      '2026-10-30',
      '2026-11-01',
      '2026-11-04',
    ]);
  });

  it('ignores repeating days that disappeared more than three cycles ago', () => {
    const observed = ['2026-08-03', '2026-09-10', '2026-09-20', '2026-09-30'];

    expect([...predictSentinelAcquisitionDates(observed, '2026-10-01')]).toEqual([
      '2026-10-10',
      '2026-10-20',
      '2026-10-30',
    ]);
  });

  it('predicts nothing before one full cycle of history is loaded', () => {
    const observed = ['2026-10-02', '2026-10-04', '2026-10-05', '2026-10-07'];

    expect(predictSentinelAcquisitionDates(observed, '2026-10-08').size).toBe(0);
  });

  it('predicts nothing when only historical months are loaded', () => {
    const observed = ['2024-05-02', '2024-05-12', '2024-05-22'];

    expect(predictSentinelAcquisitionDates(observed, '2026-10-08').size).toBe(0);
    expect(predictSentinelAcquisitionDates([], '2026-10-08').size).toBe(0);
  });
});
