import AcUnitOutlinedIcon from '@mui/icons-material/AcUnitOutlined';
import AirOutlinedIcon from '@mui/icons-material/AirOutlined';
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined';
import FilterDramaOutlinedIcon from '@mui/icons-material/FilterDramaOutlined';
import FoggyIcon from '@mui/icons-material/Foggy';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import NightsStayOutlinedIcon from '@mui/icons-material/NightsStayOutlined';
import SevereColdOutlinedIcon from '@mui/icons-material/SevereColdOutlined';
import ThunderstormOutlinedIcon from '@mui/icons-material/ThunderstormOutlined';
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined';
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined';
import { Box, ClickAwayListener, Tooltip, type SvgIconProps } from '@mui/material';
import { useRef, useState, type ReactElement } from 'react';

import type {
  VisibilityStatus,
  WeatherIcon,
} from '@/domain/weather/aggregateDailyWeatherStatus';
import { describeWmoWeatherCode } from '@/presentation/weather/weatherConditionLabels';

interface WeatherConditionIconProps {
  readonly code: number;
  readonly isDay: boolean;
  readonly size?: number;
}

interface WeatherIconTooltipProps {
  readonly children: ReactElement;
  readonly label: string;
}

export function WeatherIconTooltip({ children, label }: WeatherIconTooltipProps) {
  const [open, setOpen] = useState(false);
  const touchPointer = useRef(false);

  return (
    <ClickAwayListener
      onClickAway={() => {
        setOpen(false);
      }}
    >
      <Tooltip
        title={label}
        arrow
        open={open}
        onOpen={() => {
          setOpen(true);
        }}
        onClose={() => {
          setOpen(false);
        }}
        disableFocusListener
        disableTouchListener
      >
        <Box
          component="span"
          aria-label={label}
          tabIndex={0}
          onFocus={() => {
            if (!touchPointer.current) setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
          }}
          onPointerDown={(event) => {
            touchPointer.current = event.pointerType === 'touch';
          }}
          onPointerUp={(event) => {
            if (event.pointerType !== 'touch') return;
            setOpen((isOpen) => !isOpen);
            queueMicrotask(() => {
              touchPointer.current = false;
            });
          }}
          onPointerCancel={() => {
            touchPointer.current = false;
            setOpen(false);
          }}
          sx={{
            display: 'inline-grid',
            placeItems: 'center',
            flexShrink: 0,
            lineHeight: 0,
            cursor: 'help',
            outlineOffset: 2,
          }}
        >
          {children}
        </Box>
      </Tooltip>
    </ClickAwayListener>
  );
}

function iconForWmoCode(code: number, isDay: boolean): ReactElement<SvgIconProps> {
  if (code === 0) {
    return isDay ? (
      <WbSunnyOutlinedIcon sx={{ color: 'warning.main' }} />
    ) : (
      <NightsStayOutlinedIcon sx={{ color: 'info.light' }} />
    );
  }
  if (code === 1 || code === 2) {
    return <FilterDramaOutlinedIcon sx={{ color: 'text.secondary' }} />;
  }
  if (code === 3) return <CloudOutlinedIcon sx={{ color: 'text.secondary' }} />;
  if (code === 45 || code === 48) {
    return <FoggyIcon sx={{ color: 'text.secondary' }} />;
  }
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
    return <WaterDropOutlinedIcon sx={{ color: 'info.main' }} />;
  }
  if ([56, 57, 66, 67].includes(code)) {
    return <SevereColdOutlinedIcon sx={{ color: 'error.main' }} />;
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return <AcUnitOutlinedIcon sx={{ color: 'info.light' }} />;
  }
  if (code === 95 || code === 96 || code === 99) {
    return <ThunderstormOutlinedIcon sx={{ color: 'warning.dark' }} />;
  }
  return <HelpOutlineOutlinedIcon sx={{ color: 'text.secondary' }} />;
}

