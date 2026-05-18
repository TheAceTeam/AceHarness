'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { PluginRuntimeContext, ResolvedCapabilities } from '@/lib/sidebar-plugins';

interface PluginCapabilityContextValue {
  ctx: PluginRuntimeContext;
  capabilities: ResolvedCapabilities;
}

const PluginCapabilityContext = createContext<PluginCapabilityContextValue | null>(null);

interface PluginCapabilityProviderProps {
  children: React.ReactNode;
  /** Runtime context values */
  sessionId: string | null;
  ensureSessionId: () => string;
  engine: string;
  model: string;
  toast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
  router: { push: (url: string) => void };
  /** Resolved capabilities (provided by the host component that owns the state) */
  capabilities: ResolvedCapabilities;
}

/**
 * Provides plugin runtime context and capabilities to all plugin components.
 * This is the bridge between the host (HomeCommandSidebar) and plugin components.
 */
export function PluginCapabilityProvider({
  children,
  sessionId,
  ensureSessionId,
  engine,
  model,
  toast,
  router,
  capabilities,
}: PluginCapabilityProviderProps) {
  const ctx: PluginRuntimeContext = useMemo(() => ({
    sessionId,
    ensureSessionId,
    engine,
    model,
    toast,
    router,
  }), [sessionId, ensureSessionId, engine, model, toast, router]);

  const value = useMemo(() => ({ ctx, capabilities }), [ctx, capabilities]);

  return (
    <PluginCapabilityContext.Provider value={value}>
      {children}
    </PluginCapabilityContext.Provider>
  );
}

/** Hook to access plugin runtime context */
export function usePluginContext(): PluginRuntimeContext {
  const value = useContext(PluginCapabilityContext);
  if (!value) throw new Error('usePluginContext must be used within PluginCapabilityProvider');
  return value.ctx;
}

/** Hook to access all resolved capabilities */
export function usePluginCapabilities(): ResolvedCapabilities {
  const value = useContext(PluginCapabilityContext);
  if (!value) throw new Error('usePluginCapabilities must be used within PluginCapabilityProvider');
  return value.capabilities;
}

/** Hook to access a specific capability by key */
export function useCapability<K extends keyof ResolvedCapabilities>(
  key: K
): NonNullable<ResolvedCapabilities[K]> {
  const capabilities = usePluginCapabilities();
  const cap = capabilities[key];
  if (!cap) throw new Error(`Capability "${key}" is not available. Did the plugin declare it?`);
  return cap as NonNullable<ResolvedCapabilities[K]>;
}
