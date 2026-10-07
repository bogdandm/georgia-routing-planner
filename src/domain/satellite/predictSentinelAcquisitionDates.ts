/**
 * Every Sentinel-2 satellite (2A, 2B, 2C) flies the same ground track, which repeats
 * every 10 days. The acquisition dates of any point therefore repeat with a 10-day
 * cycle, whatever the number of active satellites or overlapping relative orbits: points
 * in Georgia show repeating gaps such as 2-2-1-2-3 or 5-2-3 days.
 */
const sentinelRepeatCycleDays = 10;
/** Recent cycles whose acquisition days are projected forward and the forecast span. */
const predictionCycles = 3;
const millisecondsPerDay = 86_400_000;

function toDayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / millisecondsPerDay;
}

/**
 * Predicts upcoming UTC acquisition dates from loaded `YYYY-MM-DD` acquisition dates.
 *
 * Each date seen during the last three cycles before the latest acquisition repeats
 * every 10 days. Returns dates after the latest acquisition, up to 30 days after
 * `today`. Returns nothing unless the recent history spans at least one full cycle
 * (otherwise some repeating days were never observed) and reaches within one cycle of
 * `today` (otherwise the loaded months are historical).
 */
export function predictSentinelAcquisitionDates(
  acquisitionDates: readonly string[],
  today: string,
): ReadonlySet<string> {
  const predictions = new Set<string>();
  const days = acquisitionDates.map(toDayNumber);
  if (days.length === 0) return predictions;
  const latest = Math.max(...days);
  const todayDay = toDayNumber(today);
  if (latest < todayDay - sentinelRepeatCycleDays) return predictions;

  const recentDays = days.filter(
    (day) => day > latest - predictionCycles * sentinelRepeatCycleDays,
  );
  if (latest - Math.min(...recentDays) < sentinelRepeatCycleDays) return predictions;

  const cyclePhases = new Set(recentDays.map((day) => day % sentinelRepeatCycleDays));
  const lastPredictedDay = todayDay + predictionCycles * sentinelRepeatCycleDays;
  for (let day = latest + 1; day <= lastPredictedDay; day += 1) {
    if (cyclePhases.has(day % sentinelRepeatCycleDays)) {
      predictions.add(new Date(day * millisecondsPerDay).toISOString().slice(0, 10));
    }
  }
  return predictions;
}
