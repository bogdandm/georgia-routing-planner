import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { Box, Stack, Typography } from '@mui/material';
import { useEffect, useId, useRef } from 'react';

import {
  createBasemapImage,
  type BasemapImage,
} from '@/presentation/map/basemapSymbols';
import { basemapImageIds } from '@/presentation/map/mapIds';
import { mapVisualPalette } from '@/presentation/map/mapVisualPalette';

/** How one legend swatch is drawn, mirroring the basemap style it explains. */
type LegendSymbol =
  | {
      readonly kind: 'area';
      readonly fill: string;
      readonly pattern?: string;
      readonly outline?: string;
    }
  | { readonly kind: 'outline'; readonly color: string }
  | {
      readonly kind: 'line';
      readonly color: string;
      readonly width: number;
      readonly dash?: readonly number[];
      readonly casing?: string;
    }
  | { readonly kind: 'line-pattern'; readonly pattern: string }
  | { readonly kind: 'icon'; readonly image: string }
  | { readonly kind: 'dot'; readonly color: string };

interface LegendEntry {
  readonly label: MessageDescriptor;
  readonly symbol: LegendSymbol;
}

const legendGroups: readonly {
  readonly title: MessageDescriptor;
  readonly entries: readonly LegendEntry[];
}[] = [
  {
    title: msg`Areas`,
    entries: [
      {
        label: msg`Forest`,
        symbol: {
          kind: 'area',
          fill: mapVisualPalette.vegetation.forest,
          pattern: basemapImageIds.forestPattern,
        },
      },
      {
        label: msg`Shrubs and heath`,
        symbol: {
          kind: 'area',
          fill: mapVisualPalette.vegetation.scrub,
          pattern: basemapImageIds.scrubPattern,
        },
      },
      {
        label: msg`Orchards, vineyards, plantings`,
        symbol: {
          kind: 'area',
          fill: mapVisualPalette.vegetation.farmland,
          pattern: basemapImageIds.plantationPattern,
        },
      },
      {
        label: msg`Swamp`,
        symbol: {
          kind: 'area',
          fill: mapVisualPalette.base.land,
          pattern: basemapImageIds.wetlandPattern,
        },
      },
      {
        label: msg`Scree`,
        symbol: {
          kind: 'area',
          fill: mapVisualPalette.base.rock,
          pattern: basemapImageIds.screePattern,
        },
      },
      {
        label: msg`Glacier`,
        symbol: { kind: 'area', fill: mapVisualPalette.glacier.fill },
      },
      {
        label: msg`Cemetery`,
        symbol: {
          kind: 'area',
          fill: mapVisualPalette.vegetation.grass,
          pattern: basemapImageIds.cemeteryPattern,
        },
      },
      {
        label: msg`Military area`,
        symbol: { kind: 'outline', color: mapVisualPalette.restricted.line },
      },
      {
        label: msg`Protected area`,
        symbol: {
          kind: 'area',
          fill: mapVisualPalette.base.land,
          pattern: basemapImageIds.protectedAreaPattern,
          outline: mapVisualPalette.protectedArea.line,
        },
      },
    ],
  },
  {
    title: msg`Lines`,
    entries: [
      {
        label: msg`Path or track`,
        symbol: {
          kind: 'line',
          color: mapVisualPalette.transport.path,
          width: 2,
          dash: [4, 3],
        },
      },
      {
        label: msg`Road`,
        symbol: {
          kind: 'line',
          color: mapVisualPalette.transport.minor,
          width: 3,
          casing: mapVisualPalette.transport.casing,
        },
      },
      {
        label: msg`River or stream`,
        symbol: { kind: 'line', color: mapVisualPalette.water.line, width: 2 },
      },
      {
        label: msg`Seasonal stream`,
        symbol: {
          kind: 'line',
          color: mapVisualPalette.water.line,
          width: 2,
          dash: [5, 4],
        },
      },
      {
        label: msg`Ridge`,
        symbol: { kind: 'line', color: mapVisualPalette.terrain.ridge, width: 1 },
      },
      {
        label: msg`Cliff, teeth point downhill`,
        symbol: { kind: 'line-pattern', pattern: basemapImageIds.cliffPattern },
      },
      {
        label: msg`Cable car or ski lift`,
        symbol: { kind: 'line-pattern', pattern: basemapImageIds.aerialwayPattern },
      },
      {
        label: msg`Country border`,
        symbol: { kind: 'line', color: mapVisualPalette.boundary.country, width: 2 },
      },
      {
        label: msg`Disputed territory line`,
        symbol: {
          kind: 'line',
          color: mapVisualPalette.boundary.disputed,
          width: 2.5,
          dash: [5, 3.75],
        },
      },
    ],
  },
  {
    title: msg`Points`,
    entries: [
      {
        label: msg`Peak`,
        symbol: { kind: 'dot', color: mapVisualPalette.text.secondary },
      },
      {
        label: msg`Mountain pass`,
        symbol: { kind: 'icon', image: basemapImageIds.mountainPass },
      },
      {
        label: msg`Mountain hut`,
        symbol: { kind: 'icon', image: basemapImageIds.hut },
      },
      {
        label: msg`Shelter`,
        symbol: { kind: 'icon', image: basemapImageIds.shelter },
      },
      {
        label: msg`Camp site`,
        symbol: { kind: 'icon', image: basemapImageIds.campSite },
      },
      {
        label: msg`Drinking water`,
        symbol: { kind: 'icon', image: basemapImageIds.drinkingWater },
      },
      {
        label: msg`Ford`,
        symbol: { kind: 'icon', image: basemapImageIds.ford },
      },
      {
        label: msg`Viewpoint`,
        symbol: { kind: 'icon', image: basemapImageIds.viewpoint },
      },
      {
        label: msg`Guidepost`,
        symbol: { kind: 'icon', image: basemapImageIds.guidepost },
      },
      {
        label: msg`Castle or fortress`,
        symbol: { kind: 'icon', image: basemapImageIds.castle },
      },
      {
        label: msg`Ruins`,
        symbol: { kind: 'icon', image: basemapImageIds.ruins },
      },
      {
        label: msg`Other attraction`,
        symbol: { kind: 'icon', image: basemapImageIds.attraction },
      },
    ],
  },
];

