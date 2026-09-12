import CloseFullscreenOutlinedIcon from '@mui/icons-material/CloseFullscreenOutlined';
import AcUnitOutlinedIcon from '@mui/icons-material/AcUnitOutlined';
import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import ChevronRightOutlinedIcon from '@mui/icons-material/ChevronRightOutlined';
import OpenInFullOutlinedIcon from '@mui/icons-material/OpenInFullOutlined';
import { Box, IconButton, Paper, Stack, Typography } from '@mui/material';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TransitionEvent as ReactTransitionEvent,
} from 'react';
import { createPortal } from 'react-dom';

import type { PointWeatherForecast } from '@/application/weather/GetPointWeatherForecast';
import type { HourlyWeatherForecast } from '@/application/ports/WeatherForecastGateway';
import { appColors } from '@/presentation/theme/appColors';
import { WeatherConditionIcon } from '@/presentation/weather/WeatherConditionIcon';
import { describeWmoWeatherCode } from '@/presentation/weather/weatherConditionLabels';
import { formatWeatherMillimetresValue } from '@/presentation/weather/weatherFormatters';

const labelColumnWidth = 64;
const hourColumnWidth = 40;
const visibleHourCount = 24;
const dataWidth = hourColumnWidth * visibleHourCount;
const tableWidth = labelColumnWidth + dataWidth;
const expandedPanelWidth = tableWidth + 2;
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const hourlyChartBottom = 56;
const temperatureChartTop = 26;
const precipitationChartTop = 32;
const precipitationBarWidth = 10;
type WindSeverity = 'neutral' | 'strong' | 'critical';
type WindMetric = 'wind' | 'gusts';

interface HourlyCellStyle {
  readonly color: string;
  readonly fontWeight: number;
}
const criticalWindCellStyle: HourlyCellStyle = {
  color: 'error.main',
  fontWeight: 700,
};
const strongWindCellStyle: HourlyCellStyle = {
  color: 'warning.dark',
  fontWeight: 700,
};
interface MouseDragState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startScrollLeft: number;
}
type ExpansionPhase = 'compact' | 'opening' | 'open' | 'closing';
interface ExpandedLayout {
  readonly left: number;
  readonly top: number;
  readonly height: number;
  readonly compactWidth: number;
}

interface HourlyRowProps {
  readonly label: string;
  readonly hours: readonly HourlyWeatherForecast[];
  readonly height: number;
  readonly chart?: ReactNode;
  readonly cellStyle?: (hour: HourlyWeatherForecast) => HourlyCellStyle | undefined;
  readonly cellRole?: 'cell' | 'columnheader';
  readonly cellLabel: (hour: HourlyWeatherForecast) => string;
  readonly renderCell: (hour: HourlyWeatherForecast, index: number) => ReactNode;
}

function localWeekday(timestamp: string): string {
  const date = timestamp.slice(0, 10);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const weekday = weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  if (weekday === undefined) throw new RangeError('Invalid local forecast date.');
  return weekday;
}
function startsLocalDay(
  hours: readonly HourlyWeatherForecast[],
  index: number,
): boolean {
  if (index === 0) return true;
  const hour = hours[index];
  const previousHour = hours[index - 1];
  return (
    hour !== undefined &&
    previousHour !== undefined &&
    hour.time.slice(0, 10) !== previousHour.time.slice(0, 10)
  );
}

function windSeverity(metresPerSecond: number): WindSeverity {
  if (metresPerSecond >= 25) return 'critical';
  if (metresPerSecond >= 15) return 'strong';
  return 'neutral';
}

function windCellStyle(metresPerSecond: number): HourlyCellStyle | undefined {
  const severity = windSeverity(metresPerSecond);
  if (severity === 'critical') return criticalWindCellStyle;
  if (severity === 'strong') return strongWindCellStyle;
  return undefined;
}
function windMetricMetresPerSecond(
  hour: HourlyWeatherForecast,
  metric: WindMetric,
): number {
  return (metric === 'wind' ? hour.windSpeedKmh : hour.windGustsKmh) / 3.6;
}

interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

