'use client';

import { useState, useRef, useEffect, useCallback, useMemo, type ClipboardEvent, type DragEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from '@/lib/navigation/client';
import { motion } from 'framer-motion';
import dynamic from '@/lib/navigation/dynamic';
import { FolderOpen, GitBranch, MessageSquareText, Settings2 } from 'lucide-react';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChatSessionMenu } from '@/components/chat/ChatSessionMenu';
import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
} from '@/components/ai-elements/prompt-input';
import {
  Attachment,
  Attachments,
  type AttachmentData,
} from '@/components/ai-elements/attachments';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { ThemeToggle } from '@/components/theme-toggle';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { agentApi, agoraApi, workspaceApi, type NotebookScope } from '@/lib/core/api';
import NotebookSaveDialog from '@/components/notebook/NotebookSaveDialog';
import { buildNotebookFromConversation, buildNotebookFromAssistantMessage, createDefaultNotebookFileName } from '@/lib/chat/notebook';
import { useToast } from '@/components/ui/toast';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSidebarPluginPreferences } from '@/hooks/useSidebarPluginPreferences';
import ChatSidebar, { readStoredSessionDirectoryOrder, type SessionDirectoryView } from '@/components/chat/ChatSidebar';
import WeChatSessionBindDialog from '@/components/chat/WeChatSessionBindDialog';
import ChatMessage from '@/components/chat/ChatMessage';
import { FilePreviewDialog } from '@/components/chat/FilePreviewDialog';
import { apiFetch } from '@/client/query/api-client';
import { RobotLogo } from '@/components/brand/RobotLogo';
import { MessageHistoryCollapse } from '@/components/chat/MessageHistoryCollapse';
import { VirtualMessageList } from '@/components/chat/VirtualMessageList';
import HomeCommandSidebar from '@/components/chat/HomeCommandSidebar';
import ConversationRightRail from '@/components/chat/ConversationRightRail';
import QuickActions, { QuickActionsBar } from '@/components/chat/QuickActions';
import NewConfigModal from '@/components/NewConfigModal';
import {
  CODESPEC_WORKFLOW_CREATOR_REQUIREMENTS,
  DEFAULT_AI_WORKFLOW_DESCRIPTION,
  DEFAULT_AI_WORKFLOW_REQUIREMENTS,
  isAiWorkflowCreatorAction,
  isCodespecWorkflowCreatorAction,
  isAiWorkflowCreatorStarterAction,
  shouldOpenAiWorkflowCreatorFromConversation,
} from '@/lib/chat/workflow-creator-entry';
import CliRunDialog, { type CliRunDialogRequest } from '@/components/chat/CliRunDialog';
import UserMenu from '@/components/UserMenu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { useDashboardDockWorkspace } from '@/components/dashboard/DashboardDockWorkspace';
import { normalizeAssistantDisplay, parseActions } from '@/lib/chat/actions';
import {
  inferHomeSidebarMode,
  inferHomeSidebarTab,
  normalizeHomeSidebarHint,
  normalizeHomeSidebarTab,
  normalizeHomeSidebarTabs,
  type HomeSidebarHint,
  type HomeSidebarMode,
  type HomeSidebarTab,
  type SessionWorkbenchState,
  type CollaborationChatroomParticipant,
  type CollaborationChatroomMode,
} from '@/lib/core/home-sidebar-state';
import { dispatchHomeAction } from '@/lib/sidebar-plugins/intent-handlers';
import SpriteAvatar from '@/components/SpriteAvatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import { getSessionDirectoryKind } from '@/lib/agent/conversations';
import { createInitialChatroomState } from '@/lib/agora/chatroom-state';
import { createPlainConversationRoomState, extractAgentMentions, useCollaborationRoom } from '@/lib/collaboration/room-core';
import { computeAdaptiveRecentWindow } from '@/lib/chat/message-window';
import { appendStreamChunk, buildFinalRawContent } from '@/lib/chat/stream-assembly';
import { buildForkSessionOptions, createForkedCollaborationWorkbenchState } from '@/lib/chat/fork-session';
import { cn } from '@/lib/core/utils';
import { fetchRuntimeCommandMetadataCompat } from '@/client/query/engines';
import { resolveWorkspaceLinkTarget } from '@/lib/workspace/link-target';
import { createSafeEventSource } from '@/lib/core/safe-event-source';
import { parseAceSseEventData, storeChatStreamSseEventAsAgentMessage, type AceStreamChunk } from '@/client/ai/messages';
import { useAgentMessageRows } from '@/client/db/collections';
import pkgJson from '../../../package.json';

// 动态导入 RichTextEditor - TipTap 是重量级库，延迟加载
import type { RichTextEditorHandle } from '@/components/ui/RichTextEditor';
const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 h-[76px] rounded-xl border border-input bg-background animate-pulse" />
  ),
});

const SIDEBAR_STORAGE_KEY = 'chat-sidebar-width';
const HOME_SIDEBAR_WIDTH_STORAGE_KEY = 'home-command-sidebar-width';
const SESSION_DIRECTORY_VIEW_STORAGE_KEY = 'aceharness:chat:session-directory-view';

const COLLABORATION_MODE_OPTIONS: Array<{ value: CollaborationChatroomMode; label: string; title: string }> = [
  { value: 'mention-driven', label: '点名', title: '点名模式：只有被 @ 的 Agent 响应' },
  { value: 'broadcast', label: '广播', title: '广播模式：群内 Agent 同轮响应' },
  { value: 'facilitated', label: '主持', title: '主持人模式：由主持人组织发言顺序' },
];

type HomepageSlashCommand = {
  id: string;
  command: string;
  displayCommand?: string;
  title: string;
  subtext: string;
  icon: string;
  aliases: string[];
  prompt?: string;
  engineTag?: string;
};

const WorkspaceEditor = dynamic(() => import('@/components/workspace/WorkspaceEditor').then(m => m.WorkspaceEditor), {
  ssr: false,
});
const GitWorkspaceDiffPanel = dynamic(() => import('@/components/workflow/GitWorkspaceDiffPanel').then(m => m.GitWorkspaceDiffPanel), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载 Git 变更...</div>,
});
const AgoraShell = dynamic(() => import('@/components/collaboration/AgoraShell').then(m => m.AgoraShell), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      正在进入群聊...
    </div>
  ),
});
const DEFAULT_WIDTH = 264;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_ASSISTANT_MENTION_NAME = '默认助手';
const genLocalMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const normalizePathForCompare = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
const clampSidebarWidth = (value: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
const sidebarPixelsToPercent = (width: number, containerWidth: number) => {
  if (!containerWidth) return 22;
  return Math.min(38, Math.max(14, (clampSidebarWidth(width) / containerWidth) * 100));
};
type WebkitFileSystemEntryLike = { name?: string; fullPath?: string; isDirectory?: boolean; isFile?: boolean };
type DataTransferItemWithEntry = DataTransferItem & { webkitGetAsEntry?: () => WebkitFileSystemEntryLike | null };
type ChatPendingAttachment = {
  name: string;
  path: string;
  size: number;
  workspace: string;
};
const DEFAULT_HOME_SIDEBAR_SIZE = 26;
const MIN_HOME_SIDEBAR_SIZE = 20;
const MAX_HOME_SIDEBAR_SIZE = 46;
const MOBILE_BREAKPOINT = 768;
const CHAT_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
const CHAT_ATTACHMENT_UPLOAD_DIR = '.aceharness/chat-attachments';
type AgentBindingTeam = 'blue' | 'red' | 'judge' | 'black-gold';
export function isChatAiBusy(input: {
  loading?: boolean;
  streamingMessageId?: string | null;
  messages?: Array<{ workflowThinking?: boolean }>;
}): boolean {
  return Boolean(
    input.loading
    || input.streamingMessageId
    || input.messages?.some((message) => message.workflowThinking)
  );
}

export function resolveWorkflowCreatorSessionId(input: {
  targetSessionId?: string | null;
  activeSessionId?: string | null;
  activeSessionIdFallback?: string | null;
}): string | null {
  return input.targetSessionId || input.activeSessionId || input.activeSessionIdFallback || null;
}

function getAgentBindingTeamLabel(team?: AgentBindingTeam) {
  switch (team) {
    case 'blue':
      return '蓝队';
    case 'red':
      return '红队';
    case 'judge':
      return '裁定席';
    case 'black-gold':
      return '指挥官';
    default:
      return 'Agent';
  }
}

function getAgentBindingBadgeClass(team?: AgentBindingTeam) {
  switch (team) {
    case 'blue':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200';
    case 'red':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200';
    case 'judge':
      return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-200';
    case 'black-gold':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200';
    default:
      return 'border-border bg-muted/50 text-muted-foreground';
  }
}

function getChatAgentInitials(name: string) {
  return name
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || name.slice(0, 2).toUpperCase();
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

function readStoredSessionDirectoryView(): SessionDirectoryView | null {
  return 'conversation';
}

function writeStoredSessionDirectoryView(view: SessionDirectoryView): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_DIRECTORY_VIEW_STORAGE_KEY, 'conversation');
  } catch {}
}

function hasInlineCommandWhitespace(value: string): boolean {
  return Array.from(value).some((char) => char.trim().length === 0);
}

function hasDroppedFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if (Array.from(dataTransfer.types || []).includes('Files')) return true;
  return Array.from(dataTransfer.items || []).some((item) => item.kind === 'file');
}

function getDroppedDirectoryEntry(dataTransfer: DataTransfer): WebkitFileSystemEntryLike | null {
  for (const item of Array.from(dataTransfer.items || [])) {
    const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.();
    if (entry?.isDirectory) return entry;
  }
  return null;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function createAgoraWorkbenchState(title = '新议题') {
  return {
    collaborationRoom: {
      topic: title,
      selectedAgents: [],
      mode: 'group-chat' as const,
      messages: [],
      rounds: [],
      agentSessions: {},
      chatroom: createInitialChatroomState({
        status: 'running',
        topic: title,
      }),
    },
  };
}

function AgoraZenMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} fill="none" aria-hidden="true">
      <path
        d="M386.7 599.7c2.2-153.5 125.9-192.9 125.9-192.9s102 43.5 120.1 141.3c0.7 5.4 9.4 83.5-60.8 130.4-68.7-40.8-60.8-182-60.8-182s-24.6 50.3-23.1 103.2c4.3 42.1 1.4 91.7 94.1 144 5.1-0.7 123.7-63.8 112.9-191.5-28.2-132.4-137.5-173.9-137.5-173.9s65.4-55.5 61.4-127.9c-5.8-103.6-101.9-137-101.9-137s70.9 55 68 137.2c-2.9 82.2-73.8 106-73.8 106s-70.9-23.8-76.7-107.3c-0.7-96.4 75.2-141.3 75.2-141.3S407 151.4 400.5 252.6c-1.5 73.4 64.4 124.3 64.4 124.3s-138.2 69.3-128.8 214.6C331 751.8 509.7 838.8 509.7 838.8s-104.9-95.1-123-239.1z"
        fill="currentColor"
      />
      <path
        d="M697.9 727.4c-131 25.8-183.1 101.2-183.1 101.2s85.4-78.1 191.8-74.7c118 4.8 156.3 66.6 156.3 66.6s-37.6 52.3-131.7 62.5c-139.4 2.8-193-27-208.4-38.4 18.7 15.1 89.1 64.7 209.8 67C886 902.6 928 817 928 817s-73.1-105.2-230.1-89.6zM282.5 882.2c-94.8-14.3-127.4-61.8-125.9-68.6 21-55 110.7-72.7 110.7-72.7S150.1 724.7 98 819.1c8.7 14.9 46.3 78.8 183.1 93 141.8 3.4 222.2-68.6 222.2-68.6s-65.9 53.7-220.8 38.7z"
        fill="currentColor"
      />
    </svg>
  );
}

const AGORA_ATLAS_URL = '/images/agora.png';
const AGORA_ATLAS_SIZE = 2048;
const AGORA_ATLAS_MARGIN = 64;
const AGORA_ATLAS_GAP = 40;
const AGORA_ATLAS_CELL = 352;

function getAgoraSpriteOffset(row: number, col: number) {
  const x = AGORA_ATLAS_MARGIN + col * (AGORA_ATLAS_CELL + AGORA_ATLAS_GAP);
  const y = AGORA_ATLAS_MARGIN + row * (AGORA_ATLAS_CELL + AGORA_ATLAS_GAP);
  return `${-x}px ${-y}px`;
}

function AgoraSprite({
  row,
  col,
  className,
  style,
  animate,
  transition,
}: {
  row: number;
  col: number;
  className?: string;
  style?: React.CSSProperties;
  animate?: React.ComponentProps<typeof motion.div>['animate'];
  transition?: React.ComponentProps<typeof motion.div>['transition'];
}) {
  return (
    <motion.div
      aria-hidden="true"
      className={cn('absolute bg-no-repeat', className)}
      style={{
        backgroundImage: `url(${AGORA_ATLAS_URL})`,
        backgroundSize: `${AGORA_ATLAS_SIZE}px ${AGORA_ATLAS_SIZE}px`,
        backgroundPosition: getAgoraSpriteOffset(row, col),
        ...style,
      }}
      animate={animate}
      transition={transition}
    />
  );
}

