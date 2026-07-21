import { describe, expect, it, vi } from 'vitest';

import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import type { BootstrapFallbackOptions } from '@/bootstrap/mountBootstrapFallback';
import { runApplicationBootstrap } from '@/bootstrap/runApplicationBootstrap';

describe('runApplicationBootstrap', () => {
  it('mounts the independent fallback when service construction fails', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const failure = new Error('service construction failed');
    const mountFallback =
      vi.fn<(root: HTMLElement, options: BootstrapFallbackOptions) => void>();

    await runApplicationBootstrap(vi.fn(), {
      document,
      createServices: () => {
        throw failure;
      },
      installErrorCapture: vi.fn(),
      mountFallback,
    });

    expect(mountFallback).toHaveBeenCalledWith(document.querySelector('#root'), {
      error: failure,
    });
  });

  it('uses the document body when the configured root is missing', async () => {
    document.body.replaceChildren();
    const mountFallback =
      vi.fn<(root: HTMLElement, options: BootstrapFallbackOptions) => void>();
    const createServices = vi.fn<() => RuntimeServices>();

    await runApplicationBootstrap(vi.fn(), {
      document,
      createServices,
      installErrorCapture: vi.fn(),
      mountFallback,
    });

    expect(createServices).not.toHaveBeenCalled();
    const fallbackCall = mountFallback.mock.calls[0];
    expect(fallbackCall?.[0]).toBe(document.body);
    expect(fallbackCall?.[1].error).toBeInstanceOf(Error);
  });

  it('waits for initial state restoration before completing bootstrap', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const services = {
      logger: { log: vi.fn() },
    } as unknown as RuntimeServices;
    let finishRestoration: (() => void) | undefined;
    const renderApplication = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRestoration = resolve;
        }),
    );

    const bootstrap = runApplicationBootstrap(renderApplication, {
      document,
      createServices: () => services,
      installErrorCapture: vi.fn(),
      mountFallback: vi.fn(),
    });

    expect(renderApplication).toHaveBeenCalledOnce();
    let completed = false;
    void bootstrap.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    finishRestoration?.();
    await bootstrap;
    expect(completed).toBe(true);
  });

  it('releases error capture and runtime resources when rendering fails', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const failure = new Error('render failed');
    const disposeRuntime = vi.fn();
    const removeErrorCapture = vi.fn();
    const services = {
      dispose: disposeRuntime,
      diagnostics: {},
      logger: { log: vi.fn() },
    } as unknown as RuntimeServices;
    const mountFallback =
      vi.fn<(root: HTMLElement, options: BootstrapFallbackOptions) => void>();

    await runApplicationBootstrap(() => Promise.reject(failure), {
      document,
      createServices: () => services,
      installErrorCapture: () => removeErrorCapture,
      mountFallback,
    });

    expect(removeErrorCapture).toHaveBeenCalledOnce();
    expect(disposeRuntime).toHaveBeenCalledOnce();
    expect(mountFallback).toHaveBeenCalledWith(document.querySelector('#root'), {
      error: failure,
      diagnostics: services.diagnostics,
    });
  });
});
