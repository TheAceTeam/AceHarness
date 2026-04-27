'use client';

import * as React from 'react';
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { cn } from '@/lib/utils';

// ─── Portal Container Context ────────────────────────────────────────────────
// When Combobox is used inside a Radix Dialog, the Dialog sets pointer-events:none
// on <body>, blocking Portal content. Provide a container ref via this context
// so the Portal renders inside the Dialog instead.

const ComboboxPortalContainerContext = React.createContext<React.RefObject<HTMLElement | null> | null>(null);

function ComboboxPortalProvider({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  return (
    <ComboboxPortalContainerContext.Provider value={ref}>
      {children}
      <div ref={ref} />
    </ComboboxPortalContainerContext.Provider>
  );
}

// ─── Combobox (Root) ─────────────────────────────────────────────────────────

function Combobox<V>(props: ComboboxPrimitive.Root.Props<V, any>) {
  return <ComboboxPrimitive.Root {...props} />;
}

// ─── ComboboxInput ───────────────────────────────────────────────────────────

const ComboboxInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Input> & {
    className?: string;
    leading?: React.ReactNode;
    displayValue?: React.ReactNode;
  }
>(({ className, leading, displayValue, ...props }, ref) => (
  <ComboboxPrimitive.Trigger
    className={cn(
      'relative flex h-10 w-full items-center justify-between rounded-md border border-input bg-background text-sm ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 [&:has(:disabled)]:cursor-not-allowed [&:has(:disabled)]:opacity-50',
      className,
    )}
  >
    {leading ? (
      <div className="flex shrink-0 items-center pl-3 text-muted-foreground">
        {leading}
      </div>
    ) : null}
    <ComboboxPrimitive.Input
      ref={ref}
      className={cn(
        'peer flex-1 bg-transparent py-2 text-inherit outline-none placeholder:text-muted-foreground min-w-0',
        leading ? 'pl-2' : 'px-3',
        displayValue ? 'text-transparent focus:text-foreground' : 'px-3'
      )}
      {...props}
    />
    {displayValue ? (
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 right-8 flex items-center text-inherit text-foreground peer-focus:hidden',
          leading ? 'left-8 pl-2' : 'left-0 px-3'
        )}
      >
        <span className="truncate">{displayValue}</span>
      </div>
    ) : null}
    <ComboboxPrimitive.Icon className="px-2 shrink-0 opacity-50">
      <span className="material-symbols-outlined text-base">expand_more</span>
    </ComboboxPrimitive.Icon>
  </ComboboxPrimitive.Trigger>
));
ComboboxInput.displayName = 'ComboboxInput';

// ─── ComboboxContent ─────────────────────────────────────────────────────────

function ComboboxContent({ children, className }: { children: React.ReactNode; className?: string }) {
  const containerRef = React.useContext(ComboboxPortalContainerContext);
  return (
    <ComboboxPrimitive.Portal container={containerRef ?? undefined}>
      <ComboboxPrimitive.Positioner side="bottom" align="start" sideOffset={4} className="z-[200]">
        <ComboboxPrimitive.Popup
          className={cn(
            'max-h-[300px] min-w-[var(--anchor-width)] max-w-[min(var(--available-width),400px)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
            className,
          )}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

// ─── ComboboxList ────────────────────────────────────────────────────────────

function ComboboxList({ children, className }: {
  children: React.ReactNode | ((item: any, index: number) => React.ReactNode);
  className?: string;
}) {
  return (
    <ComboboxPrimitive.List className={cn('max-h-[250px] overflow-auto overscroll-contain p-1', className)}>
      {children}
    </ComboboxPrimitive.List>
  );
}

// ─── ComboboxItem ────────────────────────────────────────────────────────────

const ComboboxItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Item> & { children: React.ReactNode }
>(({ className, children, ...props }, ref) => (
  <ComboboxPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none overflow-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <ComboboxPrimitive.ItemIndicator className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <span className="material-symbols-outlined text-sm">check</span>
    </ComboboxPrimitive.ItemIndicator>
    {children}
  </ComboboxPrimitive.Item>
));
ComboboxItem.displayName = 'ComboboxItem';

// ─── ComboboxEmpty ───────────────────────────────────────────────────────────

function ComboboxEmpty({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <ComboboxPrimitive.Empty className={cn('py-6 text-center text-sm text-muted-foreground empty:hidden empty:p-0 empty:m-0', className)}>
      {children}
    </ComboboxPrimitive.Empty>
  );
}

// ─── Group / Label / Separator / Collection ──────────────────────────────────

const ComboboxGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Group>
>(({ className, ...props }, ref) => (
  <ComboboxPrimitive.Group ref={ref} className={cn('pb-1', className)} {...props} />
));
ComboboxGroup.displayName = 'ComboboxGroup';

function ComboboxLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <ComboboxPrimitive.GroupLabel
      className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)}
    >
      {children}
    </ComboboxPrimitive.GroupLabel>
  );
}

function ComboboxSeparator({ className }: { className?: string }) {
  return <ComboboxPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-muted', className)} />;
}

function ComboboxCollection({ children }: { children: (item: any, index: number) => React.ReactNode }) {
  return <ComboboxPrimitive.Collection>{children}</ComboboxPrimitive.Collection>;
}

// ─── Multi-select: Chips ─────────────────────────────────────────────────────

function ComboboxChips({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <ComboboxPrimitive.Chips
      className={cn(
        'flex min-h-[40px] w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 [&:has(:disabled)]:cursor-not-allowed [&:has(:disabled)]:opacity-50',
        className,
      )}
    >
      {children}
    </ComboboxPrimitive.Chips>
  );
}

