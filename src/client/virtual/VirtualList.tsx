import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, type CSSProperties, type ReactNode, type UIEventHandler } from 'react';

type WritableRefObject<T> = {
  current: T;
};

export type VirtualListProps<T> = {
  items: Array<T>;
  estimateSize: number;
  height: number | string;
  className?: string;
  emptyState?: ReactNode;
  maxRenderedItems?: number;
  testId?: string;
  scrollRef?: WritableRefObject<HTMLDivElement | null>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  style?: CSSProperties;
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
};

export function VirtualList<T>({
  items,
  estimateSize,
  height,
  className,
  emptyState = null,
  maxRenderedItems,
  testId = 'virtual-list',
  scrollRef,
  onScroll,
  style,
  getKey,
  renderItem,
}: VirtualListProps<T>) {
  const localParentRef = useRef<HTMLDivElement | null>(null) as WritableRefObject<HTMLDivElement | null>;
  const parentRef = scrollRef || localParentRef;
  const setParentElementRef = (node: HTMLDivElement | null) => {
    localParentRef.current = node;
    if (scrollRef) {
      (scrollRef as WritableRefObject<HTMLDivElement | null>).current = node;
    }
  };
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    getItemKey: (index) => getKey(items[index], index),
    overscan: 8,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const renderedItems = typeof maxRenderedItems === 'number'
    ? virtualItems.slice(0, Math.max(0, maxRenderedItems))
    : virtualItems;

  if (items.length === 0) {
    return (
      <div
        ref={setParentElementRef}
        className={className}
        data-testid={testId}
        data-total-count={items.length}
        data-rendered-count={0}
        data-max-rendered-items={maxRenderedItems ?? ''}
        onScroll={onScroll}
        style={{ height, overflow: 'auto', contain: 'strict', ...style }}
      >
        {emptyState}
      </div>
    );
  }

  return (
    <div
      ref={setParentElementRef}
      className={className}
      data-testid={testId}
      data-total-count={items.length}
      data-rendered-count={renderedItems.length}
      data-max-rendered-items={maxRenderedItems ?? ''}
      onScroll={onScroll}
      style={{ height, overflow: 'auto', contain: 'strict', ...style }}
    >
      <div
        style={{
          height: rowVirtualizer.getTotalSize(),
          position: 'relative',
          width: '100%',
        }}
      >
        {renderedItems.map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              data-testid={`${testId}-item`}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
