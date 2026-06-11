'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import SpriteAvatar from '@/components/SpriteAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollaborationRoomSurface } from '@/components/collaboration/CollaborationRoomSurface';
import { EngineSelect } from '@/components/EngineSelect';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ModelSelect } from '@/components/ModelSelect';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import { extractJsonObject, getResultSections } from '@/lib/ai/result-channel';
import { normalizeAssistantDisplay } from '@/lib/chat/actions';
import { cn } from '@/lib/core/utils';
import type {
  CollaborationChatroomMode,
  CollaborationChatroomParticipant,
  CollaborationChatroomRound,
  CollaborationChatroomState,
  CollaborationChatroomSummary,
  CollaborationChatroomVote,
  CollaborationRoomMessage,
  CollaborationRoomState,
} from '@/lib/core/home-sidebar-state';
import { detectOpeningRole, type OpeningRole } from '@/lib/agora/opening-copy';
import { createInitialChatroomState, ensureChatroomRoomState } from '@/lib/agora/chatroom-state';

export interface AgoraChatPanelProps {
  availableAgents: Array<{ name: string; description?: string }>;
  room: CollaborationRoomState | null;
  updateRoom: (updater: (room: CollaborationRoomState) => CollaborationRoomState) => void;
  appendToCentralChat?: (message: CollaborationRoomMessage) => void;
  onInsertIntoMainInput?: (content: string) => void;
  onRegisterMainInputHandler?: (handler: ((text: string) => void) | null) => void;
  displayRoomTranscriptWhenMirrored?: boolean;
  mirrorHumanMessagesToCentral?: boolean;
  layout?: 'panel' | 'workspace';
  hideComposer?: boolean;
  allowTopicControls?: boolean;
  showComposerControls?: boolean;
  inlineContent?: ReactNode;
  inlineContentSpeakerName?: string;
  currentUser?: {
    username?: string;
    email?: string;
    avatar?: string;
    name?: string;
    nickname?: string;
    displayName?: string;
  } | null;
  callAgent: (
    agentName: string,
    message: string,
    roundId?: string,
    messagePatch?: Pick<CollaborationRoomMessage, 'chatroom'>,
    temporaryRoleConfig?: Record<string, any>,
    lifecycle?: {
      onStreamStart?: (stream: {
        streamId: string;
        runtimeName: string;
        stop: () => Promise<void>;
      }) => void;
      onDelta?: (content: string, accumulated: string) => void;
    }
  ) => Promise<{
    status: 'done' | 'stopped';
    content: string;
    rawContent: string;
    engine?: string;
    model?: string;
  }>;
  toast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}

type ActiveRoomStream = {
  roundId?: string;
  stop: () => Promise<void>;
};

type VoteDraft = {
  question: string;
  options: string;
  allowAbstain: boolean;
};

type TemporaryAgentDraft = {
  id?: string;
  name: string;
  sourceType: 'agent' | 'custom' | 'preset';
  sourceAgent: string;
  personaPrompt: string;
  useDefaultModel: boolean;
  engine: string;
  model: string;
};

const MODE_LABELS: Record<CollaborationChatroomMode, string> = {
  broadcast: '全员回应',
  'mention-driven': '点名接话',
  facilitated: '群聊',
};

const USER_LED_AGENT_REPLY_LIMIT = 2;
const USER_LED_AGENT_REPLY_PER_PARTICIPANT = 1;

const AGORA_NATURAL_CONVERSATION_GUIDE = [
  '说中文时用接近日常沟通的口语，别写成公文、周报或客服模板。',
  '顺着上一条消息自然接话，像同事讨论一样补充、认同、追问或推进，不要把每次回答都写成独立报告。',
  '句子长短可以有变化，多用短句，少用“首先、其次、最后、综上、基于以上”这类模板化收束。',
  '同一个意思尽量换种说法，别反复套同一句话，也不要每次都重复自我介绍岗位。',
  '普通交流控制在 2 到 5 句，问题复杂时再展开，但依然要利落。',
  '有判断就直接说，按需要补依据、风险或下一步，不用每次都硬拆成固定四段。',
  '默认不要为了流程硬性 @ 其他嘉宾；只有真的需要某个人接棒、用户明确要求，或不点名会产生歧义时再提及对方。',
  '全程围绕用户当前关心的问题，不跑题，不替其他嘉宾代言。',
];

const AGORA_ROLE_STYLE_GUIDES: Record<OpeningRole, string> = {
  engineer: '你是工程侧视角，说话务实一点，先聊能不能做、改哪里、成本多大、哪儿最容易翻车。',
  architect: '你是架构侧视角，先看边界、依赖、演进路线和长期复杂度，语气稳一点，但别端着。',
  'code-reviewer': '你是评审侧视角，习惯先盯风险、坏味道和回归隐患，表达可以直接，但别像在下判决书。',
  tester: '你是测试侧视角，重点看边界条件、失败路径、验证方法和回归范围，细一点但别啰嗦。',
  'product-manager': '你是产品侧视角，先对目标、用户影响、范围和优先级做判断，说法灵活，不要像在念 PRD。',
  copywriter: '你是文案侧视角，关注表达顺不顺、信息清不清、用户会不会误解，语气自然温和一些。',
  generic: '保持真实同事聊天的状态，有判断也留余地，别说成标准答案。',
};

function buildAgoraConversationStyleGuide(
  participant: Pick<CollaborationChatroomParticipant, 'name'>
    & Partial<Pick<CollaborationChatroomParticipant, 'id' | 'sourceType' | 'sourceAgent' | 'presetId' | 'runtimeAgentName' | 'personaPrompt' | 'createdAt'>>,
  sourceDescription?: string
) {
  const role = detectOpeningRole(participant, sourceDescription);
  return [
    AGORA_NATURAL_CONVERSATION_GUIDE.join('\n'),
    AGORA_ROLE_STYLE_GUIDES[role],
  ].join('\n');
}

function buildAgoraSummaryStyleGuide() {
  return [
    '总结也用自然中文，像同事帮大家收一下讨论，不要写成正式汇报。',
    '把共识、分歧、风险、下一步说清楚就行，能短就短，别重复前文套话。',
  ].join('\n');
}
const AGENT_REPLY_DELAY_MIN_MS = 1000;
const AGENT_REPLY_DELAY_JITTER_MS = 2000;
const AGORA_RESULT_KIND = 'agora_result';

type AgoraResultType = 'speech' | 'summary' | 'vote';

type AgoraStructuredResult =
  | {
      type: 'speech';
      content: string;
      mentions: string[];
    }
  | {
      type: 'summary';
      content: string;
      title?: string;
    }
  | {
      type: 'vote';
      content: string;
      choice: string;
      reason: string;
    };

const ANCIENT_STYLE_SURNAMES = ['子车', '司空', '上官', '公孙', '令狐', '诸葛', '东方', '尉迟', '慕容', '宇文', '谢', '沈', '顾', '苏', '楚', '陆', '秦', '柳', '白', '萧'];
const ANCIENT_STYLE_GIVEN_PREFIXES = ['雪', '清', '知', '听', '疏', '明', '映', '流', '寒', '星', '若', '云', '青', '景', '书', '月'];
const ANCIENT_STYLE_GIVEN_SUFFIXES = ['兰', '宁', '晏', '辞', '微', '舟', '岚', '音', '霁', '棠', '遥', '歌', '汐', '禾', '言', '玉'];

