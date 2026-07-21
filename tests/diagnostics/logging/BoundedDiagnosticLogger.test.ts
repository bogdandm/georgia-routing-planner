import { describe, expect, it, vi } from 'vitest';

import type { Clock } from '@/application/ports/Clock';
import type { DiagnosticLevel } from '@/application/ports/DiagnosticLogger';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import { BoundedDiagnosticLogger } from '@/diagnostics/logging/BoundedDiagnosticLogger';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-07-18T10:00:00.000Z');
  }

  public monotonicNow(): number {
    return 10;
  }
}

class IncrementingIdGenerator implements IdGenerator {
  #value = 0;

  public generate(): string {
    this.#value += 1;
    return `event-${String(this.#value)}`;
  }
}

describe('BoundedDiagnosticLogger', () => {
  it('retains only the newest events within its capacity', () => {
    const logger = new BoundedDiagnosticLogger(
      new FixedClock(),
      new IncrementingIdGenerator(),
      2,
    );

    logger.log({ level: 'info', name: 'first' });
    logger.log({ level: 'info', name: 'second' });
    logger.log({ level: 'info', name: 'third' });

    expect(logger.getEvents().map((event) => event.name)).toEqual(['second', 'third']);
    expect(logger.getEvents()[0]?.timestamp).toBe('2026-07-18T10:00:00.000Z');
  });

  it('rejects an unusable ring-buffer capacity', () => {
    expect(
      () =>
        new BoundedDiagnosticLogger(new FixedClock(), new IncrementingIdGenerator(), 0),
    ).toThrow('at least one');
  });

  it.each<DiagnosticLevel>(['debug', 'info', 'warn', 'error'])(
    'writes %s events only through the optional console sink',
    (level) => {
      const consoleMethod = vi
        .spyOn(console, level === 'debug' ? 'debug' : level)
        .mockImplementation(() => undefined);
      const logger = new BoundedDiagnosticLogger(
        new FixedClock(),
        new IncrementingIdGenerator(),
        2,
        true,
      );

      logger.log({ level, name: 'console.event', data: { status: 'ok' } });

      expect(consoleMethod).toHaveBeenCalledWith('console.event', { status: 'ok' });
    },
  );

  it('swallows sink construction failures to protect the primary operation', () => {
    const brokenIds: IdGenerator = {
      generate: () => {
        throw new Error('broken');
      },
    };
    const logger = new BoundedDiagnosticLogger(new FixedClock(), brokenIds);

    expect(() => {
      logger.log({ level: 'error', name: 'will.not.persist' });
    }).not.toThrow();
    expect(logger.getEvents()).toEqual([]);
  });
});
