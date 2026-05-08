'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface MessageHistoryCollapseProps {
  hiddenCount: number;
  recentCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hiddenContent: React.ReactNode;
  recentContent: React.ReactNode;
  className?: string;
}

export function MessageHistoryCollapse({
  hiddenCount,
  recentCount,
  open,
  onOpenChange,
  hiddenContent,
  recentContent,
  className,
}: MessageHistoryCollapseProps) {
  if (hiddenCount <= 0) {
    return <div className={className}>{recentContent}</div>;
  }

  return (
    <div className={cn('space-y-4', className)}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="rounded-2xl border border-border/70 bg-muted/25 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">较早消息</div>
              <div className="text-xs text-muted-foreground">
                已折叠 {hiddenCount} 条历史消息，最近 {recentCount} 条保持展开。
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{hiddenCount} 条历史</Badge>
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 rounded-full px-3 text-xs">
                  {open ? '收起历史' : '展开历史'}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
          <CollapsibleContent className="border-t border-border/60 px-3 py-3">
            <div className="space-y-3">{hiddenContent}</div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      <div className="space-y-3">{recentContent}</div>
    </div>
  );
}
