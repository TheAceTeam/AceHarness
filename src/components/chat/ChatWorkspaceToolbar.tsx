'use client';

import { ChevronsUpDown, Folder, FolderOpen, GitBranch, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChatSessionMenu, type ChatSessionMenuProps } from './ChatSessionMenu';
import styles from './ChatWorkspaceToolbar.module.css';

const workspaceTabs = [
  { value: 'chat', label: '聊天', icon: MessageSquareText },
  { value: 'workspace', label: '工作区', icon: FolderOpen },
  { value: 'changes', label: '变更', icon: GitBranch },
] as const;

const toolbarStatuses = {
  loading: { label: '加载中', tone: 'neutral' },
  generating: { label: '生成中', tone: 'accent' },
  wechat: { label: '微信已绑定', tone: 'success' },
} as const;

const messageCountFormat = new Intl.NumberFormat('zh-CN');

type ChatWorkspaceToolbarProps = {
  title: string;
  messageCount: number;
  status?: keyof typeof toolbarStatuses;
  workspacePath: string;
  automaticWorkspace?: boolean;
  onSwitchWorkspace: () => void;
  menuProps: ChatSessionMenuProps;
};

export function ChatWorkspaceToolbar({
  title,
  messageCount,
  status,
  workspacePath,
  automaticWorkspace,
  onSwitchWorkspace,
  menuProps,
}: ChatWorkspaceToolbarProps) {
  const countLabel = messageCountFormat.format(messageCount) + ' 条消息';
  const currentStatus = status ? toolbarStatuses[status] : undefined;
  const folderName = workspacePath.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || workspacePath;
  const workspaceLabel = workspacePath
    ? (automaticWorkspace ? '会话工作区' : folderName)
    : '选择工作区';

  return (
    <header aria-label="对话工具栏" className={styles.container}>
      <div className={styles.row}>
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 truncate text-sm font-semibold leading-tight text-foreground sm:text-base" title={title}>
            {title}
          </h1>
          <span className={styles.count} title={countLabel}>
            {countLabel}
          </span>
          {currentStatus ? (
            <StatusPill tone={currentStatus.tone} className={styles.status}>
              {currentStatus.label}
            </StatusPill>
          ) : null}
        </div>

        <TabsList aria-label="对话视图" className="h-8 shrink-0 gap-0.5 rounded-lg border border-border/70 bg-muted/65 p-0.5">
          {workspaceTabs.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-7 gap-1.5 text-xs font-medium group-data-[variant=default]/tabs-list:px-2 group-data-[variant=default]/tabs-list:py-0 motion-reduce:transition-none"
            >
              <Icon className={styles.tabIcon} aria-hidden="true" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex min-w-0 items-center justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-w-0 max-w-full gap-1.5 rounded-md px-2 text-xs"
            title={workspacePath ? '切换工作区 · ' + workspacePath : '切换工作区'}
            aria-label="切换工作区"
            onClick={onSwitchWorkspace}
          >
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className={styles.workspaceLabel}>{workspaceLabel}</span>
            <ChevronsUpDown className={styles.workspaceChevron} aria-hidden="true" />
          </Button>
          <ChatSessionMenu {...menuProps} compact />
        </div>
      </div>
    </header>
  );
}
