'use client';

import { useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { copyText } from '@/lib/core/clipboard';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// --- Schema Types ---

export interface CardSchema {
  header?: {
    icon?: string;
    title: string;
    subtitle?: string;
    gradient?: string;
    badges?: BadgeDef[];
  };
  blocks: Block[];
  actions?: ActionDef[];
}

interface BadgeDef {
  text: string;
  color?: string;
}

interface ActionDef {
  label: string;
  prompt: string;
  icon?: string;
}

type Block =
  | { type: 'info'; rows: { label: string; value: string; icon?: string }[] }
  | { type: 'badges'; items: BadgeDef[] }
  | { type: 'text'; content: string; maxLines?: number }
  | { type: 'code'; code: string; lang?: string; copyable?: boolean }
  | { type: 'progress'; value: number; max?: number; label?: string }
  | { type: 'bar-chart'; items: { label: string; value: number; displayValue?: string; color?: string; hint?: string; voters?: { name: string; avatarSrc?: string; weightLabel?: string }[] }[]; max?: number }
  | { type: 'steps'; current: number; total: number }
  | { type: 'tabs'; tabs: { key: string; label: string; blocks: Block[] }[] }
  | { type: 'collapse'; title: string; icon?: string; subtitle?: string; blocks: Block[]; defaultOpen?: boolean }
  | {
      type: 'table';
      columns: { key: string; label: string; width?: string; align?: 'left' | 'center' | 'right' }[];
      rows: {
        id: string;
        cells: Record<string, string>;
        badges?: BadgeDef[];
        detailTitle?: string;
        detailBlocks?: Block[];
      }[];
      maxHeight?: number;
      emptyText?: string;
    }
  | { type: 'list'; items: { icon?: string; color?: string; text: string }[] }
  | { type: 'status'; state: string; color?: string; animated?: boolean; rows?: { label: string; value: string }[] }
  | { type: 'actions'; items: ActionDef[] }
  | { type: 'divider' };

// --- Color helpers ---

const COLOR_PRESETS: Record<string, string> = {
  blue: 'bg-blue-500/10 text-blue-400',
  green: 'bg-green-500/10 text-green-400',
  red: 'bg-red-500/10 text-red-400',
  yellow: 'bg-yellow-500/10 text-yellow-400',
  purple: 'bg-purple-500/10 text-purple-400',
  orange: 'bg-orange-500/10 text-orange-400',
  gray: 'bg-gray-500/10 text-gray-400',
  cyan: 'bg-cyan-500/10 text-cyan-400',
  pink: 'bg-pink-500/10 text-pink-400',
};

function badgeClass(color?: string): string {
  if (!color) return 'bg-muted text-muted-foreground';
  return COLOR_PRESETS[color] || color;
}

const STATUS_COLORS: Record<string, string> = {
  green: 'bg-green-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-500',
  blue: 'bg-blue-500',
  orange: 'bg-orange-500',
  purple: 'bg-purple-500',
  gray: 'bg-gray-500',
};

// --- Main Component ---

interface UniversalCardProps {
  card: CardSchema;
  onAction?: (prompt: string) => void;
}

export default function UniversalCard({ card, onAction }: UniversalCardProps) {
  const blocks = card.blocks || [];
  return (
    <div
      data-testid="universal-card"
      className="mt-2 overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300"
    >
      {card.header && <CardHeader header={card.header} />}
      {blocks.length > 0 && (
        <div className="space-y-4 p-4">
          {blocks.map((block, i) => (
            <BlockRenderer key={i} block={block} onAction={onAction} />
          ))}
        </div>
      )}
      {card.actions && card.actions.length > 0 && (
        <div className="border-t border-border/70 px-4 py-3">
          <CardActions actions={card.actions} onAction={onAction} />
        </div>
      )}
    </div>
  );
}

// --- Header ---

function CardHeader({ header }: { header: NonNullable<CardSchema['header']> }) {
  const gradient = header.gradient || 'from-blue-500 to-cyan-500';
  return (
    <div
      data-testid="universal-card-header"
      className={`bg-gradient-to-r ${gradient} px-4 py-4`}
      style={{ opacity: 0.88 }}
    >
      <div className="flex items-start gap-3">
        {header.icon && (
          <span className="material-symbols-outlined mt-0.5 text-xl text-foreground/85">{header.icon}</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="text-base font-semibold leading-6 text-foreground">{header.title}</span>
            {header.badges?.length ? (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {header.badges.map((b, i) => (
                  <span key={i} className={`rounded-md px-2 py-1 text-xs font-medium ${badgeClass(b.color)}`}>
                    {b.text}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {header.subtitle && (
            <div className="mt-1.5 text-sm leading-6 text-foreground/72 break-all">{header.subtitle}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Block Renderer ---

function BlockRenderer({ block, onAction }: { block: Block; onAction?: (prompt: string) => void }) {
  switch (block.type) {
    case 'info': return <InfoBlock rows={block.rows} />;
    case 'badges': return <BadgesBlock items={block.items} />;
    case 'text': return <TextBlock content={block.content} maxLines={block.maxLines} />;
    case 'code': return <CodeBlock code={block.code} lang={block.lang} copyable={block.copyable} />;
    case 'progress': return <ProgressBlock value={block.value} max={block.max} label={block.label} />;
    case 'bar-chart': return <BarChartBlock items={block.items} max={block.max} />;
    case 'steps': return <StepsBlock current={block.current} total={block.total} />;
    case 'tabs': return <TabsBlock tabs={block.tabs} onAction={onAction} />;
    case 'collapse': return <CollapseBlock title={block.title} icon={block.icon} subtitle={block.subtitle} blocks={block.blocks} defaultOpen={block.defaultOpen} onAction={onAction} />;
    case 'table': return <TableBlock columns={block.columns} rows={block.rows} maxHeight={block.maxHeight} emptyText={block.emptyText} onAction={onAction} />;
    case 'list': return <ListBlock items={block.items} />;
    case 'status': return <StatusBlock state={block.state} color={block.color} animated={block.animated} rows={block.rows} />;
    case 'actions': return <CardActions actions={block.items} onAction={onAction} />;
    case 'divider': return <div className="border-t border-dashed border-border/50" />;
    default: return null;
  }
}

// --- Block Components ---

function InfoBlock({ rows }: { rows?: { label: string; value: string; icon?: string }[] }) {
  if (!rows?.length) return null;
  return (
    <div data-testid="universal-card-info" className="space-y-3">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)] gap-1 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start sm:gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground/90">
            {row.icon && <span className="material-symbols-outlined text-sm">{row.icon}</span>}
            <span>{row.label}</span>
          </div>
          <div className="text-sm leading-6 text-foreground break-all">{row.value}</div>
        </div>
      ))}
    </div>
  );
}

function BadgesBlock({ items }: { items?: BadgeDef[] }) {
  if (!items?.length) return null;
  return (
    <div data-testid="universal-card-badges" className="flex flex-wrap gap-2">
      {items.map((b, i) => (
        <span key={i} className={`rounded-md px-2.5 py-1 text-xs font-medium ${badgeClass(b.color)}`}>
          {b.text}
        </span>
      ))}
    </div>
  );
}

function TextBlock({ content, maxLines }: { content: string; maxLines?: number }) {
  const style = maxLines ? { WebkitLineClamp: maxLines, display: '-webkit-box', WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' } : {};
  return (
    <div data-testid="universal-card-text" className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground" style={style}>
      {content}
    </div>
  );
}

function CodeBlock({ code, lang, copyable }: { code: string; lang?: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const ok = await copyText(code);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div data-testid="universal-card-code" className="relative">
      <pre className="max-h-60 overflow-x-auto overflow-y-auto rounded-lg border border-border/70 bg-background px-3 py-3 text-[13px] leading-6">
        <code>{code}</code>
      </pre>
      {copyable !== false && (
        <button
          onClick={handleCopy}
          className="absolute top-1.5 right-1.5 text-xs text-muted-foreground hover:text-foreground p-1 rounded bg-background/80"
        >
          <span className="material-symbols-outlined text-xs">{copied ? 'check' : 'content_copy'}</span>
        </button>
      )}
    </div>
  );
}

function ProgressBlock({ value, max = 100, label }: { value: number; max?: number; label?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div data-testid="universal-card-progress" className="space-y-2">
      {label && <div className="text-sm font-medium text-muted-foreground">{label}</div>}
      <Progress value={pct} className="h-2 [&>[data-slot=progress-indicator]]:bg-gradient-to-r [&>[data-slot=progress-indicator]]:from-blue-500 [&>[data-slot=progress-indicator]]:to-cyan-500" />
    </div>
  );
}

const BAR_CHART_COLORS: Record<string, string> = {
  blue: 'bg-sky-500',
  cyan: 'bg-cyan-500',
  emerald: 'bg-emerald-500',
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  lime: 'bg-lime-500',
  orange: 'bg-orange-500',
  pink: 'bg-pink-500',
};

function BarChartBlock({
  items,
  max,
}: {
  items: { label: string; value: number; displayValue?: string; color?: string; hint?: string; voters?: { name: string; avatarSrc?: string; weightLabel?: string }[] }[];
  max?: number;
}) {
  if (!items?.length) return null;
  const resolvedMax = Math.max(1, max || Math.max(...items.map((item) => item.value)));
  return (
    <div data-testid="universal-card-bar-chart" className="space-y-3">
      {items.map((item, index) => {
        const pct = Math.max(4, Math.min(100, (item.value / resolvedMax) * 100));
        const barClass = BAR_CHART_COLORS[item.color || 'blue'] || BAR_CHART_COLORS.blue;
        return (
          <div key={`${item.label}-${index}`} className="space-y-1.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-medium text-foreground">{item.label}</span>
              <span className="shrink-0 text-muted-foreground">{item.displayValue || item.value}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted/70">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {item.voters?.length ? (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {item.voters.map((voter, voterIndex) => (
                  <div
                    key={`${item.label}-${voter.name}-${voterIndex}`}
                    className="group relative"
                    title={voter.weightLabel ? `${voter.name}（${voter.weightLabel}）` : voter.name}
                  >
                    <Avatar className="h-6 w-6 border border-border/70 shadow-sm">
                      {voter.avatarSrc ? <AvatarImage src={voter.avatarSrc} alt={voter.name} /> : null}
                      <AvatarFallback className="bg-muted text-[10px] font-medium text-foreground">
                        {voter.name.slice(0, 1)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-[10px] text-popover-foreground shadow-md group-hover:block">
                      {voter.name}{voter.weightLabel ? `（${voter.weightLabel}）` : ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {item.hint ? (
              <div className="text-xs leading-5 text-muted-foreground">{item.hint}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function StepsBlock({ current, total }: { current: number; total: number }) {
  return (
    <div data-testid="universal-card-steps" className="space-y-2">
      <div className="text-sm font-medium text-muted-foreground">步骤 {current}/{total}</div>
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < current ? 'bg-blue-500' : 'bg-muted'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function TabsBlock({ tabs, onAction }: { tabs: { key: string; label: string; blocks: Block[] }[]; onAction?: (prompt: string) => void }) {
  const [active, setActive] = useState(tabs[0]?.key || '');
  const activeTab = tabs.find(t => t.key === active) || tabs[0];
  return (
    <div data-testid="universal-card-tabs">
      <div className="mb-3 flex gap-1 border-b border-border/70">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              tab.key === active
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab && (
        <div className="space-y-3">
          {activeTab.blocks.map((block, i) => (
            <BlockRenderer key={i} block={block} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function CollapseBlock({ title, icon, subtitle, blocks, defaultOpen, onAction }: {
  title: string; icon?: string; subtitle?: string; blocks: Block[]; defaultOpen?: boolean; onAction?: (prompt: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div data-testid="universal-card-collapse" className="overflow-hidden rounded-lg border border-border/70 bg-muted/10">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-3 text-sm transition-colors hover:bg-muted/50"
      >
        <span className="material-symbols-outlined text-sm text-muted-foreground transition-transform" style={{ transform: open ? 'rotate(90deg)' : '' }}>
          chevron_right
        </span>
        {icon && <span className="material-symbols-outlined text-sm text-muted-foreground">{icon}</span>}
        <span className="flex-1 text-left font-medium leading-6">{title}</span>
        {subtitle && <span className="max-w-[45%] truncate text-xs text-muted-foreground">{subtitle}</span>}
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/60 px-3 pb-3 pt-3">
          {blocks.map((block, i) => (
            <BlockRenderer key={i} block={block} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function TableBlock({
  columns,
  rows,
  maxHeight = 360,
  emptyText = '暂无数据',
  onAction,
}: {
  columns: { key: string; label: string; width?: string; align?: 'left' | 'center' | 'right' }[];
  rows: { id: string; cells: Record<string, string>; badges?: BadgeDef[]; detailTitle?: string; detailBlocks?: Block[] }[];
  maxHeight?: number;
  emptyText?: string;
  onAction?: (prompt: string) => void;
}) {
  const [selectedRowId, setSelectedRowId] = useState(rows[0]?.id || '');
  const selectedRow = rows.find((row) => row.id === selectedRowId) || rows[0];

  if (!rows.length) {
    return (
      <div data-testid="universal-card-table" className="rounded-lg border border-border/70 bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div data-testid="universal-card-table" className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/10">
        <div
          className="overflow-y-auto"
          style={{ maxHeight }}
        >
          <Table className="w-full table-fixed">
            <colgroup>
              {columns.map((column) => (
                <col key={column.key} style={{ width: column.width || undefined }} />
              ))}
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
              <TableRow className="hover:bg-transparent">
                {columns.map((column) => (
                  <TableHead
                    key={column.key}
                    className={`h-10 bg-muted/70 px-3 text-[11px] uppercase tracking-wide ${
                      column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'
                    }`}
                  >
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const selected = row.id === selectedRow?.id;
                return (
                  <TableRow
                    key={row.id}
                    data-state={selected ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => setSelectedRowId(row.id)}
                  >
                    {columns.map((column) => (
                      <TableCell
                        key={`${row.id}-${column.key}`}
                        className={`px-3 py-2 ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'}`}
                        title={row.cells[column.key] || ''}
                      >
                        <div className="truncate">{row.cells[column.key] || '—'}</div>
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {selectedRow ? (
        <div className="rounded-lg border border-border/70 bg-background/70 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">{selectedRow.detailTitle || selectedRow.cells[columns[0]?.key] || '详情'}</div>
              {selectedRow.badges?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedRow.badges.map((badge, index) => (
                    <span key={`${selectedRow.id}-badge-${index}`} className={`rounded-md px-2.5 py-1 text-xs font-medium ${badgeClass(badge.color)}`}>
                      {badge.text}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {selectedRow.detailBlocks?.length ? (
            <div className="mt-3 space-y-3">
              {selectedRow.detailBlocks.map((block, index) => (
                <BlockRenderer key={`${selectedRow.id}-detail-${index}`} block={block} onAction={onAction} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ListBlock({ items }: { items?: { icon?: string; color?: string; text: string }[] }) {
  if (!items?.length) return null;
  return (
    <div data-testid="universal-card-list" className="space-y-2.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg px-1 py-0.5 text-sm leading-6">
          {item.icon && (
            <span className={`material-symbols-outlined mt-0.5 shrink-0 text-base ${item.color || 'text-muted-foreground'}`}>
              {item.icon}
            </span>
          )}
          <span className="text-foreground/88">{item.text}</span>
        </div>
      ))}
    </div>
  );
}

function StatusBlock({ state, color, animated, rows }: {
  state: string; color?: string; animated?: boolean; rows?: { label: string; value: string }[];
}) {
  const dotColor = STATUS_COLORS[color || 'gray'] || 'bg-gray-500';
  return (
    <div data-testid="universal-card-status" className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${dotColor} ${animated ? 'animate-pulse' : ''}`} />
        <span className="text-sm font-medium">{state}</span>
      </div>
      {rows && rows.length > 0 && (
        <div className="space-y-2 pl-4">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3 text-sm">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="break-all leading-6">{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CardActions({ actions, onAction }: { actions: ActionDef[]; onAction?: (prompt: string) => void }) {
  if (!onAction || actions.length === 0) return null;
  return (
    <div data-testid="universal-card-actions" className="flex flex-wrap gap-2">
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={() => onAction(a.prompt)}
          className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          {a.icon && <span className="material-symbols-outlined text-sm">{a.icon}</span>}
          {a.label}
        </button>
      ))}
    </div>
  );
}
