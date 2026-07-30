import { describe, expect, it } from 'vitest';

import { formatDateTime } from '@/presentation/formatDateTime';

describe('date presentation formatters', () => {
  it('renders dates and times with fixed day-first numeric separators', () => {
    const value = new Date('2020-01-31T21:26:21.000Z');
    expect(formatDateTime(value, 'UTC')).toBe('31.01.2020 21:26:21');
  });

  it('uses the requested time zone before formatting date parts', () => {
    const value = new Date('2020-01-31T21:26:21.000Z');

    expect(formatDateTime(value, 'Asia/Tbilisi')).toBe('01.02.2020 01:26:21');
  });
});
