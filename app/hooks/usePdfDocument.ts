'use client';

import { useState, useCallback } from 'react';

interface PdfDocumentState {
  currentPage: number;
  totalPages: number;
  isLoading: boolean;
}

export function usePdfDocument() {
  const [docState, setDocState] = useState<PdfDocumentState>({
    currentPage: 1,
    totalPages: 0,
    isLoading: false,
  });

  const setTotalPages = useCallback((total: number, preferredPage?: number) => {
    setDocState((prev) => {
      if (total <= 0) {
        return { ...prev, totalPages: 0, currentPage: 1 };
      }

      const targetPage = preferredPage ?? prev.currentPage;
      const clampedPage = Math.max(1, Math.min(targetPage, total));

      return { ...prev, totalPages: total, currentPage: clampedPage };
    });
  }, []);

  const goToPage = useCallback((page: number) => {
    setDocState((prev) => {
      const clamped = Math.max(1, Math.min(page, prev.totalPages));
      return { ...prev, currentPage: clamped };
    });
  }, []);

  const nextPage = useCallback(() => {
    setDocState((prev) => {
      if (prev.currentPage >= prev.totalPages) return prev;
      return { ...prev, currentPage: prev.currentPage + 1 };
    });
  }, []);

  const prevPage = useCallback(() => {
    setDocState((prev) => {
      if (prev.currentPage <= 1) return prev;
      return { ...prev, currentPage: prev.currentPage - 1 };
    });
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setDocState((prev) => ({ ...prev, isLoading: loading }));
  }, []);

  return {
    ...docState,
    setTotalPages,
    goToPage,
    nextPage,
    prevPage,
    setLoading,
  };
}
