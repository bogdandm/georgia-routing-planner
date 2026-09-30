import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import AddLocationAltOutlinedIcon from '@mui/icons-material/AddLocationAltOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import SatelliteAltOutlinedIcon from '@mui/icons-material/SatelliteAltOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import WbCloudyOutlinedIcon from '@mui/icons-material/WbCloudyOutlined';
import {
  Box,
  Divider,
  IconButton,
  Link,
  ListItemIcon,
  ListItemText,
  MenuItem,
  MenuList,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useRef, type ReactNode } from 'react';

import type { MapCoordinate, MapPointInspection } from '@/presentation/map/mapTypes';
import {
  meteoblueForecastUrl,
  windyForecastUrl,
} from '@/presentation/weather/weatherForecastLinks';

type OpenMapPointInspection = Exclude<MapPointInspection, { status: 'closed' }>;

/** Point commands shared by the mouse context menu and the touch point popup. */
export type MapPointAction =
  | 'copy-coordinates'
  | 'copy-point-link'
  | 'create-marker'
  | 'search-satellite'
  | 'show-weather'
  | 'copy-weather-link'
  | 'open-meteoblue'
  | 'open-windy';

// Decimal-degree coordinates keep the same machine-readable form as copied values.
// eslint-disable-next-line lingui/no-unlocalized-strings -- BCP 47 locale token.
const coordinateFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 5,
  maximumFractionDigits: 5,
});

function elevationText(
  inspection: OpenMapPointInspection,
  measurementFormatter: Intl.NumberFormat,
  i18n: I18n,
): string {
  switch (inspection.elevation.status) {
    case 'loading':
      return i18n._(msg`Loading elevation…`);
    case 'available': {
      const elevation = measurementFormatter.format(inspection.elevation.meters);
      return i18n._(msg`${elevation} m`);
    }
    case 'unavailable':
      return i18n._(msg`Elevation is unavailable here.`);
    case 'error':
      return i18n._(msg`Elevation could not be loaded.`);
  }
}

function nearbyFeatureText(
  inspection: OpenMapPointInspection,
  measurementFormatter: Intl.NumberFormat,
  i18n: I18n,
): string {
  switch (inspection.nearbyPoi.status) {
    case 'loading':
      return i18n._(msg`Checking nearby map data…`);
    case 'none':
      return i18n._(msg`No named map feature found.`);
    case 'error':
      return i18n._(msg`Nearby map data could not be inspected.`);
    case 'found': {
      const poi = inspection.nearbyPoi.poi;
      const name = poi.name ?? i18n._(msg`Unnamed map feature`);
      const distance = measurementFormatter.format(poi.distanceMeters);
      if (poi.category === null) return i18n._(msg`${name}, ${distance} m away`);
      const category = poi.category.replaceAll('_', ' ');
      return i18n._(msg`${name} (${category}), ${distance} m away`);
    }
  }
}

function LabelValue({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
    </div>
  );
}

interface MapPointActionEntry {
  readonly action: MapPointAction;
  readonly icon: ReactNode;
  readonly label: string;
  readonly href?: string;
}

/**
 * Renders every map-point action as one menu list. The mouse variant is a standalone
 * context menu that takes focus; the touch variant has taller rows inside the point
 * bottom sheet, whose close button owns focus.
 */
export function MapPointActionList({
  coordinate,
  touch,
  onSelect,
}: {
  readonly coordinate: MapCoordinate;
  readonly touch: boolean;
  readonly onSelect: (action: MapPointAction) => void;
}) {
  const { t } = useLingui();
  const pointActions: readonly MapPointActionEntry[] = [
    {
      action: 'copy-coordinates',
      icon: <ContentCopyOutlinedIcon />,
      label: t`Copy coordinates`,
    },
    {
      action: 'copy-point-link',
      icon: <ShareOutlinedIcon />,
      label: t`Copy link to this point`,
    },
    {
      action: 'create-marker',
      icon: <AddLocationAltOutlinedIcon />,
      label: t`Create marker here`,
    },
    {
      action: 'search-satellite',
      icon: <SatelliteAltOutlinedIcon />,
      label: t`Search satellite scenes here`,
    },
  ];
  const weatherActions: readonly MapPointActionEntry[] = [
    {
      action: 'show-weather',
      icon: <WbCloudyOutlinedIcon />,
      label: t`Show weather forecast`,
    },
    {
      action: 'copy-weather-link',
      icon: <LinkOutlinedIcon />,
      label: t`Copy weather map link`,
    },
    {
      action: 'open-meteoblue',
      icon: <OpenInNewOutlinedIcon />,
      label: t`Open meteoblue.com`,
      href: meteoblueForecastUrl(coordinate),
    },
    {
      action: 'open-windy',
      icon: <OpenInNewOutlinedIcon />,
      label: t`Open windy.com`,
      href: windyForecastUrl(coordinate),
    },
  ];
  // Dense rows keep the tap popup short; 40 px still leaves a comfortable touch target.
  const itemSx = touch ? { minHeight: 40 } : undefined;
  const renderItem = ({ action, icon, label, href }: MapPointActionEntry) => {
    const select = () => {
      onSelect(action);
    };
    const content = (
      <>
        <ListItemIcon sx={{ '& > svg': { fontSize: 20 } }}>{icon}</ListItemIcon>
        <ListItemText slotProps={{ primary: { variant: 'body2' } }}>
          {label}
        </ListItemText>
      </>
    );
    return href === undefined ? (
      <MenuItem key={action} sx={itemSx} onClick={select}>
        {content}
      </MenuItem>
    ) : (
      <MenuItem
        key={action}
        component="a"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        sx={itemSx}
        onClick={select}
      >
        {content}
      </MenuItem>
    );
  };
  // The touch list bleeds into the sheet padding so row highlights span the sheet while
  // icons and dividers stay on the same left edge as the point details above.
  return (
    <MenuList
      aria-label={t`Map point actions`}
      autoFocus={!touch}
      dense
      sx={touch ? { py: 0, mx: -2 } : undefined}
    >
      {pointActions.map(renderItem)}
      {/* `&&` outranks MenuItem's `+ .MuiDivider-root` 8 px margin rule. */}
      <Divider sx={touch ? { mx: 2, '&&': { my: 0.25 } } : undefined} />
      {weatherActions.map(renderItem)}
    </MenuList>
  );
}

