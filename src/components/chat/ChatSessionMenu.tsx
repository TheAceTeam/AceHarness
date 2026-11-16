'use client';

import { GitFork, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/core/utils';

export interface ChatSessionMenuProps {
  disabled?: boolean;
  compact?: boolean;
  workflowCreationGuide?: { enabled: boolean; onChange: (enabled: boolean) => void };
  forkDisabled?: boolean;
  onFork: () => void;
}

export function ChatSessionMenu({
  disabled = false,
  compact = false,
  workflowCreationGuide,
  forkDisabled = false,
  onFork,
}: ChatSessionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant={compact ? 'ghost' : 'outline'}
          disabled={disabled}
          title="会话菜单"
          aria-label="会话菜单"
          className={cn(compact && 'h-8 w-8 shrink-0 rounded-md p-0 text-muted-foreground hover:text-foreground')}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {workflowCreationGuide && (
          <>
            <DropdownMenuCheckboxItem
              checked={workflowCreationGuide.enabled}
              onCheckedChange={workflowCreationGuide.onChange}
              onSelect={(event) => event.preventDefault()}
            >
              工作流创建引导
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={onFork} disabled={forkDisabled}>
          <GitFork className="mr-2 h-4 w-4" aria-hidden="true" />
          Fork 对话
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
