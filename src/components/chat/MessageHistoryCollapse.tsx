'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkpoint, CheckpointIcon, CheckpointTrigger } from '@/components/ai-elements/checkpoint';
import { cn } from '@/lib/core/utils';
import { HistoryIcon } from 'lucide-react';

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
    return <div className={cn('min-h-0', className)}>{recentContent}</div>;
  }

  return (
    <div className={cn('space-y-4', className)}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <Checkpoint className="flex-col items-stretch gap-0 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <CheckpointIcon>
                <HistoryIcon className="size-4 shrink-0" />
              </CheckpointIcon>
              <div className="min-w-0">
                <span className="font-medium text-foreground">较早消息</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  已折叠 {hiddenCount} 条历史消息，最近 {recentCount} 条保持展开。
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{hiddenCount} 条历史</Badge>
              <CollapsibleTrigger asChild>
                <CheckpointTrigger
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full px-3 text-xs"
                >
                  {open ? '收起历史' : '展开历史'}
                </CheckpointTrigger>
              </CollapsibleTrigger>
            </div>
          </div>
          <CollapsibleContent className="border-t border-border/60 px-1 py-3">
            <div className="min-h-0">{hiddenContent}</div>
          </CollapsibleContent>
        </Checkpoint>

        <div className="min-h-0">{recentContent}</div>
      </Collapsible>
    </div>
  );
}
