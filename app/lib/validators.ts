import type { TranslationScope, ValidationError } from './types';
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_LABEL, MAX_PAGE_COUNT, ACCEPTED_FILE_TYPES } from './constants';

/**
 * Validate a PDF file for type and size constraints.
 */
export function validatePdfFile(file: File): ValidationError | null {
  if (!ACCEPTED_FILE_TYPES.includes(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
    return { field: 'file', message: 'Only PDF files are accepted.' };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      field: 'file',
      message: `File size exceeds ${MAX_FILE_SIZE_LABEL}. Please upload a smaller file.`,
    };
  }

  return null;
}

/**
 * Validate page count against the maximum allowed.
 */
export function validatePageCount(pageCount: number): ValidationError | null {
  if (pageCount > MAX_PAGE_COUNT) {
    return {
      field: 'pages',
      message: `PDF has ${pageCount} pages. Maximum allowed is ${MAX_PAGE_COUNT} pages.`,
    };
  }
  return null;
}

/**
 * Validate translation scope against total page count.
 */
export function validateScope(
  scope: TranslationScope,
  totalPages: number
): ValidationError | null {
  if (scope.mode === 'full') return null;

  if (scope.mode === 'selected') {
    if (!scope.pages || scope.pages.length === 0) {
      return { field: 'scope', message: 'Please select at least one page.' };
    }
    const invalid = scope.pages.find((p) => p < 1 || p > totalPages);
    if (invalid !== undefined) {
      return {
        field: 'scope',
        message: `Page ${invalid} is out of range (1-${totalPages}).`,
      };
    }
    const unique = new Set(scope.pages);
    if (unique.size !== scope.pages.length) {
      return { field: 'scope', message: 'Duplicate page numbers are not allowed.' };
    }
  }

  if (scope.mode === 'range') {
    const { startPage, endPage } = scope;
    if (startPage === undefined || endPage === undefined) {
      return { field: 'scope', message: 'Please specify both start and end page.' };
    }
    if (startPage < 1 || endPage < 1) {
      return { field: 'scope', message: 'Page numbers must be at least 1.' };
    }
    if (startPage > endPage) {
      return { field: 'scope', message: 'Start page must be ≤ end page.' };
    }
    if (endPage > totalPages) {
      return {
        field: 'scope',
        message: `End page ${endPage} exceeds total pages (${totalPages}).`,
      };
    }
  }

  return null;
}
