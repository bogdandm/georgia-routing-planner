import fordSvg from '@waysidemapping/pinhead/dist/icons/arrows_left_right_above_water.svg?raw';
import viewpointSvg from '@waysidemapping/pinhead/dist/icons/binoculars.svg?raw';
import hutSvg from '@waysidemapping/pinhead/dist/icons/cabin.svg?raw';
import campSiteSvg from '@waysidemapping/pinhead/dist/icons/campsite.svg?raw';
import guidepostSvg from '@waysidemapping/pinhead/dist/icons/guidepost.svg?raw';
import shelterSvg from '@waysidemapping/pinhead/dist/icons/shelter.svg?raw';
import drinkingWaterSvg from '@waysidemapping/pinhead/dist/icons/water_tap.svg?raw';
import mountainPassSvg from '@waysidemapping/pinhead/dist/icons/x_cross.svg?raw';

import { basemapImageIds } from '@/presentation/map/mapIds';
import { mapVisualPalette } from '@/presentation/map/mapVisualPalette';

/** Image pixels per CSS pixel; MapLibre draws an image at `size / pixelRatio`. */
const basemapImagePixelRatio = 2;
const samplesPerAxis = 4;

/** Raw non-premultiplied RGBA image accepted by `map.addImage`. */
interface RawRgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface BasemapImage {
  readonly image: HTMLImageElement | RawRgbaImage;
  readonly pixelRatio: number;
}

type Rgb = readonly [red: number, green: number, blue: number];
/** Axis-aligned rectangle in CSS pixels. */
type Rectangle = readonly [left: number, top: number, right: number, bottom: number];
/** Filled circle in CSS pixels. */
type Disc = readonly [x: number, y: number, radius: number];
/** Circle outline in CSS pixels; `width` is centred on `radius`. */
type Ring = readonly [x: number, y: number, radius: number, width: number];

const white: Rgb = [255, 255, 255];

/**
 * GOST cliff (обрыв): a line with teeth on the downhill side. OSM draws cliffs with the
 * lower side to the right of the way, and MapLibre maps the top image rows of a line
 * pattern to that side, so the teeth occupy the upper half of the image.
 */
const cliffPattern = {
  widthCss: 5,
  heightCss: 10,
  rectangles: [
    [0, 4.4, 5, 5.6],
    [2, 1, 3, 5],
  ],
} as const satisfies PatternGeometry;

/** Cable line with short symmetric crossbars, as aerial ropeways are drawn on topo maps. */
const aerialwayPattern = {
  widthCss: 14,
  heightCss: 8,
  rectangles: [
    [0, 3.5, 14, 4.5],
    [6.5, 1, 7.5, 7],
  ],
} as const satisfies PatternGeometry;

/** Park–Miller generator: products stay below 2^53, so every load draws the same pattern. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 48_271) % 2_147_483_647;
    return state / 2_147_483_647;
  };
}

/**
 * GOST swamp (болото): thin horizontal blue dashes on plain land. Dash lengths, gaps,
 * and heights vary from a fixed seed, and the pattern spans several rows, so the tiled
 * hatch reads as hand-drawn rather than as a regular grid.
 */
const wetlandPattern: PatternGeometry = (() => {
  const widthCss = 64;
  const rowSpacingCss = 8;
  const rowCount = 8;
  const strokeCss = 0.6;
  const random = seededRandom(7);
  const rectangles: Rectangle[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const rowTop = row * rowSpacingCss + 3.2;
    let left = 1 + random() * 10;
    for (;;) {
      const right = left + 4 + random() * 7;
      // Dashes never cross the seam, so the gap there stays within the row's rhythm.
      if (right > widthCss - 1) break;
      // Up to ±1.5 px off the row line keeps neighbouring rows apart.
      const top = rowTop + (random() - 0.5) * 3;
      rectangles.push([left, top, right, top + strokeCss]);
      left = right + 4 + random() * 6;
    }
  }
  return { widthCss, heightCss: rowCount * rowSpacingCss, rectangles };
})();

/**
 * Calls `place` once per square cell of a `cellCount × cellCount` grid with a random
 * point inside the cell, keeping `margin` from the cell edges so signs never cross the
 * pattern seam. Skipping some cells and jittering the rest avoids a visible grid.
 */
function scatterInCells(
  cellCss: number,
  cellCount: number,
  margin: number,
  random: () => number,
  place: (x: number, y: number) => void,
): void {
  for (let row = 0; row < cellCount; row += 1) {
    for (let column = 0; column < cellCount; column += 1) {
      if (random() < 0.35) continue;
      place(
        column * cellCss + margin + random() * (cellCss - 2 * margin),
        row * cellCss + margin + random() * (cellCss - 2 * margin),
      );
    }
  }
}

