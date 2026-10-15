import { describe, expect, it } from 'vitest';

import { createBasemapImage } from '@/presentation/map/basemapSymbols';
import { basemapImageIds } from '@/presentation/map/mapIds';

describe('createBasemapImage', () => {
  it('draws GOST cliff teeth only on the downhill side of the cliff line', async () => {
    // MapLibre maps the top pattern rows to the right of the way, which OSM reserves
    // for the lower side of a cliff.
    const basemapImage = await createBasemapImage(basemapImageIds.cliffPattern);
    const image = basemapImage?.image;
    if (image === undefined || !('data' in image))
      throw new Error('Expected a raw pattern.');

    const alpha = (row: number, column: number) =>
      image.data[(row * image.width + column) * 4 + 3] ?? 0;
    const columns = Array.from({ length: image.width }, (_, column) => column);
    const rows = Array.from({ length: image.height }, (_, row) => row);
    // The cliff line itself is the only ink that spans the whole pattern width.
    const lineRows = rows.filter((row) =>
      columns.every((column) => alpha(row, column) > 0),
    );
    const lineTop = Math.min(...lineRows);
    const lineBottom = Math.max(...lineRows);
    const hasInk = (row: number) => columns.some((column) => alpha(row, column) > 0);

    expect(lineRows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row < lineTop).some(hasInk)).toBe(true);
    expect(rows.filter((row) => row > lineBottom).some(hasInk)).toBe(false);
  });
});
