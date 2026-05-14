/**
 * Home Sidebar Plugin System - Core Type Definitions
 *
 * Plugins are defined using TypeScript for type safety and IDE support.
 * Each plugin exports a `definePlugin()` call that declares its capabilities,
 * UI contributions, and lifecycle hooks.
 */

import type { ReactNode } from 'react';
import type {
  PluginContext,
  PluginRenderProps,
  PluginSetupContext,
  BreakpointData,
  PluginRuntimeContext,
} from './capabilities/types';

// Re-export capability types for convenience
export type {
  PluginContext,
  PluginRenderProps,
  PluginRuntimeContext,
  PluginSetupContext,
  ResolvedCapabilities,
  AgentCallingCapability,
  AgentCallInput,
  ResultExtractionCapability,
  BreakpointResumeCapability,
  BreakpointData,
  RoundtableCapability,
  RoundtableSeat,
  PersistenceCapability,
  StreamingDisplayCapability,
  ChatDisplayMessage,
  ThemeCapability,
  AnimationsCapability,
  ModalsCapability,
} from './capabilities/types';

// ─── Capability ID ───

export type CapabilityId =
  | 'agent-calling'
  | 'result-extraction'
  | 'breakpoint-resume'
  | 'roundtable'
  | 'persistence'
  | 'streaming-display'
  | 'theme'
  | 'animations'
  | 'modals';

// ─── Quick Action Config ───

export interface HomePluginQuickAction {
  id: string;
  label: string;
  icon: string;
  color: string;
  prompt: string;
  pinned?: boolean;
  category: string;
  order?: number;
  guide?: {
    title: string;
    description: string;
    samplePrompt: string;
    assistantSteps: string[];
  };
}

export interface HomePluginActionCategory {
  id: string;
  title: string;
  icon: string;
  order?: number;
}

export interface PluginActionConfig {
  categories?: HomePluginActionCategory[];
  items: HomePluginQuickAction[];
}

// ─── Tab Config ───

export interface PluginTabConfig {
  id: string;
  label: string;
  availableWhen?: (ctx: PluginContext) => boolean;
  order?: number;
  render: (props: PluginRenderProps) => ReactNode;
}

// ─── Theme Config ───

export interface PluginThemeConfig {
  id: string;
  classes: {
    panel?: string;
    header?: string;
    section?: string;
    card?: string;
    badge?: string;
    button?: string;
    ghostButton?: string;
  };
  activeWhen?: (ctx: PluginContext) => boolean;
}

// ─── State Machine Config ───

export interface PluginStateMachineConfig {
  initialPhase: string;
  phases: Array<{
    id: string;
    label: string;
    transitions: string[];
  }>;
}

// ─── Breakpoint Config ───

export interface PluginBreakpointConfig {
  handlers: string[];
  onResume?: (breakpoint: BreakpointData, ctx: PluginRuntimeContext) => void | Promise<void>;
}

// ─── Intent Config ───

export interface HomePluginIntent {
  id: string;
  targetTab: string;
  initialStage?: string;
  opensModal?: boolean;
  description?: string;
}

// ─── Tab (legacy compat) ───

export interface HomePluginTab {
  id: string;
  label: string;
  availableWhen?: string[];
  order?: number;
}

// ─── Plugin Context (legacy compat) ───

export interface HomePluginContext {
  hasWorkflow?: boolean;
  hasCollaboration?: boolean;
  hasCreation?: boolean;
  werewolfMode?: boolean;
  sidebarMode?: 'hidden' | 'peek' | 'active';
  [key: string]: unknown;
}

// ─── Plugin Manifest (legacy JSON compat) ───

export interface HomePluginManifest {
  id: string;
  name: string;
  description?: string;
  version?: string;
  author?: string;
  categories?: HomePluginActionCategory[];
  actions?: HomePluginQuickAction[];
  tabs?: HomePluginTab[];
  intents?: HomePluginIntent[];
  enabled?: boolean;
  order?: number;
}

// ─── Full Plugin Definition ───

export interface HomePlugin {
  id: string;
  name: string;
  version?: string;
  enabled?: boolean;

  capabilities: CapabilityId[];

  actions?: PluginActionConfig;
  tab?: PluginTabConfig;
  theme?: PluginThemeConfig;
  stateMachine?: PluginStateMachineConfig;
  breakpoint?: PluginBreakpointConfig;
  intents?: HomePluginIntent[];

  setup?: (ctx: PluginSetupContext) => void | Promise<void>;
  teardown?: () => void;
}

// ─── definePlugin helper ───

/** Type-safe plugin definition helper */
export function definePlugin(plugin: HomePlugin): HomePlugin {
  return plugin;
}
