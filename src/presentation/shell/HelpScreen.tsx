import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import CloseIcon from '@mui/icons-material/Close';
import TourOutlinedIcon from '@mui/icons-material/TourOutlined';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  SvgIcon,
  Typography,
  useMediaQuery,
  type Theme,
} from '@mui/material';
import { Fragment, useId } from 'react';

import { Keycap, touchFirstQuery } from '@/presentation/KeyboardShortcutKeys';
import {
  keyboardShortcutKeyCombinations,
  keyboardShortcutKeys,
  isMacPlatform,
  shiftKeyLabel,
  type KeyboardShortcutAction,
} from '@/presentation/keyboardShortcuts';
import { basemapPresets } from '@/presentation/map/mapTypes';
import { MapLegend } from '@/presentation/shell/MapLegend';

/* eslint-disable lingui/no-unlocalized-strings -- SVG path data. */
/**
 * Mouse gestures, drawn with Kenney's "Input Prompts" glyphs (CC0, kenney.nl): the left
 * button dragged with arrows around it, the wheel, the middle button, and the right
 * button. Paths are in the glyphs' 64-unit box.
 */
const mouseGestures = {
  drag: {
    label: msg`Drag`,
    path: 'M39.8 18 L41.65 18.45 Q43 19.3 43 21.75 L43 27 37 27 37 26 Q37 23.9 35.55 22.45 34.45 21.35 33 21.1 L33 18 39.8 18 M32 23 Q33.25 23 34.1 23.85 35 24.75 35 26 L35 30.1 Q35 31.25 34.1 32.1 33.3 32.95 32.15 33 L31.85 33 Q30.7 32.95 29.85 32.1 29 31.25 29 30.1 L29 26 Q29 24.75 29.85 23.85 30.75 23 32 23 M43 35.65 L43 36 Q42.8 40 39.8 42.85 36.7 45.85 32.35 46 L31.7 46 Q27.35 45.85 24.2 42.85 21.25 40 21.05 36 L21 35.7 21 29 27.1 29 27.1 31 Q27.35 32.45 28.45 33.55 29.9 35 32 35 34.05 35 35.5 33.55 L35.55 33.5 Q36.65 32.4 36.9 31 L36.9 29 43 29 43 35.65 M21 21.75 Q21 19.3 22.4 18.45 23.1 18 24.25 18 L31 18 31 21.1 Q29.6 21.35 28.5 22.4 L28.4 22.5 Q27 23.95 27 26 L27 27 21 27 21 21.75 M32 6 L38 12 38 14 26 14 26 12 32 6 M9 32 L15 26 17 26 17 38 15 38 9 32 M32 58 L26 52 26 50 38 50 38 52 32 58 M55 32 L49 38 47 38 47 26 49 26 55 32',
  },
  wheel: {
    label: msg`Scroll wheel`,
    path: 'M42 17.5 L34 17.5 34 20.85 Q35.25 21.25 36.25 22.25 38 24 38 26.5 L38 32.5 47 32.5 47 22.5 Q47 17.5 42 17.5 M21.5 14.5 L42.5 14.5 Q50 14.75 50 22.5 L50 42.5 Q50 49.1 45.3 53.8 40.6 58.5 34 58.5 L30 58.5 Q23.4 58.5 18.7 53.8 14 49.1 14 42.5 L14 22.5 Q14 14.75 21.5 14.5 M17 22.5 L17 32.5 26 32.5 26 26.5 Q26 24 27.75 22.25 28.75 21.25 30 20.85 L30 17.5 22 17.5 Q17 17.5 17 22.5 M47 42.5 L47 35.5 37.95 35.5 Q37.65 37.35 36.25 38.75 34.5 40.5 32 40.5 29.5 40.5 27.75 38.75 26.35 37.35 26.1 35.5 L17 35.5 17 42.5 Q17 47.85 20.85 51.7 24.65 55.5 30 55.5 L34 55.5 Q39.35 55.5 43.2 51.7 47 47.85 47 42.5 M30.85 53 L24.45 46.35 Q24 45.85 24 45.15 24 44.45 24.45 44 24.9 43.5 25.6 43.5 L38.4 43.5 Q39.05 43.5 39.55 44 40 44.45 40 45.15 40 45.85 39.55 46.35 L33.15 53 Q32.65 53.5 32 53.5 31.3 53.5 30.85 53 M30.85 9 Q31.3 8.5 32 8.5 32.65 8.5 33.15 9 L39.55 15.65 Q40 16.15 40 16.85 40 17.55 39.55 18 39.05 18.5 38.4 18.5 L25.6 18.5 Q24.9 18.5 24.45 18 24 17.55 24 16.85 24 16.15 24.45 15.65 L30.85 9',
  },
  middle: {
    label: msg`Middle button`,
    path: 'M21.5 10 L42.5 10 Q50 10.25 50 18 L50 38 Q50 44.6 45.3 49.3 40.6 54 34 54 L30 54 Q23.4 54 18.7 49.3 14 44.6 14 38 L14 18 Q14 10.25 21.5 10 M17 18 L17 28 26 28 26 22 Q26 19.5 27.75 17.75 28.75 16.75 30 16.35 L30 13 22 13 Q17 13 17 18 M47 38 L47 31 37.95 31 Q37.65 32.85 36.25 34.25 34.5 36 32 36 29.5 36 27.75 34.25 26.35 32.85 26.1 31 L17 31 17 38 Q17 43.35 20.85 47.2 24.65 51 30 51 L34 51 Q39.35 51 43.2 47.2 47 43.35 47 38 M42 13 L34 13 34 16.35 Q35.25 16.75 36.25 17.75 38 19.5 38 22 L38 28 47 28 47 18 Q47 13 42 13',
  },
  right: {
    label: msg`Right-click`,
    path: 'M21.5 10 L42.5 10 Q50 10.25 50 18 L50 38 Q50 44.6 45.3 49.3 40.6 54 34 54 L30 54 Q23.4 54 18.7 49.3 14 44.6 14 38 L14 18 Q14 10.25 21.5 10 M17 18 L17 28 26 28 26 22 Q26 19.5 27.75 17.75 28.75 16.75 30 16.35 L30 13 22 13 Q17 13 17 18 M47 38 L47 31 37.95 31 Q37.65 32.85 36.25 34.25 34.5 36 32 36 29.5 36 27.75 34.25 26.35 32.85 26.1 31 L17 31 17 38 Q17 43.35 20.85 47.2 24.65 51 30 51 L34 51 Q39.35 51 43.2 47.2 47 43.35 47 38 M29.9 19.9 Q29 20.75 29 22 L29 30 Q29 31.25 29.9 32.15 30.75 33 32 33 33.25 33 34.15 32.15 35 31.25 35 30 L35 22 Q35 20.75 34.15 19.9 33.25 19 32 19 30.75 19 29.9 19.9',
  },
} as const satisfies Record<
  string,
  { readonly label: MessageDescriptor; readonly path: string }
