'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
} from '@/components/ai-elements/prompt-input';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { ThemeToggle } from '@/components/theme-toggle';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { workspaceApi, type AgoraGuestConfig, type AgoraGuestPreset, type NotebookScope } from '@/lib/core/api';
import NotebookSaveDialog from '@/components/notebook/NotebookSaveDialog';
import { buildNotebookFromConversation, buildNotebookFromAssistantMessage, createDefaultNotebookFileName } from '@/lib/chat/notebook';
import { useToast } from '@/components/ui/toast';
import { Switch } from '@/components/ui/switch';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSidebarPluginPreferences } from '@/hooks/useSidebarPluginPreferences';
import ChatSidebar, { readStoredSessionDirectoryOrder, type SessionDirectoryView } from '@/components/chat/ChatSidebar';
import WeChatSessionBindDialog from '@/components/chat/WeChatSessionBindDialog';
import ChatMessage, { RobotLogo } from '@/components/chat/ChatMessage';
import { MessageHistoryCollapse } from '@/components/chat/MessageHistoryCollapse';
import { VirtualMessageList } from '@/components/chat/VirtualMessageList';
import HomeCommandSidebar from '@/components/chat/HomeCommandSidebar';
import QuickActions, { QuickActionsBar } from '@/components/chat/QuickActions';
import AuthGuard from '@/components/AuthGuard';
import UserMenu from '@/components/UserMenu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { normalizeAssistantDisplay, parseActions } from '@/lib/chat/actions';
import {
  inferHomeSidebarMode,
  inferHomeSidebarTab,
  normalizeHomeSidebarTab,
  normalizeHomeSidebarTabs,
  type HomeSidebarHint,
  type HomeSidebarMode,
  type HomeSidebarTab,
} from '@/lib/core/home-sidebar-state';
import { dispatchHomeAction } from '@/lib/sidebar-plugins/intent-handlers';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import { getSessionDirectoryKind } from '@/lib/agent/conversations';
import { createInitialChatroomState } from '@/lib/agora/chatroom-state';
import { computeAdaptiveRecentWindow } from '@/lib/chat/message-window';
import { cn } from '@/lib/core/utils';
import pkgJson from '../../package.json';

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

const WorkspaceEditor = dynamic(() => import('@/components/workspace/WorkspaceEditor').then(m => m.WorkspaceEditor), {
  ssr: false,
});
const AgoraShell = dynamic(() => import('@/components/collaboration/AgoraShell').then(m => m.AgoraShell), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      正在进入议场...
    </div>
  ),
});
const DEFAULT_WIDTH = 264;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_HOME_SIDEBAR_SIZE = 26;
const MIN_HOME_SIDEBAR_SIZE = 20;
const MAX_HOME_SIDEBAR_SIZE = 46;
const MOBILE_BREAKPOINT = 768;
type AgentBindingTeam = 'blue' | 'red' | 'judge' | 'black-gold';

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

function isSessionDirectoryView(value: unknown): value is SessionDirectoryView {
  return value === 'conversation' || value === 'agora' || value === 'workflow';
}

function readStoredSessionDirectoryView(): SessionDirectoryView | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.sessionStorage.getItem(SESSION_DIRECTORY_VIEW_STORAGE_KEY);
    return isSessionDirectoryView(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredSessionDirectoryView(view: SessionDirectoryView): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_DIRECTORY_VIEW_STORAGE_KEY, view);
  } catch {}
}

function hasInlineCommandWhitespace(value: string): boolean {
  return Array.from(value).some((char) => char.trim().length === 0);
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
      <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.14),transparent)]" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(180deg,transparent,rgba(248,246,241,0.72))]" />
      <div className="absolute inset-y-0 left-0 w-20 bg-[linear-gradient(90deg,rgba(248,246,241,0.56),transparent)]" />
      <div className="absolute inset-y-0 right-0 w-20 bg-[linear-gradient(270deg,rgba(248,246,241,0.56),transparent)]" />

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
        <section className="relative overflow-hidden rounded-[40px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(248,246,241,0.82))] px-8 py-12 shadow-[0_26px_80px_rgba(71,85,105,0.12)] backdrop-blur-[2px] sm:px-12 sm:py-16">
          <div className="absolute inset-x-0 bottom-0 h-48 bg-[repeating-linear-gradient(180deg,transparent_0,transparent_12px,rgba(148,163,184,0.08)_12px,rgba(148,163,184,0.08)_13px)] opacity-80" />
          <div className="absolute inset-x-10 top-10 h-px bg-gradient-to-r from-transparent via-stone-300/70 to-transparent" />
          <div className="absolute inset-x-16 top-16 h-px bg-gradient-to-r from-transparent via-stone-200/80 to-transparent" />

          <div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
            <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-full border border-violet-300/40 bg-violet-50/70 text-violet-500 shadow-[0_0_0_12px_rgba(139,92,246,0.06)]">
              <AgoraZenMark className="h-12 w-12" />
            </div>

            <div className="text-[11px] uppercase tracking-[0.42em] text-stone-400">Agora</div>
            <h2 className="mt-4 font-serif text-3xl font-semibold tracking-[0.08em] text-stone-800 sm:text-5xl">
              议论广场
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-stone-500 sm:text-lg">
              围绕具体议题展开协作讨论，让过程、观点与结论自然沉淀。
            </p>
            <p className="mt-2 text-sm text-stone-400">
              {hasExistingTopics ? '从左侧继续已有议题，或开启一场新的协作讨论。' : '从一个清晰议题开始，把讨论与结论留在同一处。'}
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Button
                className="h-11 rounded-full bg-stone-900 px-6 text-sm text-stone-50 hover:bg-stone-800"
                onClick={onCreate}
              >
                <span className="material-symbols-outlined mr-2 text-[18px]">add_circle</span>
                新建议题
              </Button>
              <button
                type="button"
                className="rounded-full border border-stone-200 bg-white/80 px-4 py-2 text-sm text-stone-500 shadow-sm transition-colors hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
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

function ChatPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useSidebarPluginPreferences();
  const {
    activeSessionId, activeSession, sessions, createSession, setActiveSessionId, sendMessage, compactActiveSession, stopStreaming,
    deleteMessage, retryFromMessage, continueFromMessage,
    loading, sessionLoadingId, streamingMessageId, setStreamingMessageId, markSessionStreaming, unmarkSessionStreaming,
    model, setModel, engine, effectiveEngine, isModelSelectionReady, setEngine,
    confirmAction, rejectAction, undoActionById, retryAction, reloadActionResult,
    skillSettings, setSessionWorkbenchState,
    appendSessionMessage,
    updateSessionMessage,
    workingDirectory,
  } = useChat();
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const collaborationMessageHandlerRef = useRef<((text: string) => void) | null>(null);
  const [notebookExporting, setNotebookExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ type: 'conversation' } | { type: 'assistant'; messageId: string } | null>(null);
  const [exportFileName, setExportFileName] = useState('');
  const [exportScope, setExportScope] = useState<NotebookScope>('personal');
  const [exportDirectory, setExportDirectory] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const [debugPrompt, setDebugPrompt] = useState<string | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [workspaceEditorOpen, setWorkspaceEditorOpen] = useState(false);
  const [workspaceEditorPath, setWorkspaceEditorPath] = useState<string | undefined>();
  const [workspaceEditorFilePath, setWorkspaceEditorFilePath] = useState<string | null>(null);
  const [workspaceEditorTitle, setWorkspaceEditorTitle] = useState<string | undefined>();
  const [wechatBindDialogOpen, setWeChatBindDialogOpen] = useState(false);
  const [sessionDirectoryView, setSessionDirectoryView] = useState<SessionDirectoryView>(() => (
    readStoredSessionDirectoryView() || readStoredSessionDirectoryOrder()[0] || 'conversation'
  ));
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
  const [agoraGuestData, setAgoraGuestData] = useState<{
    guests: AgoraGuestConfig[];
    presets: AgoraGuestPreset[];
    loading: boolean;
    loaded: boolean;
  }>({
    guests: [],
    presets: [],
    loading: false,
    loaded: false,
  });
  const handleAgoraGuestDataChange = useCallback((data: { guests: AgoraGuestConfig[]; presets: AgoraGuestPreset[]; loading: boolean }) => {
    setAgoraGuestData((prev) => {
      if (
        prev.loaded
        && prev.guests === data.guests
        && prev.presets === data.presets
        && prev.loading === data.loading
      ) {
        return prev;
      }
      return {
        guests: data.guests,
        presets: data.presets,
        loading: data.loading,
        loaded: true,
      };
    });
  }, []);
  const starterHandledRef = useRef(false);
  const homeEntryResetHandledRef = useRef(false);
  const werewolfPreviousDarkClassRef = useRef<boolean | null>(null);
  const lastHomeSidebarSyncRef = useRef('');

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

  const latestSidebarHint = activeSession?.sessionWorkbenchState?.homeSidebar || parsedSidebarHint;
  const hasWorkflowSidebarContext = Boolean(activeSession?.workflowBinding);
  const hasCreationSidebarContext = Boolean(activeSession?.creationSession);
  const hasCollaborationSidebarContext = Boolean(activeSession?.sessionWorkbenchState?.collaborationRoom);
  const isWerewolfLabMode = Boolean(activeSession?.sessionWorkbenchState?.collaborationRoom?.werewolf?.enabled);
  const isBuiltInAgoraMode = Boolean(activeSession?.sessionWorkbenchState?.collaborationRoom?.chatroom);
  const hasExistingAgoraTopics = useMemo(
    () => sessions.some((session) => getSessionDirectoryKind(session) === 'agora'),
    [sessions]
  );
  const showAgoraZenCover = sessionDirectoryView === 'agora' && !activeSession && !loading;
  const hasCommanderSidebarContext = hasWorkflowSidebarContext || hasCollaborationSidebarContext;
  const hasHintSidebarContext = Boolean(
    latestSidebarHint?.intent
    || latestSidebarHint?.workflowDraft
    || latestSidebarHint?.agentDraft
    || latestSidebarHint?.tabs?.length
  );
  const derivedHomeSidebarTab = useMemo(
    () => inferHomeSidebarTab(latestSidebarHint, {
      hasWorkflowBinding: hasCommanderSidebarContext,
      hasCreationSession: hasCreationSidebarContext,
    }),
    [hasCommanderSidebarContext, hasCreationSidebarContext, latestSidebarHint]
  );
  const derivedHomeSidebarMode = useMemo(
    () => inferHomeSidebarMode(latestSidebarHint, {
      hasWorkflowBinding: hasCommanderSidebarContext,
      hasCreationSession: hasCreationSidebarContext,
    }),
    [hasCommanderSidebarContext, hasCreationSidebarContext, latestSidebarHint]
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
      if (hasWorkflowSidebarContext) {
        tabs.add('workflow');
      }
      if (hasCreationSidebarContext) {
        tabs.add('workflow');
      }
    }
    if (tabs.size === 0 && hasCommanderSidebarContext) tabs.add('commander');
    if (tabs.size === 0 && latestSidebarHint) tabs.add(derivedHomeSidebarTab);
    return Array.from(tabs);
  }, [derivedHomeSidebarTab, hasCommanderSidebarContext, hasCreationSidebarContext, hasWorkflowSidebarContext, latestSidebarHint, latestSidebarHint?.tabs]);

  const availableHomeSidebarTabs = useMemo<HomeSidebarTab[]>(() => {
    const tabs = new Set<HomeSidebarTab>(sessionScopedSidebarTabs);
    if (tabs.size === 0 && derivedHomeSidebarMode === 'active') {
      tabs.add(derivedHomeSidebarTab);
    }
    return Array.from(tabs);
  }, [derivedHomeSidebarMode, derivedHomeSidebarTab, sessionScopedSidebarTabs]);
  const hasHomeSidebarContext = hasWorkflowSidebarContext
    || hasCreationSidebarContext
    || hasCollaborationSidebarContext
    || hasHintSidebarContext;
  const availableHomeSidebarTabsKey = availableHomeSidebarTabs.join('|');

  useEffect(() => {
    writeStoredSessionDirectoryView(sessionDirectoryView);
  }, [sessionDirectoryView]);

  useEffect(() => {
    if (!parsedSidebarHint) return;
    const persisted = activeSession?.sessionWorkbenchState?.homeSidebar;
    if (JSON.stringify(parsedSidebarHint) === JSON.stringify(persisted || null)) return;
    setSessionWorkbenchState((prev) => ({
      ...(prev || {}),
      homeSidebar: parsedSidebarHint,
    }));
  }, [activeSession?.sessionWorkbenchState?.homeSidebar, parsedSidebarHint, setSessionWorkbenchState]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    const handleOpenWorkspacePath = (event: Event) => {
      const detail = (event as CustomEvent<{
        absolutePath?: string;
        workspacePath?: string;
        filePath?: string | null;
      }>).detail;
      if (!detail?.workspacePath) return;
      setWorkspaceEditorPath(detail.workspacePath);
      setWorkspaceEditorTitle('文档链接');
      setWorkspaceEditorFilePath(detail.absolutePath || detail.filePath || null);
      setWorkspaceEditorOpen(true);
    };
    window.addEventListener('ace:open-workspace-path', handleOpenWorkspacePath as EventListener);
    return () => {
      window.removeEventListener('ace:open-workspace-path', handleOpenWorkspacePath as EventListener);
    };
  }, []);

  const chatTitle = useMemo(() => {
    const notebookFile = searchParams.get('notebookFile');
    if (notebookFile) {
      const fileName = notebookFile.split('/').pop() || notebookFile;
      return `${fileName} · Notebook`;
    }

    const sessionTitle = activeSession?.title?.trim();
    return sessionTitle || '首页';
  }, [activeSession?.title, searchParams]);

  useDocumentTitle(chatTitle);

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

  // Resize drag handler
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const x = e.clientX - containerRef.current.getBoundingClientRect().left;
      const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, x));
      setSidebarWidth(clamped);
      localStorage.setItem(SIDEBAR_STORAGE_KEY, clamped.toString());
    };
    const onUp = () => setIsResizing(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

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
    hasMessages,
    isMobile,
    latestSidebarHint?.activeTab,
    latestSidebarHint?.mode,
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
  }, [activeSession?.messages, loading]);

  useEffect(() => {
    if (!editDialogOpen || !editEditorRef.current || !editingMessageId) return;
    if (lastEditSeedRef.current === editingMessageId) return;
    editEditorRef.current.setContent(editContent);
    lastEditSeedRef.current = editingMessageId;
  }, [editContent, editDialogOpen, editingMessageId]);

  useEffect(() => {
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
  }, [searchParams, setActiveSessionId]);

  useEffect(() => {
    const targetSessionId = searchParams.get('sessionId');
    if (!targetSessionId || starterHandledRef.current) return;

    starterHandledRef.current = true;
    const sidebarTab = searchParams.get('sidebarTab');
    if (sidebarTab === 'agent' || sidebarTab === 'workflow' || sidebarTab === 'commander') {
      openHomeSidebar(sidebarTab);
    }
    const targetSession = sessions.find((session) => session.id === targetSessionId);
    if (targetSession) {
      setSessionDirectoryView(getSessionDirectoryKind(targetSession));
    }
    setActiveSessionId(targetSessionId);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('sessionId');
    nextParams.delete('sidebarTab');
    nextParams.delete('sessionTitle');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [pathname, router, searchParams, sessions, setActiveSessionId]);

  useEffect(() => {
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

    if (sidebarTab === 'agent' || sidebarTab === 'workflow' || sidebarTab === 'commander') {
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
  }, [createSession, pathname, router, searchParams]);

  useEffect(() => {
    const starterPrompt = searchParams.get('starterPrompt');
    if (!starterPrompt || starterHandledRef.current) return;

    starterHandledRef.current = true;
    const sidebarTab = searchParams.get('sidebarTab');
    const sessionTitle = searchParams.get('sessionTitle');
    const existingSessionId = searchParams.get('sessionId');
    if (existingSessionId) {
      const targetSession = sessions.find((session) => session.id === existingSessionId);
      if (targetSession) {
        setSessionDirectoryView(getSessionDirectoryKind(targetSession));
      }
      setActiveSessionId(existingSessionId);
    } else {
      createSession({ title: sessionTitle?.trim() || '新对话' });
    }

    if (sidebarTab === 'agent' || sidebarTab === 'workflow' || sidebarTab === 'commander') {
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
  }, [createSession, pathname, router, searchParams, sessions, setActiveSessionId]);

  const getInputMarkdown = useCallback(() => {
    return editorRef.current?.getMarkdown().trim() || input.trim();
  }, [input]);

  const homepageSlashCommands = useMemo(() => ([
    {
      id: 'compact',
      command: '/compact',
      title: '压缩上下文',
      subtext: '刷新当前会话的 session 上下文容量',
      icon: 'compress',
      aliases: ['compact', 'context'],
    },
  ]), []);

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
      ? (activeSession ? { filePath: finalFilePath, content: buildNotebookFromConversation(activeSession) } : null)
      : (() => {
          const message = activeSession?.messages.find((item) => item.id === pendingExport.messageId && item.role === 'assistant');
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
  }, [pendingExport, normalizeNotebookFileName, exportFileName, exportDirectory, toast, activeSession, saveNotebookFile, exportScope, createDefaultNotebookBaseName]);

  const handleSaveConversationAsNotebook = useCallback(async () => {
    if (!activeSession) return;
    const exportableMessages = activeSession.messages.filter((message) => {
      if (message.role === 'error') return false;
      return Boolean((message.rawContent || message.content || '').trim());
    });
    if (exportableMessages.length === 0) {
      toast('warning', '当前会话没有可导出的内容');
      return;
    }

    openNotebookExportDialog({ type: 'conversation' });
  }, [activeSession, openNotebookExportDialog, toast]);

  const handleSaveAssistantMessageAsNotebook = useCallback(async (messageId: string) => {
    const message = activeSession?.messages.find((item) => item.id === messageId && item.role === 'assistant');
    if (!message) return;

    const contentText = (message.rawContent || message.content || '').trim();
    if (!contentText) {
      toast('warning', '这条消息暂无可导出的内容');
      return;
    }

    openNotebookExportDialog({ type: 'assistant', messageId });
  }, [activeSession, openNotebookExportDialog, toast]);

  const unlockAutoScroll = useCallback(() => {
    autoScrollLockedRef.current = false;
    setShowScrollBtn(false);
  }, []);

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

    if (patch.tab) setHomeSidebarTab((prev) => (prev === patch.tab ? prev : patch.tab!));
    if (patch.mode) setHomeSidebarMode((prev) => (prev === patch.mode ? prev : patch.mode!));

    if (!activeSessionId && !activeSession) {
      setSidebarOpen(true);
      setSessionDirectoryView('conversation');
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

  useEffect(() => {
    const shouldOpen = filteredSlashCommands.length > 0 && input.trim().startsWith('/') && !hasCollaborationSidebarContext;
    setSlashMenuOpen(shouldOpen);
    if (!shouldOpen) setSlashActiveIndex(0);
  }, [filteredSlashCommands.length, hasCollaborationSidebarContext, input]);

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashQuery]);

  const mainInputMentionItems = useMemo(() => {
    const room = activeSession?.sessionWorkbenchState?.collaborationRoom;
    if (!room || !hasCollaborationSidebarContext) return [];
    const names = new Set<string>();
    if (isBuiltInAgoraMode) {
      names.add('全员');
      (room.chatroom?.participants || []).forEach((participant) => {
        const name = String(participant || '').trim();
        if (name) names.add(name);
      });
      (room.selectedAgents || []).forEach((name) => {
        if (name) names.add(name);
      });
    } else if (homeSidebarTab === 'commander' || homeSidebarTab === 'workflow') {
      names.add('全员');
      (room.selectedAgents || []).forEach((name) => {
        if (name) names.add(name);
      });
    }
    return Array.from(names);
  }, [activeSession?.sessionWorkbenchState?.collaborationRoom, hasCollaborationSidebarContext, homeSidebarTab, isBuiltInAgoraMode]);

  const submitMessage = useCallback(async (text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    if (normalized === '/compact') {
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
    if (editingMessageId) {
      deleteMessage(editingMessageId);
      setEditingMessageId(null);
    }

    unlockAutoScroll();
    setInput('');
    editorRef.current?.clear();

    // Route to collaboration room if active
    if (hasCollaborationSidebarContext && collaborationMessageHandlerRef.current) {
      collaborationMessageHandlerRef.current(normalized);
      editorRef.current?.focus();
      return;
    }

    if (loading) {
      stopStreaming();
      await Promise.resolve();
    }
    if (!activeSessionId && !activeSession) {
      setSidebarOpen(true);
      setSessionDirectoryView('conversation');
    }
    await sendMessage(normalized);
    editorRef.current?.focus();
  }, [activeSession, activeSessionId, compactActiveSession, deleteMessage, editingMessageId, hasCollaborationSidebarContext, loading, sendMessage, stopStreaming, toast, unlockAutoScroll]);

  const applySlashCommand = useCallback(async (commandId: string) => {
    if (commandId === 'compact') {
      await submitMessage('/compact');
    }
  }, [submitMessage]);

  const handleSend = useCallback(async () => {
    const text = getInputMarkdown();
    if (!text) return;
    await submitMessage(text);
  }, [getInputMarkdown, submitMessage]);

  const handleEditorEnter = useCallback(async (text: string) => {
    const markdown = text.trim() || getInputMarkdown();
    if (!markdown) return;
    if (slashMenuOpen && filteredSlashCommands.length > 0) {
      const index = Math.max(0, Math.min(slashActiveIndex, filteredSlashCommands.length - 1));
      await applySlashCommand(filteredSlashCommands[index].id);
      return;
    }
    await submitMessage(markdown);
  }, [applySlashCommand, filteredSlashCommands, getInputMarkdown, slashActiveIndex, slashMenuOpen, submitMessage]);

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
    setSessionDirectoryView('agora');
  }, [createSession]);

  const handleCreateAgoraGuest = useCallback(() => {
    setSidebarOpen(true);
    setSessionDirectoryView('agora');
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
    router.push(`/workbench/${encodeURIComponent(configFile)}`);
  }, [loading, router, stopStreaming, toast, unlockAutoScroll]);

  const handleWorkflowStartAction = useCallback((configFile: string) => {
    if (!configFile) {
      toast('warning', '缺少工作流配置文件');
      return;
    }
    unlockAutoScroll();
    setInput('');
    editorRef.current?.clear();
    if (loading) stopStreaming();
    router.push(`/workbench/${encodeURIComponent(configFile)}?mode=run&autoStart=1`);
  }, [loading, router, stopStreaming, toast, unlockAutoScroll]);

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

    if (prompt === '__HOME_ACTION__:create_workflow') {
      openHomeSidebar('workflow', 'create-workflow', 'clarifying', { shouldOpenModal: true });
      unlockAutoScroll();
      setInput('');
      editorRef.current?.clear();
      if (loading) stopStreaming();
      return;
    }

    if (prompt === '__HOME_ACTION__:create_agent') {
      openHomeSidebar('agent', 'create-agent', 'clarifying', { shouldOpenModal: true });
      unlockAutoScroll();
      setInput('');
      editorRef.current?.clear();
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
    decodeWorkflowActionFilename,
    handleWorkflowOpenAction,
    handleWorkflowStartAction,
    loading,
    openHomeSidebar,
    stopStreaming,
    unlockAutoScroll,
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
    const starterAction = searchParams.get('starterAction');
    if (!starterAction || starterHandledRef.current) return;

    starterHandledRef.current = true;
    const sidebarTab = searchParams.get('sidebarTab');
    const sessionTitle = searchParams.get('sessionTitle');
    const existingSessionId = searchParams.get('sessionId');
    if (existingSessionId) {
      const targetSession = sessions.find((session) => session.id === existingSessionId);
      if (targetSession) {
        setSessionDirectoryView(getSessionDirectoryKind(targetSession));
      }
      setActiveSessionId(existingSessionId);
    } else {
      createSession({ title: sessionTitle?.trim() || '新对话' });
    }

    if (sidebarTab === 'agent' || sidebarTab === 'workflow' || sidebarTab === 'commander') {
      openHomeSidebar(sidebarTab);
    }

    if (starterAction === 'create_agent') {
      handleQuickAction('__HOME_ACTION__:create_agent');
    } else if (starterAction === 'create_workflow') {
      handleQuickAction('__HOME_ACTION__:create_workflow');
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('sessionId');
    nextParams.delete('starterAction');
    nextParams.delete('sidebarTab');
    nextParams.delete('sessionTitle');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [createSession, handleQuickAction, pathname, router, searchParams, sessions, setActiveSessionId]);

  const messages = activeSession?.messages || [];
  const isCurrentSessionLoading = Boolean(activeSessionId && sessionLoadingId === activeSessionId);

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

  const isChatroomCentralTranscript = Boolean(activeSession?.sessionWorkbenchState?.collaborationRoom?.chatroom);
  const recentWindowSize = useMemo(() => computeAdaptiveRecentWindow(messages as any[], {
    streamingMessageId,
    forceFullWindow: Boolean(activeSession?.sessionWorkbenchState?.collaborationRoom?.werewolf?.enabled),
    ...(isChatroomCentralTranscript
      ? { minRecentMessages: 100, maxRecentMessages: 100, targetWeight: Number.MAX_SAFE_INTEGER }
      : {}),
  }), [messages, streamingMessageId, activeSession?.sessionWorkbenchState?.collaborationRoom?.werewolf?.enabled, isChatroomCentralTranscript]);

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
      const isWerewolfMessage = Boolean((msg.cards || []).some((card: any) => card?.type === 'werewolf_speech'));
      if (msg.role === 'assistant' && !isWerewolfMessage) {
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
            werewolfView={activeSession?.sessionWorkbenchState?.collaborationRoom?.werewolfView}
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

  const activeAgentBinding = activeSession?.agentBinding;
  const activeWeChatBinding = activeSession?.sessionWorkbenchState?.wechatBinding;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    if (isWerewolfLabMode) {
      if (werewolfPreviousDarkClassRef.current === null) {
        werewolfPreviousDarkClassRef.current = root.classList.contains('dark');
      }
      root.classList.add('dark');
      return;
    }

    const previousHadDarkClass = werewolfPreviousDarkClassRef.current;
    if (previousHadDarkClass === null) return;
    werewolfPreviousDarkClassRef.current = null;
    if (previousHadDarkClass) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [activeSession?.id, isWerewolfLabMode]);

  const activeAgentAvatarSrc = activeAgentBinding
    ? resolveAgentAvatarSrc(undefined, activeAgentBinding.agentName, {
        team: activeAgentBinding.team || 'red',
        roleType: activeAgentBinding.roleType || 'normal',
      })
    : null;

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-screen flex overflow-hidden bg-background',
        isWerewolfLabMode && 'werewolf-wood-bg'
      )}
    >
      {/* Mobile overlay backdrop */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-30" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      {sidebarOpen && (
        <div
          className={
            isMobile
              ? 'fixed inset-y-0 left-0 z-40 bg-background'
              : 'relative shrink-0'
          }
          style={{ width: isMobile ? `${Math.min(sidebarWidth, 320)}px` : `${sidebarWidth}px` }}
        >
          <ChatSidebar
            sessionView={sessionDirectoryView}
            onSessionViewChange={setSessionDirectoryView}
            onAgoraGuestDataChange={handleAgoraGuestDataChange}
          />
          {/* Resize handle (desktop only) */}
          {!isMobile && (
            <div
              className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:w-1.5 transition-all ${
                isResizing ? 'bg-primary w-1.5' : 'bg-border hover:bg-primary/60'
              }`}
              onMouseDown={e => { e.preventDefault(); setIsResizing(true); }}
            />
          )}
        </div>
      )}

      <div className={cn('flex-1 flex flex-col min-w-0', isWerewolfLabMode && 'werewolf-wood-main')}>
        {/* Top bar */}
        <div
          className={cn(
            'flex items-center justify-between px-4 py-2 border-b bg-background/80 backdrop-blur shrink-0',
            isWerewolfLabMode && 'werewolf-wood-panel border-stone-700/60 bg-stone-900/35'
          )}
        >
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(p => !p)} title="切换侧边栏">
              <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>menu</span>
            </Button>
            {activeAgentBinding ? (
              <div className="hidden sm:flex items-center gap-3 rounded-full border border-border/70 bg-card/90 px-2 py-1.5">
                <Avatar className="h-8 w-8 ring-1 ring-border/70">
                  <AvatarImage src={activeAgentAvatarSrc || undefined} alt={activeAgentBinding.agentName} />
                  <AvatarFallback>{activeAgentBinding.agentName.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
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
                  className="h-8 rounded-full px-3 text-xs"
                  onClick={() => createSession({ title: '新对话' })}
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
                <span className="ml-2 hidden sm:inline text-xs opacity-90">
                  {activeWeChatBinding.externalConversationId}
                </span>
              ) : null}
            </Button>
          </div>
          <div className="flex items-center gap-2">
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
            <Button size="sm" variant="outline" onClick={() => router.push('/dashboard')} title="切换到控制台">
              <span className="material-symbols-outlined" style={{ fontSize: '20px', marginRight: '4px' }}>dashboard</span>
              <span className="hidden sm:inline">控制台</span>
            </Button>
            <UserMenu user={currentUser} />
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {isBuiltInAgoraMode ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1">
                <AgoraShell
                  activeSessionId={activeSessionId}
                  sessionTitle={activeSession?.title}
                  sessionWorkbenchState={activeSession?.sessionWorkbenchState}
                  setSessionWorkbenchState={setSessionWorkbenchState}
                  appendSessionMessage={appendSessionMessage}
                  workingDirectory={workingDirectory}
                  onInsertIntoMainInput={handleInsertIntoMainInput}
                  onRegisterMainInputHandler={(handler) => { collaborationMessageHandlerRef.current = handler; }}
                  initialSavedGuests={agoraGuestData.loaded ? agoraGuestData.guests : undefined}
                  initialGuestPresets={agoraGuestData.loaded ? agoraGuestData.presets : undefined}
                  currentUser={currentUser}
                />
              </div>
              <div className="home-chat-input-tray shrink-0 border-t px-4 py-3 md:px-8 lg:px-16">
                <div className="mx-auto max-w-5xl">
                  <div className="home-chat-composer relative overflow-hidden rounded-[28px] border border-border/70 bg-background shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
                    <RichTextEditor
                      ref={editorRef}
                      content={input}
                      onEnter={handleEditorEnter}
                      onChange={(markdown) => setInput(markdown)}
                      placeholder="输入议场消息"
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
                      surfaceClassName="rounded-[28px] border-0 bg-transparent shadow-none"
                      contentAreaClassName="min-h-[68px] items-start px-6 pb-2 pt-4"
                      footerClassName="justify-end gap-4 border-border/60 px-6 pb-3 pt-3"
                      footerAfterCountContent={(
                        <div className="ml-5 flex items-center gap-3">
                          <Button className="h-11 w-11 rounded-2xl bg-[#1f6fff] px-0 shadow-sm transition-colors duration-150 hover:bg-[#1a61de]" onClick={handleSend} disabled={!getInputMarkdown() || !isModelSelectionReady}>
                            <span className="material-symbols-outlined text-white" style={{ fontSize: '18px' }}>subdirectory_arrow_left</span>
                          </Button>
                        </div>
                      )}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
          <ResizablePanelGroup
            orientation="horizontal"
            className={cn('h-full', isWerewolfLabMode && 'werewolf-wood-main')}
            onLayoutChanged={handleHomeSidebarLayout}
          >
            <ResizablePanel id="home-main-panel" defaultSize={homeSidebarMode === 'active' ? `${100 - homeSidebarSize}%` : '100%'} minSize="42%">
              <div className={cn('flex h-full min-h-0 flex-col', isWerewolfLabMode && 'werewolf-wood-main')}>
                <div className="flex-1 relative min-h-0">
                  <div
                    ref={scrollContainerRef}
                    className={cn(
                      'home-chat-scroll absolute inset-0 overflow-y-auto px-4 py-6 md:px-8 lg:px-16',
                      isWerewolfLabMode && 'werewolf-wood-main'
                    )}
                  >
                    {messages.length === 0 && isCurrentSessionLoading ? (
                      <div className="flex h-full items-center justify-center">
                        <div className="home-chat-surface flex items-center gap-3 rounded-2xl px-4 py-3 text-sm text-muted-foreground">
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
                      <div className="flex flex-col items-center justify-center h-full gap-8">
                        <div className="text-center">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                            className="inline-flex p-3 mb-4"
                          >
                            <RobotLogo size={56} className="animate-robotPulse" />
                          </motion.div>
                          <motion.h2
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-2xl font-bold bg-gradient-to-r from-primary via-blue-500 to-purple-500 bg-clip-text text-transparent mb-2"
                          >
                            ACEHarness Multi-Agent 助手
                          </motion.h2>
                          <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.1 }}
                            className="text-sm text-muted-foreground"
                          >
                            {activeAgentBinding?.agentName
                              ? `当前正在与 Agent「${activeAgentBinding.agentName}」对话`
                              : '通过对话实现全流程 Multi-Agent 智能编排'}
                          </motion.p>
                          <motion.span
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="mt-1 text-xs text-muted-foreground/60"
                          >
                            v{pkgJson.version}
                          </motion.span>
                        </div>
                        <QuickActions onAction={handleQuickAction} skillSettings={skillSettings} />
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
                      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-primary/20 bg-background/92 px-3 py-1.5 text-xs text-foreground backdrop-blur-md transition-colors duration-150 hover:bg-background"
                    >
                      <span className="material-symbols-outlined text-primary" style={{ fontSize: '16px' }}>arrow_downward</span>
                      新消息
                    </button>
                  )}
                </div>

                {!showAgoraZenCover ? (
                  <div
                    className={cn(
                      'home-chat-input-tray shrink-0 border-t px-4 py-3 md:px-8 lg:px-16',
                      isWerewolfLabMode && 'werewolf-wood-panel border-stone-700/60 bg-stone-950/35'
                    )}
                  >
                    {messages.length > 0 && (
                      <div className="mx-auto mb-0.5 max-w-5xl rounded-2xl bg-background/70 px-1 py-1 backdrop-blur-sm">
                        <QuickActionsBar onAction={handleQuickAction} skillSettings={skillSettings} />
                      </div>
                    )}
                    <div className="mx-auto max-w-5xl">
                      <div className="home-chat-composer relative rounded-[28px] border border-border/70 bg-background shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
                        {slashMenuOpen ? (
                          <div className="absolute bottom-[calc(100%+8px)] left-0 z-20 w-[320px] overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-xl">
                            <PromptInputCommand className="bg-transparent">
                              <PromptInputCommandList className="max-h-64 p-1">
                                <PromptInputCommandEmpty>无匹配命令</PromptInputCommandEmpty>
                                <PromptInputCommandGroup heading="命令">
                                  {filteredSlashCommands.map((item, index) => (
                                    <PromptInputCommandItem
                                      key={item.id}
                                      value={`${item.command} ${item.title}`}
                                      className={cn(
                                        'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2',
                                        index === slashActiveIndex && 'bg-accent text-accent-foreground'
                                      )}
                                      onMouseEnter={() => setSlashActiveIndex(index)}
                                      onSelect={() => { void applySlashCommand(item.id); }}
                                    >
                                      <span className="material-symbols-outlined text-[18px] text-muted-foreground">{item.icon}</span>
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{item.command}</span>
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
                          onChange={(markdown) => setInput(markdown)}
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
                          surfaceClassName="rounded-[28px] border-0 bg-transparent shadow-none"
                          contentAreaClassName="min-h-[68px] items-start px-6 pb-2 pt-4"
                          footerClassName="gap-4 border-border/60 px-6 pb-3 pt-3"
                          footerContent={(
                            <>
                              <button
                                onClick={() => handleDebugToggle(!debugMode)}
                                className={`inline-flex items-center gap-1.5 text-[12px] transition-colors ${debugMode ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                title="调试模式：查看发送给 AI 的系统提示词"
                              >
                                <span className="material-symbols-outlined text-[16px]">bug_report</span>
                                调试
                              </button>
                              <Switch checked={debugMode} onCheckedChange={handleDebugToggle} className="scale-[0.82] data-[state=unchecked]:bg-slate-200 data-[state=checked]:bg-primary/85" />
                              <div className="ml-2 w-[9.5rem] shrink-0 sm:w-[10.5rem]">
                                <EngineModelSelect engine={engine} model={model} onEngineChange={setEngine} onModelChange={setModel} className="h-9 rounded-full border-0 bg-transparent px-0.5 text-sm shadow-none" />
                              </div>
                            </>
                          )}
                          footerAfterCountContent={(
                            <div className="ml-5 flex items-center gap-3">
                              {loading && (
                                <Button className="h-10 w-10 rounded-2xl border border-destructive/20 px-0 shadow-sm transition-colors duration-150" variant="destructive" onClick={stopStreaming} title="停止生成">
                                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>stop</span>
                                </Button>
                              )}
                              <Button className="h-11 w-11 rounded-2xl bg-[#1f6fff] px-0 shadow-sm transition-colors duration-150 hover:bg-[#1a61de]" onClick={handleSend} disabled={!getInputMarkdown() || !isModelSelectionReady}>
                                <span className="material-symbols-outlined text-white" style={{ fontSize: '18px' }}>subdirectory_arrow_left</span>
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
                    werewolfMode={isWerewolfLabMode}
                  />
                </ResizablePanel>
              </>
            ) : homeSidebarMode === 'peek' ? (
              <div className={cn('hidden lg:flex items-start border-l bg-card/20', isWerewolfLabMode && 'werewolf-wood-panel border-l-stone-700/60')}>
                <button
                  type="button"
                  className={cn(
                    'm-2 flex min-h-32 w-16 flex-col items-center justify-center gap-2 rounded-2xl border bg-background/82 px-2 py-4 text-[12px] text-muted-foreground backdrop-blur-sm transition-colors duration-150 hover:text-foreground',
                    isWerewolfLabMode && 'border-stone-600/70 bg-stone-950/35 text-stone-300 hover:text-stone-100'
                  )}
                  onClick={() => openHomeSidebar(homeSidebarTab)}
                  title="展开首页动态侧边栏"
                >
                  <span className="material-symbols-outlined text-3xl">right_panel_open</span>
                  <span className="[writing-mode:vertical-rl] tracking-[0.2em]">
                    {homeSidebarTab === 'commander'
                      ? '指挥官'
                      : homeSidebarTab === 'workflow'
                        ? '工作流'
                        : 'Agent'}
                  </span>
                </button>
              </div>
            ) : null}
          </ResizablePanelGroup>
          )}
        </div>

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
                  onChange={(markdown) => setEditContent(markdown)}
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
            title={workspaceEditorTitle}
          />
        )}
      </div>

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

export default function ChatPage() {
  return (
    <AuthGuard>
      <ChatPageContent />
    </AuthGuard>
  );
}
