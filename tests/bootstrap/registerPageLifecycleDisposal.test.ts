import { describe, expect, it, vi } from 'vitest';

import { registerPageLifecycleDisposal } from '@/bootstrap/registerPageLifecycleDisposal';

function pageHideEvent(persisted: boolean): PageTransitionEvent {
  const event = new Event('pagehide') as PageTransitionEvent;
  Object.defineProperty(event, 'persisted', { value: persisted });
  return event;
}

describe('registerPageLifecycleDisposal', () => {
  it('survives bfcache pagehide and disposes on the later final navigation', () => {
    const disposeRuntime = vi.fn();
    const dispose = registerPageLifecycleDisposal(disposeRuntime);

    window.dispatchEvent(pageHideEvent(true));
    expect(disposeRuntime).not.toHaveBeenCalled();

    window.dispatchEvent(pageHideEvent(false));
    expect(disposeRuntime).toHaveBeenCalledOnce();

    window.dispatchEvent(pageHideEvent(false));
    dispose();
    expect(disposeRuntime).toHaveBeenCalledOnce();
  });

  it('removes the pagehide listener during explicit HMR cleanup', () => {
    const disposeRuntime = vi.fn();
    const dispose = registerPageLifecycleDisposal(disposeRuntime);

    dispose();
    window.dispatchEvent(pageHideEvent(false));

    expect(disposeRuntime).toHaveBeenCalledOnce();
  });
});