/** GOST forest (лес) without tree type: sparse crowns on short stems. */
const forestPattern: PatternGeometry = (() => {
  const cellCss = 40;
  const cellCount = 4;
  const random = seededRandom(11);
  const rectangles: Rectangle[] = [];
  const rings: Ring[] = [];
  scatterInCells(cellCss, cellCount, 3.5, random, (x, y) => {
    rings.push([x, y - 1, 1.7, 0.7]);
    rectangles.push([x - 0.35, y + 0.7, x + 0.35, y + 2.6]);
  });
  return {
    widthCss: cellCss * cellCount,
    heightCss: cellCss * cellCount,
    rectangles,
    rings,
  };
})();

/** GOST shrubs (кустарник): scattered clumps of three small dots. */
const scrubPattern: PatternGeometry = (() => {
  const cellCss = 30;
  const cellCount = 4;
  const random = seededRandom(13);
  const discs: Disc[] = [];
  scatterInCells(cellCss, cellCount, 3, random, (x, y) => {
    discs.push([x - 1.1, y + 0.6, 0.8], [x + 1.1, y + 0.6, 0.8], [x, y - 1.1, 0.8]);
  });
  return {
    widthCss: cellCss * cellCount,
    heightCss: cellCss * cellCount,
    rectangles: [],
    discs,
  };
})();

/**
 * GOST orchard (сад) for every planted crop: small circles in straight rows, so orchards,
 * vineyards, and nurseries read as man-made plantings.
 */
const plantationPattern: PatternGeometry = {
  widthCss: 14,
  heightCss: 14,
  rectangles: [],
  rings: [[7, 7, 1.3, 0.6]],
};

/** GOST scree (осыпь): scattered dots of different sizes. */
const screePattern: PatternGeometry = (() => {
  const cellCss = 11;
  const cellCount = 8;
  const random = seededRandom(17);
  const discs: Disc[] = [];
  scatterInCells(cellCss, cellCount, 1.2, random, (x, y) => {
    discs.push([x, y, 0.35 + random() * 0.45]);
  });
  return {
    widthCss: cellCss * cellCount,
    heightCss: cellCss * cellCount,
    rectangles: [],
    discs,
  };
})();

/** GOST cemetery (кладбище): small scattered crosses. */
const cemeteryPattern: PatternGeometry = (() => {
  const cellCss = 14;
  const cellCount = 4;
  const random = seededRandom(19);
  const rectangles: Rectangle[] = [];
  scatterInCells(cellCss, cellCount, 2.5, random, (x, y) => {
    rectangles.push(
      [x - 0.35, y - 2, x + 0.35, y + 2],
      [x - 1.2, y - 1, x + 1.2, y - 0.3],
    );
  });
  return { widthCss: cellCss * cellCount, heightCss: cellCss * cellCount, rectangles };
})();

interface PatternGeometry {
  readonly widthCss: number;
  readonly heightCss: number;
  readonly rectangles: readonly Rectangle[];
  readonly discs?: readonly Disc[];
  readonly rings?: readonly Ring[];
}

const pinheadIcons: Readonly<
  Record<
    string,
    { readonly svg: string; readonly color: string; readonly sizeCss: number }
  >
> = {
  [basemapImageIds.drinkingWater]: {
    svg: drinkingWaterSvg,
    color: mapVisualPalette.poi.water,
    sizeCss: 16,
  },
  [basemapImageIds.hut]: { svg: hutSvg, color: mapVisualPalette.poi.hut, sizeCss: 16 },
  [basemapImageIds.shelter]: {
    svg: shelterSvg,
    color: mapVisualPalette.poi.hut,
    sizeCss: 16,
  },
  [basemapImageIds.campSite]: {
    svg: campSiteSvg,
    color: mapVisualPalette.poi.campSite,
    sizeCss: 16,
  },
  [basemapImageIds.viewpoint]: {
    svg: viewpointSvg,
    color: mapVisualPalette.poi.viewpoint,
    sizeCss: 16,
  },
  [basemapImageIds.guidepost]: {
    svg: guidepostSvg,
    color: mapVisualPalette.poi.guidepost,
    sizeCss: 15,
  },
  [basemapImageIds.ford]: {
    svg: fordSvg,
    color: mapVisualPalette.water.label,
    sizeCss: 18,
  },
  [basemapImageIds.mountainPass]: {
    svg: mountainPassSvg,
    color: mapVisualPalette.terrain.pass,
    sizeCss: 14,
  },
};

const patterns: Readonly<
  Record<string, { readonly geometry: PatternGeometry; readonly color: string }>
