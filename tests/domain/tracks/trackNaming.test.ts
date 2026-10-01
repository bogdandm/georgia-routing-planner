import { describe, expect, it } from 'vitest';

import type { TrackCoordinate } from '@/domain/tracks/gpx';
import {
  classifyTrackNamingShape,
  composeTrackName,
  formatNamingLabel,
  romanizePlaceLabel,
} from '@/domain/tracks/trackNaming';

function line(
  from: TrackCoordinate,
  to: TrackCoordinate,
  steps: number,
): readonly TrackCoordinate[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const fraction = index / steps;
    return [
      from[0] + (to[0] - from[0]) * fraction,
      from[1] + (to[1] - from[1]) * fraction,
    ] as const;
  });
}

describe('romanizePlaceLabel', () => {
  it('romanizes Georgian without ejective apostrophes and title-cases each word', () => {
    expect(romanizePlaceLabel('ჭაუხი')).toBe('Chaukhi');
    expect(romanizePlaceLabel('ჭაუხის ორმაგი უღელტეხილი')).toBe(
      'Chaukhis Ormagi Ugheltekhili',
    );
    expect(romanizePlaceLabel('თაყაიშვილი')).toBe('Takaishvili');
    expect(romanizePlaceLabel('ყაზბეგი')).toBe('Kazbegi');
  });

  it('romanizes Georgian Mtavruli capitals like Mkhedruli', () => {
    // ᲛᲔᲡᲢᲘᲐ: Mtavruli capitals for მესტია.
    expect(romanizePlaceLabel('\u1C9B\u1C94\u1CA1\u1CA2\u1C98\u1C90')).toBe('Mestia');
  });

  it('romanizes Cyrillic with BGN/PCGN ye after vowels and at word starts', () => {
    expect(romanizePlaceLabel('Верхние ночевки')).toBe('Verkhniye nochevki');
    expect(romanizePlaceLabel('Ёлка')).toBe('Yelka');
    expect(romanizePlaceLabel('Щель')).toBe('Shchel');
  });

  it('keeps Latin labels and rejects labels with letters from other scripts', () => {
    expect(romanizePlaceLabel('Tsaishi (MG)')).toBe('Tsaishi (MG)');
    expect(romanizePlaceLabel('Ushbа')).toBe('Ushba');
    expect(romanizePlaceLabel('بحيرة')).toBeNull();
    expect(romanizePlaceLabel('Lake 湖')).toBeNull();
  });
});

describe('formatNamingLabel', () => {
  it('qualifies passes and peaks without duplicating existing wording', () => {
    expect(formatNamingLabel('Kelida', 'mountain_pass:yes')).toBe('Kelida Pass');
    expect(formatNamingLabel('ყელიდა', 'mountain_pass:yes')).toBe('Kelida Pass');
    expect(formatNamingLabel('Atsunta Pass', 'mountain_pass:yes')).toBe('Atsunta Pass');
    expect(formatNamingLabel('Chutkharo', 'natural:peak')).toBe('Mt. Chutkharo');
    expect(formatNamingLabel('Mount Kazbek', 'natural:peak')).toBe('Mount Kazbek');
    expect(formatNamingLabel('  Koruldi   Lakes ', 'natural:water')).toBe(
      'Koruldi Lakes',
    );
  });

  it('rejects empty, overlong, and non-romanizable labels', () => {
    expect(formatNamingLabel('   ', 'place:village')).toBeNull();
    expect(formatNamingLabel('x'.repeat(61), 'place:village')).toBeNull();
    expect(formatNamingLabel('x'.repeat(60), 'place:village')).toBe('x'.repeat(60));
    expect(formatNamingLabel('湖', 'natural:water')).toBeNull();
  });
});

