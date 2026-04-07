import { SUPPORTED_LANGUAGES } from './constants';

const LANGUAGE_CODE_ALIASES: Record<string, string> = {
  'or-IN': 'od-IN',
};

export const SUPPORTED_LANGUAGE_CODES = new Set(
  SUPPORTED_LANGUAGES.map((lang) => lang.code)
);

export function normalizeLanguageCode(
  raw: string | null | undefined,
  fallback: string
): string {
  if (!raw) return fallback;

  const normalized = LANGUAGE_CODE_ALIASES[raw] || raw;
  return SUPPORTED_LANGUAGE_CODES.has(normalized) ? normalized : fallback;
}
