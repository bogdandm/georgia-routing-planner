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
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly children?: ReactNode;
}) {
  return (
    <div>
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
      {children}
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
 * context menu that takes focus; the touch variant is a two-column grid with larger hit
 * areas inside the tap popup, whose close button owns focus.
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
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS keyword.
  const itemSx = touch ? { minHeight: 44, whiteSpace: 'normal' } : undefined;
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
  return (
    <MenuList
      aria-label={t`Map point actions`}
      autoFocus={!touch}
      dense={!touch}
      sx={
        touch
          ? {
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              py: 0,
              mx: -1,
            }
          : undefined
      }
    >
      {pointActions.map(renderItem)}
      <Divider sx={{ gridColumn: '1 / -1' }} />
      {weatherActions.map(renderItem)}
    </MenuList>
  );
}

/** React content for the facade-owned MapLibre point-inspection popup. */
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

  // The popup opens before React fills it, so focus moves here once per opened popup.
  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
  }, []);

  return (
    <Stack spacing={1} sx={{ minWidth: 220 }}>
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
          sx={{ mr: -0.5 }}
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
      >
        {nearbyName === null ? null : (
          <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: 'wrap' }}>
            {/* eslint-disable lingui/no-unlocalized-strings -- External product names and URLs stay invariant. */}
            <Link
              variant="body2"
              href={`https://en.wikipedia.org/wiki/${encodeURIComponent(nearbyName.replaceAll(' ', '_'))}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Wikipedia
            </Link>
            <Link
              variant="body2"
              href={`https://www.google.com/search?q=${encodeURIComponent(`${nearbyName} Georgia`)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Search
            </Link>
            {/* eslint-enable lingui/no-unlocalized-strings */}
          </Stack>
        )}
      </LabelValue>
      {actions === null ? null : (
        <>
          <Divider />
          {actions}
        </>
      )}
    </Stack>
  );
}
