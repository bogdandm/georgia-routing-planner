import fordSvg from '@waysidemapping/pinhead/dist/icons/arrows_left_right_above_water.svg?raw';
import viewpointSvg from '@waysidemapping/pinhead/dist/icons/binoculars.svg?raw';
import hutSvg from '@waysidemapping/pinhead/dist/icons/cabin.svg?raw';
import campSiteSvg from '@waysidemapping/pinhead/dist/icons/campsite.svg?raw';
import castleSvg from '@waysidemapping/pinhead/dist/icons/fortress.svg?raw';
import guidepostSvg from '@waysidemapping/pinhead/dist/icons/guidepost.svg?raw';
import shelterSvg from '@waysidemapping/pinhead/dist/icons/shelter.svg?raw';
import ruinsSvg from '@waysidemapping/pinhead/dist/icons/stone_wall.svg?raw';
import drinkingWaterSvg from '@waysidemapping/pinhead/dist/icons/water_tap.svg?raw';
import mountainPassSvg from '@waysidemapping/pinhead/dist/icons/x_cross.svg?raw';

import { basemapImageIds } from '@/presentation/map/mapIds';
import { mapVisualPalette } from '@/presentation/map/mapVisualPalette';

/** Image pixels per CSS pixel; MapLibre draws an image at `size / pixelRatio`. */
const basemapImagePixelRatio = 2;
const samplesPerAxis = 4;

/**
 * Raw non-premultiplied RGBA image accepted by `map.addImage`. Generated images are
 * shared by every map, so their pixels must never be modified.
 */
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
/** Straight stroke in CSS pixels with round ends; `width` is centred on the line. */
type Segment = readonly [x1: number, y1: number, x2: number, y2: number, width: number];

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

/** GOST cemetery (кладбище): scattered crosses, large enough to read at a glance. */
const cemeteryPattern: PatternGeometry = (() => {
  const cellCss = 18;
  const cellCount = 4;
  const random = seededRandom(19);
  const rectangles: Rectangle[] = [];
  scatterInCells(cellCss, cellCount, 4.5, random, (x, y) => {
    rectangles.push(
      [x - 0.5, y - 3.5, x + 0.5, y + 3.5],
      [x - 2.2, y - 1.8, x + 2.2, y - 0.8],
    );
  });
  return { widthCss: cellCss * cellCount, heightCss: cellCss * cellCount, rectangles };
})();

/**
 * Letters N and R drawn as strokes from the top-left corner `(left, top)`: 6 px tall,
 * 4 px wide, with a chamfered R bowl that stays legible at map size.
 */
function natureReserveLetters(left: number, top: number): Segment[] {
  const stroke = 1.1;
  const width = 4;
  const height = 6;
  const bottom = top + height;
  const middle = top + height / 2;
  const r = left + width + 1.8;
  const rRight = r + width;
  return [
    [left, top, left, bottom, stroke],
    [left, top, left + width, bottom, stroke],
    [left + width, top, left + width, bottom, stroke],
    [r, top, r, bottom, stroke],
    [r, top, rRight - 1, top, stroke],
    [rRight - 1, top, rRight, top + 1, stroke],
    [rRight, top + 1, rRight, middle - 1, stroke],
    [rRight, middle - 1, rRight - 1, middle, stroke],
    [rRight - 1, middle, r, middle, stroke],
    [r + 1.4, middle, rRight, bottom, stroke],
  ];
}

/**
 * Protected land: repeated "NR" in two offset rows, so the sign reads as text rather
 * than as a grid while staying clear of the pattern seams. Patterns keep their screen
 * size at every zoom, so close zooms use a larger, sparser tile.
 */
function protectedAreaPattern(widthCss: number, heightCss: number): PatternGeometry {
  return {
    widthCss,
    heightCss,
    rectangles: [],
    segments: [
      ...natureReserveLetters(widthCss / 8, (heightCss * 7) / 32),
      ...natureReserveLetters((widthCss * 5) / 8, (heightCss * 23) / 32),
    ],
  };
}

