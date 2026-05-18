'use client';

import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

type ViewMode = 'gallery' | 'table';

interface PaginationBarProps {
  current: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  pageSizeOptions: number[];
  onPageSizeChange: (size: number) => void;
  itemLabel?: string;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  viewModeStyle?: 'material' | 'lucide';
  galleryLabel?: string;
  tableLabel?: string;
  paginationStyle?: 'numbered' | 'simple';
}

function getVisiblePages(current: number, totalPages: number) {
  const pages: (number | '...left' | '...right')[] = [];
  const maxVisible = 7;

  if (totalPages <= maxVisible) {
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
    return pages;
  }

  if (current <= 4) {
    pages.push(1, 2, 3, 4, 5, '...right', totalPages);
    return pages;
  }

  if (current >= totalPages - 3) {
    pages.push(1, '...left', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    return pages;
  }

  pages.push(1, '...left', current - 1, current, current + 1, '...right', totalPages);
  return pages;
}

export function PaginationBar({
  current,
  total,
  pageSize,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  itemLabel = '项',
  viewMode,
  onViewModeChange,
  viewModeStyle = 'material',
  galleryLabel,
  tableLabel,
  paginationStyle: _paginationStyle = 'numbered',
}: PaginationBarProps) {
  const [inputPage, setInputPage] = useState('');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const visiblePages = useMemo(() => getVisiblePages(current, totalPages), [current, totalPages]);

  const showViewToggle = viewMode !== undefined && onViewModeChange !== undefined;

  useEffect(() => {
    setInputPage(String(current));
  }, [current]);

  const handleInputPageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputPage(e.target.value);
  };

  const handleInputPageSubmit = () => {
    const pageNum = parseInt(inputPage, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      onPageChange(pageNum);
      setInputPage(String(pageNum));
      return;
    }
    setInputPage(String(current));
  };

  const handleInputKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleInputPageSubmit();
    }
  };

  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          共 {total} 个{itemLabel}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {showViewToggle ? (
          <div className="inline-flex rounded-full border border-border/60 bg-muted/40 p-1">
            <Button
              size="sm"
              variant={viewMode === 'gallery' ? 'default' : 'ghost'}
              className="h-8 rounded-full px-3"
              onClick={() => onViewModeChange!('gallery')}
            >
              {viewModeStyle === 'lucide' ? (
                <LayoutGrid className="h-4 w-4" />
              ) : (
                <span className="material-symbols-outlined text-sm">grid_view</span>
              )}
              {galleryLabel ? <span className="ml-1.5 text-xs">{galleryLabel}</span> : null}
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              className="h-8 rounded-full px-3"
              onClick={() => onViewModeChange!('table')}
            >
              {viewModeStyle === 'lucide' ? (
                <List className="h-4 w-4" />
              ) : (
                <span className="material-symbols-outlined text-sm">table_rows</span>
              )}
              {tableLabel ? <span className="ml-1.5 text-xs">{tableLabel}</span> : null}
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Pagination className="mx-0 w-auto justify-start">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => onPageChange(current - 1)}
                  disabled={current === 1}
                />
              </PaginationItem>
              {visiblePages.map((page, index) => (
                <PaginationItem key={`${page}-${index}`}>
                  {typeof page === 'number' ? (
                    <PaginationLink
                      isActive={page === current}
                      onClick={() => onPageChange(page)}
                    >
                      {page}
                    </PaginationLink>
                  ) : page === '...left' ? (
                    <PaginationLink
                      aria-label="向前跳转 5 页"
                      onClick={() => onPageChange(Math.max(1, current - 5))}
                    >
                      ...
                    </PaginationLink>
                  ) : page === '...right' ? (
                    <PaginationLink
                      aria-label="向后跳转 5 页"
                      onClick={() => onPageChange(Math.min(totalPages, current + 5))}
                    >
                      ...
                    </PaginationLink>
                  ) : (
                    <PaginationEllipsis />
                  )}
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  onClick={() => onPageChange(current + 1)}
                  disabled={current === totalPages}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="h-9 w-[112px] bg-background">
              <span>{pageSize} / 页</span>
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((opt) => (
                <SelectItem key={opt} value={String(opt)}>
                  {opt} / 页
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>跳至</span>
            <input
              type="text"
              value={inputPage}
              onChange={handleInputPageChange}
              onKeyPress={handleInputKeyPress}
              onBlur={handleInputPageSubmit}
              aria-label="页码"
              className="h-9 w-16 rounded-md border bg-background px-2 py-1 text-center text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span>页</span>
          </div>
        </div>
      </div>
    </div>
  );
}