function generateAncientStyleGuestName(existingNames: string[]) {
  const existing = new Set(existingNames);
  const total = ANCIENT_STYLE_SURNAMES.length * ANCIENT_STYLE_GIVEN_PREFIXES.length * ANCIENT_STYLE_GIVEN_SUFFIXES.length;
  const start = Date.now() % total;
  for (let offset = 0; offset < total; offset += 1) {
    const index = (start + offset) % total;
    const surnameIndex = Math.floor(index / (ANCIENT_STYLE_GIVEN_PREFIXES.length * ANCIENT_STYLE_GIVEN_SUFFIXES.length));
    const givenIndex = index % (ANCIENT_STYLE_GIVEN_PREFIXES.length * ANCIENT_STYLE_GIVEN_SUFFIXES.length);
    const prefixIndex = Math.floor(givenIndex / ANCIENT_STYLE_GIVEN_SUFFIXES.length);
    const suffixIndex = givenIndex % ANCIENT_STYLE_GIVEN_SUFFIXES.length;
    const candidate = `${ANCIENT_STYLE_SURNAMES[surnameIndex]}${ANCIENT_STYLE_GIVEN_PREFIXES[prefixIndex]}${ANCIENT_STYLE_GIVEN_SUFFIXES[suffixIndex]}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `嘉宾${existingNames.length + 1}`;
}

function getInitials(name: string) {
  return name
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || name.slice(0, 2).toUpperCase();
}

function getSpeakerAvatarSrc(name: string, kind: 'agent' | 'host' | 'system', avatarSeed?: string) {
  if (kind === 'host') {
    return resolveAgentAvatarSrc(undefined, `host:${name}`, { roleType: 'supervisor', team: 'black-gold' });
  }
  if (kind === 'system') {
    return resolveAgentAvatarSrc(undefined, `system:${name}`, { team: 'judge' });
  }
  return resolveAgentAvatarSrc(undefined, avatarSeed || name);
}

function getCurrentUserDisplayName(user?: AgoraChatPanelProps['currentUser']) {
  return String(user?.displayName || user?.nickname || user?.name || user?.username || user?.email || '你').trim() || '你';
}

function normalizeUserIdentity(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function buildCurrentUserIdentitySet(user?: AgoraChatPanelProps['currentUser']) {
  const email = String(user?.email || '').trim();
  const emailLocalPart = email.includes('@') ? email.slice(0, email.indexOf('@')).trim() : '';
  return new Set(
    [
      user?.displayName,
      user?.nickname,
      user?.name,
      user?.username,
      email,
      emailLocalPart,
      '你',
      '我',
    ]
      .map((value) => normalizeUserIdentity(value))
      .filter(Boolean)
  );
}

function resolveCurrentUserAvatarSrc(avatar?: string | null) {
  return String(avatar || '').trim();
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getAgentReplyDelayMs() {
  if (process.env.NODE_ENV === 'test') return 0;
  return AGENT_REPLY_DELAY_MIN_MS + Math.floor(Math.random() * AGENT_REPLY_DELAY_JITTER_MS);
}

function takeParticipantsFromOffset(participants: string[], offset: number, count: number) {
  if (!participants.length || count <= 0) return [];
  const picked: string[] = [];
  for (let index = 0; index < participants.length && picked.length < count; index += 1) {
    const candidate = participants[(offset + index) % participants.length];
    if (candidate && !picked.includes(candidate)) picked.push(candidate);
  }
  return picked;
}

function resolveRoundParticipants(input: {
  participants: string[];
  mentions: string[];
  mode: CollaborationChatroomMode;
  roundIndex: number;
}) {
  const cappedMentions = input.mentions.slice(0, USER_LED_AGENT_REPLY_LIMIT);
  if (cappedMentions.length) return cappedMentions;
  if (input.mode === 'broadcast') {
    return takeParticipantsFromOffset(input.participants, input.roundIndex, USER_LED_AGENT_REPLY_LIMIT);
  }
  return takeParticipantsFromOffset(input.participants, input.roundIndex, 1);
}

function buildChatroomParticipantRoleConfig(
  participant: CollaborationChatroomParticipant,
  runtime: { engine?: string; model?: string },
  sourceDescription?: string
) {
  const selectedEngine = String(runtime.engine || '').trim();
  const selectedModel = String(runtime.model || '').trim();
  const persona = participant.sourceType === 'custom'
    ? participant.personaPrompt
    : `${participant.sourceAgent || participant.name}${sourceDescription ? `：${sourceDescription}` : ''}`;
  const identityName = participant.runtimeAgentName || participant.guestConfigId || participant.name;
  const sourceLabel = participant.sourceType === 'custom'
    ? `你的人格与行为准则：${participant.personaPrompt || persona}`
    : participant.sourceType === 'preset'
      ? `你的预设来源：${participant.presetId || participant.sourceAgent || participant.name}${sourceDescription ? `。参考描述：${sourceDescription}` : ''}`
      : `你的人格来源：${participant.sourceAgent || participant.name}${sourceDescription ? `。参考描述：${sourceDescription}` : ''}`;
  const baseSystemPrompt = participant.systemPrompt || [
    `你是议场嘉宾「${participant.name}」。你的持久身份 ID 是「${identityName}」。`,
    sourceLabel,
    '你的任务是在多人群聊里像真人同事一样自然发言。',
    '不要自称业务助手，不要编造自己有文件系统或工具执行结果。',
    '如果用户在消息中 @你，优先直接回应；未被点名时，也只在本轮被安排发言时回答自己。',
  ].filter(Boolean).join('\n');
  return {
    name: identityName,
    team: 'blue',
    roleType: 'normal',
    title: '议场嘉宾',
    persona,
    engineModels: selectedEngine && selectedModel ? { [selectedEngine]: selectedModel } : {},
    activeEngine: selectedEngine,
    capabilities: ['multi-agent-chat', 'agora'],
    systemPrompt: [
      baseSystemPrompt,
      buildAgoraConversationStyleGuide(participant, sourceDescription),
      '发言保持紧凑，只代表你自己的观点，不要冒充主持人、系统或全体共识。',
      '议场回合的最终提交必须遵守用户消息里给出的 `<result>...</result>` JSON 协议。',
      '如需中间过程可以先正常说话，但最终展示给群里的内容必须完整写进 result JSON 的 payload.content。',
    ].filter(Boolean).join('\n\n'),
    constraints: ['不调用工具', '不修改文件', '仅用于议场讨论'],
    allowedTools: [],
    category: 'agora-guest',
    tags: ['agora', 'agora-guest', participant.sourceType === 'custom' ? 'custom' : 'agent-template'],
  };
}

function createRoomMessage(
  input: Omit<CollaborationRoomMessage, 'id' | 'createdAt'> & { chatroom?: CollaborationRoomMessage['chatroom'] }
): CollaborationRoomMessage {
  return {
    id: `agora-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...input,
  };
}

function decodeMentionAttribute(value: string) {
  return value
    .split('&quot;').join('"')
    .split('&gt;').join('>')
    .split('&lt;').join('<')
    .split('&amp;').join('&');
}

function readMentionAttribute(tagText: string, attribute: 'id' | 'label') {
  const needle = `${attribute}="`;
  const start = tagText.indexOf(needle);
  if (start < 0) return '';
  const valueStart = start + needle.length;
  const valueEnd = tagText.indexOf('"', valueStart);
  if (valueEnd < 0) return '';
  return decodeMentionAttribute(tagText.slice(valueStart, valueEnd));
}

function extractStructuredMentionLabels(text: string): string[] {
  const mentions: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('<mention', cursor);
    if (start < 0) break;
    const end = text.indexOf('/>', start);
    if (end < 0) break;
    const tagText = text.slice(start, end + 2);
    const candidate = String(readMentionAttribute(tagText, 'label') || readMentionAttribute(tagText, 'id') || '').trim();
    if (candidate && !mentions.includes(candidate)) mentions.push(candidate);
    cursor = end + 2;
  }
  return mentions;
}

const INLINE_MENTION_STOP_CHARS = new Set([
  ' ',
  '\n',
  '\r',
  '\t',
  ',',
  '.',
  '!',
  '?',
  ':',
  ';',
  '，',
  '。',
  '！',
  '？',
  '：',
  '；',
  '、',
  '(',
  ')',
  '（',
  '）',
  '[',
  ']',
  '【',
  '】',
  '{',
  '}',
  '<',
  '>',
  '《',
  '》',
  '"',
  '\'',
]);

function extractInlineMentionTokens(text: string): string[] {
  const mentions: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('@', cursor);
    if (start < 0) break;
    let end = start + 1;
    while (end < text.length && !INLINE_MENTION_STOP_CHARS.has(text[end])) {
      end += 1;
    }
    const candidate = text.slice(start + 1, end).trim();
    if (candidate && !mentions.includes(candidate)) mentions.push(candidate);
    cursor = Math.max(end, start + 1);
  }
  return mentions;
}

function extractMentions(text: string, participants: string[]): string[] {
  const mentions: string[] = [];
  const pushMention = (candidate: string) => {
    if (candidate === '全员') {
      for (const name of participants) {
        if (!mentions.includes(name)) mentions.push(name);
      }
      return;
    }
    if (participants.includes(candidate) && !mentions.includes(candidate)) {
      mentions.push(candidate);
    }
  };
  extractStructuredMentionLabels(text).forEach(pushMention);
  extractInlineMentionTokens(text).forEach(pushMention);
  if (text.includes('@全员')) {
    for (const name of participants) {
      if (!mentions.includes(name)) mentions.push(name);
    }
  }
  return mentions;
}

function extractTrailingResultBody(raw: string) {
  const source = String(raw || '');
  const lower = source.toLowerCase();
  const openIndex = lower.lastIndexOf('<result>');
  if (openIndex < 0) return '';
  const afterOpen = source.slice(openIndex + '<result>'.length);
  const closeIndex = afterOpen.toLowerCase().indexOf('</result>');
  return closeIndex >= 0 ? afterOpen.slice(0, closeIndex) : afterOpen;
}

function extractPartialJsonStringField(source: string, fieldName: string) {
  const keyPattern = new RegExp(`"${fieldName}"\\s*:\\s*"`, 'i');
  const match = keyPattern.exec(source);
  if (!match) return '';
  let index = match.index + match[0].length;
  let value = '';
  let escaped = false;
  while (index < source.length) {
    const char = source[index];
    index += 1;
    if (escaped) {
      if (char === 'n') value += '\n';
      else if (char === 'r') value += '';
      else if (char === 't') value += '\t';
      else value += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') break;
    value += char;
  }
  return value.trim();
}

function extractAgoraPendingResultPreview(raw: string, expectedType?: AgoraResultType) {
  const body = extractTrailingResultBody(raw);
  if (!body.trim()) return '';
  const parsed = extractJsonObject(body);
  if (
    parsed?.kind === AGORA_RESULT_KIND
    && parsed?.payload
    && typeof parsed.payload === 'object'
    && (!expectedType || parsed.payload.type === expectedType)
    && typeof parsed.payload.content === 'string'
  ) {
    return parsed.payload.content.trim();
  }
  const content = extractPartialJsonStringField(body, 'content');
  if (content) return content;
  return '';
}

function getAgoraVisibleText(raw: string, streaming: boolean, expectedType?: AgoraResultType) {
  const visibleText = normalizeAssistantDisplay(String(raw || ''), streaming).visibleText.trim();
  if (visibleText) return visibleText;
  return extractAgoraPendingResultPreview(raw, expectedType);
}

function buildAgoraResultInstructions(type: AgoraResultType) {
  const baseRules = [
    '你可以先输出中间过程，但系统只会在你最后给出 <result>...</result> 后，才把这条消息替换成真正发言。',
    '最终必须在回复末尾输出且只输出一个 <result> 块。',
    'result 块内只能放裸 JSON，不要使用 ```json 代码块。',
    '如果缺少 <result>、kind 不是 "agora_result"、payload.type 不匹配，或 payload.content 为空，本轮会直接判失败并要求你重发。',
    '输出顺序固定：如需中间态，可先写普通正文；最后必须只剩一个 <result>JSON</result>，且 </result> 后不能再写任何字符。',
  ];

  if (type === 'speech') {
    return [
      ...baseRules,
      '最终 JSON 格式固定为：{"kind":"agora_result","payload":{"type":"speech","content":"最终要发出的群聊内容","mentions":["被你@的人名，可为空数组"]}}。',
      '系统只会采用 payload.content 作为最终发言内容；如果你在最终发言里 @ 了某位嘉宾，请把同名嘉宾写进 mentions 数组，没有就写空数组。',
    ].join('\n');
  }

  if (type === 'summary') {
    return [
      ...baseRules,
      '最终 JSON 格式固定为：{"kind":"agora_result","payload":{"type":"summary","title":"本轮总结","content":"共识：...\\n分歧：...\\n风险：...\\n下一步：..."}}。',
      '系统只会采用 payload.content 作为最终总结正文，title 可省略但 content 不能为空。',
    ].join('\n');
  }

  return [
    ...baseRules,
    '最终 JSON 格式固定为：{"kind":"agora_result","payload":{"type":"vote","content":"你的选择\\n理由：一句话","choice":"精确的选项文本或弃权","reason":"一句简短理由"}}。',
    '系统会采用 payload.content 作为最终展示文本，并读取 choice 与 reason 作为投票结果。',
  ].join('\n');
}

function extractAgoraStructuredResult(markdown: string, expectedType: AgoraResultType): {
  data: AgoraStructuredResult | null;
  error: string | null;
} {
  const sections = getResultSections(String(markdown || ''));
  if (sections.length === 0) {
    return {
      data: null,
      error: '回复缺少 <result>...</result>，议场最终发言必须通过结果块输出。',
    };
  }

  let firstParsed: any = null;
  let agoraEnvelope: any = null;

  for (const section of sections) {
    const parsed = extractJsonObject(section.content);
    if (!parsed) continue;
    if (!firstParsed) firstParsed = parsed;
    if (parsed.kind === AGORA_RESULT_KIND) {
      agoraEnvelope = parsed;
      break;
    }
  }

  if (!agoraEnvelope) {
    const firstSection = sections[0]?.content.trim() || '';
    if (!firstParsed) {
      return {
        data: null,
        error: firstSection.startsWith('```')
          ? '<result> 内不要包裹 ```json 代码块，请直接输出裸 JSON。'
          : '<result> 内的 JSON 无法解析。',
      };
    }
    return {
      data: null,
      error: `结果块 kind 必须为 "${AGORA_RESULT_KIND}"。`,
    };
  }

  const payload = agoraEnvelope.payload;
  if (!payload || typeof payload !== 'object') {
    return {
      data: null,
      error: 'agora_result.payload 缺失或不是对象。',
    };
  }

  if (payload.type !== expectedType) {
    return {
      data: null,
      error: `agora_result.payload.type 必须为 "${expectedType}"。`,
    };
  }

  const content = typeof payload.content === 'string' ? payload.content.trim() : '';
  if (!content) {
    return {
      data: null,
      error: 'agora_result.payload.content 不能为空。',
    };
  }

  if (expectedType === 'speech') {
    return {
      data: {
        type: 'speech',
        content,
        mentions: Array.isArray(payload.mentions)
          ? payload.mentions
            .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
            .map((item: string) => item.trim())
          : [],
      },
      error: null,
    };
  }

  if (expectedType === 'summary') {
    return {
      data: {
        type: 'summary',
        content,
        title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : undefined,
      },
      error: null,
    };
  }

  const choice = typeof payload.choice === 'string' ? payload.choice.trim() : '';
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!choice) {
    return {
      data: null,
      error: 'agora_result.payload.choice 不能为空。',
    };
  }
  if (!reason) {
    return {
      data: null,
      error: 'agora_result.payload.reason 不能为空。',
    };
  }

  return {
    data: {
      type: 'vote',
      content,
      choice,
      reason,
    },
    error: null,
  };
}

