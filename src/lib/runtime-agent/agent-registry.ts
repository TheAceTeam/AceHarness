import { AGENT_ICON_PATHS } from './agent-icons';

export type AgentId =
  | 'codex'
  | 'claude'
  | 'opencode'
  | 'cursor'
  | 'kiro'
  | 'trae'
  | 'nga'
  | 'codeagent'
  | 'codegenie'
  | 'cangjie-magic'
  | 'pi'
  | 'openclaw'
  | 'gemini'
  | 'copilot'
  | 'kilocode'
  | 'kimi'
  | 'mux'
  | 'qoder'
  | 'qwen'
  | (string & {});

export type AgentRuntime = 'acpx' | 'magic';
export type AgentTier = 'core' | 'verified' | 'hidden';
export type AgentCapabilityValue = boolean | string | number | string[];

export interface AgentCapabilities {
  chat: boolean;
  streaming: boolean;
  tools: boolean;
  mcp: boolean;
  fileEdits: boolean;
  shell: boolean;
  permissions: 'unrestricted-default' | 'agent-managed' | 'runtime-managed';
  session: 'agent-scoped' | 'runtime-scoped';
  [key: string]: AgentCapabilityValue;
}

export interface AgentEnvSchemaVariable {
  name: string;
  required: boolean;
  secret?: boolean;
  description?: string;
}

export interface AgentEnvSchema {
  variables: AgentEnvSchemaVariable[];
}

export interface ModelConfigSchema {
  supportsModelRoute: boolean;
  providerConfigKeys?: string[];
}

export interface AvailabilityProbeSpec {
  kind: 'command';
  command: string;
  args: string[];
  resolver: {
    primaryCommand: string;
    fallbackCommands: string[];
  };
}

export interface AgentDefinition {
  id: AgentId;
  displayName: string;
  runtime: AgentRuntime;
  family?: string;
  command?: string;
  args?: string[];
  fallbackCommands?: string[];
  iconPath: string;
  tier: AgentTier;
  capabilities: AgentCapabilities;
  envSchema: AgentEnvSchema;
  modelConfigSchema?: ModelConfigSchema;
  availabilityProbe: AvailabilityProbeSpec;
}

export type AgentStateSource = 'builtin' | 'override' | 'probe' | 'discovery';
export type AgentAvailabilityStatus = 'unknown' | 'available' | 'missing' | 'error';
export type AgentEnvReadinessStatus = 'unknown' | 'ready' | 'missing' | 'invalid';

export interface AgentAvailabilityState {
  status: AgentAvailabilityStatus;
  checkedAt?: string;
  message?: string;
  source: 'probe';
}

export interface AgentEnvReadinessState {
  status: AgentEnvReadinessStatus;
  checkedAt?: string;
  missingVariables?: string[];
  message?: string;
  source: 'probe';
}

export interface AgentDiscoveryState {
  discoveredAt?: string;
  commandPath?: string;
  version?: string;
  metadata?: Record<string, unknown>;
  source: 'discovery';
}

export interface AgentRuntimeStateDto {
  agentId: AgentId;
  enabled?: boolean;
  hidden?: boolean;
  override?: Partial<
    Pick<
      AgentDefinition,
      | 'displayName'
      | 'command'
      | 'args'
      | 'fallbackCommands'
      | 'iconPath'
      | 'capabilities'
      | 'envSchema'
      | 'modelConfigSchema'
      | 'availabilityProbe'
    >
  >;
  availability?: Omit<AgentAvailabilityState, 'source'>;
  envReadiness?: Omit<AgentEnvReadinessState, 'source'>;
  discovery?: Omit<AgentDiscoveryState, 'source'>;
  capabilityProbe?: Partial<AgentCapabilities>;
}

export interface AgentRuntimeStateRecordLike {
  agentId: string;
  enabled: boolean;
  hidden: boolean;
  override: unknown;
  availabilityStatus?: string;
  availabilityCheckedAt?: string;
  envReadiness: unknown;
  capabilityProbe: unknown;
  discovery: unknown;
}

