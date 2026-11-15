import { describe, expect, it } from 'vitest';

import {
  createShadeLookupTable,
  expandShadeMask,
} from '@/infrastructure/terrainShadow/terrainShadowShaders';
import { terrainShadowTileSize } from '@/infrastructure/terrainShadow/terrainShadowTiles';

const shadowColor = [27, 36, 51] as const;
const highlightColor = [255, 247, 230] as const;

function entryBytes(table: Uint32Array, value: number): number[] {
  return [...new Uint8Array(table.buffer, value * 4, 4)];
}

describe('createShadeLookupTable', () => {
  const table = createShadeLookupTable(shadowColor, highlightColor, 0.6);

  it('leaves flat ground in full sun transparent', () => {
    expect(entryBytes(table, 127)[3]).toBe(0);
  });

  it('draws fully shadowed pixels in the opaque shadow color', () => {
    expect(entryBytes(table, 0)).toEqual([...shadowColor, 255]);
  });

  it('caps the brightest highlight at the highlight opacity', () => {
    expect(entryBytes(table, 254)).toEqual([...highlightColor, Math.round(0.6 * 255)]);
  });

  it('fades highlights in proportionally above full-sun flat ground', () => {
    expect(entryBytes(table, 190)).toEqual([
      ...highlightColor,
      Math.round(Math.min(190 / 127 - 1, 1) * 0.6 * 255),
    ]);
  });
});

describe('expandShadeMask', () => {
  it('writes each mask pixel as r, g, b, a bytes at its own offset', () => {
    const table = createShadeLookupTable(shadowColor, highlightColor, 0.6);
    const mask = new Uint8Array(terrainShadowTileSize * terrainShadowTileSize).fill(
      127,
    );
    mask[1] = 0;
    mask[2] = 254;

    const pixels = expandShadeMask(mask, table);

    expect(pixels).toHaveLength(mask.length * 4);
    expect([...pixels.subarray(0, 12)]).toEqual([
      ...entryBytes(table, 127),
      ...shadowColor,
      255,
      ...highlightColor,
      Math.round(0.6 * 255),
    ]);
  });
});
