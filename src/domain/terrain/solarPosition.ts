/** Apparent angular radius of the solar disk; also `terrainShadowModel.solarDiskRadiusDegrees`. */
export const solarDiskRadiusDegrees = 0.2666;

const degreesPerRadian = 180 / Math.PI;
const radiansPerDegree = Math.PI / 180;
const millisecondsPerDay = 86_400_000;
const unixEpochJulianDay = 2_440_587.5;
const j2000JulianDay = 2_451_545;
const daysPerJulianCentury = 36_525;

/** Point on Earth where the Sun is at the zenith, in radians. */
export interface SubsolarPoint {
  readonly declinationRadians: number;
  /** Equals −(Greenwich hour angle), wrapped to (−π, π]. */
  readonly longitudeRadians: number;
}

/** Sun direction seen from a point on the mean-sphere ground. */
export interface SolarPosition {
  /** Clockwise from true north, in [0, 360). */
  readonly azimuthDegrees: number;
  /** Geometric elevation of the disk center. */
  readonly elevationDegrees: number;
  /** Elevation including Sæmundsson atmospheric refraction. */
  readonly apparentElevationDegrees: number;
}

export interface SolarDayEvents {
  readonly sunrise: Date | null;
  readonly sunset: Date | null;
}

function wrapRadians(value: number): number {
  const turn = 2 * Math.PI;
  const wrapped = value - turn * Math.floor(value / turn);
  return wrapped > Math.PI ? wrapped - turn : wrapped;
}

/** NOAA / Meeus low-precision solar coordinates (about 0.01° accuracy for 1950–2050). */
export function subsolarPoint(instant: Date): SubsolarPoint {
  const epochMilliseconds = instant.getTime();
  const julianDay = epochMilliseconds / millisecondsPerDay + unixEpochJulianDay;
  const t = (julianDay - j2000JulianDay) / daysPerJulianCentury;

  const meanLongitude =
    ((280.466_46 + t * (36_000.769_83 + t * 0.000_303_2)) % 360) * radiansPerDegree;
  const meanAnomaly =
    (357.529_11 + t * (35_999.050_29 - 0.000_153_7 * t)) * radiansPerDegree;
  const eccentricity = 0.016_708_634 - t * (0.000_042_037 + 0.000_000_126_7 * t);
  const equationOfCenterDegrees =
    Math.sin(meanAnomaly) * (1.914_602 - t * (0.004_817 + 0.000_014 * t)) +
    Math.sin(2 * meanAnomaly) * (0.019_993 - 0.000_101 * t) +
    Math.sin(3 * meanAnomaly) * 0.000_289;
  const omega = (125.04 - 1934.136 * t) * radiansPerDegree;
  const apparentLongitude =
    meanLongitude +
    (equationOfCenterDegrees - 0.005_69 - 0.004_78 * Math.sin(omega)) *
      radiansPerDegree;
  const meanObliquityDegrees =
    23 + (26 + (21.448 - t * (46.815 + t * (0.000_59 - t * 0.001_813))) / 60) / 60;
  const obliquity =
    (meanObliquityDegrees + 0.002_56 * Math.cos(omega)) * radiansPerDegree;

  const declinationRadians = Math.asin(
    Math.sin(obliquity) * Math.sin(apparentLongitude),
  );

  const y = Math.tan(obliquity / 2) ** 2;
  const equationOfTimeRadians =
    y * Math.sin(2 * meanLongitude) -
    2 * eccentricity * Math.sin(meanAnomaly) +
    4 * eccentricity * y * Math.sin(meanAnomaly) * Math.cos(2 * meanLongitude) -
    0.5 * y * y * Math.sin(4 * meanLongitude) -
    1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly);

  const utcDayFraction =
    (epochMilliseconds -
      Math.floor(epochMilliseconds / millisecondsPerDay) * millisecondsPerDay) /
    millisecondsPerDay;
  const greenwichHourAngle =
    2 * Math.PI * utcDayFraction - Math.PI + equationOfTimeRadians;

  return { declinationRadians, longitudeRadians: wrapRadians(-greenwichHourAngle) };
}

