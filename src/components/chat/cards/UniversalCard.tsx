'use client';

import { useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { copyText } from '@/lib/clipboard';

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
  | { type: 'bar-chart'; items: { label: string; value: number; displayValue?: string; color?: string; hint?: string }[]; max?: number }
  | { type: 'steps'; current: number; total: number }
  | { type: 'tabs'; tabs: { key: string; label: string; blocks: Block[] }[] }
  | { type: 'collapse'; title: string; icon?: string; subtitle?: string; blocks: Block[]; defaultOpen?: boolean }
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
    <div className="mt-2 rounded-lg border bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
      {card.header && <CardHeader header={card.header} />}
      {blocks.length > 0 && (
        <div className="p-3 space-y-3">
          {blocks.map((block, i) => (
            <BlockRenderer key={i} block={block} onAction={onAction} />
          ))}
        </div>
      )}
      {card.actions && card.actions.length > 0 && (
        <div className="border-t px-3 py-2">
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
    <div className={`p-3 bg-gradient-to-r ${gradient} bg-opacity-10`} style={{ background: `linear-gradient(to right, var(--tw-gradient-stops))` }}>
      <div className="flex items-center gap-2">
        {header.icon && (
          <span className="material-symbols-outlined text-base text-white/90">{header.icon}</span>
        )}
        <span className="text-sm font-medium text-white/95 flex-1 truncate">{header.title}</span>
        {header.badges?.map((b, i) => (
          <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeClass(b.color)}`}>
            {b.text}
          </span>
        ))}
      </div>
      {header.subtitle && (
        <div className="text-xs text-white/70 mt-0.5 truncate">{header.subtitle}</div>
      )}
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
    <div className="space-y-1">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          {row.icon && <span className="material-symbols-outlined text-xs text-muted-foreground">{row.icon}</span>}
          <span className="text-muted-foreground min-w-[60px]">{row.label}</span>
          <span className="truncate">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function BadgesBlock({ items }: { items?: BadgeDef[] }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((b, i) => (
        <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badgeClass(b.color)}`}>
          {b.text}
        </span>
      ))}
    </div>
  );
}

function TextBlock({ content, maxLines }: { content: string; maxLines?: number }) {
  const style = maxLines ? { WebkitLineClamp: maxLines, display: '-webkit-box', WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' } : {};
  return (
    <div className="text-xs text-muted-foreground whitespace-pre-wrap" style={style}>
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
    <div className="relative">
      <pre className="p-2 rounded border bg-background text-xs overflow-x-auto max-h-60 overflow-y-auto">
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
    <div className="space-y-1">
      {label && <div className="text-xs text-muted-foreground">{label}</div>}
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
  items: { label: string; value: number; displayValue?: string; color?: string; hint?: string }[];
  max?: number;
}) {
  if (!items?.length) return null;
  const resolvedMax = Math.max(1, max || Math.max(...items.map((item) => item.value)));
  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const pct = Math.max(4, Math.min(100, (item.value / resolvedMax) * 100));
        const barClass = BAR_CHART_COLORS[item.color || 'blue'] || BAR_CHART_COLORS.blue;
        return (
          <div key={`${item.label}-${index}`} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-foreground">{item.label}</span>
              <span className="shrink-0 text-muted-foreground">{item.displayValue || item.value}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted/70">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {item.hint ? (
              <div className="text-[11px] text-muted-foreground">{item.hint}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function StepsBlock({ current, total }: { current: number; total: number }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">步骤 {current}/{total}</div>
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
    <div>
      <div className="flex gap-1 border-b mb-2">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={`text-xs px-2.5 py-1.5 border-b-2 transition-colors ${
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
    <div className="border rounded">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs hover:bg-muted/50 transition-colors"
      >
        <span className="material-symbols-outlined text-xs text-muted-foreground transition-transform" style={{ transform: open ? 'rotate(90deg)' : '' }}>
          chevron_right
        </span>
        {icon && <span className="material-symbols-outlined text-xs text-muted-foreground">{icon}</span>}
        <span className="font-medium flex-1 text-left truncate">{title}</span>
        {subtitle && <span className="text-muted-foreground">{subtitle}</span>}
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-3 border-t pt-2">
          {blocks.map((block, i) => (
            <BlockRenderer key={i} block={block} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function ListBlock({ items }: { items?: { icon?: string; color?: string; text: string }[] }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          {item.icon && (
            <span className={`material-symbols-outlined text-sm shrink-0 ${item.color || 'text-muted-foreground'}`}>
              {item.icon}
            </span>
          )}
          <span className="text-muted-foreground">{item.text}</span>
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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${dotColor} ${animated ? 'animate-pulse' : ''}`} />
        <span className="text-xs font-medium">{state}</span>
      </div>
      {rows && rows.length > 0 && (
        <div className="space-y-1 pl-4">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground min-w-[60px]">{row.label}</span>
              <span>{row.value}</span>
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
    <div className="flex flex-wrap gap-1.5">
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={() => onAction(a.prompt)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
        >
          {a.icon && <span className="material-symbols-outlined text-xs">{a.icon}</span>}
          {a.label}
        </button>
      ))}
    </div>
  );
}