export interface MergedAgentRuntimeState {
  enabled: boolean;
  hidden: boolean;
  availability: AgentAvailabilityState;
  envReadiness: AgentEnvReadinessState;
  discovery?: AgentDiscoveryState;
}

export interface AgentRegistryEntry {
  definition: AgentDefinition;
  runtimeState: MergedAgentRuntimeState;
  sources: Record<string, AgentStateSource>;
}

type AgentRuntimeStateInput = AgentRuntimeStateDto[] | Record<string, AgentRuntimeStateDto | undefined>;

const FULL_ACPX_CAPABILITIES: AgentCapabilities = {
  chat: true,
  streaming: true,
  tools: true,
  mcp: true,
  fileEdits: true,
  shell: true,
  permissions: 'unrestricted-default',
  session: 'agent-scoped',
};

const OPENCODE_COMPATIBLE_CAPABILITIES: AgentCapabilities = {
  ...FULL_ACPX_CAPABILITIES,
  protocolFamily: 'opencode-compatible',
};

const MAGIC_CAPABILITIES: AgentCapabilities = {
  ...FULL_ACPX_CAPABILITIES,
  session: 'runtime-scoped',
  nativeRuntime: 'cangjie-magic',
};

const EMPTY_ENV_SCHEMA: AgentEnvSchema = {
  variables: [],
};

const MODEL_ROUTE_SCHEMA: ModelConfigSchema = {
  supportsModelRoute: true,
};

function commandProbe(
  command: string,
  args: string[] = ['--version'],
  fallbackCommands: string[] = [],
): AvailabilityProbeSpec {
  return {
    kind: 'command',
    command,
    args,
    resolver: {
      primaryCommand: command,
      fallbackCommands,
    },
  };
}

function acpxAgent(input: {
  id: AgentId;
  displayName: string;
  tier: AgentTier;
  command: string;
  args?: string[];
  fallbackCommands?: string[];
  iconPath: string;
  family?: string;
  capabilities?: AgentCapabilities;
}): AgentDefinition {
  return {
    id: input.id,
    displayName: input.displayName,
    runtime: 'acpx',
    family: input.family,
    command: input.command,
    args: input.args ?? ['acp'],
    fallbackCommands: input.fallbackCommands,
    iconPath: input.iconPath,
    tier: input.tier,
    capabilities: input.capabilities ?? FULL_ACPX_CAPABILITIES,
    envSchema: EMPTY_ENV_SCHEMA,
    modelConfigSchema: MODEL_ROUTE_SCHEMA,
    availabilityProbe: commandProbe(input.command, ['--version'], input.fallbackCommands ?? []),
  };
}

