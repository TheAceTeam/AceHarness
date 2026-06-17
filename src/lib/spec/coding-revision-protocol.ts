import {
  extractJsonObject as extractStructuredJsonObject,
  extractStructuredResult as extractResultChannelStructuredResult,
  getResultSections,
} from '@/lib/ai/result-channel';

export type SpecCodingRevisionCommand = {
  type: 'spec-coding-revision';
  apply?: boolean;
  summary?: string;
  affectedArtifacts?: string[];
  impact?: string[];
  revisionPlan?: Array<{
    artifact: 'requirements' | 'design' | 'tasks';
    op: 'add' | 'modify' | 'remove' | 'rename';
    targetId: string;
    reason: string;
  }>;
};

function normalizeRevisionPlan(input: unknown): SpecCodingRevisionCommand['revisionPlan'] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const artifact = source.artifact === 'requirements' || source.artifact === 'design' || source.artifact === 'tasks'
        ? source.artifact
        : null;
      const op = source.op === 'add' || source.op === 'modify' || source.op === 'remove' || source.op === 'rename'
        ? source.op
        : null;
      const targetId = typeof source.targetId === 'string' ? source.targetId.trim() : '';
      const reason = typeof source.reason === 'string' ? source.reason.trim() : '';
      if (!artifact || !op || !targetId) return null;
      return {
        artifact,
        op,
        targetId,
        reason,
      };
    })
    .filter((item): item is NonNullable<SpecCodingRevisionCommand['revisionPlan']>[number] => Boolean(item))
    .slice(0, 20);
}

export function extractSpecCodingRevisionCommand(text: string): SpecCodingRevisionCommand | null {
  const resultChannel = extractResultChannelStructuredResult<any>(text, (parsed: any): parsed is any => (
    parsed?.kind === 'spec_coding_revision'
    || parsed?.type === 'spec-coding-revision'
  ));
  const tagged = text.match(/<spec-coding-revision>\s*([\s\S]*?)\s*<\/spec-coding-revision>/i)?.[1];
  const parsed = resultChannel || (tagged ? extractStructuredJsonObject(tagged) : null) || extractStructuredJsonObject(text);
  const candidate = parsed?.kind === 'spec_coding_revision' ? parsed.payload : parsed;
  if (!candidate) return null;

  try {
    if (candidate?.type !== 'spec-coding-revision' && parsed?.kind !== 'spec_coding_revision') return null;
    return {
      type: 'spec-coding-revision',
      apply: candidate.apply !== false,
      summary: typeof candidate.summary === 'string' ? candidate.summary.trim() : '',
      affectedArtifacts: Array.isArray(candidate.affectedArtifacts)
        ? candidate.affectedArtifacts.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 4)
        : [],
      impact: Array.isArray(candidate.impact)
        ? candidate.impact.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 5)
        : [],
      revisionPlan: normalizeRevisionPlan(candidate.revisionPlan),
    };
  } catch {
    return null;
  }
}

export function stripSpecCodingRevisionCommand(text: string): string {
  const withoutLegacyTag = text.replace(/<spec-coding-revision>[\s\S]*?<\/spec-coding-revision>/gi, '');
  const sections = getResultSections(withoutLegacyTag);
  if (sections.length === 0) return withoutLegacyTag.trim();

  let cursor = 0;
  let output = '';
  for (const section of sections) {
    output += withoutLegacyTag.slice(cursor, section.start);
    const parsed = extractStructuredJsonObject(section.content);
    const isRevision = parsed?.kind === 'spec_coding_revision' || parsed?.type === 'spec-coding-revision';
    if (!isRevision) {
      output += withoutLegacyTag.slice(section.start, section.end);
    }
    cursor = section.end;
  }
  output += withoutLegacyTag.slice(cursor);
  return output.trim();
}
