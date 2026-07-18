import type { DiagnosticLogger } from '@/application/ports/DiagnosticLogger';

export function installGlobalErrorCapture(logger: DiagnosticLogger): () => void {
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
