import { useEffect, useEffectEvent } from 'react';

/**
 * Delay between the page becoming visible again and the retry. A resumed phone or
 * background tab usually needs a moment to restore its network connection.
 */
export const weatherResumeRetryDelayMs = 3000;

/**
 * While `failed`, calls `retry` once the page has stayed visible for
 * `weatherResumeRetryDelayMs` after returning from the background (another browser
 * tab, a minimized window, or a backgrounded mobile app). Hiding the page again before
 * the delay cancels that retry.
 */
export function useWeatherRetryOnResume(failed: boolean, retry: () => void): void {
  const retryLatest = useEffectEvent(retry);
  useEffect(() => {
    if (!failed) return undefined;
    let timer: number | undefined;
    const handleVisibilityChange = () => {
      window.clearTimeout(timer);
      timer = undefined;
      if (document.visibilityState !== 'visible') return;
      timer = window.setTimeout(() => {
        retryLatest();
      }, weatherResumeRetryDelayMs);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearTimeout(timer);
    };
  }, [failed]);
}