const swatchWidth = 40;
const swatchHeight = 28;
/** Swatches are drawn at the basemap images' own resolution. */
const swatchPixelRatio = 2;
/** Area signs are enlarged in the legend; at map size they are too small to read alone. */
const areaSignScale = 2;

/* eslint-disable lingui/no-unlocalized-strings -- Canvas API tokens and CSS colours. */
/** Copies a raw basemap image into a canvas so it can be drawn or tiled. */
function imageSource(image: BasemapImage['image']): CanvasImageSource {
  if (!('data' in image)) return image;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas
    .getContext('2d')
    ?.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0,
    );
  return canvas;
}

/** Draws one swatch in device pixels: CSS size times `swatchPixelRatio`. */
async function drawSwatch(
  context: CanvasRenderingContext2D,
  symbol: LegendSymbol,
): Promise<void> {
  const width = swatchWidth * swatchPixelRatio;
  const height = swatchHeight * swatchPixelRatio;
  const middle = height / 2;
  switch (symbol.kind) {
    case 'area': {
      context.fillStyle = symbol.fill;
      context.fillRect(0, 0, width, height);
      if (symbol.pattern !== undefined) {
        const loaded = await createBasemapImage(symbol.pattern);
        const pattern =
          loaded === null
            ? null
            : context.createPattern(imageSource(loaded.image), 'repeat');
        if (loaded !== null && pattern !== null) {
          // Signs are enlarged, and forest and shrub signs are sparser than a swatch, so
          // the tiling is shifted to centre the first whole sign of the pattern.
          const sign = firstSignCenter(loaded.image);
          pattern.setTransform(
            new DOMMatrix()
              .translate(
                width / 2 - sign.x * areaSignScale,
                height / 2 - sign.y * areaSignScale,
              )
              .scale(areaSignScale),
          );
          context.fillStyle = pattern;
          context.fillRect(0, 0, width, height);
        }
      }
      if (symbol.outline === undefined) {
        context.strokeStyle = 'rgba(0, 0, 0, 0.18)';
        context.lineWidth = 2;
        context.strokeRect(1, 1, width - 2, height - 2);
      } else {
        context.strokeStyle = symbol.outline;
        context.lineWidth = 3;
        context.strokeRect(1.5, 1.5, width - 3, height - 3);
      }
      return;
    }
    case 'outline':
      context.strokeStyle = symbol.color;
      context.lineWidth = 3;
      context.strokeRect(2, 2, width - 4, height - 4);
      return;
    case 'line':
      context.lineCap = 'round';
      if (symbol.casing !== undefined) {
        context.strokeStyle = symbol.casing;
        context.lineWidth = (symbol.width + 1.5) * swatchPixelRatio;
        context.beginPath();
        context.moveTo(4, middle);
        context.lineTo(width - 4, middle);
        context.stroke();
      }
      context.strokeStyle = symbol.color;
      context.lineWidth = symbol.width * swatchPixelRatio;
      context.setLineDash((symbol.dash ?? []).map((value) => value * swatchPixelRatio));
      context.beginPath();
      context.moveTo(4, middle);
      context.lineTo(width - 4, middle);
      context.stroke();
      return;
    case 'line-pattern': {
      const loaded = await createBasemapImage(symbol.pattern);
      if (loaded === null) return;
      const source = imageSource(loaded.image);
      const pattern = context.createPattern(source, 'repeat-x');
      if (pattern === null || !('height' in source)) return;
      const top = Math.round(middle - Number(source.height) / 2);
      context.translate(0, top);
      context.fillStyle = pattern;
      context.fillRect(0, 0, width, Number(source.height));
      context.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    case 'icon': {
      const loaded = await createBasemapImage(symbol.image);
      if (loaded === null) return;
      const source = imageSource(loaded.image);
      if (!('width' in source) || !('height' in source)) return;
      const iconWidth = (Number(source.width) / loaded.pixelRatio) * swatchPixelRatio;
      const iconHeight = (Number(source.height) / loaded.pixelRatio) * swatchPixelRatio;
      context.drawImage(
        source,
        (width - iconWidth) / 2,
        (height - iconHeight) / 2,
        iconWidth,
        iconHeight,
      );
      return;
    }
    case 'dot':
      context.fillStyle = symbol.color;
      context.strokeStyle = mapVisualPalette.text.haloVector;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(width / 2, middle, 3 * swatchPixelRatio, 0, Math.PI * 2);
      context.fill();
      context.stroke();
  }
}

/** Pixels this close belong to one sign, so a three-dot shrub clump counts as one. */
const signJoinDistance = 3;

/**
 * Centre of the bounding box of the first sign in a raw pattern: the opaque pixels
 * reachable from the first opaque pixel through gaps of at most `signJoinDistance`.
 */
function firstSignCenter(image: BasemapImage['image']): {
  readonly x: number;
  readonly y: number;
} {
  if (!('data' in image)) return { x: 0, y: 0 };
  const { width, height, data } = image;
  const opaque = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    (data[(y * width + x) * 4 + 3] ?? 0) > 0;
  let start = -1;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if ((data[pixel * 4 + 3] ?? 0) > 0) {
      start = pixel;
      break;
    }
  }
  if (start < 0) return { x: 0, y: 0 };
  const seen = new Set<number>([start]);
  const queue = [start];
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const x = next % width;
    const y = Math.floor(next / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
    for (let dy = -signJoinDistance; dy <= signJoinDistance; dy += 1) {
      for (let dx = -signJoinDistance; dx <= signJoinDistance; dx += 1) {
        const neighbour = (y + dy) * width + x + dx;
        if (seen.has(neighbour) || !opaque(x + dx, y + dy)) continue;
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return { x: (left + right + 1) / 2, y: (top + bottom + 1) / 2 };
}

function LegendSwatch({ symbol }: { readonly symbol: LegendSymbol }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    // jsdom and blocked canvases have no 2D context; the label still explains the entry.
    const context = canvasRef.current?.getContext('2d');
    if (context === null || context === undefined) return;
    void drawSwatch(context, symbol).catch(() => undefined);
  }, [symbol]);
  return (
    <Box
      component="canvas"
      ref={canvasRef}
      aria-hidden="true"
      width={swatchWidth * swatchPixelRatio}
      height={swatchHeight * swatchPixelRatio}
      sx={{
        width: swatchWidth,
        height: swatchHeight,
        flexShrink: 0,
        borderRadius: 0.5,
      }}
    />
  );
}
/* eslint-enable lingui/no-unlocalized-strings */

/**
 * Explains the hiking basemap's symbols on the help screen. Swatches are drawn from the
 * same generated images and palette as the map style, so the legend cannot drift from
 * what the map shows.
 */
export function MapLegend() {
  const { i18n } = useLingui();
  const titleId = useId();
  return (
    <Box component="section" aria-labelledby={titleId} sx={{ minWidth: 0 }}>
      <Typography
        id={titleId}
        component="h3"
        variant="subtitle2"
        sx={{ fontWeight: 700, mb: 1 }}
      >
        <Trans>Map legend</Trans>
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
          gap: 2,
          columnGap: 3,
        }}
      >
        {legendGroups.map((group) => (
          <Stack key={group.title.id} spacing={0.75}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 700 }}
            >
              {i18n._(group.title)}
            </Typography>
            {group.entries.map((entry) => (
              <Stack
                key={entry.label.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center' }}
              >
                <LegendSwatch symbol={entry.symbol} />
                <Typography variant="body2">{i18n._(entry.label)}</Typography>
              </Stack>
            ))}
          </Stack>
        ))}
      </Box>
    </Box>
  );
}
