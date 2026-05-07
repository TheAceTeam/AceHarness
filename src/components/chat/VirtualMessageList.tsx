'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

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
}

function computeOffsetWithinAncestor(element: HTMLElement, ancestor: HTMLElement): number {
  let offset = 0;
  let current: HTMLElement | null = element;
  while (current && current !== ancestor) {
    offset += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return offset;
}

export function VirtualMessageList({
  items,
  className,
  estimatedItemHeight = 176,
  overscan = 3,
  scrollContainerRef,
}: VirtualMessageListProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement | null>());
  const heightCacheRef = useRef(new Map<string, number>());
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [measureVersion, setMeasureVersion] = useState(0);

  useEffect(() => {
    const next = new Map<string, number>();
    for (const item of items) {
      next.set(item.key, heightCacheRef.current.get(item.key) ?? estimatedItemHeight);
    }
    heightCacheRef.current = next;
    setMeasureVersion((value) => value + 1);
  }, [estimatedItemHeight, items]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scrollElement = scrollContainerRef?.current || root;
    const updateViewport = () => {
      if (!root) return;
      const visibleHeight = scrollElement.clientHeight;
      const nextScrollTop = scrollElement === root
        ? scrollElement.scrollTop
        : scrollElement.scrollTop - computeOffsetWithinAncestor(root, scrollElement);
      setViewportHeight(visibleHeight);
      setScrollTop(nextScrollTop);
    };
    updateViewport();
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(scrollElement);
    resizeObserver.observe(root);
    scrollElement.addEventListener('scroll', updateViewport, { passive: true });
    return () => {
      resizeObserver.disconnect();
      scrollElement.removeEventListener('scroll', updateViewport);
    };
  }, [scrollContainerRef]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const observers = new Map<string, ResizeObserver>();
    for (const item of items) {
      const element = itemRefs.current.get(item.key);
      if (!element) continue;
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        const nextHeight = Math.max(64, Math.ceil(entry.contentRect.height));
        if (heightCacheRef.current.get(item.key) === nextHeight) return;
        heightCacheRef.current.set(item.key, nextHeight);
        setMeasureVersion((value) => value + 1);
      });
      observer.observe(element);
      observers.set(item.key, observer);
    }
    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, [items, measureVersion]);

  const layout = useMemo(() => {
    const heights = items.map((item) => heightCacheRef.current.get(item.key) ?? estimatedItemHeight);
    const offsets: number[] = [];
    let totalHeight = 0;
    for (const height of heights) {
      offsets.push(totalHeight);
      totalHeight += height;
    }
    return { heights, offsets, totalHeight };
  }, [estimatedItemHeight, items, measureVersion]);

  const range = useMemo(() => {
    if (items.length === 0) return { start: 0, end: -1 };
    const viewportBottom = scrollTop + Math.max(1, viewportHeight);
    let start = 0;
    while (start < items.length && layout.offsets[start] + layout.heights[start] < scrollTop) {
      start += 1;
    }
    let end = start;
    while (end < items.length && layout.offsets[end] < viewportBottom) {
      end += 1;
    }
    return {
      start: Math.max(0, start - overscan),
      end: Math.min(items.length - 1, end + overscan),
    };
  }, [items.length, layout.heights, layout.offsets, overscan, scrollTop, viewportHeight]);

  const visibleItems = useMemo(() => {
    if (range.end < range.start) return [];
    return items.slice(range.start, range.end + 1).map((item, relativeIndex) => {
      const index = range.start + relativeIndex;
      return {
        ...item,
        top: layout.offsets[index] ?? 0,
      };
    });
  }, [items, layout.offsets, range.end, range.start]);

  return (
    <div ref={rootRef} className={cn('min-h-0', className)}>
      <div style={{ position: 'relative', height: layout.totalHeight }}>
        {visibleItems.map((item) => (
          <div
            key={item.key}
            ref={(node) => {
              itemRefs.current.set(item.key, node);
            }}
            style={{ position: 'absolute', top: item.top, left: 0, right: 0 }}
          >
            {item.node}
          </div>
        ))}
      </div>
    </div>
  );
}
