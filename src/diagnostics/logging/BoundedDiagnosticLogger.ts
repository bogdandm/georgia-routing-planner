import type { Clock } from '@/application/ports/Clock';
import type {
  DiagnosticEvent,
  DiagnosticInput,
  DiagnosticLogger,
} from '@/application/ports/DiagnosticLogger';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import { redactDiagnosticInput } from '@/diagnostics/redaction/redactDiagnosticData';

/**
 * Redacts events before retaining them in a fixed-capacity ring buffer. Logging is
 * deliberately best-effort so diagnostics cannot turn a recoverable failure into one.
 */
export class BoundedDiagnosticLogger implements DiagnosticLogger {
  #events: readonly DiagnosticEvent[] = [];
  readonly #listeners = new Set<() => void>();

  public constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly capacity = 200,
    private readonly consoleEnabled = false,
  ) {
    if (capacity < 1) {
      throw new RangeError('Diagnostic capacity must be at least one.');
    }
  }

  public log(input: DiagnosticInput): void {
    try {
      const safeInput = redactDiagnosticInput(input);
      const event: DiagnosticEvent = {
        ...safeInput,
        id: this.idGenerator.generate(),
        timestamp: this.clock.now().toISOString(),
      };

      const events = [...this.#events, event];
      this.#events =
        events.length > this.capacity ? events.slice(-this.capacity) : events;

      if (this.consoleEnabled) {
        this.writeToConsole(event);
      }
      for (const listener of this.#listeners) listener();
    } catch {
      // Diagnostics must never make the primary application fail.
    }
  }

  public getEvents(): readonly DiagnosticEvent[] {
    return this.#events;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  private writeToConsole(event: DiagnosticEvent): void {
    const payload = event.data ?? {};
    switch (event.level) {
      case 'debug':
        console.debug(event.name, payload);
        break;
      case 'info':
        console.info(event.name, payload);
        break;
      case 'warn':
        console.warn(event.name, payload);
        break;
      case 'error':
        console.error(event.name, payload);
        break;
    }
  }
}