const blueRgb = { red: 2, green: 136, blue: 209 } as const;
const greenRgb = { red: 46, green: 173, blue: 91 } as const;
const amberRgb = { red: 255, green: 183, blue: 3 } as const;
const redRgb = { red: 229, green: 57, blue: 53 } as const;
const orangeRgb = { red: 251, green: 133, blue: 0 } as const;
const panelRgb = { red: 255, green: 255, blue: 255 } as const;

function interpolateColor(start: RgbColor, end: RgbColor, progress: number): string {
  const red = Math.round(start.red + (end.red - start.red) * progress);
  const green = Math.round(start.green + (end.green - start.green) * progress);
  const blue = Math.round(start.blue + (end.blue - start.blue) * progress);
  return `rgb(${red.toString()}, ${green.toString()}, ${blue.toString()})`;
}
function windGradientColor(metresPerSecond: number): string {
  if (metresPerSecond <= 0) return appColors.surface.panel;
  if (metresPerSecond < 8) {
    return interpolateColor(panelRgb, greenRgb, metresPerSecond / 8);
  }
  if (metresPerSecond < 15) {
    return interpolateColor(greenRgb, amberRgb, (metresPerSecond - 8) / 7);
  }
  if (metresPerSecond < 20) {
    return interpolateColor(amberRgb, orangeRgb, (metresPerSecond - 15) / 5);
  }
  if (metresPerSecond < 25) {
    return interpolateColor(orangeRgb, redRgb, (metresPerSecond - 20) / 5);
  }
  return appColors.marker.red;
}

function temperatureColor(temperatureCelsius: number): string {
  if (temperatureCelsius <= 0) return appColors.marker.blue;
  if (temperatureCelsius < 10) {
    return interpolateColor(blueRgb, greenRgb, temperatureCelsius / 10);
  }
  if (temperatureCelsius === 10) return appColors.marker.green;
  if (temperatureCelsius < 20) {
    return interpolateColor(greenRgb, amberRgb, (temperatureCelsius - 10) / 10);
  }
  if (temperatureCelsius === 20) return appColors.brand.amber;
  if (temperatureCelsius < 30) {
    return interpolateColor(amberRgb, redRgb, (temperatureCelsius - 20) / 10);
  }
  return appColors.marker.red;
}

function temperatureDomain(hours: readonly HourlyWeatherForecast[]): [number, number] {
  const first = hours[0];
  if (first === undefined) return [-1, 1];
  let minimum = first.temperatureCelsius;
  let maximum = first.temperatureCelsius;
  for (let index = 1; index < hours.length; index += 1) {
    const hour = hours[index];
    if (hour === undefined) continue;
    minimum = Math.min(minimum, hour.temperatureCelsius);
    maximum = Math.max(maximum, hour.temperatureCelsius);
  }
  return minimum === maximum ? [minimum - 1, maximum + 1] : [minimum - 2, maximum + 2];
}
function temperatureChartY(
  temperatureCelsius: number,
  domain: readonly [number, number],
): number {
  const [minimum, maximum] = domain;
  const progress = (temperatureCelsius - minimum) / (maximum - minimum);
  return hourlyChartBottom - progress * (hourlyChartBottom - temperatureChartTop);
}

function precipitationMaximum(hours: readonly HourlyWeatherForecast[]): number {
  let maximum = 0;
  for (const hour of hours) {
    maximum = Math.max(maximum, hour.precipitationMm);
  }
  return Math.max(1, maximum);
}
function precipitationBarY(precipitationMm: number, maximum: number): number {
  const barHeight =
    (precipitationMm / maximum) * (hourlyChartBottom - precipitationChartTop);
  return hourlyChartBottom - barHeight;
}

