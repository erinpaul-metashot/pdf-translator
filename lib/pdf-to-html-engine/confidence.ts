import type {
  ConversionConfidenceDiagnostics,
  ConversionConfidenceOptions,
  ConversionConfidencePageDiagnostic,
  ConversionConfidenceThresholds,
} from './types';

const DEFAULT_THRESHOLDS: ConversionConfidenceThresholds = {
  textCharWarnRatio: 0.93,
  textCharCriticalRatio: 0.85,
  tokenWarnRatio: 0.9,
  tokenCriticalRatio: 0.8,
  numericWarnRatio: 1,
  numericCriticalRatio: 0.95,
};

const DEFAULT_OPTIONS: Required<ConversionConfidenceOptions> = {
  enabled: true,
  thresholds: DEFAULT_THRESHOLDS,
};

interface ResolvedConfidenceOptions {
  enabled: boolean;
  thresholds: ConversionConfidenceThresholds;
}

function stripHtmlToText(input: string): string {
  return input
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function countTokens(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function countNumericTokens(text: string): number {
  return (text.match(/[-+]?\d[\d,]*(?:\.\d+)?%?/g) ?? []).length;
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 1;
  }

  const ratio = numerator / denominator;
  if (!Number.isFinite(ratio)) {
    return 1;
  }

  return Math.max(0, Math.min(1, ratio));
}

function resolveThresholds(options: ConversionConfidenceOptions | undefined): ConversionConfidenceThresholds {
  if (!options?.thresholds) {
    return DEFAULT_THRESHOLDS;
  }

  const source = options.thresholds;
  return {
    textCharWarnRatio: source.textCharWarnRatio ?? DEFAULT_THRESHOLDS.textCharWarnRatio,
    textCharCriticalRatio: source.textCharCriticalRatio ?? DEFAULT_THRESHOLDS.textCharCriticalRatio,
    tokenWarnRatio: source.tokenWarnRatio ?? DEFAULT_THRESHOLDS.tokenWarnRatio,
    tokenCriticalRatio: source.tokenCriticalRatio ?? DEFAULT_THRESHOLDS.tokenCriticalRatio,
    numericWarnRatio: source.numericWarnRatio ?? DEFAULT_THRESHOLDS.numericWarnRatio,
    numericCriticalRatio: source.numericCriticalRatio ?? DEFAULT_THRESHOLDS.numericCriticalRatio,
  };
}

function resolveOptions(options: ConversionConfidenceOptions | undefined): ResolvedConfidenceOptions {
  return {
    enabled: options?.enabled ?? DEFAULT_OPTIONS.enabled,
    thresholds: resolveThresholds(options),
  };
}

export function createPageConfidenceDiagnostic(
  pageNumber: number,
  rawPageHtml: string,
  normalizedPageHtml: string,
  options?: ConversionConfidenceOptions
): ConversionConfidencePageDiagnostic {
  const resolved = resolveOptions(options);
  const rawText = stripHtmlToText(rawPageHtml);
  const normalizedText = stripHtmlToText(normalizedPageHtml);

  const rawTextChars = rawText.length;
  const normalizedTextChars = normalizedText.length;
  const rawTokenCount = countTokens(rawText);
  const normalizedTokenCount = countTokens(normalizedText);
  const rawNumericCount = countNumericTokens(rawText);
  const normalizedNumericCount = countNumericTokens(normalizedText);

  const textCharRatio = safeRatio(normalizedTextChars, rawTextChars);
  const tokenRatio = safeRatio(normalizedTokenCount, rawTokenCount);
  const numericRatio = rawNumericCount > 0 ? safeRatio(normalizedNumericCount, rawNumericCount) : 1;

  const warnings: string[] = [];
  let severity: ConversionConfidencePageDiagnostic['severity'] = 'none';

  if (textCharRatio < resolved.thresholds.textCharCriticalRatio) {
    warnings.push(`Text retention is low (${Math.round(textCharRatio * 100)}%).`);
    severity = 'critical';
  } else if (textCharRatio < resolved.thresholds.textCharWarnRatio) {
    warnings.push(`Text retention is below expected (${Math.round(textCharRatio * 100)}%).`);
    severity = 'warning';
  }

  if (tokenRatio < resolved.thresholds.tokenCriticalRatio) {
    warnings.push(`Token retention is low (${Math.round(tokenRatio * 100)}%).`);
    severity = 'critical';
  } else if (tokenRatio < resolved.thresholds.tokenWarnRatio && severity !== 'critical') {
    warnings.push(`Token retention is below expected (${Math.round(tokenRatio * 100)}%).`);
    severity = 'warning';
  }

  if (rawNumericCount >= 3 && numericRatio < resolved.thresholds.numericCriticalRatio) {
    warnings.push(`Numeric retention is low (${Math.round(numericRatio * 100)}%).`);
    severity = 'critical';
  } else if (rawNumericCount >= 3 && numericRatio < resolved.thresholds.numericWarnRatio && severity !== 'critical') {
    warnings.push(`Numeric retention is below expected (${Math.round(numericRatio * 100)}%).`);
    severity = 'warning';
  }

  const baseScore = 0.55 * textCharRatio + 0.25 * tokenRatio + 0.2 * numericRatio;
  const penalty = severity === 'critical' ? 0.15 : severity === 'warning' ? 0.05 : 0;
  const score = Math.max(0, Math.min(1, baseScore - penalty));

  return {
    pageNumber,
    rawTextChars,
    normalizedTextChars,
    rawTokenCount,
    normalizedTokenCount,
    rawNumericCount,
    normalizedNumericCount,
    textCharRatio,
    tokenRatio,
    numericRatio,
    score,
    severity,
    warnings,
  };
}

export function buildConfidenceDiagnostics(
  pageDiagnostics: ConversionConfidencePageDiagnostic[],
  options?: ConversionConfidenceOptions
): ConversionConfidenceDiagnostics {
  const resolved = resolveOptions(options);

  if (pageDiagnostics.length === 0) {
    return {
      summary: {
        score: 1,
        band: 'high',
        totalPages: 0,
        warningPages: 0,
        criticalPages: 0,
      },
      thresholds: resolved.thresholds,
      pages: [],
      warnings: [],
    };
  }

  const warningPages = pageDiagnostics.filter((page) => page.severity === 'warning').length;
  const criticalPages = pageDiagnostics.filter((page) => page.severity === 'critical').length;
  const totalScore = pageDiagnostics.reduce((acc, page) => acc + page.score, 0);
  const score = Math.max(0, Math.min(1, totalScore / pageDiagnostics.length));

  const band: ConversionConfidenceDiagnostics['summary']['band'] =
    criticalPages > 0 || score < 0.86 ? 'low' : score < 0.93 || warningPages > 0 ? 'medium' : 'high';

  const warnings = pageDiagnostics.flatMap((page) => page.warnings.map((warning) => `Page ${page.pageNumber}: ${warning}`));

  return {
    summary: {
      score,
      band,
      totalPages: pageDiagnostics.length,
      warningPages,
      criticalPages,
    },
    thresholds: resolved.thresholds,
    pages: pageDiagnostics,
    warnings,
  };
}