function ComboboxValue({ children }: {
  children: React.ReactNode | ((value: any) => React.ReactNode);
}) {
  return (
    <ComboboxPrimitive.Value>
      {children}
    </ComboboxPrimitive.Value>
  );
}

function ComboboxChip({ children, className, ...props }: {
  children: React.ReactNode;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Chip>, 'children'>) {
  return (
    <ComboboxPrimitive.Chip
      className={cn('inline-flex items-center gap-1 rounded-md border bg-muted px-1.5 py-0.5 text-xs', className)}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ChipRemove className="ml-0.5 rounded-sm opacity-70 hover:opacity-100 cursor-pointer">
        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>close</span>
      </ComboboxPrimitive.ChipRemove>
    </ComboboxPrimitive.Chip>
  );
}

function ComboboxChipsInput({ className, ...props }: React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Input>) {
  return (
    <ComboboxPrimitive.Input
      className={cn('flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-[80px]', className)}
      {...props}
    />
  );
}

// ─── High-level convenience wrappers ─────────────────────────────────────────

interface ComboboxOptionType {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface ComboboxGroupDef {
  label: string;
  icon?: React.ReactNode;
  items: ComboboxOptionType[];
}

interface SingleComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  options?: ComboboxOptionType[];
  groups?: ComboboxGroupDef[];
  placeholder?: string;
  triggerLabel?: string;
  triggerIcon?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  emptyText?: string;
  searchable?: boolean;
}

function SingleCombobox({
  value,
  onValueChange,
  options = [],
  groups,
  placeholder = '请选择...',
  triggerLabel,
  triggerIcon,
  disabled = false,
  triggerClassName,
  emptyText = '无匹配项',
}: SingleComboboxProps) {
  const allOptions = React.useMemo(() => {
    if (groups) return groups.flatMap(g => g.items);
    return options;
  }, [options, groups]);

  const selected = allOptions.find(o => o.value === value) || null;

  // items: flat array or grouped array with `items` property
  const items = React.useMemo(() => {
    if (groups) return groups;
    return allOptions;
  }, [allOptions, groups]);

  return (
    <Combobox<ComboboxOptionType>
      value={selected}
      onValueChange={(val, _details) => onValueChange((val as ComboboxOptionType | null)?.value ?? '')}
      disabled={disabled}
      items={items}
      itemToStringValue={(opt) => opt.label}
    >
      <ComboboxInput
        placeholder={triggerLabel ? '' : (selected?.label || placeholder)}
        className={triggerClassName}
        leading={triggerIcon}
        displayValue={triggerLabel || selected?.label}
      />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        {groups ? (
          <ComboboxList>
            {(group: ComboboxGroupDef) => (
              <ComboboxGroup key={group.label} items={group.items}>
                <ComboboxLabel>
                  <span className="flex items-center gap-1.5">{group.icon}{group.label}</span>
                </ComboboxLabel>
                <ComboboxCollection>
                  {(item: ComboboxOptionType) => (
                    <ComboboxItem key={item.value} value={item} disabled={item.disabled}>
                      <span className="flex items-center gap-1.5 truncate">{item.icon}{item.label}</span>
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        ) : (
          <ComboboxList>
            {(item: ComboboxOptionType) => (
              <ComboboxItem key={item.value} value={item} disabled={item.disabled}>
                {item.description ? (
                  <div className="flex flex-col min-w-0 overflow-hidden">
                    <span className="flex items-center gap-1.5 truncate">{item.icon}{item.label}</span>
                    <span className="text-xs text-muted-foreground line-clamp-1 break-all">{item.description}</span>
                  </div>
                ) : (
                  <span className="flex items-center gap-1.5 truncate">{item.icon}{item.label}</span>
                )}
              </ComboboxItem>
            )}
          </ComboboxList>
        )}
      </ComboboxContent>
    </Combobox>
  );
}

interface MultiComboboxProps {
  value: string[];
  onValueChange: (value: string[]) => void;
  options?: ComboboxOptionType[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  emptyText?: string;
  searchable?: boolean;
}

function MultiCombobox({
  value,
  onValueChange,
  options = [],
  placeholder = '请选择...',
  disabled = false,
  triggerClassName,
  emptyText = '无匹配项',
}: MultiComboboxProps) {
  const selectedItems = React.useMemo(
    () => options.filter(o => value.includes(o.value)),
    [options, value],
  );

  return (
    <Combobox<ComboboxOptionType>
      multiple
      value={selectedItems}
      onValueChange={(vals, _details) => onValueChange((vals as ComboboxOptionType[]).map(v => v.value))}
      disabled={disabled}
      items={options}
      itemToStringValue={(opt) => opt.label}
    >
      <ComboboxChips className={triggerClassName}>
        <ComboboxValue>
          {(chips: ComboboxOptionType[]) => (
            <>
              {chips.map(item => (
                <ComboboxChip key={item.value} aria-label={item.label}>
                  {item.icon}
                  {item.label}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput placeholder={chips.length === 0 ? placeholder : '搜索...'} />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(item: ComboboxOptionType) => (
            <ComboboxItem key={item.value} value={item} disabled={item.disabled}>
              <div className="flex flex-col min-w-0 overflow-hidden">
                <span className="flex items-center gap-1.5 truncate">{item.icon}{item.label}</span>
                {item.description && (
                  <span className="text-xs text-muted-foreground line-clamp-1 break-all">{item.description}</span>
                )}
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export {
  // Low-level primitives
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxSeparator,
  ComboboxCollection,
  ComboboxChips,
  ComboboxValue,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxPortalProvider,
  // High-level wrappers
  SingleCombobox,
  MultiCombobox,
  // Types
  type ComboboxOptionType as ComboboxOption,
  type ComboboxGroupDef,
  type SingleComboboxProps,
  type MultiComboboxProps,
};