describe('classifyTrackNamingShape', () => {
  it('treats an open track as one-way', () => {
    expect(classifyTrackNamingShape([line([44, 42], [44.05, 42], 20)])).toEqual({
      kind: 'one-way',
    });
  });

  it('classifies a closed track that retraces its outbound leg as out-and-back', () => {
    const outbound = line([44, 42], [44.02, 42], 40);
    const inbound = line([44.02, 42.0002], [44, 42.0002], 40);
    expect(classifyTrackNamingShape([[...outbound, ...inbound]])).toEqual({
      kind: 'out-and-back',
      farthestCoordinate: [44.02, 42.0002],
    });
  });

  it('classifies a closed circuit as a loop with its farthest corner as destination', () => {
    const circuit = [
      ...line([44, 42], [44.01, 42], 20),
      ...line([44.01, 42], [44.01, 42.01], 20),
      ...line([44.01, 42.01], [44, 42.01], 20),
      ...line([44, 42.01], [44, 42], 20),
    ];
    expect(classifyTrackNamingShape([circuit])).toEqual({
      kind: 'loop',
      farthestCoordinate: [44.01, 42.01],
    });
  });

  it('measures retracing by distance rather than recorded point density', () => {
    const outbound = line([44, 42], [44.12, 42], 200);
    // The long retrace is recorded with two points; a short final detour with 200.
    const sparseRetrace = line([44.12, 42.0002], [44.012, 42.0002], 2);
    const denseDetour = [
      ...line([44.012, 42.0002], [44.006, 42.006], 100),
      ...line([44.006, 42.006], [44, 42.0002], 100),
    ];
    expect(
      classifyTrackNamingShape([[...outbound, ...sparseRetrace, ...denseDetour]]).kind,
    ).toBe('out-and-back');
  });

  it('joins multiple segments into one journey', () => {
    const outbound = line([44, 42], [44.02, 42], 40);
    const inbound = line([44.02, 42.0002], [44, 42.0002], 40);
    expect(classifyTrackNamingShape([outbound, inbound]).kind).toBe('out-and-back');
  });
});

describe('composeTrackName', () => {
  it('names one-way tracks from start to finish via the landmark', () => {
    expect(
      composeTrackName({
        shape: 'one-way',
        start: 'Juta',
        end: 'Roshka',
        landmark: 'Chaukhi Pass',
      }),
    ).toBe('Juta → Roshka via Chaukhi Pass');
    expect(
      composeTrackName({ shape: 'one-way', start: 'Mestia', end: 'Zhabeshi' }),
    ).toBe('Mestia → Zhabeshi');
    expect(
      composeTrackName({ shape: 'one-way', start: 'Juta', landmark: 'Chaukhi Pass' }),
    ).toBe('Juta → Chaukhi Pass');
    expect(composeTrackName({ shape: 'one-way', end: 'Roshka' })).toBe('Roshka');
  });

  it('drops a landmark that repeats an endpoint', () => {
    expect(
      composeTrackName({
        shape: 'one-way',
        start: 'Mestia',
        end: 'Ushguli',
        landmark: 'mestia',
      }),
    ).toBe('Mestia → Ushguli');
  });

  it('names a one-way track ending in its starting settlement as out-and-back', () => {
    expect(
      composeTrackName({
        shape: 'one-way',
        start: 'Mestia',
        end: 'MESTIA',
        landmark: 'Koruldi Lakes',
      }),
    ).toBe('Koruldi Lakes from Mestia');
  });

  it('drops the optional qualifier when the name would become too long', () => {
    const start = 'A'.repeat(30);
    const end = 'B'.repeat(30);
    expect(
      composeTrackName({ shape: 'one-way', start, end, landmark: 'C'.repeat(30) }),
    ).toBe(`${start} → ${end}`);
    expect(
      composeTrackName({
        shape: 'loop',
        start: 'D'.repeat(60),
        landmark: 'Koruldi Lakes',
      }),
    ).toBe('Koruldi Lakes loop');
  });

  it('names loops and out-and-back tracks by destination and start', () => {
    expect(
      composeTrackName({ shape: 'loop', start: 'Mestia', landmark: 'Koruldi Lakes' }),
    ).toBe('Koruldi Lakes loop from Mestia');
    expect(composeTrackName({ shape: 'loop', landmark: 'Koruldi Lakes' })).toBe(
      'Koruldi Lakes loop',
    );
    expect(composeTrackName({ shape: 'loop', start: 'Mestia' })).toBe('Mestia loop');
    expect(
      composeTrackName({
        shape: 'out-and-back',
        start: 'Stepantsminda',
        landmark: 'Mt. Kazbek',
      }),
    ).toBe('Mt. Kazbek from Stepantsminda');
    expect(composeTrackName({ shape: 'out-and-back', landmark: 'Mt. Kazbek' })).toBe(
      'Mt. Kazbek',
    );
    expect(composeTrackName({ shape: 'out-and-back', start: 'Stepantsminda' })).toBe(
      'Stepantsminda',
    );
    expect(composeTrackName({ shape: 'loop' })).toBeNull();
    expect(composeTrackName({ shape: 'one-way' })).toBeNull();
  });
});
