/**
 * Sentinel-2A, 2B, and 2C fly one ground track that repeats every 10 days, so each
 * satellite revisits a point on a fixed 10-day phase. Since 2C took over 2A's
 * operational slot, 2A's extended campaign often acquires only every second cycle in many
 * regions, so each satellite-and-phase "track" keeps its own cadence.
 */
const groundTrackRepeatDays = 10;
/** History before the latest acquisition: about the current and previous month. */
const historyDays = 60;
const forecastDays = 30;
const millisecondsPerDay = 86_400_000;

export interface SentinelAcquisition {
  /** UTC acquisition date, `YYYY-MM-DD`. */
  readonly date: string;
  /** STAC platform, for example `sentinel-2b`. */
  readonly platform: string;
}

interface AcquisitionTrack {
  readonly firstDay: number;
  lastDay: number;
  /** Shortest gap between consecutive acquisitions; null after one acquisition. */
  cadenceDays: number | null;
}

function toDayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / millisecondsPerDay;
}

/**
 * Predicts upcoming UTC acquisition dates from loaded acquisitions.
 *
 * Every track seen during the last 60 days before the latest acquisition repeats with
 * its shortest observed gap. A track seen once repeats every 10 days unless the loaded
 * history covers its neighbouring cycle without it, which marks an every-other-cycle
 * track. History stops at the last gap longer than two cycles: loaded months rarely
 * contain one, so it usually means a month between loaded months was never fetched.
 * Returns dates after the latest acquisition, up to 30 days after `today`. Returns
 * nothing unless the history spans at least one full cycle (otherwise some tracks were
 * never observed) and reaches within one cycle of `today` (otherwise the loaded months
 * are historical).
 */
export function predictSentinelAcquisitionDates(
  acquisitions: readonly SentinelAcquisition[],
  today: string,
): ReadonlySet<string> {
  const predictions = new Set<string>();
  const observed = acquisitions
    .map((acquisition) => ({
      day: toDayNumber(acquisition.date),
      platform: acquisition.platform,
    }))
    .toSorted((left, right) => left.day - right.day);
  const latestDay = observed.at(-1)?.day;
  if (latestDay === undefined) return predictions;
  const todayDay = toDayNumber(today);
  if (latestDay < todayDay - groundTrackRepeatDays) return predictions;

  const unloadedGapEnd = observed.findLastIndex(
    ({ day }, index) =>
      day - (observed[index - 1]?.day ?? day) > 2 * groundTrackRepeatDays,
  );
  const recent = observed
    .slice(Math.max(unloadedGapEnd, 0))
    .filter(({ day }) => day > latestDay - historyDays);
  const earliestDay = recent[0]?.day ?? latestDay;
  if (latestDay - earliestDay < groundTrackRepeatDays) return predictions;

  const tracks = new Map<string, AcquisitionTrack>();
  for (const { day, platform } of recent) {
    const key = `${platform}:${String(day % groundTrackRepeatDays)}`;
    const track = tracks.get(key);
    if (track === undefined) {
      tracks.set(key, { firstDay: day, lastDay: day, cadenceDays: null });
    } else if (day > track.lastDay) {
      track.cadenceDays = Math.min(
        track.cadenceDays ?? Number.POSITIVE_INFINITY,
        day - track.lastDay,
      );
      track.lastDay = day;
    }
  }

  const lastPredictedDay = todayDay + forecastDays;
  for (const track of tracks.values()) {
    const missedNeighbouringCycle =
      track.firstDay - groundTrackRepeatDays >= earliestDay ||
      track.firstDay + groundTrackRepeatDays <= latestDay;
    const cadenceDays =
      track.cadenceDays ??
      (missedNeighbouringCycle ? 2 * groundTrackRepeatDays : groundTrackRepeatDays);
    for (
      let day = track.lastDay + cadenceDays;
      day <= lastPredictedDay;
      day += cadenceDays
    ) {
      if (day > latestDay) {
        predictions.add(new Date(day * millisecondsPerDay).toISOString().slice(0, 10));
      }
    }
  }
  return predictions;
}
