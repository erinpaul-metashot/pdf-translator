import type { Language } from './types';

// ── File Validation Limits ─────────────────────────────────────────────
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_FILE_SIZE_LABEL = '10MB';
export const MAX_PAGE_COUNT = 10;
export const ACCEPTED_FILE_TYPES = ['application/pdf'];

// ── Sarvam API ─────────────────────────────────────────────────────────
export const POLL_INTERVAL_MS = 5000;
export const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// ── Supported Languages ────────────────────────────────────────────────
export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'hi-IN', name: 'Hindi',     nativeName: 'हिन्दी',    flag: '🇮🇳' },
  { code: 'bn-IN', name: 'Bengali',   nativeName: 'বাংলা',     flag: '🇮🇳' },
  { code: 'ta-IN', name: 'Tamil',     nativeName: 'தமிழ்',     flag: '🇮🇳' },
  { code: 'te-IN', name: 'Telugu',    nativeName: 'తెలుగు',    flag: '🇮🇳' },
  { code: 'mr-IN', name: 'Marathi',   nativeName: 'मराठी',     flag: '🇮🇳' },
  { code: 'gu-IN', name: 'Gujarati',  nativeName: 'ગુજરાતી',   flag: '🇮🇳' },
  { code: 'kn-IN', name: 'Kannada',   nativeName: 'ಕನ್ನಡ',     flag: '🇮🇳' },
  { code: 'ml-IN', name: 'Malayalam', nativeName: 'മലയാളം',   flag: '🇮🇳' },
  { code: 'pa-IN', name: 'Punjabi',   nativeName: 'ਪੰਜਾਬੀ',    flag: '🇮🇳' },
  { code: 'od-IN', name: 'Odia',      nativeName: 'ଓଡ଼ିଆ',     flag: '🇮🇳' },
  { code: 'ur-IN', name: 'Urdu',      nativeName: 'اردو',      flag: '🇮🇳' },
  { code: 'en-IN', name: 'English',   nativeName: 'English',   flag: '🇬🇧' },
];

// ── Translation Models ─────────────────────────────────────────────────
export const TRANSLATION_MODEL = 'sarvam-translate:v1';
export const OCR_OUTPUT_FORMAT = 'html';
