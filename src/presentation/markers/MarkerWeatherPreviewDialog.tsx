import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

import type { MarkerWeatherForecast } from '@/application/weather/MarkerWeatherForecast';
import type { PointWeatherForecast } from '@/application/weather/GetPointWeatherForecast';
import type { SavedMarker } from '@/domain/markers/savedMarker';
import { WeatherPeriodSummaryRow } from '@/presentation/weather/WeatherPanel';

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

interface MarkerWeatherPreviewDialogProps {
  readonly forecast: PointWeatherForecast;
  readonly marker: SavedMarker;
  readonly onClose: () => void;
  readonly onOpenWeather: (marker: SavedMarker) => void;
  readonly selection: MarkerWeatherForecast;
}

export function MarkerWeatherPreviewDialog({
  forecast,
  marker,
  onClose,
  onOpenWeather,
  selection,
}: MarkerWeatherPreviewDialogProps) {
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>{marker.name} weather</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {Math.round(forecast.elevationMeters).toLocaleString('en-US')} m ·{' '}
            {forecast.timezoneAbbreviation}
          </Typography>
          <Stack
            role="list"
            aria-label={`Weather forecast for ${marker.name}`}
            spacing={1}
          >
            {selection.periods.map((selected) => {
              const date = new Date(`${selected.date}T00:00:00.000Z`);
              const dateLabel = dateFormatter.format(date);
              const [weekday, ...dateParts] = dateLabel.split(' ');
              return (
                <Paper
                  key={selected.date}
                  role="listitem"
                  variant="outlined"
                  sx={{
                    minHeight: 48,
                    display: 'grid',
                    gridTemplateColumns: '64px minmax(0, 1fr)',
                    borderRadius: 1.25,
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      minWidth: 0,
                      my: 1,
                      px: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      borderRight: 1,
                      borderColor: 'divider',
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {weekday}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ whiteSpace: 'nowrap' }}
                    >
                      {dateParts.join(' ')}
                    </Typography>
                  </Box>
                  <WeatherPeriodSummaryRow
                    dateLabel={dateLabel}
                    isDay={selected.isDay}
                    label="Selected interval"
                    period={selected.period}
                  />
                </Paper>
              );
            })}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="contained"
          endIcon={<OpenInNewOutlinedIcon />}
          onClick={() => {
            onOpenWeather(marker);
          }}
        >
          Open in Weather
        </Button>
      </DialogActions>
    </Dialog>
  );
}