function AgoraForumBackdrop({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden="true">
      <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.14),transparent)] dark:bg-[linear-gradient(180deg,rgba(12,16,24,0.9),rgba(12,16,24,0.3),transparent)]" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(180deg,transparent,rgba(248,246,241,0.72))] dark:bg-[linear-gradient(180deg,transparent,rgba(8,11,17,0.86))]" />
      <div className="absolute inset-y-0 left-0 w-20 bg-[linear-gradient(90deg,rgba(248,246,241,0.56),transparent)] dark:bg-[linear-gradient(90deg,rgba(8,11,17,0.72),transparent)]" />
      <div className="absolute inset-y-0 right-0 w-20 bg-[linear-gradient(270deg,rgba(248,246,241,0.56),transparent)] dark:bg-[linear-gradient(270deg,rgba(8,11,17,0.72),transparent)]" />

      <AgoraSprite
        row={3}
        col={2}
        className="left-1/2 top-[15%] h-[240px] w-[240px] -translate-x-1/2"
        style={{ opacity: 0.14, filter: 'blur(0.2px)' }}
        animate={{ scale: [1, 1.08, 1], rotate: [0, 3, 0], opacity: [0.08, 0.18, 0.08] }}
        transition={{ duration: 9.2, repeat: Infinity, ease: 'easeInOut' }}
      />

      <AgoraSprite
        row={0}
        col={0}
        className="h-[260px] w-[260px]"
        style={{ left: '-1%', bottom: '41%', opacity: 0.22 }}
        animate={{ y: [0, -12, 0], x: [0, -6, 0], opacity: [0.14, 0.26, 0.14] }}
        transition={{ duration: 8.6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <AgoraSprite
        row={0}
        col={1}
        className="h-[294px] w-[294px]"
        style={{ left: '15%', bottom: '39%', opacity: 0.18 }}
        animate={{ y: [0, -14, 0], x: [0, 6, 0], opacity: [0.12, 0.22, 0.12] }}
        transition={{ duration: 9.8, delay: 0.6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <AgoraSprite
        row={0}
        col={2}
        className="left-1/2 h-[300px] w-[300px] -translate-x-1/2"
        style={{ bottom: '35%', opacity: 0.12 }}
        animate={{ y: [0, -10, 0], scale: [1, 1.03, 1], opacity: [0.08, 0.14, 0.08] }}
        transition={{ duration: 10.6, delay: 0.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <AgoraSprite
        row={0}
        col={3}
        className="h-[292px] w-[292px]"
        style={{ right: '14%', bottom: '38%', opacity: 0.18 }}
        animate={{ y: [0, -13, 0], x: [0, -6, 0], opacity: [0.12, 0.22, 0.12] }}
        transition={{ duration: 9.4, delay: 0.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <AgoraSprite
        row={0}
        col={4}
        className="h-[248px] w-[248px]"
        style={{ right: '-1%', bottom: '41%', opacity: 0.22 }}
        animate={{ y: [0, -11, 0], x: [0, 5, 0], opacity: [0.14, 0.26, 0.14] }}
        transition={{ duration: 9.8, delay: 0.9, repeat: Infinity, ease: 'easeInOut' }}
      />

      <AgoraSprite
        row={1}
        col={0}
        className="h-[236px] w-[236px]"
        style={{ left: '3%', bottom: '8%', opacity: 0.12 }}
        animate={{ scale: [1, 1.01, 1], opacity: [0.08, 0.15, 0.08], filter: ['blur(0px)', 'blur(0.15px)', 'blur(0px)'] }}
        transition={{ duration: 7.2, delay: 0.3, repeat: Infinity, ease: 'easeInOut' }}
      />
      <AgoraSprite
        row={1}
        col={2}
        className="left-1/2 h-[276px] w-[276px] -translate-x-1/2"
        style={{ bottom: '5%', opacity: 0.1 }}
        animate={{ scale: [1, 1.012, 1], opacity: [0.06, 0.12, 0.06], filter: ['blur(0px)', 'blur(0.18px)', 'blur(0px)'] }}
        transition={{ duration: 8.2, delay: 0.8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <AgoraSprite
        row={1}
        col={3}
        className="h-[288px] w-[288px]"
        style={{ right: '2%', bottom: '4%', opacity: 0.12 }}
        animate={{ scale: [1, 1.01, 1], opacity: [0.08, 0.15, 0.08], filter: ['blur(0px)', 'blur(0.15px)', 'blur(0px)'] }}
        transition={{ duration: 7.8, delay: 0.1, repeat: Infinity, ease: 'easeInOut' }}
      />

      <AgoraSprite
        row={4}
        col={0}
        className="h-[140px] w-[140px]"
        style={{ left: '3%', bottom: '1%', opacity: 0.14 }}
        animate={{ scale: [1, 1.012, 1], opacity: [0.08, 0.16, 0.08] }}
        transition={{ duration: 7.2, delay: 0.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <AgoraSprite
        row={4}
        col={4}
        className="h-[228px] w-[228px]"
        style={{ right: '0%', bottom: '0%', opacity: 0.13 }}
        animate={{ scale: [1, 1.012, 1], opacity: [0.08, 0.15, 0.08] }}
        transition={{ duration: 8.8, delay: 0.7, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

function AgoraForumForeground({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 z-20 overflow-visible', className)} aria-hidden="true">
      <AgoraSprite
        row={1}
        col={0}
        className="-left-6 bottom-5 h-[240px] w-[240px] sm:-left-8 sm:h-[288px] sm:w-[288px] lg:-left-12 lg:h-[332px] lg:w-[332px]"
        style={{ opacity: 0.58, filter: 'contrast(1.05) saturate(1.03) drop-shadow(0 24px 40px rgba(87,65,40,0.16))' }}
        animate={{
          scale: [1, 1.015, 1],
          opacity: [0.46, 0.62, 0.46],
          filter: [
            'contrast(1.05) saturate(1.03) drop-shadow(0 24px 40px rgba(87,65,40,0.14))',
            'contrast(1.07) saturate(1.04) drop-shadow(0 30px 46px rgba(87,65,40,0.2))',
            'contrast(1.05) saturate(1.03) drop-shadow(0 24px 40px rgba(87,65,40,0.14))',
          ],
        }}
        transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <AgoraSprite
        row={1}
        col={4}
        className="-right-5 bottom-4 h-[242px] w-[242px] sm:-right-7 sm:h-[292px] sm:w-[292px] lg:-right-10 lg:h-[336px] lg:w-[336px]"
        style={{ opacity: 0.6, filter: 'contrast(1.06) saturate(1.04) drop-shadow(0 24px 42px rgba(87,65,40,0.16))' }}
        animate={{
          scale: [1, 1.016, 1],
          opacity: [0.46, 0.64, 0.46],
          filter: [
            'contrast(1.06) saturate(1.04) drop-shadow(0 24px 42px rgba(87,65,40,0.14))',
            'contrast(1.08) saturate(1.05) drop-shadow(0 30px 48px rgba(87,65,40,0.2))',
            'contrast(1.06) saturate(1.04) drop-shadow(0 24px 42px rgba(87,65,40,0.14))',
          ],
        }}
        transition={{ duration: 5.6, delay: 0.28, repeat: Infinity, ease: 'easeInOut' }}
      />
      <AgoraSprite
        row={5}
        col={2}
        className="left-1/2 bottom-[-18px] h-[180px] w-[180px] -translate-x-1/2 sm:bottom-[-24px] sm:h-[216px] sm:w-[216px] lg:bottom-[-34px] lg:h-[264px] lg:w-[264px]"
        style={{ opacity: 0.42, filter: 'contrast(1.03) drop-shadow(0 20px 32px rgba(87,65,40,0.12))' }}
        animate={{
          scale: [1, 1.012, 1],
          opacity: [0.3, 0.46, 0.3],
          filter: [
            'contrast(1.03) drop-shadow(0 20px 32px rgba(87,65,40,0.1))',
            'contrast(1.05) drop-shadow(0 24px 36px rgba(87,65,40,0.16))',
            'contrast(1.03) drop-shadow(0 20px 32px rgba(87,65,40,0.1))',
          ],
        }}
        transition={{ duration: 6.4, delay: 0.52, repeat: Infinity, ease: 'easeInOut' }}
      />
      <AgoraSprite
        row={2}
        col={0}
        className="left-8 top-8 h-[124px] w-[124px] sm:left-12 sm:top-10 sm:h-[152px] sm:w-[152px] lg:left-20 lg:top-12 lg:h-[182px] lg:w-[182px]"
        style={{ opacity: 0.36, filter: 'drop-shadow(0 16px 28px rgba(87,65,40,0.1))' }}
        animate={{
          scale: [1, 1.014, 1],
          opacity: [0.24, 0.4, 0.24],
          filter: [
            'drop-shadow(0 16px 28px rgba(87,65,40,0.08))',
            'drop-shadow(0 20px 32px rgba(87,65,40,0.14))',
            'drop-shadow(0 16px 28px rgba(87,65,40,0.08))',
          ],
        }}
        transition={{ duration: 6.1, delay: 0.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <AgoraSprite
        row={2}
        col={4}
        className="right-8 top-10 h-[124px] w-[124px] sm:right-12 sm:top-10 sm:h-[150px] sm:w-[150px] lg:right-20 lg:top-12 lg:h-[178px] lg:w-[178px]"
        style={{ opacity: 0.34, filter: 'drop-shadow(0 16px 28px rgba(87,65,40,0.1))' }}
        animate={{
          scale: [1, 1.014, 1],
          opacity: [0.22, 0.38, 0.22],
          filter: [
            'drop-shadow(0 16px 28px rgba(87,65,40,0.08))',
            'drop-shadow(0 20px 32px rgba(87,65,40,0.14))',
            'drop-shadow(0 16px 28px rgba(87,65,40,0.08))',
          ],
        }}
        transition={{ duration: 5.9, delay: 0.62, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

function AgoraZenCover({
  hasExistingTopics,
  onCreate,
  onCreateGuest,
}: {
  hasExistingTopics: boolean;
  onCreate: () => void;
  onCreateGuest: () => void;
}) {
  return (
    <div className="relative flex h-full min-h-[520px] items-center justify-center overflow-hidden px-4 py-8 md:px-8 lg:px-16">
      <AgoraForumBackdrop className="inset-0" />
      <div className="relative z-10 w-full max-w-5xl overflow-visible">
        <section className="relative overflow-hidden rounded-xl border border-stone-200/80 bg-white/88 px-8 py-12 shadow-none backdrop-blur-[2px] dark:border-white/10 dark:bg-[#161a22]/95 sm:px-12 sm:py-16">
          <div className="absolute inset-x-0 bottom-0 h-48 bg-[repeating-linear-gradient(180deg,transparent_0,transparent_12px,rgba(148,163,184,0.08)_12px,rgba(148,163,184,0.08)_13px)] opacity-80 dark:bg-[repeating-linear-gradient(180deg,transparent_0,transparent_12px,rgba(148,163,184,0.06)_12px,rgba(148,163,184,0.06)_13px)] dark:opacity-70" />
          <div className="absolute inset-x-10 top-10 h-px bg-gradient-to-r from-transparent via-stone-300/70 to-transparent dark:via-slate-500/45" />
          <div className="absolute inset-x-16 top-16 h-px bg-gradient-to-r from-transparent via-stone-200/80 to-transparent dark:via-slate-600/35" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.08),transparent_34%)] opacity-90 dark:bg-[radial-gradient(circle_at_top,rgba(167,139,250,0.14),transparent_38%)]" />

          <div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
            <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-lg border border-violet-200/70 bg-[#EEE7FF] text-[#8B5CF6] shadow-none dark:border-violet-400/30 dark:bg-violet-500/10 dark:text-violet-300">
              <AgoraZenMark className="h-12 w-12" />
            </div>

            <div className="text-[11px] uppercase tracking-[0.42em] text-stone-400 dark:text-slate-400">Agora</div>
            <h2 className="mt-4 font-serif text-3xl font-semibold tracking-[0.08em] text-stone-800 dark:text-slate-100 sm:text-5xl">
              议论广场
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-stone-500 dark:text-slate-300 sm:text-lg">
              围绕具体议题展开协作讨论，让过程、观点与结论自然沉淀。
            </p>
            <p className="mt-2 text-sm text-stone-400 dark:text-slate-400">
              {hasExistingTopics ? '从左侧继续已有议题，或开启一场新的协作讨论。' : '从一个清晰议题开始，把讨论与结论留在同一处。'}
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Button
                className="h-10 rounded-md px-5 text-sm"
                onClick={onCreate}
              >
                <span className="material-symbols-outlined mr-2 text-[18px]">add_circle</span>
                新建议题
              </Button>
              <button
                type="button"
                className="rounded-md border border-stone-200 bg-white/80 px-4 py-2 text-sm text-stone-500 shadow-none transition-colors hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-violet-400/40 dark:hover:bg-violet-500/10 dark:hover:text-violet-200"
                onClick={onCreateGuest}
              >
                <span className="material-symbols-outlined mr-2 align-[-3px] text-[16px]">gesture</span>
                {hasExistingTopics ? '左侧选择议题即可进入讨论' : '创建常驻嘉宾'}
              </button>
            </div>
          </div>
        </section>
        <AgoraForumForeground className="-inset-x-10 -inset-y-6 sm:-inset-x-12 lg:-inset-x-16" />
      </div>
    </div>
  );
}

export function ChatPageContent({
  embedded = false,
  hideSidebar = false,
  onOpenSecondarySidebar,
  secondarySidebarPinned = false,
}: {
  embedded?: boolean;
  hideSidebar?: boolean;
  onOpenSecondarySidebar?: () => void;
  secondarySidebarPinned?: boolean;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dockWorkspace = useDashboardDockWorkspace();
  const dashboardRouteParam = searchParams.get('route');
  const shouldHandleChatSearchParams = !embedded || !dashboardRouteParam;
  useSidebarPluginPreferences();
  const {
    activeSessionId, activeSession, sessions, createSession, setActiveSessionId, sendMessage, compactActiveSession, stopStreaming,
    deleteMessage, retryFromMessage, continueFromMessage,
    loading, sessionLoadingId, streamingMessageId, setStreamingMessageId, markSessionStreaming, unmarkSessionStreaming,
    model,
    setModel,
    creationAssistantDefaultEnabled = true,
    setCreationAssistantDefaultEnabled = () => {},
    engine,
    effectiveEngine,
    isModelSelectionReady,
    setEngine,
    confirmAction, rejectAction, undoActionById, retryAction, reloadActionResult,
    skillSettings, mcpSettings, setSessionWorkbenchState, updateSessionWorkbenchState,
    appendSessionMessage,
    updateSessionMessage,
    workingDirectory,
    setWorkingDirectory,
  } = useChat();
  const chatAgentMessageRows = useAgentMessageRows(activeSession?.id ? { frontendSessionId: activeSession.id } : undefined);
  const dbBackedActiveSession = useMemo(() => {
    if (!activeSession || chatAgentMessageRows.length === 0) return activeSession;
    const latestRow = [...chatAgentMessageRows].reverse().find((row) => String(row.content || '').trim());
    if (!latestRow) return activeSession;
    const lastAssistant = [...activeSession.messages].reverse().find((message) => message.role === 'assistant');
    if (!lastAssistant) return activeSession;
    return {
      ...activeSession,
      messages: activeSession.messages.map((message) => (
        message.id === lastAssistant.id
          ? {
              ...message,
              content: message.content || latestRow.content,
              rawContent: latestRow.content || message.rawContent,
            }
          : message
      )),
    };
  }, [activeSession, chatAgentMessageRows]);
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [fileDropActive, setFileDropActive] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<ChatPendingAttachment | null>(null);
  const [attachmentPreviewPath, setAttachmentPreviewPath] = useState<string | null>(null);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [engineSlashCommands, setEngineSlashCommands] = useState<HomepageSlashCommand[]>([]);
  const [slashCommandRefreshNonce, setSlashCommandRefreshNonce] = useState(0);
  const [availableMentionAgents, setAvailableMentionAgents] = useState<Array<{ name: string; description?: string; systemPrompt?: string; engine?: string; model?: string; avatar?: any; team?: string; roleType?: string }>>([]);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [agentPickerAdding, setAgentPickerAdding] = useState(false);
  const [agentPickerQuery, setAgentPickerQuery] = useState('');
  const [agentPickerRuntime, setAgentPickerRuntime] = useState({ engine: '', model: '' });
  const slashItemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const collaborationMessageHandlerRef = useRef<((text: string) => void) | null>(null);
  const activeAgentStopsRef = useRef<Array<() => Promise<void> | void>>([]);
  const [notebookExporting, setNotebookExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ type: 'conversation' } | { type: 'assistant'; messageId: string } | null>(null);
  const [exportFileName, setExportFileName] = useState('');
  const [exportScope, setExportScope] = useState<NotebookScope>('personal');
  const [exportDirectory, setExportDirectory] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const [debugPrompt, setDebugPrompt] = useState<string | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [cliRunRequest, setCliRunRequest] = useState<CliRunDialogRequest | null>(null);
  const [workspaceEditorOpen, setWorkspaceEditorOpen] = useState(false);
  const [workspaceEditorPath, setWorkspaceEditorPath] = useState<string | undefined>();
  const [workspaceEditorFilePath, setWorkspaceEditorFilePath] = useState<string | null>(null);
  const [workspaceEditorLineNumber, setWorkspaceEditorLineNumber] = useState<number | null>(null);
  const [workspaceEditorColumn, setWorkspaceEditorColumn] = useState<number | null>(null);
  const [workspaceEditorTitle, setWorkspaceEditorTitle] = useState<string | undefined>();
  const [chatWorkspaceActiveTab, setChatWorkspaceActiveTab] = useState('chat');
  const [chatWorkspaceDialogOpen, setChatWorkspaceDialogOpen] = useState(false);
  const [chatWorkspaceDraft, setChatWorkspaceDraft] = useState('');
  const [chatWorkspaceCleanupConfirm, setChatWorkspaceCleanupConfirm] = useState<{
    sessionId: string;
    workspacePath: string;
    nextPath: string;
  } | null>(null);
  const [deletePreviousChatWorkspace, setDeletePreviousChatWorkspace] = useState(true);
  const [chatWorkspaceSaving, setChatWorkspaceSaving] = useState(false);
  const [wechatBindDialogOpen, setWeChatBindDialogOpen] = useState(false);
  const [sessionDirectoryView, setSessionDirectoryView] = useState<SessionDirectoryView>(() => (
    readStoredSessionDirectoryView() || readStoredSessionDirectoryOrder()[0] || 'conversation'
  ));
  const createAndActivateSession = useCallback((options?: Parameters<typeof createSession>[0]) => {
    const sessionId = createSession(options);
    setActiveSessionId(sessionId);
    setSessionDirectoryView('conversation');
    return sessionId;
  }, [createSession, setActiveSessionId]);
  const handleCreateNewConversation = useCallback(() => {
    const sessionId = createAndActivateSession({ title: '新对话' });
    if (embedded && hideSidebar && !secondarySidebarPinned) {
      onOpenSecondarySidebar?.();
    }
    toast('success', '已新建对话');
    return sessionId;
  }, [createAndActivateSession, embedded, hideSidebar, onOpenSecondarySidebar, secondarySidebarPinned, toast]);
  const [origin, setOrigin] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RichTextEditorHandle | null>(null);
  const editEditorRef = useRef<RichTextEditorHandle | null>(null);
  const lastEditSeedRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollLockedRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const pendingHistoryScrollAdjustRef = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const isMobile = useIsMobile();
  const [currentUser, setCurrentUser] = useState<{ username: string; email: string; role: 'admin' | 'user'; avatar?: string } | null>(null);
  const [homeSidebarTab, setHomeSidebarTab] = useState<HomeSidebarTab>('commander');
  const [homeSidebarMode, setHomeSidebarMode] = useState<HomeSidebarMode>('hidden');
  const [homeSidebarSize, setHomeSidebarSize] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_HOME_SIDEBAR_SIZE;
    const saved = Number(window.localStorage.getItem(HOME_SIDEBAR_WIDTH_STORAGE_KEY) || '');
    if (!Number.isFinite(saved)) return DEFAULT_HOME_SIDEBAR_SIZE;
    return Math.min(MAX_HOME_SIDEBAR_SIZE, Math.max(MIN_HOME_SIDEBAR_SIZE, saved));
  });
  const [workflowCreatorOpen, setWorkflowCreatorOpen] = useState(false);
  const [workflowCreatorSessionId, setWorkflowCreatorSessionId] = useState<string | null>(null);
  const [workflowCreatorRequirements, setWorkflowCreatorRequirements] = useState(DEFAULT_AI_WORKFLOW_REQUIREMENTS);
  const starterHandledRef = useRef(false);
  const homeEntryResetHandledRef = useRef(false);
  const lastHomeSidebarSyncRef = useRef('');
  const lastSessionDirectoryAutoSwitchRef = useRef('');
  const autoCreatedSessionIdRef = useRef<string | null>(null);

  const parsedSidebarHint = useMemo<HomeSidebarHint | null>(() => {
    // 已有持久化状态时跳过昂贵的 parseActions 解析
    if (activeSession?.sessionWorkbenchState?.homeSidebar) {
      return null;
    }
    const assistantMessages = [...(activeSession?.messages || [])]
      .filter((message) => message.role === 'assistant')
      .reverse();
    for (const message of assistantMessages) {
      const parsed = parseActions(message.rawContent || message.content || '');
      if (parsed.sidebarHints.length > 0) {
        return parsed.sidebarHints[parsed.sidebarHints.length - 1];
      }
    }
    return null;
  }, [activeSession?.messages, activeSession?.sessionWorkbenchState?.homeSidebar]);

  const persistedSidebarHint = normalizeHomeSidebarHint(activeSession?.sessionWorkbenchState?.homeSidebar);
  const latestSidebarHint = persistedSidebarHint || parsedSidebarHint;
  const activeChatWorkspacePath = String(activeSession?.sessionWorkbenchState?.chatWorkspace?.workingDirectory || '').trim();
  const fallbackWorkingDirectory = String(workingDirectory || '').trim();
  const effectiveWorkingDirectory = activeChatWorkspacePath || fallbackWorkingDirectory;

  useEffect(() => {
    if (activeSessionId || activeSession?.id) {
      autoCreatedSessionIdRef.current = activeSessionId || activeSession?.id || null;
    }
  }, [activeSession?.id, activeSessionId]);
  const hasWorkflowSidebarContext = Boolean(activeSession?.workflowBinding || activeSession?.sessionWorkbenchState?.embeddedWorkflow?.configFile);
  const hasWorkflowRuntimeRightRailContext = Boolean(
    (activeSession?.workflowBinding?.configFile && activeSession?.workflowBinding?.runId)
    || (activeSession?.sessionWorkbenchState?.embeddedWorkflow?.configFile && activeSession?.sessionWorkbenchState?.embeddedWorkflow?.runId)
  );
  const hasCollaborationSidebarContext = Boolean(activeSession?.sessionWorkbenchState?.collaborationRoom);
  const isBuiltInAgoraMode = Boolean(activeSession?.sessionWorkbenchState?.collaborationRoom?.chatroom);
  const renderDedicatedAgoraShell = false;
  const collaborationRoomCore = useCollaborationRoom({
    sessionWorkbenchState: activeSession?.sessionWorkbenchState,
    setSessionWorkbenchState,
    fallbackTopic: activeSession?.title,
  });
  const hasCollaborationParticipants = collaborationRoomCore.participants.length > 0;
  const isMultiAgentConversation = collaborationRoomCore.participants.length > 0;
  const activeAgentBinding = activeSession?.agentBinding;
  const hasExistingAgoraTopics = useMemo(
    () => sessions.some((session) => Boolean(session.sessionWorkbenchState?.collaborationRoom)),
    [sessions]
  );
  const showAgoraZenCover = false;
  const hasCommanderSidebarContext = hasWorkflowSidebarContext;
  const hasHintSidebarContext = Boolean(
    latestSidebarHint?.intent
    || latestSidebarHint?.agentDraft
    || latestSidebarHint?.tabs?.length
  );
  const derivedHomeSidebarTab = useMemo(
    () => inferHomeSidebarTab(latestSidebarHint, {
      hasWorkflowBinding: hasCommanderSidebarContext,
    }),
    [hasCommanderSidebarContext, latestSidebarHint]
  );
  const derivedHomeSidebarMode = useMemo(
    () => inferHomeSidebarMode(latestSidebarHint, {
      hasWorkflowBinding: hasCommanderSidebarContext,
    }),
    [hasCommanderSidebarContext, latestSidebarHint]
  );

  const sessionScopedSidebarTabs = useMemo<HomeSidebarTab[]>(() => {
    const tabs = new Set<HomeSidebarTab>();
    // If hint explicitly specifies tabs, use those as the primary source
    const hintTabs = normalizeHomeSidebarTabs(latestSidebarHint?.tabs);
    if (hintTabs.length > 0) {
      for (const tab of hintTabs) {
        if (tab === 'commander' && !hasCommanderSidebarContext) continue;
        tabs.add(tab);
      }
    } else {
      if (hasCommanderSidebarContext) {
        tabs.add('commander');
      }
    }
    if (tabs.size === 0 && hasCommanderSidebarContext) tabs.add('commander');
    if (tabs.size === 0 && latestSidebarHint) tabs.add(derivedHomeSidebarTab);
    return Array.from(tabs);
  }, [derivedHomeSidebarTab, hasCommanderSidebarContext, latestSidebarHint, latestSidebarHint?.tabs]);

  const availableHomeSidebarTabs = useMemo<HomeSidebarTab[]>(() => {
    const tabs = new Set<HomeSidebarTab>(sessionScopedSidebarTabs);
    if (tabs.size === 0 && derivedHomeSidebarMode === 'active') {
      tabs.add(derivedHomeSidebarTab);
    }
    return Array.from(tabs);
  }, [derivedHomeSidebarMode, derivedHomeSidebarTab, sessionScopedSidebarTabs]);
  const hasHomeSidebarContext = hasWorkflowSidebarContext
    || hasHintSidebarContext;
  const availableHomeSidebarTabsKey = availableHomeSidebarTabs.join('|');

  useEffect(() => {
    writeStoredSessionDirectoryView(sessionDirectoryView);
  }, [sessionDirectoryView]);

  useEffect(() => {
    if (!parsedSidebarHint) return;
    const persisted = persistedSidebarHint;
    if (JSON.stringify(parsedSidebarHint) === JSON.stringify(persisted || null)) return;
    setSessionWorkbenchState((prev) => ({
      ...(prev || {}),
      homeSidebar: parsedSidebarHint,
    }));
  }, [parsedSidebarHint, persistedSidebarHint, setSessionWorkbenchState]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    agentApi.listAgents()
      .then((data) => {
        if (cancelled) return;
        setAvailableMentionAgents(Array.isArray(data?.agents) ? data.agents : []);
      })
      .catch(() => {
        if (!cancelled) setAvailableMentionAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleOpenWorkspacePath = (event: Event) => {
      const detail = (event as CustomEvent<{
        absolutePath?: string;
        workspacePath?: string;
        filePath?: string | null;
        lineNumber?: number | null;
        column?: number | null;
      }>).detail;
      if (!detail?.workspacePath) return;
      const target = resolveWorkspaceLinkTarget({
        currentWorkspacePath: effectiveWorkingDirectory,
        linkWorkspacePath: detail.workspacePath,
        absolutePath: detail.absolutePath,
        filePath: detail.filePath,
      });
      setWorkspaceEditorTitle('文档链接');
      setWorkspaceEditorPath(target.workspacePath);
      setWorkspaceEditorFilePath(target.initialFilePath);
      setWorkspaceEditorLineNumber(target.lineNumber || detail.lineNumber || null);
      setWorkspaceEditorColumn(target.column || detail.column || null);
      setWorkspaceEditorOpen(true);
    };
    window.addEventListener('ace:open-workspace-path', handleOpenWorkspacePath as EventListener);
    return () => {
      window.removeEventListener('ace:open-workspace-path', handleOpenWorkspacePath as EventListener);
    };
  }, [effectiveWorkingDirectory]);

  const chatTitle = useMemo(() => {
    const notebookFile = searchParams.get('notebookFile');
    if (notebookFile) {
      const fileName = notebookFile.split('/').pop() || notebookFile;
      return `${fileName} · Notebook`;
    }

    const sessionTitle = activeSession?.title?.trim();
    return sessionTitle || '首页';
  }, [activeSession?.title, searchParams]);

  useDocumentTitle(embedded ? null : chatTitle);

  // Load current user info
  useEffect(() => {
    try {
      const stored = localStorage.getItem('auth-user');
      if (stored) setCurrentUser(JSON.parse(stored));
    } catch {}
  }, []);

  // Load saved width
  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) setSidebarWidth(w);
    }
  }, []);

  // Hide sidebar by default on mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // Detect user scroll to lock/unlock auto-scroll
  const hasMessages = (activeSession?.messages?.length ?? 0) > 0;
  useEffect(() => {
    if (isMobile) return;

    const hintedTab = normalizeHomeSidebarTab(latestSidebarHint?.activeTab);
    const nextTab = hintedTab && availableHomeSidebarTabs.includes(hintedTab)
      ? hintedTab
      : availableHomeSidebarTabs[0] || derivedHomeSidebarTab;

    let nextMode = latestSidebarHint?.mode || derivedHomeSidebarMode;
    if (nextMode === 'hidden' && hasHomeSidebarContext && availableHomeSidebarTabs.length > 0) {
      nextMode = 'peek';
    } else if (!hasHomeSidebarContext && hasMessages) {
      nextMode = 'hidden';
    }
    if (
      hasCollaborationSidebarContext
      && !hasCollaborationParticipants
      && !hasWorkflowSidebarContext
      && !hasHintSidebarContext
      && activeSession?.sessionWorkbenchState?.rightRail?.collapsed
    ) {
      nextMode = 'hidden';
    }

    const syncSignature = [
      activeSession?.id || '',
      nextTab,
      nextMode,
      availableHomeSidebarTabsKey,
      hasHomeSidebarContext ? 'context' : 'empty',
    ].join('|');
    if (lastHomeSidebarSyncRef.current === syncSignature) return;
    lastHomeSidebarSyncRef.current = syncSignature;

    setHomeSidebarTab((prev) => (prev === nextTab ? prev : nextTab));
    setHomeSidebarMode((prev) => (prev === nextMode ? prev : nextMode));
  }, [
    activeSession?.id,
    availableHomeSidebarTabsKey,
    derivedHomeSidebarMode,
    derivedHomeSidebarTab,
    hasHomeSidebarContext,
    hasCollaborationParticipants,
    hasCollaborationSidebarContext,
    hasHintSidebarContext,
    hasMessages,
    hasWorkflowSidebarContext,
    isMobile,
    latestSidebarHint?.activeTab,
    latestSidebarHint?.mode,
    activeSession?.sessionWorkbenchState?.rightRail?.collapsed,
  ]);

  useEffect(() => {
    if (!activeSession) {
      lastSessionDirectoryAutoSwitchRef.current = '';
      return;
    }

    lastSessionDirectoryAutoSwitchRef.current = '';
    setSessionDirectoryView((prev) => (prev === 'conversation' ? prev : 'conversation'));
  }, [
    activeSession?.id,
    activeSession?.sessionWorkbenchState?.collaborationRoom,
    activeSession?.sessionWorkbenchState?.homeSidebar,
    activeSession?.workflowBinding?.configFile,
    activeSession?.workflowBinding?.runId,
    latestSidebarHint,
  ]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isProgrammaticScrollRef.current) return;
      const threshold = 80;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      autoScrollLockedRef.current = !nearBottom;
      setShowScrollBtn(!nearBottom && hasMessages);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMessages]);

  // Auto-scroll to bottom only if not locked by user
  useEffect(() => {
    if (!autoScrollLockedRef.current) {
      isProgrammaticScrollRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => { isProgrammaticScrollRef.current = false; }, 500);
    }
  }, [activeSession?.messages, loading, streamingMessageId]);

  useEffect(() => {
    if (!editDialogOpen || !editEditorRef.current || !editingMessageId) return;
    if (lastEditSeedRef.current === editingMessageId) return;
    editEditorRef.current.setContent(editContent);
    lastEditSeedRef.current = editingMessageId;
  }, [editContent, editDialogOpen, editingMessageId]);

  useEffect(() => {
    if (!shouldHandleChatSearchParams) return;
    if (homeEntryResetHandledRef.current) return;
    homeEntryResetHandledRef.current = true;

    const hasExplicitSessionTarget = Boolean(
      searchParams.get('sessionId')
      || searchParams.get('agentName')
      || searchParams.get('starterPrompt')
      || searchParams.get('starterAction')
    );
    if (hasExplicitSessionTarget) return;

    setActiveSessionId(null);
  }, [searchParams, setActiveSessionId, shouldHandleChatSearchParams]);

  useEffect(() => {
    if (!shouldHandleChatSearchParams) return;
    const targetSessionId = searchParams.get('sessionId');
    if (!targetSessionId || starterHandledRef.current) return;

    starterHandledRef.current = true;
    const sidebarTab = searchParams.get('sidebarTab');
    if (sidebarTab === 'agent' || sidebarTab === 'commander') {
      openHomeSidebar(sidebarTab);
    }
    const targetSession = sessions.find((session) => session.id === targetSessionId);
    if (targetSession) {
      setSessionDirectoryView('conversation');
    }
    setActiveSessionId(targetSessionId);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('sessionId');
    nextParams.delete('sidebarTab');
    nextParams.delete('sessionTitle');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [pathname, router, searchParams, sessions, setActiveSessionId, shouldHandleChatSearchParams]);

  useEffect(() => {
    if (!shouldHandleChatSearchParams) return;
    const starterAgent = searchParams.get('agentName');
    if (!starterAgent || starterHandledRef.current) return;

    starterHandledRef.current = true;
    const sidebarTab = searchParams.get('sidebarTab');
    const sessionTitle = searchParams.get('sessionTitle');
    const team = searchParams.get('agentTeam');
    const roleType = searchParams.get('agentRoleType');
    createSession({
      title: sessionTitle?.trim() || `${starterAgent} 对话`,
      agentBinding: {
        agentName: starterAgent,
        team: (team === 'blue' || team === 'red' || team === 'judge' || team === 'black-gold') ? team : undefined,
        roleType: roleType === 'supervisor' ? 'supervisor' : roleType === 'normal' ? 'normal' : undefined,
      },
    });

    if (sidebarTab === 'agent' || sidebarTab === 'commander') {
      openHomeSidebar(sidebarTab);
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('agentName');
    nextParams.delete('agentTeam');
    nextParams.delete('agentRoleType');
    nextParams.delete('sidebarTab');
    nextParams.delete('sessionTitle');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [createSession, pathname, router, searchParams, shouldHandleChatSearchParams]);

  useEffect(() => {
    if (!shouldHandleChatSearchParams) return;
    const starterPrompt = searchParams.get('starterPrompt');
    if (!starterPrompt || starterHandledRef.current) return;

    starterHandledRef.current = true;
    const sidebarTab = searchParams.get('sidebarTab');
    const sessionTitle = searchParams.get('sessionTitle');
    const existingSessionId = searchParams.get('sessionId');
    if (existingSessionId) {
      const targetSession = sessions.find((session) => session.id === existingSessionId);
      if (targetSession) {
        setSessionDirectoryView('conversation');
      }
      setActiveSessionId(existingSessionId);
    } else {
      createSession({ title: sessionTitle?.trim() || '新对话' });
    }

    if (sidebarTab === 'agent' || sidebarTab === 'commander') {
      openHomeSidebar(sidebarTab);
    }

    setInput(starterPrompt);
    editorRef.current?.focus();

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('sessionId');
    nextParams.delete('starterPrompt');
    nextParams.delete('sidebarTab');
    nextParams.delete('sessionTitle');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [createSession, pathname, router, searchParams, sessions, setActiveSessionId, shouldHandleChatSearchParams]);

  const getInputMarkdown = useCallback(() => {
    return editorRef.current?.getMarkdown().trim() || input.trim();
  }, [input]);
  const canSubmitMessage = Boolean(input.trim() || pendingAttachment);

  const homepageSlashCommands = useMemo<HomepageSlashCommand[]>(() => ([
    {
      id: 'compact',
      command: '/compact',
      title: '压缩上下文',
      subtext: '压缩当前会话上下文，保留关键信息继续对话',
      icon: 'compress',
      aliases: ['compact', '压缩', '上下文'],
    },
    ...engineSlashCommands,
  ]), [engineSlashCommands]);

  useEffect(() => {
    const handleRefreshSlashCommands = () => {
      setSlashCommandRefreshNonce((value) => value + 1);
    };
    window.addEventListener('ace:slash-commands-refresh', handleRefreshSlashCommands);
    return () => {
      window.removeEventListener('ace:slash-commands-refresh', handleRefreshSlashCommands);
    };
  }, []);

  useEffect(() => {
    const handleCliRun = (event: Event) => {
      const detail = (event as CustomEvent<CliRunDialogRequest>).detail;
      if (!detail?.commandName || !detail?.workingDirectory) return;
      setCliRunRequest(detail);
    };
    window.addEventListener('ace:cli-run', handleCliRun as EventListener);
    return () => {
      window.removeEventListener('ace:cli-run', handleCliRun as EventListener);
    };
  }, []);

  useEffect(() => {
    const activeEngine = String(effectiveEngine || engine || '').trim();
    const logicalEngine = activeEngine === 'opencode-sdk'
      ? 'opencode'
      : activeEngine === 'codegenie-sdk'
        ? 'codegenie'
        : activeEngine === 'nga-sdk'
          ? 'nga'
          : activeEngine === 'claude-code-acp'
            ? 'claude-code'
            : activeEngine;
    if (!logicalEngine) {
      setEngineSlashCommands([]);
      return;
    }

    let cancelled = false;
    fetchRuntimeCommandMetadataCompat({
      engine: activeEngine,
      cwd: effectiveWorkingDirectory,
    })
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.commands) ? data.commands : [];
        const namespace = String(data?.namespace || logicalEngine).trim() || logicalEngine;
        const commands = rows
          .map((item: any): HomepageSlashCommand | null => {
            const name = String(item?.name || '').trim();
            if (!name) return null;
            const description = String(item?.description || '').trim();
            return {
              id: `${namespace}:${name}`,
              command: `/${namespace}:${name}`,
              displayCommand: `/${name}`,
              title: name,
              subtext: description || `${namespace} 命令`,
              icon: 'terminal',
              aliases: [namespace, name, description].filter(Boolean),
              prompt: `/${namespace}:${name}`,
              engineTag: namespace,
            };
          })
          .filter(Boolean) as HomepageSlashCommand[];
        setEngineSlashCommands(commands);
      })
      .catch(() => {
        if (!cancelled) setEngineSlashCommands([]);
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveEngine, engine, effectiveWorkingDirectory, slashCommandRefreshNonce]);

  const slashQuery = useMemo(() => {
    const text = input.trim();
    return text.startsWith('/') && !hasInlineCommandWhitespace(text) ? text.slice(1).toLowerCase() : '';
  }, [input]);

  const filteredSlashCommands = useMemo(() => {
    const text = input.trim();
    if (!text.startsWith('/') || hasInlineCommandWhitespace(text)) return [];
    if (!slashQuery) return homepageSlashCommands;
    return homepageSlashCommands.filter((item) => {
      const haystack = [item.command, item.title, item.subtext, ...item.aliases].join(' ').toLowerCase();
      return haystack.includes(slashQuery);
    });
  }, [homepageSlashCommands, input, slashQuery]);

  useEffect(() => {
    slashItemRefs.current.length = filteredSlashCommands.length;
    if (!slashMenuOpen || filteredSlashCommands.length === 0) return;
    const item = slashItemRefs.current[Math.max(0, Math.min(slashActiveIndex, filteredSlashCommands.length - 1))];
    if (!item) return;
    const frame = window.requestAnimationFrame(() => {
      item.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [filteredSlashCommands.length, slashActiveIndex, slashMenuOpen]);

  const getEditMarkdown = useCallback(() => {
    return editEditorRef.current?.getMarkdown().trim() || editContent.trim();
  }, [editContent]);

  const updateNotebookUrl = useCallback((filePath: string, scope: NotebookScope = 'personal') => {
    const params = new URLSearchParams();
    params.set('notebook', '1');
    params.set('notebookFile', filePath);
    params.set('notebookScope', scope);
    router.push(`/notebook?${params.toString()}`);
  }, [router]);

  const normalizeNotebookFileName = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.endsWith('.cj.md') ? trimmed : `${trimmed}.cj.md`;
  }, []);

  const createDefaultNotebookBaseName = useCallback(() => {
    return createDefaultNotebookFileName().replace(/\.cj\.md$/i, '');
  }, []);

  const openNotebookExportDialog = useCallback((target: { type: 'conversation' } | { type: 'assistant'; messageId: string }) => {
    setPendingExport(target);
    setExportFileName(createDefaultNotebookBaseName());
    setExportScope('personal');
    setExportDirectory('');
    setExportDialogOpen(true);
  }, [createDefaultNotebookBaseName]);

  const closeNotebookExportDialog = useCallback(() => {
    if (notebookExporting) return;
    setExportDialogOpen(false);
    setPendingExport(null);
    setExportFileName('');
    setExportScope('personal');
    setExportDirectory('');
  }, [notebookExporting]);

  const saveNotebookFile = useCallback(async (filePath: string, content: string, scope: NotebookScope) => {
    await workspaceApi.manageNotebook('create-file', { path: filePath }, { scope });
    await workspaceApi.saveNotebookFile(filePath, content, { scope });
    updateNotebookUrl(filePath, scope);
  }, [updateNotebookUrl]);

  const handleConfirmNotebookExport = useCallback(async () => {
    if (!pendingExport) return;

    const normalizedFileName = normalizeNotebookFileName(exportFileName) || normalizeNotebookFileName(createDefaultNotebookBaseName());
    if (!normalizedFileName) return;
    const normalizedDir = exportDirectory.replace(/^\/+|\/+$/g, '');
    const finalFilePath = normalizedDir ? `${normalizedDir}/${normalizedFileName}` : normalizedFileName;

    const exportPayload = pendingExport.type === 'conversation'
      ? (dbBackedActiveSession ? { filePath: finalFilePath, content: buildNotebookFromConversation(dbBackedActiveSession) } : null)
      : (() => {
          const message = dbBackedActiveSession?.messages.find((item) => item.id === pendingExport.messageId && item.role === 'assistant');
          if (!message) return null;
          const contentText = (message.rawContent || message.content || '').trim();
          if (!contentText) return null;
          return { filePath: finalFilePath, content: buildNotebookFromAssistantMessage(message) };
        })();

    if (!exportPayload) {
      toast('warning', '没有可导出的内容');
      return;
    }

    try {
      setNotebookExporting(true);
      await saveNotebookFile(exportPayload.filePath, exportPayload.content, exportScope);
      toast('success', `已保存为 Notebook：${exportPayload.filePath}`);
      setExportDialogOpen(false);
      setPendingExport(null);
      setExportFileName('');
      setExportDirectory('');
    } catch (error: any) {
      toast('error', error?.message || '保存 Notebook 失败');
    } finally {
      setNotebookExporting(false);
    }
  }, [pendingExport, normalizeNotebookFileName, exportFileName, exportDirectory, toast, dbBackedActiveSession, saveNotebookFile, exportScope, createDefaultNotebookBaseName]);

  const handleSaveConversationAsNotebook = useCallback(async () => {
    if (!dbBackedActiveSession) return;
    const exportableMessages = dbBackedActiveSession.messages.filter((message) => {
      if (message.role === 'error') return false;
      return Boolean((message.rawContent || message.content || '').trim());
    });
    if (exportableMessages.length === 0) {
      toast('warning', '当前会话没有可导出的内容');
      return;
    }

    openNotebookExportDialog({ type: 'conversation' });
  }, [dbBackedActiveSession, openNotebookExportDialog, toast]);

  const handleSaveAssistantMessageAsNotebook = useCallback(async (messageId: string) => {
    const message = dbBackedActiveSession?.messages.find((item) => item.id === messageId && item.role === 'assistant');
    if (!message) return;

    const contentText = (message.rawContent || message.content || '').trim();
    if (!contentText) {
      toast('warning', '这条消息暂无可导出的内容');
      return;
    }

    openNotebookExportDialog({ type: 'assistant', messageId });
  }, [dbBackedActiveSession, openNotebookExportDialog, toast]);

  const unlockAutoScroll = useCallback(() => {
    autoScrollLockedRef.current = false;
    setShowScrollBtn(false);
  }, []);

  const openWorkflowCreator = useCallback((requirements?: string, targetSessionId?: string | null) => {
    // Opening the creator is only navigation. The planning flow creates a chat
    // session after the user submits requirements, so a cancelled entry leaves
    // no empty conversation in the sidebar.
    const sessionId = resolveWorkflowCreatorSessionId({
      targetSessionId,
      activeSessionId,
      activeSessionIdFallback: activeSession?.id,
    });
    setWorkflowCreatorSessionId(sessionId || null);
    setWorkflowCreatorRequirements(requirements?.trim() || DEFAULT_AI_WORKFLOW_REQUIREMENTS);
    setWorkflowCreatorOpen(true);
    unlockAutoScroll();
    setInput('');
    editorRef.current?.clear();
    if (loading) stopStreaming();
  }, [activeSession?.id, activeSessionId, loading, stopStreaming, unlockAutoScroll]);

  const closeWorkflowCreator = useCallback(() => {
    setWorkflowCreatorOpen(false);
    setWorkflowCreatorSessionId(null);
  }, []);

  const handleWorkflowCreatorSuccess = useCallback((filename: string) => {
    closeWorkflowCreator();
    if (embedded && dockWorkspace) {
      dockWorkspace.openTab({
        id: `workbench:${filename}:design`,
        title: filename,
        kind: 'workbench',
        config: filename,
        mode: 'design',
        search: 'mode=design',
      });
      return;
    }
    router.push(`/workbench/${encodeURIComponent(filename)}?mode=design`);
  }, [closeWorkflowCreator, dockWorkspace, embedded, router]);

  const scrollToBottom = useCallback(() => {
    unlockAutoScroll();
    isProgrammaticScrollRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => { isProgrammaticScrollRef.current = false; }, 500);
  }, [unlockAutoScroll]);

  const applyHomeSidebarState = useCallback((patch: {
    tab?: HomeSidebarTab;
    mode?: HomeSidebarMode;
    intent?: HomeSidebarHint['intent'];
    stage?: HomeSidebarHint['stage'];
    reason?: string;
    summary?: string;
    shouldOpenModal?: boolean;
  }) => {
    const buildNextHomeSidebar = (prev: HomeSidebarHint | null | undefined): HomeSidebarHint => ({
      type: 'home_sidebar',
      ...(prev || {}),
      ...(patch.tab ? { activeTab: patch.tab } : {}),
      ...(patch.mode ? { mode: patch.mode } : {}),
      ...(patch.intent ? { intent: patch.intent } : {}),
      ...(patch.stage ? { stage: patch.stage } : {}),
      ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.shouldOpenModal !== undefined ? { shouldOpenModal: patch.shouldOpenModal } : {}),
    });
    const shouldSwitchSessionDirectoryToWorkflow = patch.intent === 'workflow-run'
      || patch.intent === 'supervisor-chat';

    if (patch.tab) setHomeSidebarTab((prev) => (prev === patch.tab ? prev : patch.tab!));
    if (patch.mode) setHomeSidebarMode((prev) => (prev === patch.mode ? prev : patch.mode!));
    if (shouldSwitchSessionDirectoryToWorkflow) {
      setSessionDirectoryView('conversation');
    }

    if (!activeSessionId && !activeSession) {
      setSidebarOpen(true);
      if (!shouldSwitchSessionDirectoryToWorkflow) {
        setSessionDirectoryView('conversation');
      }
      createSession({
        title: '新对话',
        sessionWorkbenchState: {
          homeSidebar: buildNextHomeSidebar(null),
        },
      });
      return;
    }

    setSessionWorkbenchState((prev) => {
      const nextHomeSidebar = buildNextHomeSidebar(prev?.homeSidebar);
      if (JSON.stringify(prev?.homeSidebar || null) === JSON.stringify(nextHomeSidebar)) {
        return prev || { homeSidebar: nextHomeSidebar };
      }
      return {
        ...(prev || {}),
        homeSidebar: nextHomeSidebar,
      };
    });
  }, [activeSession, activeSessionId, createSession, setSessionWorkbenchState]);

  const openHomeSidebar = useCallback((
    tab?: HomeSidebarTab,
    intent?: HomeSidebarHint['intent'],
    stage?: HomeSidebarHint['stage'],
    options?: { shouldOpenModal?: boolean }
  ) => {
    applyHomeSidebarState({
      tab,
      mode: 'active',
      intent,
      stage,
      shouldOpenModal: options?.shouldOpenModal ?? false,
    });
  }, [applyHomeSidebarState]);

  const closeHomeSidebar = useCallback(() => {
    applyHomeSidebarState({ mode: hasHomeSidebarContext ? 'peek' : 'hidden' });
  }, [applyHomeSidebarState, hasHomeSidebarContext]);

  const handleHomeSidebarTabChange = useCallback((tab: HomeSidebarTab) => {
    applyHomeSidebarState({ tab });
  }, [applyHomeSidebarState]);

  const handleHomeSidebarLayout = useCallback((layout: Record<string, number> | number[]) => {
    if (homeSidebarMode !== 'active') return;
    const nextSize = Array.isArray(layout)
      ? layout[1]
      : layout['home-command-sidebar-panel'];
    if (!Number.isFinite(nextSize)) return;
    const clamped = Math.min(MAX_HOME_SIDEBAR_SIZE, Math.max(MIN_HOME_SIDEBAR_SIZE, nextSize));
    setHomeSidebarSize((prev) => Math.abs(prev - clamped) < 0.1 ? prev : clamped);
    try {
      window.localStorage.setItem(HOME_SIDEBAR_WIDTH_STORAGE_KEY, clamped.toFixed(2));
    } catch {}
  }, [homeSidebarMode]);

  const handlePrimarySidebarLayout = useCallback((layout: Record<string, number> | number[]) => {
    if (!sidebarOpen || isMobile || !containerRef.current) return;
    const nextSize = Array.isArray(layout)
      ? layout[0]
      : layout['chat-primary-sidebar-panel'];
    if (!Number.isFinite(nextSize)) return;
    const containerWidth = containerRef.current.getBoundingClientRect().width;
    const nextWidth = clampSidebarWidth((containerWidth * Number(nextSize)) / 100);
    setSidebarWidth((prev) => Math.abs(prev - nextWidth) < 1 ? prev : nextWidth);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(Math.round(nextWidth)));
    } catch {}
  }, [isMobile, sidebarOpen]);

  useEffect(() => {
    const shouldOpen = filteredSlashCommands.length > 0 && input.trim().startsWith('/');
    setSlashMenuOpen(shouldOpen);
    if (!shouldOpen) setSlashActiveIndex(0);
  }, [filteredSlashCommands.length, hasCollaborationSidebarContext, input]);

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashQuery]);

  const mainInputMentionItems = useMemo(() => {
    const participantNames = new Set(collaborationRoomCore.participantNames);
    const items: Array<{ id: string; label: string; description?: string }> = [];
    const push = (name: string, description?: string) => {
      const label = String(name || '').trim();
      if (!label || items.some((item) => item.id === label)) return;
      items.push({ id: label, label, description });
    };
    if (participantNames.size > 0) {
      push('全员', '当前对话成员');
    }
    push(DEFAULT_ASSISTANT_MENTION_NAME, activeAgentBinding?.agentName ? '当前默认助手' : '默认助手');
    collaborationRoomCore.participantNames.forEach((name) => push(name, '已在对话'));
    if (activeAgentBinding?.agentName) push(activeAgentBinding.agentName, '当前默认 Agent');
    availableMentionAgents.forEach((agent) => {
      const name = String(agent.name || '').trim();
      if (!name) return;
      push(name, participantNames.has(name) ? '已在对话' : '可拉入对话');
    });
    return items;
  }, [activeAgentBinding?.agentName, availableMentionAgents, collaborationRoomCore.participantNames]);

  const filteredAgentPickerAgents = useMemo(() => {
    const query = agentPickerQuery.trim().toLowerCase();
    const existing = new Set(collaborationRoomCore.participantNames);
    return availableMentionAgents
      .filter((agent) => {
        const name = String(agent.name || '').trim();
        if (!name || existing.has(name)) return false;
        if (!query) return true;
        return [
          name,
          agent.description,
          (agent as any).team,
          (agent as any).roleType,
        ].filter(Boolean).join(' ').toLowerCase().includes(query);
      })
      .slice(0, 24);
  }, [agentPickerQuery, availableMentionAgents, collaborationRoomCore.participantNames]);
  const agentPickerCanAdd = isModelSelectionReady;

  const addAgentToConversation = useCallback((agent: { name: string; description?: string; systemPrompt?: string; engine?: string; model?: string; avatar?: any; team?: string; roleType?: string }) => {
    if (!isModelSelectionReady) {
      toast('warning', '模型配置加载中，请稍候再添加 Agent');
      return;
    }
    const name = String(agent.name || '').trim();
    if (!name) return;
    const topic = activeSession?.title || '对话';
    const nextParticipant: CollaborationChatroomParticipant = {
      id: `agent-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      sourceType: 'agent' as const,
      sourceAgent: name,
      runtimeAgentName: name,
      systemPrompt: typeof agent.systemPrompt === 'string' ? agent.systemPrompt : undefined,
      personaPrompt: undefined,
      useDefaultModel: !agentPickerRuntime.model,
      engine: agentPickerRuntime.engine,
      model: agentPickerRuntime.model,
      createdAt: Date.now(),
    };

    const applyParticipant = (prev?: SessionWorkbenchState): SessionWorkbenchState => {
      const base = createPlainConversationRoomState({ topic, responseMode: collaborationRoomCore.responseMode });
      const currentRoom = prev?.collaborationRoom || base;
      const currentChatroom = currentRoom.chatroom || base.chatroom!;
      const roster = currentChatroom.participantRoster || [];
      if (roster.some((participant: CollaborationChatroomParticipant) => participant.name === name || participant.sourceAgent === name || participant.runtimeAgentName === name)) {
        return prev || {};
      }
      const nextRoster = [...roster, nextParticipant];
      return {
        ...(prev || {}),
        conversationMode: 'agent-chat' as const,
        collaborationRoom: {
          ...currentRoom,
          topic,
          selectedAgents: nextRoster.map((participant) => participant.name),
          chatroom: {
            ...base.chatroom!,
            ...currentChatroom,
            status: 'running' as const,
            topic,
            participants: nextRoster.map((participant) => participant.name),
            participantRoster: nextRoster,
            settings: {
              ...base.chatroom!.settings,
              ...(currentChatroom.settings || {}),
              responseMode: collaborationRoomCore.responseMode,
            },
          },
        },
      };
    };

    if (!activeSessionId && !activeSession) {
      const sessionId = createSession({
        title: topic,
        sessionWorkbenchState: applyParticipant(undefined),
      });
      setActiveSessionId(sessionId);
    } else {
      setSessionWorkbenchState((prev) => applyParticipant(prev));
    }
    setAgentPickerOpen(false);
    setAgentPickerAdding(false);
    setAgentPickerQuery('');
    setAgentPickerRuntime({ engine: '', model: '' });
    editorRef.current?.focus();
  }, [
    activeSession,
    activeSessionId,
    agentPickerRuntime.engine,
    agentPickerRuntime.model,
    collaborationRoomCore.responseMode,
    createSession,
    isModelSelectionReady,
    setActiveSessionId,
    setSessionWorkbenchState,
    toast,
  ]);

  const removeAgentFromConversation = useCallback((agentName: string) => {
    const name = agentName.trim();
    if (!name) return;
    setSessionWorkbenchState((prev) => {
      if (!prev?.collaborationRoom?.chatroom) return prev || {};
      const chatroom = prev.collaborationRoom.chatroom;
      const nextRoster = (chatroom.participantRoster || []).filter((participant) => participant.name !== name);
      return {
        ...prev,
        conversationMode: nextRoster.length > 0 ? 'agent-chat' : 'plain',
        collaborationRoom: {
          ...prev.collaborationRoom,
          selectedAgents: nextRoster.map((participant) => participant.name),
          chatroom: {
            ...chatroom,
            participants: nextRoster.map((participant) => participant.name),
            participantRoster: nextRoster,
          },
        },
      };
    });
  }, [setSessionWorkbenchState]);

  const handleSetCollaborationResponseMode = useCallback((mode: CollaborationChatroomMode) => {
    collaborationRoomCore.setResponseMode(mode);
  }, [collaborationRoomCore]);

  const stopActiveAiAction = useCallback(() => {
    stopStreaming();
    const stops = activeAgentStopsRef.current.splice(0);
    stops.forEach((stop) => {
      try {
        void stop();
      } catch {}
    });
    setStreamingMessageId(null);
    if (activeSessionId) {
      unmarkSessionStreaming(activeSessionId);
    }
  }, [activeSessionId, stopStreaming, setStreamingMessageId, unmarkSessionStreaming]);

  const sendUnifiedAgentChatMessage = useCallback(async (message: string) => {
    const knownAgentNames = availableMentionAgents.map((agent) => String(agent.name || '').trim()).filter(Boolean);
    const existingParticipants = collaborationRoomCore.participants;
    const existingNames = existingParticipants.map((participant) => participant.name).filter(Boolean);
    const mentionableNames = Array.from(new Set([DEFAULT_ASSISTANT_MENTION_NAME, ...knownAgentNames, ...existingNames]));
    const hasAllMention = message.includes('@全员');
    const directMentionText = message.replace(/@全员/g, '');
    const rawDirectMentions = extractAgentMentions(directMentionText, mentionableNames);
    const mentionsDefaultAssistant = hasAllMention || rawDirectMentions.includes(DEFAULT_ASSISTANT_MENTION_NAME);
    const mentionedAgents = Array.from(new Set([
      ...(hasAllMention ? existingNames : []),
      ...rawDirectMentions.filter((name) => name !== DEFAULT_ASSISTANT_MENTION_NAME),
    ]));
    const responseMode = collaborationRoomCore.responseMode;

    if (!existingParticipants.length && !mentionedAgents.length && !mentionsDefaultAssistant) return false;

    const missingMentionedAgents = mentionedAgents.filter((name) => !existingNames.includes(name));
    const participants = [
      ...existingParticipants,
      ...missingMentionedAgents.map((name) => {
        const agent = availableMentionAgents.find((item) => item.name === name);
        return {
          id: `agent-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name,
          sourceType: 'agent' as const,
          sourceAgent: name,
          runtimeAgentName: name,
          systemPrompt: typeof agent?.systemPrompt === 'string' ? agent.systemPrompt : undefined,
          personaPrompt: undefined,
          useDefaultModel: !agent?.model,
          engine: typeof agent?.engine === 'string' ? agent.engine : '',
          model: typeof agent?.model === 'string' ? agent.model : '',
          createdAt: Date.now(),
        };
      }),
    ];
    const participantNames = participants.map((participant) => participant.name).filter(Boolean);

    if (missingMentionedAgents.length && (activeSessionId || activeSession)) {
      const topic = activeSession?.title || '群聊';
      setSessionWorkbenchState((prev) => {
        const base = createPlainConversationRoomState({ topic, responseMode });
        const current = prev?.collaborationRoom
          ? {
            ...prev.collaborationRoom,
            chatroom: {
              ...base.chatroom!,
              ...(prev.collaborationRoom.chatroom || {}),
            },
          }
          : base;
        return {
          ...(prev || {}),
          conversationMode: participants.length > 0 ? 'agent-chat' : 'plain',
          collaborationRoom: {
            ...current,
            selectedAgents: participantNames,
            chatroom: {
              ...base.chatroom!,
              ...(current.chatroom || {}),
              status: 'running',
              topic,
              participants: participantNames,
              participantRoster: participants,
              settings: {
                ...base.chatroom!.settings,
                ...(current.chatroom?.settings || {}),
                responseMode,
              },
            },
          },
        };
      });
    }

    const targetNames = responseMode === 'broadcast' && participants.length > 1
      ? participantNames
      : mentionedAgents.length
        ? mentionedAgents
        : participants.length === 1
          ? [participants[0].name]
          : responseMode === 'facilitated'
            ? participantNames.slice(0, 1)
            : [];

    const shouldSendDefaultAssistant = mentionsDefaultAssistant;

    if (!targetNames.length && !shouldSendDefaultAssistant) return false;

    if (shouldSendDefaultAssistant && !targetNames.length) {
      await sendMessage(message);
      return true;
    }

    const now = Date.now();
    let targetSessionId = activeSessionId;
    if (!targetSessionId && !activeSession) {
      const roomState = createPlainConversationRoomState({ topic: '群聊', responseMode });
      targetSessionId = createSession({
        title: '对话',
        sessionWorkbenchState: {
          conversationMode: participants.length > 0 ? 'agent-chat' : 'plain',
          collaborationRoom: {
            ...roomState,
            selectedAgents: participantNames,
            chatroom: {
              ...roomState.chatroom!,
              participants: participantNames,
              participantRoster: participants,
            },
          },
        },
        messages: shouldSendDefaultAssistant ? [] : [{
          role: 'user',
          content: message,
          timestamp: now,
        }],
      });
      setActiveSessionId(targetSessionId);
    } else if (targetSessionId && !shouldSendDefaultAssistant) {
      await appendSessionMessage(targetSessionId, {
        role: 'user',
        content: message,
        timestamp: now,
      });
    }

    const sessionIdForAgents = targetSessionId || activeSessionId || undefined;
    if (shouldSendDefaultAssistant) {
      await sendMessage(message, { targetSessionId: sessionIdForAgents });
    }
    const runAgentStream = async (agentName: string) => {
      const participant = participants.find((item) => item.name === agentName);
      const runtimeName = participant?.runtimeAgentName || participant?.sourceAgent || agentName;
      const assistantMessageId = genLocalMessageId();
      await appendSessionMessage(sessionIdForAgents!, {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        rawContent: '',
        engine: participant?.engine || undefined,
        model: participant?.model || undefined,
        timestamp: Date.now(),
        cards: [{
          type: 'collaboration_speech',
          speakerName: agentName,
          speakerType: 'agent',
          actionLabel: 'Agent',
          avatar: (availableMentionAgents.find((item) => item.name === agentName) as any)?.avatar,
          team: (availableMentionAgents.find((item) => item.name === agentName) as any)?.team,
          roleType: (availableMentionAgents.find((item) => item.name === agentName) as any)?.roleType,
        }],
      });
      markSessionStreaming(sessionIdForAgents);
      setStreamingMessageId(assistantMessageId);
      try {
        const stream = await agentApi.streamChat(runtimeName, {
          message,
          mode: 'standalone-chat',
          frontendSessionId: sessionIdForAgents || null,
          workingDirectory: effectiveWorkingDirectory || undefined,
          workflowContext: {
            frontendSessionId: sessionIdForAgents || null,
            collaborationTopic: activeSession?.title || '对话',
            collaborationSpeaker: agentName,
            collaborationMode: responseMode,
            collaborationParticipants: participantNames,
            mentionedAgents,
            mentionsDefaultAssistant,
            routingInstruction: '先组织语言判断本轮是否需要你回应；如果消息里 @ 了其他 Agent，请在回复中自然承接并可继续点名。',
          },
          temporaryRoleConfig: participant?.systemPrompt || participant?.personaPrompt ? {
            systemPrompt: [participant.systemPrompt, participant.personaPrompt].filter(Boolean).join('\n'),
            engine: participant.engine || undefined,
            model: participant.model || undefined,
          } : undefined,
        } as any);
        let stoppedByUser = false;
        let resolveStoppedStream: (() => void) | null = null;
        const stopAgentStream = async () => {
          stoppedByUser = true;
          try {
            await agentApi.stopChatStream(runtimeName, { streamId: stream.streamId });
          } catch {}
          await updateSessionMessage(sessionIdForAgents!, assistantMessageId, {
            content: '已停止',
            rawContent: undefined,
          });
          try { stream.events.close(); } catch {}
          resolveStoppedStream?.();
        };
        activeAgentStopsRef.current.push(stopAgentStream);

        await new Promise<void>((resolve) => {
          resolveStoppedStream = resolve;
          let accumulated = '';
          let accumulatedRawStream = '';
          let settled = false;
          let aiPrevious: Pick<AceStreamChunk, 'id' | 'content' | 'toolCalls'> | undefined;
          const close = () => {
            try { stream.events.close(); } catch {}
          };
          const finish = () => {
            if (settled) return;
            settled = true;
            activeAgentStopsRef.current = activeAgentStopsRef.current.filter((stop) => stop !== stopAgentStream);
            resolveStoppedStream = null;
            close();
            resolve();
          };
          const applyPartial = (content: string) => {
            accumulated = appendStreamChunk(accumulated, content);
            accumulatedRawStream = appendStreamChunk(accumulatedRawStream, content);
            const { text: parsedText } = parseActions(accumulated);
            const cleanText = normalizeAssistantDisplay(accumulated, true).visibleText || parsedText;
            void updateSessionMessage(sessionIdForAgents!, assistantMessageId, {
              content: cleanText,
              rawContent: accumulatedRawStream,
            });
          };

          stream.events.addEventListener('thinking', ((event: MessageEvent) => {
            const data = parseAceSseEventData(event.data);
            const content = String(data?.content || '');
            const row = storeChatStreamSseEventAsAgentMessage('thinking', data, {
              chatId: stream.streamId,
              stepKey: agentName,
              provider: data?.engine || participant?.engine,
              model: data?.model || participant?.model,
              sessionId: data?.sessionId,
              streamScope: 'agent-chat',
            }, aiPrevious);
            aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
            if (content) applyPartial(content);
          }) as EventListener);

          stream.events.addEventListener('delta', ((event: MessageEvent) => {
            const data = parseAceSseEventData(event.data);
            const content = String(data?.content || '');
            const row = storeChatStreamSseEventAsAgentMessage('delta', data, {
              chatId: stream.streamId,
              stepKey: agentName,
              provider: data?.engine || participant?.engine,
              model: data?.model || participant?.model,
              sessionId: data?.sessionId,
              streamScope: 'agent-chat',
            }, aiPrevious);
            aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
            if (content) applyPartial(content);
          }) as EventListener);

          stream.events.addEventListener('done', ((event: MessageEvent) => {
            const data = parseAceSseEventData(event.data);
            const resultText = String(data?.rawOutput || data?.output || data?.error || '');
            const fullRawContent = buildFinalRawContent(accumulatedRawStream, accumulated, resultText);
            const { text: cleanText, cards, sidebarHints } = parseActions(fullRawContent);
            const latestSidebarHint = sidebarHints[sidebarHints.length - 1];
            void updateSessionMessage(sessionIdForAgents!, assistantMessageId, {
              role: data?.isError ? 'error' as const : 'assistant' as const,
              content: cleanText || data?.output || data?.error || accumulated || '',
              rawContent: fullRawContent !== cleanText ? fullRawContent : undefined,
              cards: cards.length > 0 ? cards : [{
                type: 'collaboration_speech',
                speakerName: agentName,
                speakerType: 'agent',
                actionLabel: 'Agent',
                avatar: (availableMentionAgents.find((item) => item.name === agentName) as any)?.avatar,
                team: (availableMentionAgents.find((item) => item.name === agentName) as any)?.team,
                roleType: (availableMentionAgents.find((item) => item.name === agentName) as any)?.roleType,
              }],
              engine: data?.engine || participant?.engine || undefined,
              model: data?.model || participant?.model || undefined,
            });
            const row = storeChatStreamSseEventAsAgentMessage('done', {
              ...data,
              content: fullRawContent || data?.output || data?.error || accumulated || '',
            }, {
              chatId: stream.streamId,
              stepKey: agentName,
              provider: data?.engine || participant?.engine,
              model: data?.model || participant?.model,
              sessionId: data?.sessionId,
              streamScope: 'agent-chat',
            }, aiPrevious);
            aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
            if (latestSidebarHint) {
              setSessionWorkbenchState((prev) => ({
                ...(prev || {}),
                homeSidebar: latestSidebarHint,
              }));
            }
            finish();
          }) as EventListener);

          stream.events.addEventListener('failed', ((event: MessageEvent) => {
            const data = parseAceSseEventData(event.data);
            const messageText = String(data?.message || 'Agent 发言失败');
            void updateSessionMessage(sessionIdForAgents!, assistantMessageId, {
              role: 'error',
              content: accumulated || messageText,
              rawContent: accumulatedRawStream || accumulated || messageText,
            });
            finish();
          }) as EventListener);

          stream.events.addEventListener('engine_error', ((event: MessageEvent) => {
            const data = parseAceSseEventData(event.data);
            const messageText = String(data?.message || 'Agent 发言失败');
            void updateSessionMessage(sessionIdForAgents!, assistantMessageId, {
              role: 'error',
              content: accumulated || messageText,
              rawContent: accumulatedRawStream || accumulated || messageText,
            });
            finish();
          }) as EventListener);

          stream.events.onerror = () => {
            if (stoppedByUser) {
              finish();
              return;
            }
            void updateSessionMessage(sessionIdForAgents!, assistantMessageId, {
              role: 'error',
              content: accumulated || 'Agent 发言连接中断',
              rawContent: accumulatedRawStream || accumulated || 'Agent 发言连接中断',
            });
            finish();
          };
        });
      } catch (error: any) {
        await updateSessionMessage(sessionIdForAgents!, assistantMessageId, {
          role: 'error',
          content: error?.message || `${agentName} 回复失败`,
        });
      } finally {
        unmarkSessionStreaming(sessionIdForAgents);
        setStreamingMessageId(null);
      }
    };

    for (const agentName of targetNames) {
      await runAgentStream(agentName);
    }
    return true;
  }, [
    activeSession,
    activeSessionId,
    appendSessionMessage,
    availableMentionAgents,
    collaborationRoomCore.participants,
    collaborationRoomCore.responseMode,
    createSession,
    effectiveWorkingDirectory,
    sendMessage,
    setActiveSessionId,
    setSessionWorkbenchState,
  ]);

  const submitMessage = useCallback(async (text: string) => {
    const normalized = text.trim();
    if (!normalized && !pendingAttachment) return;
    if (attachmentUploading) {
      toast('warning', '附件上传中，请稍候再发送');
      return;
    }
    const attachmentContext = pendingAttachment
      ? [
          '',
          '附件：',
          `- 文件名：${pendingAttachment.name}`,
          `- 工作区路径：${pendingAttachment.path}`,
          `- 大小：${formatAttachmentSize(pendingAttachment.size)}`,
          '',
          '请在需要读取附件时使用上面的工作区路径。',
        ].join('\n')
      : '';
    const messageToSend = [normalized, attachmentContext].filter(Boolean).join('\n');
    const displayMessage = pendingAttachment
      ? [normalized || '请查看附件', `\n[附件] ${pendingAttachment.name} (${formatAttachmentSize(pendingAttachment.size)})`].join('\n')
      : normalized;
    const shouldOpenWorkflowCreator = shouldOpenAiWorkflowCreatorFromConversation(normalized, {
      creationAssistantEnabled: creationAssistantDefaultEnabled,
      sessionCreationAssistantEnabled: activeSession?.sessionWorkbenchState?.creationAssistantEnabled,
      hasWorkflowBinding: Boolean(activeSession?.workflowBinding),
      hasAgentBinding: Boolean(activeSession?.agentBinding),
      hasCollaboration: hasCollaborationSidebarContext,
    });
    if (!pendingAttachment && shouldOpenWorkflowCreator) {
      openWorkflowCreator(normalized);
      return;
    }
    if (!pendingAttachment && normalized === '/compact') {
      if (loading) {
        toast('warning', '当前正在生成，请先停止后再压缩上下文');
        return;
      }
      unlockAutoScroll();
      setInput('');
      editorRef.current?.clear();
      setSlashMenuOpen(false);
      try {
        await compactActiveSession();
        toast('success', '上下文已压缩，后续对话会使用新的 session 接力');
      } catch (error: any) {
        toast('error', error?.message || '上下文压缩失败');
      } finally {
        editorRef.current?.focus();
      }
      return;
    }
    if (!isModelSelectionReady) {
      toast('warning', '模型配置加载中，请稍候再发送');
      return;
    }
    const targetSessionId = activeSessionId || activeSession?.id || createAndActivateSession({ title: '新对话' });
    if (!activeSessionId && !activeSession?.id) {
      setSidebarOpen(true);
      setSessionDirectoryView('conversation');
    }

    if (editingMessageId) {
      deleteMessage(editingMessageId);
      setEditingMessageId(null);
    }

    unlockAutoScroll();
    setInput('');
    setPendingAttachment(null);
    editorRef.current?.clear();

    if (await sendUnifiedAgentChatMessage(messageToSend)) {
      editorRef.current?.focus();
      return;
    }
    // Route to the collaboration handler only when one is explicitly mounted.
    if (hasCollaborationSidebarContext && collaborationMessageHandlerRef.current) {
      collaborationMessageHandlerRef.current(messageToSend);
      editorRef.current?.focus();
      return;
    }

    if (loading) {
      stopStreaming();
      await Promise.resolve();
    }
    await sendMessage(messageToSend, { displayText: displayMessage, targetSessionId });
    editorRef.current?.focus();
  }, [activeSession?.agentBinding, activeSession?.id, activeSession?.sessionWorkbenchState?.creationAssistantEnabled, activeSession?.workflowBinding, activeSessionId, attachmentUploading, compactActiveSession, createAndActivateSession, creationAssistantDefaultEnabled, deleteMessage, editingMessageId, hasCollaborationSidebarContext, isModelSelectionReady, loading, openWorkflowCreator, pendingAttachment, sendMessage, sendUnifiedAgentChatMessage, stopStreaming, toast, unlockAutoScroll]);

  const applySlashCommand = useCallback(async (commandId: string) => {
    if (commandId === 'compact') {
      setSlashMenuOpen(false);
      await submitMessage('/compact');
      return;
    }
    const command = homepageSlashCommands.find((item) => item.id === commandId);
    if (command?.prompt) {
      setSlashMenuOpen(false);
      await submitMessage(command.prompt);
    }
  }, [homepageSlashCommands, submitMessage]);

  const handleSend = useCallback(async () => {
    const text = getInputMarkdown();
    if (!text && !pendingAttachment) return;
    await submitMessage(text);
  }, [getInputMarkdown, pendingAttachment, submitMessage]);

  const handleEditorEnter = useCallback(async (text: string) => {
    const markdown = text.trim() || getInputMarkdown();
    if (!markdown && !pendingAttachment) return;
    if (slashMenuOpen && filteredSlashCommands.length > 0) {
      const index = Math.max(0, Math.min(slashActiveIndex, filteredSlashCommands.length - 1));
      await applySlashCommand(filteredSlashCommands[index].id);
      return;
    }
    await submitMessage(markdown);
  }, [applySlashCommand, filteredSlashCommands, getInputMarkdown, pendingAttachment, slashActiveIndex, slashMenuOpen, submitMessage]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    const handleKeydown = (event: KeyboardEvent) => {
      if (!slashMenuOpen || filteredSlashCommands.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashActiveIndex((prev) => (prev + 1) % filteredSlashCommands.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashActiveIndex((prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const index = Math.max(0, Math.min(slashActiveIndex, filteredSlashCommands.length - 1));
        void applySlashCommand(filteredSlashCommands[index].id);
      } else if (event.key === 'Enter') {
        if (event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        const index = Math.max(0, Math.min(slashActiveIndex, filteredSlashCommands.length - 1));
        void applySlashCommand(filteredSlashCommands[index].id);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setSlashMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeydown, true);
    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
    };
  }, [applySlashCommand, filteredSlashCommands, slashActiveIndex, slashMenuOpen]);

  const handleCreateAgoraSession = useCallback(() => {
    createSession({
      title: '新议题',
      sessionWorkbenchState: createAgoraWorkbenchState('新议题'),
    });
    setSessionDirectoryView('conversation');
  }, [createSession]);

  const handleCreateAgoraGuest = useCallback(() => {
    setSidebarOpen(true);
    setSessionDirectoryView('conversation');
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('agora:create-guest'));
    }, 0);
  }, []);

  const decodeWorkflowActionFilename = useCallback((prompt: string, prefix: string) => {
    if (!prompt.startsWith(prefix)) return '';
    try {
      return decodeURIComponent(prompt.slice(prefix.length)).trim();
    } catch {
      return '';
    }
  }, []);

  const handleWorkflowOpenAction = useCallback((configFile: string) => {
    if (!configFile) {
      toast('warning', '缺少工作流配置文件');
      return;
    }
    unlockAutoScroll();
    setInput('');
    editorRef.current?.clear();
    if (loading) stopStreaming();
    if (embedded && dockWorkspace) {
      dockWorkspace.openTab({
        id: `workbench:${configFile}:run:`,
        title: configFile,
        kind: 'workbench',
        config: configFile,
        mode: 'run',
        search: 'mode=run',
      });
      return;
    }
    router.push(`/workbench/${encodeURIComponent(configFile)}`);
  }, [dockWorkspace, embedded, loading, router, stopStreaming, toast, unlockAutoScroll]);

  const handleWorkflowStartAction = useCallback((configFile: string) => {
    if (!configFile) {
      toast('warning', '缺少工作流配置文件');
      return;
    }
    unlockAutoScroll();
    setInput('');
    editorRef.current?.clear();
    if (loading) stopStreaming();
    if (embedded && dockWorkspace) {
      dockWorkspace.openTab({
        id: `workbench:${configFile}:run:`,
        title: configFile,
        kind: 'workbench',
        config: configFile,
        mode: 'run',
        search: 'mode=run&autoStart=1',
      });
      return;
    }
    router.push(`/workbench/${encodeURIComponent(configFile)}?mode=run&autoStart=1`);
  }, [dockWorkspace, embedded, loading, router, stopStreaming, toast, unlockAutoScroll]);

  const handleQuickAction = useCallback((prompt: string) => {
    if (prompt.startsWith('__HOME_ACTION__:workflow_open:')) {
      const workflowOpenConfig = decodeWorkflowActionFilename(prompt, '__HOME_ACTION__:workflow_open:');
      handleWorkflowOpenAction(workflowOpenConfig);
      return;
    }

    if (prompt.startsWith('__HOME_ACTION__:workflow_start:')) {
      const workflowStartConfig = decodeWorkflowActionFilename(prompt, '__HOME_ACTION__:workflow_start:');
      handleWorkflowStartAction(workflowStartConfig);
      return;
    }

    if (isAiWorkflowCreatorAction(prompt)) {
      openWorkflowCreator();
      return;
    }

    if (isCodespecWorkflowCreatorAction(prompt)) {
      openWorkflowCreator(CODESPEC_WORKFLOW_CREATOR_REQUIREMENTS);
      return;
    }

    if (prompt === '__HOME_ACTION__:create_agent') {
      unlockAutoScroll();
      const agentPrompt = '我想创建一个负责【职责】的 Agent，服务于【场景】，请先帮我定义它的职责、风格、能力边界和输入输出。';
      setInput(agentPrompt);
      editorRef.current?.setContent(agentPrompt);
      editorRef.current?.focus();
      if (loading) stopStreaming();
      return;
    }

    // Plugin intent dispatch — let registered plugins handle their own actions
    if (prompt.startsWith('__HOME_ACTION__:')) {
      const actionId = prompt.replace('__HOME_ACTION__:', '');
      const handled = dispatchHomeAction(actionId, {
        createSession,
        setActiveSessionId,
        setHomeSidebarTab,
        setHomeSidebarMode,
        unlockAutoScroll,
        toast,
        workingDirectory: effectiveWorkingDirectory,
        stopStreaming,
      });
      if (handled) {
        unlockAutoScroll();
        setInput('');
        editorRef.current?.clear();
        return;
      }
    }

    if (prompt && prompt.includes('\n')) {
      setInput(prompt);
      editorRef.current?.focus();
      return;
    }

    if (prompt && !prompt.includes('\n')) {
      unlockAutoScroll();
      setInput('');
      editorRef.current?.clear();
      if (loading) stopStreaming();
      if (!activeSessionId && !activeSession) {
        setSidebarOpen(true);
        setSessionDirectoryView('conversation');
      }
      sendMessage(prompt);
    }
  }, [
    activeSession,
    activeSessionId,
    createSession,
    decodeWorkflowActionFilename,
    handleWorkflowOpenAction,
    handleWorkflowStartAction,
    loading,
    openHomeSidebar,
    openWorkflowCreator,
    sendMessage,
    setActiveSessionId,
    setHomeSidebarMode,
    setHomeSidebarTab,
    stopStreaming,
    toast,
    unlockAutoScroll,
    effectiveWorkingDirectory,
  ]);

  const handleDebugToggle = useCallback(async (checked: boolean) => {
    setDebugMode(checked);
    if (checked && !debugPrompt) {
      setDebugLoading(true);
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
        const res = await fetch('/api/chat/debug-prompt', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setDebugPrompt(data?.error ? `加载失败：${data.error}` : `加载失败：HTTP ${res.status}`);
          return;
        }
        if (typeof data?.prompt === 'string' && data.prompt.trim().length > 0) {
          setDebugPrompt(data.prompt);
          return;
        }
        if (typeof data?.error === 'string' && data.error.trim()) {
          setDebugPrompt(`加载失败：${data.error}`);
          return;
        }
        setDebugPrompt('未返回可显示的 System Prompt');
      } catch (error: any) {
        setDebugPrompt(`加载失败：${error?.message || '未知错误'}`);
      } finally {
        setDebugLoading(false);
      }
    }
  }, [debugPrompt]);

  useEffect(() => {
    if (!shouldHandleChatSearchParams) return;
    const starterAction = searchParams.get('starterAction');
    if (!starterAction || starterHandledRef.current) return;

    starterHandledRef.current = true;
    const sidebarTab = searchParams.get('sidebarTab');
    const existingSessionId = searchParams.get('sessionId');
    const targetSessionId = existingSessionId || resolveWorkflowCreatorSessionId({
      activeSessionId,
      activeSessionIdFallback: activeSession?.id,
    });
    if (existingSessionId) {
      const targetSession = sessions.find((session) => session.id === existingSessionId);
      if (targetSession) {
        setSessionDirectoryView('conversation');
      }
      setActiveSessionId(existingSessionId);
    }

    if (sidebarTab === 'agent' || sidebarTab === 'commander') {
      openHomeSidebar(sidebarTab);
    }

    if (starterAction === 'create_agent') {
      handleQuickAction('__HOME_ACTION__:create_agent');
    }
    if (isAiWorkflowCreatorStarterAction(starterAction)) {
      openWorkflowCreator(undefined, targetSessionId);
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('sessionId');
    nextParams.delete('starterAction');
    nextParams.delete('sidebarTab');
    nextParams.delete('sessionTitle');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [activeSession?.id, activeSessionId, handleQuickAction, openWorkflowCreator, pathname, router, searchParams, sessions, setActiveSessionId, shouldHandleChatSearchParams]);

  const messages = dbBackedActiveSession?.messages || [];
  const isCurrentSessionLoading = Boolean(activeSessionId && sessionLoadingId === activeSessionId);
  const activeAiBusy = isChatAiBusy({
    loading,
    streamingMessageId,
    messages: messages as Array<{ workflowThinking?: boolean }>,
  });

  useEffect(() => {
    setHistoryExpanded(false);
  }, [activeSession?.id]);

  const handleEditMessage = useCallback((messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    lastEditSeedRef.current = null;
    setEditingMessageId(messageId);
    setEditContent(msg.content);
    setEditDialogOpen(true);
  }, [messages]);

  const handleConfirmEdit = useCallback(async () => {
    const text = getEditMarkdown();
    if (!editingMessageId || !text) return;

    // Delete the original message and any subsequent messages
    const msgIndex = messages.findIndex(m => m.id === editingMessageId);
    if (msgIndex !== -1) {
      const messagesToDelete = messages.slice(msgIndex);
      for (const msg of messagesToDelete) {
        if (msg.id) {
          deleteMessage(msg.id);
        }
      }
    }

    setEditDialogOpen(false);
    setEditingMessageId(null);
    setEditContent('');
    lastEditSeedRef.current = null;
    editEditorRef.current?.clear();
    await sendMessage(text);
  }, [getEditMarkdown, editingMessageId, messages, deleteMessage, sendMessage]);

  const handleCancelEdit = useCallback(() => {
    setEditDialogOpen(false);
    setEditingMessageId(null);
    setEditContent('');
    lastEditSeedRef.current = null;
    editEditorRef.current?.clear();
  }, []);

  // Memoize message callbacks to prevent unnecessary re-renders
  const messageCallbacks = useMemo(() => {
    const callbacks: Record<string, {
      onConfirmAction: (id: string) => void;
      onRejectAction: (id: string) => void;
      onUndoAction: (id: string) => void;
      onRetryAction: (id: string) => void;
      onReloadActionResult: (id: string) => void;
    }> = {};
    messages.forEach(msg => {
      callbacks[msg.id] = {
        onConfirmAction: (id) => confirmAction(msg.id, id),
        onRejectAction: (id) => rejectAction(msg.id, id),
        onUndoAction: (id) => undoActionById(msg.id, id),
        onRetryAction: (id) => retryAction(msg.id, id),
        onReloadActionResult: (id) => reloadActionResult(msg.id, id),
      };
    });
    return callbacks;
  }, [messages, confirmAction, rejectAction, undoActionById, retryAction, reloadActionResult]);

  const handleQuoteMessage = useCallback((messageId: string) => {
    const message = messages.find((item) => item.id === messageId);
    if (!message) return;
    const collaborationCard = (message.cards || []).find((card: any) => card?.type === 'collaboration_speech');
    const speakerName = collaborationCard?.speakerName
      || (message.role === 'user' ? '用户' : message.role === 'assistant' ? 'AI' : '错误');
    const sourceText = String(message.content || message.rawContent || '').trim();
    if (!sourceText) return;
    const quotedText = sourceText
      .replace(/\r\n/g, '\n')
      .split('\n')
      .slice(0, 30)
      .map((line) => `> ${line}`)
      .join('\n');
    const prefix = editorRef.current?.isEmpty() ? '' : '\n\n';
    const quoteMarkdown = `${prefix}> **${speakerName}：**\n${quotedText}\n\n`;
    editorRef.current?.insertMarkdown(quoteMarkdown);
    editorRef.current?.focus();
  }, [messages]);

  const handleInsertIntoMainInput = useCallback((markdown: string) => {
    const content = String(markdown || '').trim();
    if (!content) return;
    const prefix = editorRef.current?.isEmpty() ? '' : '\n\n';
    editorRef.current?.insertMarkdown(`${prefix}${content}`);
    editorRef.current?.focus();
  }, []);

  const ensureChatSessionForComposer = useCallback((): string => {
    const existing = activeSessionId || activeSession?.id || autoCreatedSessionIdRef.current;
    if (existing) return existing;
    const nextSessionId = createAndActivateSession({ title: '新对话' });
    autoCreatedSessionIdRef.current = nextSessionId;
    setSidebarOpen(true);
    setSessionDirectoryView('conversation');
    return nextSessionId;
  }, [activeSession?.id, activeSessionId, createAndActivateSession]);

  const ensureAttachmentWorkspace = useCallback(async (): Promise<string> => {
    const targetSessionId = ensureChatSessionForComposer();

    const existingWorkspace = targetSessionId === activeSessionId
      ? String(activeSession?.sessionWorkbenchState?.chatWorkspace?.workingDirectory || '').trim()
      : '';
    if (existingWorkspace) return existingWorkspace;

    const result = await agoraApi.ensureWorkspace({
      sessionId: targetSessionId,
      sourceWorkspace: fallbackWorkingDirectory || undefined,
      title: activeSession?.title?.trim() || '新对话',
      skills: skillSettings,
      mcpServers: mcpSettings,
      purpose: 'chat',
    });
    if (!result.workspacePath) throw new Error('准备对话工作区失败');
    setSessionWorkbenchState((prev) => ({
      ...(prev || {}),
      chatWorkspace: {
        ...(prev?.chatWorkspace || {}),
        workingDirectory: result.workspacePath,
        sourceWorkspace: result.sourceWorkspace || fallbackWorkingDirectory || prev?.chatWorkspace?.sourceWorkspace,
        autoCreated: result.created,
        gitBaselineReady: true,
        updatedAt: Date.now(),
      },
    }));
    setWorkingDirectory(result.workspacePath);
    return result.workspacePath;
  }, [
    activeSession?.id,
    activeSession?.sessionWorkbenchState?.chatWorkspace?.workingDirectory,
    activeSession?.title,
    activeSessionId,
    ensureChatSessionForComposer,
    fallbackWorkingDirectory,
    mcpSettings,
    setSessionWorkbenchState,
    setWorkingDirectory,
    skillSettings,
  ]);

  const uploadChatAttachment = useCallback(async (file: File) => {
    if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
      toast('warning', `文件超过 ${formatAttachmentSize(CHAT_ATTACHMENT_MAX_BYTES)} 限制`);
      return;
    }
    setAttachmentUploading(true);
    try {
      const workspace = await ensureAttachmentWorkspace();
      const result = await workspaceApi.upload(workspace, CHAT_ATTACHMENT_UPLOAD_DIR, [file], {
        conflict: 'rename',
        relativePaths: [file.name],
      });
      const saved = result.files[0];
      if (!saved?.path) throw new Error('上传结果缺少文件路径');
      setPendingAttachment({
        name: saved.name || file.name,
        path: saved.path,
        size: saved.size || file.size,
        workspace,
      });
      toast('success', `已添加附件：${saved.name || file.name}`);
      requestAnimationFrame(() => editorRef.current?.focus());
    } catch (error: any) {
      toast('error', error?.message || '附件上传失败');
    } finally {
      setAttachmentUploading(false);
    }
  }, [ensureAttachmentWorkspace, toast]);

  const handleComposerDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDroppedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setFileDropActive(true);
  }, []);

  const handleComposerDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDroppedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setFileDropActive(true);
  }, []);

  const handleComposerDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setFileDropActive(false);
  }, []);

  const handleComposerDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDroppedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setFileDropActive(false);
    const directoryEntry = getDroppedDirectoryEntry(event.dataTransfer);
    if (directoryEntry) {
      toast('warning', '首页对话附件暂只支持单个文件，不支持文件夹');
      return;
    }
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length !== 1) {
      toast('warning', '一次只能添加一个附件文件');
      return;
    }
    void uploadChatAttachment(files[0]);
  }, [toast, uploadChatAttachment]);

  const handleComposerPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (files.length !== 1) {
      toast('warning', '一次只能添加一个附件文件');
      return;
    }
    void uploadChatAttachment(files[0]);
  }, [toast, uploadChatAttachment]);

  const handleComposerFocus = useCallback(() => {
    ensureChatSessionForComposer();
  }, [ensureChatSessionForComposer]);

  const composerDropProps = useMemo(() => ({
    onDragEnterCapture: handleComposerDragEnter,
    onDragOverCapture: handleComposerDragOver,
    onDragLeave: handleComposerDragLeave,
    onDropCapture: handleComposerDrop,
    onPasteCapture: handleComposerPaste,
    onFocusCapture: handleComposerFocus,
  }), [handleComposerDragEnter, handleComposerDragLeave, handleComposerDragOver, handleComposerDrop, handleComposerFocus, handleComposerPaste]);

  const fileDropOverlay = fileDropActive ? (
    <div className="pointer-events-none absolute inset-0 z-[140] flex items-center justify-center gap-2 rounded-xl border border-[#8B5CF6]/30 bg-[#EEE7FF]/80 text-sm font-medium text-[#151515] dark:bg-violet-500/15 dark:text-violet-100">
      <span className="material-symbols-outlined text-[22px]">drive_folder_upload</span>
      松开后添加附件
    </div>
  ) : null;

  const pendingAttachmentPart = useMemo<AttachmentData | null>(() => {
    if (attachmentUploading) {
      return {
        filename: '上传中...',
        id: 'uploading',
        mediaType: 'application/octet-stream',
        status: 'uploading',
        type: 'file',
        url: '',
      };
    }
    if (!pendingAttachment) return null;
    return {
      filename: pendingAttachment.name,
      id: pendingAttachment.path,
      mediaType: 'workspace/file',
      size: pendingAttachment.size,
      status: 'uploaded',
      type: 'file',
      url: pendingAttachment.path,
    };
  }, [attachmentUploading, pendingAttachment]);

  const isChatroomCentralTranscript = Boolean(activeSession?.sessionWorkbenchState?.collaborationRoom?.chatroom);
  const recentWindowSize = useMemo(() => computeAdaptiveRecentWindow(messages as any[], {
    streamingMessageId,
    ...(isChatroomCentralTranscript
      ? { minRecentMessages: 100, maxRecentMessages: 100, targetWeight: Number.MAX_SAFE_INTEGER }
      : {}),
  }), [messages, streamingMessageId, isChatroomCentralTranscript]);

  const renderedMessages = useMemo(() => {
    const hiddenCount = Math.max(0, messages.length - recentWindowSize);
    return messages.map((msg, index) => {
      // 折叠区域的消息：用轻量占位符，不做 Markdown 解析
      if (index < hiddenCount && !historyExpanded) {
        return (
          <div key={msg.id} className="px-4 py-2 text-xs text-muted-foreground truncate">
            {msg.role === 'user' ? '👤 ' : '🤖 '}
            {(msg.content || '').slice(0, 120)}
          </div>
        );
      }
      // assistant 消息：隐藏 <result> 机器通道。streaming 阶段只展示普通正文；
      // 非 streaming 阶段再结合解析结果驱动侧边栏/卡片等结构化行为。
      const isStreaming = msg.id === streamingMessageId;
      let displayMsg = msg;
      let hasSidebarHint = false;
      if (msg.role === 'assistant') {
        const raw = msg.rawContent || msg.content || '';
        const normalized = normalizeAssistantDisplay(raw, isStreaming);
        hasSidebarHint = normalized.hasSidebarHint;
        if (normalized.hasMachineResult) {
          displayMsg = { ...msg, content: normalized.visibleText };
        }
      }
      return (
        <div key={msg.id} className="pb-4">
          <ChatMessage
            message={displayMsg}
            isStreaming={isStreaming}
            onConfirmAction={messageCallbacks[msg.id]?.onConfirmAction}
            onRejectAction={messageCallbacks[msg.id]?.onRejectAction}
            onUndoAction={messageCallbacks[msg.id]?.onUndoAction}
            onRetryAction={messageCallbacks[msg.id]?.onRetryAction}
            onReloadActionResult={messageCallbacks[msg.id]?.onReloadActionResult}
            onAction={handleQuickAction}
            onDelete={deleteMessage}
            onRetryFromMessage={msg.role === 'user' ? retryFromMessage : undefined}
            onEditMessage={msg.role === 'user' ? handleEditMessage : undefined}
            onContinue={msg.role === 'error' ? continueFromMessage : undefined}
            onSaveAsNotebook={msg.role === 'assistant' ? handleSaveAssistantMessageAsNotebook : undefined}
            onQuoteMessage={handleQuoteMessage}
            currentUser={currentUser}
          />
          {hasSidebarHint && (
            <div className="mt-2 ml-10">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium text-primary">
                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>side_navigation</span>
                已推送侧边栏
              </span>
            </div>
          )}
        </div>
      );
    });
  }, [messages, streamingMessageId, recentWindowSize, historyExpanded, messageCallbacks, handleQuickAction, deleteMessage, retryFromMessage, handleEditMessage, continueFromMessage, handleSaveAssistantMessageAsNotebook, handleQuoteMessage]);
  const hiddenMessageCount = Math.max(0, messages.length - recentWindowSize);
  const historicalMessageItems = useMemo(() => (
    hiddenMessageCount > 0
      ? messages.slice(0, hiddenMessageCount).map((message, index) => ({
        key: message.id,
        node: renderedMessages[index],
      }))
      : []
  ), [hiddenMessageCount, messages, renderedMessages]);
  const recentMessageItems = useMemo(() => (
    hiddenMessageCount > 0
      ? messages.slice(-recentWindowSize).map((message, index) => ({
        key: message.id,
        node: renderedMessages[hiddenMessageCount + index],
      }))
      : messages.map((message, index) => ({
        key: message.id,
        node: renderedMessages[index],
      }))
  ), [hiddenMessageCount, messages, recentWindowSize, renderedMessages]);
  const historicalMessages = useMemo(
    () => (hiddenMessageCount > 0 ? renderedMessages.slice(0, hiddenMessageCount) : []),
    [hiddenMessageCount, renderedMessages]
  );

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    const pending = pendingHistoryScrollAdjustRef.current;
    if (!scroller || !pending) return;
    pendingHistoryScrollAdjustRef.current = null;
    const nextScrollHeight = scroller.scrollHeight;
    const delta = nextScrollHeight - pending.prevScrollHeight;
    if (Math.abs(delta) < 1) return;
    scroller.scrollTop = Math.max(0, pending.prevScrollTop + delta);
  }, [historyExpanded, hiddenMessageCount]);

  const activeWeChatBinding = activeSession?.sessionWorkbenchState?.wechatBinding;
  const sessionChatWorkspace = activeSession?.sessionWorkbenchState?.chatWorkspace;
  const pinnedChatWorkspacePath = activeChatWorkspacePath;
  const defaultChatWorkspacePath = fallbackWorkingDirectory;
  const resolvedChatWorkspacePath = pinnedChatWorkspacePath;
  const chatWorkspaceShellEnabled = Boolean(activeSessionId || activeSession);
  const chatWorkspaceTitle = activeSession?.title?.trim() || '新对话';
  const chatWorkspaceSyncKey = useMemo(() => JSON.stringify({
    skills: skillSettings,
    mcpServers: mcpSettings,
  }), [mcpSettings, skillSettings]);
  const lastChatWorkspaceEnsureRef = useRef('');

  useEffect(() => {
    if (!activeSessionId || isBuiltInAgoraMode) return;
    const ensureKey = JSON.stringify({
      sessionId: activeSessionId,
      workspacePath: resolvedChatWorkspacePath,
      title: chatWorkspaceTitle,
      runtime: chatWorkspaceSyncKey,
    });
    if (lastChatWorkspaceEnsureRef.current === ensureKey) return;
    lastChatWorkspaceEnsureRef.current = ensureKey;

    let cancelled = false;
    agoraApi.ensureWorkspace({
      sessionId: activeSessionId,
      sourceWorkspace: defaultChatWorkspacePath || undefined,
      targetWorkspace: pinnedChatWorkspacePath || undefined,
      title: chatWorkspaceTitle,
      skills: skillSettings,
      mcpServers: mcpSettings,
      purpose: 'chat',
    })
      .then((result) => {
        if (cancelled || !result.workspacePath) return;
        setSessionWorkbenchState((prev) => {
          const current = prev?.chatWorkspace || null;
          if (
            current?.workingDirectory === result.workspacePath
            && current.gitBaselineReady
            && current.sourceWorkspace === (result.sourceWorkspace || defaultChatWorkspacePath || current.sourceWorkspace)
          ) {
            return prev || { chatWorkspace: current };
          }
          return {
            ...(prev || {}),
            chatWorkspace: {
              ...(current || {}),
              workingDirectory: result.workspacePath,
              sourceWorkspace: result.sourceWorkspace || defaultChatWorkspacePath || current?.sourceWorkspace,
              autoCreated: current?.autoCreated ?? result.created,
              gitBaselineReady: true,
              updatedAt: Date.now(),
            },
          };
        });
        setWorkingDirectory(result.workspacePath);
      })
      .catch((error: any) => {
        if (!cancelled) toast('warning', error?.message || '准备对话工作区失败');
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeSessionId,
    chatWorkspaceSyncKey,
    chatWorkspaceTitle,
    defaultChatWorkspacePath,
    isBuiltInAgoraMode,
    mcpSettings,
    resolvedChatWorkspacePath,
    setSessionWorkbenchState,
    setWorkingDirectory,
    skillSettings,
    toast,
  ]);

  useEffect(() => {
    if (!chatWorkspaceShellEnabled) {
      setChatWorkspaceActiveTab('chat');
      return;
    }
    if (chatWorkspaceActiveTab === 'chat') return;
    if (resolvedChatWorkspacePath) return;
    setChatWorkspaceActiveTab('chat');
  }, [chatWorkspaceActiveTab, chatWorkspaceShellEnabled, resolvedChatWorkspacePath]);

  const performSaveChatWorkspacePath = useCallback(async (nextPath: string, cleanup?: { sessionId: string; workspacePath: string; shouldDelete: boolean }) => {
    if (!activeSessionId) return;
    setChatWorkspaceSaving(true);
    try {
      const result = await agoraApi.ensureWorkspace({
        sessionId: activeSessionId,
        sourceWorkspace: defaultChatWorkspacePath || undefined,
        targetWorkspace: nextPath || undefined,
        title: chatWorkspaceTitle,
        skills: skillSettings,
        mcpServers: mcpSettings,
        purpose: 'chat',
      });
      setSessionWorkbenchState((prev) => ({
        ...(prev || {}),
        chatWorkspace: {
          ...(prev?.chatWorkspace || {}),
          workingDirectory: result.workspacePath,
          sourceWorkspace: result.sourceWorkspace || defaultChatWorkspacePath || prev?.chatWorkspace?.sourceWorkspace,
          autoCreated: result.created,
          gitBaselineReady: true,
          updatedAt: Date.now(),
        },
      }));
      setWorkingDirectory(result.workspacePath);
      setChatWorkspaceDialogOpen(false);
      setChatWorkspaceCleanupConfirm(null);
      toast('success', '已切换对话工作区');
      if (cleanup?.shouldDelete) {
        try {
          await agoraApi.deleteWorkspace({
            sessionId: cleanup.sessionId,
            workspacePath: cleanup.workspacePath,
          });
          toast('success', '已删除旧的系统工作目录');
        } catch (error: any) {
          toast('error', error?.message || '旧工作目录删除失败，请手动检查');
        }
      }
    } catch (error: any) {
      toast('error', error?.message || '切换对话工作区失败');
    } finally {
      setChatWorkspaceSaving(false);
    }
  }, [activeSessionId, chatWorkspaceTitle, defaultChatWorkspacePath, mcpSettings, setSessionWorkbenchState, setWorkingDirectory, skillSettings, toast]);

  const handleSaveChatWorkspacePath = useCallback(async () => {
    if (!activeSessionId) return;
    const nextPath = chatWorkspaceDraft.trim();
    const currentWorkspace = activeSession?.sessionWorkbenchState?.chatWorkspace;
    const previousPath = String(currentWorkspace?.workingDirectory || '').trim();
    const isChangingPath = normalizePathForCompare(previousPath) !== normalizePathForCompare(nextPath);
    if (currentWorkspace?.autoCreated && previousPath && isChangingPath) {
      setDeletePreviousChatWorkspace(true);
      setChatWorkspaceCleanupConfirm({
        sessionId: activeSessionId,
        workspacePath: previousPath,
        nextPath,
      });
      return;
    }
    await performSaveChatWorkspacePath(nextPath);
  }, [activeSession?.sessionWorkbenchState?.chatWorkspace, activeSessionId, chatWorkspaceDraft, performSaveChatWorkspacePath]);

  const resetChatWorkspacePath = useCallback(() => {
    setSessionWorkbenchState((prev) => ({
      ...(prev || {}),
      chatWorkspace: null,
    }));
    setChatWorkspaceDialogOpen(false);
    setChatWorkspaceDraft('');
    toast('success', '已恢复会话默认工作区');
  }, [defaultChatWorkspacePath, setSessionWorkbenchState, toast]);

  const activeAgentAvatarSrc = activeAgentBinding
    ? resolveAgentAvatarSrc(undefined, activeAgentBinding.agentName, {
        team: activeAgentBinding.team || 'red',
        roleType: activeAgentBinding.roleType || 'normal',
      })
    : null;
  const handleForkFromSessionMenu = useCallback(() => {
    if (!activeSession) return;
    if (loading) {
      toast('warning', '当前正在生成，请稍后创建 Fork');
      return;
    }
    const sourceWorkbenchState = activeSession.sessionWorkbenchState;
    const forkOptions = {
      ...buildForkSessionOptions(activeSession),
      ...(sourceWorkbenchState?.collaborationRoom
        ? { sessionWorkbenchState: createForkedCollaborationWorkbenchState(sourceWorkbenchState) }
        : {}),
    };
    const sessionId = createAndActivateSession(forkOptions);
    toast('success', '已创建 Fork');
    return sessionId;
  }, [activeSession, createAndActivateSession, loading, toast]);
  const handleCreationAssistantChange = useCallback((enabled: boolean) => {
    setCreationAssistantDefaultEnabled(enabled);
  }, [setCreationAssistantDefaultEnabled]);
  const chatHeaderStatus = activeAiBusy || isCurrentSessionLoading
    ? <StatusPill tone="neutral">生成中</StatusPill>
    : activeWeChatBinding
      ? <StatusPill tone="success">微信已绑定</StatusPill>
      : activeSession
        ? <StatusPill tone="neutral">{messages.length} 消息</StatusPill>
        : <StatusPill tone="neutral">未选择会话</StatusPill>;
  const { isDashboardShell } = useDashboardShellHeader({
    title: chatTitle === '首页' ? '对话' : chatTitle,
    subtitle: activeAgentBinding
      ? `当前角色：${activeAgentBinding.agentName}`
      : activeWeChatBinding
        ? `微信 Bot：${activeWeChatBinding.externalConversationId}`
        : '首页对话、议场与工作流协作',
    actions: (
      <>
        {activeAgentBinding ? (
          <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-card/80 px-2 py-1 sm:flex">
            <SpriteAvatar
              avatar={activeAgentAvatarSrc}
              seed={activeAgentBinding.agentName}
              category="agent-default"
              alt={activeAgentBinding.agentName}
              fallback={activeAgentBinding.agentName.slice(0, 2).toUpperCase()}
              className="h-7 w-7 ring-1 ring-border/70"
            />
            <span className="max-w-40 truncate text-xs font-medium">{activeAgentBinding.agentName}</span>
            <Badge variant="outline" className={getAgentBindingBadgeClass(activeAgentBinding.team)}>
              {getAgentBindingTeamLabel(activeAgentBinding.team)}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-2 text-xs"
              onClick={handleCreateNewConversation}
            >
              退出角色
            </Button>
          </div>
        ) : null}
        <Button
          size="sm"
          variant={activeWeChatBinding ? 'default' : 'outline'}
          className="rounded-full"
          onClick={() => setWeChatBindDialogOpen(true)}
          title="绑定当前首页对话到微信 Bot"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px', marginRight: '4px' }}>forum</span>
          <span>微信 Bot</span>
          {activeWeChatBinding ? (
            <span className="ml-2 hidden max-w-28 truncate text-xs opacity-90 xl:inline">
              {activeWeChatBinding.externalConversationId}
            </span>
          ) : null}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSaveConversationAsNotebook}
          disabled={!activeSession || notebookExporting || messages.length === 0}
          title="保存当前会话为 Notebook"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px', marginRight: '4px' }}>note_add</span>
          <span className="hidden xl:inline">保存为 Notebook</span>
        </Button>
        <ChatSessionMenu
          creationAssistantEnabled={creationAssistantDefaultEnabled}
          creationAssistantDisabled={loading}
          forkDisabled={!activeSession || loading}
          onCreationAssistantChange={handleCreationAssistantChange}
          onFork={handleForkFromSessionMenu}
        />
      </>
    ),
  }, [
    activeAgentAvatarSrc,
    activeAgentBinding?.agentName,
    activeAgentBinding?.roleType,
    activeAgentBinding?.team,
    activeSession?.id,
    activeWeChatBinding?.externalConversationId,
    activeAiBusy,
    chatTitle,
    creationAssistantDefaultEnabled,
    handleCreationAssistantChange,
    handleCreateNewConversation,
    handleForkFromSessionMenu,
    handleSaveConversationAsNotebook,
    isCurrentSessionLoading,
    loading,
    messages.length,
    notebookExporting,
  ]);

  const agentPickerPanel = (
    <div
      className={cn(
        'hidden min-h-0 overflow-hidden rounded-xl border border-border bg-card transition-[width,height] duration-200 xl:flex',
        agentPickerOpen
          ? 'fixed bottom-24 right-6 top-20 z-[90] w-[22rem] flex-col shadow-lg'
          : 'absolute right-4 top-4 z-50 h-48 w-12 items-stretch shadow-none'
      )}
    >
      {agentPickerOpen ? (
        <>
          <div className="shrink-0 border-b border-border/60 bg-muted/25 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{agentPickerAdding ? '添加 Agent' : 'Agent'}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {agentPickerAdding ? '选择运行模型并加入当前对话' : `默认助手 + ${collaborationRoomCore.participants.length} 个 Agent`}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {agentPickerAdding ? (
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={() => setAgentPickerAdding(false)} title="返回成员">
                    <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                  </Button>
                ) : null}
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={() => {
                  setAgentPickerOpen(false);
                  setAgentPickerAdding(false);
                }} title="收起 Agent 面板">
                  <span className="material-symbols-outlined text-[18px]">right_panel_close</span>
                </Button>
              </div>
            </div>
            {agentPickerAdding ? (
              <div className="mt-3 space-y-2">
                <EngineModelSelect
                  engine={agentPickerRuntime.engine}
                  model={agentPickerRuntime.model}
                  onEngineChange={(nextEngine) => setAgentPickerRuntime((prev) => ({ ...prev, engine: nextEngine }))}
                  onModelChange={(nextModel) => setAgentPickerRuntime((prev) => ({ ...prev, model: nextModel }))}
                  className="h-9"
                />
                {!agentPickerCanAdd ? (
                  <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    模型配置加载完成后才能添加 Agent。
                  </div>
                ) : null}
                <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background px-3 py-2">
                  <span className="material-symbols-outlined text-[17px] text-muted-foreground">search</span>
                  <input
                    value={agentPickerQuery}
                    onChange={(event) => setAgentPickerQuery(event.target.value)}
                    placeholder="搜索 Agent"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div className="home-chat-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {agentPickerAdding ? (
              <div className="space-y-1">
                {filteredAgentPickerAgents.length ? filteredAgentPickerAgents.map((agent) => {
                  const name = String(agent.name || '').trim();
                  return (
                    <button
                      key={name}
                      type="button"
                      disabled={!agentPickerCanAdd}
                      className="group flex w-full items-center gap-2 rounded-xl p-2 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
                      onClick={() => addAgentToConversation(agent)}
                    >
                      <SpriteAvatar
                        avatar={resolveAgentAvatarSrc(undefined, name)}
                        seed={name}
                        category="agent-default"
                        alt={name}
                        fallback={getChatAgentInitials(name)}
                        className="h-8 w-8 shrink-0"
                        fallbackClassName="bg-primary/10 text-xs font-semibold text-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{agent.description || 'Agent'}</div>
                      </div>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                        <span className={cn('material-symbols-outlined text-[17px]', !agentPickerCanAdd && 'animate-spin')}>{agentPickerCanAdd ? 'add' : 'progress_activity'}</span>
                      </span>
                    </button>
                  );
                }) : (
                  <div className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
                    没有可加入的 Agent
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="rounded-xl border border-primary/15 bg-primary/5 p-2.5">
                  <div className="flex items-center gap-2">
                    <RobotLogo size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold">默认助手</div>
                      <div className="truncate text-[11px] text-muted-foreground">单人议场默认 Agent，普通对话能力完整保留</div>
                    </div>
                    <Badge variant="secondary" className="rounded-full text-[10px]">默认</Badge>
                  </div>
                </div>
                {collaborationRoomCore.participants.length ? collaborationRoomCore.participants.map((participant) => (
                  <div key={participant.id || participant.name} className="group flex items-center gap-2 rounded-xl bg-muted/35 p-2">
                    <SpriteAvatar
                      avatar={resolveAgentAvatarSrc(undefined, participant.runtimeAgentName || participant.name)}
                      seed={participant.runtimeAgentName || participant.name}
                      category="agent-default"
                      alt={participant.name}
                      fallback={getChatAgentInitials(participant.name)}
                      className="h-8 w-8 shrink-0"
                      fallbackClassName="bg-primary/10 text-xs font-semibold text-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{participant.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {participant.model ? [participant.engine, participant.model].filter(Boolean).join(' / ') : '跟随默认模型'}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      title="移除 Agent"
                      aria-label={`移除 ${participant.name}`}
                      onClick={() => removeAgentFromConversation(participant.name)}
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </Button>
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
                    还没有额外 Agent
                  </div>
                )}
              </div>
            )}
          </div>
          {!agentPickerAdding ? (
            <div className="shrink-0 border-t border-border/60 bg-background/95 p-2.5">
              <button
                type="button"
                disabled={!agentPickerCanAdd}
                className="group flex h-14 w-full items-center justify-between gap-3 overflow-hidden rounded-lg border border-border bg-card px-3 text-left shadow-none transition-colors hover:bg-muted/20 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card"
                onClick={() => setAgentPickerAdding(true)}
                title="添加成员"
                aria-label="添加成员"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground/80 shadow-none transition-transform group-hover:scale-105">
                    <span className={cn('material-symbols-outlined text-[18px]', !agentPickerCanAdd && 'animate-spin')}>
                      {agentPickerCanAdd ? 'group_add' : 'progress_activity'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium leading-none text-foreground">添加成员</div>
                    <div className="mt-1 truncate text-xs leading-none text-muted-foreground">
                      {agentPickerCanAdd ? `${filteredAgentPickerAgents.length} 个可加入 Agent` : '模型配置加载中...'}
                    </div>
                  </div>
                </div>
                <div className="ml-2 flex shrink-0 -space-x-2.5">
                  {filteredAgentPickerAgents.slice(0, 3).map((agent) => {
                    const name = String(agent.name || '').trim();
                    return (
                      <div key={`agent-picker-preview-${name}`} className="h-8 w-8 overflow-hidden rounded-full bg-muted shadow-sm ring-1 ring-background">
                        <SpriteAvatar
                          avatar={resolveAgentAvatarSrc(undefined, name)}
                          seed={name}
                          category="agent-default"
                          alt={name}
                          fallback={getChatAgentInitials(name)}
                          className="h-full w-full"
                          fallbackClassName="text-[10px] font-semibold text-muted-foreground"
                        />
                      </div>
                    );
                  })}
                  {filteredAgentPickerAgents.length > 3 ? (
                    <div className="relative z-0 flex h-8 w-8 items-center justify-center rounded-full bg-muted shadow-sm ring-1 ring-background">
                      <span className="text-xs font-normal leading-none text-muted-foreground">
                        +{filteredAgentPickerAgents.length - 3}
                      </span>
                    </div>
                  ) : null}
                </div>
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
          onClick={() => setAgentPickerOpen(true)}
          title="展开 Agent 面板"
        >
          <span className="material-symbols-outlined text-[22px]">group_add</span>
          <Badge variant="secondary" className="h-6 min-w-6 justify-center rounded-full px-1 text-[10px]">
            {collaborationRoomCore.participants.length + 1}
          </Badge>
          <span className="text-[11px] font-medium tracking-[0.18em]" style={{ writingMode: 'vertical-rl' }}>
            Agent
          </span>
        </button>
      )}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        embedded ? 'h-full min-h-0 flex overflow-hidden bg-background' : 'h-screen flex overflow-hidden bg-background',
      )}
      {...composerDropProps}
    >
      {/* Mobile overlay backdrop */}
      {!hideSidebar && isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-30" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Mobile sidebar */}
      {!hideSidebar && isMobile && sidebarOpen && (
        <div
          className="fixed inset-y-0 left-0 z-40 bg-background"
          style={{ width: `${Math.min(sidebarWidth, 320)}px` }}
        >
          <ChatSidebar
            sessionView={sessionDirectoryView}
            onSessionViewChange={setSessionDirectoryView}
          />
        </div>
      )}

      <ResizablePanelGroup
        orientation="horizontal"
        className="min-w-0 flex-1"
        onLayoutChanged={handlePrimarySidebarLayout}
      >
        {!hideSidebar && !isMobile && sidebarOpen ? (
          <>
            <ResizablePanel
              id="chat-primary-sidebar-panel"
              defaultSize={sidebarPixelsToPercent(sidebarWidth, containerRef.current?.getBoundingClientRect().width || 1200)}
              minSize={sidebarPixelsToPercent(MIN_WIDTH, containerRef.current?.getBoundingClientRect().width || 1200)}
              maxSize={sidebarPixelsToPercent(MAX_WIDTH, containerRef.current?.getBoundingClientRect().width || 1200)}
              className="min-w-0"
            >
              <ChatSidebar
                sessionView={sessionDirectoryView}
                onSessionViewChange={setSessionDirectoryView}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        ) : null}

        <ResizablePanel id="chat-primary-main-panel" defaultSize={100} minSize={35} className="min-w-0">
      <div className="flex h-full min-w-0 flex-col">
        {!isDashboardShell ? (
          <PageHeader
            className={cn(
              'shrink-0 bg-card px-4 py-3',
            )}
            eyebrow="Start"
            title={chatTitle === '首页' ? '对话' : chatTitle}
            subtitle={activeAgentBinding ? `当前角色：${activeAgentBinding.agentName}` : activeWeChatBinding ? `微信 Bot：${activeWeChatBinding.externalConversationId}` : '首页对话、议场与工作流协作'}
            status={chatHeaderStatus}
            leading={!hideSidebar ? (
              <Button size="icon" variant="outline" onClick={() => setSidebarOpen(p => !p)} title="切换侧边栏">
                <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>menu</span>
              </Button>
            ) : undefined}
            secondaryActions={(
              <>
              {activeAgentBinding ? (
                <div className="hidden sm:flex items-center gap-3 rounded-lg border border-border bg-background px-2 py-1.5">
                  <SpriteAvatar
                    avatar={activeAgentAvatarSrc}
                    seed={activeAgentBinding.agentName}
                    category="agent-default"
                    alt={activeAgentBinding.agentName}
                    fallback={activeAgentBinding.agentName.slice(0, 2).toUpperCase()}
                    className="h-8 w-8 ring-1 ring-border/70"
                  />
                  <div className="flex items-center gap-2">
                    <div className="text-xs">
                      <div className="font-medium text-foreground">当前对话角色：{activeAgentBinding.agentName}</div>
                    </div>
                    <Badge variant="outline" className={getAgentBindingBadgeClass(activeAgentBinding.team)}>
                      {getAgentBindingTeamLabel(activeAgentBinding.team)}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-md px-3 text-xs"
                    onClick={handleCreateNewConversation}
                  >
                    退出角色
                  </Button>
                </div>
              ) : null}
              <Button
                size="sm"
                variant={activeWeChatBinding ? 'secondary' : 'outline'}
                onClick={() => setWeChatBindDialogOpen(true)}
                title="绑定当前首页对话到微信 Bot"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px', marginRight: '4px' }}>forum</span>
                <span>微信 Bot</span>
                {activeWeChatBinding ? (
                  <span className="ml-2 hidden sm:inline text-xs opacity-90">
                    {activeWeChatBinding.externalConversationId}
                  </span>
                ) : null}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveConversationAsNotebook}
                disabled={!activeSession || notebookExporting || messages.length === 0}
                title="保存当前会话为 Notebook"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px', marginRight: '4px' }}>note_add</span>
                <span className="hidden sm:inline">保存为 Notebook</span>
              </Button>
              <ThemeToggle />
              {!embedded ? (
                <Button size="sm" variant="outline" onClick={() => router.push('/dashboard')} title="切换到数据中心">
                  <span className="material-symbols-outlined" style={{ fontSize: '20px', marginRight: '4px' }}>dashboard</span>
                  <span className="hidden sm:inline">数据中心</span>
                </Button>
              ) : null}
              <UserMenu user={currentUser} />
              </>
            )}
          />
        ) : null}

        <div className="flex-1 min-h-0" data-tour-step-id="home-chat-main">
          {renderDedicatedAgoraShell ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1">
                <AgoraShell
                  activeSessionId={activeSessionId}
                  sessionTitle={activeSession?.title}
                  sessionWorkbenchState={activeSession?.sessionWorkbenchState}
                  setSessionWorkbenchState={setSessionWorkbenchState}
                  appendSessionMessage={appendSessionMessage}
                  workingDirectory={effectiveWorkingDirectory}
                  onInsertIntoMainInput={handleInsertIntoMainInput}
                  onRegisterMainInputHandler={(handler: ((text: string) => void) | null) => { collaborationMessageHandlerRef.current = handler; }}
                  defaultMemberPanelCollapsed={!hasCollaborationParticipants}
                  fixedGuestPanel={embedded || hasWorkflowSidebarContext}
                  currentUser={currentUser}
                />
              </div>
              <div className="home-chat-input-tray shrink-0 border-t bg-[#F7F7F4] px-4 py-3 dark:bg-[#11111A] md:px-8 lg:px-16">
                <div className="mx-auto max-w-5xl">
                  <div
                    className="home-chat-composer relative overflow-hidden rounded-xl border border-border bg-card shadow-none"
                    data-tour-step-id="home-chat-composer"
                    {...composerDropProps}
                  >
                    {fileDropOverlay}
                    {pendingAttachmentPart ? (
                      <Attachments className="px-5 pt-4">
                        <Attachment
                          data={pendingAttachmentPart}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (pendingAttachment?.path) {
                              setAttachmentPreviewPath(`${pendingAttachment.workspace.replace(/\\/g, '/').replace(/\/+$/, '')}/${pendingAttachment.path.replace(/\\/g, '/')}`);
                            }
                          }}
                          onRemove={() => setPendingAttachment(null)}
                        />
                      </Attachments>
                    ) : null}
                    <RichTextEditor
                      ref={editorRef}
                      content={input}
                      onEnter={handleEditorEnter}
                      onChange={(markdown: string) => setInput(markdown)}
                      preferMarkdownPaste
                      placeholder="和群里的 Agent 继续聊"
                      minHeight={116}
                      maxHeight={220}
                      className="[&_.ProseMirror]:text-[15px] [&_.ProseMirror]:leading-6 [&_.ProseMirror]:text-foreground [&_.ProseMirror_p]:my-0.5 [&_.ProseMirror_h1]:!text-base [&_.ProseMirror_h2]:!text-sm"
                      disabled={false}
                      autoFocus={false}
                      showFullscreenToggle={false}
                      showToolbar={false}
                      mentionItems={mainInputMentionItems}
                      trimPastedTrailingNewlines
                      footerInside
                      surfaceClassName="rounded-xl border-0 bg-transparent shadow-none"
                      contentAreaClassName="min-h-[68px] items-start px-6 pb-2 pt-4"
                      footerClassName="justify-end gap-4 border-border/60 px-6 pb-3 pt-3"
                      footerAfterCountContent={(
                        <div className="ml-5 flex items-center gap-3">
                          <Button
                            variant={activeAiBusy ? 'destructive' : 'default'}
                            className="h-10 w-10 rounded-lg px-0 shadow-none transition-colors duration-150"
                            onClick={activeAiBusy ? stopActiveAiAction : handleSend}
                            disabled={!activeAiBusy && (attachmentUploading || !canSubmitMessage)}
                            title={activeAiBusy ? '停止生成' : '发送'}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                              {activeAiBusy ? 'stop' : 'subdirectory_arrow_left'}
                            </span>
                          </Button>
                        </div>
                      )}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
          <div className="flex h-full min-h-0 flex-col bg-[#F7F7F4] dark:bg-[#0D0E14]">
            {chatWorkspaceShellEnabled ? (
            <PageHeader
              className="h-auto shrink-0 bg-card px-5 py-3"
              title={chatWorkspaceTitle}
              status={chatHeaderStatus}
              leading={<span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-[#EEE7FF] text-[#8B5CF6] dark:bg-violet-500/10 dark:text-violet-300">#</span>}
              secondaryActions={(
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-md px-2.5 text-xs"
                  title="切换工作区"
                  aria-label="切换工作区"
                  onClick={() => {
                    setChatWorkspaceDraft(pinnedChatWorkspacePath || defaultChatWorkspacePath);
                    setChatWorkspaceDialogOpen(true);
                  }}
                >
                  <Settings2 className="mr-1.5 h-4 w-4" />
                  切换工作区
                </Button>
                <ChatSessionMenu
                  compact
                  creationAssistantEnabled={creationAssistantDefaultEnabled}
                  creationAssistantDisabled={loading}
                  forkDisabled={!activeSession || loading}
                  onCreationAssistantChange={handleCreationAssistantChange}
                  onFork={handleForkFromSessionMenu}
                />
              </div>
              )}
            />
            ) : null}

            <Tabs
              value={chatWorkspaceShellEnabled ? chatWorkspaceActiveTab : 'chat'}
              onValueChange={(value) => {
                if (!chatWorkspaceShellEnabled) return;
                setChatWorkspaceActiveTab(value);
              }}
              className="flex min-h-0 flex-1 flex-col"
            >
              {chatWorkspaceShellEnabled ? (
              <PageToolbar
                className="shrink-0 bg-card px-5 py-0"
                actions={(
                  <div className="hidden max-w-[44%] truncate text-xs text-muted-foreground md:block">
                    {resolvedChatWorkspacePath || '准备工作区...'}
                  </div>
                )}
              >
                <TabsList className="h-11 gap-5 rounded-none bg-transparent p-0">
                  <TabsTrigger value="chat" className="h-11 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-0 text-xs text-muted-foreground shadow-none data-[state=active]:border-[#8B5CF6] data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
                    <MessageSquareText className="h-4 w-4" />
                    聊天
                  </TabsTrigger>
                  <TabsTrigger value="workspace" className="h-11 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-0 text-xs text-muted-foreground shadow-none data-[state=active]:border-[#8B5CF6] data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
                    <FolderOpen className="h-4 w-4" />
                    工作区
                  </TabsTrigger>
                  <TabsTrigger value="changes" className="h-11 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-0 text-xs text-muted-foreground shadow-none data-[state=active]:border-[#8B5CF6] data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
                    <GitBranch className="h-4 w-4" />
                    变更
                  </TabsTrigger>
                </TabsList>
              </PageToolbar>
              ) : null}

              <TabsContent value="chat" className="relative mt-0 min-h-0 flex-1 overflow-visible">
          {(!chatWorkspaceShellEnabled || chatWorkspaceActiveTab === 'chat') ? (
          <>
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-full"
            onLayoutChanged={handleHomeSidebarLayout}
          >
            <ResizablePanel id="home-main-panel" defaultSize={homeSidebarMode === 'active' ? `${100 - homeSidebarSize}%` : '100%'} minSize="42%">
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex-1 relative min-h-0">
                  {embedded && hideSidebar && onOpenSecondarySidebar ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="absolute left-3 top-3 z-30 h-8 w-8 rounded-full bg-background/90 shadow-sm backdrop-blur hover:bg-background"
                      onClick={onOpenSecondarySidebar}
                      title={secondarySidebarPinned ? '收起会话中心' : '打开会话中心'}
                      aria-label={secondarySidebarPinned ? '收起会话中心' : '打开会话中心'}
                    >
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                        {secondarySidebarPinned ? 'left_panel_close' : 'left_panel_open'}
                      </span>
                    </Button>
                  ) : null}
                  <div
                    ref={scrollContainerRef}
                    className={cn(
                      'home-chat-scroll absolute inset-0 overflow-y-auto px-4 pb-6 pt-8 md:px-8 lg:px-16',
                    )}
                  >
                    {messages.length === 0 && isCurrentSessionLoading ? (
                      <div className="flex h-full items-center justify-center">
                        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                          <span className="material-symbols-outlined animate-spin text-base text-primary">progress_activity</span>
                          <span>正在加载对话...</span>
                        </div>
                      </div>
                    ) : showAgoraZenCover ? (
                      <AgoraZenCover
                        hasExistingTopics={hasExistingAgoraTopics}
                        onCreate={handleCreateAgoraSession}
                        onCreateGuest={handleCreateAgoraGuest}
                      />
                    ) : messages.length === 0 && !loading && (
                      <div className="flex h-full flex-col items-center justify-center gap-6 pt-14">
                        <EmptyState
                          className="w-full max-w-2xl border-border bg-card"
                          icon={<RobotLogo size={26} />}
                          title={activeAgentBinding?.agentName ? `与 ${activeAgentBinding.agentName} 对话` : '开始一个任务对话'}
                          description={activeAgentBinding?.agentName ? '当前会话已绑定 Agent，发送消息即可继续协作。' : `描述需求、附加文件，或从下方工具区继续操作。v${pkgJson.version}`}
                        />
                        <QuickActions onAction={handleQuickAction} skillSettings={skillSettings} slashCommands={engineSlashCommands} />
                      </div>
                    )}
                    <MessageHistoryCollapse
                      hiddenCount={hiddenMessageCount}
                      recentCount={recentWindowSize}
                      open={historyExpanded}
                      onOpenChange={(open) => {
                        const scroller = scrollContainerRef.current;
                        pendingHistoryScrollAdjustRef.current = scroller
                          ? { prevScrollHeight: scroller.scrollHeight, prevScrollTop: scroller.scrollTop }
                          : null;
                        setHistoryExpanded(open);
                      }}
                      hiddenContent={
                        historyExpanded
                          ? <VirtualMessageList items={historicalMessageItems} scrollContainerRef={scrollContainerRef} itemGap={0} />
                          : historicalMessages
                      }
                      recentContent={<VirtualMessageList items={recentMessageItems} scrollContainerRef={scrollContainerRef} itemGap={0} />}
                    />
                    <div ref={messagesEndRef} />
                  </div>
                  {showScrollBtn && (
                    <button
                      onClick={scrollToBottom}
                    className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors duration-150 hover:bg-muted"
                    >
                      <span className="material-symbols-outlined text-primary" style={{ fontSize: '16px' }}>arrow_downward</span>
                      新消息
                    </button>
                  )}
                </div>

                {!showAgoraZenCover ? (
                  <div
                    className={cn(
                      'home-chat-input-tray relative z-30 shrink-0 isolate border-t bg-[#F7F7F4] px-4 py-3 dark:bg-[#11111A] md:px-8 lg:px-16',
                    )}
                  >
                    {messages.length > 0 && (
                      <div className="mx-auto mb-2 max-w-5xl rounded-lg border border-border bg-card px-1 py-1">
                        <QuickActionsBar onAction={handleQuickAction} skillSettings={skillSettings} slashCommands={engineSlashCommands} />
                      </div>
                    )}
                    <div className="mx-auto max-w-5xl">
                      <div
                        className="home-chat-composer relative z-10 rounded-xl border border-border bg-card shadow-none"
                        data-tour-step-id="home-chat-composer"
                        {...composerDropProps}
                      >
                        {fileDropOverlay}
                        {pendingAttachmentPart ? (
                          <Attachments className="px-5 pt-4">
                            <Attachment
                              data={pendingAttachmentPart}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (pendingAttachment?.path) {
                                  setAttachmentPreviewPath(`${pendingAttachment.workspace.replace(/\\/g, '/').replace(/\/+$/, '')}/${pendingAttachment.path.replace(/\\/g, '/')}`);
                                }
                              }}
                              onRemove={() => setPendingAttachment(null)}
                            />
                          </Attachments>
                        ) : null}
                        {slashMenuOpen ? (
                          <div className="absolute bottom-[calc(100%+8px)] left-0 z-[120] w-[320px] overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-xl">
                            <PromptInputCommand className="bg-transparent">
                              <PromptInputCommandList className="max-h-64 p-1">
                                <PromptInputCommandEmpty>无匹配命令</PromptInputCommandEmpty>
                                <PromptInputCommandGroup heading="命令">
                                  {filteredSlashCommands.map((item, index) => (
                                    <PromptInputCommandItem
                                      key={item.id}
                                      ref={(node) => {
                                        slashItemRefs.current[index] = node;
                                      }}
                                      value={`${item.command} ${item.displayCommand || ''} ${item.title} ${item.engineTag || ''}`}
                                      className={cn(
                                        'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 data-[selected=true]:bg-transparent data-[selected=true]:text-popover-foreground',
                                        index === slashActiveIndex && 'bg-accent text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'
                                      )}
                                      onMouseEnter={() => setSlashActiveIndex(index)}
                                      onSelect={() => { void applySlashCommand(item.id); }}
                                    >
                                      <span className="material-symbols-outlined text-[18px] text-muted-foreground">{item.icon}</span>
                                      <span className="min-w-0 flex-1">
                                        <span className="flex min-w-0 items-center gap-1.5">
                                          <span className="block truncate text-sm font-medium">{item.displayCommand || item.command}</span>
                                          {item.engineTag ? (
                                            <span className="shrink-0 rounded-full border border-border/70 bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
                                              {item.engineTag}
                                            </span>
                                          ) : null}
                                        </span>
                                        <span className="block truncate text-xs text-muted-foreground">{item.subtext}</span>
                                      </span>
                                    </PromptInputCommandItem>
                                  ))}
                                </PromptInputCommandGroup>
                              </PromptInputCommandList>
                            </PromptInputCommand>
                          </div>
                        ) : null}
                        <RichTextEditor
                          ref={editorRef}
                          content={input}
                          onEnter={handleEditorEnter}
                          onChange={(markdown: string) => setInput(markdown)}
                          preferMarkdownPaste
                          placeholder="描述你的需求或问题"
                          minHeight={116}
                          maxHeight={220}
                          className="[&_.ProseMirror]:text-[15px] [&_.ProseMirror]:leading-6 [&_.ProseMirror]:text-foreground [&_.ProseMirror_p]:my-0.5 [&_.ProseMirror_h1]:!text-base [&_.ProseMirror_h2]:!text-sm"
                          disabled={false}
                          autoFocus={false}
                          showFullscreenToggle={!isMobile}
                          showToolbar={false}
                          mentionItems={mainInputMentionItems}
                          trimPastedTrailingNewlines
                          footerInside
                          surfaceClassName="rounded-xl border-0 bg-transparent shadow-none"
                          contentAreaClassName="min-h-[68px] items-start px-6 pb-2 pt-4"
                          footerClassName="gap-4 border-border/60 px-6 pb-3 pt-3"
                          footerContent={(
                            <>
                              {isMultiAgentConversation ? (
                                <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
                                  {COLLABORATION_MODE_OPTIONS.map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      className={cn(
                                        'h-7 rounded-full px-2 text-[11px] transition-colors',
                                        collaborationRoomCore.responseMode === option.value
                                          ? 'bg-[#EEE7FF] text-[#151515] dark:bg-violet-500/15 dark:text-violet-100'
                                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                      )}
                                      title={option.title}
                                      onClick={() => handleSetCollaborationResponseMode(option.value)}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              <button
                                onClick={() => handleDebugToggle(!debugMode)}
                                className={`inline-flex items-center gap-1.5 text-[12px] transition-colors ${debugMode ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                title="调试模式：查看发送给 AI 的系统提示词"
                              >
                                <span className="material-symbols-outlined text-[16px]">bug_report</span>
                                调试
                              </button>
                              <Switch checked={debugMode} onCheckedChange={handleDebugToggle} className="scale-[0.82] data-[state=unchecked]:bg-slate-200 data-[state=checked]:bg-[#8B5CF6]" />
                              <div className="ml-2 w-[9.5rem] shrink-0 sm:w-[10.5rem]">
                                <EngineModelSelect engine={engine} model={model} onEngineChange={setEngine} onModelChange={setModel} className="h-9 rounded-full border-0 bg-transparent px-0.5 text-sm shadow-none" />
                              </div>
                            </>
                          )}
                          footerAfterCountContent={(
                            <div className="ml-5 flex items-center gap-3">
                              <Button
                                className={cn(
                                  'h-10 w-10 rounded-lg px-0 shadow-none transition-colors duration-150',
                                  activeAiBusy
                                    ? 'border border-destructive/20 bg-destructive text-destructive-foreground hover:bg-destructive/90'
                                    : 'bg-foreground text-background hover:bg-foreground/90'
                                )}
                                onClick={activeAiBusy ? stopActiveAiAction : handleSend}
                                disabled={!activeAiBusy && (attachmentUploading || !canSubmitMessage)}
                                title={activeAiBusy ? '停止生成' : '发送'}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                                  {activeAiBusy ? 'stop' : 'subdirectory_arrow_left'}
                                </span>
                              </Button>
                            </div>
                          )}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </ResizablePanel>

            {homeSidebarMode === 'active' ? (
              <>
                <ResizableHandle
                  withHandle
                  className="hidden lg:flex"
                  onClickHandle={closeHomeSidebar}
                />

                <ResizablePanel
                  id="home-command-sidebar-panel"
                  defaultSize={`${homeSidebarSize}%`}
                  minSize={`${MIN_HOME_SIDEBAR_SIZE}%`}
                  maxSize={`${MAX_HOME_SIDEBAR_SIZE}%`}
                  className="hidden lg:block"
                >
                  <ConversationRightRail
                    session={activeSession}
                    setSessionWorkbenchState={setSessionWorkbenchState}
                    onCollapse={closeHomeSidebar}
                    fallbackPanel={hasWorkflowRuntimeRightRailContext ? null : (
                      <HomeCommandSidebar
                        engine={effectiveEngine || engine}
                        model={model}
                        onQuickPrompt={handleQuickAction}
                        activeSessionId={activeSessionId}
                        activeSession={activeSession}
                        sessionWorkbenchState={activeSession?.sessionWorkbenchState}
                        setSessionWorkbenchState={setSessionWorkbenchState}
                        appendSessionMessage={appendSessionMessage}
                        updateSessionMessage={updateSessionMessage}
                        setStreamingMessageId={setStreamingMessageId}
                        markSessionStreaming={markSessionStreaming}
                        unmarkSessionStreaming={unmarkSessionStreaming}
                        onRegisterCollaborationHandler={(handler) => { collaborationMessageHandlerRef.current = handler; }}
                        sidebarHint={latestSidebarHint}
                        activeTab={homeSidebarTab}
                        onTabChange={handleHomeSidebarTabChange}
                        availableTabs={availableHomeSidebarTabs}
                        onCollapse={closeHomeSidebar}
                        onExpand={() => openHomeSidebar(homeSidebarTab)}
                        expanded={homeSidebarMode === 'active'}
                        ensureSessionId={createSession}
                      />
                    )}
                  />
                </ResizablePanel>
              </>
            ) : homeSidebarMode === 'peek' ? (
              <div className="hidden lg:flex items-start border-l bg-card/20">
                <button
                  type="button"
                  className={cn(
                    'm-2 flex min-h-32 w-16 flex-col items-center justify-center gap-2 rounded-lg border bg-background/82 px-2 py-4 text-[12px] text-muted-foreground backdrop-blur-sm transition-colors duration-150 hover:bg-muted/30 hover:text-foreground',
                  )}
                  onClick={() => openHomeSidebar(homeSidebarTab)}
                  title="展开右侧上下文与指挥区"
                >
                  <span className="material-symbols-outlined text-3xl">right_panel_open</span>
                  <span className="[writing-mode:vertical-rl] tracking-[0.14em]">上下文</span>
                </button>
              </div>
            ) : null}
          </ResizablePanelGroup>
          {agentPickerPanel}
          </>
          ) : null}
              </TabsContent>

              <TabsContent value="workspace" className="mt-0 min-h-0 flex-1 bg-background">
                {resolvedChatWorkspacePath ? (
                  <WorkspaceEditor
                    open
                    onOpenChange={() => {}}
                    workspacePath={resolvedChatWorkspacePath}
                    title={`${chatWorkspaceTitle} · 工作区`}
                    presentation="page"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    未设置工作区
                  </div>
                )}
              </TabsContent>

              <TabsContent value="changes" className="mt-0 min-h-0 flex-1 bg-background">
                {resolvedChatWorkspacePath ? (
                  <GitWorkspaceDiffPanel workspacePath={resolvedChatWorkspacePath} presentation="embedded" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    未设置工作区
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
          )}
        </div>

        <Dialog open={chatWorkspaceDialogOpen} onOpenChange={setChatWorkspaceDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>设置对话工作区</DialogTitle>
              <DialogDescription>这里的路径会同时驱动聊天运行目录、工作区页签和变更页签。</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <WorkspaceDirectoryPicker
                workspaceRoot={chatWorkspaceDraft || defaultChatWorkspacePath || pinnedChatWorkspacePath || ''}
                value={chatWorkspaceDraft}
                onChange={setChatWorkspaceDraft}
                autoSelectRootWhenEmpty={Boolean(defaultChatWorkspacePath || pinnedChatWorkspacePath)}
              />
              <div className="rounded-xl bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                已选择：{chatWorkspaceDraft || '未选择'}
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={resetChatWorkspacePath} disabled={chatWorkspaceSaving}>
                恢复默认
              </Button>
              <Button variant="outline" onClick={() => setChatWorkspaceDialogOpen(false)} disabled={chatWorkspaceSaving}>取消</Button>
              <Button onClick={handleSaveChatWorkspacePath} disabled={chatWorkspaceSaving}>
                {chatWorkspaceSaving ? '保存中...' : '保存'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(chatWorkspaceCleanupConfirm)}
          onOpenChange={(open) => {
            if (chatWorkspaceSaving) return;
            if (!open) setChatWorkspaceCleanupConfirm(null);
          }}
        >
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>切换对话工作区</DialogTitle>
              <DialogDescription>
                当前对话原来使用的是系统自动创建的工作目录。切换到新目录后，可以选择是否删除旧目录。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                <Checkbox
                  checked={deletePreviousChatWorkspace}
                  onCheckedChange={(checked) => setDeletePreviousChatWorkspace(checked === true)}
                  disabled={chatWorkspaceSaving}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium text-foreground">同时删除旧的系统工作目录</span>
                  <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                    {chatWorkspaceCleanupConfirm?.workspacePath}
                  </span>
                </span>
              </label>
              <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
                新目录：<span className="break-all font-mono">{chatWorkspaceCleanupConfirm?.nextPath || '默认工作目录'}</span>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                只会删除 ACEHarness 自动创建并绑定到该会话的工作目录；用户手动选择的目录不会出现这个选项。
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setChatWorkspaceCleanupConfirm(null)}
                disabled={chatWorkspaceSaving}
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const pending = chatWorkspaceCleanupConfirm;
                  if (!pending) return;
                  void performSaveChatWorkspacePath(pending.nextPath, {
                    sessionId: pending.sessionId,
                    workspacePath: pending.workspacePath,
                    shouldDelete: deletePreviousChatWorkspace,
                  });
                }}
                disabled={chatWorkspaceSaving}
              >
                {chatWorkspaceSaving ? '保存中...' : '确认切换'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DialogContent
            className="max-w-2xl overflow-hidden p-0 flex flex-col gap-0"
            resizableHeight
            defaultHeight={500}
            minHeight={360}
            maxHeight={820}
            onPointerDownOutside={(event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest('[data-rich-text-editor-fullscreen]')) {
                event.preventDefault();
              }
            }}
            onInteractOutside={(event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest('[data-rich-text-editor-fullscreen]')) {
                event.preventDefault();
              }
            }}
          >
            <DialogHeader className="border-b px-6 py-4">
              <DialogTitle>编辑消息</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 px-6 py-4">
              {editDialogOpen && (
                <RichTextEditor
                  ref={editEditorRef}
                  content={editContent}
                  onChange={(markdown: string) => setEditContent(markdown)}
                  placeholder="输入消息内容..."
                  minHeight={280}
                  maxHeight={340}
                  autoFocus
                  showFullscreenToggle={true}
                  showToolbar={false}
                  className="h-full"
                />
              )}
            </div>
            <DialogFooter className="border-t px-6 py-4">
              <Button variant="outline" onClick={handleCancelEdit}>取消</Button>
              <Button onClick={handleConfirmEdit}>发送</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={debugMode} onOpenChange={setDebugMode}>
          <DialogContent
            overlayClassName="bg-slate-950/35 backdrop-blur-[3px]"
            className="w-[min(92vw,860px)] max-w-none overflow-hidden rounded-[18px] border border-white/80 bg-[#f6f7f9] p-0 shadow-[0_24px_80px_rgba(15,23,42,0.35),0_1px_0_rgba(255,255,255,0.75)_inset] dark:border-white/10 dark:bg-[#1e1f23]"
            resizableHeight
            defaultHeight={620}
            minHeight={360}
            maxHeight={900}
          >
            <DialogHeader className="relative flex h-12 shrink-0 flex-row items-center justify-center space-y-0 border-b border-black/10 bg-gradient-to-b from-white/95 to-slate-100/95 px-5 dark:border-white/10 dark:from-[#34363b]/95 dark:to-[#25272b]/95">
              <div className="absolute left-5 flex items-center gap-2">
                <DialogClose
                  className="h-3.5 w-3.5 rounded-full border border-red-500/70 bg-[#ff5f57] shadow-[0_1px_1px_rgba(0,0,0,0.18)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label="关闭"
                />
                <span className="h-3.5 w-3.5 rounded-full border border-amber-500/70 bg-[#ffbd2e] shadow-[0_1px_1px_rgba(0,0,0,0.18)]" aria-hidden="true" />
                <span className="h-3.5 w-3.5 rounded-full border border-emerald-500/70 bg-[#28c840] shadow-[0_1px_1px_rgba(0,0,0,0.18)]" aria-hidden="true" />
              </div>
              <DialogTitle className="text-[13px] font-medium leading-none text-slate-700 dark:text-slate-200">
                System Prompt（实时）
              </DialogTitle>
              <div className="absolute right-5 hidden items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 sm:flex">
                <span className={cn('h-2 w-2 rounded-full', debugLoading ? 'bg-amber-400' : 'bg-emerald-400')} />
                {debugLoading ? 'Loading' : 'Live'}
              </div>
            </DialogHeader>
            <div className="min-h-0 flex-1 bg-[#ebeef3] p-3 dark:bg-[#17181c]">
              <pre className="h-full min-h-0 overflow-y-auto rounded-xl border border-black/10 bg-white px-5 py-4 font-mono text-[12px] leading-6 text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)_inset] whitespace-pre-wrap break-words dark:border-white/10 dark:bg-[#111216] dark:text-slate-200">
                {debugLoading ? '加载中...' : (debugPrompt || '')}
              </pre>
            </div>
          </DialogContent>
        </Dialog>

        <NotebookSaveDialog
          open={exportDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              closeNotebookExportDialog();
              return;
            }
            setExportDialogOpen(true);
          }}
          title="保存为 Notebook"
          confirmLabel="创建"
          scope={exportScope}
          onScopeChange={setExportScope}
          directory={exportDirectory}
          onDirectoryChange={setExportDirectory}
          directories={[]}
          saving={notebookExporting}
          previewText={`将保存到：${exportDirectory ? `${exportDirectory}/` : ''}${normalizeNotebookFileName(exportFileName) || normalizeNotebookFileName(createDefaultNotebookBaseName())}`}
          extraContent={(
            <div className="space-y-2">
              <Input
                value={exportFileName}
                onChange={(e) => setExportFileName(e.target.value)}
                placeholder="可选：输入文件名（无需 .cj.md）"
                disabled={notebookExporting}
              />
              <p className="text-xs text-muted-foreground">可不填文件名；系统会自动使用当前时间。你输入时也无需带 .cj.md 后缀。</p>
            </div>
          )}
          onConfirm={handleConfirmNotebookExport}
        />
        {workspaceEditorPath && (
          <WorkspaceEditor
            open={workspaceEditorOpen}
            onOpenChange={setWorkspaceEditorOpen}
            workspacePath={workspaceEditorPath}
            initialFilePath={workspaceEditorFilePath}
            initialLineNumber={workspaceEditorLineNumber}
            initialColumn={workspaceEditorColumn}
            title={workspaceEditorTitle}
          />
        )}
        <CliRunDialog
          open={Boolean(cliRunRequest)}
          request={cliRunRequest}
          onOpenChange={(open) => {
            if (!open) {
              setCliRunRequest(null);
            }
          }}
        />
        <FilePreviewDialog
          absolutePath={attachmentPreviewPath || ''}
          open={Boolean(attachmentPreviewPath)}
          onOpenChange={(open) => {
            if (!open) setAttachmentPreviewPath(null);
          }}
        />
      </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <NewConfigModal
        isOpen={workflowCreatorOpen}
        onClose={closeWorkflowCreator}
        onSuccess={handleWorkflowCreatorSuccess}
        homepageCompact
        initialMode="state-machine"
        initialWorkflowName="AI 引导工作流"
        initialRequirements={workflowCreatorRequirements}
        initialDescription={DEFAULT_AI_WORKFLOW_DESCRIPTION}
        initialWorkingDirectory={effectiveWorkingDirectory}
        frontendSessionId={workflowCreatorSessionId}
        aiGuidedEntry
      />

      <WeChatSessionBindDialog
        open={wechatBindDialogOpen}
        onOpenChange={setWeChatBindDialogOpen}
        activeSession={activeSession}
        origin={origin}
        onBindingSaved={({ integration, binding, targetLabel, accountId }) => {
          setSessionWorkbenchState((prev) => ({
            ...(prev || {}),
            wechatBinding: {
              integrationId: integration.id,
              integrationName: integration.name,
              bindingId: binding.id,
              accountId,
              externalConversationId: binding.externalConversationId,
              externalConversationName: binding.externalConversationName,
              bindingType: binding.bindingType,
              targetLabel,
              webhookPath: integration.webhookPath,
              secret: integration.secret,
              updatedAt: Date.now(),
            },
          }));
        }}
      />
    </div>
  );
}

