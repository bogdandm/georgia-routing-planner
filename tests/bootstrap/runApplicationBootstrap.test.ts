import { describe, expect, it, vi } from 'vitest';

import type { RuntimeServices } from '@/bootstrap/createRuntimeServices';
import type { BootstrapFallbackOptions } from '@/bootstrap/mountBootstrapFallback';
import { runApplicationBootstrap } from '@/bootstrap/runApplicationBootstrap';

describe('runApplicationBootstrap', () => {
  it('mounts the independent fallback when service construction fails', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const failure = new Error('service construction failed');
    const mountFallback =
      vi.fn<(root: HTMLElement, options: BootstrapFallbackOptions) => void>();

    runApplicationBootstrap(vi.fn(), {
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

  it('uses the document body when the configured root is missing', () => {
    document.body.replaceChildren();
    const mountFallback =
      vi.fn<(root: HTMLElement, options: BootstrapFallbackOptions) => void>();
    const createServices = vi.fn<() => RuntimeServices>();

    runApplicationBootstrap(vi.fn(), {
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
});
