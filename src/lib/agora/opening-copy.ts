import type { CollaborationChatroomParticipant } from '@/lib/core/home-sidebar-state';

type OpeningToneProfile = {
  keywords: string[];
  examples: string[];
  fallback: string;
};

type OpeningToneParticipant = Pick<CollaborationChatroomParticipant, 'name'>
  & Partial<Pick<CollaborationChatroomParticipant, 'id' | 'sourceType' | 'sourceAgent' | 'presetId' | 'personaPrompt' | 'createdAt'>>;

const OPENING_TONE_PROFILES: OpeningToneProfile[] = [
  {
    keywords: ['code-reviewer', 'code-auditor', 'review', 'auditor', '代码评审', '评审', '审查'],
    examples: ['我先看风险和回归点。', '我先过一遍这次改动。'],
    fallback: '我先看风险和回归点。',
  },
  {
    keywords: ['engineer', 'developer', '工程师', '开发', '实现'],
    examples: ['我先看怎么落地。', '我先过一下实现。'],
    fallback: '我先看怎么落地。',
  },
  {
    keywords: ['architect', '架构师', '架构', '边界', '模块'],
    examples: ['我先从边界和结构看。', '我先看下整体拆分。'],
    fallback: '我先从边界和结构看。',
  },
  {
    keywords: ['tester', 'qa', '测试', '验收', '回归'],
    examples: ['我先补下测试和边界场景。', '我先看哪些地方容易漏。'],
    fallback: '我先补下测试和边界场景。',
  },
  {
    keywords: ['product-manager', '产品经理', '需求', '优先级', '范围', 'pm'],
    examples: ['我先对一下目标和范围。', '我先看用户侧影响。'],
    fallback: '我先对一下目标和范围。',
  },
  {
    keywords: ['copywriter', 'writer', '文案', '写作者', '表达', '命名'],
    examples: ['我先顺一下这句话。', '我先看表达是不是清楚。'],
    fallback: '我先顺一下这句话。',
  },
];

const DEFAULT_OPENING_TONE_PROFILE: OpeningToneProfile = {
  keywords: [],
  examples: ['我先说下我的判断。', '我先听一下上下文。'],
  fallback: '我先说下我的判断。',
};

function getOpeningToneProfile(
  participant: OpeningToneParticipant,
  sourceDescription?: string,
): OpeningToneProfile {
  const haystack = [
    participant.name,
    participant.sourceAgent,
    participant.presetId,
    participant.personaPrompt,
    sourceDescription,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return OPENING_TONE_PROFILES.find((profile) => profile.keywords.some((keyword) => haystack.includes(keyword)))
    || DEFAULT_OPENING_TONE_PROFILE;
}

function looksLikeSlogan(input: string): boolean {
  const text = String(input || '').replace(/\s+/g, '').trim();
  if (!text) return true;
  return /无处遁形|一眼看穿|尽在掌握|稳操胜券|轻松拿捏|手到擒来|不在话下|尽收眼底|面面俱到|由我把关|先过我眼|我来兜底/.test(text);
}

function clipToTwentyChars(input: string): string {
  return Array.from(String(input || '')).slice(0, 20).join('');
}

export function getOpeningToneExamples(
  participant: OpeningToneParticipant,
  sourceDescription?: string,
): string[] {
  return getOpeningToneProfile(participant, sourceDescription).examples;
}

export function buildFallbackOpeningLine(
  participant: OpeningToneParticipant,
  sourceDescription?: string,
): string {
  return getOpeningToneProfile(participant, sourceDescription).fallback;
}

export function normalizeOpeningContent(output: string, fallbackName: string, fallbackLine?: string): string {
  const firstLine = String(output || '')
    .replace(/<result>[\s\S]*?<\/result>/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] || fallbackLine || `${fallbackName}已就位。`;
  const cleaned = firstLine.replace(/^["“”'「」]+|["“”'「」]+$/g, '').trim();
  const normalized = clipToTwentyChars(cleaned || fallbackLine || `${fallbackName}已就位。`);
  if (looksLikeSlogan(normalized)) {
    return clipToTwentyChars(fallbackLine || `${fallbackName}来了，我先听一下。`);
  }
  return normalized;
}
