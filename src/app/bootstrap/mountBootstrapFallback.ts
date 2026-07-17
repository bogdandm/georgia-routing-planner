import type { DiagnosticsService } from '@/diagnostics/export/DiagnosticsService';

export function mountBootstrapFallback(
  root: HTMLElement,
  diagnostics: DiagnosticsService,
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
    diagnostics.downloadBundle('Application failed before React could mount.');
  });
  container.append(heading, description, button);
  root.replaceChildren(container);
}