export function WeatherConditionIcon({
  code,
  isDay,
  size = 28,
}: WeatherConditionIconProps) {
  return (
    <WeatherIconTooltip label={describeWmoWeatherCode(code)}>
      <Box
        aria-hidden="true"
        sx={{
          width: size,
          height: size,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          '& .MuiSvgIcon-root': { fontSize: size },
        }}
      >
        {iconForWmoCode(code, isDay)}
      </Box>
    </WeatherIconTooltip>
  );
}

function layerSx(
  fontSize: number,
  left: number,
  top: number,
  color: string,
): SvgIconProps['sx'] {
  return {
    position: 'absolute',
    left,
    top,
    fontSize,
    color,
  };
}

export function DailyWeatherIcon({
  icon,
  label,
}: {
  readonly icon: WeatherIcon;
  readonly label: string;
}) {
  const skyLayers: ReactElement[] = [];
  switch (icon.sky) {
    case 'clear':
      skyLayers.push(
        <WbSunnyOutlinedIcon key="sun" sx={layerSx(24, 6, 2, 'warning.main')} />,
      );
      break;
    case 'mostly_clear':
      skyLayers.push(
        <WbSunnyOutlinedIcon key="sun" sx={layerSx(20, 2, 1, 'warning.main')} />,
        <CloudOutlinedIcon key="cloud" sx={layerSx(22, 13, 8, 'text.secondary')} />,
      );
      break;
    case 'partly_cloudy':
      skyLayers.push(
        <WbSunnyOutlinedIcon key="sun" sx={layerSx(18, 1, 1, 'warning.main')} />,
        <FilterDramaOutlinedIcon
          key="cloud"
          sx={layerSx(27, 8, 6, 'text.secondary')}
        />,
      );
      break;
    case 'mostly_cloudy':
      skyLayers.push(
        <CloudOutlinedIcon key="back" sx={layerSx(21, 2, 3, 'text.disabled')} />,
        <FilterDramaOutlinedIcon
          key="front"
          sx={layerSx(28, 7, 6, 'text.secondary')}
        />,
      );
      break;
    case 'overcast':
      skyLayers.push(
        <CloudOutlinedIcon key="back" sx={layerSx(25, 1, 4, 'text.disabled')} />,
        <CloudOutlinedIcon key="front" sx={layerSx(27, 10, 7, 'text.secondary')} />,
      );
      break;
  }

  let phenomenon: ReactElement | null = null;
  switch (icon.phenomenon) {
    case null:
      break;
    case 'isolated_showers':
    case 'showers':
    case 'occasional_rain':
    case 'rain':
    case 'heavy_rain':
      phenomenon = <WaterDropOutlinedIcon sx={layerSx(15, 18, 21, 'info.main')} />;
      break;
    case 'snow_showers':
    case 'occasional_snow':
    case 'snow':
      phenomenon = <AcUnitOutlinedIcon sx={layerSx(16, 18, 20, 'info.light')} />;
      break;
    case 'mixed':
      phenomenon = (
        <>
          <WaterDropOutlinedIcon sx={layerSx(13, 15, 22, 'info.main')} />
          <AcUnitOutlinedIcon sx={layerSx(13, 24, 21, 'info.light')} />
        </>
      );
      break;
    case 'freezing':
      phenomenon = <SevereColdOutlinedIcon sx={layerSx(17, 18, 19, 'error.main')} />;
      break;
  }

  return (
    <WeatherIconTooltip label={label}>
      <Box
        aria-hidden="true"
        sx={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}
      >
        {skyLayers}
        {phenomenon}
      </Box>
    </WeatherIconTooltip>
  );
}

export function VisibilityStatusIcon({
  status,
}: {
  readonly status: VisibilityStatus;
}) {
  if (status.icon === null || status.label === null) return null;

  return (
    <WeatherIconTooltip label={status.label}>
      <Box
        aria-hidden="true"
        sx={{ display: 'inline-grid', placeItems: 'center', width: 16, height: 16 }}
      >
        {status.icon === 'fog' ? (
          <FoggyIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
        ) : (
          <AirOutlinedIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
        )}
      </Box>
    </WeatherIconTooltip>
  );
}