function TemperatureChart({
  hours,
  domain,
}: {
  readonly hours: readonly HourlyWeatherForecast[];
  readonly domain: readonly [number, number];
}): ReactElement {
  const gradientId = `hourly-temperature-${useId().replaceAll(':', '')}`;
  const coordinates: string[] = [];
  let firstY = hourlyChartBottom;
  let lastY = hourlyChartBottom;
  for (let index = 0; index < hours.length; index += 1) {
    const hour = hours[index];
    if (hour === undefined) continue;
    const x = index * hourColumnWidth + hourColumnWidth / 2;
    const y = temperatureChartY(hour.temperatureCelsius, domain);
    if (index === 0) firstY = y;
    lastY = y;
    coordinates.push(`${x.toString()},${y.toFixed(2)}`);
  }
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={dataWidth}
      height={hourlyChartBottom}
      style={{ display: 'block', pointerEvents: 'none' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          {hours.map((hour, index) => (
            <stop
              key={hour.time}
              offset={`${String(hours.length <= 1 ? 0 : (index / (hours.length - 1)) * 100)}%`}
              stopColor={temperatureColor(hour.temperatureCelsius)}
              data-temperature-celsius={hour.temperatureCelsius}
            />
          ))}
        </linearGradient>
      </defs>
      {coordinates.length === 0 ? null : (
        <polygon
          points={`0,${firstY.toFixed(2)} ${coordinates.join(' ')} ${dataWidth.toString()},${lastY.toFixed(2)} ${dataWidth.toString()},${hourlyChartBottom.toString()} 0,${hourlyChartBottom.toString()}`}
          fill={`url(#${gradientId})`}
          fillOpacity={0.42}
          stroke="none"
          data-temperature-polygon
        />
      )}
    </svg>
  );
}

function PrecipitationChart({
  hours,
  maximum,
}: {
  readonly hours: readonly HourlyWeatherForecast[];
  readonly maximum: number;
}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={dataWidth}
      height={hourlyChartBottom}
      style={{ display: 'block', pointerEvents: 'none' }}
    >
      {hours.map((hour, index) => {
        const barY = precipitationBarY(hour.precipitationMm, maximum);
        const barHeight = hourlyChartBottom - barY;
        const barX =
          index * hourColumnWidth + (hourColumnWidth - precipitationBarWidth) / 2;
        return (
          <g key={hour.time}>
            {barHeight === 0 ? null : (
              <rect
                x={barX}
                y={barY}
                width={precipitationBarWidth}
                height={barHeight}
                rx={2}
                fill={appColors.marker.blue}
                data-precipitation-bar={hour.time}
              />
            )}
            {hour.snowfallCm > 0 ? (
              <AcUnitOutlinedIcon
                aria-hidden
                x={barX - 2}
                y={Math.max(0, barY - 15)}
                width={14}
                height={14}
                htmlColor={appColors.marker.blue}
                data-precipitation-snowflake={hour.time}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
function WindGradient({
  hours,
  metric,
  height,
}: {
  readonly hours: readonly HourlyWeatherForecast[];
  readonly metric: WindMetric;
  readonly height: number;
}): ReactElement {
  const gradientId = `hourly-${metric}-${useId().replaceAll(':', '')}`;
  const first = hours[0];
  const last = hours[hours.length - 1];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={dataWidth}
      height={height}
      style={{ display: 'block', pointerEvents: 'none' }}
      data-wind-gradient={metric}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop
            offset="0%"
            stopColor={
              first === undefined
                ? appColors.surface.panel
                : windGradientColor(windMetricMetresPerSecond(first, metric))
            }
          />
          {hours.map((hour, index) => {
            const speed = windMetricMetresPerSecond(hour, metric);
            return (
              <stop
                key={hour.time}
                offset={`${(((index + 0.5) / hours.length) * 100).toString()}%`}
                stopColor={windGradientColor(speed)}
                data-wind-speed={speed}
              />
            );
          })}
          <stop
            offset="100%"
            stopColor={
              last === undefined
                ? appColors.surface.panel
                : windGradientColor(windMetricMetresPerSecond(last, metric))
            }
          />
        </linearGradient>
      </defs>
      <rect
        width={dataWidth}
        height={height}
        fill={`url(#${gradientId})`}
        fillOpacity={0.72}
      />
    </svg>
  );
}

function HourlyRow({
  label,
  hours,
  height,
  chart,
  cellStyle,
  cellRole = 'cell',
  cellLabel,
  renderCell,
}: HourlyRowProps): ReactElement {
  return (
    <Box
      role="row"
      sx={{
        position: 'relative',
        minWidth: tableWidth,
        height,
        display: 'grid',
        gridTemplateColumns: `${labelColumnWidth.toString()}px repeat(${visibleHourCount.toString()}, ${hourColumnWidth.toString()}px)`,
      }}
    >
      <Box
        role="rowheader"
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 0.75,
          borderRight: 1,
          borderColor: 'divider',
        }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 700, lineHeight: 1.15 }}
        >
          {label}
        </Typography>
      </Box>
      {chart === undefined ? null : (
        <Box
          role="presentation"
          aria-hidden
          sx={{
            position: 'absolute',
            left: labelColumnWidth,
            top: 0,
            zIndex: 0,
            width: dataWidth,
            height,
            pointerEvents: 'none',
          }}
        >
          {chart}
        </Box>
      )}
      {hours.map((hour, index) => {
        const style = cellStyle?.(hour);
        const startsNewDay = index > 0 && startsLocalDay(hours, index);
        return (
          <Box
            key={hour.time}
            role={cellRole}
            aria-label={cellLabel(hour)}
            sx={{
              zIndex: 1,
              position: 'relative',
              minWidth: 0,
              display: 'grid',
              placeItems: 'center',
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
              borderLeft: startsNewDay ? 1 : 0,
              borderColor: 'divider',
              ...style,
            }}
          >
            {renderCell(hour, index)}
          </Box>
        );
      })}
    </Box>
  );
}
function isResizeObserverConstructor(value: unknown): value is typeof ResizeObserver {
  return typeof value === 'function';
}

export function HourlyForecastTable({
  sidebarCollapsed,
  forecast,
}: {
  readonly forecast: PointWeatherForecast;
  readonly sidebarCollapsed: boolean;
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollBackward, setCanScrollBackward] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);
  const mouseDragRef = useRef<MouseDragState | null>(null);
  const [isMouseDragging, setIsMouseDragging] = useState(false);
  const [expandedLayout, setExpandedLayout] = useState<ExpandedLayout | null>(null);
  const [expansionPhase, setExpansionPhase] = useState<ExpansionPhase>('compact');
  const isExpanded = expandedLayout !== null;
  const currentTime = forecast.current.time;
  const hourlyForecast = forecast.hourly;
  const hours = useMemo(() => {
    const nextHours: HourlyWeatherForecast[] = [];
    for (const hour of hourlyForecast) {
      if (hour.time < currentTime) continue;
      nextHours.push(hour);
      if (nextHours.length === visibleHourCount) break;
    }
    return nextHours;
  }, [currentTime, hourlyForecast]);
  const temperatureRange = useMemo(() => temperatureDomain(hours), [hours]);
  const precipitationMaximumMm = useMemo(() => precipitationMaximum(hours), [hours]);
  const collapseExpanded = useCallback(() => {
    if (expandedLayout === null || expansionPhase === 'closing') return;
    if (expansionPhase === 'opening') {
      setExpandedLayout(null);
      setExpansionPhase('compact');
      return;
    }
    setExpansionPhase('closing');
  }, [expandedLayout, expansionPhase]);

  const updateScrollState = useCallback(() => {
    const region = scrollRef.current;
    if (region === null) return;
    setCanScrollBackward(region.scrollLeft > 0);
    setCanScrollForward(
      region.scrollLeft + region.clientWidth < region.scrollWidth - 1,
    );
  }, []);

  useEffect(() => {
    const region = scrollRef.current;
    if (region === null) return undefined;
    if (isExpanded) region.scrollLeft = 0;
    updateScrollState();
    const ResizeObserverConstructor: unknown = Reflect.get(
      globalThis,
      'ResizeObserver',
    );
    if (!isResizeObserverConstructor(ResizeObserverConstructor)) return undefined;
    const observer = new ResizeObserverConstructor(updateScrollState);
    observer.observe(region);
    return () => {
      observer.disconnect();
    };
  }, [hours.length, isExpanded, updateScrollState]);
  useEffect(() => {
    if (expansionPhase !== 'opening') return undefined;
    const frame = requestAnimationFrame(() => {
      if (sidebarCollapsed) {
        setExpandedLayout(null);
        setExpansionPhase('compact');
        return;
      }
      setExpansionPhase('open');
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [expansionPhase, sidebarCollapsed]);
  useEffect(() => {
    if (!isExpanded) return undefined;
    const scrollRegion = containerRef.current?.closest('[data-weather-scroll-region]');
    if (!(scrollRegion instanceof HTMLElement)) return undefined;
    scrollRegion.addEventListener('scroll', collapseExpanded, { passive: true });
    return () => {
      scrollRegion.removeEventListener('scroll', collapseExpanded);
    };
  }, [collapseExpanded, isExpanded]);

  const scroll = (direction: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: direction * 240, behavior: 'smooth' });
  };
  const startMouseDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isExpanded || event.pointerType !== 'mouse' || event.button !== 0) return;
    mouseDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsMouseDragging(true);
    event.preventDefault();
  };

  const moveMouseDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = mouseDragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft =
      drag.startScrollLeft - (event.clientX - drag.startClientX);
    updateScrollState();
    event.preventDefault();
  };

  const finishMouseDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = mouseDragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    mouseDragRef.current = null;
    setIsMouseDragging(false);
    event.preventDefault();
  };
  const toggleExpanded = () => {
    if (expandedLayout !== null) {
      collapseExpanded();
      return;
    }
    const container = containerRef.current;
    if (container === null) return;
    const bounds = container.getBoundingClientRect();
    setExpandedLayout({
      left: Math.max(0, Math.min(bounds.left, window.innerWidth - expandedPanelWidth)),
      top: bounds.top,
      height: bounds.height,
      compactWidth: bounds.width,
    });
    setExpansionPhase('opening');
  };
  const finishWidthTransition = (event: ReactTransitionEvent<HTMLDivElement>) => {
    if (
      event.propertyName !== 'width' ||
      (expansionPhase !== 'closing' && !sidebarCollapsed)
    ) {
      return;
    }
    setExpandedLayout(null);
    setExpansionPhase('compact');
  };
  const header = (
    <Stack direction="row" sx={{ alignItems: 'center' }}>
      <Typography component="h2" variant="subtitle2" sx={{ flex: 1 }}>
        Next 24 hours
      </Typography>
      <IconButton
        size="small"
        aria-label="Scroll hourly forecast backward"
        disabled={isExpanded || !canScrollBackward}
        onClick={() => {
          scroll(-1);
        }}
      >
        <ChevronLeftOutlinedIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label="Scroll hourly forecast forward"
        disabled={isExpanded || !canScrollForward}
        onClick={() => {
          scroll(1);
        }}
      >
        <ChevronRightOutlinedIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label={isExpanded ? 'Collapse hourly forecast' : 'Expand hourly forecast'}
        aria-expanded={isExpanded}
        onClick={toggleExpanded}
      >
        {isExpanded ? (
          <CloseFullscreenOutlinedIcon fontSize="small" />
        ) : (
          <OpenInFullOutlinedIcon fontSize="small" />
        )}
      </IconButton>
    </Stack>
  );
  const table = (
    <Paper
      ref={scrollRef}
      variant="outlined"
      role="table"
      aria-label="Hourly forecast"
      onScroll={updateScrollState}
      onTransitionEnd={finishWidthTransition}
      sx={{
        position: expandedLayout === null ? 'static' : 'fixed',
        left: expandedLayout?.left,
        top: expandedLayout?.top,
        zIndex: expandedLayout === null ? 'auto' : (theme) => theme.zIndex.modal,
        borderRadius: 1.25,
        boxShadow: expandedLayout === null ? 0 : 8,
        width:
          expandedLayout === null
            ? 'auto'
            : expansionPhase === 'open' && !sidebarCollapsed
              ? expandedPanelWidth
              : expandedLayout.compactWidth,
        transition:
          expandedLayout === null
            ? 'none'
            : (theme) =>
                theme.transitions.create('width', {
                  duration: theme.transitions.duration.short,
                }),
        overflowX: isExpanded ? 'hidden' : 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        cursor: isExpanded ? 'default' : isMouseDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      onPointerDown={startMouseDrag}
      onPointerMove={moveMouseDrag}
      onPointerUp={finishMouseDrag}
      onPointerCancel={finishMouseDrag}
      onLostPointerCapture={(event) => {
        if (mouseDragRef.current?.pointerId !== event.pointerId) return;
        mouseDragRef.current = null;
        setIsMouseDragging(false);
      }}
    >
      <HourlyRow
        label="Time"
        hours={hours}
        height={32}
        cellRole="columnheader"
        cellLabel={(hour) => `${hour.time} local time`}
        renderCell={(hour, index) => {
          const startsDay = startsLocalDay(hours, index);
          return (
            <Typography
              variant="caption"
              sx={{ lineHeight: 1.25, fontWeight: startsDay ? 700 : 400 }}
            >
              {startsDay ? localWeekday(hour.time) : hour.time.slice(11, 16)}
            </Typography>
          );
        }}
      />
      <HourlyRow
        label="Weather"
        hours={hours}
        height={44}
        cellLabel={(hour) =>
          `${hour.time} weather ${describeWmoWeatherCode(hour.weatherCode)}`
        }
        renderCell={(hour) => (
          <WeatherConditionIcon code={hour.weatherCode} isDay={hour.isDay} size={28} />
        )}
      />
      <HourlyRow
        label="Temp (°C)"
        hours={hours}
        height={56}
        chart={<TemperatureChart hours={hours} domain={temperatureRange} />}
        cellLabel={(hour) =>
          `${hour.time} temperature ${hour.temperatureCelsius.toString()} degrees Celsius`
        }
        renderCell={(hour) => {
          const labelTop = Math.max(
            0,
            temperatureChartY(hour.temperatureCelsius, temperatureRange) - 18,
          );
          return (
            <Typography
              variant="caption"
              sx={{
                position: 'absolute',
                top: labelTop,
                left: '50%',
                transform: 'translateX(-50%)',
                fontWeight: 700,
              }}
            >
              {Math.round(hour.temperatureCelsius).toString()}°
            </Typography>
          );
        }}
      />
      <HourlyRow
        label="Precip (mm)"
        hours={hours}
        height={56}
        chart={<PrecipitationChart hours={hours} maximum={precipitationMaximumMm} />}
        cellLabel={(hour) =>
          `${hour.time} precipitation ${hour.precipitationMm.toString()} millimetres`
        }
        renderCell={(hour) => {
          const barY = precipitationBarY(hour.precipitationMm, precipitationMaximumMm);
          const labelTop = Math.max(0, barY - (hour.snowfallCm > 0 ? 32 : 18));
          return (
            <Typography
              variant="caption"
              sx={{
                position: 'absolute',
                top: labelTop,
                left: '50%',
                transform: 'translateX(-50%)',
              }}
            >
              {formatWeatherMillimetresValue(hour.precipitationMm)}
            </Typography>
          );
        }}
      />
      <HourlyRow
        label="Wind (m/s)"
        hours={hours}
        height={36}
        chart={<WindGradient hours={hours} metric="wind" height={36} />}
        cellLabel={(hour) => {
          const metresPerSecond = windMetricMetresPerSecond(hour, 'wind');
          const severity = windSeverity(metresPerSecond);
          return `${hour.time} wind ${metresPerSecond.toFixed(1)} metres per second${severity === 'neutral' ? '' : `, ${severity}`}`;
        }}
        cellStyle={(hour) => windCellStyle(windMetricMetresPerSecond(hour, 'wind'))}
        renderCell={(hour) => (
          <Typography variant="caption">
            {windMetricMetresPerSecond(hour, 'wind').toFixed(1)}
          </Typography>
        )}
      />
      <HourlyRow
        label="Gusts (m/s)"
        hours={hours}
        height={36}
        chart={<WindGradient hours={hours} metric="gusts" height={36} />}
        cellLabel={(hour) => {
          const metresPerSecond = windMetricMetresPerSecond(hour, 'gusts');
          const severity = windSeverity(metresPerSecond);
          return `${hour.time} gusts ${metresPerSecond.toFixed(1)} metres per second${severity === 'neutral' ? '' : `, ${severity}`}`;
        }}
        cellStyle={(hour) => windCellStyle(windMetricMetresPerSecond(hour, 'gusts'))}
        renderCell={(hour) => (
          <Typography variant="caption">
            {windMetricMetresPerSecond(hour, 'gusts').toFixed(1)}
          </Typography>
        )}
      />
    </Paper>
  );

  return (
    <Stack spacing={1}>
      {header}
      <Box
        ref={containerRef}
        sx={{ height: expandedLayout === null ? 'auto' : expandedLayout.height }}
      >
        {expandedLayout === null ? table : createPortal(table, document.body)}
      </Box>
    </Stack>
  );
}
