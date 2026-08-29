import { BadRequestException } from '@nestjs/common';

export const SUPPORTED_LOCALES = ['en', 'ha', 'yo', 'ig', 'fr', 'ar'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);

export function normalizeLocale(value: unknown): SupportedLocale | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace('_', '-').toLowerCase();
  if (!normalized) return null;
  const language = normalized.split('-')[0];
  return SUPPORTED_LOCALE_SET.has(language)
    ? (language as SupportedLocale)
    : null;
}

export function assertSupportedLocale(value: unknown): SupportedLocale {
  const locale = normalizeLocale(value);
  if (locale) return locale;
  throw new BadRequestException({
    code: 'UNSUPPORTED_LOCALE',
    message: 'Preferred locale is not supported.',
    params: { supportedLocales: SUPPORTED_LOCALES },
  });
}

export function preferredLocaleFromProfile(profileData: unknown) {
  if (
    !profileData ||
    typeof profileData !== 'object' ||
    Array.isArray(profileData)
  ) {
    return DEFAULT_LOCALE;
  }
  return (
    normalizeLocale(
      (profileData as Record<string, unknown>).preferredLanguage,
    ) ?? DEFAULT_LOCALE
  );
}
