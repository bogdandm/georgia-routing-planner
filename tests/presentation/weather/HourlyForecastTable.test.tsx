import { ThemeProvider } from '@mui/material';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_WEATHER_MODEL,
  type PointWeatherForecast,
} from '@/application/weather/GetPointWeatherForecast';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { appColors } from '@/presentation/theme/appColors';
import { HourlyForecastTable } from '@/presentation/weather/HourlyForecastTable';
import { createTestServices } from '@test/helpers/createTestServices';

const theme = createAppTheme();

async function syntheticForecast(startIndex = 0): Promise<PointWeatherForecast> {
  const services = createTestServices();
  const baseline = await services.pointWeatherForecast.execute(
    {
      coordinate: { longitude: 44.8271, latitude: 41.7151 },
      model: DEFAULT_WEATHER_MODEL,
    },
    new AbortController().signal,
  );
  services.dispose();

  const temperatureCelsius = [-5, 10, 20, 30] as const;
  const windMetresPerSecond = [14.9, 15, 24.9, 25, 5, 5, 5, 5, 20] as const;
  const gustMetresPerSecond = [14.9, 15, 24.9, 25] as const;
  const hourly = baseline.hourly
    .slice(startIndex, startIndex + 24)
    .map((hour, index) => ({
      ...hour,
      temperatureCelsius: temperatureCelsius[index] ?? 12,
      precipitationMm: index === 4 ? 0.6 : index === 5 ? 0.3 : 0,
      snowfallCm: index === 4 ? 0.2 : 0,
      windSpeedKmh: (windMetresPerSecond[index] ?? 5) * 3.6,
      windGustsKmh: (gustMetresPerSecond[index - 4] ?? 8) * 3.6,
    }));
  const current = hourly[0];
  if (current === undefined) throw new Error('Synthetic forecast requires 24 hours.');

  return {
    ...baseline,
    current: {
      ...baseline.current,
      ...current,
    },
    hourly,
  };
}

async function renderTable(startIndex = 0) {
  const forecast = await syntheticForecast(startIndex);
  const view = render(
    <ThemeProvider theme={theme}>
      <div data-weather-scroll-region data-testid="weather-scroll-region">
        <HourlyForecastTable forecast={forecast} sidebarCollapsed={false} />
      </div>
    </ThemeProvider>,
  );
  return { forecast, ...view };
}

