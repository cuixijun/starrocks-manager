'use client';

import { useState, useMemo } from 'react';

interface UsePaginationOptions {
  defaultPageSize?: number;
}

interface UsePaginationResult<T> {
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  paginatedData: T[];
  setPage: (p: number) => void;
  setPageSize: (s: number) => void;
  resetPage: () => void;
}

export function usePagination<T>(data: T[], opts?: UsePaginationOptions): UsePaginationResult<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(opts?.defaultPageSize || 20);

  const totalItems = data.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Clamp page to valid range
  const safePage = Math.min(page, totalPages);

  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, safePage, pageSize]);

  const setPageSize = (s: number) => {
    setPageSizeRaw(s);
    setPage(1); // Reset to first page when changing page size
  };

  const resetPage = () => setPage(1);

  return {
    page: safePage,
    pageSize,
    totalPages,
    totalItems,
    paginatedData,
    setPage,
    setPageSize,
    resetPage,
  };
}
