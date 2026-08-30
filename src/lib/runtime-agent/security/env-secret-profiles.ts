import {
  defaultPermissionPolicy,
  type EnvRequirement,
  type RuntimeEnvVarSnapshot,
  type RuntimeInterruptPolicy,
  type RuntimePermissionPolicyId,
  type RuntimeProfileSnapshot,
  type RuntimeReadiness,
} from '../contracts';

export type RuntimeEnvSource = RuntimeEnvVarSnapshot['source'];

export interface RuntimeEnvProfileVariableDto {
  key: string;
  value?: string;
  secretRef?: string;
  required?: boolean;
  secret?: boolean;
  description?: string;
}

export interface RuntimeEnvProfileDto {
  id: string;
  displayName: string;
  agentId?: string;
  variables: RuntimeEnvProfileVariableDto[];
  createdAt?: string;
  updatedAt?: string;
}

export interface RuntimeSecretProfileEntryDto {
  key: string;
  secretRef: string;
  required?: boolean;
  description?: string;
  readiness: RuntimeReadiness;
}

export interface RuntimeSecretProfileDto {
  id: string;
  displayName: string;
  agentId?: string;
  encrypted: boolean;
  encryptionKeyReady: boolean;
  secrets: RuntimeSecretProfileEntryDto[];
  createdAt?: string;
  updatedAt?: string;
}

export interface RuntimeSecretProfileValue {
  key: string;
  value: string;
  secretRef?: string;
}

export interface RuntimeEnvResolutionInput {
  agentId: string;
  modelRouteId: string;
  cwd: string;
  systemPromptHash: string;
  skillsRevision: string;
  mcpRevision: string;
  interruptPolicy?: RuntimeInterruptPolicy;
  permissionPolicyId?: RuntimePermissionPolicyId;
  envProfile?: RuntimeEnvProfileDto;
  secretProfile?: RuntimeSecretProfileDto;
  secretValues?: readonly RuntimeSecretProfileValue[];
  requirements?: readonly EnvRequirement[];
  turnOverrides?: Record<string, string | undefined>;
  agentDefaults?: Record<string, string | undefined>;
  processEnv?: Record<string, string | undefined>;
}

export interface ResolvedRuntimeEnvVar {
  key: string;
  value?: string;
  source: RuntimeEnvSource;
  secret: boolean;
  readiness: RuntimeReadiness;
}

export interface RuntimeEnvResolutionResult {
  snapshot: RuntimeProfileSnapshot;
  adapterEnv: Record<string, string>;
  conflicts: RuntimeEnvConflict[];
  missing: string[];
}

export interface RuntimeEnvConflict {
  key: string;
  sources: RuntimeEnvSource[];
  selectedSource: RuntimeEnvSource;
}

const SOURCE_PRIORITY: RuntimeEnvSource[] = ['turn-override', 'env-profile', 'secret-profile', 'agent-default', 'process-env'];

function normalizeKey(key: string): string {
  return key.trim();
}

function setCandidate(
  candidates: Map<string, ResolvedRuntimeEnvVar[]>,
  candidate: ResolvedRuntimeEnvVar,
): void {
  const key = normalizeKey(candidate.key);
  if (!key) {
    return;
  }
  const list = candidates.get(key) ?? [];
  list.push({ ...candidate, key });
  candidates.set(key, list);
}

function readinessForValue(
  value: string | undefined,
  required: boolean,
  allowedValues?: readonly string[],
): RuntimeReadiness {
  if (value != null && value !== '') {
    return allowedValues && !allowedValues.includes(value) ? 'misconfigured' : 'ready';
  }
  return required ? 'missing' : 'unknown';
}

function requirementMap(requirements: readonly EnvRequirement[] | undefined): Map<string, EnvRequirement> {
  const map = new Map<string, EnvRequirement>();
  for (const requirement of requirements ?? []) {
    map.set(normalizeKey(requirement.key), requirement);
  }
  return map;
}

function sortCandidates(candidates: ResolvedRuntimeEnvVar[]): ResolvedRuntimeEnvVar[] {
  return [...candidates].sort((a, b) => SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source));
}

export function toPublicSecretProfileDto(profile: RuntimeSecretProfileDto): RuntimeSecretProfileDto {
  return {
    id: profile.id,
    displayName: profile.displayName,
    agentId: profile.agentId,
    encrypted: profile.encrypted,
    encryptionKeyReady: profile.encryptionKeyReady,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    secrets: profile.secrets.map((secret) => ({
      key: secret.key,
      secretRef: secret.secretRef,
      required: secret.required,
      description: secret.description,
      readiness: secret.readiness,
    })),
  };
}

