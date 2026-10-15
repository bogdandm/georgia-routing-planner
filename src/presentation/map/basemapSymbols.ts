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

/**
 * GOST swamp (болото): thin horizontal blue dashes on plain land. Dash lengths and gaps
 * vary along each row from a fixed seed, and the pattern spans several rows, so the
 * tiled hatch reads as hand-drawn rather than as a regular grid.
 */
const wetlandPattern: PatternGeometry = (() => {
  const widthCss = 64;
  const rowSpacingCss = 8;
  const rowCount = 8;
  const strokeCss = 0.6;
  let seed = 7;
  // Park–Miller generator; products stay below 2^53, so every load draws the same hatch.
  const random = () => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  const rectangles: Rectangle[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const top = row * rowSpacingCss + 3.2;
    let left = 1 + random() * 10;
    for (;;) {
      const right = left + 4 + random() * 7;
      // Dashes never cross the seam, so the gap there stays within the row's rhythm.
      if (right > widthCss - 1) break;
      rectangles.push([left, top, right, top + strokeCss]);
      left = right + 4 + random() * 6;
    }
  }
  return { widthCss, heightCss: rowCount * rowSpacingCss, rectangles };
})();

interface PatternGeometry {
  readonly widthCss: number;
  readonly heightCss: number;
  readonly rectangles: readonly Rectangle[];
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

/**
 * Creates the image for a basemap icon or pattern ID, or returns null for IDs the
 * basemap does not own. Pinhead icons get a white halo so they stay legible on imagery.
 */
export function createBasemapImage(imageId: string): Promise<BasemapImage> | null {
  switch (imageId) {
    case basemapImageIds.cliffPattern:
      return Promise.resolve(
        rasterImage(
          rasterizePattern(cliffPattern, hexRgb(mapVisualPalette.terrain.cliff)),
        ),
      );
    case basemapImageIds.aerialwayPattern:
      return Promise.resolve(
        rasterImage(
          rasterizePattern(
            aerialwayPattern,
            hexRgb(mapVisualPalette.transport.aerialway),
          ),
        ),
      );
    case basemapImageIds.wetlandPattern:
      return Promise.resolve(
        rasterImage(
          rasterizePattern(wetlandPattern, hexRgb(mapVisualPalette.water.wetland)),
        ),
      );
    case basemapImageIds.attraction:
      return Promise.resolve(rasterImage(rasterizeAttractionDot()));
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

function rasterImage(image: RawRgbaImage): BasemapImage {
  return { image, pixelRatio: basemapImagePixelRatio };
}

function rasterizePattern(geometry: PatternGeometry, color: Rgb): RawRgbaImage {
  return rasterize(geometry.widthCss, geometry.heightCss, (x, y) =>
    geometry.rectangles.some(
      ([left, top, right, bottom]) => x >= left && x < right && y >= top && y < bottom,
    )
      ? color
      : null,
  );
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
