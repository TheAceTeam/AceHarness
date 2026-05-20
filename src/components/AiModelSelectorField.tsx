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
}

export interface AiModelSelectorGroup {
  label: string;
  icon?: ReactNode;
  items: AiModelSelectorOption[];
}

interface AiModelSelectorFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  groups?: AiModelSelectorGroup[];
  options?: AiModelSelectorOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  triggerLabel?: string;
  triggerIcon?: ReactNode;
}

export function AiModelSelectorField({
  value,
  onValueChange,
  groups,
  options,
  placeholder = 'Select option',
  searchPlaceholder = 'Search...',
  emptyLabel = 'No results.',
  disabled = false,
  className = '',
  triggerLabel,
  triggerIcon,
}: AiModelSelectorFieldProps) {
  const [open, setOpen] = useState(false);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const groupElMap = useRef(new Map<number, HTMLDivElement>());

  const normalizedGroups = useMemo(() => {
    if (groups?.length) return groups;
    if (options?.length) return [{ label: 'Options', items: options }];
    return [];
  }, [groups, options]);

  const selectedOption = useMemo(
    () => normalizedGroups.flatMap((group) => group.items).find((item) => item.value === value),
    [normalizedGroups, value],
  );

  const resolvedLabel = triggerLabel || selectedOption?.label || placeholder;
  const resolvedIcon = triggerIcon ?? selectedOption?.icon ?? null;
  const showSidebar = normalizedGroups.length > 2;

  const scrollToGroup = useCallback((index: number) => {
    const el = groupElMap.current.get(index);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveGroupIndex(index);
    }
  }, []);

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
          onValueChange(item.value);
          setOpen(false);
        }}
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
        {item.value === value ? <CheckIcon className="h-4 w-4 shrink-0" /> : null}
      </ModelSelectorItem>
    ));

  if (showSidebar) {
    return (
      <ModelSelector open={open} onOpenChange={setOpen}>
        <ModelSelectorTrigger asChild>{triggerButton}</ModelSelectorTrigger>
        <DialogContent
          aria-describedby={undefined}
          className="outline! border-none! p-0 outline-border! outline-solid! sm:max-w-[680px]"
        >
          <DialogTitle className="sr-only">{placeholder}</DialogTitle>
          <div className="flex" style={{ maxHeight: 'min(420px, 80vh)' }}>
            <nav className="w-28 shrink-0 border-r overflow-y-auto py-1.5 space-y-0.5">
              <div className="px-2.5 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">引擎</div>
              <TooltipProvider delayDuration={300}>
                {normalizedGroups.map((group, i) => (
                  <Tooltip key={group.label}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-left rounded-sm transition-colors hover:bg-accent',
                          activeGroupIndex === i && 'bg-accent font-medium',
                        )}
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
            </nav>
            <Command className="flex-1 min-w-0 **:data-[slot=command-input-wrapper]:h-auto">
              <ModelSelectorInput placeholder={searchPlaceholder} />
              <ModelSelectorList className="max-h-none flex-1">
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
            </Command>
          </div>
        </DialogContent>
      </ModelSelector>
    );
  }

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
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