> = {
  [basemapImageIds.cliffPattern]: {
    geometry: cliffPattern,
    color: mapVisualPalette.terrain.cliff,
  },
  [basemapImageIds.aerialwayPattern]: {
    geometry: aerialwayPattern,
    color: mapVisualPalette.transport.aerialway,
  },
  [basemapImageIds.wetlandPattern]: {
    geometry: wetlandPattern,
    color: mapVisualPalette.water.wetland,
  },
  [basemapImageIds.forestPattern]: {
    geometry: forestPattern,
    color: mapVisualPalette.vegetation.sign,
  },
  [basemapImageIds.scrubPattern]: {
    geometry: scrubPattern,
    color: mapVisualPalette.vegetation.sign,
  },
  [basemapImageIds.plantationPattern]: {
    geometry: plantationPattern,
    color: mapVisualPalette.vegetation.sign,
  },
  [basemapImageIds.screePattern]: {
    geometry: screePattern,
    color: mapVisualPalette.terrain.scree,
  },
  [basemapImageIds.cemeteryPattern]: {
    geometry: cemeteryPattern,
    color: mapVisualPalette.base.cemeterySign,
  },
};

/**
 * Creates the image for a basemap icon or pattern ID, or returns null for IDs the
 * basemap does not own. Pinhead icons get a white halo so they stay legible on imagery.
 */
export function createBasemapImage(imageId: string): Promise<BasemapImage> | null {
  const pattern = patterns[imageId];
  if (pattern !== undefined) {
    return Promise.resolve({
      image: rasterizePattern(pattern.geometry, hexRgb(pattern.color)),
      pixelRatio: basemapImagePixelRatio,
    });
  }
  if (imageId === basemapImageIds.attraction) {
    return Promise.resolve({
      image: rasterizeAttractionDot(),
      pixelRatio: basemapImagePixelRatio,
    });
  }
  const icon = pinheadIcons[imageId];
  return icon === undefined ? null : pinheadImage(icon.svg, icon.color, icon.sizeCss);
}

async function pinheadImage(
  svg: string,
  color: string,
  sizeCss: number,
): Promise<BasemapImage> {
  const size = sizeCss * basemapImagePixelRatio;
  // The widened view box leaves room for the halo around the 15-unit Pinhead glyph.
  const markup = svg.replace(
    'viewBox="0 0 15 15"',
    `viewBox="-1.5 -1.5 18 18" width="${String(size)}" height="${String(size)}" fill="${color}" stroke="#FFFFFF" stroke-width="2.5" stroke-linejoin="round" paint-order="stroke fill"`,
  );
  const image = new Image(size, size);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await image.decode();
  return { image, pixelRatio: basemapImagePixelRatio };
}

function rasterizePattern(geometry: PatternGeometry, color: Rgb): RawRgbaImage {
  return rasterize(geometry.widthCss, geometry.heightCss, (x, y) => {
    const covered =
      geometry.rectangles.some(
        ([left, top, right, bottom]) =>
          x >= left && x < right && y >= top && y < bottom,
      ) ||
      (geometry.discs ?? []).some(
        ([centerX, centerY, radius]) => Math.hypot(x - centerX, y - centerY) <= radius,
      ) ||
      (geometry.rings ?? []).some(
        ([centerX, centerY, radius, width]) =>
          Math.abs(Math.hypot(x - centerX, y - centerY) - radius) <= width / 2,
      );
    return covered ? color : null;
  });
}

/** The former POI circle: a 3 px dot with a 1 px white ring. */
function rasterizeAttractionDot(): RawRgbaImage {
  const fill = hexRgb(mapVisualPalette.poi.attraction);
  return rasterize(8, 8, (x, y) => {
    const distance = Math.hypot(x - 4, y - 4);
    if (distance <= 3) return fill;
    return distance <= 4 ? white : null;
  });
}

/** Supersamples `colorAt` (CSS pixel coordinates) so edges stay antialiased. */
function rasterize(
  widthCss: number,
  heightCss: number,
  colorAt: (x: number, y: number) => Rgb | null,
): RawRgbaImage {
  const width = widthCss * basemapImagePixelRatio;
  const height = heightCss * basemapImagePixelRatio;
  const data = new Uint8Array(width * height * 4);
  const sampleCount = samplesPerAxis * samplesPerAxis;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      let covered = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = 0; sy < samplesPerAxis; sy += 1) {
        for (let sx = 0; sx < samplesPerAxis; sx += 1) {
          const color = colorAt(
            (column + (sx + 0.5) / samplesPerAxis) / basemapImagePixelRatio,
            (row + (sy + 0.5) / samplesPerAxis) / basemapImagePixelRatio,
          );
          if (color === null) continue;
          covered += 1;
          red += color[0];
          green += color[1];
          blue += color[2];
        }
      }
      if (covered === 0) continue;
      const offset = (row * width + column) * 4;
      data[offset] = Math.round(red / covered);
      data[offset + 1] = Math.round(green / covered);
      data[offset + 2] = Math.round(blue / covered);
      data[offset + 3] = Math.round((255 * covered) / sampleCount);
    }
  }
  return { width, height, data };
}

function hexRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
