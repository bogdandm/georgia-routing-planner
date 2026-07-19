import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import { createRuntimeServices } from '@/bootstrap/createRuntimeServices';
import { installGlobalErrorCapture } from '@/bootstrap/installGlobalErrorCapture';
import {
  mountBootstrapFallback,
  type BootstrapFallbackOptions,
} from '@/bootstrap/mountBootstrapFallback';

interface ApplicationBootstrapDependencies {
  readonly document: Document;
  readonly createServices: () => RuntimeServices;
  readonly installErrorCapture: typeof installGlobalErrorCapture;
  readonly mountFallback: (
    root: HTMLElement,
    options: BootstrapFallbackOptions,
  ) => void;
}

const defaultDependencies: ApplicationBootstrapDependencies = {
  document,
  createServices: createRuntimeServices,
  installErrorCapture: installGlobalErrorCapture,
  mountFallback: mountBootstrapFallback,
};

/**
 * Owns the pre-React failure boundary. The fallback deliberately remains usable when
 * dependency construction fails and the normal diagnostics service does not exist.
 */
export function runApplicationBootstrap(
  renderApplication: (root: HTMLElement, services: RuntimeServices) => void,
  dependencies: ApplicationBootstrapDependencies = defaultDependencies,
): void {
  let services: RuntimeServices | null = null;
  const rootElement = dependencies.document.querySelector<HTMLElement>('#root');

  try {
    if (rootElement === null) {
      throw new Error('The application root element is missing.');
    }
    services = dependencies.createServices();
    dependencies.installErrorCapture(services.logger);
    renderApplication(rootElement, services);
    services.logger.log({ level: 'info', name: 'app.bootstrap.render-requested' });
  } catch (error) {
    services?.logger.log({
      level: 'error',
      name: 'app.bootstrap.failed',
      message: error instanceof Error ? error.message : 'Unknown bootstrap failure',
    });
    dependencies.mountFallback(rootElement ?? dependencies.document.body, {
      error,
      ...(services === null ? {} : { diagnostics: services.diagnostics }),
    });
  }
}
