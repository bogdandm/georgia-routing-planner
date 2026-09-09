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
import { Box, type SvgIconProps } from '@mui/material';
import type { ReactElement } from 'react';

import type { WeatherIcon } from '@/domain/weather/aggregateDailyWeatherStatus';

export function describeWmoWeatherCode(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45) return 'Fog';
  if (code === 48) return 'Depositing rime fog';
  if (code === 51) return 'Light drizzle';
  if (code === 53) return 'Moderate drizzle';
  if (code === 55) return 'Dense drizzle';
  if (code === 56) return 'Light freezing drizzle';
  if (code === 57) return 'Dense freezing drizzle';
  if (code === 61) return 'Slight rain';
  if (code === 63) return 'Moderate rain';
  if (code === 65) return 'Heavy rain';
  if (code === 66) return 'Light freezing rain';
  if (code === 67) return 'Heavy freezing rain';
  if (code === 71) return 'Slight snow';
  if (code === 73) return 'Moderate snow';
  if (code === 75) return 'Heavy snow';
  if (code === 77) return 'Snow grains';
  if (code === 80) return 'Slight rain showers';
  if (code === 81) return 'Moderate rain showers';
  if (code === 82) return 'Violent rain showers';
  if (code === 85) return 'Slight snow showers';
  if (code === 86) return 'Heavy snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm with hail';
  return 'Unknown weather';
}

interface WeatherConditionIconProps {
  readonly code: number;
  readonly isDay: boolean;
  readonly size?: number;
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

export function DailyWeatherIcon({ icon }: { readonly icon: WeatherIcon }) {
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
    case 'light_rain':
    case 'rain':
    case 'heavy_rain':
    case 'showers':
      phenomenon = <WaterDropOutlinedIcon sx={layerSx(15, 18, 21, 'info.main')} />;
      break;
    case 'snow_showers':
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

  const visibility =
    icon.visibility === 'fog' ? (
      <FoggyIcon sx={layerSx(19, 0, 18, 'text.secondary')} />
    ) : icon.visibility === 'haze' || icon.visibility === 'poor' ? (
      <AirOutlinedIcon sx={layerSx(17, 0, 20, 'text.secondary')} />
    ) : null;

  return (
    <Box
      aria-hidden="true"
      sx={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}
    >
      {skyLayers}
      {phenomenon}
      {visibility}
    </Box>
  );
}
