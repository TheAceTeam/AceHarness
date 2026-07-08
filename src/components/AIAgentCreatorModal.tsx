'use client';

import { useEffect, useMemo, useState } from 'react';
import { agentApi, configApi } from '@/lib/core/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ComboboxPortalProvider, SingleCombobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AgentHeroCard } from '@/components/agent/AgentHeroCard';
import { useToast } from '@/components/ui/toast';
import { EngineSelect } from '@/components/EngineSelect';
import { ModelSelect } from '@/components/ModelSelect';
import { WrapperProcessBlocks } from '@/components/chat/ChatMessage';
import {
  buildAgentDraftPreview,
  createInitialAgentDraft,
  extractAgentDraftCapabilities,
  normalizeAgentDraft,
  type AgentDraftState,
} from '@/lib/agent/draft';
import type { ClarificationAnswerValue, ClarificationFormResult, ClarificationQuestionItem } from '@/lib/ai/result-normalizers';
import { createDeterministicAvatarConfig } from '@/lib/agent/personas';
import { stripMachineResultBlocks } from '@/lib/chat/actions';

type AgentConfig = {
  name: string;
  team: 'blue' | 'red' | 'judge' | 'black-gold';
  roleType?: 'normal' | 'supervisor';
  avatar?: any;
  category?: string;
  tags?: string[];
  engineModels: Record<string, string>;
  activeEngine: string;
  temperature?: number;
  systemPrompt?: string;
  iterationPrompt?: string;
  capabilities?: string[];
  constraints?: string[];
  keywords?: string[];
  description?: string;
};

type WorkflowSummary = {
  filename: string;
  name: string;
  description?: string;
  mode?: 'phase-based' | 'state-machine';
};

type AgentDraftRecommendations = {
  experiences: Array<{
    runId: string;
    workflowName?: string;
    configFile: string;
    summary: string;
  }>;
  referenceWorkflow: null | {
    filename: string;
    name?: string;
    description?: string;
    projectRoot?: string;
    agents: string[];
    phases: string[];
    states: string[];
  };
  relationshipHints: Array<{
    agent: string;
    counterpart: string;
    synergyScore: number;
    strengths: string[];
  }>;
};

type DraftValidation = {
  ok: boolean;
  issues: Array<{
    path: string[];
    message: string;
    severity: 'error' | 'warning';
    code?: string;
  }>;
};

type AgentCreationItem = {
  kind: string;
  data: Record<string, any>;
};

type AgentCreationRepairEvent = {
  kind: string;
  attempt: number;
  maxAttempts: number;
  reason: string;
  failedOutput: string;
  repairPrompt: string;
};

type AgentDraftChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  status: 'completed' | 'streaming' | 'failed';
};

type AgentDiffRow = { type: 'same' | 'add' | 'remove'; text: string };
type AgentCreateStage = 'input' | 'clarification' | 'draft';

const AGENT_CREATION_KIND_META: Record<string, { title: string; icon: string; hint: string }> = {
  agent_clarification_summary: {
    title: '需求理解',
    icon: 'psychology',
    hint: '确认角色目标和上下文',
  },
  agent_clarification_facts: {
    title: '已确认事实',
    icon: 'fact_check',
    hint: '整理已确认的信息',
  },
  agent_clarification_gaps: {
    title: '待补信息',
    icon: 'help',
    hint: '标记影响配置的缺口',
  },
  agent_clarification_question: {
    title: '补充问题',
    icon: 'quiz',
    hint: '生成可回答的问题',
  },
  agent_role_profile: {
    title: '角色画像',
    icon: 'badge',
    hint: '名称、阵营、职责边界',
  },
  agent_execution_profile: {
    title: '执行策略',
    icon: 'schema',
    hint: '能力、约束、系统提示词',
  },
  agent_config: {
    title: '配置草案',
    icon: 'settings',
    hint: '可保存的 Agent 配置',
  },
};

