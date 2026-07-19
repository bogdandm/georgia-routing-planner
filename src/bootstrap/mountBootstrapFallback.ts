import type { DiagnosticsService } from '@/diagnostics/export/DiagnosticsService';
import { sanitizeDiagnosticText } from '@/diagnostics/redaction/redactDiagnosticData';

export interface BootstrapFallbackOptions {
  readonly diagnostics?: Pick<DiagnosticsService, 'downloadBundle'>;
  readonly error: unknown;
}

interface EmergencyBootstrapBundle {
  readonly schemaVersion: 1;
  readonly kind: 'bootstrap-failure';
  readonly exportedAt: string;
  readonly failure: {
    readonly code: 'app.bootstrap.failed';
    readonly message: string;
  };
}

export function createEmergencyBootstrapBundle(
  error: unknown,
  exportedAt = new Date(),
): EmergencyBootstrapBundle {
  return {
    schemaVersion: 1,
    kind: 'bootstrap-failure',
    exportedAt: exportedAt.toISOString(),
    failure: {
      code: 'app.bootstrap.failed',
      message: sanitizeDiagnosticText(
        error instanceof Error ? error.message : 'Unknown bootstrap failure',
      ),
    },
  };
}

function downloadEmergencyBootstrapBundle(error: unknown): void {
  const payload = JSON.stringify(createEmergencyBootstrapBundle(error), null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'georgia-routing-planner-bootstrap-diagnostics.json';
  link.click();
  URL.revokeObjectURL(url);
}

export function mountBootstrapFallback(
  root: HTMLElement,
  options: BootstrapFallbackOptions,
): void {
  const container = document.createElement('main');
  container.style.cssText =
    'font:16px system-ui;max-width:42rem;margin:4rem auto;padding:2rem;color:#17231b';
  const heading = document.createElement('h1');
  heading.textContent = 'Georgia Routing Planner could not start';
  const description = document.createElement('p');
  description.textContent =
    'Download a privacy-safe diagnostics bundle and include it with the issue report.';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Download diagnostics';
  button.addEventListener('click', () => {
    try {
      if (options.diagnostics === undefined) {
        downloadEmergencyBootstrapBundle(options.error);
      } else {
        options.diagnostics.downloadBundle(
          'Application failed before React could mount.',
        );
      }
    } catch {
      downloadEmergencyBootstrapBundle(options.error);
    }
  });
  container.append(heading, description, button);
  root.replaceChildren(container);
}
