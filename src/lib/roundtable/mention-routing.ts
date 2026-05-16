export function extractRoundtableMentions(input: string, participants: string[]): string[] {
  if (!input.trim()) return [];
  const mentions: string[] = [];
  const pushMention = (agentName: string) => {
    if (!mentions.includes(agentName)) mentions.push(agentName);
  };
  const escapedParticipants = participants
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((agentName) => agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const mentionPattern = escapedParticipants.length
    ? new RegExp(`@全员|@(${escapedParticipants.join('|')})`, 'gu')
    : /@全员/gu;
  for (const match of input.matchAll(mentionPattern)) {
    const token = match[0];
    if (token === '@全员') {
      participants.forEach(pushMention);
    } else {
      const agentName = token.slice(1);
      if (participants.includes(agentName)) pushMention(agentName);
    }
  }
  return mentions;
}

export function resolveRoundtableTargetsWithSupervisorFallback(input: {
  content: string;
  participants: string[];
  supervisorAgent?: string | null;
  speaker?: string;
  spokenCounts?: Map<string, number>;
  maxTurnsPerSpeaker?: number;
}): string[] {
  const maxTurnsPerSpeaker = input.maxTurnsPerSpeaker ?? 2;
  const explicitTargets = extractRoundtableMentions(input.content, input.participants)
    .filter((agentName) => agentName !== input.speaker)
    .filter((agentName) => (input.spokenCounts?.get(agentName) || 0) < maxTurnsPerSpeaker);
  if (explicitTargets.length > 0) {
    return explicitTargets;
  }

  const supervisorAgent = String(input.supervisorAgent || '').trim();
  if (!supervisorAgent || supervisorAgent === input.speaker) {
    return [];
  }
  if ((input.spokenCounts?.get(supervisorAgent) || 0) >= maxTurnsPerSpeaker) {
    return [];
  }
  return [supervisorAgent];
}