export const BUILTIN_AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  acpxAgent({
    id: 'codex',
    displayName: 'Codex',
    tier: 'core',
    command: 'codex',
    iconPath: AGENT_ICON_PATHS.codex,
  }),
  acpxAgent({
    id: 'claude',
    displayName: 'Claude',
    tier: 'core',
    command: 'claude',
    iconPath: AGENT_ICON_PATHS.claude,
  }),
  acpxAgent({
    id: 'opencode',
    displayName: 'OpenCode',
    tier: 'core',
    command: 'opencode',
    iconPath: AGENT_ICON_PATHS.opencode,
  }),
  {
    id: 'cangjie-magic',
    displayName: 'Cangjie Magic',
    runtime: 'magic',
    command: 'magic',
    args: [],
    fallbackCommands: ['cangjie-magic', 'magic-cli'],
    iconPath: AGENT_ICON_PATHS.cangjieMagic,
    tier: 'core',
    capabilities: MAGIC_CAPABILITIES,
    envSchema: EMPTY_ENV_SCHEMA,
    modelConfigSchema: MODEL_ROUTE_SCHEMA,
    availabilityProbe: commandProbe('magic', ['--version'], ['cangjie-magic', 'magic-cli']),
  },
  acpxAgent({
    id: 'cursor',
    displayName: 'Cursor',
    tier: 'verified',
    command: 'cursor',
    iconPath: AGENT_ICON_PATHS.cursor,
  }),
  acpxAgent({
    id: 'kiro',
    displayName: 'Kiro',
    tier: 'verified',
    command: 'kiro',
    iconPath: AGENT_ICON_PATHS.kiro,
  }),
  acpxAgent({
    id: 'trae',
    displayName: 'Trae',
    tier: 'verified',
    command: 'trae',
    iconPath: AGENT_ICON_PATHS.trae,
  }),
  acpxAgent({
    id: 'nga',
    displayName: 'NGA',
    tier: 'verified',
    command: 'ngagent',
    args: ['acp'],
    fallbackCommands: ['nga'],
    iconPath: AGENT_ICON_PATHS.nga,
    family: 'opencode-compatible',
    capabilities: OPENCODE_COMPATIBLE_CAPABILITIES,
  }),
  acpxAgent({
    id: 'codeagent',
    displayName: 'CodeAgent',
    tier: 'verified',
    command: 'ngagent',
    args: ['acp'],
    fallbackCommands: ['nga'],
    iconPath: AGENT_ICON_PATHS.codeagent,
    family: 'claude',
  }),
  acpxAgent({
    id: 'codegenie',
    displayName: 'CodeGenie',
    tier: 'verified',
    command: 'codegenie',
    args: ['acp'],
    iconPath: AGENT_ICON_PATHS.codegenie,
    family: 'opencode-compatible',
    capabilities: OPENCODE_COMPATIBLE_CAPABILITIES,
  }),
  acpxAgent({ id: 'pi', displayName: 'Pi', tier: 'verified', command: 'pi', iconPath: AGENT_ICON_PATHS.pi }),
  acpxAgent({ id: 'openclaw', displayName: 'OpenClaw', tier: 'verified', command: 'openclaw', iconPath: AGENT_ICON_PATHS.openclaw }),
  acpxAgent({ id: 'gemini', displayName: 'Gemini', tier: 'verified', command: 'gemini', iconPath: AGENT_ICON_PATHS.gemini }),
  acpxAgent({ id: 'copilot', displayName: 'Copilot', tier: 'verified', command: 'copilot', iconPath: AGENT_ICON_PATHS.copilot }),
  acpxAgent({ id: 'kilocode', displayName: 'Kilo Code', tier: 'verified', command: 'kilocode', iconPath: AGENT_ICON_PATHS.kilocode }),
  acpxAgent({ id: 'kimi', displayName: 'Kimi', tier: 'verified', command: 'kimi', iconPath: AGENT_ICON_PATHS.kimi }),
  acpxAgent({ id: 'mux', displayName: 'Mux', tier: 'verified', command: 'mux', iconPath: AGENT_ICON_PATHS.mux }),
  acpxAgent({ id: 'qoder', displayName: 'Qoder', tier: 'verified', command: 'qoder', iconPath: AGENT_ICON_PATHS.qoder }),
  acpxAgent({ id: 'qwen', displayName: 'Qwen', tier: 'verified', command: 'qwen', iconPath: AGENT_ICON_PATHS.qwen }),
] as const;

export const BUILTIN_AGENT_DEFINITIONS_BY_ID: ReadonlyMap<AgentId, AgentDefinition> = new Map(
  BUILTIN_AGENT_DEFINITIONS.map((agent) => [agent.id, agent]),
);

export function getBuiltinAgentDefinitions(tiers?: readonly AgentTier[]): AgentDefinition[] {
  const allowedTiers = tiers ? new Set(tiers) : undefined;
  return BUILTIN_AGENT_DEFINITIONS
    .filter((definition) => !allowedTiers || allowedTiers.has(definition.tier))
    .map(cloneAgentDefinition);
}

export function getBuiltinAgentDefinition(agentId: AgentId): AgentDefinition | undefined {
  const definition = BUILTIN_AGENT_DEFINITIONS_BY_ID.get(agentId);
  return definition ? cloneAgentDefinition(definition) : undefined;
}

