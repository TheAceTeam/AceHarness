'use client';

import { Button } from '@/components/ui/button';
import {
  ModelSelector,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector';
import { DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Command } from '@/components/ui/command';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/core/utils';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';

export interface AiModelSelectorOption {
  value: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  keywords?: string[];
  disabled?: boolean;
}

export interface AiModelSelectorGroup {
  label: string;
  icon?: ReactNode;
  items: AiModelSelectorOption[];
}

interface AiModelSelectorFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  values?: string[];
  onValuesChange?: (values: string[]) => void;
  groups?: AiModelSelectorGroup[];
  options?: AiModelSelectorOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  triggerLabel?: string;
  triggerIcon?: ReactNode;
  forceSidebar?: boolean;
}

export function AiModelSelectorField({
  value,
  onValueChange,
  values,
  onValuesChange,
  groups,
  options,
  placeholder = 'Select option',
  searchPlaceholder = 'Search...',
  emptyLabel = 'No results.',
  disabled = false,
  className = '',
  triggerLabel,
  triggerIcon,
  forceSidebar = false,
}: AiModelSelectorFieldProps) {
  const [open, setOpen] = useState(false);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [hoveredGroupIndex, setHoveredGroupIndex] = useState<number | null>(null);
  const groupElMap = useRef(new Map<number, HTMLDivElement>());
  const listWrapperRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);

  const normalizedGroups = useMemo(() => {
    if (groups?.length) return groups;
    if (options?.length) return [{ label: 'Options', items: options }];
    return [];
  }, [groups, options]);

  const selectedOption = useMemo(
    () => normalizedGroups.flatMap((group) => group.items).find((item) => item.value === value),
    [normalizedGroups, value],
  );
  const selectedValues = useMemo(() => new Set(values || []), [values]);
  const isMulti = Boolean(onValuesChange);
  const selectedOptions = useMemo(
    () => normalizedGroups.flatMap((group) => group.items).filter((item) => selectedValues.has(item.value)),
    [normalizedGroups, selectedValues],
  );

  const resolvedLabel = triggerLabel
    || (isMulti
      ? selectedOptions.length > 0
        ? selectedOptions.length <= 2
          ? selectedOptions.map((item) => item.label).join('、')
          : `已选择 ${selectedOptions.length} 项`
        : placeholder
      : selectedOption?.label || placeholder);
  const resolvedIcon = triggerIcon ?? (isMulti ? selectedOptions[0]?.icon : selectedOption?.icon) ?? null;
  const showSidebar = forceSidebar ? normalizedGroups.length > 1 : normalizedGroups.length > 2;

  const scrollToGroup = useCallback((index: number) => {
    const el = groupElMap.current.get(index);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveGroupIndex(index);
      setHoveredGroupIndex(null);
    }
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setHoveredGroupIndex(null);
  }, []);

  const syncActiveGroupFromScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const listEl = listRef.current;
      if (!listEl) return;
      const listTop = listEl.getBoundingClientRect().top;
      let nextIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      groupElMap.current.forEach((el, index) => {
        const distance = Math.abs(el.getBoundingClientRect().top - listTop);
        if (distance < bestDistance) {
          bestDistance = distance;
          nextIndex = index;
        }
      });
      setActiveGroupIndex((current) => (current === nextIndex ? current : nextIndex));
    });
  }, []);

  const handleListWrapperRef = useCallback((node: HTMLDivElement | null) => {
    if (listRef.current) {
      listRef.current.removeEventListener('scroll', syncActiveGroupFromScroll);
      listRef.current = null;
    }
    listWrapperRef.current = node;
    if (!node) return;
    const listEl = node.querySelector<HTMLElement>('[cmdk-list]');
    if (!listEl) return;
    listRef.current = listEl as HTMLDivElement;
    listEl.addEventListener('scroll', syncActiveGroupFromScroll, { passive: true });
  }, [syncActiveGroupFromScroll]);

  const triggerButton = (
    <Button
      type="button"
      variant="outline"
      className={cn(
        'w-full justify-between gap-2 px-3 text-left font-normal',
        !selectedOption && !triggerLabel ? 'text-muted-foreground' : '',
        className,
      )}
      disabled={disabled}
    >
      <span className="flex min-w-0 items-center gap-2">
        {resolvedIcon ? <span className="shrink-0">{resolvedIcon}</span> : null}
        <span className="truncate">{resolvedLabel}</span>
      </span>
      <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Button>
  );

  const renderGroupItems = (group: AiModelSelectorGroup) =>
    group.items.map((item) => (
      <ModelSelectorItem
        key={`${group.label}-${item.value}`}
        value={[item.label, item.value, ...(item.keywords || [])].join(' ')}
        onSelect={() => {
          if (item.disabled) return;
          if (isMulti && onValuesChange) {
            const next = new Set(selectedValues);
            if (next.has(item.value)) next.delete(item.value);
            else next.add(item.value);
            onValuesChange(Array.from(next));
            return;
          }
          onValueChange(item.value);
          setOpen(false);
        }}
        disabled={item.disabled}
        className="flex items-center gap-2"
      >
        {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ModelSelectorName>{item.label}</ModelSelectorName>
          {item.description ? (
            <span className="hidden truncate text-xs text-muted-foreground md:inline">
              {item.description}
            </span>
          ) : null}
        </div>
        {(isMulti ? selectedValues.has(item.value) : item.value === value) ? <CheckIcon className="h-4 w-4 shrink-0" /> : null}
      </ModelSelectorItem>
    ));

  if (showSidebar) {
    return (
      <ModelSelector open={open} onOpenChange={handleOpenChange}>
        <ModelSelectorTrigger asChild>{triggerButton}</ModelSelectorTrigger>
        <DialogContent
          aria-describedby={undefined}
          className="outline! border-none! p-0 outline-border! outline-solid! sm:max-w-[680px]"
        >
          <DialogTitle className="sr-only">{placeholder}</DialogTitle>
          <div className="flex" style={{ maxHeight: 'min(420px, 80vh)' }}>
            <nav className="flex w-36 shrink-0 flex-col border-r">
              <div className="shrink-0 px-2.5 pb-1 pt-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">引擎</div>
              <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 space-y-0.5">
                <TooltipProvider delayDuration={300}>
                  {normalizedGroups.map((group, i) => (
                    <Tooltip key={group.label} open={hoveredGroupIndex === i}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-left rounded-sm transition-colors hover:bg-accent',
                            activeGroupIndex === i && 'bg-accent font-medium',
                          )}
                          onPointerEnter={() => setHoveredGroupIndex(i)}
                          onPointerLeave={() => setHoveredGroupIndex((current) => (current === i ? null : current))}
                          onBlur={() => setHoveredGroupIndex((current) => (current === i ? null : current))}
                          onClick={() => scrollToGroup(i)}
                        >
                          {group.icon || group.items[0]?.icon ? (
                            <span className="shrink-0">{group.icon || group.items[0]?.icon}</span>
                          ) : null}
                          <span className="truncate">{group.label}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="text-xs">
                        {group.label}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </TooltipProvider>
              </div>
            </nav>
            <Command className="flex-1 min-w-0 **:data-[slot=command-input-wrapper]:h-auto">
              <ModelSelectorInput placeholder={searchPlaceholder} />
              <div ref={handleListWrapperRef} className="min-h-0 flex-1">
                <ModelSelectorList className="max-h-none h-full">
                  <ModelSelectorEmpty>{emptyLabel}</ModelSelectorEmpty>
                  {normalizedGroups.map((group, i) => (
                    <div
                      key={group.label}
                      ref={(el) => {
                        if (el) groupElMap.current.set(i, el);
                        else groupElMap.current.delete(i);
                      }}
                    >
                      <ModelSelectorGroup heading={group.label}>
                        {renderGroupItems(group)}
                      </ModelSelectorGroup>
                    </div>
                  ))}
                </ModelSelectorList>
              </div>
            </Command>
          </div>
        </DialogContent>
      </ModelSelector>
    );
  }

  return (
    <ModelSelector open={open} onOpenChange={handleOpenChange}>
      <ModelSelectorTrigger asChild>{triggerButton}</ModelSelectorTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="outline! border-none! p-0 outline-border! outline-solid! sm:max-w-[560px]"
      >
        <DialogTitle className="sr-only">{placeholder}</DialogTitle>
        <Command className="**:data-[slot=command-input-wrapper]:h-auto">
          <ModelSelectorInput placeholder={searchPlaceholder} />
          <ModelSelectorList>
            <ModelSelectorEmpty>{emptyLabel}</ModelSelectorEmpty>
            {normalizedGroups.map((group) => (
              <ModelSelectorGroup key={group.label} heading={group.label}>
                {renderGroupItems(group)}
              </ModelSelectorGroup>
            ))}
          </ModelSelectorList>
        </Command>
      </DialogContent>
    </ModelSelector>
  );
}
