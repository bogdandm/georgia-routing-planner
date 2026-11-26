/** Formatters by locale and options; callers pass a handful of fixed option literals. */
const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Formats a fraction as a percent in the given locale, with the sign written next to the
 * number: `−27%`, not the `−27 %` that `Intl` produces for Russian.
 */
export function formatPercent(
  fraction: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, { ...options, style: 'percent' });
    formatters.set(key, formatter);
  }
  return formatter.format(fraction).replace(/\s%/u, '%');
}
