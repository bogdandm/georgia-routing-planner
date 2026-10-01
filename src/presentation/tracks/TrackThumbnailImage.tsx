import { Box } from '@mui/material';
import { useMemo, type ReactElement } from 'react';

import type { TrackThumbnail } from '@/domain/tracks/trackThumbnail';
import { mapVisualPalette } from '@/presentation/map/mapVisualPalette';
import { appColors } from '@/presentation/theme/appColors';

const VIEWBOX_SIZE = 100;
/** Keeps the line and its casing clear of the backdrop's rounded corners. */
const PADDING = 14;

/** SVG path in a 100×100 box; aspect ratio preserved and centred on both axes. */
function thumbnailPath(thumbnail: TrackThumbnail): string {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const segment of thumbnail.segments) {
    for (const [longitude, latitude] of segment) {
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }
  }
  if (west === Infinity) return '';
  const longitudeScale = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const width = (east - west) * longitudeScale;
  const height = north - south;
  const extent = Math.max(width, height);
  const scale = extent === 0 ? 0 : (VIEWBOX_SIZE - 2 * PADDING) / extent;
  const offsetX = (VIEWBOX_SIZE - width * scale) / 2;
  const offsetY = (VIEWBOX_SIZE - height * scale) / 2;
  const point = ([longitude, latitude]: readonly [number, number]): string =>
    `${((longitude - west) * longitudeScale * scale + offsetX).toFixed(1)} ${(
      (north - latitude) * scale +
      offsetY
    ).toFixed(1)}`;
  return thumbnail.segments
    .map((segment) => {
      const [first, ...rest] = segment.map(point);
      if (first === undefined) return '';
      /* eslint-disable lingui/no-unlocalized-strings -- SVG path commands are not copy. */
      return rest.length === 0
        ? `M ${first} L ${first}`
        : `M ${first} ${rest.map((vertex) => `L ${vertex}`).join(' ')}`;
      /* eslint-enable lingui/no-unlocalized-strings */
    })
    .join(' ');
}

/** Decorative track-shape square that stretches to its grid row's height. */
export function TrackThumbnailImage({
  thumbnail,
}: {
  readonly thumbnail: TrackThumbnail | undefined;
}): ReactElement {
  const path = useMemo(
    () => (thumbnail === undefined ? '' : thumbnailPath(thumbnail)),
    [thumbnail],
  );
  return (
    <Box
      aria-hidden
      sx={{
        position: 'relative',
        alignSelf: 'stretch',
        aspectRatio: '1 / 1',
        bgcolor: 'background.default',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
      }}
    >
      {thumbnail === undefined || path === '' ? null : (
        <svg
          viewBox={`0 0 ${String(VIEWBOX_SIZE)} ${String(VIEWBOX_SIZE)}`}
          preserveAspectRatio="xMidYMid meet"
          focusable="false"
          data-track-shape={thumbnail.loop ? 'loop' : 'one-way'}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
          }}
        >
          <path
            d={path}
            fill="none"
            stroke={appColors.brand.deepSpace}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={path}
            fill="none"
            stroke={
              thumbnail.loop
                ? appColors.brand.tigerOrange
                : mapVisualPalette.userGeometry.gpxTrack
            }
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </Box>
  );
}
