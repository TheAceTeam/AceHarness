'use client';

import { Button } from '@/components/ui/button';

interface PaginationProps {
  current: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}

export function Pagination({ current, total, pageSize, onChange }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);

  const getVisiblePages = () => {
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
  };

  const visiblePages = getVisiblePages();

  return (
    <div className="flex justify-center items-center gap-2 mt-6">
      <Button
        onClick={() => onChange(current - 1)}
        disabled={current === 1}
        variant="outline"
        size="sm"
      >
        上一页
      </Button>

      {visiblePages.map((page, index) => (
        typeof page === 'number' ? (
          <Button
            key={page}
            onClick={() => onChange(page)}
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
      ))}

      <Button
        onClick={() => onChange(current + 1)}
        disabled={current === totalPages}
        variant="outline"
        size="sm"
      >
        下一页
      </Button>

      <div className="text-sm text-muted-foreground">
        共 {total} 个
      </div>
    </div>
  );
}