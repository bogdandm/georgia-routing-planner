import type { Clock } from '@/application/ports/Clock';

export class BrowserClock implements Clock {
  public now(): Date {
    return new Date();
  }

  public monotonicNow(): number {
    return performance.now();
  }
}