/**
 * Sæmundsson refraction in degrees for a true elevation in degrees. Below −1° the value
 * at −1° is used to stay clear of the formula's singularity.
 */
export function atmosphericRefractionDegrees(trueElevationDegrees: number): number {
  const elevation = Math.max(trueElevationDegrees, -1);
  return (
    1.02 / Math.tan((elevation + 10.3 / (elevation + 5.11)) * radiansPerDegree) / 60
  );
}

export function solarPositionAt(
  sun: SubsolarPoint,
  latitudeDegrees: number,
  longitudeDegrees: number,
): SolarPosition {
  const latitude = latitudeDegrees * radiansPerDegree;
  const hourAngle = longitudeDegrees * radiansPerDegree - sun.longitudeRadians;
  const sinDeclination = Math.sin(sun.declinationRadians);
  const cosDeclination = Math.cos(sun.declinationRadians);
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const cosHourAngle = Math.cos(hourAngle);

  const sinElevation =
    sinLatitude * sinDeclination + cosLatitude * cosDeclination * cosHourAngle;
  const elevationDegrees =
    Math.asin(Math.min(1, Math.max(-1, sinElevation))) * degreesPerRadian;
  const azimuth =
    Math.atan2(
      -cosDeclination * Math.sin(hourAngle),
      cosLatitude * sinDeclination - sinLatitude * cosDeclination * cosHourAngle,
    ) * degreesPerRadian;
  const azimuthDegrees = azimuth < 0 ? azimuth + 360 : azimuth;

  return {
    azimuthDegrees: azimuthDegrees >= 360 ? 0 : azimuthDegrees,
    elevationDegrees,
    apparentElevationDegrees:
      elevationDegrees + atmosphericRefractionDegrees(elevationDegrees),
  };
}

export function solarPosition(
  instant: Date,
  latitudeDegrees: number,
  longitudeDegrees: number,
): SolarPosition {
  return solarPositionAt(subsolarPoint(instant), latitudeDegrees, longitudeDegrees);
}

const eventScanStepMilliseconds = 10 * 60_000;
const eventPrecisionMilliseconds = 500;

/**
 * First sunrise and first sunset inside [from, to), defined by the upper limb touching the
 * astronomical horizon (apparent center elevation = −solarDiskRadiusDegrees). `null` means
 * no such crossing in the window (polar day or night). The 10-minute scan can miss a
 * grazing sun that rises and sets again within one step near the polar circles.
 */
export function solarDayEvents(
  from: Date,
  to: Date,
  latitudeDegrees: number,
  longitudeDegrees: number,
): SolarDayEvents {
  const limbAboveHorizon = (milliseconds: number): number =>
    solarPosition(new Date(milliseconds), latitudeDegrees, longitudeDegrees)
      .apparentElevationDegrees + solarDiskRadiusDegrees;

  const refineCrossing = (low: number, high: number, risingSign: boolean): Date => {
    let before = low;
    let after = high;
    while (after - before > eventPrecisionMilliseconds) {
      const middle = (before + after) / 2;
      if (limbAboveHorizon(middle) >= 0 === risingSign) after = middle;
      else before = middle;
    }
    return new Date(Math.round((before + after) / 2));
  };

  const end = to.getTime();
  let sunrise: Date | null = null;
  let sunset: Date | null = null;
  let previousTime = from.getTime();
  let previousUp = limbAboveHorizon(previousTime) >= 0;

  while (previousTime < end && (sunrise === null || sunset === null)) {
    const time = Math.min(previousTime + eventScanStepMilliseconds, end);
    const up = limbAboveHorizon(time) >= 0;
    if (up !== previousUp) {
      const crossing = refineCrossing(previousTime, time, up);
      if (crossing.getTime() < end) {
        if (up && sunrise === null) sunrise = crossing;
        if (!up && sunset === null) sunset = crossing;
      }
    }
    previousTime = time;
    previousUp = up;
  }

  return { sunrise, sunset };
}