function normalizeVoteChoice(choice: string, content: string, options: string[], allowAbstain: boolean) {
  const trimmedChoice = choice.trim();
  return options.find((option) => (
    trimmedChoice === option
    || trimmedChoice.includes(option)
    || content.includes(option)
  )) || (allowAbstain && (trimmedChoice === '弃权' || content.includes('弃权')) ? '弃权' : options[0]);
}

function ensureRoom(room: CollaborationRoomState | null): CollaborationRoomState {
  return ensureChatroomRoomState(room || {
    topic: '',
    selectedAgents: [],
    mode: 'group-chat',
    messages: [],
    rounds: [],
    agentSessions: {},
  });
}

function buildAgentPrompt(input: {
  topic: string;
  mode: CollaborationChatroomMode;
  hostMessage: string;
  agentName: string;
  participant?: CollaborationChatroomParticipant;
  participants: string[];
  roundParticipants: string[];
  transcript: CollaborationRoomMessage[];
}) {
  const transcript = input.transcript.slice(-14)
    .map((message) => `${message.speakerName}: ${message.content.slice(0, 600)}`)
    .join('\n\n');
  return [
    `你正在参加一个议场群聊，当前议题是「${input.topic}」。`,
    `你是 ${input.agentName}。参与者：${input.participants.join('、') || '未设置'}。`,
    `当前协作方式：${MODE_LABELS[input.mode]}。`,
    `本轮被安排发言的嘉宾：${input.roundParticipants.join('、') || input.agentName}。`,
    `最近一条用户消息：${input.hostMessage}`,
    buildAgoraConversationStyleGuide(input.participant || { name: input.agentName }),
    input.mode === 'broadcast'
      ? '请直接给出你的观点、判断和建议。只代表你自己，不要假装替别人发言。'
      : '请代表你自己的角色发言，默认顺着上文自然接话，不用为了流程硬性点名别人。只有真的需要指定下一位继续，或用户明确要求点名时，再提到对方。',
    '回答保持紧凑但有信息量。先把核心判断说清楚，再按需要补依据、风险或建议，不用排固定模板。',
    transcript ? `最近记录：\n${transcript}` : '最近记录：暂无。',
    buildAgoraResultInstructions('speech'),
  ].join('\n\n');
}

function buildSummaryPrompt(input: {
  topic: string;
  participants: string[];
  transcript: CollaborationRoomMessage[];
}) {
  const transcript = input.transcript.slice(-18)
    .map((message) => `${message.speakerName}: ${message.content.slice(0, 800)}`)
    .join('\n\n');
  return [
    `请为本轮议场输出收束总结。议题：${input.topic}。`,
    `参与者：${input.participants.join('、') || '未设置'}。`,
    buildAgoraSummaryStyleGuide(),
    '请输出四段：共识、分歧、风险、下一步。每段 1-3 条，简洁明确。',
    transcript ? `讨论记录：\n${transcript}` : '讨论记录：暂无。',
    buildAgoraResultInstructions('summary'),
  ].join('\n\n');
}

function buildVotePrompt(input: {
  topic: string;
  question: string;
  options: string[];
  allowAbstain: boolean;
}) {
  return [
    `议场正在就议题「${input.topic}」进行投票。`,
    `投票问题：${input.question}`,
    `可选项：${input.options.join('、')}${input.allowAbstain ? '、弃权' : ''}`,
    '最终 payload.content 只保留两行：第一行只写你的选择，第二行以“理由：”开头，写一句简短理由。',
    buildAgoraResultInstructions('vote'),
  ].join('\n');
}

function getRoomMessageIndex(messages: CollaborationRoomMessage[], messageId: string) {
  return messages.findIndex((message) => message.id === messageId);
}

function getRoundTranscriptBeforeMessage(
  messages: CollaborationRoomMessage[],
  roundId: string,
  messageId: string
) {
  const messageIndex = getRoomMessageIndex(messages, messageId);
  const upperBound = messageIndex >= 0 ? messageIndex : messages.length;
  return messages
    .slice(0, upperBound)
    .filter((message) => message.roundId === roundId && message.status !== 'pending');
}

