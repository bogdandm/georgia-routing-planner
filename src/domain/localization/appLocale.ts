export const APP_LOCALES = ['en', 'ru'] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export function resolveAppLocale(
  saved: AppLocale | null,
  browserLanguages: readonly string[],
): AppLocale {
  if (saved !== null) return saved;

  for (const language of browserLanguages) {
    const baseLanguage = language.trim().split(/[-_]/, 1)[0]?.toLowerCase();
    if (baseLanguage === 'ru' || baseLanguage === 'en') return baseLanguage;
  }

  return 'en';
}
