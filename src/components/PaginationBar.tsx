'use client';

import { useMemo, useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  const pages: (number | string)[] = [];
  const maxVisible = 5;

  if (totalPages <= maxVisible) {
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
  } else {
    if (current <= 3) {
      pages.push(1, 2, 3, 4, '...', totalPages);
    } else if (current >= totalPages - 2) {
      pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, '...left', current - 1, current, current + 1, '...right', totalPages);
    }
  }

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
  paginationStyle = 'numbered',
}: PaginationBarProps) {
  const [inputPage, setInputPage] = useState('');
  const totalPages = Math.ceil(total / pageSize);

  const summaryLabel = useMemo(() => {
    if (!total) return `暂无${itemLabel}`;
    const start = (current - 1) * pageSize + 1;
    const end = Math.min(current * pageSize, total);
    return `显示 ${start}-${end} / ${total} 个${itemLabel}`;
  }, [current, pageSize, total, itemLabel]);

  const showViewToggle = viewMode !== undefined && onViewModeChange !== undefined;

  const handleInputPageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputPage(e.target.value);
  };

  const handleInputPageSubmit = () => {
    const pageNum = parseInt(inputPage, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      onPageChange(pageNum);
      setInputPage('');
    }
  };

  const handleInputKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleInputPageSubmit();
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 mt-6">
      {/* Left: summary + page size */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {summaryLabel}
        </span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-9 w-[112px] bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((opt) => (
              <SelectItem key={opt} value={String(opt)}>
                {opt} / 页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Right: view toggle + navigation */}
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

        {/* Page navigation */}
        {totalPages > 1 ? (
          paginationStyle === 'numbered' ? (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => onPageChange(current - 1)}
                disabled={current === 1}
                variant="outline"
                size="sm"
              >
                上一页
              </Button>
              {totalPages > 10 ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">第</span>
                  <input
                    type="text"
                    value={inputPage}
                    onChange={handleInputPageChange}
                    onKeyPress={handleInputKeyPress}
                    onBlur={handleInputPageSubmit}
                    placeholder={current.toString()}
                    className="w-16 px-2 py-1 text-sm text-center border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-sm text-muted-foreground">页</span>
                </div>
              ) : (
                getVisiblePages(current, totalPages).map((page, index) => (
                  typeof page === 'number' ? (
                    <Button
                      key={page}
                      onClick={() => onPageChange(page)}
                      variant={current === page ? 'default' : 'outline'}
                      size="sm"
                    >
                      {page}
                    </Button>
                  ) : (
                    <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">
                      ...
                    </span>
                  )
                ))
              )}
              <Button
                onClick={() => onPageChange(current + 1)}
                disabled={current === totalPages}
                variant="outline"
                size="sm"
              >
                下一页
              </Button>
              <span className="text-sm text-muted-foreground ml-2">
                共 {total} 个
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => onPageChange(current - 1)}
                disabled={current === 1}
                variant="outline"
                size="sm"
              >
                上一页
              </Button>
              <Badge variant="secondary">
                第 {current} / {totalPages} 页
              </Badge>
              <Button
                onClick={() => onPageChange(current + 1)}
                disabled={current === totalPages}
                variant="outline"
                size="sm"
              >
                下一页
              </Button>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
