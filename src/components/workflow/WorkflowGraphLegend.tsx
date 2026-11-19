import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/core/utils';

export function WorkflowGraphLegend({ className, children }: { className?: string; children: ReactNode }) {
  const id = useId();
  const [expanded, setExpanded] = useState(true);
  return (
    <div className={cn('rounded-lg border bg-background p-3 text-xs shadow-lg', className)}>
      <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-3 rounded font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        图例
        <ChevronDown aria-hidden="true" className={cn('size-3.5', expanded && 'rotate-180')} />
      </button>
      <div id={id} hidden={!expanded} className="mt-2">{children}</div>
    </div>
  );
}