describe('HourlyForecastTable', () => {
  it('keeps 24 consecutive hours aligned across the six semantic rows', async () => {
    await renderTable();

    const table = screen.getByRole('table', { name: 'Hourly forecast' });
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Time',
      'Weather',
      'Temp (°C)',
      'Precip (mm)',
      'Wind (m/s)',
      'Gusts (m/s)',
    ]);
    const hours = within(table).getAllByRole('columnheader');
    expect(hours).toHaveLength(24);
    const firstHour = hours[0];
    if (firstHour === undefined) throw new Error('Expected the first hourly column.');
    expect(firstHour).toHaveAccessibleName('2026-07-18T00:00 local time');
    expect(firstHour).toHaveTextContent('Sat');
    expect(firstHour).not.toHaveTextContent('Now');
    expect(within(firstHour).getByText('Sat')).toHaveStyle({ fontWeight: '700' });
    expect(hours[1]).toHaveAccessibleName('2026-07-18T01:00 local time');
    expect(hours[1]).toHaveTextContent('01:00');
    expect(hours[1]).not.toHaveTextContent('Sat');
    expect(hours[23]).toHaveAccessibleName('2026-07-18T23:00 local time');
    expect(within(table).queryByRole('rowheader', { name: /direction/iu })).toBeNull();
  });

  it('uses vertical dividers only when the local calendar day changes', async () => {
    await renderTable(18);

    const sameDayHour = screen.getByRole('columnheader', {
      name: '2026-07-18T19:00 local time',
    });
    const nextDayHour = screen.getByRole('columnheader', {
      name: '2026-07-19T00:00 local time',
    });
    expect(sameDayHour).not.toHaveStyle({ borderLeftWidth: '1px' });
    expect(nextDayHour).toHaveStyle({
      borderLeftWidth: '1px',
      borderLeftStyle: 'solid',
      borderLeftColor: theme.palette.divider,
    });
    expect(sameDayHour).toHaveTextContent('19:00');
    expect(sameDayHour).not.toHaveTextContent('Sat');
    expect(nextDayHour).toHaveTextContent('Sun');
    expect(within(nextDayHour).getByText('Sun')).toHaveStyle({ fontWeight: '700' });
  });

  it('drags the timeline with the mouse without allowing text selection', async () => {
    await renderTable();

    const table = screen.getByRole('table', { name: 'Hourly forecast' });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(table, {
      clientWidth: { configurable: true, value: 400 },
      scrollLeft: { configurable: true, value: 300, writable: true },
      scrollWidth: { configurable: true, value: 1_024 },
      setPointerCapture: { configurable: true, value: setPointerCapture },
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
    });

    expect(table).toHaveStyle({ cursor: 'grab', userSelect: 'none' });
    fireEvent.pointerDown(table, {
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      clientX: 200,
    });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(table).toHaveStyle({ cursor: 'grabbing' });

    fireEvent.pointerMove(table, {
      pointerId: 7,
      pointerType: 'mouse',
      clientX: 140,
    });
    expect(table.scrollLeft).toBe(360);

    fireEvent.pointerUp(table, {
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      clientX: 140,
    });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(table).toHaveStyle({ cursor: 'grab' });
  });
  it('expands beyond its container with all 24 hours visible', async () => {
    await renderTable();

    const forwardButton = screen.getByRole('button', {
      name: 'Scroll hourly forecast forward',
    });
    const expandButton = screen.getByRole('button', {
      name: 'Expand hourly forecast',
    });
    expect(
      forwardButton.compareDocumentPosition(expandButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    fireEvent.click(expandButton);

    const collapseButton = screen.getByRole('button', {
      name: 'Collapse hourly forecast',
    });
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    const expandedTable = screen.getByRole('table', { name: 'Hourly forecast' });
    await waitFor(() => {
      expect(expandedTable).toHaveStyle({
        width: '1026px',
        overflowX: 'hidden',
        cursor: 'default',
      });
    });
    expect(within(expandedTable).getAllByRole('columnheader')).toHaveLength(24);
    expect(expandedTable.parentElement).toBe(document.body);
    expect(expandedTable).not.toContainElement(
      screen.getByRole('heading', { name: 'Next 24 hours' }),
    );

    fireEvent.click(collapseButton);
    expect(expandedTable).toHaveStyle({ width: '0px' });
    fireEvent.transitionEnd(expandedTable, { propertyName: 'width' });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Expand hourly forecast' }),
      ).toHaveAttribute('aria-expanded', 'false');
    });
  });
  it('collapses when the Weather panel scrolls', async () => {
    await renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Expand hourly forecast' }));
    const table = screen.getByRole('table', { name: 'Hourly forecast' });
    await waitFor(() => {
      expect(table).toHaveStyle({ width: '1026px' });
    });

    fireEvent.scroll(screen.getByTestId('weather-scroll-region'));

    expect(table).toHaveStyle({ width: '0px' });
    fireEvent.transitionEnd(table, { propertyName: 'width' });
    expect(
      await screen.findByRole('button', { name: 'Expand hourly forecast' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('collapses when the workspace sidebar collapses', async () => {
    const { forecast, rerender } = await renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Expand hourly forecast' }));
    const table = screen.getByRole('table', { name: 'Hourly forecast' });
    await waitFor(() => {
      expect(table).toHaveStyle({ width: '1026px' });
    });

    rerender(
      <ThemeProvider theme={theme}>
        <div data-weather-scroll-region data-testid="weather-scroll-region">
          <HourlyForecastTable forecast={forecast} sidebarCollapsed />
        </div>
      </ThemeProvider>,
    );

    expect(table).toHaveStyle({ width: '0px' });
    fireEvent.transitionEnd(table, { propertyName: 'width' });
    expect(
      await screen.findByRole('button', { name: 'Expand hourly forecast' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('fills the temperature polygon and anchors precipitation bars at zero', async () => {
    const { container } = await renderTable();
    const temperatureStops = [
      ...container.querySelectorAll('stop[data-temperature-celsius]'),
    ];
    expect(temperatureStops).toHaveLength(24);
    expect(
      temperatureStops.slice(0, 4).map((stop) => stop.getAttribute('stop-color')),
    ).toEqual([
      appColors.marker.blue,
      appColors.marker.green,
      appColors.brand.amber,
      appColors.marker.red,
    ]);

    const temperaturePolygon = container.querySelector('[data-temperature-polygon]');
    expect(temperaturePolygon).toHaveAttribute('stroke', 'none');
    const polygonPoints = temperaturePolygon?.getAttribute('points')?.split(' ') ?? [];
    expect(polygonPoints[0]).toMatch(/^0,/u);
    expect(polygonPoints[polygonPoints.length - 3]).toMatch(/^960,/u);
    expect(polygonPoints.slice(-2)).toEqual(['960,56', '0,56']);
    expect(container.querySelector('[data-temperature-point]')).toBeNull();

    const precipitationBars = [
      ...container.querySelectorAll<SVGRectElement>('[data-precipitation-bar]'),
    ];
    expect(precipitationBars).toHaveLength(2);
    for (const bar of precipitationBars) {
      expect(Number(bar.getAttribute('y')) + Number(bar.getAttribute('height'))).toBe(
        56,
      );
    }
    expect(
      container.querySelector('[data-precipitation-bar="2026-07-18T00:00"]'),
    ).toBeNull();
    const snowyBar = container.querySelector(
      '[data-precipitation-bar="2026-07-18T04:00"]',
    );
    const snowflake = container.querySelector(
      '[data-precipitation-snowflake="2026-07-18T04:00"]',
    );
    expect(snowyBar).not.toBeNull();
    expect(snowflake).not.toBeNull();
    expect(Number(snowflake?.getAttribute('y'))).toBeLessThan(
      Number(snowyBar?.getAttribute('y')),
    );

    const precipitationCell = screen.getByRole('cell', {
      name: '2026-07-18T05:00 precipitation 0.3 millimetres',
    });
    expect(precipitationCell).toHaveTextContent('0.3');
    expect(precipitationCell).not.toHaveTextContent('mm');
    const coldTemperatureLabel = within(
      screen.getByRole('cell', {
        name: '2026-07-18T00:00 temperature -5 degrees Celsius',
      }),
    ).getByText('-5°');
    const hotTemperatureLabel = within(
      screen.getByRole('cell', {
        name: '2026-07-18T03:00 temperature 30 degrees Celsius',
      }),
    ).getByText('30°');
    expect(
      Number.parseFloat(getComputedStyle(coldTemperatureLabel).top),
    ).toBeGreaterThan(Number.parseFloat(getComputedStyle(hotTemperatureLabel).top));
    const zeroPrecipitationLabel = within(
      screen.getByRole('cell', {
        name: '2026-07-18T00:00 precipitation 0 millimetres',
      }),
    ).getByText('0');
    expect(
      Number.parseFloat(getComputedStyle(zeroPrecipitationLabel).top),
    ).toBeGreaterThan(
      Number.parseFloat(
        getComputedStyle(within(precipitationCell).getByText('0.3')).top,
      ),
    );
  });

  it('classifies wind text and renders continuous gradients before rounding', async () => {
    const { container } = await renderTable();

    const neutralWind = screen.getByRole('cell', {
      name: '2026-07-18T00:00 wind 14.9 metres per second',
    });
    const strongWind = screen.getByRole('cell', {
      name: '2026-07-18T01:00 wind 15.0 metres per second, strong',
    });
    const upperStrongWind = screen.getByRole('cell', {
      name: '2026-07-18T02:00 wind 24.9 metres per second, strong',
    });
    const criticalWind = screen.getByRole('cell', {
      name: '2026-07-18T03:00 wind 25.0 metres per second, critical',
    });
    expect(neutralWind).not.toHaveAccessibleName(/neutral/iu);
    expect(strongWind).toHaveStyle({ color: theme.palette.warning.dark });
    expect(upperStrongWind).toHaveStyle({ color: theme.palette.warning.dark });
    expect(criticalWind).toHaveStyle({ color: theme.palette.error.main });

    expect(
      screen.getByRole('cell', {
        name: '2026-07-18T04:00 gusts 14.9 metres per second',
      }),
    ).not.toHaveAccessibleName(/neutral/iu);
    expect(
      screen.getByRole('cell', {
        name: '2026-07-18T05:00 gusts 15.0 metres per second, strong',
      }),
    ).toHaveStyle({ color: theme.palette.warning.dark });
    expect(
      screen.getByRole('cell', {
        name: '2026-07-18T06:00 gusts 24.9 metres per second, strong',
      }),
    ).toHaveStyle({ color: theme.palette.warning.dark });
    expect(
      screen.getByRole('cell', {
        name: '2026-07-18T07:00 gusts 25.0 metres per second, critical',
      }),
    ).toHaveStyle({ color: theme.palette.error.main });

    const windGradientStops = [
      ...container.querySelectorAll(
        'svg[data-wind-gradient="wind"] stop[data-wind-speed]',
      ),
    ];
    expect(windGradientStops).toHaveLength(24);
    expect(windGradientStops[1]).toHaveAttribute('stop-color', 'rgb(255, 183, 3)');
    expect(windGradientStops[3]).toHaveAttribute('stop-color', appColors.marker.red);
    expect(windGradientStops[8]).toHaveAttribute('stop-color', 'rgb(251, 133, 0)');
    const gustGradientStops = [
      ...container.querySelectorAll(
        'svg[data-wind-gradient="gusts"] stop[data-wind-speed]',
      ),
    ];
    expect(gustGradientStops).toHaveLength(24);
    expect(gustGradientStops[0]).toHaveAttribute('stop-color', 'rgb(46, 173, 91)');
    expect(gustGradientStops[5]).toHaveAttribute('stop-color', 'rgb(255, 183, 3)');
    expect(gustGradientStops[7]).toHaveAttribute('stop-color', appColors.marker.red);
  });
});
