import { SatelliteSearchError } from '@/application/satellite/SatelliteSearchError';
import type {
  SatelliteSearchCriteria,
  SatelliteSearchCriteriaInput,
  SatelliteSearchViewport,
} from '@/domain/satellite/SatelliteSearchCriteria';

const maximumSatelliteSearchDays = 62;
const millisecondsPerDay = 86_400_000;
const utcDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

function parseUtcDate(value: string): number {
  if (!utcDatePattern.test(value)) {
    throw new SatelliteSearchError(
      'invalid-date',
      'Choose dates in YYYY-MM-DD format.',
    );
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new SatelliteSearchError('invalid-date', 'Choose valid calendar dates.');
  }
  return timestamp;
}

export function validateSatelliteViewport(
  viewport: SatelliteSearchViewport,
): SatelliteSearchViewport {
  const { west, south, east, north } = viewport.bounds;
  const { longitude, latitude } = viewport.center;
  const values = [west, south, east, north, longitude, latitude];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new SatelliteSearchError(
      'invalid-viewport',
      'The current viewport does not have finite bounds.',
    );
  }
  if (
    west < -180 ||
    east > 180 ||
    south < -85 ||
    north > 85 ||
    west >= east ||
    south >= north ||
    east - west >= 180
  ) {
    throw new SatelliteSearchError(
      'invalid-viewport',
      'This viewport crosses an unsupported boundary. Pan to one side and try again.',
    );
  }
  if (longitude < west || longitude > east || latitude < south || latitude > north) {
    throw new SatelliteSearchError(
      'invalid-viewport',
      'The viewport center is outside its settled bounds.',
    );
  }

  return {
    bounds: { west, south, east, north },
    center: { longitude, latitude },
  };
}

export function validateSatelliteSearchCriteria(
  input: SatelliteSearchCriteriaInput,
): SatelliteSearchCriteria {
  const startTimestamp = parseUtcDate(input.startDate);
  const endTimestamp = parseUtcDate(input.endDate);
  if (startTimestamp > endTimestamp) {
    throw new SatelliteSearchError(
      'date-range-reversed',
      'The end date must be on or after the start date.',
    );
  }
  const inclusiveDayCount =
    Math.floor((endTimestamp - startTimestamp) / millisecondsPerDay) + 1;
  if (inclusiveDayCount > maximumSatelliteSearchDays) {
    throw new SatelliteSearchError(
      'date-range-too-large',
      `Choose a range of ${String(maximumSatelliteSearchDays)} days or fewer.`,
    );
  }
  if (
    !Number.isFinite(input.maxCloudCoverPercent) ||
    input.maxCloudCoverPercent < 0 ||
    input.maxCloudCoverPercent > 100
  ) {
    throw new SatelliteSearchError(
      'invalid-cloud-cover',
      'Cloud cover must be between 0 and 100 percent.',
    );
  }

  return {
    viewport: validateSatelliteViewport(input.viewport),
    startDate: input.startDate,
    endDate: input.endDate,
    productLevel: input.productLevel,
    maxCloudCoverPercent: input.maxCloudCoverPercent,
    inclusiveDayCount,
  };
}
