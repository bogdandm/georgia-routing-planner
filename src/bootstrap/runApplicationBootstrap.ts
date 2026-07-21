import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import { createRuntimeServices } from '@/bootstrap/createRuntimeServices';
import {
  mountBootstrapFallback,
  type BootstrapFallbackOptions,
} from '@/bootstrap/mountBootstrapFallback';

function installGlobalErrorCapture(logger: RuntimeServices['logger']): () => void {
  const handleError = (event: ErrorEvent) => {
    logger.log({
      level: 'error',
      name: 'runtime.window.error',
      message: event.error instanceof Error ? event.error.message : event.message,
    });
  };
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    logger.log({
      level: 'error',
      name: 'runtime.promise.unhandled',
      message:
        event.reason instanceof Error
          ? event.reason.message
          : 'A promise was rejected with a non-Error reason.',
    });
  };

  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  };
}

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
export async function runApplicationBootstrap(
  renderApplication: (
    root: HTMLElement,
    services: RuntimeServices,
  ) => void | Promise<void>,
  dependencies: ApplicationBootstrapDependencies = defaultDependencies,
): Promise<void> {
  let services: RuntimeServices | null = null;
  const rootElement = dependencies.document.querySelector<HTMLElement>('#root');

  try {
    if (rootElement === null) {
      throw new Error('The application root element is missing.');
    }
    const createdServices = dependencies.createServices();
    services = createdServices;
    const removeErrorCapture = dependencies.installErrorCapture(createdServices.logger);
    let disposed = false;
    services = {
      ...createdServices,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        try {
          removeErrorCapture();
        } finally {
          createdServices.dispose();
        }
      },
    };
    await renderApplication(rootElement, services);
    services.logger.log({ level: 'info', name: 'app.bootstrap.render-requested' });
  } catch (error) {
    services?.logger.log({
      level: 'error',
      name: 'app.bootstrap.failed',
      message: error instanceof Error ? error.message : 'Unknown bootstrap failure',
    });
    try {
      services?.dispose();
    } catch {
      // The independent fallback must remain available even when cleanup fails.
    }
    dependencies.mountFallback(rootElement ?? dependencies.document.body, {
      error,
      ...(services === null ? {} : { diagnostics: services.diagnostics }),
    });
  }
}