interface PatternGeometry {
  readonly widthCss: number;
  readonly heightCss: number;
  readonly rectangles: readonly Rectangle[];
  readonly discs?: readonly Disc[];
  readonly rings?: readonly Ring[];
  readonly segments?: readonly Segment[];
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
  [basemapImageIds.castle]: {
    svg: castleSvg,
    color: mapVisualPalette.poi.historic,
    sizeCss: 16,
  },
  // Pinhead has no ruins glyph; a masonry fragment reads as ruined walls at map size.
  [basemapImageIds.ruins]: {
    svg: ruinsSvg,
    color: mapVisualPalette.poi.historic,
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
  [basemapImageIds.protectedAreaPattern]: {
    geometry: protectedAreaPattern(96, 64),
    color: mapVisualPalette.protectedArea.line,
  },
  [basemapImageIds.protectedAreaSparsePattern]: {
    geometry: protectedAreaPattern(192, 128),
    color: mapVisualPalette.protectedArea.line,
  },
};

/**
 * Generated images never change and `map.addImage` copies their pixels, so the main map,
 * every comparison pane, and the legend share one generation per ID. Large patterns
 * take hundreds of milliseconds of main-thread time each to rasterize.
 */
const generatedImages = new Map<string, Promise<BasemapImage>>();

/**
 * Creates the image for a basemap icon or pattern ID, or returns null for IDs the
 * basemap does not own. Pinhead icons get a white halo so they stay legible on imagery.
 */
export function createBasemapImage(imageId: string): Promise<BasemapImage> | null {
  const generated = generatedImages.get(imageId) ?? generateBasemapImage(imageId);
  if (generated === null || generatedImages.has(imageId)) return generated;
  generatedImages.set(imageId, generated);
  // A failed icon decode is retried by the next request instead of being cached.
  generated.catch(() => {
    generatedImages.delete(imageId);
  });
  return generated;
}

function generateBasemapImage(imageId: string): Promise<BasemapImage> | null {
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

/** One pattern shape: its exact coverage test and a box outside which it covers nothing. */
interface PatternShape {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly covers: (x: number, y: number) => boolean;
}

/** Widens shape boxes so rounding in the exact tests never falls outside them. */
const boxMarginCss = 1e-6;

function patternShapes(geometry: PatternGeometry): readonly PatternShape[] {
  const shapes: PatternShape[] = [];
  const add = (
    centerX: number,
    centerY: number,
    halfWidth: number,
    halfHeight: number,
    covers: (x: number, y: number) => boolean,
  ) => {
    shapes.push({
      left: centerX - halfWidth - boxMarginCss,
      top: centerY - halfHeight - boxMarginCss,
      right: centerX + halfWidth + boxMarginCss,
      bottom: centerY + halfHeight + boxMarginCss,
      covers,
    });
  };
  for (const [left, top, right, bottom] of geometry.rectangles) {
    add(
      (left + right) / 2,
      (top + bottom) / 2,
      (right - left) / 2,
      (bottom - top) / 2,
      (x, y) => x >= left && x < right && y >= top && y < bottom,
    );
  }
  for (const [centerX, centerY, radius] of geometry.discs ?? []) {
    add(
      centerX,
      centerY,
      radius,
      radius,
      (x, y) => Math.hypot(x - centerX, y - centerY) <= radius,
    );
  }
  for (const [centerX, centerY, radius, width] of geometry.rings ?? []) {
    const outer = radius + width / 2;
    add(
      centerX,
      centerY,
      outer,
      outer,
      (x, y) => Math.abs(Math.hypot(x - centerX, y - centerY) - radius) <= width / 2,
    );
  }
  for (const [x1, y1, x2, y2, width] of geometry.segments ?? []) {
    add(
      (x1 + x2) / 2,
      (y1 + y2) / 2,
      Math.abs(x2 - x1) / 2 + width / 2,
      Math.abs(y2 - y1) / 2 + width / 2,
      (x, y) => distanceToSegment(x, y, x1, y1, x2, y2) <= width / 2,
    );
  }
  return shapes;
}

function rasterizePattern(geometry: PatternGeometry, color: Rgb): RawRgbaImage {
  // Testing every shape for every supersample took seconds for the dense forest and
  // protected-area patterns. Each image row tests only the shapes whose boxes reach it,
  // and only inside those boxes; the exact tests are unchanged, so the pixels are too.
  const shapes = patternShapes(geometry);
  const rowCount = geometry.heightCss * basemapImagePixelRatio;
  const shapesByRow = Array.from({ length: rowCount }, (_, row) => {
    const rowTop = row / basemapImagePixelRatio;
    const rowBottom = (row + 1) / basemapImagePixelRatio;
    return shapes.filter((shape) => shape.bottom >= rowTop && shape.top <= rowBottom);
  });
  return rasterize(geometry.widthCss, geometry.heightCss, (x, y) => {
    const row = Math.min(rowCount - 1, Math.floor(y * basemapImagePixelRatio));
    const covered = (shapesByRow[row] ?? []).some(
      (shape) =>
        x >= shape.left &&
        x <= shape.right &&
        y >= shape.top &&
        y <= shape.bottom &&
        shape.covers(x, y),
    );
    return covered ? color : null;
  });
}

function distanceToSegment(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
  return Math.hypot(x - (x1 + along * dx), y - (y1 + along * dy));
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