>;
/* eslint-enable lingui/no-unlocalized-strings */

/** A keycap label, or a mouse gesture drawn as an icon. */
type InputToken = string | { readonly gesture: keyof typeof mouseGestures };

interface KeyGuideRow {
  readonly label: MessageDescriptor;
  /** Combinations, each listing the keys and gestures used together. */
  readonly combinations: readonly (readonly InputToken[])[];
  /**
   * How combinations relate: alternatives (`or`), the two ends of a range, or a list of
   * separate keys such as the arrows.
   */
  readonly join: 'or' | 'range' | 'list';
}

interface KeyGuideGroup {
  readonly title: MessageDescriptor;
  readonly note?: MessageDescriptor;
  readonly rows: readonly KeyGuideRow[];
}

function shortcutRow(
  label: MessageDescriptor,
  action: KeyboardShortcutAction,
): KeyGuideRow {
  return {
    label,
    combinations: keyboardShortcutKeyCombinations({ action }),
    join: 'or',
  };
}

/* eslint-disable lingui/no-unlocalized-strings -- Keycap labels are machine tokens. */
/**
 * Every global shortcut, Escape, MapLibre's own camera keys, and the mouse gestures. The
 * keys form two columns, the workspace and the map; the mouse gestures run under both.
 * Built at render because keycap labels depend on the platform.
 */
