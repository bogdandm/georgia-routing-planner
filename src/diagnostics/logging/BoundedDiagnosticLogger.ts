import type { Clock } from '@/application/ports/Clock';
import type {
  DiagnosticEvent,
  DiagnosticInput,
  DiagnosticLogger,
} from '@/application/ports/DiagnosticLogger';
import type { IdGenerator } from '@/application/ports/IdGenerator';
import { redactDiagnosticInput } from '@/diagnostics/redaction/redactDiagnosticData';

export class BoundedDiagnosticLogger implements DiagnosticLogger {
  readonly #events: DiagnosticEvent[] = [];

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

      this.#events.push(event);
      if (this.#events.length > this.capacity) {
        this.#events.splice(0, this.#events.length - this.capacity);
      }

      if (this.consoleEnabled) {
        this.writeToConsole(event);
      }
    } catch {
      // Diagnostics must never make the primary application fail.
    }
  }

  public getEvents(): readonly DiagnosticEvent[] {
    return [...this.#events];
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
