/**
 * Keeps runtime resources alive while Chrome stores the page in bfcache, then removes
 * its listener and disposes exactly once on final navigation or explicit HMR cleanup.
 */
export function registerPageLifecycleDisposal(
  disposeRuntime: () => void,
  target: Window = window,
): () => void {
  let disposed = false;
  const handlePageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) dispose();
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    target.removeEventListener('pagehide', handlePageHide);
    disposeRuntime();
  };
  target.addEventListener('pagehide', handlePageHide);
  return dispose;
}
