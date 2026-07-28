import { Encoder, Profile } from '@garmin/fitsdk';
import type { FileIdMesg, RecordMesg } from '@garmin/fitsdk';
import { describe, expect, it } from 'vitest';

import { parseFit } from '@/domain/tracks/fit';

const degreesToSemicircles = 2 ** 31 / 180;

function activityFit(): ArrayBuffer {
  const encoder = new Encoder();
  const fileIdMesgNum = Profile.MesgNum.FILE_ID;
  const recordMesgNum = Profile.MesgNum.RECORD;
  if (fileIdMesgNum === undefined || recordMesgNum === undefined) {
    throw new Error('The FIT profile is missing required message identifiers.');
  }
  const fileId: FileIdMesg = {
    type: 'activity',
    manufacturer: 'development',
    product: 1,
    timeCreated: new Date('2026-07-01T10:00:00Z'),
  };
  encoder.onMesg(fileIdMesgNum, fileId);
  const coordinates = [
    [44, 42],
    [44.01, 42.01],
  ] as const;
  for (const [index, [longitude, latitude]] of coordinates.entries()) {
    const record: RecordMesg = {
      timestamp: new Date(1_751_364_000_000 + index * 60_000),
      positionLong: Math.round(longitude * degreesToSemicircles),
      positionLat: Math.round(latitude * degreesToSemicircles),
      enhancedAltitude: 1_000 + index * 10,
    };
    encoder.onMesg(recordMesgNum, record);
  }
  const bytes = encoder.close();
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

describe('parseFit', () => {
  it('validates and decodes geographic records without sensor data', () => {
    const parsed = parseFit(activityFit());

    expect(parsed.pointCount).toBe(2);
    expect(parsed.segments[0]?.points[0]).toMatchObject({
      elevationMeters: 1_000,
      recordedAt: '2025-07-01T10:00:00.000Z',
    });
    expect(parsed.segments[0]?.points[0]?.coordinate[0]).toBeCloseTo(44, 5);
  });

  it('rejects corrupt input', () => {
    expect(() => parseFit(new Uint8Array([1, 2, 3]).buffer)).toThrow('integrity check');
  });
});
