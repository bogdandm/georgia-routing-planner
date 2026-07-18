/** Supplies wall-clock timestamps and monotonic durations without coupling callers to browser globals. */
export interface Clock {
  /** Returns calendar time for persisted records and diagnostic timestamps. */
  now(): Date;

  /** Returns monotonic milliseconds for measuring durations; it is not a calendar timestamp. */
  monotonicNow(): number;
}
