/**
 * Plugin Capability Interfaces
 *
 * Each capability is a contract that plugins can request.
 * The PluginCapabilityProvider resolves these at runtime.
 */

import type { ReactNode } from 'react';
import type { CollaborationRoomState, CollaborationRoomMessage } from '@/lib/core/home-sidebar-state';

// ─── Runtime Context ───

/** 插件运行时上下文 — 所有插件都能访问 */
export interface PluginRuntimeContext {
  sessionId: string | null;
  ensureSessionId: () => string;
  engine: string;
  model: string;
  toast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
  router: { push: (url: string) => void };
}

/** 插件渲染 Props — 传给 tab.render() */
export interface PluginRenderProps {
  ctx: PluginRuntimeContext;
  capabilities: ResolvedCapabilities;
  state: any;
  setState: (updater: (prev: any) => any) => void;
}

/** 插件 setup 上下文 */
export interface PluginSetupContext extends PluginRuntimeContext {
  onIntent: (intentId: string, handler: (data?: any) => void | Promise<void>) => void;
  onMessage: (filter: MessageFilter, handler: MessageHandler) => void;
}

/** 消息过滤器 */
export interface MessageFilter {
  speakerType?: string;
  action?: string;
  phase?: string;
}

/** 消息处理器 */
export type MessageHandler = (message: CollaborationRoomMessage) => void;

/** 插件上下文（用于条件判断） */
export interface PluginContext {
  hasWorkflow: boolean;
  hasCollaboration: boolean;
  hasCreation: boolean;
  activeIntent?: string;
  activePhase?: string;
}

// ─── Agent Calling ───

export interface AgentCallingCapability {
  call(input: AgentCallInput): Promise<string>;
  getSession(agentName: string): string | undefined;
  setSession(agentName: string, sessionId: string): void;
}

export interface AgentCallInput {
  agentName: string;
  message: string;
  roundId?: string;
  messageMeta?: Record<string, any>;
  temporaryRoleConfig?: Record<string, any>;
}

// ─── Result Extraction ───

export interface ResultExtractionCapability {
  extract<T>(text: string, predicate: (v: any) => v is T): T | null;
  strip(text: string): string;
}

// ─── Breakpoint Resume ───

export interface BreakpointResumeCapability {
  set(data: BreakpointData): void;
  get(): BreakpointData | null;
  clear(): void;
  shouldSkip(stepId: string, stepOrder: string[]): boolean;
}

export interface BreakpointData {
  handler: string;
  roundId?: string;
  stepLabel?: string;
  resumeFrom?: string;
  failedActor?: string;
  failedAt?: number;
  error?: string;
}

// ─── Persistence ───

export interface PersistenceCapability {
  get<T>(key?: string): T | undefined;
  set<T>(updater: (prev: T | undefined) => T, key?: string): void;
  getRoom(): CollaborationRoomState | undefined;
  updateRoom(updater: (room: CollaborationRoomState) => CollaborationRoomState): void;
}

// ─── Streaming Display ───

export interface StreamingDisplayCapability {
  start(messageId: string): void;
  appendMessage(message: ChatDisplayMessage): void;
  updateMessage(messageId: string, patch: Partial<ChatDisplayMessage>): void;
  end(messageId: string): void;
}

export interface ChatDisplayMessage {
  id?: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  rawContent?: string;
  cards?: any[];
  engine?: string;
  model?: string;
}

// ─── Theme ───

export interface ThemeCapability {
  activate(themeId: string): void;
  deactivate(): void;
  getClass(element: string): string;
}

// ─── Animations ───

export interface AnimationsCapability {
  showPhaseBanner(text: string, durationMs?: number): void;
  triggerSeatAnimation(seatId: string, type: 'fall' | 'disconnect' | 'fadeIn'): void;
}

// ─── Modals ───

export interface ModalsCapability {
  open(modalId: string, props?: Record<string, any>): void;
  close(modalId: string): void;
  register(modalId: string, component: React.ComponentType<any>): void;
}

// ─── Resolved Capabilities ───

export interface ResolvedCapabilities {
  agentCalling?: AgentCallingCapability;
  resultExtraction?: ResultExtractionCapability;
  breakpointResume?: BreakpointResumeCapability;
  persistence?: PersistenceCapability;
  streamingDisplay?: StreamingDisplayCapability;
  theme?: ThemeCapability;
  animations?: AnimationsCapability;
  modals?: ModalsCapability;
}