export function resolveRuntimeEnv(input: RuntimeEnvResolutionInput): RuntimeEnvResolutionResult {
  const requirements = requirementMap(input.requirements);
  const candidates = new Map<string, ResolvedRuntimeEnvVar[]>();

  for (const [key, value] of Object.entries(input.processEnv ?? {})) {
    const requirement = requirements.get(normalizeKey(key));
    setCandidate(candidates, {
      key,
      value,
      source: 'process-env',
      secret: Boolean(requirement?.secret),
      readiness: readinessForValue(value, Boolean(requirement?.required), requirement?.allowedValues),
    });
  }

  for (const [key, value] of Object.entries(input.agentDefaults ?? {})) {
    const requirement = requirements.get(normalizeKey(key));
    setCandidate(candidates, {
      key,
      value,
      source: 'agent-default',
      secret: Boolean(requirement?.secret),
      readiness: readinessForValue(value, Boolean(requirement?.required), requirement?.allowedValues),
    });
  }

  const secretValuesByKey = new Map<string, RuntimeSecretProfileValue>();
  for (const secretValue of input.secretValues ?? []) {
    secretValuesByKey.set(normalizeKey(secretValue.key), secretValue);
  }

  const secretProfile = input.secretProfile;
  if (secretProfile) {
    for (const secret of secretProfile.secrets) {
      const key = normalizeKey(secret.key);
      const secretValue = secretValuesByKey.get(key);
      const secretReadiness = !secretProfile.encrypted || !secretProfile.encryptionKeyReady
        ? 'misconfigured'
        : secretValue?.value
          ? 'ready'
          : secret.required
            ? 'missing'
            : secret.readiness;
      setCandidate(candidates, {
        key,
        value: secretValue?.value,
        source: 'secret-profile',
        secret: true,
        readiness: secretReadiness,
      });
    }
  }

  for (const variable of input.envProfile?.variables ?? []) {
    const key = normalizeKey(variable.key);
    const requirement = requirements.get(key);
    const secretValue = variable.secretRef ? [...secretValuesByKey.values()].find((secret) => secret.secretRef === variable.secretRef) : undefined;
    const value = secretValue?.value ?? variable.value;
    const required = Boolean(variable.required ?? requirement?.required);
    setCandidate(candidates, {
      key,
      value,
      source: 'env-profile',
      secret: Boolean(variable.secret ?? variable.secretRef ?? requirement?.secret),
      readiness: variable.secretRef && !secretValue
        ? required ? 'missing' : 'misconfigured'
        : readinessForValue(value, required, requirement?.allowedValues),
    });
  }

  for (const [key, value] of Object.entries(input.turnOverrides ?? {})) {
    const requirement = requirements.get(normalizeKey(key));
    setCandidate(candidates, {
      key,
      value,
      source: 'turn-override',
      secret: Boolean(requirement?.secret),
      readiness: readinessForValue(value, Boolean(requirement?.required), requirement?.allowedValues),
    });
  }

  for (const requirement of requirements.values()) {
    if (!candidates.has(normalizeKey(requirement.key))) {
      setCandidate(candidates, {
        key: requirement.key,
        source: 'process-env',
        secret: requirement.secret,
        readiness: requirement.required ? 'missing' : 'unknown',
      });
    }
  }

  const env: RuntimeEnvVarSnapshot[] = [];
  const adapterEnv: Record<string, string> = {};
  const conflicts: RuntimeEnvConflict[] = [];
  const missing: string[] = [];

  for (const [key, list] of [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = sortCandidates(list);
    const selected = sorted[0];
    const uniqueSources = [...new Set(sorted.map((candidate) => candidate.source))];
    if (uniqueSources.length > 1) {
      conflicts.push({
        key,
        sources: uniqueSources,
        selectedSource: selected.source,
      });
    }
    if (selected.readiness === 'missing' || selected.readiness === 'misconfigured') {
      missing.push(key);
    }
    if (selected.value != null && selected.readiness !== 'misconfigured') {
      adapterEnv[key] = selected.value;
    }
    env.push({
      key,
      source: selected.source,
      secret: selected.secret,
      readiness: selected.readiness,
    });
  }

  return {
    snapshot: {
      agentId: input.agentId,
      modelRouteId: input.modelRouteId,
      cwd: input.cwd,
      systemPromptHash: input.systemPromptHash,
      skillsRevision: input.skillsRevision,
      mcpRevision: input.mcpRevision,
      envProfileId: input.envProfile?.id,
      secretProfileId: input.secretProfile?.id,
      permissionPolicyId: input.permissionPolicyId ?? defaultPermissionPolicy,
      interruptPolicy: input.interruptPolicy ?? 'queue',
      env,
    },
    adapterEnv,
    conflicts,
    missing,
  };
}

export function checkSecretProfileReadiness(profile: RuntimeSecretProfileDto): RuntimeReadiness {
  if (!profile.encrypted || !profile.encryptionKeyReady) {
    return 'misconfigured';
  }
  if (profile.secrets.some((secret) => secret.required && secret.readiness !== 'ready')) {
    return 'missing';
  }
  return profile.secrets.every((secret) => secret.readiness === 'ready' || !secret.required) ? 'ready' : 'unknown';
}
