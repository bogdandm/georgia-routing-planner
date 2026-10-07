import { describe, expect, it } from 'vitest';

import {
  predictSentinelAcquisitionDates,
  type SentinelAcquisition,
} from '@/domain/satellite/predictSentinelAcquisitionDates';

function acquisitions(
  platform: string,
  dates: readonly string[],
): SentinelAcquisition[] {
  return dates.map((date) => ({ date, platform }));
}

function predict(observed: readonly SentinelAcquisition[], today: string): string[] {
  return [...predictSentinelAcquisitionDates(observed, today)].toSorted();
}

describe('predictSentinelAcquisitionDates', () => {
  it('repeats a 2-2-1-2-3 day pattern every 10 days through 30 days after today', () => {
    const observed = [
      ...acquisitions('sentinel-2a', [
        '2026-09-02',
        '2026-09-07',
        '2026-09-12',
        '2026-09-17',
      ]),
      ...acquisitions('sentinel-2b', ['2026-09-04', '2026-09-10', '2026-09-14']),
      ...acquisitions('sentinel-2c', ['2026-09-05', '2026-09-15']),
    ];

    expect(predict(observed, '2026-09-18')).toEqual([
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

  it('repeats an every-other-cycle satellite every 20 days', () => {
    const observed = [
      ...acquisitions('sentinel-2b', ['2026-09-01', '2026-09-11', '2026-09-21']),
      ...acquisitions('sentinel-2a', ['2026-09-05', '2026-09-25']),
    ];

    expect(predict(observed, '2026-09-26')).toEqual([
      '2026-10-01',
      '2026-10-11',
      '2026-10-15',
      '2026-10-21',
    ]);
  });

  it('treats a satellite seen once as every-other-cycle when its neighbouring cycle was loaded', () => {
    const observed = [
      ...acquisitions('sentinel-2b', ['2026-09-01', '2026-09-11', '2026-09-21']),
      ...acquisitions('sentinel-2a', ['2026-09-03']),
    ];

    expect(predict(observed, '2026-09-22')).toEqual([
      '2026-09-23',
      '2026-10-01',
      '2026-10-11',
      '2026-10-13',
      '2026-10-21',
    ]);
  });

  it('keeps a 10-day cadence across one missing acquisition and predicts unprocessed past days', () => {
    const observed = [
      ...acquisitions('sentinel-2b', ['2026-08-22', '2026-09-01', '2026-09-21']),
      ...acquisitions('sentinel-2c', [
        '2026-08-27',
        '2026-09-06',
        '2026-09-16',
        '2026-09-26',
      ]),
    ];

    expect(predict(observed, '2026-10-03')).toEqual([
      '2026-10-01',
      '2026-10-06',
      '2026-10-11',
      '2026-10-16',
      '2026-10-21',
      '2026-10-26',
      '2026-10-31',
    ]);
  });

  it('ignores satellites last seen more than 60 days before the latest acquisition', () => {
    const observed = [
      ...acquisitions('sentinel-2a', ['2026-07-25']),
      ...acquisitions('sentinel-2b', [
        '2026-07-31',
        '2026-08-10',
        '2026-08-20',
        '2026-08-30',
        '2026-09-09',
        '2026-09-19',
        '2026-09-29',
      ]),
    ];

    expect(predict(observed, '2026-10-01')).toEqual([
      '2026-10-09',
      '2026-10-19',
      '2026-10-29',
    ]);
  });

  it('ignores history before an unloaded month', () => {
    const observed = [
      ...acquisitions('sentinel-2b', [
        '2026-08-01',
        '2026-08-11',
        '2026-08-21',
        '2026-08-31',
        '2026-10-01',
      ]),
      ...acquisitions('sentinel-2c', ['2026-10-05']),
    ];

    expect(predict(observed, '2026-10-07')).toEqual([]);
  });

  it('predicts nothing before one full cycle of history is loaded', () => {
    const observed = acquisitions('sentinel-2b', [
      '2026-10-02',
      '2026-10-04',
      '2026-10-05',
      '2026-10-07',
    ]);

    expect(predict(observed, '2026-10-08')).toEqual([]);
  });

  it('predicts nothing when only historical months are loaded', () => {
    const observed = acquisitions('sentinel-2b', [
      '2024-05-02',
      '2024-05-12',
      '2024-05-22',
    ]);

    expect(predict(observed, '2026-10-08')).toEqual([]);
    expect(predict([], '2026-10-08')).toEqual([]);
  });
});
