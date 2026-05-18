'use client';

import { PaginationBar } from '@/components/PaginationBar';

interface PaginationProps {
  current: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  itemLabel?: string;
}

export function Pagination({
  current,
  total,
  pageSize,
  onChange,
  pageSizeOptions = [pageSize],
  onPageSizeChange = () => {},
  itemLabel = 'Skill',
}: PaginationProps) {
  return (
    <PaginationBar
      current={current}
      total={total}
      pageSize={pageSize}
      onPageChange={onChange}
      pageSizeOptions={pageSizeOptions}
      onPageSizeChange={onPageSizeChange}
      itemLabel={itemLabel}
    />
  );
}