function keyGuide(): {
  readonly columns: readonly (readonly KeyGuideGroup[])[];
  readonly mouse: KeyGuideGroup;
} {
  const shift = shiftKeyLabel();
  // The look-around drag reads the Control key on every platform, also on macOS.
  const ctrl = isMacPlatform() ? '⌃' : 'Ctrl';
  const drag = { gesture: 'drag' } as const;
  const lastBasemap = basemapPresets.at(-1) ?? basemapPresets[0];
  const workspace: readonly KeyGuideGroup[] = [
    {
      title: msg`Workspace`,
      rows: [
        shortcutRow(msg`Search places, coordinates, and tracks`, 'focus-search'),
        shortcutRow(msg`Show or hide the navigation`, 'toggle-navigation'),
        shortcutRow(msg`Plan a route`, 'new-track'),
        shortcutRow(msg`Place a marker`, 'place-marker'),
        shortcutRow(msg`Choose a forecast point`, 'select-forecast-point'),
        shortcutRow(msg`Search satellite scenes at the map centre`, 'search-satellite'),
        shortcutRow(msg`Copy a link to this map view`, 'copy-map-link'),
        {
          label: msg`Cancel placing, point selection, or the ruler`,
          combinations: [['Esc']],
          join: 'or',
        },
      ],
    },
    {
      title: msg`Tracks`,
      rows: [
        shortcutRow(msg`Fit the map to the track`, 'fit-track'),
        shortcutRow(msg`Undo the last edit`, 'undo'),
        shortcutRow(msg`Save the track`, 'save'),
        shortcutRow(msg`Open a track file`, 'import-track'),
        shortcutRow(msg`Download the track as GPX`, 'download-gpx'),
      ],
    },
  ];
  const map: readonly KeyGuideGroup[] = [
    {
      title: msg`Map`,
      rows: [
        {
          label: msg`Choose a base map`,
          combinations: [
            keyboardShortcutKeys({
              action: 'select-basemap',
              preset: basemapPresets[0],
            }),
            keyboardShortcutKeys({ action: 'select-basemap', preset: lastBasemap }),
          ],
          join: 'range',
        },
        {
          label: msg`Next or previous base map`,
          combinations: [
            keyboardShortcutKeys({ action: 'next-basemap' }),
            keyboardShortcutKeys({ action: 'previous-basemap' }),
          ],
          join: 'or',
        },
        shortcutRow(msg`Show Sentinel-2 imagery`, 'show-sentinel-2'),
        shortcutRow(msg`Turn the OSM overlay on or off`, 'toggle-osm-overlay'),
        shortcutRow(msg`Turn the ruler on or off`, 'toggle-ruler'),
      ],
    },
    {
      title: msg`Map camera`,
      note: msg`Arrow, plus, and minus keys work after you click the map.`,
      rows: [
        shortcutRow(msg`Switch between 2D and 3D`, 'toggle-terrain'),
        shortcutRow(msg`Turn the map north`, 'north-up'),
        shortcutRow(msg`Find my location`, 'geolocate'),
        {
          label: msg`Move the map`,
          combinations: [['←'], ['↑'], ['→'], ['↓']],
          join: 'list',
        },
        { label: msg`Zoom in or out`, combinations: [['+'], ['−']], join: 'list' },
        {
          label: msg`Rotate`,
          combinations: [
            [shift, '←'],
            [shift, '→'],
          ],
          join: 'or',
        },
        {
          label: msg`Tilt`,
          combinations: [
            [shift, '↑'],
            [shift, '↓'],
          ],
          join: 'or',
        },
      ],
    },
  ];
  const mouse: KeyGuideGroup = {
    title: msg`Mouse`,
    rows: [
      { label: msg`Move the map`, combinations: [[drag]], join: 'or' },
      {
        label: msg`Zoom in or out`,
        combinations: [[{ gesture: 'wheel' }]],
        join: 'or',
      },
      {
        label: msg`Rotate and tilt in 3D`,
        combinations: [
          [shift, drag],
          [{ gesture: 'middle' }, drag],
        ],
        join: 'or',
      },
      { label: msg`Look around in 3D`, combinations: [[ctrl, drag]], join: 'or' },
      {
        label: msg`Actions for a point`,
        combinations: [[{ gesture: 'right' }]],
        join: 'or',
      },
    ],
  };
  return { columns: [workspace, map], mouse };
}
/* eslint-enable lingui/no-unlocalized-strings */

function InputTokenView({ token }: { readonly token: InputToken }) {
  const { i18n } = useLingui();
  if (typeof token === 'string') return <Keycap label={token} />;
  const gesture = mouseGestures[token.gesture];
  return (
    <SvgIcon
      viewBox="0 0 64 64"
      titleAccess={i18n._(gesture.label)}
      sx={{ fontSize: 26, display: 'block' }}
    >
      <path d={gesture.path} />
    </SvgIcon>
  );
}

function tokenKey(token: InputToken): string {
  return typeof token === 'string' ? token : token.gesture;
}

function KeyCombinations({ row }: { readonly row: KeyGuideRow }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        columnGap: 0.75,
        whiteSpace: 'nowrap',
      }}
    >
      {row.combinations.map((tokens, index) => (
        <Fragment key={tokens.map(tokenKey).join(' ')}>
          {index === 0 || row.join === 'list' ? null : (
            <Typography component="span" variant="caption" color="text.secondary">
              {row.join === 'range' ? '–' : <Trans>or</Trans>}
            </Typography>
          )}
          <Box
            component="span"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            {tokens.map((token) => (
              <InputTokenView key={tokenKey(token)} token={token} />
            ))}
          </Box>
        </Fragment>
      ))}
    </Box>
  );
}