/** Point-inspection details for the mouse popup or the touch bottom sheet. */
export function MapPointInspectorContent({
  inspection,
  actions,
  onClose,
}: {
  readonly inspection: OpenMapPointInspection;
  readonly actions: ReactNode;
  readonly onClose: () => void;
}) {
  const { i18n, t } = useLingui();
  const closeButton = useRef<HTMLButtonElement>(null);
  const measurementFormatter = new Intl.NumberFormat(i18n.locale, {
    maximumFractionDigits: 0,
  });
  const nearbyName =
    inspection.nearbyPoi.status === 'found' ? inspection.nearbyPoi.poi.name : null;
  /* eslint-disable lingui/no-unlocalized-strings -- External product names and URLs stay invariant. */
  const featureLinks: readonly { readonly label: string; readonly href: string }[] =
    nearbyName === null
      ? []
      : [
          {
            label: 'Wikipedia',
            href: `https://en.wikipedia.org/wiki/${encodeURIComponent(nearbyName.replaceAll(' ', '_'))}`,
          },
          {
            label: 'Google Search',
            href: `https://www.google.com/search?q=${encodeURIComponent(`${nearbyName} Georgia`)}`,
          },
        ];
  /* eslint-enable lingui/no-unlocalized-strings */

  // The native popup opens before React fills it, so focus moves here once per opening.
  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
  }, []);

  // Vertical rhythm: 12 px between the header and detail groups. A divider has 12 px of
  // visual space on both sides: the stack gap above it, and 2 px plus the 10 px row
  // padding of a 40 px action row below it.
  return (
    // Flex gap keeps child margins intact; Stack's margin spacing would reset them.
    <Stack spacing={1.5} useFlexGap sx={{ minWidth: 220 }}>
      <Box
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography
          id="map-point-inspector-title"
          variant="subtitle2"
          component="strong"
          sx={{ fontWeight: 700 }}
        >
          {t`Map point`}
        </Typography>
        <IconButton
          ref={closeButton}
          size="small"
          aria-label={t`Close map point details`}
          onClick={onClose}
          // Negative block margin keeps the 30 px button from adding space under the title.
          sx={{ mr: -0.5, my: -0.5 }}
        >
          <CloseOutlinedIcon fontSize="small" />
        </IconButton>
      </Box>
      <LabelValue
        label={t`Coordinates`}
        value={`${coordinateFormatter.format(inspection.coordinate.latitude)}, ${coordinateFormatter.format(inspection.coordinate.longitude)}`}
      />
      <LabelValue
        label={t`Terrain elevation`}
        value={elevationText(inspection, measurementFormatter, i18n)}
      />
      <LabelValue
        label={t`Nearby map feature`}
        value={nearbyFeatureText(inspection, measurementFormatter, i18n)}
      />
      {featureLinks.length === 0 ? null : (
        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {featureLinks.map(({ label, href }) => (
            <Link
              key={label}
              variant="body2"
              // eslint-disable-next-line lingui/no-unlocalized-strings -- MUI prop token.
              underline="hover"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
            >
              {label}
              <OpenInNewOutlinedIcon sx={{ fontSize: 14 }} />
            </Link>
          ))}
        </Stack>
      )}
      {actions === null ? null : (
        <div>
          <Divider sx={{ mb: 0.25 }} />
          {actions}
        </div>
      )}
    </Stack>
  );
}
