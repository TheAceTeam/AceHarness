export type AgentDraftIntent = {
  displayName: string;
  team: 'blue' | 'red' | 'judge' | 'yellow' | 'black-gold';
  mission: string;
  style: string;
  specialties: string;
  workingDirectory?: string;
  canCode?: 'yes' | 'no';
  canSupervise?: 'yes' | 'no';
  referenceWorkflow?: string;
};

export const DEFAULT_AGENT_DRAFT_INTENT: AgentDraftIntent = {
  displayName: '',
  team: 'blue',
  mission: '',
  style: '理性、可靠、执行力强',
  specialties: '',
  workingDirectory: '',
  canCode: 'yes',
  canSupervise: 'no',
  referenceWorkflow: '',
};

export function normalizeAgentDraftIntent(
  input?: Partial<AgentDraftIntent> | null
): AgentDraftIntent {
  return {
    ...DEFAULT_AGENT_DRAFT_INTENT,
    ...input,
    displayName: String(input?.displayName || '').trim(),
    team: (['blue', 'red', 'judge', 'yellow', 'black-gold'].includes(String(input?.team || ''))
      ? input?.team
      : DEFAULT_AGENT_DRAFT_INTENT.team) as AgentDraftIntent['team'],
    mission: String(input?.mission || '').trim(),
    style: String(input?.style || DEFAULT_AGENT_DRAFT_INTENT.style).trim(),
    specialties: String(input?.specialties || '').trim(),
    workingDirectory: String(input?.workingDirectory || '').trim(),
    canCode: input?.canCode === 'no' ? 'no' : 'yes',
    canSupervise: input?.canSupervise === 'yes' ? 'yes' : 'no',
    referenceWorkflow: String(input?.referenceWorkflow || '').trim(),
  };
}

export function mergeAgentDraftIntent(
  base: AgentDraftIntent,
  patch?: Partial<AgentDraftIntent> | null
): AgentDraftIntent {
  if (!patch) return normalizeAgentDraftIntent(base);
  const normalizedPatch = normalizeAgentDraftIntent({ ...base, ...patch });
  return {
    ...base,
    ...normalizedPatch,
    displayName: patch.displayName === undefined ? base.displayName : normalizedPatch.displayName,
    team: patch.team === undefined ? base.team : normalizedPatch.team,
    mission: patch.mission === undefined ? base.mission : normalizedPatch.mission,
    style: patch.style === undefined ? base.style : normalizedPatch.style,
    specialties: patch.specialties === undefined ? base.specialties : normalizedPatch.specialties,
    workingDirectory: patch.workingDirectory === undefined ? base.workingDirectory : normalizedPatch.workingDirectory,
    canCode: patch.canCode === undefined ? base.canCode : normalizedPatch.canCode,
    canSupervise: patch.canSupervise === undefined ? base.canSupervise : normalizedPatch.canSupervise,
    referenceWorkflow: patch.referenceWorkflow === undefined ? base.referenceWorkflow : normalizedPatch.referenceWorkflow,
  };
}
