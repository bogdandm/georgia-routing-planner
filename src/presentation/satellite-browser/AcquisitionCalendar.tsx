import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import {
  Box,
  ButtonBase,
  CircularProgress,
  ClickAwayListener,
  IconButton,
  MenuItem,
  Paper,
  Popper,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';

import type { SatelliteSearchResult } from '@/domain/satellite/SatelliteSearchResult';
import { calculateWeightedCloudCover } from '@/domain/satellite/calculateWeightedCloudCover';
import { appColors } from '@/presentation/theme/appColors';

const sentinelArchiveFirstMonth = '2015-06';
const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
const calendarMonthNames = Array.from({ length: 12 }, (_value, month) =>
  new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2020, month, 1)),
  ),
);
const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export type AcquisitionCalendarMode =
  | {
      readonly kind: 'scene';
      readonly loadingMonth: string | null;
      readonly maxCloudCoverPercent: number;
      readonly result: SatelliteSearchResult | null;
      readonly onSelectDate: (date: string) => void;
    }
  | {
      readonly kind: 'mosaic';
      readonly selectedDate: string | null;
      readonly archiveStartDate: string;
      readonly onSelectDate: (date: string) => void;
    };

interface AcquisitionCalendarProps {
  readonly displayMonth: string;
  readonly maximumMonth: string;
  readonly navigationDisabled: boolean;
  readonly onMonthChange: (month: string) => void;
  readonly today: Date;
  readonly mode: AcquisitionCalendarMode;
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function AcquisitionCalendar({
  displayMonth,
  maximumMonth,
  navigationDisabled,
  onMonthChange,
  today,
  mode,
}: AcquisitionCalendarProps) {
  const [monthPickerAnchor, setMonthPickerAnchor] = useState<HTMLElement | null>(null);
  const monthPickerOpen = monthPickerAnchor !== null;
  const todayDate = toDateInputValue(today);
  const minimumMonth =
    mode.kind === 'mosaic'
      ? mode.archiveStartDate.slice(0, 7)
      : sentinelArchiveFirstMonth;
  const latestDate =
    mode.kind === 'scene' ? (mode.result?.groups[0]?.date ?? todayDate) : todayDate;
  const displayMonthDate = new Date(`${displayMonth}-01T00:00:00.000Z`);
  const minimumMonthDate = new Date(`${minimumMonth}-01T00:00:00.000Z`);
  const maximumMonthDate = new Date(`${maximumMonth}-01T00:00:00.000Z`);
  const loadingMonth = mode.kind === 'scene' ? mode.loadingMonth : null;

  const availability = useMemo(() => {
    const byDate = new Map<string, number>();
    if (mode.kind !== 'scene') return byDate;
    for (const group of mode.result?.groups ?? []) {
      const cloudCover = calculateWeightedCloudCover(group.scenes);
      if (cloudCover !== null) byDate.set(group.date, cloudCover);
    }
    return byDate;
  }, [mode]);
  const year = displayMonthDate.getUTCFullYear();
  const month = displayMonthDate.getUTCMonth();
  const minimumYear = minimumMonthDate.getUTCFullYear();
  const maximumYear = maximumMonthDate.getUTCFullYear();
  const availableYears = Array.from(
    { length: maximumYear - minimumYear + 1 },
    (_value, index) => maximumYear - index,
  );
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const calendarCellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: calendarCellCount }, (_value, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });
  const calendarRows = Array.from(
    { length: calendarCellCount / 7 },
    (_value, rowIndex) => cells.slice(rowIndex * 7, rowIndex * 7 + 7),
  );

  const changeMonth = (offset: number) => {
    const nextMonth = new Date(Date.UTC(year, month + offset, 1));
    onMonthChange(toDateInputValue(nextMonth).slice(0, 7));
  };

  const selectYear = (nextYear: number) => {
    const earliestMonth = nextYear === minimumYear ? minimumMonthDate.getUTCMonth() : 0;
    const latestMonth = nextYear === maximumYear ? maximumMonthDate.getUTCMonth() : 11;
    const nextMonth = Math.min(Math.max(month, earliestMonth), latestMonth);
    onMonthChange(
      toDateInputValue(new Date(Date.UTC(nextYear, nextMonth, 1))).slice(0, 7),
    );
  };

  const selectMonth = (nextMonth: number) => {
    onMonthChange(toDateInputValue(new Date(Date.UTC(year, nextMonth, 1))).slice(0, 7));
    setMonthPickerAnchor(null);
  };

  return (
    <Box aria-label="Sentinel acquisition calendar">
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '80px minmax(0, 1fr) 80px',
          alignItems: 'center',
          mb: 0.5,
        }}
      >
        <Tooltip title="Previous month">
          <span style={{ display: 'flex', width: 'fit-content' }}>
            <IconButton
              size="small"
              aria-label="Previous acquisition month"
              disabled={navigationDisabled || displayMonth <= minimumMonth}
              onClick={() => {
                changeMonth(-1);
              }}
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Stack
          direction="row"
          spacing={1}
          sx={{ minWidth: 0, alignItems: 'center', justifyContent: 'center' }}
        >
          <Box sx={{ display: 'flex', width: 14, height: 14 }}>
            <CircularProgress
              size={14}
              aria-label={
                loadingMonth === displayMonth
                  ? `Loading ${monthFormatter.format(displayMonthDate)} imagery`
                  : undefined
              }
              aria-hidden={loadingMonth === displayMonth ? undefined : true}
              sx={{ visibility: loadingMonth === displayMonth ? 'visible' : 'hidden' }}
            />
          </Box>
          <Tooltip title="Choose month and year">
            <ButtonBase
              aria-label={`Choose acquisition month and year, ${monthFormatter.format(displayMonthDate)}`}
              aria-expanded={monthPickerOpen}
              onClick={(event) => {
                setMonthPickerAnchor((anchor) =>
                  anchor === null ? event.currentTarget : null,
                );
              }}
              sx={{ gap: 0.25, borderRadius: 1, pl: 0.5, pr: 0.25 }}
            >
              <Typography variant="subtitle2">
                {monthFormatter.format(displayMonthDate)}
              </Typography>
              <KeyboardArrowDownIcon fontSize="small" />
            </ButtonBase>
          </Tooltip>
        </Stack>
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Tooltip title="Next month">
            <span style={{ display: 'flex' }}>
              <IconButton
                size="small"
                aria-label="Next acquisition month"
                disabled={navigationDisabled || displayMonth >= maximumMonth}
                onClick={() => {
                  changeMonth(1);
                }}
              >
                <ChevronRightIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Return to current month">
            <span style={{ display: 'flex' }}>
              <IconButton
                size="small"
                aria-label="Return to current acquisition month"
                disabled={navigationDisabled || displayMonth >= maximumMonth}
                onClick={() => {
                  onMonthChange(maximumMonth);
                }}
              >
                <KeyboardDoubleArrowRightIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>
      <Popper
        open={monthPickerOpen}
        anchorEl={monthPickerAnchor}
        placement="bottom"
        modifiers={[{ name: 'offset', options: { offset: [0, 4] } }]}
        sx={{ zIndex: 'modal' }}
      >
        <ClickAwayListener
          onClickAway={() => {
            setMonthPickerAnchor(null);
          }}
        >
          <Paper
            elevation={8}
            role="group"
            aria-label="Choose acquisition month and year"
            sx={{ width: 280, maxWidth: 'calc(100vw - 32px)', p: 1 }}
          >
            <Select
              fullWidth
              size="small"
              value={year}
              inputProps={{ 'aria-label': 'Acquisition year' }}
              onChange={(event) => {
                selectYear(event.target.value);
              }}
              sx={{ mb: 1 }}
            >
              {availableYears.map((availableYear) => (
                <MenuItem key={availableYear} value={availableYear}>
                  {availableYear}
                </MenuItem>
              ))}
            </Select>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 0.5,
              }}
            >
              {calendarMonthNames.map((monthName, monthIndex) => {
                const candidate = `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}`;
                const unavailable =
                  candidate < minimumMonth || candidate > maximumMonth;
                return (
                  <ButtonBase
                    key={monthName}
                    aria-label={`Choose ${monthName} ${String(year)}`}
                    aria-pressed={monthIndex === month}
                    disabled={unavailable}
                    onClick={() => {
                      selectMonth(monthIndex);
                    }}
                    sx={{
                      minHeight: 32,
                      borderRadius: 1,
                      bgcolor: monthIndex === month ? 'action.selected' : 'transparent',
                      color: unavailable ? 'text.disabled' : 'text.primary',
                      fontSize: '0.75rem',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    {monthName}
                  </ButtonBase>
                );
              })}
            </Box>
          </Paper>
        </ClickAwayListener>
      </Popper>
      <Box
        role="grid"
        aria-label={monthFormatter.format(displayMonthDate)}
        sx={{ display: 'grid', rowGap: 0.5 }}
      >
        <Box role="row" sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {weekDays.map((day) => (
            <Typography
              key={day}
              role="columnheader"
              variant="caption"
              color="text.secondary"
              sx={{ textAlign: 'center' }}
            >
              {day}
            </Typography>
          ))}
        </Box>
        {calendarRows.map((calendarRow, rowIndex) => (
          <Box
            key={`week-${String(rowIndex)}`}
            role="row"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              columnGap: mode.kind === 'mosaic' ? 0 : 0.25,
            }}
          >
            {calendarRow.map((day, columnIndex) => {
              if (day === null) {
                return (
                  <Box
                    key={`empty-${String(rowIndex * 7 + columnIndex)}`}
                    role="gridcell"
                    aria-hidden="true"
                  />
                );
              }
              const date = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const formattedDate = dayFormatter.format(
                new Date(`${date}T00:00:00.000Z`),
              );
              if (mode.kind === 'mosaic') {
                const disabled = date < mode.archiveStartDate || date > todayDate;
                const selected = date === mode.selectedDate;
                const inRange =
                  mode.selectedDate !== null &&
                  date >= mode.archiveStartDate &&
                  date <= mode.selectedDate;
                return (
                  <ButtonBase
                    key={date}
                    role="gridcell"
                    disabled={disabled}
                    aria-selected={selected}
                    aria-label={`${formattedDate}${inRange ? ', included in Mosaic range' : ''}${selected ? ', selected upper bound' : ''}`}
                    onClick={() => {
                      mode.onSelectDate(date);
                    }}
                    sx={{
                      height: 40,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius:
                        date === mode.archiveStartDate
                          ? '999px 0 0 999px'
                          : selected
                            ? '0 999px 999px 0'
                            : 0,
                      bgcolor: inRange
                        ? appColors.tag.orange.background
                        : 'transparent',
                      color: inRange ? appColors.tag.orange.foreground : 'text.primary',
                      outline: selected
                        ? `2px solid ${appColors.brand.tigerOrange}`
                        : 'none',
                      outlineOffset: selected ? -2 : 0,
                      fontWeight: selected ? 700 : 400,
                      '&.Mui-disabled': { color: 'text.disabled' },
                    }}
                  >
                    <Typography variant="caption" sx={{ lineHeight: 1.1 }}>
                      {day}
                    </Typography>
                  </ButtonBase>
                );
              }

              const cloud = availability.get(date);
              const isLatest = date === latestDate && cloud !== undefined;
              const matchesCloudFilter =
                cloud !== undefined && cloud <= mode.maxCloudCoverPercent;
              return (
                <ButtonBase
                  key={date}
                  role="gridcell"
                  disabled={cloud === undefined}
                  onClick={() => {
                    mode.onSelectDate(date);
                  }}
                  aria-label={
                    cloud === undefined
                      ? `${formattedDate}, no loaded imagery`
                      : `${formattedDate}, imagery available, ${cloud.toFixed(0)} percent weighted cloud, ${matchesCloudFilter ? 'matches' : 'exceeds'} the current cloud limit`
                  }
                  sx={{
                    height: 40,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 1.25,
                    border: 1,
                    borderColor:
                      cloud === undefined
                        ? 'transparent'
                        : matchesCloudFilter
                          ? appColors.brand.tigerOrange
                          : 'transparent',
                    bgcolor:
                      cloud === undefined
                        ? 'transparent'
                        : matchesCloudFilter
                          ? appColors.tag.orange.background
                          : 'transparent',
                    color: matchesCloudFilter
                      ? appColors.tag.orange.foreground
                      : 'text.primary',
                    fontWeight: isLatest ? 700 : 400,
                    '&.Mui-disabled': { color: 'text.primary' },
                  }}
                >
                  <Typography variant="caption" sx={{ lineHeight: 1.1 }}>
                    {day}
                  </Typography>
                  {cloud === undefined ? null : (
                    <Typography
                      variant="caption"
                      sx={{ color: 'inherit', lineHeight: 1 }}
                    >
                      {cloud.toFixed(0)}%
                    </Typography>
                  )}
                </ButtonBase>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
