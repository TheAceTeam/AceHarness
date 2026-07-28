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
  creationAssistantEnabled: boolean;
  creationAssistantDisabled?: boolean;
  forkDisabled?: boolean;
  onCreationAssistantChange: (enabled: boolean) => void;
  onFork: () => void;
}

export function ChatSessionMenu({
  disabled = false,
  compact = false,
  creationAssistantEnabled,
  creationAssistantDisabled = false,
  forkDisabled = false,
  onCreationAssistantChange,
  onFork,
}: ChatSessionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          title="会话菜单"
          aria-label="会话菜单"
          className={cn(compact && 'h-8 rounded-md px-2.5 text-xs')}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuCheckboxItem
          checked={creationAssistantEnabled}
          disabled={creationAssistantDisabled}
          onCheckedChange={(checked) => onCreationAssistantChange(checked === true)}
          onSelect={(event) => event.preventDefault()}
        >
          新对话创建助手
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onFork} disabled={forkDisabled}>
          <GitFork className="mr-2 h-4 w-4" aria-hidden="true" />
          Fork 对话
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
