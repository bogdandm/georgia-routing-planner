import { describe, expect, it } from 'vitest';

import { parseKml } from '@/domain/tracks/kml';

describe('parseKml', () => {
  it('keeps LineString and gx:Track geometry as independent segments', () => {
    const parsed = parseKml(`<?xml version="1.0"?>
      <kml xmlns="http://www.opengis.net/kml/2.2"
           xmlns:gx="http://www.google.com/kml/ext/2.2">
        <Document>
          <name>Georgia lines</name>
          <Placemark>
            <description><![CDATA[Walk <b>north</b>]]></description>
            <LineString><coordinates>44,42,100 44.01,42.01,110</coordinates></LineString>
          </Placemark>
          <Placemark><gx:Track>
            <when>2026-07-01T10:00:00Z</when><when>2026-07-01T10:01:00Z</when>
            <gx:coord>45 41 200</gx:coord><gx:coord>45.01 41.01 210</gx:coord>
          </gx:Track></Placemark>
        </Document>
      </kml>`);

    expect(parsed.segments).toHaveLength(2);
    expect(parsed.pointCount).toBe(4);
    expect(parsed.metadata).toMatchObject({
      selectedName: 'Georgia lines',
      selectedDescription: 'Walk north',
    });
    expect(parsed.segments[1]?.points[0]).toMatchObject({
      coordinate: [45, 41],
      recordedAt: '2026-07-01T10:00:00.000Z',
    });
  });

  it('rejects point-only and unsafe documents', () => {
    expect(() =>
      parseKml(
        '<kml><Placemark><Point><coordinates>44,42</coordinates></Point></Placemark></kml>',
      ),
    ).toThrow('no renderable line');
    expect(() => parseKml('<!DOCTYPE kml><kml/>')).toThrow(
      'DTD and entity declarations',
    );
  });
});