function inferAgentDisplayName(mission: string): string {
  const normalized = String(mission || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '新 Agent';
  const headline = normalized.split(/[。！？!?；;\n]/)[0].trim();
  return headline.slice(0, 18) || '新 Agent';
}

function resolveDraftPreviewDisplayName(draft: Pick<AgentDraftState, 'displayName' | 'mission'>): string {
  return draft.displayName.trim() || inferAgentDisplayName(draft.mission);
}

function formatAgentForDiff(agent: Record<string, any> | null | undefined): string {
  if (!agent) return '';
  const normalized = {
    name: agent.name,
    team: agent.team,
    roleType: agent.roleType,
    activeEngine: agent.activeEngine,
    engineModels: agent.engineModels,
    capabilities: agent.capabilities,
    constraints: agent.constraints,
    keywords: agent.keywords,
    skills: agent.skills,
    tags: agent.tags,
    category: agent.category,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
  };
  return JSON.stringify(normalized, null, 2);
}

function computeSimpleDiff(base: string, next: string): AgentDiffRow[] {
  const baseLines = base.split('\n');
  const nextLines = next.split('\n');
  const rows: AgentDiffRow[] = [];
  const max = Math.max(baseLines.length, nextLines.length);
  for (let index = 0; index < max; index += 1) {
    const before = baseLines[index];
    const after = nextLines[index];
    if (before === after) {
      rows.push({ type: 'same', text: before ?? '' });
    } else {
      if (before !== undefined) rows.push({ type: 'remove', text: before });
      if (after !== undefined) rows.push({ type: 'add', text: after });
    }
  }
  return rows;
}

function stripUnclosedResultTail(markdown: string): string {
  const source = String(markdown || '');
  const lower = source.toLowerCase();
  const lastOpen = lower.lastIndexOf('<result>');
  if (lastOpen === -1) return source;
  const lastClose = lower.lastIndexOf('</result>');
  return lastOpen > lastClose ? source.slice(0, lastOpen).trimEnd() : source;
}

function getAgentAiOutputSource(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => stripMachineResultBlocks(stripUnclosedResultTail(String(part || ''))).trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function getClarificationQuestionOptions(item: ClarificationQuestionItem): ClarificationQuestionItem['options'] {
  if (Array.isArray(item.options) && item.options.length > 0) return item.options;
  return [
    {
      id: 'recommended',
      label: '推荐方案',
      description: item.placeholder || '使用系统推荐的保守默认方案继续。',
      recommended: true,
    },
    {
      id: 'custom',
      label: '自定义填写',
      description: '在下方补充说明中写清楚你的答案。',
    },
  ];
}

function getClarificationNoteSuggestions(item: ClarificationQuestionItem): string[] {
  const candidates = [
    item.placeholder,
    ...getClarificationQuestionOptions(item)
      .filter((option) => option.recommended)
      .flatMap((option) => [option.description, option.label]),
  ];
  const seen = new Set<string>();
  return candidates
    .map((value) => String(value || '').trim())
    .filter((value) => value && value !== '请输入你的回答')
    .filter((value) => {
      const key = value.replace(/\s+/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function buildClarificationAnswerContext(
  questions: ClarificationQuestionItem[],
  answers: Record<string, ClarificationAnswerValue>,
): string {
  return questions
    .map((item) => {
      const answer = answers[item.id];
      if (!answer) return '';
      const selectedOptions = getClarificationQuestionOptions(item).filter((option) => answer.optionIds.includes(option.id));
      const note = answer.note.trim();
      if (selectedOptions.length === 0 && !note) return '';
      const parts = [
        selectedOptions.length > 0 ? `选择：${selectedOptions.map((option) => option.label).join('、')}` : '',
        note ? `补充：${note}` : '',
      ].filter(Boolean);
      return `- ${item.label}：${parts.join('；')}`;
    })
    .filter(Boolean)
    .join('\n');
}

function summarizeAgentCreationItem(item: AgentCreationItem): string {
  const data = item.data || {};
  if (item.kind === 'agent_clarification_summary') {
    return String(data.summary || '已生成需求理解。');
  }
  if (item.kind === 'agent_clarification_facts') {
    const facts = Array.isArray(data.facts || data.knownFacts) ? (data.facts || data.knownFacts).slice(0, 3).join('、') : '';
    return facts ? `已确认：${facts}` : '已生成已确认事实。';
  }
  if (item.kind === 'agent_clarification_gaps') {
    const gaps = Array.isArray(data.gaps || data.missingFields) ? (data.gaps || data.missingFields).slice(0, 3).join('、') : '';
    return gaps ? `待补：${gaps}` : '已生成待补信息。';
  }
  if (item.kind === 'agent_clarification_question') {
    return String(data.label || data.question?.label || data.question || '已生成补充问题。');
  }
  if (item.kind === 'agent_role_profile') {
    return [
      data.displayName || data.name,
      data.team ? `阵营 ${data.team}` : '',
      data.mission,
    ].filter(Boolean).join(' · ') || '已生成角色画像。';
  }
  if (item.kind === 'agent_execution_profile') {
    const capabilities = Array.isArray(data.capabilities) ? data.capabilities.slice(0, 4).join('、') : '';
    return capabilities ? `能力：${capabilities}` : String(data.description || '已生成执行策略。');
  }
  const agent = data.agent && typeof data.agent === 'object' ? data.agent : data;
  return [
    agent.name,
    agent.roleType,
    Array.isArray(agent.capabilities) ? agent.capabilities.slice(0, 3).join('、') : '',
  ].filter(Boolean).join(' · ') || '已生成配置草案。';
}

function AgentCreationStructuredResult({
  items,
  drafting,
  statusMessage,
}: {
  items: AgentCreationItem[];
  drafting: boolean;
  statusMessage?: string;
}) {
  const itemMap = new Map(items.map((item) => [item.kind, item]));
  const orderedKinds = Object.keys(AGENT_CREATION_KIND_META);
  return (
    <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Structured Result</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {drafting ? (statusMessage || '正在生成并解析 Agent 创建 item。') : '按 Agent 创建 item 协议解析后的结果。'}
          </div>
        </div>
        <Badge className={drafting ? 'bg-amber-500/15 text-amber-700 dark:text-amber-100' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-100'}>
          {drafting ? '生成中' : items.length ? '已完成' : '等待'}
        </Badge>
      </div>
      <div className="mt-4 grid gap-3">
        {orderedKinds.map((kind) => {
          const meta = AGENT_CREATION_KIND_META[kind];
          const item = itemMap.get(kind);
          return (
            <div key={kind} className={`rounded-2xl border px-3 py-3 ${item ? 'border-emerald-400/30 bg-emerald-500/10' : 'border-border/70 bg-muted/35'}`}>
              <div className="flex items-start gap-3">
                <span className={`material-symbols-outlined mt-0.5 text-base ${item ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}>{meta.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium text-foreground">{meta.title}</div>
                    <Badge variant="outline" className="text-[10px]">
                      {item ? '已解析' : '等待'}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{item ? summarizeAgentCreationItem(item) : meta.hint}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentAiOutputPanel({
  title,
  progress,
  raw,
  thinking,
  warnings,
  streaming,
  emptyText,
}: {
  title: string;
  progress?: string;
  raw: string;
  thinking?: string;
  warnings?: string[];
  streaming: boolean;
  emptyText: string;
}) {
  const outputContent = useMemo(() => getAgentAiOutputSource(thinking, raw), [raw, thinking]);
  const hasOutput = Boolean(outputContent || progress || warnings?.length);

  return (
    <div className="rounded-[24px] border border-border/70 bg-card/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">AI 输出</div>
          <div className="mt-1 text-sm font-medium text-foreground">{title}</div>
        </div>
        <Badge variant="outline">
          {streaming ? '实时' : hasOutput ? '完成' : '等待'}
        </Badge>
      </div>

      {progress ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {streaming ? <span className="deer-runner-sprite shrink-0" aria-hidden="true" /> : null}
          <span>{progress}</span>
        </div>
      ) : null}

      {warnings?.length ? (
        <div className="mt-3 space-y-2">
          {warnings.map((message, index) => (
            <div key={`${message}-${index}`} className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-100">
              {message}
            </div>
          ))}
        </div>
      ) : null}

      {outputContent ? (
        <div className="mt-3 rounded-xl border border-border/70 bg-background/60 p-3">
          <WrapperProcessBlocks content={outputContent} isStreaming={streaming} />
        </div>
      ) : null}

      {!outputContent && (raw || thinking || streaming) ? (
        <div className="mt-3 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
          {streaming ? '已连接，等待模型返回内容。' : '结构化结果已解析。'}
        </div>
      ) : !outputContent ? (
        <div className="mt-3 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
          {emptyText}
        </div>
      ) : null}
    </div>
  );
}

function AgentCreationRepairPanel({ events }: { events: AgentCreationRepairEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-100">
        <span className="material-symbols-outlined text-base">sync_problem</span>
        自动修复记录
      </div>
      <div className="mt-3 space-y-2">
        {events.slice(-4).map((event, index) => {
          const meta = AGENT_CREATION_KIND_META[event.kind] || { title: event.kind, icon: 'data_object', hint: '' };
          return (
            <details key={`${event.kind}-${event.attempt}-${index}`} className="rounded-xl border border-amber-400/20 bg-background/80 text-xs">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-amber-900 dark:text-amber-100">
                <span className="material-symbols-outlined text-sm">{meta.icon}</span>
                <span className="font-medium">{meta.title}</span>
                <span className="text-muted-foreground">第 {event.attempt}/{event.maxAttempts} 次</span>
              </summary>
              <div className="space-y-2 border-t border-amber-400/20 px-3 py-3 text-muted-foreground">
                <div className="rounded-lg bg-muted/40 p-2 leading-5">{event.reason}</div>
                <div>
                  <div className="mb-1 font-medium text-foreground">修复提示</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-2 leading-5">{event.repairPrompt}</pre>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

interface AIAgentCreatorModalProps {
  open: boolean;
  engine: string;
  model: string;
  mode?: 'create' | 'revise';
  baseAgent?: AgentConfig | null;
  initialDraft?: Partial<AgentDraftState> | null;
  onClose: () => void;
  onCreate: (agent: AgentConfig) => Promise<boolean> | boolean;
  onContinueEdit: (agent: AgentConfig) => void;
}

export default function AIAgentCreatorModal({
  open,
  engine,
  model,
  mode = 'create',
  baseAgent = null,
  initialDraft,
  onClose,
  onCreate,
  onContinueEdit,
}: AIAgentCreatorModalProps) {
  const { toast } = useToast();
  const [draftInput, setDraftInput] = useState<AgentDraftState>(createInitialAgentDraft(initialDraft || undefined));
  const [draftResult, setDraftResult] = useState<AgentConfig | null>(null);
  const [draftRaw, setDraftRaw] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [refreshingAvatar, setRefreshingAvatar] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [recommendations, setRecommendations] = useState<AgentDraftRecommendations | null>(null);
  const [validation, setValidation] = useState<DraftValidation | null>(null);
  const [creationItems, setCreationItems] = useState<AgentCreationItem[]>([]);
  const [repairEvents, setRepairEvents] = useState<AgentCreationRepairEvent[]>([]);
  const [selectedEngine, setSelectedEngine] = useState(engine || '');
  const [selectedModel, setSelectedModel] = useState(model || '');
  const [draftProgress, setDraftProgress] = useState('');
  const [draftThinking, setDraftThinking] = useState('');
  const [draftStreamWarnings, setDraftStreamWarnings] = useState<string[]>([]);
  const [clarificationForm, setClarificationForm] = useState<ClarificationFormResult | null>(null);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, ClarificationAnswerValue>>({});
  const [clarifying, setClarifying] = useState(false);
  const [clarificationRaw, setClarificationRaw] = useState('');
  const [clarificationProgress, setClarificationProgress] = useState('');
  const [clarificationThinking, setClarificationThinking] = useState('');
  const [clarificationWarnings, setClarificationWarnings] = useState<string[]>([]);
  const [clarificationSessionId, setClarificationSessionId] = useState<string | null>(null);
  const [createStage, setCreateStage] = useState<AgentCreateStage>('input');
  const [draftMessages, setDraftMessages] = useState<AgentDraftChatMessage[]>([]);
  const [draftSessionId, setDraftSessionId] = useState<string | null>(null);
  const [previewAvatarSeed, setPreviewAvatarSeed] = useState(() => resolveDraftPreviewDisplayName(draftInput));

  const isReviseMode = mode === 'revise' && Boolean(baseAgent);
  const showCreateClarificationStage = !isReviseMode && createStage === 'clarification';
  const showCreateInputFields = !isReviseMode && createStage !== 'clarification';

  useEffect(() => {
    if (open) {
      const nextDraft = isReviseMode && baseAgent
        ? createInitialAgentDraft({
            displayName: baseAgent.name,
            team: baseAgent.team || 'red',
            mission: '',
            style: baseAgent.tags?.join('、') || '',
            specialties: (baseAgent.capabilities || []).join('、'),
          })
        : normalizeAgentDraft(initialDraft || undefined);
      setDraftInput(nextDraft);
      setPreviewAvatarSeed(resolveDraftPreviewDisplayName(nextDraft));
      setSelectedEngine(engine || '');
      setSelectedModel(model || '');
      setDraftMessages([]);
      setDraftSessionId(null);
      setClarificationForm(null);
      setClarificationAnswers({});
      setClarifying(false);
      setClarificationRaw('');
      setClarificationProgress('');
      setClarificationThinking('');
      setClarificationWarnings([]);
      setClarificationSessionId(null);
      setCreateStage('input');
      configApi.listAllConfigs()
        .then((result) => setWorkflows((result.configs || []) as WorkflowSummary[]))
        .catch(() => setWorkflows([]));
      return;
    }
    if (!open) {
      const resetDraft = createInitialAgentDraft(initialDraft || undefined);
      setDraftInput(resetDraft);
      setPreviewAvatarSeed(resolveDraftPreviewDisplayName(resetDraft));
      setDraftResult(null);
      setDraftRaw('');
      setRecommendations(null);
      setValidation(null);
      setCreationItems([]);
      setRepairEvents([]);
      setDraftProgress('');
      setDraftThinking('');
      setDraftStreamWarnings([]);
      setClarificationForm(null);
      setClarificationAnswers({});
      setClarifying(false);
      setClarificationRaw('');
      setClarificationProgress('');
      setClarificationThinking('');
      setClarificationWarnings([]);
      setClarificationSessionId(null);
      setCreateStage('input');
      setDraftMessages([]);
      setDraftSessionId(null);
      setDrafting(false);
      setCreating(false);
      setRefreshingAvatar(false);
      setSelectedEngine(engine || '');
      setSelectedModel(model || '');
    }
  }, [baseAgent, engine, initialDraft, isReviseMode, model, open]);

  const capabilities = useMemo(() => extractAgentDraftCapabilities(draftInput.specialties), [draftInput.specialties]);
  const canUseSelectedRuntime = !selectedEngine || Boolean(selectedModel.trim());

  const effectiveDisplayName = resolveDraftPreviewDisplayName(draftInput);
  const previewAgent = useMemo<AgentConfig | null>(() => {
    const agent = buildAgentDraftPreview({
      engine: selectedEngine,
      model: selectedModel,
      draft: { ...draftInput, displayName: effectiveDisplayName },
      existingDraft: draftResult || (isReviseMode ? baseAgent : null),
    }) as AgentConfig | null;
    if (!agent || draftResult || isReviseMode) return agent;
    const team = draftInput.canSupervise === 'yes' ? 'black-gold' : draftInput.team;
    const roleType = draftInput.canSupervise === 'yes' ? 'supervisor' : 'normal';
    return {
      ...agent,
      avatar: createDeterministicAvatarConfig(previewAvatarSeed || effectiveDisplayName, { team, roleType }),
    };
  }, [baseAgent, draftInput, draftResult, effectiveDisplayName, isReviseMode, previewAvatarSeed, selectedEngine, selectedModel]);

  const clarificationAnswerContext = useMemo(() => (
    clarificationForm
      ? buildClarificationAnswerContext(clarificationForm.questions || [], clarificationAnswers)
      : ''
  ), [clarificationAnswers, clarificationForm]);
  const missingRequiredClarification = useMemo(() => {
    if (!clarificationForm || isReviseMode) return null;
    return (clarificationForm.questions || []).find((item) => {
      if (item.required === false) return false;
      const answer = clarificationAnswers[item.id];
      return !answer || ((answer.optionIds || []).length === 0 && !answer.note.trim());
    }) || null;
  }, [clarificationAnswers, clarificationForm, isReviseMode]);
  const canRequestClarification = Boolean(draftInput.mission.trim()) && canUseSelectedRuntime && !clarifying && !drafting;
  const canDraft = Boolean(draftInput.mission.trim())
    && canUseSelectedRuntime
    && (isReviseMode || (Boolean(clarificationForm) && !missingRequiredClarification));
  const dialogTitle = isReviseMode ? 'AI 修订 Agent' : 'AI 创建 Agent';
  const inputLabel = isReviseMode ? '描述你想怎么修订这个 Agent' : '描述你需要的 Agent';
  const inputPlaceholder = isReviseMode
    ? '例如：让它更偏裁定席，补充回归验证和失败归因能力'
    : '这个 Agent 负责什么工作、解决哪类问题、在团队里扮演什么角色。';
  const generateLabel = isReviseMode
    ? (draftSessionId ? '发送调整' : '生成修订候选')
    : clarificationForm ? '提交回答并生成 Agent 草案' : '生成补充问题';
  const createLabel = isReviseMode ? '应用修订' : '一键创建';
  const creatingLabel = isReviseMode ? '应用中...' : '创建中...';
  const baselineDiffText = useMemo(() => formatAgentForDiff(baseAgent), [baseAgent]);
  const candidateDiffText = useMemo(() => formatAgentForDiff(draftResult || previewAgent), [draftResult, previewAgent]);
  const agentDiffRows = useMemo(() => (
    isReviseMode && candidateDiffText
      ? computeSimpleDiff(baselineDiffText, candidateDiffText)
      : []
  ), [baselineDiffText, candidateDiffText, isReviseMode]);
  const activeAiOutput = useMemo(() => {
    const shouldShowDraftOutput = isReviseMode
      || drafting
      || Boolean(draftRaw || draftThinking || draftStreamWarnings.length)
      || createStage === 'draft';
    if (shouldShowDraftOutput) {
      return {
        title: isReviseMode ? 'AI 正在生成修订候选' : 'AI 正在生成角色创建 item',
        progress: draftProgress,
        raw: draftRaw,
        thinking: draftThinking,
        warnings: draftStreamWarnings,
        streaming: drafting,
        emptyText: isReviseMode ? '发送修订要求后，AI 过程会显示在这里。' : '提交回答后，Agent 草案生成过程会显示在这里。',
      };
    }
    return {
      title: 'AI 正在生成补充问题',
      progress: clarificationProgress,
      raw: clarificationRaw,
      thinking: clarificationThinking,
      warnings: clarificationWarnings,
      streaming: clarifying,
      emptyText: '生成补充问题时，AI 过程会显示在这里。',
    };
  }, [
    clarificationProgress,
    clarificationRaw,
    clarificationThinking,
    clarificationWarnings,
    clarifying,
    createStage,
    draftProgress,
    draftRaw,
    draftStreamWarnings,
    draftThinking,
    drafting,
    isReviseMode,
  ]);

  const handleGenerateClarification = async () => {
    if (!canRequestClarification) {
      toast('warning', !canUseSelectedRuntime ? '请先选择模型' : '请先填写 Agent 需求');
      return;
    }
    try {
      setCreateStage('clarification');
      setClarifying(true);
      setClarificationForm(null);
      setClarificationAnswers({});
      setClarificationRaw('');
      setClarificationProgress('正在启动补充问答生成。');
      setClarificationThinking('');
      setClarificationWarnings([]);
      const result = await agentApi.clarifyAgentStream({
        displayName: effectiveDisplayName,
        team: draftInput.canSupervise === 'yes' ? 'black-gold' : draftInput.team,
        mission: draftInput.mission.trim(),
        style: draftInput.style.trim(),
        specialties: draftInput.specialties.trim(),
        workingDirectory: draftInput.workingDirectory?.trim(),
        referenceWorkflow: draftInput.referenceWorkflow?.trim(),
        engine: selectedEngine,
        model: selectedModel,
        mode: 'create',
        sessionId: clarificationSessionId || undefined,
      }, {
        onProgress: (data) => setClarificationProgress(data.message || '正在生成补充问答。'),
        onDelta: (content) => {
          if (!content) return;
          setClarificationRaw((prev) => prev + content);
        },
        onThinking: (content) => {
          if (!content) return;
          setClarificationThinking((prev) => `${prev}${content}`);
        },
        onSession: (sessionId) => {
          if (sessionId) setClarificationSessionId(sessionId);
        },
        onEngineError: (message) => {
          setClarificationWarnings((prev) => [...prev.slice(-3), message]);
        },
        onItem: (item) => {
          setClarificationProgress(`已生成 ${AGENT_CREATION_KIND_META[item.kind]?.title || item.kind}。`);
        },
        onForm: (form) => {
          setClarificationForm(form);
        },
        onRepair: (event) => {
          setClarificationWarnings((prev) => [
            ...prev.slice(-3),
            `${AGENT_CREATION_KIND_META[event.kind]?.title || event.kind} 第 ${event.attempt} 次自动修复中`,
          ]);
        },
      });
      setClarificationForm(result.form);
      if (result.raw) setClarificationRaw(result.raw);
      setClarificationProgress('补充问答已生成。');
      toast('success', `已生成 ${result.form.questions.length} 个补充问题`);
    } catch (error: any) {
      setClarificationProgress('补充问答生成失败。');
      toast('error', error?.message || '生成补充问答失败');
    } finally {
      setClarifying(false);
    }
  };

  const handleGenerateDraft = async () => {
    if (!canDraft) {
      toast('warning', isReviseMode
        ? '请填写修订要求'
        : missingRequiredClarification
          ? `请先回答：${missingRequiredClarification.label}`
          : '请先生成补充问题');
      return;
    }
    const revisionBaseAgent = isReviseMode ? (draftResult || baseAgent) : null;
    const submittedInstruction = draftInput.mission.trim();
    const assistantMessageId = `agent-draft-assistant-${Date.now()}`;
    try {
      if (!isReviseMode) setCreateStage('draft');
      setDrafting(true);
      setDraftResult(null);
      setDraftRaw('');
      setRecommendations(null);
      setValidation(null);
      setCreationItems([]);
      setRepairEvents([]);
      setDraftProgress('正在启动 Agent 草案生成。');
      setDraftThinking('');
      setDraftStreamWarnings([]);
      let streamedRaw = '';
      if (isReviseMode) {
        const now = new Date().toISOString();
        setDraftMessages((messages) => [
          ...messages,
          {
            id: `agent-draft-user-${Date.now()}`,
            role: 'user',
            content: submittedInstruction,
            createdAt: now,
            status: 'completed',
          },
          {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            createdAt: now,
            status: 'streaming',
          },
        ]);
      }
      const request = {
        displayName: isReviseMode && baseAgent ? baseAgent.name : effectiveDisplayName,
        team: isReviseMode && baseAgent ? baseAgent.team : (draftInput.canSupervise === 'yes' ? 'black-gold' : draftInput.team),
        mission: submittedInstruction,
        style: isReviseMode ? '' : draftInput.style.trim(),
        specialties: isReviseMode ? '' : draftInput.specialties.trim(),
        workingDirectory: isReviseMode ? '' : draftInput.workingDirectory?.trim(),
        referenceWorkflow: isReviseMode ? '' : draftInput.referenceWorkflow?.trim(),
        engine: selectedEngine,
        model: selectedModel,
        mode: isReviseMode ? 'revise' as const : 'create' as const,
        baseAgent: revisionBaseAgent,
        clarificationAnswers: isReviseMode ? '' : clarificationAnswerContext,
        sessionId: isReviseMode ? draftSessionId || undefined : undefined,
      };
      const result = await agentApi.draftAgentStream(request, {
        onProgress: (data) => setDraftProgress(data.message || '正在生成 Agent 草案。'),
        onDelta: (content) => {
          if (!content) return;
          streamedRaw += content;
          setDraftRaw((prev) => prev + content);
          if (isReviseMode) {
            setDraftMessages((messages) => messages.map((message) => (
              message.id === assistantMessageId
                ? { ...message, content: 'AI 正在生成修订候选，过程见右侧输出。', status: 'streaming' }
                : message
            )));
          }
        },
        onThinking: (content) => {
          if (!content) return;
          setDraftThinking((prev) => `${prev}${content}`);
        },
        onSession: (sessionId) => {
          if (sessionId) setDraftSessionId(sessionId);
        },
        onEngineError: (message) => {
          setDraftStreamWarnings((prev) => [...prev.slice(-3), message]);
        },
        onItem: (item) => {
          setCreationItems((prev) => [
            ...prev.filter((existing) => existing.kind !== item.kind),
            item,
          ]);
        },
        onRepair: (event) => {
          setRepairEvents((prev) => [...prev, event]);
          setDraftProgress(`${event.kind} 不完整，正在自动补齐。`);
        },
        onValidation: (nextValidation) => setValidation(nextValidation),
      });
      const agent = {
        ...(isReviseMode && baseAgent ? baseAgent : {}),
        ...(result.draft as AgentConfig),
        name: isReviseMode && baseAgent?.name ? baseAgent.name : (result.draft as AgentConfig).name,
        category: (result.draft as AgentConfig).category || baseAgent?.category || 'AI创建',
        tags: isReviseMode
          ? Array.from(new Set([...(baseAgent?.tags || []), ...(((result.draft as AgentConfig).tags || []) as string[]), 'AI修订'].filter(Boolean)))
          : Array.from(new Set(['AI创建', ...(((result.draft as AgentConfig).tags || []) as string[])])),
      };
      setDraftResult(agent);
      if (result.raw) {
        setDraftRaw(result.raw);
      }
      setRecommendations(result.recommendations || null);
      setValidation(result.validation || null);
      setCreationItems(result.items || []);
      setRepairEvents(result.repairEvents || []);
      setDraftProgress('Agent 草案已生成。');
      if (isReviseMode) {
        setDraftMessages((messages) => messages.map((message) => (
          message.id === assistantMessageId
            ? { ...message, content: '已生成 Agent 修订候选，差异和过程见右侧。', status: 'completed' }
            : message
        )));
        setDraftInput((prev) => ({ ...prev, mission: '' }));
      }
      toast('success', '已生成 Agent 草案');
    } catch (error: any) {
      setDraftProgress('Agent 草案生成失败。');
      if (isReviseMode) {
        setDraftMessages((messages) => messages.map((message) => (
          message.id === assistantMessageId
            ? { ...message, content: message.content || error?.message || 'Agent 草案生成失败', status: 'failed' }
            : message
        )));
      }
      toast('error', error?.message || '生成 Agent 草案失败');
    } finally {
      setDrafting(false);
    }
  };

  const handleRefreshAvatar = async () => {
    if (!previewAgent) return;
    try {
      setRefreshingAvatar(true);
      const result = await agentApi.generateAvatar({
        displayName: draftInput.displayName.trim() || previewAgent.name,
        team: previewAgent.team,
        mission: draftInput.mission.trim(),
        style: draftInput.style.trim(),
        variant: Math.random().toString(36).slice(2, 10),
      });
      const nextAgent = {
        ...(draftResult || previewAgent),
        avatar: result.avatar,
      };
      setDraftResult(nextAgent);
      toast('success', '已刷新角色头像');
    } catch (error: any) {
      toast('error', error?.message || '刷新头像失败');
    } finally {
      setRefreshingAvatar(false);
    }
  };

  const handleCreate = async () => {
    if (!draftResult) {
      toast('warning', '请先生成 Agent 草案');
      return;
    }
    try {
      setCreating(true);
      const created = await onCreate(draftResult);
      if (created !== false) {
        onClose();
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="h-[88vh] w-[94vw] max-w-6xl overflow-hidden border-border/70 p-0">
        <ComboboxPortalProvider>
          <div className="grid h-full min-h-0 grid-cols-1 bg-background lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
            <div className="flex min-h-0 min-w-0 flex-col border-r border-border/60 bg-muted/20 text-foreground">
              <div className="shrink-0 border-b border-border/70 bg-background/60 px-6 py-5">
                <DialogHeader className="space-y-3 text-left">
                  <Badge variant="secondary" className="w-fit">{dialogTitle}</Badge>
                  <DialogTitle className="text-2xl">
                    {isReviseMode
                      ? '用对话生成修订候选'
                      : showCreateClarificationStage
                        ? '补充问答'
                        : '先问清楚，再生成角色草案'}
                  </DialogTitle>
                  <DialogDescription className="text-muted-foreground">
                    {isReviseMode
                      ? 'AI 只生成候选；可以继续对话调整，确认后才会应用到 Agent 配置。'
                      : showCreateClarificationStage
                        ? '先回答会影响角色职责、协作关系和输出证据的关键问题，然后再生成草案。'
                        : '补充问答会作为正式上下文传给 AI，用于收敛角色职责、能力和提示词。'}
                  </DialogDescription>
                </DialogHeader>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-auto px-6 py-5">
                {isReviseMode && baseAgent ? (
                  <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
                    <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Baseline Agent</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{baseAgent.team}</Badge>
                      <div className="text-sm font-medium text-foreground">{baseAgent.name}</div>
                      {baseAgent.roleType ? <Badge variant="secondary">{baseAgent.roleType}</Badge> : null}
                    </div>
                    {baseAgent.description ? (
                      <div className="mt-2 text-xs leading-5 text-muted-foreground">{baseAgent.description}</div>
                    ) : null}
                  </div>
                ) : null}

                {isReviseMode ? (
                  <div className="rounded-2xl border border-border/70 bg-card/70">
                    <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                      <div>
                        <div className="text-sm font-medium">对话调整候选</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {draftSessionId ? '已进入多轮修订，会复用当前 AI session。' : '首轮会创建修订 session。'}
                        </div>
                      </div>
                      {drafting ? <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-100">生成中</Badge> : draftSessionId ? <Badge variant="outline">多轮</Badge> : null}
                    </div>
                    <div className="max-h-[300px] overflow-auto px-4 py-4">
                      <div className="space-y-3">
                        {draftMessages.length ? (
                          draftMessages.map((message) => (
                            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm ${
                                message.role === 'user'
                                  ? 'bg-primary text-primary-foreground'
                                  : message.status === 'failed'
                                    ? 'border border-red-400/35 bg-red-500/10 text-red-700 dark:text-red-100'
                                    : 'border border-border/70 bg-background/80 text-foreground'
                              }`}>
                                <div className="mb-1 text-[10px] opacity-60">{message.role === 'user' ? '你' : 'AI'}{message.status === 'streaming' ? ' · 生成中' : message.status === 'failed' ? ' · 失败' : ''}</div>
                                <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                  {message.content || '等待 AI 输出...'}
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="flex min-h-[140px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
                            <span className="material-symbols-outlined mb-2 text-3xl">forum</span>
                            <div className="font-medium text-foreground">先描述修订要求</div>
                            <div className="mt-1 max-w-sm text-xs leading-5">右侧会展示基线和当前候选的差异；后续继续发送调整会替换候选。</div>
                          </div>
                        )}
                        {drafting ? (
                          <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            <span className="deer-runner-sprite shrink-0" aria-hidden="true" />
                            <span>{draftProgress || 'AI 正在修订 Agent'}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {showCreateInputFields ? (
                  <div className="space-y-2">
                    <Label>角色名称（可选）</Label>
                    <Input
                      value={draftInput.displayName}
                      onChange={(event) => setDraftInput((prev) => ({ ...prev, displayName: event.target.value }))}
                      onBlur={(event) => setPreviewAvatarSeed(resolveDraftPreviewDisplayName({
                        ...draftInput,
                        displayName: event.target.value,
                      }))}
                      placeholder="例如：代码修复助手"
                      className="bg-background"
                    />
                  </div>
                ) : null}

                {isReviseMode || showCreateInputFields ? (
                <div className="space-y-2">
                  <Label>{inputLabel}</Label>
                  <Textarea
                    rows={isReviseMode ? 4 : 5}
                    value={draftInput.mission}
                    onChange={(event) => setDraftInput((prev) => ({ ...prev, mission: event.target.value }))}
                    onBlur={(event) => setPreviewAvatarSeed(resolveDraftPreviewDisplayName({
                      ...draftInput,
                      mission: event.target.value,
                    }))}
                    placeholder={inputPlaceholder}
                    className="bg-background"
                  />
                </div>
                ) : (
                  <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
                    <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Context</div>
                    <div className="mt-2 text-sm font-medium text-foreground">{effectiveDisplayName}</div>
                    <div className="mt-2 text-xs leading-5 text-muted-foreground">{draftInput.mission}</div>
                  </div>
                )}

                {!isReviseMode && createStage === 'clarification' ? (
                  <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">AI 补充问答</div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          先让 AI 提出会影响 Agent 职责、协作和归档输出的关键问题，回答后再生成草案。
                        </div>
                      </div>
                      {clarifying ? (
                        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-100">出题中</Badge>
                      ) : clarificationForm ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-100">已生成 {clarificationForm.questions.length} 题</Badge>
                      ) : (
                        <Badge variant="outline">等待出题</Badge>
                      )}
                    </div>

                    {clarificationForm ? (
                      <div className="mt-4 space-y-4">
                        {clarificationForm.summary ? (
                          <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
                            {clarificationForm.summary}
                          </div>
                        ) : null}
                        {(clarificationForm.knownFacts.length || clarificationForm.missingFields.length) ? (
                          <div className="grid gap-3 md:grid-cols-2">
                            {clarificationForm.knownFacts.length ? (
                              <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                                <div className="text-xs font-medium text-foreground">已确认信息</div>
                                <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                                  {clarificationForm.knownFacts.slice(0, 5).map((item) => (
                                    <div key={item}>- {item}</div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {clarificationForm.missingFields.length ? (
                              <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                                <div className="text-xs font-medium text-foreground">待补全信息</div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {clarificationForm.missingFields.slice(0, 6).map((item) => (
                                    <Badge key={item} variant="outline">{item}</Badge>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="space-y-3">
                          {clarificationForm.questions.map((item, index) => {
                            const options = getClarificationQuestionOptions(item);
                            const noteSuggestions = getClarificationNoteSuggestions(item);
                            const selectionMode = item.selectionMode === 'multiple' ? 'multiple' : 'single';
                            return (
                              <div key={item.id} className="space-y-3 rounded-xl border border-border/70 bg-muted/30 p-3">
                                <Label htmlFor={`agent-clarification-${item.id}`} className="text-sm">
                                  {index + 1}. {item.label}
                                  {item.required !== false ? <span className="text-destructive"> *</span> : null}
                                </Label>
                                <div className="text-xs leading-5 text-muted-foreground">{item.question}</div>
                                <div className="grid gap-2">
                                  {options.map((option) => {
                                    const selected = clarificationAnswers[item.id]?.optionIds?.includes(option.id) || false;
                                    return (
                                      <label
                                        key={`${item.id}-${option.id}`}
                                        onClick={() => {
                                          if (selectionMode !== 'single') return;
                                          setClarificationAnswers((prev) => ({
                                            ...prev,
                                            [item.id]: {
                                              optionIds: [option.id],
                                              note: prev[item.id]?.note || '',
                                            },
                                          }));
                                        }}
                                        className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition-colors ${
                                          selected
                                            ? 'border-primary/55 bg-primary/10'
                                            : 'border-border/70 bg-background/70 hover:bg-muted/50'
                                        }`}
                                      >
                                        {selectionMode === 'multiple' ? (
                                          <Checkbox
                                            checked={selected}
                                            onCheckedChange={(checked) => setClarificationAnswers((prev) => {
                                              const current = prev[item.id]?.optionIds || [];
                                              const nextOptionIds = checked
                                                ? [...new Set([...current, option.id])]
                                                : current.filter((id) => id !== option.id);
                                              return {
                                                ...prev,
                                                [item.id]: {
                                                  optionIds: nextOptionIds,
                                                  note: prev[item.id]?.note || '',
                                                },
                                              };
                                            })}
                                            className="mt-0.5"
                                          />
                                        ) : (
                                          <button
                                            type="button"
                                            className="mt-0.5"
                                            onClick={() => setClarificationAnswers((prev) => ({
                                              ...prev,
                                              [item.id]: {
                                                optionIds: [option.id],
                                                note: prev[item.id]?.note || '',
                                              },
                                            }))}
                                          >
                                            <div className={`h-4 w-4 rounded-full border ${selected ? 'border-primary' : 'border-muted-foreground/45'}`}>
                                              <div className={`m-[3px] h-2 w-2 rounded-full ${selected ? 'bg-primary' : 'bg-transparent'}`} />
                                            </div>
                                          </button>
                                        )}
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <div className="text-sm font-medium text-foreground">{option.label}</div>
                                            {option.recommended ? <Badge variant="secondary">推荐</Badge> : null}
                                          </div>
                                          {option.description ? (
                                            <div className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</div>
                                          ) : null}
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                                <Textarea
                                  id={`agent-clarification-${item.id}`}
                                  rows={3}
                                  value={clarificationAnswers[item.id]?.note || ''}
                                  placeholder={item.placeholder || '请输入你的补充说明'}
                                  onChange={(event) => setClarificationAnswers((prev) => ({
                                    ...prev,
                                    [item.id]: {
                                      optionIds: prev[item.id]?.optionIds || [],
                                      note: event.target.value,
                                    },
                                  }))}
                                  className="bg-background"
                                />
                                {noteSuggestions.length > 0 ? (
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className="text-muted-foreground">推荐补充</span>
                                    {noteSuggestions.map((suggestion) => (
                                      <button
                                        key={`${item.id}-${suggestion}`}
                                        type="button"
                                        className="max-w-full truncate rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-left text-muted-foreground transition-colors hover:border-primary/35 hover:bg-primary/10 hover:text-foreground"
                                        title={suggestion}
                                        onClick={() => setClarificationAnswers((prev) => {
                                          const current = prev[item.id]?.note?.trim() || '';
                                          const nextNote = current
                                            ? (current.includes(suggestion) ? current : `${current}\n${suggestion}`)
                                            : suggestion;
                                          return {
                                            ...prev,
                                            [item.id]: {
                                              optionIds: prev[item.id]?.optionIds || [],
                                              note: nextNote,
                                            },
                                          };
                                        })}
                                      >
                                        {suggestion}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center text-xs leading-5 text-muted-foreground">
                        填写 Agent 需求后点击“生成补充问题”，这里会出现可选择、可补充的结构化问答。
                      </div>
                    )}
                  </div>
                ) : null}

                {showCreateInputFields ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>默认阵营</Label>
                    <SingleCombobox
                      value={draftInput.team}
                      onValueChange={(value) => setDraftInput((prev) => ({ ...prev, team: value as AgentConfig['team'] }))}
                      options={[
                        { value: 'blue', label: '蓝队（攻击）' },
                        { value: 'red', label: '红队（防守）' },
                        { value: 'judge', label: '裁定席' },
                        { value: 'black-gold', label: '黑金指挥官' },
                      ]}
                      searchable={false}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>风格关键词</Label>
                    <Input
                      value={draftInput.style}
                      onChange={(event) => setDraftInput((prev) => ({ ...prev, style: event.target.value }))}
                      placeholder="理性、锐利、稳健、强执行"
                      className="bg-background"
                    />
                  </div>
                </div>
                ) : null}

                {showCreateInputFields ? (
                <div className="space-y-2">
                  <Label>擅长领域</Label>
                  <Textarea
                    rows={4}
                    value={draftInput.specialties}
                    onChange={(event) => setDraftInput((prev) => ({ ...prev, specialties: event.target.value }))}
                    placeholder="用逗号或换行分隔，例如：编译错误定位、补测试、重构、安全复核"
                    className="bg-background"
                  />
                </div>
                ) : null}

                {showCreateInputFields ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>是否需要可写代码</Label>
                    <SingleCombobox
                      value={draftInput.canCode}
                      onValueChange={(value) => setDraftInput((prev) => ({ ...prev, canCode: value as 'yes' | 'no' }))}
                      options={[
                        { value: 'yes', label: '需要' },
                        { value: 'no', label: '不需要' },
                      ]}
                      searchable={false}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>是否担任指挥官</Label>
                    <SingleCombobox
                      value={draftInput.canSupervise}
                      onValueChange={(value) => setDraftInput((prev) => ({ ...prev, canSupervise: value as 'yes' | 'no' }))}
                      options={[
                        { value: 'no', label: '普通 Agent' },
                        { value: 'yes', label: '指挥官 / Supervisor' },
                      ]}
                      searchable={false}
                    />
                  </div>
                </div>
                ) : null}

                {showCreateInputFields ? (
                <div className="space-y-2">
                  <Label>参考工作流</Label>
                  <SingleCombobox
                    value={draftInput.referenceWorkflow || '__none__'}
                    onValueChange={(value) => setDraftInput((prev) => ({ ...prev, referenceWorkflow: value === '__none__' ? '' : value }))}
                    options={[
                      { value: '__none__', label: '不指定' },
                      ...workflows.map((workflow) => ({
                        value: workflow.filename,
                        label: workflow.name ? `${workflow.name} · ${workflow.filename}` : workflow.filename,
                      })),
                    ]}
                    placeholder="选择一个已有 workflow 作为参考"
                  />
                </div>
                ) : null}

                {isReviseMode || showCreateInputFields ? (
                <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-foreground">{isReviseMode ? '修订引擎和模型' : '生成引擎和模型'}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {isReviseMode ? '只用于本次 AI 修订候选生成；确认应用后写入配置。' : '用于本次 AI 生成，也会写入创建出的 Agent 默认运行配置。'}
                      </div>
                    </div>
                    {!canUseSelectedRuntime ? (
                      <Badge variant="outline" className="border-amber-300/40 text-amber-700 dark:text-amber-100">请选择模型</Badge>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>引擎</Label>
                      <EngineSelect
                        value={selectedEngine}
                        onChange={(value) => {
                          setSelectedEngine(value);
                          setSelectedModel(value ? '' : model || '');
                        }}
                        allowGlobal
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>模型</Label>
                      <ModelSelect
                        value={selectedModel}
                        onChange={setSelectedModel}
                        engine={selectedEngine || engine}
                        allowGlobal={!selectedEngine}
                        showChangeToast={false}
                        className="bg-background"
                      />
                    </div>
                  </div>
                </div>
                ) : null}
              </div>

              <div className="shrink-0 border-t border-border/70 bg-background/80 px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {isReviseMode ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setDraftMessages([]);
                        setDraftSessionId(null);
                        setDraftResult(null);
                        setDraftRaw('');
                        setCreationItems([]);
                        setRepairEvents([]);
                        setValidation(null);
                        setDraftProgress('');
                      }}
                      disabled={drafting}
                    >
                      重置修订
                    </Button>
                  ) : showCreateClarificationStage ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setCreateStage('input');
                          setClarificationForm(null);
                          setClarificationAnswers({});
                          setClarificationRaw('');
                          setClarificationProgress('');
                          setClarificationThinking('');
                          setClarificationWarnings([]);
                        }}
                        disabled={clarifying || drafting}
                      >
                        上一步
                      </Button>
                      {clarificationForm && !clarifying ? (
                        <Button type="button" variant="outline" onClick={handleGenerateClarification} disabled={drafting}>
                          重新提问
                        </Button>
                      ) : null}
                    </div>
                  ) : <div />}
                  <Button
                    type="button"
                    onClick={() => {
                      if (!isReviseMode && !clarificationForm) {
                        void handleGenerateClarification();
                        return;
                      }
                      void handleGenerateDraft();
                    }}
                    disabled={
                      isReviseMode || clarificationForm
                        ? (!canDraft || drafting || clarifying)
                        : (!canRequestClarification || clarifying)
                    }
                  >
                    {clarifying
                      ? '出题中...'
                      : drafting
                        ? '生成中...'
                        : !canUseSelectedRuntime
                          ? '先选择模型'
                          : generateLabel}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-col bg-background">
              <div className="shrink-0 border-b border-border/70 px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{isReviseMode ? '基线 / 当前候选 Diff' : '角色卡预览'}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {isReviseMode ? '先检查候选差异，再应用到 Agent 配置。' : '确认后可直接创建，或继续打开完整编辑弹框。'}
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleRefreshAvatar} disabled={!previewAgent || refreshingAvatar || (isReviseMode && !draftResult)}>
                    {refreshingAvatar ? '刷新中...' : '刷新头像'}
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-auto p-6">
                <div className="rounded-[24px] border border-border/70 bg-card/70 p-4">
                  {isReviseMode ? (
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{draftResult ? '候选预览' : '当前基线预览'}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {draftResult ? '这是 AI 当前修订候选，确认应用后写入配置。' : '生成修订候选后，这里会切换为候选预览。'}
                        </div>
                      </div>
                      {draftResult ? <Badge variant="secondary">候选</Badge> : <Badge variant="outline">基线</Badge>}
                    </div>
                  ) : null}
                  {previewAgent ? (
                    <AgentHeroCard
                      agent={{
                        ...previewAgent,
                        description: previewAgent.description || draftInput.mission || baseAgent?.description,
                        capabilities: previewAgent.capabilities,
                        category: previewAgent.category || baseAgent?.category || 'AI创建',
                      }}
                    />
                  ) : (
                    <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
                      先填写角色需求，再生成角色卡
                    </div>
                  )}
                </div>

                <AgentAiOutputPanel
                  title={activeAiOutput.title}
                  progress={activeAiOutput.progress}
                  raw={activeAiOutput.raw}
                  thinking={activeAiOutput.thinking}
                  warnings={activeAiOutput.warnings}
                  streaming={activeAiOutput.streaming}
                  emptyText={activeAiOutput.emptyText}
                />

                {isReviseMode ? (
                  <div className="min-w-0 overflow-hidden rounded-[24px] border border-border/70 bg-card/70">
                    <div className="border-b border-border/70 px-4 py-3">
                      <div className="text-sm font-medium">候选差异</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {draftResult ? '当前展示基线 Agent 与 AI 候选的 JSON 差异。' : '生成修订候选后会显示差异。'}
                      </div>
                    </div>
                    <div className="max-h-[360px] min-w-0 overflow-auto p-4 font-mono text-xs leading-6">
                      {draftResult ? (
                        agentDiffRows.length ? agentDiffRows.map((row, index) => (
                          <div
                            key={`${row.type}-${index}`}
                            className={
                              row.type === 'add'
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : row.type === 'remove'
                                  ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                                  : 'text-muted-foreground'
                            }
                          >
                            <span className="mr-2 inline-block w-4 text-center align-top">
                              {row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' '}
                            </span>
                            <span className="whitespace-pre-wrap break-all [overflow-wrap:anywhere]">{row.text || ' '}</span>
                          </div>
                        )) : <div className="text-muted-foreground">没有差异。</div>
                      ) : (
                        <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                          等待 AI 生成修订候选
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-4 rounded-[24px] border border-border/70 bg-card/70 p-5">
                  <div className="grid gap-3 text-sm md:grid-cols-2">
                    <div className="rounded-2xl bg-muted/50 p-3">
                      <div className="text-xs text-muted-foreground">阵营</div>
                      <div className="mt-1 font-medium">{previewAgent?.team || '-'}</div>
                    </div>
                    <div className="rounded-2xl bg-muted/50 p-3">
                      <div className="text-xs text-muted-foreground">角色类型</div>
                      <div className="mt-1 font-medium">{previewAgent?.roleType || 'normal'}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground">能力标签</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(previewAgent?.capabilities || capabilities).slice(0, 8).map((item) => (
                        <Badge key={item} variant="outline">{item}</Badge>
                      ))}
                      {!(previewAgent?.capabilities || capabilities).length ? (
                        <span className="text-xs text-muted-foreground">等待生成</span>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground">系统提示词</div>
                    <div className="mt-2 max-h-[180px] overflow-auto rounded-2xl bg-muted/50 p-3 text-xs leading-6 text-muted-foreground">
                      {previewAgent?.systemPrompt || '等待生成'}
                    </div>
                  </div>
                </div>

                {!isReviseMode ? (
                  <AgentCreationStructuredResult items={creationItems} drafting={drafting} statusMessage={draftProgress} />
                ) : null}

                {!isReviseMode ? <AgentCreationRepairPanel events={repairEvents} /> : null}

                {validation?.issues?.length ? (
                  <div className="rounded-[24px] border border-border/70 bg-card/70 p-4">
                    <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Validator</div>
                    <div className="mt-3 space-y-2 text-xs leading-6 text-muted-foreground">
                      {validation.issues.map((issue, index) => (
                        <div key={`${issue.path.join('.')}-${index}`} className="rounded-xl border bg-muted/30 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={issue.severity === 'error' ? 'destructive' : 'secondary'}>
                              {issue.severity === 'error' ? '错误' : '警告'}
                            </Badge>
                            <span>{issue.path.join('.') || 'root'}</span>
                          </div>
                          <div className="mt-1">{issue.message}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {!isReviseMode && recommendations ? (
                  <div className="rounded-[24px] border border-border/70 bg-card/70 p-4">
                    <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Recommendation Chain</div>
                    <div className="mt-3 space-y-3 text-xs leading-6 text-muted-foreground">
                      {recommendations.referenceWorkflow ? (
                        <div className="rounded-2xl border bg-muted/30 p-3">
                          <div className="font-medium text-foreground">参考工作流</div>
                          <div>{recommendations.referenceWorkflow.name || recommendations.referenceWorkflow.filename}</div>
                          {recommendations.referenceWorkflow.description ? (
                            <div>{recommendations.referenceWorkflow.description}</div>
                          ) : null}
                          {recommendations.referenceWorkflow.agents.length ? (
                            <div>已有角色：{recommendations.referenceWorkflow.agents.join('、')}</div>
                          ) : null}
                        </div>
                      ) : null}
                      {recommendations.relationshipHints.length ? (
                        <div className="rounded-2xl border bg-muted/30 p-3">
                          <div className="font-medium text-foreground">协作关系提示</div>
                          <div className="mt-2 space-y-2">
                            {recommendations.relationshipHints.slice(0, 3).map((item) => (
                              <div key={`${item.agent}-${item.counterpart}`} className="rounded-xl border px-3 py-2">
                                <div>{item.agent} × {item.counterpart}</div>
                                <div>协作倾向 {item.synergyScore >= 0 ? '+' : ''}{item.synergyScore}</div>
                                {item.strengths.length ? (
                                  <div>强项：{item.strengths.join('、')}</div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {recommendations.experiences.length ? (
                        <div className="rounded-2xl border bg-muted/30 p-3">
                          <div className="font-medium text-foreground">历史经验</div>
                          <div className="mt-2 space-y-2">
                            {recommendations.experiences.map((item) => (
                              <div key={item.runId} className="rounded-xl border px-3 py-2">
                                <div>{item.workflowName || item.configFile}</div>
                                <div>{item.summary}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              <DialogFooter className="shrink-0 gap-2 border-t border-border/70 px-6 py-4">
                <Button variant="destructive" onClick={onClose}>取消</Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const agent = draftResult || (!isReviseMode ? previewAgent : null);
                    if (agent) onContinueEdit(agent);
                  }}
                  disabled={isReviseMode ? !draftResult : !previewAgent}
                >
                  打开完整编辑
                </Button>
                <Button onClick={handleCreate} disabled={!draftResult || creating}>
                  {creating ? creatingLabel : createLabel}
                </Button>
              </DialogFooter>
            </div>
          </div>
        </ComboboxPortalProvider>
      </DialogContent>
    </Dialog>
  );
}
