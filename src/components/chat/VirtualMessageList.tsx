'use client';

import { cn } from '@/lib/core/utils';

interface VirtualMessageItem {
  key: string;
  node: React.ReactNode;
}

interface VirtualMessageListProps {
  items: VirtualMessageItem[];
  className?: string;
  estimatedItemHeight?: number;
  overscan?: number;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  itemGap?: number;
}

/**
 * Renders messages in normal document flow with CSS content-visibility for performance.
 * This eliminates the overlap bug caused by absolute positioning + offset calculations.
 * The browser natively skips rendering of off-screen items via content-visibility: auto.
 */
export function VirtualMessageList({
  items,
  className,
  estimatedItemHeight = 176,
  itemGap = 16,
}: VirtualMessageListProps) {
  return (
    <div className={cn('min-h-0', className)}>
      {items.map((item) => (
        <div
          key={item.key}
          style={{
            contentVisibility: 'auto',
            containIntrinsicSize: `auto ${estimatedItemHeight}px`,
            paddingBottom: itemGap,
          }}
        >
          {item.node}
        </div>
      ))}
    </div>
  );
}