export function mergeAgentRuntimeState(
  runtimeStates: AgentRuntimeStateInput = [],
  definitions: readonly AgentDefinition[] = BUILTIN_AGENT_DEFINITIONS,
): AgentRegistryEntry[] {
  const stateByAgentId = normalizeRuntimeStates(runtimeStates);
  const builtinEntries = definitions.map((definition) => {
    const runtimeState = stateByAgentId.get(definition.id);
    return mergeDefinitionWithState(definition, runtimeState);
  });

  const discoveredEntries = [...stateByAgentId.values()]
    .filter((state) => !definitions.some((definition) => definition.id === state.agentId))
    .map(createDiscoveredAgentEntry);

  return [...builtinEntries, ...discoveredEntries];
}

export function runtimeStateRecordsToDtos(records: readonly AgentRuntimeStateRecordLike[]): AgentRuntimeStateDto[] {
  return records.map(runtimeStateRecordToDto);
}

export function runtimeStateRecordToDto(record: AgentRuntimeStateRecordLike): AgentRuntimeStateDto {
  const availability = normalizeAvailability(record.availabilityStatus, record.availabilityCheckedAt);
  return {
    agentId: record.agentId,
    enabled: record.enabled,
    hidden: record.hidden,
    override: isObject(record.override) ? record.override : undefined,
    availability,
    envReadiness: isEnvReadiness(record.envReadiness) ? record.envReadiness : undefined,
    discovery: isObject(record.discovery) ? record.discovery : undefined,
    capabilityProbe: isCapabilitiesPatch(record.capabilityProbe) ? record.capabilityProbe : undefined,
  };
}

function mergeDefinitionWithState(
  builtinDefinition: AgentDefinition,
  runtimeState?: AgentRuntimeStateDto,
): AgentRegistryEntry {
  const override = runtimeState?.override ?? {};
  const capabilityProbe = runtimeState?.capabilityProbe ?? {};
  const definition: AgentDefinition = {
    ...cloneAgentDefinition(builtinDefinition),
    ...override,
    id: builtinDefinition.id,
    runtime: builtinDefinition.runtime,
    tier: builtinDefinition.tier,
    capabilities: mergeCapabilities(builtinDefinition.capabilities, override.capabilities, capabilityProbe),
  };

  const defaultHidden = definition.tier === 'hidden';
  const sources: Record<string, AgentStateSource> = {
    definition: 'builtin',
    enabled: runtimeState?.enabled === undefined ? 'builtin' : 'override',
    hidden: runtimeState?.hidden === undefined ? 'builtin' : 'override',
    availability: runtimeState?.availability ? 'probe' : 'builtin',
    envReadiness: runtimeState?.envReadiness ? 'probe' : 'builtin',
  };

  if (Object.keys(override).length > 0) {
    sources.override = 'override';
  }

  if (runtimeState?.capabilityProbe) {
    sources.capabilities = 'probe';
  }

  if (runtimeState?.discovery) {
    sources.discovery = 'discovery';
  }

  return {
    definition,
    runtimeState: {
      enabled: runtimeState?.enabled ?? true,
      hidden: runtimeState?.hidden ?? defaultHidden,
      availability: runtimeState?.availability
        ? { ...runtimeState.availability, source: 'probe' }
        : { status: 'unknown', source: 'probe' },
      envReadiness: runtimeState?.envReadiness
        ? { ...runtimeState.envReadiness, source: 'probe' }
        : { status: 'unknown', source: 'probe' },
      discovery: runtimeState?.discovery
        ? { ...runtimeState.discovery, source: 'discovery' }
        : undefined,
    },
    sources,
  };
}

