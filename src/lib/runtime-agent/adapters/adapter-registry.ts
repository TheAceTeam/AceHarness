import { getBuiltinAgentDefinition } from '../agent-registry';
import type { RuntimeAdapter, RuntimeAdapterKind } from '../contracts';
import { AcpxAdapter } from './acpx-adapter';
import type { AcpxRuntimeClient } from './acpx-adapter';
import { MagicAdapter } from './magic-adapter';
import type { MagicRuntimeClient } from './magic-adapter';

export interface RuntimeAdapterRegistryOptions {
  acpxClient?: AcpxRuntimeClient;
  magicClient?: MagicRuntimeClient;
}

export interface RuntimeAdapterRegistry {
  getAdapter(kind: RuntimeAdapterKind): RuntimeAdapter;
  getAdapterForAgent(agentId: string): RuntimeAdapter;
}

export function createRuntimeAdapterRegistry(
  options: RuntimeAdapterRegistryOptions = {},
): RuntimeAdapterRegistry {
  const adapters: Record<RuntimeAdapterKind, RuntimeAdapter> = {
    acpx: new AcpxAdapter(options.acpxClient),
    magic: new MagicAdapter(options.magicClient),
  };

  return {
    getAdapter(kind) {
      return adapters[kind];
    },
    getAdapterForAgent(agentId) {
      return adapters[resolveRuntimeForAgent(agentId)];
    },
  };
}

export function resolveRuntimeForAgent(agentId: string): RuntimeAdapterKind {
  return getBuiltinAgentDefinition(agentId)?.runtime ?? 'acpx';
}