function summarizeVote(vote: CollaborationChatroomVote) {
  const tally = vote.options.reduce<Record<string, number>>((acc, option) => {
    acc[option] = 0;
    return acc;
  }, {});
  if (vote.allowAbstain) tally['弃权'] = 0;
  Object.values(vote.votes).forEach((choice) => {
    tally[choice] = (tally[choice] || 0) + 1;
  });
  return Object.entries(tally)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label} ${count} 票`)
    .join('，');
}

export function AgoraChatPanel({
  availableAgents,
  room,
  updateRoom,
  appendToCentralChat,
  onInsertIntoMainInput,
  onRegisterMainInputHandler,
  displayRoomTranscriptWhenMirrored = false,
  mirrorHumanMessagesToCentral = false,
  layout = 'panel',
  hideComposer = false,
  allowTopicControls = true,
  showComposerControls = true,
  inlineContent,
  inlineContentSpeakerName,
  currentUser,
  callAgent,
  toast,
}: AgoraChatPanelProps) {
  const normalizedRoom = ensureRoom(room);
  const chatroom = normalizedRoom.chatroom || createInitialChatroomState();
  const messages = normalizedRoom.messages || [];
  const roomTitle = chatroom.topic || normalizedRoom.topic || '议场消息';
  const participantRoster = useMemo<CollaborationChatroomParticipant[]>(() => {
    const legacyTemporaryAgents = chatroom.temporaryAgents || [];
    if (chatroom.participantRoster?.length) return chatroom.participantRoster;
    return (chatroom.participants || []).map((name, index) => {
      const temp = legacyTemporaryAgents.find((agent) => agent.name === name);
      return temp ? {
        id: temp.id,
        name: temp.name,
        sourceType: 'custom' as const,
        personaPrompt: temp.personaPrompt,
        useDefaultModel: !(temp.engine || temp.model),
        engine: temp.engine || '',
        model: temp.model || '',
        createdAt: temp.createdAt,
      } : {
        id: `legacy-${index}-${name}`,
        name,
        sourceType: 'agent' as const,
        sourceAgent: name,
        useDefaultModel: true,
        createdAt: Date.now(),
      };
    });
  }, [chatroom.participantRoster, chatroom.participants, chatroom.temporaryAgents]);
  const participants = participantRoster.map((participant) => participant.name);
  const useCentralTranscript = Boolean(appendToCentralChat);
  const shouldRenderRoomTranscript = !useCentralTranscript || displayRoomTranscriptWhenMirrored;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeMessageStreamsRef = useRef<Record<string, ActiveRoomStream>>({});
  const stoppedRoundsRef = useRef<Set<string>>(new Set());
  const recoveredStalePendingRef = useRef(false);

  const [topicInput, setTopicInput] = useState(chatroom.topic || normalizedRoom.topic || '');
  const [draft, setDraft] = useState('');
  const [composerMode, setComposerMode] = useState<CollaborationChatroomMode>(chatroom.settings.responseMode);
  const [topicDialogOpen, setTopicDialogOpen] = useState(false);
  const [voteDialogOpen, setVoteDialogOpen] = useState(false);
  const [temporaryParticipantDialogOpen, setTemporaryParticipantDialogOpen] = useState(false);
  const [globalRuntime, setGlobalRuntime] = useState({ engine: '', model: '' });
  const [voteDraft, setVoteDraft] = useState<VoteDraft>({ question: '', options: '', allowAbstain: false });
  const [topicDraft, setTopicDraft] = useState(chatroom.topic || '');
  const [temporaryAgentDraft, setTemporaryAgentDraft] = useState<TemporaryAgentDraft>({
    name: '',
    sourceType: 'agent',
    sourceAgent: availableAgents[0]?.name || '',
    personaPrompt: '',
    useDefaultModel: true,
    engine: '',
    model: '',
  });

  useEffect(() => {
    setComposerMode(chatroom.settings.responseMode);
  }, [chatroom.settings.responseMode]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch('/api/engine')
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          setGlobalRuntime({
            engine: typeof data?.engine === 'string' ? data.engine : '',
            model: typeof data?.defaultModel === 'string' ? data.defaultModel : '',
          });
        })
        .catch(() => {});
    };
    refresh();
    const onEngineUpdated = () => refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'engine-config-updated-at') refresh();
    };
    window.addEventListener('engine:updated', onEngineUpdated as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('engine:updated', onEngineUpdated as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    setTopicInput(chatroom.topic || normalizedRoom.topic || '');
    setTopicDraft(chatroom.topic || normalizedRoom.topic || '');
  }, [chatroom.topic, normalizedRoom.topic]);

  useEffect(() => {
    if (!normalizedRoom.chatroom) return;
    if (chatroom.status !== 'setup') return;
    if (chatroom.settings.defaultRuntimeMode) return;
    const hasLegacyDefaultRuntime = Boolean(chatroom.settings.defaultEngine || chatroom.settings.defaultModel);
    if (!hasLegacyDefaultRuntime) return;
    updateRoom((current) => {
      const base = ensureRoom(current);
      const currentChatroom = base.chatroom;
      if (!currentChatroom || currentChatroom.status !== 'setup' || currentChatroom.settings.defaultRuntimeMode) {
        return current;
      }
      return {
        ...base,
        topic: currentChatroom.topic,
        selectedAgents: currentChatroom.participants,
        chatroom: {
          ...currentChatroom,
          settings: {
            ...currentChatroom.settings,
            defaultEngine: '',
            defaultModel: '',
            defaultRuntimeMode: 'inherit',
          },
        },
      };
    });
  }, [
    chatroom.settings.defaultEngine,
    chatroom.settings.defaultModel,
    chatroom.settings.defaultRuntimeMode,
    chatroom.status,
    normalizedRoom.chatroom,
    updateRoom,
  ]);

  useEffect(() => {
    if (!normalizedRoom.chatroom) return;
    if (chatroom.status !== 'setup') return;
    if (chatroom.settings.defaultRuntimeMode === 'explicit') return;
    if (chatroom.settings.defaultEngine || chatroom.settings.defaultModel) return;
    if (!globalRuntime.engine && !globalRuntime.model) return;
    updateRoom((current) => {
      const base = ensureRoom(current);
      const currentChatroom = base.chatroom;
      if (!currentChatroom || currentChatroom.status !== 'setup') return current;
      if (currentChatroom.settings.defaultRuntimeMode === 'explicit') return current;
      if (currentChatroom.settings.defaultEngine || currentChatroom.settings.defaultModel) return current;
      if (currentChatroom.settings.defaultRuntimeMode === 'inherit') return current;
      return {
        ...base,
        topic: currentChatroom.topic,
        selectedAgents: currentChatroom.participants,
        chatroom: {
          ...currentChatroom,
          settings: {
            ...currentChatroom.settings,
            defaultRuntimeMode: 'inherit',
          },
        },
      };
    });
  }, [
    chatroom.settings.defaultEngine,
    chatroom.settings.defaultModel,
    chatroom.settings.defaultRuntimeMode,
    chatroom.status,
    globalRuntime.engine,
    globalRuntime.model,
    normalizedRoom.chatroom,
    updateRoom,
  ]);

  useEffect(() => {
    if (bottomRef.current && typeof bottomRef.current.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  useEffect(() => {
    if (recoveredStalePendingRef.current) return;
    recoveredStalePendingRef.current = true;
    const stalePendingMessages = messages.filter((message) => (
      message.status === 'pending'
      && message.speakerType === 'agent'
      && message.chatroom?.kind !== 'setup'
    ));
    if (!stalePendingMessages.length) return;
    const staleIds = new Set(stalePendingMessages.map((message) => message.id));
    updateRoom((current) => {
      const base = ensureRoom(current);
      return {
        ...base,
        messages: (base.messages || []).map((message) => {
          if (!staleIds.has(message.id)) return message;
          const partial = String(message.rawContent || message.content || '').trim();
          const content = partial && partial !== '发言中' ? partial : '页面刷新后流式连接已中断，可重新发起。';
          return {
            ...message,
            content,
            rawContent: content,
            status: 'error' as const,
            error: '页面刷新后流式连接已中断',
          };
        }),
      };
    });
  }, [messages, updateRoom]);

  const openVoteCount = chatroom.activeVote
    ? Object.keys(chatroom.activeVote.votes || {}).length
    : 0;
  const participantMap = useMemo(
    () => new Map(participantRoster.map((participant) => [participant.name, participant])),
    [participantRoster]
  );
  const currentUserDisplayName = useMemo(() => getCurrentUserDisplayName(currentUser), [currentUser]);
  const currentUserAvatarSrc = useMemo(() => resolveCurrentUserAvatarSrc(currentUser?.avatar), [currentUser?.avatar]);
  const currentUserIdentitySet = useMemo(() => buildCurrentUserIdentitySet(currentUser), [currentUser]);
  const resolveSpeakerAvatarSrc = useMemo(
    () => (name: string, kind: 'agent' | 'host' | 'system') => {
      if (
        kind === 'host'
        && currentUserAvatarSrc
        && currentUserIdentitySet.has(normalizeUserIdentity(name || currentUserDisplayName))
      ) {
        return currentUserAvatarSrc;
      }
      const participant = kind === 'agent' ? participantMap.get(name) : undefined;
      return getSpeakerAvatarSrc(name, kind, participant?.runtimeAgentName || participant?.name || name);
    },
    [currentUserAvatarSrc, currentUserDisplayName, currentUserIdentitySet, participantMap]
  );

  const resolveChatroomParticipantRuntimeConfig = (participantName: string) => {
    const participant = participantMap.get(participantName);
    const useDefault = participant?.useDefaultModel !== false;
    return {
      participant,
      useDefault,
      effectiveEngine: String(useDefault ? (chatroom.settings.defaultEngine || '') : (participant?.engine || chatroom.settings.defaultEngine || '')).trim(),
      effectiveModel: String(useDefault ? (chatroom.settings.defaultModel || '') : (participant?.model || chatroom.settings.defaultModel || '')).trim(),
    };
  };

  const getParticipantSourceDescription = (participantName: string) => {
    const participant = participantMap.get(participantName);
    return (participant?.sourceType === 'agent' || participant?.sourceType === 'preset')
      ? availableAgents.find((agent) => agent.name === participant.sourceAgent)?.description
      : participant?.personaPrompt;
  };

  const buildParticipantTemporaryRoleConfig = (participantName: string) => {
    const participant = participantMap.get(participantName);
    if (!participant) return undefined;
    const runtimeConfig = resolveChatroomParticipantRuntimeConfig(participantName);
    return buildChatroomParticipantRoleConfig(
      participant,
      {
        engine: runtimeConfig.effectiveEngine,
        model: runtimeConfig.effectiveModel,
      },
      getParticipantSourceDescription(participantName)
    );
  };

  const updateChatroom = (updater: (state: CollaborationChatroomState) => CollaborationChatroomState) => {
    updateRoom((current) => {
      const base = ensureRoom(current);
      const nextChatroom = updater(base.chatroom || createInitialChatroomState({
        topic: base.topic || '',
        participants: base.selectedAgents || [],
      }));
      return {
        ...base,
        topic: nextChatroom.topic,
        selectedAgents: nextChatroom.participants,
        chatroom: nextChatroom,
      };
    });
  };

  const appendRoomMessages = (
    nextMessages: CollaborationRoomMessage[],
    options?: { appendToCentral?: boolean }
  ) => {
    updateRoom((current) => {
      const base = ensureRoom(current);
      return {
        ...base,
        messages: [...(base.messages || []), ...nextMessages],
      };
    });
    if (options?.appendToCentral === false) return;
    nextMessages.forEach((message) => appendToCentralChat?.(message));
  };

  const replaceRoomMessage = (messageId: string, nextMessage: CollaborationRoomMessage, options?: { appendToCentral?: boolean }) => {
    updateRoom((current) => {
      const base = ensureRoom(current);
      return {
        ...base,
        messages: (base.messages || []).map((message) => message.id === messageId ? nextMessage : message),
      };
    });
    if (options?.appendToCentral === false) return;
    appendToCentralChat?.(nextMessage);
  };

  const clearActiveMessageStream = (messageId: string) => {
    const current = activeMessageStreamsRef.current[messageId];
    delete activeMessageStreamsRef.current[messageId];
    if (!current?.roundId) return;
    const hasSiblingStream = Object.entries(activeMessageStreamsRef.current)
      .some(([, stream]) => stream.roundId === current.roundId);
    if (!hasSiblingStream) {
      stoppedRoundsRef.current.delete(current.roundId);
    }
  };

  const executeAgentMessage = async (input: {
    roundId?: string;
    speakerName: string;
    prompt: string;
    expectedResultType: AgoraResultType;
    messagePatch?: Pick<CollaborationRoomMessage, 'chatroom'>;
    temporaryRoleConfig?: Record<string, any>;
    existingMessage?: CollaborationRoomMessage;
  }): Promise<{ message: CollaborationRoomMessage; stopped: boolean; structuredResult: AgoraStructuredResult | null }> => {
    const pendingMessage: CollaborationRoomMessage = input.existingMessage
      ? {
          ...input.existingMessage,
          roundId: input.roundId ?? input.existingMessage.roundId,
          speakerType: 'agent',
          speakerName: input.speakerName,
          content: '发言中',
          rawContent: '',
          status: 'pending',
          error: null,
          engine: undefined,
          model: undefined,
          chatroom: input.messagePatch?.chatroom || input.existingMessage.chatroom,
        }
      : createRoomMessage({
          roundId: input.roundId,
          speakerType: 'agent',
          speakerName: input.speakerName,
          content: '发言中',
          status: 'pending',
          chatroom: input.messagePatch?.chatroom,
        });
    if (input.existingMessage) {
      replaceRoomMessage(input.existingMessage.id, pendingMessage, { appendToCentral: false });
    } else {
      appendRoomMessages([pendingMessage], { appendToCentral: false });
    }
    let latestRawContent = '';
    let latestVisibleContent = '';

    try {
      const result = await callAgent(
        input.speakerName,
        input.prompt,
        input.roundId,
        input.messagePatch,
        input.temporaryRoleConfig,
        {
          onStreamStart: (stream) => {
            activeMessageStreamsRef.current[pendingMessage.id] = {
              roundId: input.roundId,
              stop: stream.stop,
            };
          },
          onDelta: (_content, accumulated) => {
            latestRawContent = String(accumulated || '');
            const partial = getAgoraVisibleText(latestRawContent, true);
            if (partial) latestVisibleContent = partial;
            updateRoom((current) => {
              const base = ensureRoom(current);
              return {
                ...base,
                messages: (base.messages || []).map((message) => (
                  message.id === pendingMessage.id
                    ? {
                        ...message,
                        content: partial || message.content,
                        rawContent: latestRawContent,
                        status: 'pending',
                      }
                    : message
                )),
              };
            });
          },
        }
      );
      const finalRawContent = String(result.rawContent || result.content || latestRawContent || '');
      const finalVisibleContent = getAgoraVisibleText(finalRawContent, false);
      if (finalVisibleContent) latestVisibleContent = finalVisibleContent;

      if (result.status === 'stopped') {
        const stoppedMessage: CollaborationRoomMessage = {
          ...pendingMessage,
          content: latestVisibleContent || '已停止',
          rawContent: finalRawContent,
          status: 'error',
          error: '已停止',
          engine: result.engine,
          model: result.model,
        };
        clearActiveMessageStream(pendingMessage.id);
        replaceRoomMessage(pendingMessage.id, stoppedMessage);
        return {
          message: stoppedMessage,
          stopped: true,
          structuredResult: null,
        };
      }

      const extraction = extractAgoraStructuredResult(finalRawContent, input.expectedResultType);
      if (!extraction.data) {
        const protocolError = extraction.error || '议场结果协议解析失败';
        throw Object.assign(new Error(protocolError), {
          rawContent: finalRawContent,
          partialContent: latestVisibleContent,
          engine: result.engine,
          model: result.model,
        });
      }

      const structuredResult = extraction.data;
      const finalMessage: CollaborationRoomMessage = {
        ...pendingMessage,
        content: structuredResult.content,
        rawContent: finalRawContent,
        status: 'done',
        error: null,
        engine: result.engine,
        model: result.model,
        chatroom: {
          ...pendingMessage.chatroom,
          mentions: structuredResult.type === 'speech' ? structuredResult.mentions : pendingMessage.chatroom?.mentions,
          summaryTitle: structuredResult.type === 'summary' ? structuredResult.title : pendingMessage.chatroom?.summaryTitle,
        },
      };
      clearActiveMessageStream(pendingMessage.id);
      replaceRoomMessage(pendingMessage.id, finalMessage);
      return {
        message: finalMessage,
        stopped: false,
        structuredResult,
      };
    } catch (error: any) {
      const errorText = error?.message || '嘉宾发言失败';
      const fallbackRawContent = String(error?.rawContent || latestRawContent || errorText || '');
      const fallbackVisibleContent = String(
        error?.partialContent
        || latestVisibleContent
        || getAgoraVisibleText(fallbackRawContent, false)
        || errorText
      ).trim() || errorText;
      const finalMessage: CollaborationRoomMessage = {
        ...pendingMessage,
        content: fallbackVisibleContent,
        rawContent: fallbackRawContent,
        status: 'error',
        error: errorText,
        engine: error?.engine,
        model: error?.model,
      };
      clearActiveMessageStream(pendingMessage.id);
      replaceRoomMessage(pendingMessage.id, finalMessage);
      if (error?.code === 'stopped') {
        return {
          message: finalMessage,
          stopped: true,
          structuredResult: null,
        };
      }
      const thrownError = error instanceof Error ? error : new Error(errorText);
      if (error && typeof error === 'object' && error !== thrownError) {
        Object.assign(thrownError, error);
      }
      Object.assign(thrownError, { roomMessage: finalMessage });
      throw thrownError;
    }
  };

  const handleStopRoomMessage = async (message: CollaborationRoomMessage) => {
    const stream = activeMessageStreamsRef.current[message.id];
    if (!stream) return;
    if (stream.roundId) {
      stoppedRoundsRef.current.add(stream.roundId);
    }
    try {
      await stream.stop();
    } catch {}
  };

  const canRetryRoomMessage = (message: CollaborationRoomMessage) => (
    message.status === 'error'
    && message.speakerType === 'agent'
    && (message.chatroom?.kind === 'agent' || message.chatroom?.kind === 'summary')
  );

  const handleRetryRoomMessage = async (message: CollaborationRoomMessage) => {
    if (!canRetryRoomMessage(message)) return;
    if (activeMessageStreamsRef.current[message.id]) return;
    if (!message.roundId) {
      toast('warning', '缺少原始轮次，无法重试');
      return;
    }

    const round = chatroom.rounds.find((item) => item.id === message.roundId);
    if (!round) {
      toast('warning', '原始轮次不存在，无法重试');
      return;
    }

    const mode = message.chatroom?.mode || round.mode || composerMode;
    const roundParticipants = round.participants?.length ? round.participants : (message.chatroom?.participants || []);
    const roundTranscript = getRoundTranscriptBeforeMessage(messages, message.roundId, message.id);

    try {
      if (message.chatroom?.kind === 'summary') {
        const summarizer = message.speakerName || roundParticipants[0] || participants[0];
        if (!summarizer) {
          toast('warning', '缺少总结嘉宾，无法重试');
          return;
        }
        const summaryTurn = await executeAgentMessage({
          roundId: message.roundId,
          speakerName: summarizer,
          prompt: buildSummaryPrompt({
            topic: round.topic || chatroom.topic,
            participants: roundParticipants.length ? roundParticipants : participants,
            transcript: roundTranscript,
          }),
          expectedResultType: 'summary',
          messagePatch: { chatroom: { kind: 'summary', mode } },
          temporaryRoleConfig: buildParticipantTemporaryRoleConfig(summarizer),
          existingMessage: message,
        });
        if (summaryTurn.stopped) return;
        saveSummary(
          message.roundId,
          summaryTurn.message.content,
          summarizer,
          summaryTurn.structuredResult?.type === 'summary' ? summaryTurn.structuredResult.title : undefined,
        );
        markRound(message.roundId, {
          status: 'completed',
          completedAt: Date.now(),
          summary: summaryTurn.message.content,
        });
        updateChatroom((current) => ({ ...current, status: 'running' }));
        return;
      }

      const hostEntry = roundTranscript.find((item) => item.speakerType === 'human');
      if (!hostEntry) {
        toast('warning', '缺少原始提问，无法重试');
        return;
      }

      const turnResult = await executeAgentMessage({
        roundId: message.roundId,
        speakerName: message.speakerName,
        prompt: buildAgentPrompt({
          topic: round.topic || chatroom.topic,
          mode,
          hostMessage: hostEntry.content,
          agentName: message.speakerName,
          participant: participantMap.get(message.speakerName),
          participants: chatroom.participants.length ? chatroom.participants : participants,
          roundParticipants: roundParticipants.length ? roundParticipants : [message.speakerName],
          transcript: roundTranscript,
        }),
        expectedResultType: 'speech',
        messagePatch: { chatroom: { kind: 'agent', mode } },
        temporaryRoleConfig: buildParticipantTemporaryRoleConfig(message.speakerName),
        existingMessage: message,
      });
      if (turnResult.stopped) return;

      const hasRemainingRoundErrors = messages.some((item) => (
        item.roundId === message.roundId
        && item.id !== message.id
        && item.status === 'error'
        && (item.chatroom?.kind === 'agent' || item.chatroom?.kind === 'summary')
      ));
      if (!hasRemainingRoundErrors) {
        markRound(message.roundId, {
          status: 'completed',
          completedAt: Date.now(),
        });
      }
    } catch (error: any) {
      toast('error', error?.message || '重试失败');
    }
  };

  const handleSubmitParticipantDraft = () => {
    const editingId = temporaryAgentDraft.id;
    const name = temporaryAgentDraft.name.trim();
    const personaPrompt = temporaryAgentDraft.personaPrompt.trim();
    if (!name) {
      toast('warning', '请填写议场嘉宾名字');
      return;
    }
    if (participantRoster.some((participant) => participant.name === name && participant.id !== editingId)) {
      toast('warning', `议场嘉宾 ${name} 已存在`);
      return;
    }
    if (temporaryAgentDraft.sourceType === 'custom' && !personaPrompt) {
      toast('warning', '自定义嘉宾需要填写提示词');
      return;
    }
    updateChatroom((current) => ({
      ...current,
      participantRoster: editingId
        ? (current.participantRoster || []).map((participant) => participant.id === editingId ? {
          ...participant,
          name,
          sourceType: temporaryAgentDraft.sourceType,
          sourceAgent: temporaryAgentDraft.sourceType === 'agent' ? temporaryAgentDraft.sourceAgent : undefined,
          personaPrompt: temporaryAgentDraft.sourceType === 'custom' ? personaPrompt : undefined,
          useDefaultModel: temporaryAgentDraft.useDefaultModel,
          engine: temporaryAgentDraft.useDefaultModel ? '' : temporaryAgentDraft.engine,
          model: temporaryAgentDraft.useDefaultModel ? '' : temporaryAgentDraft.model,
        } : participant)
        : [
          ...(current.participantRoster || []),
          {
            id: `participant-${Date.now()}`,
            name,
            sourceType: temporaryAgentDraft.sourceType,
            sourceAgent: temporaryAgentDraft.sourceType === 'agent' ? temporaryAgentDraft.sourceAgent : undefined,
            personaPrompt: temporaryAgentDraft.sourceType === 'custom' ? personaPrompt : undefined,
            useDefaultModel: temporaryAgentDraft.useDefaultModel,
            engine: temporaryAgentDraft.useDefaultModel ? '' : temporaryAgentDraft.engine,
            model: temporaryAgentDraft.useDefaultModel ? '' : temporaryAgentDraft.model,
            createdAt: Date.now(),
          },
        ],
      participants: editingId
        ? (current.participantRoster || []).map((participant) => participant.id === editingId ? name : participant.name)
        : [...(current.participantRoster || []).map((participant) => participant.name), name],
    }));
    setTemporaryAgentDraft({
      id: undefined,
    name: generateAncientStyleGuestName([...participantRoster.map((participant) => participant.name), name]),
      sourceType: 'agent',
      sourceAgent: availableAgents[0]?.name || '',
      personaPrompt: '',
      useDefaultModel: true,
      engine: '',
      model: '',
    });
    setTemporaryParticipantDialogOpen(false);
  };

  const openCreateParticipantDialog = () => {
    setTemporaryAgentDraft({
      id: undefined,
      name: generateAncientStyleGuestName(participantRoster.map((participant) => participant.name)),
      sourceType: 'agent',
      sourceAgent: availableAgents[0]?.name || '',
      personaPrompt: '',
      useDefaultModel: true,
      engine: '',
      model: '',
    });
    setTemporaryParticipantDialogOpen(true);
  };

  const openEditParticipantDialog = (participant: CollaborationChatroomParticipant) => {
    setTemporaryAgentDraft({
      id: participant.id,
      name: participant.name,
      sourceType: participant.sourceType,
      sourceAgent: participant.sourceAgent || availableAgents[0]?.name || '',
      personaPrompt: participant.personaPrompt || '',
      useDefaultModel: participant.useDefaultModel !== false,
      engine: participant.engine || '',
      model: participant.model || '',
    });
    setTemporaryParticipantDialogOpen(true);
  };

  const setChatroomDefaultRuntime = (patch: { engine?: string; model?: string }) => {
    updateChatroom((current) => {
      const defaultEngine = patch.engine ?? current.settings.defaultEngine ?? '';
      const defaultModel = patch.model ?? current.settings.defaultModel ?? '';
      return {
        ...current,
        settings: {
          ...current.settings,
          defaultEngine,
          defaultModel,
          defaultRuntimeMode: defaultEngine || defaultModel ? 'explicit' : 'inherit',
        },
      };
    });
  };

  const markRound = (roundId: string, patch: Partial<CollaborationChatroomRound>) => {
    updateChatroom((current) => ({
      ...current,
      rounds: current.rounds.map((round) => round.id === roundId ? { ...round, ...patch } : round),
      activeRoundId: patch.status === 'completed' || patch.status === 'failed' ? undefined : current.activeRoundId,
    }));
  };

  const saveSummary = (roundId: string, content: string, generatedBy: string, title?: string) => {
    const summary: CollaborationChatroomSummary = {
      id: `summary-${Date.now()}`,
      roundId,
      title: title?.trim() || `第 ${chatroom.rounds.length} 轮总结`,
      content,
      generatedBy,
      createdAt: Date.now(),
    };
    updateChatroom((current) => ({
      ...current,
      summaries: [summary, ...current.summaries].slice(0, 12),
      rounds: current.rounds.map((round) => round.id === roundId ? { ...round, summary: content } : round),
    }));
  };

  const runSummary = async (roundId: string, transcript: CollaborationRoomMessage[]) => {
    const summarizer = participants[0];
    if (!summarizer) return;
    updateChatroom((current) => ({ ...current, status: 'summarizing' }));
    try {
      const summaryTurn = await executeAgentMessage({
        roundId,
        speakerName: summarizer,
        prompt: buildSummaryPrompt({
          topic: chatroom.topic,
          participants,
          transcript,
        }),
        expectedResultType: 'summary',
        messagePatch: { chatroom: { kind: 'summary', mode: composerMode } },
        temporaryRoleConfig: buildParticipantTemporaryRoleConfig(summarizer),
      });
      if (summaryTurn.stopped) {
        markRound(roundId, { status: 'failed', completedAt: Date.now(), summary: '已停止' });
        updateChatroom((current) => ({ ...current, status: 'running' }));
        return;
      }
      saveSummary(
        roundId,
        summaryTurn.message.content,
        summarizer,
        summaryTurn.structuredResult?.type === 'summary' ? summaryTurn.structuredResult.title : undefined,
      );
      markRound(roundId, { status: 'completed', completedAt: Date.now(), summary: summaryTurn.message.content });
      updateChatroom((current) => ({ ...current, status: 'running' }));
    } catch (error: any) {
      if (!error?.roomMessage) {
        appendRoomMessages([createRoomMessage({
          roundId,
          speakerType: 'system',
          speakerName: '系统',
          content: `本轮总结失败：${error?.message || '未知错误'}`,
          status: 'error',
          error: error?.message || '未知错误',
          chatroom: { kind: 'system', mode: composerMode },
        })]);
      }
      markRound(roundId, { status: 'failed', completedAt: Date.now(), summary: error?.message || '总结失败' });
      updateChatroom((current) => ({ ...current, status: 'running' }));
    }
  };

  const handleCreateRoom = () => {
    const picked = participantRoster.map((participant) => participant.name);
    const topic = topicInput.trim();
    if (picked.length < 2) {
      toast('warning', '至少添加 2 个议场嘉宾');
      return;
    }
    if (!topic) {
      toast('warning', '请输入议场议题');
      return;
    }
    const setupMessage = createRoomMessage({
      speakerType: 'system',
      speakerName: '系统',
      content: `议场已创建，议题为「${topic}」。嘉宾：${picked.join('、')}。`,
      status: 'done',
      chatroom: { kind: 'setup', participants: picked, mode: composerMode },
    });
    updateRoom((current) => {
      const base = ensureRoom(current);
      const nextChatroom = createInitialChatroomState({
        status: 'running',
        topic,
        participants: picked,
        participantRoster,
        temporaryAgents: base.chatroom?.temporaryAgents || [],
        settings: {
          ...createInitialChatroomState().settings,
          responseMode: composerMode,
          autoSummarize: base.chatroom?.settings.autoSummarize ?? true,
          maxTurnsPerRound: base.chatroom?.settings.maxTurnsPerRound ?? 2,
          maxRepliesPerAgent: base.chatroom?.settings.maxRepliesPerAgent ?? 1,
          defaultEngine: base.chatroom?.settings.defaultEngine || '',
          defaultModel: base.chatroom?.settings.defaultModel || '',
          defaultRuntimeMode: base.chatroom?.settings.defaultRuntimeMode || 'inherit',
        },
      });
      return {
        ...base,
        topic,
        selectedAgents: picked,
        messages: [setupMessage],
        chatroom: nextChatroom,
      };
    });
    appendToCentralChat?.(setupMessage);
    toast('success', '议场已创建');
  };

  const handleResetRoom = () => {
    updateRoom((current) => {
      const base = ensureRoom(current);
      return {
        ...base,
        topic: '',
        selectedAgents: [],
        messages: [],
        chatroom: createInitialChatroomState(),
      };
    });
    setDraft('');
    setTopicInput('');
  };

  const getMessageKindLabel = (message: CollaborationRoomMessage) => {
    if (message.error === '已停止') return '已停止';
    if (message.speakerType === 'human') return '你';
    if (message.chatroom?.kind === 'summary') return '总结';
    if (message.chatroom?.kind === 'vote-result') return '票决';
    if (message.chatroom?.kind === 'vote') return '投票';
    if (message.chatroom?.kind === 'topic-change') return '议题';
    if (message.speakerType === 'system') return '系统';
    return '嘉宾';
  };

  const runConversationRound = async (hostMessage: string, mode: CollaborationChatroomMode) => {
    const topic = chatroom.topic.trim();
    if (!topic) {
      toast('warning', '请先设置议题');
      return;
    }
    if (!participants.length) {
      toast('warning', '请先添加议场嘉宾');
      return;
    }
    const mentions = extractMentions(hostMessage, participants);
    const kickoffParticipants = resolveRoundParticipants({
      participants,
      mentions,
      mode,
      roundIndex: chatroom.rounds.length,
    });
    const roundId = `chatround-${Date.now()}`;
    const round: CollaborationChatroomRound = {
      id: roundId,
      title: `第 ${chatroom.rounds.length + 1} 轮`,
      topic,
      mode,
      participants: kickoffParticipants,
      status: 'running',
      startedAt: Date.now(),
    };
    const humanEntry = createRoomMessage({
      roundId,
      speakerType: 'human',
      speakerName: currentUserDisplayName,
      content: hostMessage,
      status: 'done',
      chatroom: { mode, mentions, participants: kickoffParticipants },
    });
    appendRoomMessages([humanEntry], { appendToCentral: !useCentralTranscript || mirrorHumanMessagesToCentral });
    updateChatroom((current) => ({
      ...current,
      status: 'running',
      rounds: [...current.rounds, round],
      activeRoundId: roundId,
      settings: { ...current.settings, responseMode: mode },
    }));

    const transcript: CollaborationRoomMessage[] = [...messages, humanEntry];
    const queue = [...kickoffParticipants].slice(0, USER_LED_AGENT_REPLY_LIMIT);
    const spokenCounts = new Map<string, number>();
    let failures = 0;
    let successfulAgentReplies = 0;
    let roundStopped = false;

    while (queue.length > 0 && successfulAgentReplies + failures < USER_LED_AGENT_REPLY_LIMIT) {
      const agentName = queue.shift();
      if (!agentName) continue;
      if (stoppedRoundsRef.current.has(roundId)) {
        roundStopped = true;
        break;
      }
      const count = (spokenCounts.get(agentName) || 0) + 1;
      if (count > USER_LED_AGENT_REPLY_PER_PARTICIPANT) continue;
      spokenCounts.set(agentName, count);
      try {
        const delayMs = getAgentReplyDelayMs();
        if (delayMs > 0) {
          await delay(delayMs);
        }
        if (stoppedRoundsRef.current.has(roundId)) {
          roundStopped = true;
          break;
        }
        const turnResult = await executeAgentMessage({
          roundId,
          speakerName: agentName,
          prompt: buildAgentPrompt({
            topic,
            mode,
            hostMessage,
            agentName,
            participant: participantMap.get(agentName),
            participants,
            roundParticipants: kickoffParticipants,
            transcript,
          }),
          expectedResultType: 'speech',
          messagePatch: { chatroom: { kind: 'agent', mode } },
          temporaryRoleConfig: buildParticipantTemporaryRoleConfig(agentName),
        });
        const transcriptMessage = turnResult.message;
        transcript.push(transcriptMessage);
        if (turnResult.stopped) {
          roundStopped = true;
          break;
        }
        successfulAgentReplies += 1;
        if (mode !== 'broadcast') {
          const nextMentions = Array.from(new Set([
            ...(transcriptMessage.chatroom?.mentions || []),
            ...extractMentions(transcriptMessage.content, participants),
          ])).filter((name) => name !== agentName);
          nextMentions.forEach((name) => {
            if (
              (spokenCounts.get(name) || 0) < USER_LED_AGENT_REPLY_PER_PARTICIPANT
              && !queue.includes(name)
              && successfulAgentReplies + failures + queue.length < USER_LED_AGENT_REPLY_LIMIT
            ) {
              queue.push(name);
            }
          });
        }
      } catch (error: any) {
        failures += 1;
        if (error?.roomMessage) {
          transcript.push(error.roomMessage as CollaborationRoomMessage);
        } else {
          const errorMessage = createRoomMessage({
            roundId,
            speakerType: 'system',
            speakerName: '系统',
            content: `${agentName} 回复失败：${error?.message || '未知错误'}`,
            status: 'error',
            error: error?.message || '未知错误',
            chatroom: { kind: 'system', mode },
          });
          transcript.push(errorMessage);
          appendRoomMessages([errorMessage]);
        }
      }
    }

    if (roundStopped) {
      markRound(roundId, { status: 'failed', completedAt: Date.now() });
      stoppedRoundsRef.current.delete(roundId);
      return;
    }

    if (chatroom.settings.autoSummarize && successfulAgentReplies > 1) {
      await runSummary(roundId, transcript);
    } else {
      markRound(roundId, {
        status: failures === kickoffParticipants.length ? 'failed' : 'completed',
        completedAt: Date.now(),
      });
    }
  };

  const handleSend = async (overrideText?: string) => {
    const text = String(overrideText ?? draft).trim();
    if (!text) return;
    if (!overrideText) {
      setDraft('');
    }
    await runConversationRound(text, composerMode);
  };

  const handleComposerModeChange = (value: CollaborationChatroomMode) => {
    setComposerMode(value);
    updateChatroom((current) => ({
      ...current,
      settings: {
        ...current.settings,
        responseMode: value,
      },
    }));
  };

  const handleAutoSummarizeChange = (checked: boolean) => {
    updateChatroom((current) => ({
      ...current,
      settings: {
        ...current.settings,
        autoSummarize: checked,
      },
    }));
  };

  const runtimeComposerControls = showComposerControls ? (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Select value={composerMode} onValueChange={(value: CollaborationChatroomMode) => handleComposerModeChange(value)}>
          <SelectTrigger className="h-8 w-[132px] rounded-md text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="facilitated">群聊</SelectItem>
            <SelectItem value="mention-driven">点名接话</SelectItem>
            <SelectItem value="broadcast">全员回应</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs text-muted-foreground">
          <Switch checked={chatroom.settings.autoSummarize} onCheckedChange={handleAutoSummarizeChange} />
          <span>自动总结</span>
        </div>
      </div>
      {allowTopicControls ? (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 rounded-md px-2.5 text-xs"
          onClick={() => setTopicDialogOpen(true)}
        >
          切换议题
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 rounded-md px-2.5 text-xs"
          onClick={() => setVoteDialogOpen(true)}
          disabled={participants.length === 0}
        >
          发起投票
        </Button>
      </div>
      ) : null}
    </div>
  ) : null;

  const runConversationRoundRef = useRef(runConversationRound);
  runConversationRoundRef.current = runConversationRound;

  useEffect(() => {
    if (!onRegisterMainInputHandler) return;
    if (!useCentralTranscript && !hideComposer) {
      onRegisterMainInputHandler(null);
      return;
    }
    onRegisterMainInputHandler((text: string) => {
      const normalized = text.trim();
      if (!normalized) return;
      void runConversationRoundRef.current(normalized, composerMode);
    });
    return () => {
      onRegisterMainInputHandler(null);
    };
  }, [composerMode, hideComposer, onRegisterMainInputHandler, useCentralTranscript]);

  const handleChangeTopic = () => {
    const nextTopic = topicDraft.trim();
    if (!nextTopic) {
      toast('warning', '请输入新议题');
      return;
    }
    updateChatroom((current) => ({
      ...current,
      topic: nextTopic,
    }));
    appendRoomMessages([createRoomMessage({
      speakerType: 'system',
      speakerName: '系统',
      content: `议题已切换为「${nextTopic}」。`,
      status: 'done',
      chatroom: { kind: 'topic-change', mode: composerMode },
    })]);
    setTopicDialogOpen(false);
    toast('success', '议题已更新');
  };

  const handleDeleteRoomMessage = (message: CollaborationRoomMessage) => {
    updateRoom((current) => {
      const base = ensureRoom(current);
      return {
        ...base,
        messages: (base.messages || []).filter((item) => item.id !== message.id),
      };
    });
  };

  const handleQuoteRoomMessage = (value: string) => {
    if (onInsertIntoMainInput && (useCentralTranscript || hideComposer)) {
      onInsertIntoMainInput(value);
      return;
    }
    const nextDraft = String(draft || '').trimEnd();
    const mergedDraft = nextDraft ? `${nextDraft}\n\n${value}` : value;
    setDraft(mergedDraft);
    inputRef.current?.focus();
  };

  const handleVote = async () => {
    const question = voteDraft.question.trim();
    const options = voteDraft.options.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
    if (!question || options.length < 2) {
      toast('warning', '请填写投票问题，并至少提供两个选项');
      return;
    }
    const voteId = `vote-${Date.now()}`;
    const vote: CollaborationChatroomVote = {
      id: voteId,
      question,
      options,
      votes: {},
      reasons: {},
      status: 'open',
      allowAbstain: voteDraft.allowAbstain,
      createdAt: Date.now(),
    };
    updateChatroom((current) => ({
      ...current,
      status: 'voting',
      activeVote: vote,
    }));
    appendRoomMessages([createRoomMessage({
      speakerType: 'system',
      speakerName: '系统',
      content: `开始投票：「${question}」`,
      status: 'done',
      chatroom: { kind: 'vote', voteId, mode: composerMode },
    })]);
    setVoteDialogOpen(false);
    setVoteDraft({ question: '', options: '', allowAbstain: false });

    const nextVote: CollaborationChatroomVote = {
      ...vote,
      votes: {} as Record<string, string>,
      reasons: {} as Record<string, string>,
    };
    for (const participant of participants) {
      try {
        const voteTurn = await executeAgentMessage({
          roundId: voteId,
          speakerName: participant,
          prompt: buildVotePrompt({
            topic: chatroom.topic,
            question,
            options,
            allowAbstain: voteDraft.allowAbstain,
          }),
          expectedResultType: 'vote',
          messagePatch: { chatroom: { kind: 'vote', voteId, mode: composerMode } },
          temporaryRoleConfig: buildParticipantTemporaryRoleConfig(participant),
        });
        if (voteTurn.stopped) {
          nextVote.votes[participant] = '未投';
          nextVote.reasons![participant] = '已停止';
          continue;
        }
        if (voteTurn.structuredResult?.type !== 'vote') {
          throw new Error('投票结果协议缺失');
        }
        const voteResult = voteTurn.structuredResult;
        const normalizedChoice = normalizeVoteChoice(
          voteResult.choice,
          voteResult.content,
          options,
          voteDraft.allowAbstain,
        );
        nextVote.votes[participant] = normalizedChoice;
        nextVote.reasons![participant] = voteResult.reason;
        updateChatroom((current) => ({
          ...current,
          activeVote: {
            ...(current.activeVote || vote),
            votes: { ...(current.activeVote?.votes || {}), [participant]: normalizedChoice },
            reasons: { ...(current.activeVote?.reasons || {}), [participant]: voteResult.reason },
          },
        }));
      } catch (error: any) {
        nextVote.votes[participant] = '未投';
        nextVote.reasons![participant] = error?.message || '投票失败';
      }
    }
    nextVote.status = 'closed';
    nextVote.completedAt = Date.now();
    const tally = summarizeVote(nextVote);
    appendRoomMessages([createRoomMessage({
      speakerType: 'system',
      speakerName: '系统',
      content: `投票结束：「${question}」。结果：${tally || '无有效投票'}。`,
      status: 'done',
      chatroom: { kind: 'vote-result', voteId, mode: composerMode },
    })]);
    updateChatroom((current) => ({
      ...current,
      status: 'running',
      activeVote: null,
      voteHistory: [nextVote, ...current.voteHistory].slice(0, 10),
    }));
    toast('success', '投票完成');
  };

  if (chatroom.status === 'setup') {
    return (
      <div className={cn('space-y-4', layout === 'workspace' && 'h-full overflow-y-auto pr-1')}>
        <div className="rounded-xl border border-border/70 bg-background p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium text-muted-foreground">议场</div>
              <h3 className="mt-2 text-xl font-semibold text-foreground">创建议题</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                选择嘉宾、议题和发言方式后即可开始群聊。
              </p>
            </div>
            <Badge variant="outline">内置功能</Badge>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-xl border bg-background p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold">议场嘉宾</h4>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">嘉宾会以群聊成员身份发言。</p>
              </div>
              <Button size="sm" onClick={openCreateParticipantDialog}>新增嘉宾</Button>
            </div>
            <div className="mt-4 space-y-3">
              {participantRoster.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  暂无嘉宾
                </div>
              ) : participantRoster.map((participant) => {
                const runtime = resolveChatroomParticipantRuntimeConfig(participant.name);
                const sourceDescription = (participant.sourceType === 'agent' || participant.sourceType === 'preset')
                  ? availableAgents.find((agent) => agent.name === participant.sourceAgent)?.description
                  : participant.personaPrompt;
                return (
                  <div key={participant.id} className="rounded-xl border bg-background/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{participant.name}</div>
                        <div className="mt-1 space-y-1 text-xs leading-5 text-muted-foreground">
                          <div>{participant.sourceType === 'custom' ? '自定义嘉宾' : participant.sourceType === 'preset' ? '预设嘉宾' : '基于已有提示词'}</div>
                          <div>{runtime.effectiveEngine || '跟随全局'} / {runtime.effectiveModel || '跟随全局'}</div>
                          <div>
                            {participant.sourceType === 'agent' || participant.sourceType === 'preset'
                              ? `来源：${participant.sourceAgent || '-'}`
                              : `来源：${sourceDescription || '自定义嘉宾'}`
                            }
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => openEditParticipantDialog(participant)}>
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => updateChatroom((current) => ({
                            ...current,
                            participantRoster: (current.participantRoster || []).filter((item) => item.id !== participant.id),
                            participants: (current.participantRoster || []).filter((item) => item.id !== participant.id).map((item) => item.name),
                          }))}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-4 rounded-xl border bg-background p-4">
            <div>
              <h4 className="text-sm font-semibold">议题名称</h4>
              <Input
                value={topicInput}
                onChange={(event) => setTopicInput(event.target.value)}
                className="mt-3"
                placeholder="例如：是否将上下文工作台升级为正式协作能力"
              />
            </div>
            <div>
              <h4 className="text-sm font-semibold">默认模型策略</h4>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <EngineSelect
                  value={chatroom.settings.defaultEngine || ''}
                  onChange={(value) => setChatroomDefaultRuntime({ engine: value })}
                  allowGlobal
                />
                <ModelSelect
                  value={chatroom.settings.defaultModel || ''}
                  onChange={(value) => setChatroomDefaultRuntime({ model: value })}
                  engine={chatroom.settings.defaultEngine || undefined}
                  allowGlobal
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">新嘉宾默认继承这里的模型策略，也可以单独配置。</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold">默认协作模式</h4>
              <Select value={composerMode} onValueChange={(value: CollaborationChatroomMode) => setComposerMode(value)}>
                <SelectTrigger className="mt-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="facilitated">群聊</SelectItem>
                  <SelectItem value="mention-driven">点名接话</SelectItem>
                  <SelectItem value="broadcast">全员回应</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {composerMode === 'facilitated'
                  ? '嘉宾会自然接话，适合开放讨论。'
                  : composerMode === 'mention-driven'
                    ? '只有被 @ 的嘉宾会接话，节奏最可控。'
                    : '适合快速收集所有嘉宾的第一反应。'}
              </p>
            </div>
            <Button className="w-full" onClick={handleCreateRoom}>
              创建议场
            </Button>
          </section>
        </div>
        <Dialog open={temporaryParticipantDialogOpen} onOpenChange={setTemporaryParticipantDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{temporaryAgentDraft.id ? '编辑议场嘉宾' : '新增议场嘉宾'}</DialogTitle>
              <DialogDescription>给嘉宾设置名字、人格来源和模型策略。</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">嘉宾名字</div>
                <Input
                  value={temporaryAgentDraft.name}
                  onChange={(event) => setTemporaryAgentDraft((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="例如：一辩架构师"
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">人格来源</div>
                <Select
                  value={temporaryAgentDraft.sourceType}
                  onValueChange={(value: 'agent' | 'custom') => setTemporaryAgentDraft((prev) => ({ ...prev, sourceType: value }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">已有提示词</SelectItem>
                    <SelectItem value="custom">自定义嘉宾</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {temporaryAgentDraft.sourceType === 'agent' ? (
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">选择提示词来源</div>
                  <Select
                    value={temporaryAgentDraft.sourceAgent}
                    onValueChange={(value) => setTemporaryAgentDraft((prev) => ({ ...prev, sourceAgent: value }))}
                  >
                    <SelectTrigger><SelectValue placeholder="选择提示词来源" /></SelectTrigger>
                    <SelectContent>
                      {availableAgents.map((agent) => (
                        <SelectItem key={agent.name} value={agent.name}>{agent.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">嘉宾提示词</div>
                  <Textarea
                    rows={4}
                    value={temporaryAgentDraft.personaPrompt}
                    onChange={(event) => setTemporaryAgentDraft((prev) => ({ ...prev, personaPrompt: event.target.value }))}
                    placeholder="描述这个嘉宾的立场、关注点和表达方式"
                  />
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">使用默认模型策略</div>
                  <div className="text-xs text-muted-foreground">关闭后可为这个嘉宾单独设置引擎和模型。</div>
                </div>
                <Switch
                  checked={temporaryAgentDraft.useDefaultModel}
                  onCheckedChange={(checked) => setTemporaryAgentDraft((prev) => ({ ...prev, useDefaultModel: checked }))}
                />
              </div>
              {temporaryAgentDraft.useDefaultModel ? null : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <EngineSelect
                    value={temporaryAgentDraft.engine}
                    onChange={(value) => setTemporaryAgentDraft((prev) => ({ ...prev, engine: value }))}
                    allowGlobal
                  />
                  <ModelSelect
                    value={temporaryAgentDraft.model}
                    onChange={(value) => setTemporaryAgentDraft((prev) => ({ ...prev, model: value }))}
                    engine={temporaryAgentDraft.engine || chatroom.settings.defaultEngine || undefined}
                    allowGlobal
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTemporaryParticipantDialogOpen(false)}>取消</Button>
              <Button onClick={handleSubmitParticipantDraft}>{temporaryAgentDraft.id ? '保存嘉宾' : '添加嘉宾'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', layout === 'workspace' && 'flex h-full min-h-0 flex-col')}>
      {layout === 'workspace' ? null : (
        <div className="rounded-xl border border-slate-800/60 bg-[linear-gradient(140deg,rgba(10,15,28,1),rgba(21,32,56,0.96))] p-4 text-slate-50 shadow-[0_18px_60px_rgba(2,6,23,0.32)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-cyan-200/75">议题</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h3 className="truncate text-xl font-semibold">{chatroom.topic}</h3>
                <Badge className="border-white/15 bg-white/10 text-slate-100">{MODE_LABELS[chatroom.settings.responseMode]}</Badge>
                <Badge className="border-white/15 bg-white/10 text-slate-100">{participants.length} 嘉宾</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                <span>轮次 {chatroom.rounds.length}</span>
                <span>总结 {chatroom.summaries.length}</span>
                <span>投票 {chatroom.voteHistory.length}{chatroom.activeVote ? ' + 进行中' : ''}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {participants.map((name) => (
                  <div key={`participant-${name}`} className="flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-2.5 py-1.5">
                    <SpriteAvatar
                      avatar={resolveSpeakerAvatarSrc(name, 'agent')}
                      seed={name}
                      category="agent-default"
                      alt={name}
                      fallback={getInitials(name)}
                      className="h-7 w-7 ring-1 ring-white/15"
                      fallbackClassName="bg-white/10 text-[10px] font-semibold text-slate-100"
                    />
                    <span className="max-w-[140px] truncate text-xs text-slate-100">{name}</span>
                  </div>
                ))}
              </div>
            </div>
            {allowTopicControls ? (
            <div className="grid min-w-[240px] gap-2 sm:grid-cols-2">
              <Button variant="outline" className="border-white/20 bg-white/5 text-slate-100 hover:bg-white/10" onClick={() => setTopicDialogOpen(true)}>
                切换议题
              </Button>
              <Button variant="outline" className="border-white/20 bg-white/5 text-slate-100 hover:bg-white/10" onClick={() => setVoteDialogOpen(true)}>
                发起投票
              </Button>
              <Button variant="ghost" className="sm:col-span-2 text-slate-300 hover:bg-white/10 hover:text-white" onClick={handleResetRoom}>
                重置议题
              </Button>
            </div>
            ) : null}
          </div>
        </div>
      )}

      {shouldRenderRoomTranscript ? (
        <div className={cn(layout === 'workspace' && 'flex min-h-0 flex-1 flex-col')}>
          <CollaborationRoomSurface
            messages={messages}
            hideMessages={false}
            hideComposer={hideComposer}
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={(value) => void handleSend(value)}
            submitLabel="发送"
            submitDisabled={!draft.trim()}
            placeholder={`在「${chatroom.topic || '议题'}」里发言`}
            mentionTargets={participants}
            onInsertMention={(value) => setDraft((prev) => `${prev}${value}`.trimStart())}
            inputRef={inputRef}
            bottomRef={bottomRef}
            emptyText=""
            helperText={layout === 'workspace' ? null : 'Ctrl/Cmd + Enter 发送。'}
            customControls={runtimeComposerControls}
            inlineContent={inlineContent}
            inlineContentSpeakerName={inlineContentSpeakerName}
            onDeleteMessage={handleDeleteRoomMessage}
            onQuoteMessage={(value) => handleQuoteRoomMessage(value)}
            onRetryMessage={(message) => { void handleRetryRoomMessage(message); }}
            canRetryMessage={canRetryRoomMessage}
            onStopMessage={(message) => { void handleStopRoomMessage(message); }}
            canStopMessage={(message) => Boolean(activeMessageStreamsRef.current[message.id])}
            quoteMentionMode={onInsertIntoMainInput && (useCentralTranscript || hideComposer) ? 'tag' : 'plain'}
            getSpeakerAvatarSrc={resolveSpeakerAvatarSrc}
            getInitials={getInitials}
            getMessageKindLabel={getMessageKindLabel}
            containerClassName={layout === 'workspace' ? 'flex h-full min-h-0 flex-col border-0 bg-background' : undefined}
            messagesClassName={layout === 'workspace' ? 'min-h-0 flex-1 overflow-y-auto px-6 py-5' : undefined}
            composerClassName={layout === 'workspace' ? 'px-6 py-4' : undefined}
            variant={layout === 'workspace' ? 'channel' : 'panel'}
          />
        </div>
      ) : null}

      {allowTopicControls ? (
      <Dialog open={topicDialogOpen} onOpenChange={setTopicDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>切换议题</DialogTitle>
            <DialogDescription>更新议场的主议题，系统会把本次变更记录到消息流里。</DialogDescription>
          </DialogHeader>
          <Input value={topicDraft} onChange={(event) => setTopicDraft(event.target.value)} placeholder="输入新的议题" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopicDialogOpen(false)}>取消</Button>
            <Button onClick={handleChangeTopic}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      ) : null}

      {allowTopicControls ? (
      <Dialog open={voteDialogOpen} onOpenChange={setVoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发起投票</DialogTitle>
            <DialogDescription>正式发起一轮表决。每位嘉宾会返回选择和一句理由。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={voteDraft.question}
              onChange={(event) => setVoteDraft((prev) => ({ ...prev, question: event.target.value }))}
              placeholder="例如：议场第一优先级要不要先做状态归一"
            />
            <Textarea
              value={voteDraft.options}
              onChange={(event) => setVoteDraft((prev) => ({ ...prev, options: event.target.value }))}
              rows={4}
              placeholder="每行一个选项，或用逗号分隔"
            />
            <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <div>
                <div className="font-medium">允许弃权</div>
                <div className="text-xs text-muted-foreground">开启后，嘉宾可以选择弃权而不是强行站队。</div>
              </div>
              <Switch
                checked={voteDraft.allowAbstain}
                onCheckedChange={(checked) => setVoteDraft((prev) => ({ ...prev, allowAbstain: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoteDialogOpen(false)}>取消</Button>
            <Button onClick={() => void handleVote()}>开始投票</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      ) : null}
    </div>
  );
}
