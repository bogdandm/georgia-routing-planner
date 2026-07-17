export interface Clock {
  now(): Date;
  monotonicNow(): number;
}