function createDiscoveredAgentEntry(runtimeState: AgentRuntimeStateDto): AgentRegistryEntry {
  const command = runtimeState.override?.command ?? runtimeState.discovery?.commandPath ?? runtimeState.agentId;
  const definition: AgentDefinition = {
    id: runtimeState.agentId,
    displayName: runtimeState.override?.displayName ?? runtimeState.agentId,
    runtime: 'acpx',
    command,
    args: runtimeState.override?.args ?? ['acp'],
    fallbackCommands: runtimeState.override?.fallbackCommands,
    iconPath: runtimeState.override?.iconPath ?? AGENT_ICON_PATHS.genericProvider,
    tier: 'hidden',
    capabilities: mergeCapabilities(
      FULL_ACPX_CAPABILITIES,
      runtimeState.override?.capabilities,
      runtimeState.capabilityProbe,
    ),
    envSchema: runtimeState.override?.envSchema ?? EMPTY_ENV_SCHEMA,
    modelConfigSchema: runtimeState.override?.modelConfigSchema ?? MODEL_ROUTE_SCHEMA,
    availabilityProbe: runtimeState.override?.availabilityProbe ?? commandProbe(command),
  };

  return mergeDefinitionWithState(definition, {
    ...runtimeState,
    hidden: runtimeState.hidden ?? true,
  });
}

function normalizeRuntimeStates(runtimeStates: AgentRuntimeStateInput): Map<AgentId, AgentRuntimeStateDto> {
  if (Array.isArray(runtimeStates)) {
    return new Map(runtimeStates.map((state) => [state.agentId, state]));
  }

  return new Map(
    Object.entries(runtimeStates)
      .filter((entry): entry is [string, AgentRuntimeStateDto] => Boolean(entry[1]))
      .map(([agentId, state]) => [state.agentId ?? agentId, { ...state, agentId: state.agentId ?? agentId }]),
  );
}

function mergeCapabilities(
  base: AgentCapabilities,
  ...patches: Array<Partial<AgentCapabilities> | undefined>
): AgentCapabilities {
  const capabilities = { ...base };

  for (const patch of patches) {
    if (!patch) {
      continue;
    }

    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        capabilities[key] = value;
      }
    }
  }

  return capabilities;
}

function cloneAgentDefinition(definition: AgentDefinition): AgentDefinition {
  return {
    ...definition,
    args: definition.args ? [...definition.args] : undefined,
    fallbackCommands: definition.fallbackCommands ? [...definition.fallbackCommands] : undefined,
    capabilities: { ...definition.capabilities },
    envSchema: {
      variables: definition.envSchema.variables.map((variable) => ({ ...variable })),
    },
    modelConfigSchema: definition.modelConfigSchema
      ? {
          ...definition.modelConfigSchema,
          providerConfigKeys: definition.modelConfigSchema.providerConfigKeys
            ? [...definition.modelConfigSchema.providerConfigKeys]
            : undefined,
        }
      : undefined,
    availabilityProbe: {
      ...definition.availabilityProbe,
      args: [...definition.availabilityProbe.args],
      resolver: {
        primaryCommand: definition.availabilityProbe.resolver.primaryCommand,
        fallbackCommands: [...definition.availabilityProbe.resolver.fallbackCommands],
      },
    },
  };
}

function normalizeAvailability(
  status: string | undefined,
  checkedAt: string | undefined,
): Omit<AgentAvailabilityState, 'source'> | undefined {
  if (!status || status === 'unknown') {
    return undefined;
  }

  if (status === 'available' || status === 'missing' || status === 'error') {
    return { status, checkedAt };
  }

  return {
    status: 'error',
    checkedAt,
    message: `Runtime availability probe reported ${status}`,
  };
}

function isObject<T extends Record<string, unknown>>(value: unknown): value is T {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEnvReadiness(value: unknown): value is Omit<AgentEnvReadinessState, 'source'> {
  return isObject(value) && typeof value.status === 'string';
}

function isCapabilitiesPatch(value: unknown): value is Partial<AgentCapabilities> {
  if (!isObject(value)) {
    return false;
  }

  return Object.values(value).every((entry) => (
    typeof entry === 'boolean'
    || typeof entry === 'string'
    || typeof entry === 'number'
    || (Array.isArray(entry) && entry.every((item) => typeof item === 'string'))
  ));
}