/* eslint-disable lingui/no-unlocalized-strings -- CSS grid tracks and breakpoint names. */
const guideColumns = { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' };
/* eslint-enable lingui/no-unlocalized-strings */
const guideColumnGap = 4;

function KeyRowList({ rows }: { readonly rows: readonly KeyGuideRow[] }) {
  const { i18n } = useLingui();
  return (
    <Box
      component="dl"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        alignContent: 'start',
        columnGap: 2,
        rowGap: 0.5,
        m: 0,
      }}
    >
      {rows.map((row) => (
        <Fragment key={row.label.id}>
          <Typography component="dt" variant="body2">
            {i18n._(row.label)}
          </Typography>
          <Box
            component="dd"
            sx={{ m: 0, display: 'flex', justifyContent: 'flex-end' }}
          >
            <KeyCombinations row={row} />
          </Box>
        </Fragment>
      ))}
    </Box>
  );
}

/** One group; `split` lays its rows out in the guide's columns instead of one list. */
function KeyGuideGroupList({
  group,
  split = false,
}: {
  readonly group: KeyGuideGroup;
  readonly split?: boolean;
}) {
  const { i18n } = useLingui();
  const half = Math.ceil(group.rows.length / 2);
  return (
    <Box sx={split ? { gridColumn: '1 / -1' } : undefined}>
      <Typography
        variant="caption"
        color="text.secondary"
        component="h4"
        sx={{ fontWeight: 700 }}
      >
        {i18n._(group.title)}
      </Typography>
      {group.note === undefined ? null : (
        <Typography variant="caption" color="text.secondary" component="p">
          {i18n._(group.note)}
        </Typography>
      )}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: split ? guideColumns : 'minmax(0, 1fr)',
          columnGap: guideColumnGap,
          rowGap: 0.5,
          mt: 0.5,
        }}
      >
        {split ? (
          <>
            <KeyRowList rows={group.rows.slice(0, half)} />
            <KeyRowList rows={group.rows.slice(half)} />
          </>
        ) : (
          <KeyRowList rows={group.rows} />
        )}
      </Box>
    </Box>
  );
}

function KeyboardAndMouseGuide() {
  const titleId = useId();
  const { columns, mouse } = keyGuide();
  return (
    <Box component="section" aria-labelledby={titleId} sx={{ flex: 1, minWidth: 0 }}>
      <Typography
        id={titleId}
        component="h3"
        variant="subtitle2"
        sx={{ fontWeight: 700, mb: 1 }}
      >
        <Trans>Keyboard and mouse</Trans>
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: guideColumns,
          columnGap: guideColumnGap,
          rowGap: 1.5,
        }}
      >
        {columns.map((groups) => (
          <Stack key={groups[0]?.title.id} spacing={1.5}>
            {groups.map((group) => (
              <KeyGuideGroupList key={group.title.id} group={group} />
            ))}
          </Stack>
        ))}
        <KeyGuideGroupList group={mouse} split />
      </Box>
    </Box>
  );
}

/**
 * The map legend and, unless the primary pointer is coarse, the keyboard and mouse
 * controls. From the `lg` breakpoint they sit side by side with a vertical divider;
 * narrower viewports stack them.
 */
export function HelpPanel() {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Breakpoint name.
  const wide = useMediaQuery((theme: Theme) => theme.breakpoints.up('lg'));
  const touchFirst = useMediaQuery(touchFirstQuery);
  return (
    <Stack
      direction={wide ? 'row' : 'column'}
      spacing={4}
      divider={<Divider flexItem orientation={wide ? 'vertical' : 'horizontal'} />}
    >
      <MapLegend />
      {touchFirst ? null : <KeyboardAndMouseGuide />}
    </Stack>
  );
}

/**
 * Help opened from the rail. The smartphone layout shows it full screen and without the
 * tour, which is desktop-only.
 */
export function HelpDialog({
  open,
  smartphoneViewport,
  onClose,
  onStartTour,
}: {
  readonly open: boolean;
  readonly smartphoneViewport: boolean;
  readonly onClose: () => void;
  readonly onStartTour: () => void;
}) {
  const { t } = useLingui();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullScreen={smartphoneViewport}
      // Wider than this, the shortcut columns only spread labels and keys apart.
      slotProps={{ paper: { sx: { maxWidth: smartphoneViewport ? undefined : 1440 } } }}
    >
      <DialogTitle sx={{ pr: 7 }}>
        <Trans>Help</Trans>
      </DialogTitle>
      <DialogContent>
        <HelpPanel />
      </DialogContent>
      {smartphoneViewport ? null : (
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            variant="contained"
            startIcon={<TourOutlinedIcon />}
            onClick={onStartTour}
          >
            <Trans>Take a tour!</Trans>
          </Button>
        </DialogActions>
      )}
      {/* A sibling of the title, so the dialog's accessible name stays "Help". */}
      <IconButton
        size="small"
        aria-label={t`Close`}
        onClick={onClose}
        sx={{ position: 'absolute', top: 12, right: 12 }}
      >
        <CloseIcon sx={{ fontSize: 20 }} />
      </IconButton>
    </Dialog>
  );
}
