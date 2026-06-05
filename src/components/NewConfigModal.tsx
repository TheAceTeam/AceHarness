'use client';

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode, type Ref } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { useTheme } from 'next-themes';
import { stringify as stringifyYaml } from 'yaml';
import { newConfigFormSchema, type NewConfigForm } from '@/lib/core/schemas';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import WorkflowModeSelector from './WorkflowModeSelector';
import { EngineModelSelect } from './EngineModelSelect';
import { ComboboxPortalProvider } from './ui/combobox';
import Markdown from './Markdown';
import ChatMessage from './chat/ChatMessage';
import { MessageHistoryCollapse } from './chat/MessageHistoryCollapse';
import { parseActions } from '@/lib/chat/actions';
import {
  type ClarificationAnswerValue,
  type ClarificationFormResult,
  type ClarificationQuestionItem,
  type PlanDraftResult,
  type SpecCodingArtifactDrafts,
  type SpecCodingArtifactKey,
  type WorkflowDraftPreviewState,
} from '@/lib/ai/result-normalizers';
import {
  WORKFLOW_CLARIFICATION_FACTS_KIND,
  WORKFLOW_CLARIFICATION_GAPS_KIND,
  WORKFLOW_CLARIFICATION_QUESTION_KIND,
  WORKFLOW_CLARIFICATION_SUMMARY_KIND,
  SPEC_CODING_META_KIND,
  SPEC_DECISION_KIND,
  SPEC_DESIGN_KIND,
  SPEC_REQUIREMENT_KIND,
  SPEC_TASK_KIND,
  WORKFLOW_STATE_OUTLINE_KIND,
  WORKFLOW_STATE_STEPS_KIND,
  applyWorkflowCreationItem,
  assembleClarificationForm,
  assemblePlanDraftFromItems,
  assembleWorkflowConfigFromItems,
  createEmptyWorkflowCreationState,
  describeWorkflowCreationItem,
  extractWorkflowCreationItemResult,
  type WorkflowCreationItemKind,
  type WorkflowCreationItemResult,
  type WorkflowCreationState,
  type WorkflowCreationItemValidationContext,
} from '@/lib/ai/workflow-creation-items';
import WorkspaceDirectoryPicker from './common/WorkspaceDirectoryPicker';
import { useChat } from '@/contexts/ChatContext';
import { agentApi } from '@/lib/core/api';
import { compileStepTaskBindings } from '@/lib/spec/task-binding';
import { createSafeEventSource } from '@/lib/core/safe-event-source';
import { cn } from '@/lib/core/utils';

const MonacoEditor = dynamic(
  async () => {
    const monaco = await import('monaco-editor');
    const { loader, default: Editor } = await import('@monaco-editor/react');
    loader.config({ monaco });
    return Editor;
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        正在加载编辑器...
      </div>
    ),
  }
);

function hasOwnKey<T extends object>(value: T | null | undefined, key: PropertyKey): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeBackendSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const MAX_CREATION_AI_REPAIR_ATTEMPTS = 5;
const MAX_WORKFLOW_DRAFT_REPAIR_ATTEMPTS = MAX_CREATION_AI_REPAIR_ATTEMPTS;
const MODAL_HISTORY_RECENT_WINDOW = 8;
const PLANNING_STREAM_SCOPE = 'workflow-planning';
const CREATION_SESSION_TAG_PREFIX = '创建工作流 ·';
const SPEC_LANGUAGE_RULE = [
  '语言一致性规则：先判断用户原始需求、补充说明和澄清回答的主语言；所有 summary、clarification、requirements.md、design.md、tasks.md 必须统一使用该主语言。',
  '如果输入混合多种语言，以用户需求正文占比最高的语言为准；若用户最后明确指定语言，则以用户指定语言为准。',
  '文件名、代码、YAML key、API 名称、技术专名和产品名可以保留原文，但不要在多份正式计划制品之间混用中文和英文标题/说明。',
].join('\n');

const PERSIST_SPEC_MODE_STORAGE_KEY = 'aceharness.newConfig.persistMode';
const PERSIST_SPEC_ROOT_STORAGE_KEY = 'aceharness.newConfig.specRoot';
const SPEC_PLANNING_ENABLED_STORAGE_KEY = 'aceharness.newConfig.specPlanningEnabled';

function normalizePersistSpecValues(values: { persistMode?: string; specRoot?: string }) {
  const persistMode = values.persistMode === 'repository' ? 'repository' : 'none';
  const specRoot = persistMode === 'repository'
    ? ((values.specRoot || '').trim() || '.spec')
    : undefined;
  return { persistMode, specRoot };
}

function normalizeNewConfigFormValues(
  values: Partial<NewConfigForm>,
  mode: 'phase-based' | 'state-machine' | 'ai-guided'
) {
  const { persistMode, specRoot } = normalizePersistSpecValues(values);
  return {
    ...values,
    mode,
    workspaceMode: values.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place',
    persistMode,
    specRoot,
  };
}

function getReferenceWorkflowMode(mode: 'phase-based' | 'state-machine' | 'ai-guided') {
  return mode === 'state-machine' || mode === 'ai-guided' ? 'state-machine' : 'phase-based';
}

function normalizeReferenceWorkflowMode(mode?: string) {
  return mode === 'state-machine' ? 'state-machine' : 'phase-based';
}

type ModalAiMessage =
  | { role: 'ai' | 'user' | 'thinking'; content: string }
  | {
      role: 'repair-diagnostic';
      content: string;
      stage?: CreationStageKey;
      kind: 'clarification_form' | 'plan_draft' | 'workflow_draft' | WorkflowCreationItemKind;
      title?: string;
      failedOutput: string;
      repairPrompt: string;
      attempt: number;
      maxAttempts: number;
      reason?: string;
    };

const MODAL_MACHINE_RESULT_KIND_PATTERN = '(?:workflow_draft|plan_draft|clarification_form|workflow_clarification_summary|workflow_clarification_facts|workflow_clarification_gaps|workflow_clarification_question|spec_coding_meta|spec_requirement|spec_design|spec_decision|spec_task|workflow_state_outline|workflow_state_steps|workflow_patch_item|spec_revision_item|spec_coding_revision|spec-coding-revision)';
const REPAIR_DIAGNOSTIC_KIND_LABELS: Record<Extract<ModalAiMessage, { role: 'repair-diagnostic' }>['kind'], string> = {
  clarification_form: '澄清表单',
  plan_draft: '正式计划',
  workflow_draft: 'Workflow 草案',
  workflow_clarification_summary: '澄清摘要',
  workflow_clarification_facts: '已知事实',
  workflow_clarification_gaps: '待补信息',
  workflow_clarification_question: '澄清问题',
  spec_coding_meta: '计划摘要',
  spec_requirement: '需求小点',
  spec_design: '设计小点',
  spec_decision: '设计决策',
  spec_task: '任务小点',
  workflow_state_outline: '状态轮廓',
  workflow_state_steps: '状态步骤',
  workflow_patch_item: '工作流优化补丁',
  spec_revision_item: 'Spec 修订项',
};

function isModalAiRepairDiagnosticMessage(message: ModalAiMessage): message is Extract<ModalAiMessage, { role: 'repair-diagnostic' }> {
  return message.role === 'repair-diagnostic';
}

function createRepairDiagnosticMessage({
  stage,
  kind,
  title,
  failedOutput,
  repairPrompt,
  attempt,
  maxAttempts,
  reason,
}: Omit<Extract<ModalAiMessage, { role: 'repair-diagnostic' }>, 'role' | 'content'>): ModalAiMessage {
  const label = title || REPAIR_DIAGNOSTIC_KIND_LABELS[kind];
  return {
    role: 'repair-diagnostic',
    stage,
    kind,
    title,
    failedOutput,
    repairPrompt,
    attempt,
    maxAttempts,
    reason,
    content: `${label}未通过，正在自动修复（${attempt}/${maxAttempts}）`,
  };
}

type WorkflowRepairReasonDisplay = {
  field: string;
  problem: string;
  fix: string;
  fallback: string;
};

export function parseWorkflowRepairReasonForDisplay(reason?: string): WorkflowRepairReasonDisplay {
  const fallback = String(reason || '').trim();
  const normalized = fallback.replace(/\s+/g, ' ');
  const match = normalized.match(/错误字段：([\s\S]*?)。问题：([\s\S]*?)。修改方式：([\s\S]*)/);
  if (!match) {
    return {
      field: '',
      problem: '',
      fix: '',
      fallback,
    };
  }

  return {
    field: match[1]?.trim() || '',
    problem: match[2]?.trim() || '',
    fix: match[3]?.trim() || '',
    fallback,
  };
}

function truncateInline(value: string, limit = 150) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}...`;
}

function getRepairReasonPreview(reason?: string) {
  const display = parseWorkflowRepairReasonForDisplay(reason);
  if (display.field && display.problem) {
    return `字段 ${display.field}: ${display.problem}`;
  }
  return truncateInline(display.fallback || '系统没有拿到合法结构化结果。');
}

function isEqualOptionalString(a?: string | null, b?: string | null): boolean {
  return (a || '') === (b || '');
}

function getLatestAiMessageContent(messages: ModalAiMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'ai' && message.content.trim()) {
      return message.content;
    }
  }
  return '';
}

function mapPlanningChatMessages(messages: any[]): ModalAiMessage[] {
  const firstCreationMessageIndex = messages.findIndex((message) => (
    message?.role === 'user'
    && typeof message.content === 'string'
    && message.content.startsWith(CREATION_SESSION_TAG_PREFIX)
  ));
  const scopedMessages = firstCreationMessageIndex >= 0
    ? messages.slice(firstCreationMessageIndex)
    : messages;

  return scopedMessages
    .map((message): ModalAiMessage | null => {
      const content = typeof message?.rawContent === 'string' && message.rawContent.trim()
        ? message.rawContent
        : typeof message?.content === 'string'
          ? message.content
          : '';
      if (!content.trim()) return null;
      if (message.role === 'user') return { role: 'user' as const, content };
      return { role: 'ai' as const, content };
    })
    .filter((message): message is ModalAiMessage => Boolean(message));
}

function formatValidationIssuesForPrompt(validation: any): string {
  const issues = Array.isArray(validation?.issues)
    ? validation.issues
    : Array.isArray(validation?.details?.issues)
      ? validation.details.issues
      : [];
  if (issues.length === 0) {
    return validation?.message || validation?.error || '未知校验错误';
  }
  return issues
    .map((issue: any, index: number) => {
      const path = Array.isArray(issue?.path) && issue.path.length > 0 ? issue.path.join('.') : '(root)';
      const severity = issue?.severity || 'error';
      const message = issue?.message || '不合法';
      return `${index + 1}. [${severity}] ${path}: ${message}`;
    })
    .join('\n');
}

function truncateForPrompt(input: string | undefined, limit = 5000) {
  const text = (input || '').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n...[已截断，原文过长]`;
}

type WorkflowCreationItemStep = {
  kind: WorkflowCreationItemKind;
  name: string;
  title: string;
  guidance: string;
};

type WorkflowCreationActiveStep = {
  stage: CreationStageKey;
  kind: WorkflowCreationItemKind;
  title: string;
};

type WorkflowCreationRetryNotice = WorkflowCreationActiveStep & {
  attempt: number;
  maxAttempts: number;
  reason: string;
};

type WorkflowCreationRetryEvent = {
  stage?: CreationStageKey;
  kind: Extract<ModalAiMessage, { role: 'repair-diagnostic' }>['kind'];
  title: string;
  attempt: number;
  maxAttempts: number;
  reason: string;
};

function collectWorkflowCreationRetryEvents(
  messages: ModalAiMessage[],
  stage: CreationStageKey | null,
): WorkflowCreationRetryEvent[] {
  return messages
    .filter(isModalAiRepairDiagnosticMessage)
    .filter((message) => !stage || !message.stage || message.stage === stage)
    .map((message) => ({
      stage: message.stage,
      kind: message.kind,
      title: message.title || REPAIR_DIAGNOSTIC_KIND_LABELS[message.kind],
      attempt: message.attempt,
      maxAttempts: message.maxAttempts,
      reason: message.reason || '',
    }));
}

function buildWorkflowCreationItemExample(kind: WorkflowCreationItemKind, name: string): Record<string, any> {
  if (kind === WORKFLOW_CLARIFICATION_SUMMARY_KIND) {
    return { kind, data: { summary: '用 1-2 句话概括当前目标、对象和成功结果。' } };
  }
  if (kind === WORKFLOW_CLARIFICATION_FACTS_KIND) {
    return { kind, data: { facts: ['已确认事实 1，最好带来源。', '已确认事实 2。'] } };
  }
  if (kind === WORKFLOW_CLARIFICATION_GAPS_KIND) {
    return { kind, data: { gaps: ['blocking: 会影响方案的缺口。', 'optional: 可后续补充的偏好。'] } };
  }
  if (kind === WORKFLOW_CLARIFICATION_QUESTION_KIND) {
    return {
      kind,
      data: {
        id: name,
        label: '问题标签',
        question: '具体问题，并说明这个答案会影响什么决策。',
        selectionMode: 'single',
        options: [
          { id: 'recommended', label: '推荐选项', description: '说明默认方案和影响。', recommended: true },
          { id: 'alternative', label: '备选方案', description: '说明取舍。' },
        ],
        placeholder: '跳过时系统采用的保守假设。',
        required: true,
      },
    };
  }
  if (kind === SPEC_CODING_META_KIND) {
    return {
      kind,
      data: {
        summary: '计划摘要',
        goals: ['目标'],
        nonGoals: ['非目标'],
        constraints: ['约束'],
        glossary: [{ term: '关键术语', definition: '本次需求里必须统一理解的对象或边界。' }],
      },
    };
  }
  if (kind === SPEC_REQUIREMENT_KIND) {
    return { kind, data: { id: name || 'R1', title: '需求标题', userStory: '作为某类用户，我希望...', acceptanceCriteria: ['WHEN 条件 THEN 结果。'] } };
  }
  if (kind === SPEC_DESIGN_KIND) {
    return {
      kind,
      data: {
        overview: '设计概览',
        architecture: ['主流程'],
        components: ['组件'],
        interfaces: ['契约'],
        dataModels: ['核心数据对象：字段、来源、用途和生命周期。'],
        pseudocode: '1. 接收输入\\n2. 校验约束\\n3. 执行核心逻辑\\n4. 返回可验证结果',
        keyCode: 'async function run(input) {\\n  return verify(await execute(input));\\n}',
        testPlan: ['单元测试核心转换逻辑', '集成测试主流程和异常路径'],
        compatibility: '说明旧数据、旧配置或旧接口的兼容策略；如无兼容需求，写明无需兼容。',
        assumptions: ['假设'],
        mermaid: 'flowchart TD\\n  A --> B',
      },
    };
  }
  if (kind === SPEC_DECISION_KIND) {
    return { kind, data: { id: name || 'D1', topic: '决策主题', choice: '选择', reason: '理由' } };
  }
  if (kind === SPEC_TASK_KIND) {
    return { kind, data: { id: name || 'T1.1', title: '任务标题', requirementIds: ['R1'], designRefs: ['D1'], actions: ['具体动作'], deliverables: ['交付物'], validation: '验证方式' } };
  }
  if (kind === WORKFLOW_STATE_OUTLINE_KIND) {
    return {
      kind,
      data: {
        states: [
          {
            name: '准备',
            description: '准备输入与约束',
            transitions: [
              { to: '执行', condition: { verdict: 'pass' }, label: '准备完成' },
              { to: '准备', condition: { verdict: 'fail' }, label: '信息不足，继续准备' },
            ],
          },
          { name: '执行', description: '完成核心工作' },
          { name: '完成', description: '汇总结果', isFinal: true },
        ],
      },
    };
  }
  if (kind === WORKFLOW_STATE_STEPS_KIND) {
    return {
      kind,
      data: {
        stateName: name || '执行',
        steps: [
          {
            name: '步骤名称',
            agent: 'developer',
            task: '清楚说明该步骤要完成的工作和输出。',
            specTaskBinding: { taskIds: ['T1.1'], requirementIds: ['R1'], artifactKeys: ['requirements', 'design', 'tasks'] },
          },
        ],
        transitions: [
          { to: '完成', condition: { verdict: 'pass' }, label: '执行完成' },
          { to: name || '执行', condition: { verdict: 'conditional_pass' }, label: '带条件继续迭代' },
        ],
      },
    };
  }
  return { kind, data: {} };
}

function summarizeWorkflowCreationStateForPrompt(state: WorkflowCreationState): string {
  const summary = {
    clarification: state.clarification,
    spec: {
      summary: state.spec.summary,
      goals: state.spec.goals,
      nonGoals: state.spec.nonGoals,
      constraints: state.spec.constraints,
      glossary: state.spec.glossary,
      requirements: state.spec.requirements,
      design: {
        overview: state.spec.design.overview,
        dataModels: state.spec.design.dataModels,
        testPlan: state.spec.design.testPlan,
        decisions: state.spec.design.decisions,
      },
      tasks: state.spec.tasks,
    },
    workflow: {
      outline: state.workflow.outline,
      statesWithSteps: Object.keys(state.workflow.stateSteps),
      statesWithTransitions: Object.keys(state.workflow.stateTransitions || {}),
    },
  };
  return truncateForPrompt(JSON.stringify(summary, null, 2), 6000);
}

function buildWorkflowCreationItemSystemPrompt(step: WorkflowCreationItemStep, baseContext: string): string {
  return [
    '你正在 ACEHarness 的分步工作流创建向导中工作。',
    `当前小点名称：${step.name}`,
    `当前小点类型：${step.kind}`,
    '请完成当前小点，并在回复末尾输出机器可读结果。',
    '机器可读结果必须放在 <result>...</result> 内，且 <result> 内只放一个裸 JSON 对象，不使用 Markdown 代码块。',
    `JSON 顶层固定为 {"kind":"${step.kind}","data":{...}}。`,
    '可以在 <result> 外用 1-3 句简短说明你的判断。',
    '输出 </result> 后不要追加任何文字。',
    SPEC_LANGUAGE_RULE,
    '',
    '当前小点说明：',
    step.guidance,
    '',
    '格式示例：',
    '<result>',
    JSON.stringify(buildWorkflowCreationItemExample(step.kind, step.name), null, 2),
    '</result>',
    '',
    '创建上下文：',
    baseContext,
  ].join('\n\n');
}

function buildWorkflowCreationItemUserMessage(step: WorkflowCreationItemStep, state: WorkflowCreationState, extraContext?: string): string {
  return [
    `请生成小点：${step.title}`,
    `小点名称：${step.name}`,
    `小点类型：${step.kind}`,
    '',
    step.guidance,
    extraContext ? ['', extraContext].join('\n') : '',
    '',
    '系统已确认的小点：',
    '```json',
    summarizeWorkflowCreationStateForPrompt(state),
    '```',
  ].filter(Boolean).join('\n\n');
}

function buildWorkflowCreationItemRepairMessage(
  step: WorkflowCreationItemStep,
  previousOutput: string,
  reason: string,
): string {
  return [
    `当前小点「${step.title}」没有通过系统解析或校验。`,
    '错误定位：',
    reason,
    '',
    '请按下面的修改方式补发当前小点：',
    `1. 顶层 kind 必须等于 "${step.kind}"。`,
    '2. 内容必须放在 data 对象里，并补齐错误定位中点名的字段。',
    '3. 只补发当前小点，不要把其他小点混进同一个结果块。',
    `JSON 顶层固定为 {"kind":"${step.kind}","data":{...}}。`,
    '结果必须放在 <result>...</result> 内，且 <result> 内只放一个裸 JSON 对象。',
    '输出 </result> 后不要追加任何文字。',
    '',
    '当前小点说明：',
    step.guidance,
    '',
    '格式示例：',
    '<result>',
    JSON.stringify(buildWorkflowCreationItemExample(step.kind, step.name), null, 2),
    '</result>',
    '',
    '上一轮输出：',
    '```text',
    previousOutput.slice(0, 6000),
    '```',
  ].join('\n\n');
}

function formatErrorForRepair(error: any): string {
  const lines: string[] = [];
  const message = error?.message || (typeof error === 'string' ? error : '');
  if (message) lines.push(`message: ${message}`);
  if (error?.name) lines.push(`name: ${error.name}`);
  if (error?.code) lines.push(`code: ${error.code}`);
  if (error?.status) lines.push(`status: ${error.status}`);
  if (error?.stack) lines.push(`stack:\n${String(error.stack)}`);
  if (error?.data !== undefined) {
    try {
      lines.push(`data:\n${JSON.stringify(error.data, null, 2)}`);
    } catch {
      lines.push(`data: ${String(error.data)}`);
    }
  }
  return lines.join('\n') || String(error || '未知错误');
}

function formatStreamPayloadPreview(payload: string, limit = 2000): string {
  const text = String(payload || '').trim();
  if (!text) return '<empty>';
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]` : text;
}

function mergeWorkflowDraftValidation(baseValidation: any, bindingValidation?: any) {
  if (!bindingValidation) return baseValidation;
  const baseIssues = Array.isArray(baseValidation?.issues) ? baseValidation.issues : [];
  const bindingErrors = Array.isArray(bindingValidation?.errors)
    ? bindingValidation.errors.map((message: string) => ({
        severity: 'error',
        path: ['workflow', 'steps', 'specTaskBinding'],
        message,
      }))
    : [];
  const bindingWarnings = Array.isArray(bindingValidation?.warnings)
    ? bindingValidation.warnings.map((message: string) => ({
        severity: 'warning',
        path: ['workflow', 'steps', 'specTaskBinding'],
        message,
      }))
    : [];

  return {
    ...(baseValidation || {}),
    ok: Boolean(baseValidation?.ok) && Boolean(bindingValidation?.ok),
    issues: [...baseIssues, ...bindingErrors, ...bindingWarnings],
    normalized: baseValidation?.normalized,
    bindingValidation,
  };
}

interface NewConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (filename: string, result?: { creationSession?: any }) => void;
  homepageCompact?: boolean;
  resumeCreationSessionId?: string | null;
  initialMode?: 'phase-based' | 'state-machine' | 'ai-guided';
  initialWorkflowName?: string;
  initialReferenceWorkflow?: string;
  initialRequirements?: string;
  initialDescription?: string;
  initialWorkingDirectory?: string;
  initialWorkspaceMode?: 'isolated-copy' | 'in-place';
  frontendSessionId?: string | null;
  hideAiGuided?: boolean;
  inheritEngine?: string;
  inheritModel?: string;
  focusRequirementsOnOpen?: boolean;
}

type ReferenceWorkflowSummary = {
  filename: string;
  name: string;
  description?: string;
  mode?: 'phase-based' | 'state-machine';
};

type WorkflowCreationRecommendations = {
  experiences: Array<{
    runId: string;
    workflowName?: string;
    configFile: string;
    summary: string;
    experience: string[];
    nextFocus: string[];
  }>;
  referenceWorkflow: null | {
    filename: string;
    name?: string;
    description?: string;
    mode: 'phase-based' | 'state-machine';
    agents: string[];
    supervisorAgent?: string;
    source?: 'manual' | 'recommended-experience';
    autoApply?: boolean;
  };
  recommendedAgents: string[];
  recommendedSupervisorAgent?: string;
  availableStepAgents?: string[];
  availableSupervisorAgents?: string[];
  relationshipHints: Array<{
    agent: string;
    counterpart: string;
    synergyScore: number;
    strengths: string[];
    lastConfigFile?: string;
  }>;
};

type CreationStageKey = 'clarification' | 'specPlanning' | 'workflowDraft';

function buildArtifactDrafts(specCoding: any): SpecCodingArtifactDrafts {
  return {
    requirements: specCoding?.artifacts?.requirements || '',
    design: specCoding?.artifacts?.design || '',
    tasks: specCoding?.artifacts?.tasks || '',
  };
}

function computeSimpleDiff(base: string, next: string): Array<{ type: 'same' | 'add' | 'remove'; text: string }> {
  const baseLines = base.split(/\r?\n/);
  const nextLines = next.split(/\r?\n/);
  const max = Math.max(baseLines.length, nextLines.length);
  const rows: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = [];

  for (let i = 0; i < max; i += 1) {
    const before = baseLines[i];
    const after = nextLines[i];
    if (before === after) {
      if (before !== undefined) rows.push({ type: 'same', text: before });
      continue;
    }
    if (before !== undefined) rows.push({ type: 'remove', text: before });
    if (after !== undefined) rows.push({ type: 'add', text: after });
  }

  return rows;
}

async function modalAuthFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  if (response.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('auth-token');
    localStorage.removeItem('auth-user');
    window.dispatchEvent(new CustomEvent('auth:expired'));
    if (window.location.pathname !== '/login') {
      window.location.replace('/login');
    }
  }
  return response;
}

async function modalAuthJsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await modalAuthFetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `请求失败: ${response.status}`);
  }
  return data as T;
}

async function modalSessionJsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  return modalAuthJsonFetch<T>(url, init);
}

type WorkflowAgentTaskSummary = {
  agent: string;
  role: string | null;
  stepCount: number;
  taskCount: number;
  items: Array<{
    nodeName: string;
    stepName: string;
    task: string;
    role: string | null;
  }>;
};

type PlanTaskAgentMapping = {
  id: string;
  source: 'task' | 'workflow';
  phaseName: string;
  stepName: string;
  taskTitle: string;
  detail: string;
  agentNames: string[];
};

type WorkflowStepBindingItem = {
  id: string;
  nodeName: string;
  nodeType: 'phase' | 'state';
  nodeIndex: number;
  stepIndex: number;
  stepName: string;
  task: string;
  role: string | null;
  agent: string;
};

type WorkflowBindingChange = {
  stepId: string;
  nodeName: string;
  stepName: string;
  fromAgent: string;
  toAgent: string;
};

type WorkflowDraftVisualNode = {
  id: string;
  type: 'state' | 'phase';
  index: number;
  name: string;
  description: string;
  agents: string[];
  steps: Array<{
    name: string;
    agent: string;
    role: string | null;
    task: string;
  }>;
  transitions: Array<{
    to: string;
    label: string;
    condition: string;
  }>;
  checkpoint?: string;
  isInitial?: boolean;
  isFinal?: boolean;
};

function stripUnclosedResultTail(markdown: string) {
  const lower = markdown.toLowerCase();
  const lastOpen = lower.lastIndexOf('<result>');
  if (lastOpen === -1) return markdown;
  const lastClose = lower.lastIndexOf('</result>');
  if (lastOpen > lastClose) {
    return markdown.slice(0, lastOpen).trimEnd();
  }
  return markdown;
}

function stripResultBlocksForDisplay(markdown: string) {
  return stripUnclosedResultTail(markdown)
    .replace(/<result>[\s\S]*?<\/result>/gi, '')
    .trim();
}

function stripMachineJsonDraftBlocks(markdown: string) {
  const kindRegex = new RegExp(`"(?:kind|type)"\\s*:\\s*"${MODAL_MACHINE_RESULT_KIND_PATTERN}"`, 'i');
  return markdown
    .replace(/^```[ \t]*json[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gim, (full, body: string) => {
      const trimmed = String(body || '').trim();
      if (kindRegex.test(trimmed)) {
        return '';
      }
      return full;
    })
    .replace(new RegExp(`(^|\\n)\\s*(\\{[\\s\\S]*?"(?:kind|type)"\\s*:\\s*"${MODAL_MACHINE_RESULT_KIND_PATTERN}"[\\s\\S]*?\\})\\s*(?=\\n|$)`, 'gi'), '$1')
    .trim();
}

export function getDisplayContentForAiStream(markdown: string) {
  return stripMachineJsonDraftBlocks(stripResultBlocksForDisplay(markdown));
}

function joinModalAiProcessContent(...parts: Array<string | null | undefined>) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function mergeModalAiThinkingMessages(messages: ModalAiMessage[]): ModalAiMessage[] {
  const merged: ModalAiMessage[] = [];
  let pendingThinking = '';

  for (const message of messages) {
    if (message.role === 'thinking') {
      pendingThinking = joinModalAiProcessContent(pendingThinking, message.content);
      continue;
    }

    if (message.role === 'ai' && pendingThinking) {
      merged.push({
        ...message,
        content: joinModalAiProcessContent(pendingThinking, message.content),
      });
      pendingThinking = '';
      continue;
    }

    if (pendingThinking) {
      merged.push({ role: 'ai', content: pendingThinking });
      pendingThinking = '';
    }

    merged.push(message);
  }

  if (pendingThinking) {
    merged.push({ role: 'ai', content: pendingThinking });
  }

  return merged;
}

const modalChatActionNoop = (_actionId: string) => {};
const modalChatPromptNoop = (_prompt: string) => {};

export function ModalAiGenerationPanel({
  content,
  isStreaming = false,
  title = 'AI 输出',
  description,
  className = '',
}: {
  content: string;
  isStreaming?: boolean;
  title?: string;
  description?: string;
  className?: string;
}) {
  const displayContent = getDisplayContentForAiStream(content);
  const { text, cards } = parseActions(displayContent);
  const hasVisibleContent = Boolean(text.trim() || cards.length);
  if (!hasVisibleContent && !isStreaming) return null;

  return (
    <div className={`overflow-hidden rounded-lg border bg-muted/35 ${className}`} data-testid="modal-ai-generation-panel">
      <div className="flex items-start gap-2 border-b bg-background/70 px-3 py-2.5">
        {isStreaming ? (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-500" />
        ) : (
          <span className="material-symbols-outlined mt-0.5 text-base text-blue-500">auto_awesome</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          {description ? (
            <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{description}</div>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 px-3 py-3">
        <ChatMessage
          message={{
            id: `modal-ai-${title}`,
            role: 'assistant',
            content: text,
            rawContent: displayContent || content,
            cards,
          }}
          isStreaming={isStreaming}
          onConfirmAction={modalChatActionNoop}
          onRejectAction={modalChatActionNoop}
          onUndoAction={modalChatActionNoop}
          onRetryAction={modalChatActionNoop}
          onAction={modalChatPromptNoop}
        />
      </div>
    </div>
  );
}

function ModalRepairDiagnosticDetail({ title, value }: { title: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">{title}</div>
      <pre className="max-h-64 overflow-auto rounded-md border bg-background p-3 text-xs leading-5 text-foreground whitespace-pre-wrap break-words">
        {value || '(空)'}
      </pre>
    </div>
  );
}

function ModalRepairDiagnosticPanel({ message }: {
  message: Extract<ModalAiMessage, { role: 'repair-diagnostic' }>;
}) {
  const label = REPAIR_DIAGNOSTIC_KIND_LABELS[message.kind];
  const reason = parseWorkflowRepairReasonForDisplay(message.reason);
  return (
    <details
      className="group overflow-hidden rounded-lg border border-amber-500/30 bg-amber-500/10 [&_summary::-webkit-details-marker]:hidden"
      data-testid="modal-repair-diagnostic"
    >
      <summary className="flex cursor-pointer select-none items-start gap-2 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100">
        <span className="material-symbols-outlined mt-0.5 text-base text-amber-600 dark:text-amber-300">build</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{message.content}</span>
          <span className="mt-0.5 block truncate text-[11px] leading-5 text-amber-800/80 dark:text-amber-100/80">
            {getRepairReasonPreview(message.reason)}
          </span>
        </span>
        <span className="mt-0.5 rounded-full border border-amber-500/30 bg-background/60 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-200">
          第 {message.attempt}/{message.maxAttempts} 次
        </span>
        <span className="material-symbols-outlined text-base transition-transform group-open:rotate-180">expand_more</span>
      </summary>
      <div className="space-y-3 border-t border-amber-500/20 bg-background/75 px-3 py-3">
        <div className="rounded-md border bg-background/80 p-3 text-xs leading-5">
          <div className="font-medium text-foreground">{label}需要自动修复</div>
          {reason.field || reason.problem || reason.fix ? (
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <div>
                <div className="text-[11px] font-medium text-muted-foreground">错误字段</div>
                <div className="mt-1 text-foreground">{reason.field || '未定位到具体字段'}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-muted-foreground">问题</div>
                <div className="mt-1 text-foreground">{reason.problem || '结构化内容不完整'}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-muted-foreground">修改方式</div>
                <div className="mt-1 text-foreground">{reason.fix || '按当前小点格式重新补发'}</div>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-muted-foreground">{reason.fallback || '系统没有拿到合法结构化结果。'}</div>
          )}
        </div>
        <div className="text-xs leading-5 text-muted-foreground">
          下面保留失败内容和本轮发回 AI 的修复提示，默认收起，方便需要排查时展开。
        </div>
        <ModalRepairDiagnosticDetail title="失败的结构化内容" value={message.failedOutput} />
        <ModalRepairDiagnosticDetail title="发给 AI 的修复提示" value={message.repairPrompt} />
      </div>
    </details>
  );
}

function RetryAttemptDots({ attempt, maxAttempts }: { attempt: number; maxAttempts: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`第 ${attempt} 次重试，共 ${maxAttempts} 次`}>
      {Array.from({ length: Math.max(maxAttempts, 1) }).map((_, index) => {
        const dotIndex = index + 1;
        const isCurrent = dotIndex === attempt;
        const isPast = dotIndex < attempt;
        return (
          <span
            key={dotIndex}
            className={`h-1.5 w-1.5 rounded-full ${
              isCurrent
                ? 'bg-amber-500 ring-2 ring-amber-500/20'
                : isPast
                  ? 'bg-amber-400/70'
                  : 'bg-amber-500/20'
            }`}
          />
        );
      })}
    </div>
  );
}

function WorkflowCreationRetryCallout({
  notice,
  events = [],
}: {
  notice: WorkflowCreationRetryNotice;
  events?: WorkflowCreationRetryEvent[];
}) {
  const reason = parseWorkflowRepairReasonForDisplay(notice.reason);
  const recentEvents = events.slice(-3);

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3" data-testid="workflow-creation-retry-callout">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-100">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
        <span>正在自动修复：{notice.title}</span>
        <Badge variant="outline">第 {notice.attempt}/{notice.maxAttempts} 次</Badge>
        <RetryAttemptDots attempt={notice.attempt} maxAttempts={notice.maxAttempts} />
      </div>
      <div className="mt-2 rounded-md border border-amber-500/20 bg-background/70 p-2.5 text-xs leading-5">
        {reason.field || reason.problem || reason.fix ? (
          <div className="grid gap-2 md:grid-cols-3">
            <div>
              <div className="text-[11px] font-medium text-muted-foreground">错误字段</div>
              <div className="mt-0.5 text-foreground">{reason.field || '未定位到具体字段'}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-muted-foreground">问题</div>
              <div className="mt-0.5 text-foreground">{reason.problem || '结构化内容不完整'}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-muted-foreground">修改方式</div>
              <div className="mt-0.5 text-foreground">{reason.fix || '按当前小点格式重新补发'}</div>
            </div>
          </div>
        ) : (
          <div className="text-foreground">{truncateInline(reason.fallback || notice.reason || '系统正在根据校验结果补发这个小点。', 220)}</div>
        )}
      </div>
      {recentEvents.length ? (
        <div className="mt-2 space-y-1.5">
          <div className="text-[11px] font-medium text-amber-900/80 dark:text-amber-100/80">最近重试点</div>
          {recentEvents.map((event, index) => (
            <div
              key={`${event.title}-${event.attempt}-${index}`}
              className="flex items-start gap-2 rounded-md bg-background/55 px-2.5 py-1.5 text-[11px] leading-5 text-muted-foreground"
            >
              <span className="material-symbols-outlined mt-0.5 text-[14px] text-amber-500">sync_problem</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-foreground">{event.title}</span>
                <span className="text-muted-foreground"> · 第 {event.attempt}/{event.maxAttempts} 次 · {getRepairReasonPreview(event.reason)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
          失败原文和发回 AI 的修复提示会保存在下方可展开记录中。
        </div>
      )}
    </div>
  );
}

function formatWorkflowCondition(condition: any): string {
  if (!condition || typeof condition !== 'object') return '';
  if (typeof condition.verdict === 'string') {
    const verdictLabels: Record<string, string> = {
      pass: '通过',
      conditional_pass: '有条件通过',
      fail: '失败',
    };
    return verdictLabels[condition.verdict] || `verdict=${condition.verdict}`;
  }
  const entries = Object.entries(condition)
    .filter(([, value]) => value !== undefined && value !== null)
    .slice(0, 3);
  if (entries.length === 0) return '';
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(', ');
}

function createVerdictTransitions(input: {
  passTo: string;
  conditionalPassTo: string;
  failTo: string;
  passLabel: string;
  conditionalPassLabel: string;
  failLabel: string;
}) {
  return [
    { to: input.passTo, condition: { verdict: 'pass' }, priority: 10, label: input.passLabel },
    { to: input.conditionalPassTo, condition: { verdict: 'conditional_pass' }, priority: 20, label: input.conditionalPassLabel },
    { to: input.failTo, condition: { verdict: 'fail' }, priority: 30, label: input.failLabel },
  ];
}

function buildWorkflowDraftVisualModel(config: any): {
  mode: 'phase-based' | 'state-machine';
  supervisorAgent: string;
  nodes: WorkflowDraftVisualNode[];
} {
  const workflow = config?.workflow || {};
  const isStateMachine = Array.isArray(workflow.states);
  const nodeType: 'state' | 'phase' = isStateMachine ? 'state' : 'phase';
  const rawNodes = isStateMachine
    ? workflow.states
    : Array.isArray(workflow.phases)
      ? workflow.phases
      : [];

  const nodes: WorkflowDraftVisualNode[] = rawNodes.map((node: any, index: number) => {
    const steps = Array.isArray(node?.steps) ? node.steps : [];
    const visualSteps = steps.map((step: any, stepIndex: number) => ({
      name: typeof step?.name === 'string' && step.name.trim() ? step.name.trim() : `步骤 ${stepIndex + 1}`,
      agent: typeof step?.agent === 'string' && step.agent.trim() ? step.agent.trim() : '未分配 Agent',
      role: typeof step?.role === 'string' && step.role.trim() ? step.role.trim() : null,
      task: typeof step?.task === 'string' ? step.task.trim() : '',
    }));
    const agents = [...new Set(visualSteps.map((step: { agent: string }) => step.agent).filter(Boolean))] as string[];
    const transitions = Array.isArray(node?.transitions)
      ? node.transitions.map((transition: any) => ({
        to: typeof transition?.to === 'string' ? transition.to : '',
        label: typeof transition?.label === 'string' && transition.label.trim()
          ? transition.label.trim()
          : typeof transition?.to === 'string'
            ? `转到 ${transition.to}`
            : '转移',
        condition: formatWorkflowCondition(transition?.condition),
      })).filter((transition: { to: string }) => transition.to)
      : [];

    return {
      id: `${nodeType}-${index}`,
      type: nodeType,
      index,
      name: typeof node?.name === 'string' && node.name.trim()
        ? node.name.trim()
        : `${isStateMachine ? '状态' : '阶段'} ${index + 1}`,
      description: typeof node?.description === 'string' && node.description.trim()
        ? node.description.trim()
        : visualSteps.map((step: { task: string }) => step.task).filter(Boolean).join('；'),
      agents,
      steps: visualSteps,
      transitions,
      checkpoint: typeof node?.checkpoint?.name === 'string' ? node.checkpoint.name : '',
      isInitial: node?.isInitial === true,
      isFinal: node?.isFinal === true,
    };
  });

  return {
    mode: isStateMachine ? 'state-machine' : 'phase-based',
    supervisorAgent: typeof workflow?.supervisor?.agent === 'string' && workflow.supervisor.agent.trim()
      ? workflow.supervisor.agent.trim()
      : 'default-supervisor',
    nodes,
  };
}

function buildWorkflowAgentTaskSummaries(config: any): WorkflowAgentTaskSummary[] {
  const workflow = config?.workflow || {};
  const nodeList = Array.isArray(workflow.states)
    ? workflow.states
    : Array.isArray(workflow.phases)
      ? workflow.phases
      : [];
  const map = new Map<string, WorkflowAgentTaskSummary>();

  const ensureAgent = (agent: string, role?: string | null) => {
    if (!map.has(agent)) {
      map.set(agent, {
        agent,
        role: role || null,
        stepCount: 0,
        taskCount: 0,
        items: [],
      });
    }
    const existing = map.get(agent)!;
    if (!existing.role && role) existing.role = role;
    return existing;
  };

  for (const node of nodeList) {
    const nodeName = node?.name || '未命名节点';
    const steps = Array.isArray(node?.steps) ? node.steps : [];
    for (const step of steps) {
      const agent = typeof step?.agent === 'string' && step.agent.trim() ? step.agent.trim() : '未分配 Agent';
      const summary = ensureAgent(agent, typeof step?.role === 'string' ? step.role : null);
      summary.stepCount += 1;
      if (typeof step?.task === 'string' && step.task.trim()) summary.taskCount += 1;
      summary.items.push({
        nodeName,
        stepName: step?.name || '未命名步骤',
        task: typeof step?.task === 'string' ? step.task : '',
        role: typeof step?.role === 'string' ? step.role : null,
      });
    }
  }

  const supervisorAgent = typeof workflow?.supervisor?.agent === 'string' ? workflow.supervisor.agent.trim() : '';
  if (supervisorAgent) {
    const summary = ensureAgent(supervisorAgent, 'supervisor');
    if (!summary.items.some((item) => item.stepName === '全局审阅与检查点')) {
      summary.items.unshift({
        nodeName: '全局治理',
        stepName: '全局审阅与检查点',
        task: '负责阶段审阅、检查点建议与最终把关。',
        role: 'supervisor',
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.agent.localeCompare(b.agent));
}

function buildWorkflowStepBindingItems(config: any): WorkflowStepBindingItem[] {
  const workflow = config?.workflow || {};
  const isStateMachine = Array.isArray(workflow.states);
  const nodes = isStateMachine ? workflow.states : Array.isArray(workflow.phases) ? workflow.phases : [];
  const nodeType: 'phase' | 'state' = isStateMachine ? 'state' : 'phase';
  const items: WorkflowStepBindingItem[] = [];

  nodes.forEach((node: any, nodeIndex: number) => {
    const nodeName = node?.name || `${nodeType === 'state' ? '状态' : '阶段'} ${nodeIndex + 1}`;
    const steps = Array.isArray(node?.steps) ? node.steps : [];
    steps.forEach((step: any, stepIndex: number) => {
      items.push({
        id: `${nodeType}-${nodeIndex}-step-${stepIndex}`,
        nodeName,
        nodeType,
        nodeIndex,
        stepIndex,
        stepName: step?.name || `步骤 ${stepIndex + 1}`,
        task: typeof step?.task === 'string' ? step.task : '',
        role: typeof step?.role === 'string' ? step.role : null,
        agent: typeof step?.agent === 'string' && step.agent.trim() ? step.agent.trim() : '未分配 Agent',
      });
    });
  });

  return items;
}

function deriveWorkflowStructure(config: any) {
  const workflow = config?.workflow || {};
  const phases = Array.isArray(workflow.phases)
    ? workflow.phases.map((phase: any, index: number) => ({
      id: `phase-${index + 1}`,
      title: phase.name || `阶段 ${index + 1}`,
      objective: phase.steps?.map((step: any) => step.task).filter(Boolean).join('；') || '',
      ownerAgents: [...new Set((phase.steps || []).map((step: any) => step.agent).filter(Boolean))],
      status: 'pending' as const,
    }))
    : Array.isArray(workflow.states)
      ? workflow.states.map((state: any, index: number) => ({
        id: `state-${index + 1}`,
        title: state.name || `状态 ${index + 1}`,
        objective: state.description || state.steps?.map((step: any) => step.task).filter(Boolean).join('；') || '',
        ownerAgents: [...new Set((state.steps || []).map((step: any) => step.agent).filter(Boolean))],
        status: 'pending' as const,
      }))
      : [];

  const agentNames = [...new Set(phases.flatMap((phase: { ownerAgents: string[] }) => phase.ownerAgents))] as string[];
  const assignments = agentNames.map((agent: string) => ({
    agent,
    responsibility: `负责 ${phases.filter((phase: { ownerAgents: string[] }) => phase.ownerAgents.includes(agent)).map((phase: { title: string }) => phase.title).join('、') || '相关设计与执行'}`,
    phaseIds: phases
      .filter((phase: { ownerAgents: string[] }) => phase.ownerAgents.includes(agent))
      .map((phase: { id: string }) => phase.id),
  }));

  const checkpoints = Array.isArray(workflow.phases)
    ? workflow.phases
      .map((phase: any, index: number) => phase?.checkpoint ? {
        id: `checkpoint-${index + 1}`,
        title: phase.checkpoint.name || `检查点 ${index + 1}`,
        phaseId: phases[index]?.id,
        status: 'pending' as const,
      } : null)
      .filter(Boolean)
    : [];

  return { phases, assignments, checkpoints, agentNames };
}

function buildWorkflowDraftSummaryFromConfig(config: any) {
  const workflow = config?.workflow || {};
  const { phases, assignments, checkpoints, agentNames } = deriveWorkflowStructure(config);
  return {
    mode: workflow.mode === 'state-machine' ? 'state-machine' as const : 'phase-based' as const,
    nodes: phases.map((phase: { title: string; objective?: string; ownerAgents?: string[] }) => ({
      name: phase.title,
      detail: phase.objective || '来自当前计划确认的阶段目标',
      ownerAgents: phase.ownerAgents || [],
    })),
    assignments: assignments.map((assignment: { agent: string; responsibility: string }) => ({
      agent: assignment.agent,
      responsibility: assignment.responsibility,
    })),
    generatedConfigSummary: {
      mode: workflow.mode === 'state-machine' ? 'state-machine' as const : 'phase-based' as const,
      phaseCount: Array.isArray(workflow.phases) ? workflow.phases.length : 0,
      stateCount: Array.isArray(workflow.states) ? workflow.states.length : 0,
      agentNames,
    },
    structure: { phases, assignments, checkpoints, agentNames },
  };
}

function applyStepAgentReplacement(config: any, stepId: string, nextAgent: string) {
  const cloned = JSON.parse(JSON.stringify(config || {}));
  const items = buildWorkflowStepBindingItems(cloned);
  const target = items.find((item) => item.id === stepId);
  if (!target) return cloned;
  const nodeCollection = target.nodeType === 'state'
    ? cloned.workflow?.states
    : cloned.workflow?.phases;
  if (!Array.isArray(nodeCollection)) return cloned;
  const targetNode = nodeCollection[target.nodeIndex];
  const targetStep = Array.isArray(targetNode?.steps) ? targetNode.steps[target.stepIndex] : null;
  if (targetStep) {
    targetStep.agent = nextAgent;
  }
  return cloned;
}

function computeWorkflowBindingChanges(baseConfig: any, currentConfig: any): WorkflowBindingChange[] {
  const baseItems = buildWorkflowStepBindingItems(baseConfig);
  const currentItems = buildWorkflowStepBindingItems(currentConfig);
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  return baseItems.flatMap((item) => {
    const current = currentById.get(item.id);
    if (!current || current.agent === item.agent) return [];
    return [{
      stepId: item.id,
      nodeName: item.nodeName,
      stepName: item.stepName,
      fromAgent: item.agent,
      toAgent: current.agent,
    }];
  });
}

function getClarificationQuestionOptions(item: ClarificationQuestionItem): Array<{
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}> {
  if (Array.isArray(item.options) && item.options.length > 0) {
    return item.options;
  }
  return [
    {
      id: 'custom',
      label: '自定义填写',
      description: '当前题目未返回结构化选项，请直接在下方补充说明中填写。',
      recommended: true,
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
  answers: Record<string, ClarificationAnswerValue>
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

function clipContextText(input: string | undefined, limit = 220): string {
  const text = (input || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function PlanningContextSnapshot({
  workflowName,
  filename,
  workingDirectory,
  workspaceMode,
  referenceWorkflow,
  description,
  requirements,
  clarificationForm,
  clarificationAnswers,
  showClarification,
}: {
  workflowName?: string;
  filename?: string;
  workingDirectory?: string;
  workspaceMode?: string;
  referenceWorkflow?: string;
  description?: string;
  requirements?: string;
  clarificationForm?: ClarificationFormResult | null;
  clarificationAnswers?: Record<string, ClarificationAnswerValue>;
  showClarification?: boolean;
}) {
  const answerContext = showClarification && clarificationForm
    ? buildClarificationAnswerContext(clarificationForm.questions || [], clarificationAnswers || {})
    : '';
  const baseRows = [
    { label: '工作流', value: workflowName || '未命名' },
    { label: '文件名', value: filename || '自动生成' },
    { label: '工作目录', value: workingDirectory || '未选择' },
    { label: '运行方式', value: workspaceMode === 'isolated-copy' ? '隔离副本' : '原地执行' },
    { label: '工作流模板', value: referenceWorkflow || '无' },
  ];
  const requirementText = clipContextText(requirements || description, 260);
  const clarificationSummary = [
    clarificationForm?.summary ? `结论：${clarificationForm.summary}` : '',
    answerContext,
    clarificationForm?.missingFields?.length
      ? `仍缺信息：${clarificationForm.missingFields.slice(0, 4).join('、')}`
      : '',
  ].filter(Boolean).join('\n');

  return (
    <div className="space-y-5 text-xs">
      <section className="space-y-3">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <span className="material-symbols-outlined text-sm text-amber-500">looks_one</span>
          基础输入
        </div>
        <div className="divide-y rounded-lg border bg-background">
          {baseRows.map((row) => (
            <div key={row.label} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 px-3 py-2.5">
              <div className="text-muted-foreground">{row.label}</div>
              <div className="min-w-0 truncate text-foreground" title={row.value}>{row.value}</div>
            </div>
          ))}
        </div>
        {requirementText ? (
          <div className="border-l-2 border-amber-500/50 bg-amber-500/5 px-3 py-2.5 leading-6 text-muted-foreground whitespace-pre-wrap break-words">
            {requirementText}
          </div>
        ) : null}
      </section>

      {showClarification ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span className="material-symbols-outlined text-sm text-amber-500">looks_two</span>
            补充问答
          </div>
          {clarificationSummary ? (
            <div className="border-l-2 border-primary/40 bg-primary/5 px-3 py-2.5 leading-6 text-muted-foreground whitespace-pre-wrap break-words">
              {clarificationSummary}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-3 py-3 leading-5 text-muted-foreground">
              暂无补充问答内容。
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function PlanningScrollToBottomButton({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="sticky bottom-3 z-10 ml-auto inline-flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
    >
      <span className="material-symbols-outlined text-sm">south</span>
      回到底部
    </button>
  );
}

function CollapsePanelButton({
  collapsed,
  onClick,
  label,
}: {
  collapsed: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      onClick={onClick}
      title={collapsed ? `展开${label}` : `收起${label}`}
    >
      <span className="material-symbols-outlined text-base">
        {collapsed ? 'unfold_more' : 'unfold_less'}
      </span>
    </Button>
  );
}

function buildPlanTaskAgentMappings(specCoding: any, config: any): PlanTaskAgentMapping[] {
  const phaseById = new Map<string, any>(
    Array.isArray(specCoding?.phases)
      ? specCoding.phases.map((phase: any) => [phase.id, phase])
      : []
  );
  const taskRows: PlanTaskAgentMapping[] = Array.isArray(specCoding?.tasks)
    ? specCoding.tasks.map((task: any, index: number) => {
      const phase = task?.phaseId ? phaseById.get(task.phaseId) : null;
      const owners = Array.isArray(task?.ownerAgents) && task.ownerAgents.length
        ? task.ownerAgents
        : Array.isArray(phase?.ownerAgents)
          ? phase.ownerAgents
          : [];
      return {
        id: `task-${task?.id || index}`,
        source: 'task' as const,
        phaseName: phase?.title || '未归属阶段',
        stepName: task?.id || `Task ${index + 1}`,
        taskTitle: typeof task?.title === 'string' && task.title.trim() ? task.title.trim() : `任务 ${index + 1}`,
        detail: typeof task?.detail === 'string' && task.detail.trim() ? task.detail.trim() : '',
        agentNames: owners,
      };
    })
    : [];

  const workflowRows = buildWorkflowStepBindingItems(config).map((item) => ({
    id: `workflow-${item.id}`,
    source: 'workflow' as const,
    phaseName: item.nodeName,
    stepName: item.stepName,
    taskTitle: item.task || item.stepName,
    detail: item.task || '',
    agentNames: item.agent ? [item.agent] : [],
  }));

  const merged = [...taskRows, ...workflowRows];
  const dedup = new Map<string, PlanTaskAgentMapping>();
  for (const row of merged) {
    const key = `${row.phaseName}::${row.stepName}::${row.taskTitle}::${row.agentNames.join(',')}`;
    if (!dedup.has(key)) dedup.set(key, row);
  }
  return [...dedup.values()];
}

function parseRevisionSummaryMeta(summary: string): {
  artifact?: string;
  impactArea?: string;
} {
  const artifact = summary.match(/针对\s+(requirements\.md|design\.md|tasks\.md)/)?.[1];
  const impactArea = summary.match(/主要影响\s+([^：:]+)[：:]/)?.[1]?.trim();
  return { artifact, impactArea };
}

function buildCreationRecommendationsPrompt(recommendations: WorkflowCreationRecommendations | null): string {
  if (!recommendations) return '';

  const sections: string[] = [];

  if (recommendations.referenceWorkflow) {
    sections.push([
      '**编排参考骨架**',
      `- 工作流模板: ${recommendations.referenceWorkflow.name || recommendations.referenceWorkflow.filename}`,
      `- 模式: ${recommendations.referenceWorkflow.mode === 'state-machine' ? '状态机' : '阶段式'}`,
      recommendations.referenceWorkflow.agents.length
        ? `- 可优先复用的角色: ${recommendations.referenceWorkflow.agents.join('、')}`
        : '',
      recommendations.referenceWorkflow.supervisorAgent
        ? `- 可复用指挥官: ${recommendations.referenceWorkflow.supervisorAgent}`
        : '',
      recommendations.referenceWorkflow.autoApply
        ? '- 当前若未手动指定工作流模板，系统会自动采用这份骨架参与生成'
        : '',
    ].filter(Boolean).join('\n'));
  }

  if (recommendations.recommendedAgents.length || recommendations.recommendedSupervisorAgent) {
    sections.push([
      '**自动编排决策**',
      recommendations.recommendedSupervisorAgent ? `- 指挥官: ${recommendations.recommendedSupervisorAgent}` : '',
      recommendations.recommendedAgents.length ? `- 推荐角色编队: ${recommendations.recommendedAgents.join('、')}` : '',
      recommendations.availableStepAgents?.length ? `- 可用普通执行 Agent: ${recommendations.availableStepAgents.join('、')}` : '',
      '- 若未手动覆盖，生成 workflow 草案时应优先采用该编队，而不是回退到固定占位角色',
    ].filter(Boolean).join('\n'));
  }

  if (recommendations.relationshipHints.length) {
    sections.push([
      '**高协同编队建议**',
      ...recommendations.relationshipHints.slice(0, 4).map((item) => (
        `- ${item.agent} × ${item.counterpart}：协作倾向 ${item.synergyScore >= 0 ? '+' : ''}${item.synergyScore}${item.strengths.length ? `，强项 ${item.strengths.join('、')}` : ''}`
      )),
    ].join('\n'));
  }

  if (recommendations.experiences.length) {
    sections.push([
      '**相关历史经验**',
      ...recommendations.experiences.slice(0, 3).map((item) => (
        `- ${item.workflowName || item.configFile}：${item.summary}${item.experience[0] ? `；经验 ${item.experience[0]}` : ''}${item.nextFocus[0] ? `；后续重点 ${item.nextFocus[0]}` : ''}`
      )),
    ].join('\n'));
  }

  return sections.join('\n\n');
}

function buildWorkflowCreationValidationContext(
  step: WorkflowCreationItemStep,
  recommendations: WorkflowCreationRecommendations | null,
  fallbackSupervisorAgent?: string,
): WorkflowCreationItemValidationContext | undefined {
  if (step.kind !== WORKFLOW_STATE_STEPS_KIND) return undefined;

  const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const unique = (values: unknown[]) => Array.from(new Set(values.map(clean).filter(Boolean)));
  const availableStepAgents = unique([
    ...(recommendations?.availableStepAgents || []),
    ...((recommendations?.availableStepAgents?.length ? [] : recommendations?.recommendedAgents || [])),
  ]);
  const supervisorAgents = unique([
    fallbackSupervisorAgent,
    recommendations?.recommendedSupervisorAgent,
    recommendations?.referenceWorkflow?.supervisorAgent,
    ...(recommendations?.availableSupervisorAgents || []),
    'default-supervisor',
    'supervisor',
  ]);

  return {
    expectedStateName: step.name,
    availableStepAgents,
    supervisorAgents,
  };
}

function cloneReferenceWorkflowConfig(referenceConfig: any, options: {
  workflowName: string;
  workingDirectory: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  description?: string;
  requirements?: string;
}) {
  const cloned = JSON.parse(JSON.stringify(referenceConfig || {}));
  cloned.workflow = cloned.workflow || {};
  cloned.context = cloned.context || {};
  cloned.workflow.name = options.workflowName;
  cloned.workflow.description = options.description || options.requirements || cloned.workflow.description || '';
  cloned.context.projectRoot = options.workingDirectory;
  cloned.context.workspaceMode = options.workspaceMode;
  cloned.context.requirements = options.requirements || cloned.context.requirements || '';

  if (Array.isArray(cloned.workflow.phases)) {
    cloned.workflow.phases = cloned.workflow.phases.map((phase: any, phaseIndex: number) => ({
      ...phase,
      steps: (phase.steps || []).map((step: any, stepIndex: number) => ({
        ...step,
        task: options.requirements?.trim()
          ? `基于当前需求「${options.requirements.trim()}」，在阶段「${phase.name || `阶段 ${phaseIndex + 1}`}」中完成步骤「${step.name || `步骤 ${stepIndex + 1}`}」的任务。`
          : step.task,
      })),
    }));
  }

  if (Array.isArray(cloned.workflow.states)) {
    cloned.workflow.states = cloned.workflow.states.map((state: any, stateIndex: number) => ({
      ...state,
      steps: (state.steps || []).map((step: any, stepIndex: number) => ({
        ...step,
        task: options.requirements?.trim()
          ? `基于当前需求「${options.requirements.trim()}」，在状态「${state.name || `状态 ${stateIndex + 1}`}」中完成步骤「${step.name || `步骤 ${stepIndex + 1}`}」的任务。`
          : step.task,
      })),
    }));
  }

  return cloned;
}

function createDefaultWorkflowGovernance() {
  return {
    supervisor: {
      enabled: true,
      agent: 'default-supervisor',
      stageReviewEnabled: true,
      checkpointAdviceEnabled: true,
      scoringEnabled: true,
      experienceEnabled: true,
    },
  };
}

function pickRecommendedAgent(
  recommendedAgents: string[] | undefined,
  fallback: string,
  usedAgents: Set<string>,
  excludedAgents: Set<string> = new Set()
) {
  const candidate = (recommendedAgents || []).find((agent) => agent && !usedAgents.has(agent) && !excludedAgents.has(agent));
  if (candidate) {
    usedAgents.add(candidate);
    return candidate;
  }
  const safeFallback = excludedAgents.has(fallback) ? 'developer' : fallback;
  usedAgents.add(safeFallback);
  return safeFallback;
}

function createPhaseBasedPreviewConfig(
  workflowName: string,
  workingDirectory: string,
  workspaceMode: 'isolated-copy' | 'in-place',
  description?: string,
  recommendedAgents?: string[],
  recommendedSupervisorAgent?: string
) {
  const usedAgents = new Set<string>();
  const excludedAgents = new Set([recommendedSupervisorAgent || 'default-supervisor', 'default-supervisor']);
  const primaryAgent = pickRecommendedAgent(recommendedAgents, 'developer', usedAgents, excludedAgents);
  return {
    workflow: {
      name: workflowName,
      description: description || '',
      ...{
        supervisor: {
          ...createDefaultWorkflowGovernance().supervisor,
          agent: recommendedSupervisorAgent || 'default-supervisor',
        },
      },
      phases: [
        {
          name: '阶段 1',
          steps: [
            {
              name: '步骤 1',
              agent: primaryAgent,
              task: '请根据已确认需求补充任务内容',
            },
          ],
        },
      ],
    },
    context: {
      projectRoot: workingDirectory,
      workspaceMode,
      requirements: '',
    },
  };
}

function createStateMachinePreviewConfig(
  workflowName: string,
  workingDirectory: string,
  workspaceMode: 'isolated-copy' | 'in-place',
  description?: string,
  recommendedAgents?: string[],
  recommendedSupervisorAgent?: string
) {
  const usedAgents = new Set<string>();
  const excludedAgents = new Set([recommendedSupervisorAgent || 'default-supervisor', 'default-supervisor']);
  const analysisAgent = pickRecommendedAgent(recommendedAgents, 'architect', usedAgents, excludedAgents);
  const designAgent = pickRecommendedAgent(recommendedAgents, analysisAgent || 'architect', usedAgents, excludedAgents);
  const finalAgent = pickRecommendedAgent(recommendedAgents, 'developer', usedAgents, excludedAgents);
  return {
    workflow: {
      name: workflowName,
      description: description || '',
      mode: 'state-machine',
      maxTransitions: 30,
      ...{
        supervisor: {
          ...createDefaultWorkflowGovernance().supervisor,
          agent: recommendedSupervisorAgent || 'default-supervisor',
        },
      },
      states: [
        {
          name: '需求分析',
          description: '围绕用户目标、约束和验收标准进行分析。',
          isInitial: true,
          isFinal: false,
          maxSelfTransitions: 3,
          position: { x: 80, y: 160 },
          steps: [
            { name: '分析需求', agent: analysisAgent, role: 'defender', task: '澄清需求并整理约束与目标。' },
          ],
          transitions: createVerdictTransitions({
            passTo: '方案设计',
            conditionalPassTo: '需求分析',
            failTo: '需求分析',
            passLabel: '分析完成',
            conditionalPassLabel: '继续澄清',
            failLabel: '分析失败，重新梳理',
          }),
        },
        {
          name: '方案设计',
          description: '根据需求设计执行流程和 Agent 分工。',
          isInitial: false,
          isFinal: false,
          maxSelfTransitions: 3,
          position: { x: 360, y: 160 },
          steps: [
            { name: '设计方案', agent: designAgent, role: 'defender', task: '生成 workflow 阶段、步骤和分工草案。' },
          ],
          transitions: createVerdictTransitions({
            passTo: '完成',
            conditionalPassTo: '方案设计',
            failTo: '需求分析',
            passLabel: '设计完成',
            conditionalPassLabel: '继续调整',
            failLabel: '返回需求分析',
          }),
        },
        {
          name: '完成',
          description: '输出 workflow 配置草案并等待确认。',
          isInitial: false,
          isFinal: true,
          position: { x: 640, y: 160 },
          steps: [
            { name: '输出草案', agent: finalAgent, role: 'judge', task: '整理 workflow 草案，等待用户确认。' },
          ],
          transitions: [],
        },
      ],
    },
    context: {
      projectRoot: workingDirectory,
      workspaceMode,
      requirements: '',
    },
  };
}

function CreationStageStepper({ currentStep }: { currentStep: 1 | 2 | 3 | 4 }) {
  const items = [
    {
      step: 1 as const,
      title: '需求澄清',
      description: '确认目标、约束、工作目录与工作流模板',
    },
    {
      step: 2 as const,
      title: '补充问答',
      description: 'AI 先提出关键问题，用户用表单补全信息',
    },
    {
      step: 3 as const,
      title: '计划生成',
      description: '基于澄清结果流式生成正式计划制品',
    },
    {
      step: 4 as const,
      title: '草案确认',
      description: '确认计划内容并进入 workflow 草案创建',
    },
  ];

  return (
    <div className="grid grid-cols-4 overflow-hidden rounded-lg border bg-background">
      {items.map((item, index) => {
        const state = item.step < currentStep ? 'done' : item.step === currentStep ? 'current' : 'pending';
        return (
          <div
            key={item.step}
            className={cn(
              'min-w-0 px-3 py-2.5 transition-colors',
              index > 0 && 'border-l',
              state === 'current' && 'bg-primary/5',
              state === 'done' && 'bg-emerald-500/5',
            )}
          >
            <div className="flex items-center gap-2 whitespace-nowrap">
              <div
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  state === 'current' && 'bg-primary text-primary-foreground',
                  state === 'done' && 'bg-emerald-600 text-white',
                  state === 'pending' && 'bg-muted text-muted-foreground',
                )}
              >
                {state === 'done' ? '✓' : item.step}
              </div>
              <div className="truncate text-sm font-medium">{item.title}</div>
            </div>
            <div className="mt-1 hidden truncate whitespace-nowrap text-[11px] text-muted-foreground xl:block">{item.description}</div>
          </div>
        );
      })}
    </div>
  );
}

function WorkflowDraftPreviewCard({ preview }: { preview: WorkflowDraftPreviewState | null }) {
  if (!preview) return null;
  const validation = preview.validation;
  const issues = Array.isArray(validation?.issues) ? validation.issues : [];
  const valid = Boolean(validation?.ok);
  const hasParseError = Boolean(preview.parseError && !preview.config);
  const yaml = preview.yaml || (preview.config ? stringifyYaml(preview.config) : '');
  const summary = preview.config ? buildWorkflowDraftSummaryFromConfig(preview.config) : null;
  const visual = preview.config ? buildWorkflowDraftVisualModel(preview.config) : null;
  const agents = summary?.generatedConfigSummary?.agentNames || [];
  const nodes = summary?.nodes || [];

  return (
    <div className={`rounded-xl border p-4 text-sm ${
      hasParseError
        ? 'border-amber-500/40 bg-amber-500/5'
        : valid
          ? 'border-emerald-500/40 bg-emerald-500/5'
          : validation
            ? 'border-red-500/40 bg-red-500/5'
            : 'border-border bg-muted/30'
    }`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <span className="material-symbols-outlined text-base">account_tree</span>
          Workflow 草案预览
          {preview.filename ? <span className="text-xs text-muted-foreground">configs/{preview.filename}</span> : null}
        </div>
        <Badge variant={valid ? 'default' : 'outline'}>
          {hasParseError ? '解析失败' : valid ? 'valid' : validation ? 'invalid' : '待校验'}
        </Badge>
      </div>

      {preview.summary ? (
        <div className="mt-2 text-xs text-muted-foreground">{preview.summary}</div>
      ) : null}

      {preview.parseError ? (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {preview.parseError}
        </div>
      ) : null}

      {summary ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border bg-background/80 p-3">
            <div className="text-xs text-muted-foreground">模式</div>
            <div className="mt-1 font-medium">{summary.mode === 'state-machine' ? '状态机' : '阶段式'}</div>
          </div>
          <div className="rounded-lg border bg-background/80 p-3">
            <div className="text-xs text-muted-foreground">节点</div>
            <div className="mt-1 font-medium">{nodes.length}</div>
          </div>
          <div className="rounded-lg border bg-background/80 p-3">
            <div className="text-xs text-muted-foreground">Agent</div>
            <div className="mt-1 truncate font-medium">{agents.length ? agents.join('、') : '未识别'}</div>
          </div>
        </div>
      ) : null}

      {visual && visual.nodes.length > 0 ? (
        <div className="mt-4 rounded-xl border bg-background/80 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="material-symbols-outlined text-base">schema</span>
              结构视图
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">Supervisor: {visual.supervisorAgent}</Badge>
              <Badge variant="outline">{visual.mode === 'state-machine' ? '状态流转' : '阶段顺序'}</Badge>
            </div>
          </div>

          <div className="space-y-3">
            {visual.nodes.map((node, index) => (
              <div key={node.id} className="relative rounded-xl border bg-muted/20 p-3">
                {index < visual.nodes.length - 1 ? (
                  <div className="absolute left-6 top-full h-3 w-px bg-border" />
                ) : null}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {index + 1}
                      </span>
                      <span className="font-medium">{node.name}</span>
                      {node.isInitial ? <Badge variant="outline">初始</Badge> : null}
                      {node.isFinal ? <Badge variant="outline">终止</Badge> : null}
                      {node.checkpoint ? <Badge variant="outline">检查点</Badge> : null}
                    </div>
                    {node.description ? (
                      <div className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {node.description}
                      </div>
                    ) : null}
                  </div>
                  {node.agents.length > 0 ? (
                    <div className="flex max-w-full flex-wrap gap-1">
                      {node.agents.map((agent) => (
                        <Badge key={agent} variant={agent === visual.supervisorAgent ? 'default' : 'secondary'} className="max-w-[160px] truncate">
                          {agent}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>

                {node.steps.length > 0 ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {node.steps.map((step, stepIndex) => (
                      <div key={`${node.id}-step-${stepIndex}`} className="rounded-lg border bg-background px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-xs font-medium">{step.name}</div>
                          <Badge variant="outline" className="max-w-[130px] truncate">{step.agent}</Badge>
                        </div>
                        {step.task ? (
                          <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{step.task}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {node.transitions.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {node.transitions.map((transition, transitionIndex) => (
                      <div key={`${node.id}-transition-${transitionIndex}`} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
                        <span>{transition.label}</span>
                        {transition.condition ? <span className="text-muted-foreground/70">({transition.condition})</span> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div className="mt-3 space-y-1 text-xs">
          {issues.map((issue: any, index: number) => (
            <div key={`${issue.path?.join('.') || 'root'}-${index}`} className="rounded-md border bg-background/80 px-3 py-2">
              <span className="font-medium">{issue.path?.join('.') || '(root)'}</span>
              <span className="text-muted-foreground">: {issue.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      {yaml ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground">查看 YAML</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{yaml}</pre>
        </details>
      ) : null}
    </div>
  );
}

export function resolveValidatedWorkflowDraftConfig({
  workflowDraftConfig,
  workflowDraftValidation,
  workflowDraftPreview,
}: {
  workflowDraftConfig: any | null;
  workflowDraftValidation: any | null;
  workflowDraftPreview: WorkflowDraftPreviewState | null;
}) {
  if (workflowDraftValidation?.ok && workflowDraftConfig) return workflowDraftConfig;
  if (workflowDraftPreview?.validation?.ok && workflowDraftPreview.config) return workflowDraftPreview.config;
  return null;
}

function WorkflowCreationProgressPanel({
  state,
  stage,
  activeStep,
  retryNotice,
  retryEvents = [],
}: {
  state: WorkflowCreationState;
  stage: CreationStageKey | null;
  activeStep?: WorkflowCreationActiveStep | null;
  retryNotice?: WorkflowCreationRetryNotice | null;
  retryEvents?: WorkflowCreationRetryEvent[];
}) {
  const hasClarification = Boolean(
    state.clarification.summary
    || state.clarification.knownFacts.length
    || state.clarification.missingFields.length
    || state.clarification.questions.length
  );
  const hasSpec = Boolean(
    state.spec.summary
    || state.spec.requirements.length
    || state.spec.design.overview
    || state.spec.design.decisions.length
    || state.spec.tasks.length
  );
  const workflowStepStateNames = Object.keys(state.workflow.stateSteps);
  const hasWorkflow = Boolean(state.workflow.outline.length || workflowStepStateNames.length);
  const hasProgressSignal = Boolean(activeStep || retryNotice || retryEvents.length);
  if (!hasClarification && !hasSpec && !hasWorkflow && !hasProgressSignal) return null;

  const title = stage === 'workflowDraft'
    ? '已确认 Workflow 结构'
    : stage === 'specPlanning'
      ? '已确认 Spec 结构'
      : '已确认补充问题';

  return (
    <div className="rounded-xl border bg-muted/20 p-3 text-sm" data-testid="workflow-creation-progress">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <span className="material-symbols-outlined text-base text-emerald-600">fact_check</span>
          {title}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {activeStep ? <Badge variant="outline">正在处理：{activeStep.title}</Badge> : null}
          {state.clarification.questions.length ? <Badge variant="secondary">{state.clarification.questions.length} 个问题</Badge> : null}
          {state.spec.requirements.length ? <Badge variant="secondary">{state.spec.requirements.length} 条需求</Badge> : null}
          {state.spec.tasks.length ? <Badge variant="secondary">{state.spec.tasks.length} 个任务</Badge> : null}
          {state.workflow.outline.length ? <Badge variant="secondary">{state.workflow.outline.length} 个状态</Badge> : null}
        </div>
      </div>

      {retryNotice ? (
        <div className="mb-3">
          <WorkflowCreationRetryCallout notice={retryNotice} events={retryEvents} />
        </div>
      ) : null}

      {!hasClarification && !hasSpec && !hasWorkflow && activeStep ? (
        <div className="rounded-lg border bg-background/75 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="font-medium">{activeStep.title}</span>
            <Badge variant="outline">{activeStep.kind}</Badge>
          </div>
          <div className="mt-2 text-xs leading-5 text-muted-foreground">
            正在等待 AI 输出当前小点的结构化结果；解析通过后会立即填充到这里。
          </div>
        </div>
      ) : null}

      {hasClarification && stage === 'clarification' ? (
        <div className="space-y-3">
          {state.clarification.summary ? (
            <div className="rounded-lg border bg-background/75 p-3 text-xs leading-5 text-muted-foreground">{state.clarification.summary}</div>
          ) : null}
          {(state.clarification.knownFacts.length || state.clarification.missingFields.length) ? (
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-lg border bg-background/75 p-3">
                <div className="text-xs font-medium">已确认信息</div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {state.clarification.knownFacts.length ? state.clarification.knownFacts.slice(0, 5).map((item) => (
                    <div key={item}>- {item}</div>
                  )) : <div>等待确认事实</div>}
                </div>
              </div>
              <div className="rounded-lg border bg-background/75 p-3">
                <div className="text-xs font-medium">待补信息</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {state.clarification.missingFields.length ? state.clarification.missingFields.slice(0, 6).map((item) => (
                    <Badge key={item} variant="outline">{item}</Badge>
                  )) : <span className="text-xs text-muted-foreground">等待识别缺口</span>}
                </div>
              </div>
            </div>
          ) : null}
          {state.clarification.questions.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {state.clarification.questions.map((question, index) => (
                <div key={question.id} className="rounded-lg border bg-background/75 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <span>{index + 1}. {question.label}</span>
                    {question.required !== false ? <Badge variant="outline">必答</Badge> : <Badge variant="secondary">可选</Badge>}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{question.question}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {question.options.slice(0, 4).map((option) => (
                      <span key={option.id} className="rounded-full border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
                        {option.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {hasSpec && stage === 'specPlanning' ? (
        <div className="grid gap-3 xl:grid-cols-3">
          <div className="rounded-lg border bg-background/75 p-3">
            <div className="text-xs font-medium">Requirements</div>
            <div className="mt-2 space-y-2">
              {state.spec.requirements.length ? state.spec.requirements.map((item) => (
                <div key={item.id} className="text-xs leading-5">
                  <span className="font-medium">{item.id}</span>
                  <span className="text-muted-foreground"> · {item.title}</span>
                </div>
              )) : <div className="text-xs text-muted-foreground">等待生成需求小点</div>}
            </div>
          </div>
          <div className="rounded-lg border bg-background/75 p-3">
            <div className="text-xs font-medium">Design</div>
            <div className="mt-2 text-xs leading-5 text-muted-foreground">
              {state.spec.design.overview || state.spec.summary || '等待生成设计概览'}
            </div>
            {state.spec.design.decisions.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {state.spec.design.decisions.map((item) => (
                  <Badge key={item.id} variant="outline">{item.id}</Badge>
                ))}
              </div>
            ) : null}
          </div>
          <div className="rounded-lg border bg-background/75 p-3">
            <div className="text-xs font-medium">Tasks</div>
            <div className="mt-2 space-y-2">
              {state.spec.tasks.length ? state.spec.tasks.map((item) => (
                <div key={item.id} className="text-xs leading-5">
                  <span className="font-medium">{item.id}</span>
                  <span className="text-muted-foreground"> · {item.title}</span>
                </div>
              )) : <div className="text-xs text-muted-foreground">等待生成任务小点</div>}
            </div>
          </div>
        </div>
      ) : null}

      {hasWorkflow && stage === 'workflowDraft' ? (
        <div className="space-y-2">
          {state.workflow.outline.map((outlineState, index) => {
            const steps = state.workflow.stateSteps[outlineState.name] || [];
            return (
              <div key={outlineState.name} className="rounded-lg border bg-background/75 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{index + 1}</span>
                  <span className="text-xs font-medium">{outlineState.name}</span>
                  {outlineState.isInitial ? <Badge variant="outline">初始</Badge> : null}
                  {outlineState.isFinal ? <Badge variant="outline">终止</Badge> : null}
                  <Badge variant={steps.length ? 'secondary' : 'outline'}>{steps.length ? `${steps.length} 步` : '待生成步骤'}</Badge>
                </div>
                {outlineState.description ? (
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{outlineState.description}</div>
                ) : null}
                {steps.length ? (
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {steps.map((step: any, stepIndex: number) => (
                      <div key={`${outlineState.name}-${stepIndex}`} className="rounded-md border bg-muted/20 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-medium">{step?.name || `步骤 ${stepIndex + 1}`}</span>
                          <span className="truncate text-muted-foreground">{step?.agent || '待分配'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type CreationWorkspaceStatusTone = 'amber' | 'blue' | 'emerald' | 'green' | 'muted';

function CreationWorkspaceStatus({
  label,
  tone = 'muted',
  spinning = false,
}: {
  label?: string;
  tone?: CreationWorkspaceStatusTone;
  spinning?: boolean;
}) {
  if (!label) return null;
  const toneClassName: Record<CreationWorkspaceStatusTone, string> = {
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    green: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
    muted: 'border-border bg-muted/50 text-muted-foreground',
  };

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-normal', toneClassName[tone])}>
      {spinning ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {label}
    </span>
  );
}

function CreationWorkspaceShell({
  currentStep,
  title,
  subtitle,
  icon,
  iconClassName,
  statusLabel,
  statusTone = 'muted',
  statusSpinning = false,
  engineControls,
  onBack,
  backTitle = '返回上一步',
  fullscreen,
  onToggleFullscreen,
  onClose,
  context,
  contextCollapsed,
  onToggleContext,
  activity,
  activityCollapsed,
  onToggleActivity,
  activityScrollRef,
  resultTitle,
  resultDescription,
  resultMeta,
  children,
  footerLeft,
  footerStatus,
  footerRight,
}: {
  currentStep: 2 | 3 | 4;
  title: string;
  subtitle?: string;
  icon: string;
  iconClassName?: string;
  statusLabel?: string;
  statusTone?: CreationWorkspaceStatusTone;
  statusSpinning?: boolean;
  engineControls?: ReactNode;
  onBack?: () => void;
  backTitle?: string;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  context: ReactNode;
  contextCollapsed: boolean;
  onToggleContext: () => void;
  activity: ReactNode;
  activityCollapsed: boolean;
  onToggleActivity: () => void;
  activityScrollRef?: Ref<HTMLDivElement>;
  resultTitle: string;
  resultDescription?: string;
  resultMeta?: ReactNode;
  children: ReactNode;
  footerLeft?: ReactNode;
  footerStatus?: ReactNode;
  footerRight?: ReactNode;
}) {
  const centerDefaultSize = contextCollapsed && activityCollapsed
    ? '100%'
    : contextCollapsed && !activityCollapsed
      ? '76%'
      : !contextCollapsed && activityCollapsed
        ? '78%'
        : '54%';
  const canUseResizablePanels = typeof window !== 'undefined' && typeof window.ResizeObserver === 'function';

  const contextRail = (
    <aside className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="material-symbols-outlined text-base text-amber-500">subject</span>
          <span className="truncate">输入上下文</span>
        </div>
        <CollapsePanelButton collapsed={false} onClick={onToggleContext} label="输入上下文" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {context}
      </div>
    </aside>
  );

  const resultPanel = (
    <main className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-[3rem] shrink-0 items-start justify-between gap-3 border-b px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-primary">dashboard_customize</span>
            <div className="truncate text-sm font-medium">{resultTitle}</div>
          </div>
          {resultDescription ? (
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{resultDescription}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {resultMeta}
          {contextCollapsed ? (
            <Button type="button" variant="outline" size="sm" onClick={onToggleContext} className="h-8 gap-1.5">
              <span className="material-symbols-outlined text-sm">left_panel_open</span>
              上下文
            </Button>
          ) : null}
          {activityCollapsed ? (
            <Button type="button" variant="outline" size="sm" onClick={onToggleActivity} className="h-8 gap-1.5">
              <span className="material-symbols-outlined text-sm">right_panel_open</span>
              过程
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {children}
      </div>
    </main>
  );

  const activityRail = (
    <aside className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="material-symbols-outlined text-base text-blue-500">auto_awesome</span>
          <span className="truncate">AI 过程</span>
        </div>
        <CollapsePanelButton collapsed={false} onClick={onToggleActivity} label="AI 过程" />
      </div>
      <div ref={activityScrollRef} className="min-h-0 flex-1 overflow-auto p-4">
        {activity}
      </div>
    </aside>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="border-b bg-background/95 px-5 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              {onBack ? (
                <Button type="button" variant="ghost" size="sm" onClick={onBack} title={backTitle} className="h-8 shrink-0 gap-1.5 px-2">
                  <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                  <span>上一步</span>
                </Button>
              ) : null}
              <span className={cn('material-symbols-outlined text-[20px]', iconClassName)}>{icon}</span>
              <DialogTitle className="truncate text-base">{title}</DialogTitle>
              <CreationWorkspaceStatus label={statusLabel} tone={statusTone} spinning={statusSpinning} />
            </div>
            {subtitle ? (
              <div className="mt-1 line-clamp-1 pl-10 text-xs leading-5 text-muted-foreground">{subtitle}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {engineControls}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onToggleFullscreen}
              title={fullscreen ? '退出全屏' : '全屏'}
              className="h-8 w-8"
            >
              <span className="material-symbols-outlined text-[18px]">
                {fullscreen ? 'close_fullscreen' : 'open_in_full'}
              </span>
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <CreationStageStepper currentStep={currentStep} />
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-muted/25">
        {canUseResizablePanels ? (
          <ResizablePanelGroup
            key={`${contextCollapsed ? 'context-off' : 'context-on'}-${activityCollapsed ? 'activity-off' : 'activity-on'}`}
            orientation="horizontal"
            className="h-full min-h-0"
          >
            {!contextCollapsed ? (
              <>
                <ResizablePanel id="creation-context" defaultSize="22%" minSize="16%" maxSize="32%" className="min-w-0">
                  {contextRail}
                </ResizablePanel>
                <ResizableHandle withHandle className="bg-border/70" />
              </>
            ) : null}

            <ResizablePanel id="creation-result" defaultSize={centerDefaultSize} minSize="34%" className="min-w-0">
              {resultPanel}
            </ResizablePanel>

            {!activityCollapsed ? (
              <>
                <ResizableHandle withHandle className="bg-border/70" />
                <ResizablePanel id="creation-activity" defaultSize="24%" minSize="18%" maxSize="36%" className="min-w-0">
                  {activityRail}
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        ) : (
          <div className="flex h-full min-h-0">
            {!contextCollapsed ? (
              <div className="min-w-[15rem] basis-[22%] border-r">
                {contextRail}
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              {resultPanel}
            </div>
            {!activityCollapsed ? (
              <div className="min-w-[17rem] basis-[24%] border-l">
                {activityRail}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-background px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {footerLeft}
          {footerStatus ? <div className="min-w-0 text-xs text-muted-foreground">{footerStatus}</div> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {footerRight}
        </div>
      </div>
    </div>
  );
}

export default function NewConfigModal({
  isOpen,
  onClose,
  onSuccess,
  homepageCompact = false,
  resumeCreationSessionId = null,
  initialMode,
  initialWorkflowName,
  initialReferenceWorkflow,
  initialRequirements,
  initialDescription,
  initialWorkingDirectory,
  initialWorkspaceMode,
  frontendSessionId,
  hideAiGuided = false,
  inheritEngine = '',
  inheritModel = '',
  focusRequirementsOnOpen = false,
}: NewConfigModalProps) {
  const { toast } = useToast();
  const { appendSessionMessage, updateSessionCreationBinding, appendVisibleSessionTag } = useChat();
  const { resolvedTheme } = useTheme();
  const [workflowMode, setWorkflowMode] = useState<'phase-based' | 'state-machine' | 'ai-guided'>(initialMode || 'phase-based');
  // Step 1 = form, step 2 = clarification form, step 3 = plan generation, step 4 = plan preview, step 5 = AI workflow creation (ai-guided only)
  const [formStep, setFormStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [previewSession, setPreviewSession] = useState<any | null>(null);
  const [previewConfigValidation, setPreviewConfigValidation] = useState<any | null>(null);
  const [revisionNotes, setRevisionNotes] = useState('');
  const [revisionTarget, setRevisionTarget] = useState<'requirements' | 'design' | 'tasks'>('tasks');
  const [revisionImpactArea, setRevisionImpactArea] = useState<'phases' | 'agents' | 'checkpoints' | 'transitions'>('phases');
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<SpecCodingArtifactKey>('requirements');
  const [artifactViewMode, setArtifactViewMode] = useState<'preview' | 'edit' | 'diff'>('preview');
  const [artifactDrafts, setArtifactDrafts] = useState<SpecCodingArtifactDrafts>({
    requirements: '',
    design: '',
    tasks: '',
  });
  const [planWorkspaceOpen, setPlanWorkspaceOpen] = useState(false);
  const [planWorkspaceTab, setPlanWorkspaceTab] = useState<'artifacts' | 'nodes' | 'assignments' | 'revisions'>('artifacts');
  const [planWorkspaceFullscreen, setPlanWorkspaceFullscreen] = useState(false);
  const [creationFullscreen, setCreationFullscreen] = useState(false);
  const [creationContextCollapsed, setCreationContextCollapsed] = useState(false);
  const [creationActivityCollapsed, setCreationActivityCollapsed] = useState(false);
  const [savingArtifact, setSavingArtifact] = useState(false);
  const [isRevisingPlan, setIsRevisingPlan] = useState(false);
  const [selectedSnapshotVersion, setSelectedSnapshotVersion] = useState<string>('current');
  const [planningStage, setPlanningStage] = useState<'idle' | 'clarifying' | 'awaiting-answers' | 'generating-plan'>('idle');
  const [clarificationForm, setClarificationForm] = useState<ClarificationFormResult | null>(null);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, ClarificationAnswerValue>>({});
  const [workflowCreationProgressState, setWorkflowCreationProgressState] = useState<WorkflowCreationState>(() => createEmptyWorkflowCreationState());
  const [workflowCreationProgressStage, setWorkflowCreationProgressStage] = useState<CreationStageKey | null>(null);
  const [workflowCreationActiveStep, setWorkflowCreationActiveStep] = useState<WorkflowCreationActiveStep | null>(null);
  const [workflowCreationRetryNotice, setWorkflowCreationRetryNotice] = useState<WorkflowCreationRetryNotice | null>(null);

  // AI streaming state
  const [aiPhase, setAiPhase] = useState<'idle' | 'streaming' | 'waiting' | 'done'>('idle');
  const [aiMessages, setAiMessages] = useState<ModalAiMessage[]>([]);
  const workflowCreationRetryEvents = useMemo(
    () => collectWorkflowCreationRetryEvents(aiMessages, workflowCreationProgressStage),
    [aiMessages, workflowCreationProgressStage],
  );
  const [currentStream, setCurrentStream] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [aiFilename, setAiFilename] = useState('');
  const [workflowDraftConfig, setWorkflowDraftConfig] = useState<any | null>(null);
  const [workflowDraftValidation, setWorkflowDraftValidation] = useState<any | null>(null);
  const [workflowDraftPreview, setWorkflowDraftPreview] = useState<WorkflowDraftPreviewState | null>(null);
  const [workflowDraftContinueReason, setWorkflowDraftContinueReason] = useState('');
  const [isSavingWorkflowDraft, setIsSavingWorkflowDraft] = useState(false);
  const [backendSessionId, setBackendSessionId] = useState<string | undefined>();
  const streamContentRef = useRef<HTMLDivElement>(null);
  const streamAutoScrollLockedRef = useRef(false);
  const streamProgrammaticScrollRef = useRef(false);
  const [showStreamScrollBtn, setShowStreamScrollBtn] = useState(false);
  const [modalHistoryExpanded, setModalHistoryExpanded] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const restoringSessionRef = useRef(false);
  const restoreGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredPlanningSessionRef = useRef<string | null>(null);
  const reconnectingPlanningChatIdRef = useRef<string | null>(null);
  const stageSessionsRef = useRef<Record<CreationStageKey, any>>({} as Record<CreationStageKey, any>);
  const draftSessionCreatedInCurrentOpenRef = useRef(false);
  const modalWasOpenRef = useRef(false);
  const initialFormValuesAppliedRef = useRef(false);
  const hydratingRestoredSessionRef = useRef(false);
  const clarificationAbortRef = useRef(false);

  // Engine/model selection for AI mode — inherit from parent if provided
  const [aiEngine, setAiEngine] = useState(inheritEngine);
  const [aiModel, setAiModel] = useState(inheritModel);
  const [aiRestartFlag, setAiRestartFlag] = useState(0);
  const [referenceWorkflows, setReferenceWorkflows] = useState<ReferenceWorkflowSummary[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceConfig, setReferenceConfig] = useState<{ config: any; raw: string } | null>(null);
  const [referenceConfigLoading, setReferenceConfigLoading] = useState(false);
  const [creationRecommendations, setCreationRecommendations] = useState<WorkflowCreationRecommendations | null>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [planningFrontendSessionId, setPlanningFrontendSessionId] = useState<string | null>(null);
  const [draftCreationSessionId, setDraftCreationSessionId] = useState<string | null>(null);
  const [specPlanningEnabled, setSpecPlanningEnabled] = useState(true);
  const requirementsSectionRef = useRef<HTMLDivElement | null>(null);
  const requirementsInputRef = useRef<HTMLTextAreaElement | null>(null);
  const draftBootstrapStartedRef = useRef(false);
  const draftFieldSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs to always read latest engine/model in sendToAi
  const aiEngineRef = useRef(inheritEngine);
  const aiModelRef = useRef(inheritModel);
  const backendSessionEngineRef = useRef(inheritEngine);
  const backendSessionModelRef = useRef(inheritModel);

  const appendRepairDiagnosticMessage = useCallback((diagnostic: Omit<Extract<ModalAiMessage, { role: 'repair-diagnostic' }>, 'role' | 'content'>) => {
    setAiMessages((prev) => [...prev, createRepairDiagnosticMessage(diagnostic)]);
  }, []);

  const resolveFormStepFromSession = useCallback((session: any): 1 | 2 | 3 | 4 | 5 => {
    if (session.mode === 'ai-guided' && session.status === 'confirmed') {
      return 5;
    }
    if (session.status === 'confirmed' || session.status === 'config-generated' || session.status === 'run-bound') {
      return 4;
    }
    if (session.stageSessions?.specPlanning) return 3;
    if (session.stageSessions?.clarification) return 2;
    return 1;
  }, []);

  const beginSessionRestoreGuard = useCallback(() => {
    restoringSessionRef.current = true;
    if (restoreGuardTimerRef.current) {
      clearTimeout(restoreGuardTimerRef.current);
    }
    restoreGuardTimerRef.current = setTimeout(() => {
      restoringSessionRef.current = false;
      restoreGuardTimerRef.current = null;
    }, 1200);
  }, []);

  const finishRestoredSessionHydration = useCallback(() => {
    window.setTimeout(() => {
      hydratingRestoredSessionRef.current = false;
    }, 250);
  }, []);

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    setValue,
    formState: { errors, isSubmitting },
    reset,
    watch,
    getValues,
  } = useForm<NewConfigForm>({
    defaultValues: {
      mode: 'phase-based',
      referenceWorkflow: '',
      workingDirectory: '',
      workspaceMode: 'in-place',
      persistMode: 'none',
      specRoot: '.spec',
    },
  });
  const workflowNameValue = watch('workflowName');
  const filenameValue = watch('filename');
  const referenceWorkflowValue = watch('referenceWorkflow');
  const workingDirectoryValue = watch('workingDirectory');
  const workspaceModeValue = watch('workspaceMode');
  const descriptionValue = watch('description');
  const requirementsValue = watch('requirements');
  const persistModeValue = watch('persistMode') || 'none';
  const specRootValue = watch('specRoot') || '.spec';
  const showReferenceWorkflowOptions = workflowMode === 'ai-guided' && !hideAiGuided;
  const useSpecPlanningFlow = workflowMode === 'ai-guided' && specPlanningEnabled;
  const showSpecPlanningToggle = workflowMode === 'ai-guided' || workflowMode === 'state-machine';
  const selectedReferenceWorkflowMode = referenceWorkflowValue
    ? referenceWorkflows.find((workflow) => workflow.filename === referenceWorkflowValue)?.mode
    : undefined;
  const referenceWorkflowMode = selectedReferenceWorkflowMode && workflowMode === 'ai-guided'
    ? normalizeReferenceWorkflowMode(selectedReferenceWorkflowMode)
    : getReferenceWorkflowMode(workflowMode);
  const filteredReferenceWorkflows = useMemo(() => (
    referenceWorkflows.filter((workflow) => normalizeReferenceWorkflowMode(workflow.mode) === referenceWorkflowMode)
  ), [referenceWorkflowMode, referenceWorkflows]);
  const effectiveReferenceWorkflowValue = useMemo(() => {
    if (referenceWorkflowValue) return referenceWorkflowValue;
    if (
      creationRecommendations?.referenceWorkflow?.autoApply
      && normalizeReferenceWorkflowMode(creationRecommendations.referenceWorkflow.mode) === referenceWorkflowMode
    ) {
      return creationRecommendations.referenceWorkflow.filename;
    }
    return '';
  }, [creationRecommendations?.referenceWorkflow, referenceWorkflowMode, referenceWorkflowValue]);
  const recommendedAgents = useMemo(() => creationRecommendations?.recommendedAgents || [], [creationRecommendations?.recommendedAgents]);
  const handleWorkingDirectoryChange = useCallback((path: string) => {
    setValue('workingDirectory', path, { shouldDirty: true, shouldValidate: true });
  }, [setValue]);
  const recommendedSupervisorAgent = creationRecommendations?.recommendedSupervisorAgent || 'default-supervisor';
  const creationDialogClassName = creationFullscreen
    ? 'flex h-screen max-h-none w-screen max-w-none flex-col p-0 sm:rounded-none'
    : 'max-w-4xl flex flex-col p-0 max-h-[90vh]';
  const creationStageDialogClassName = creationFullscreen
    ? creationDialogClassName
    : 'flex h-[92vh] max-h-[92vh] w-[96vw] max-w-[1600px] flex-col p-0';
  const planWorkspaceDialogClassName = planWorkspaceFullscreen
    ? 'flex h-screen max-h-none w-screen max-w-none flex-col p-0 sm:rounded-none'
    : 'flex h-[92vh] max-h-[92vh] w-[96vw] max-w-[96vw] flex-col p-0';
  const preventCreationDialogOutsideClose = useCallback((event: Event) => {
    event.preventDefault();
  }, []);
  const requirementsField = register('requirements');

  const generateDefaultFilename = useCallback(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 6);
    return `workflow-${y}${m}${d}-${hh}${mm}-${rand}.yaml`;
  }, []);

  useEffect(() => {
    if (!isOpen) {
      modalWasOpenRef.current = false;
      draftBootstrapStartedRef.current = false;
      initialFormValuesAppliedRef.current = false;
      return;
    }
    if (modalWasOpenRef.current) return;
    modalWasOpenRef.current = true;
    draftBootstrapStartedRef.current = false;
    draftSessionCreatedInCurrentOpenRef.current = false;
    if (!resumeCreationSessionId) {
      setPreviewSession(null);
      setPreviewConfigValidation(null);
      setPlanningFrontendSessionId(null);
      setDraftCreationSessionId(null);
      setBackendSessionId(undefined);
    }
  }, [isOpen, resumeCreationSessionId]);

  useEffect(() => {
    if (!isOpen || resumeCreationSessionId) return;
    if (typeof window === 'undefined') return;
    const storedMode = localStorage.getItem(PERSIST_SPEC_MODE_STORAGE_KEY);
    const storedRoot = localStorage.getItem(PERSIST_SPEC_ROOT_STORAGE_KEY);
    const storedSpecPlanning = localStorage.getItem(SPEC_PLANNING_ENABLED_STORAGE_KEY);
    if (storedMode === 'repository' || storedMode === 'none') {
      setValue('persistMode', storedMode, { shouldDirty: false, shouldValidate: false });
    }
    if (storedRoot && storedRoot.trim()) {
      setValue('specRoot', storedRoot.trim(), { shouldDirty: false, shouldValidate: false });
    }
    if (storedSpecPlanning === '0' || storedSpecPlanning === '1') {
      setSpecPlanningEnabled(storedSpecPlanning !== '0');
    }
  }, [isOpen, resumeCreationSessionId, setValue]);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof window === 'undefined') return;
    localStorage.setItem(PERSIST_SPEC_MODE_STORAGE_KEY, persistModeValue === 'repository' ? 'repository' : 'none');
    localStorage.setItem(PERSIST_SPEC_ROOT_STORAGE_KEY, (specRootValue || '.spec').trim() || '.spec');
    localStorage.setItem(SPEC_PLANNING_ENABLED_STORAGE_KEY, specPlanningEnabled ? '1' : '0');
  }, [isOpen, persistModeValue, specPlanningEnabled, specRootValue]);

  useEffect(() => {
    if (!isOpen || showReferenceWorkflowOptions) return;
    setValue('referenceWorkflow', '', { shouldDirty: false, shouldValidate: false });
    setReferenceConfig(null);
  }, [isOpen, setValue, showReferenceWorkflowOptions]);

  useEffect(() => {
    if (!isOpen) return;
    const current = (getValues('filename') || '').trim();
    if (current) return;
    setValue('filename', generateDefaultFilename(), { shouldDirty: false, shouldValidate: true });
  }, [generateDefaultFilename, getValues, isOpen, setValue]);

  useEffect(() => {
    setValue('mode', workflowMode, { shouldDirty: true, shouldValidate: false });
  }, [setValue, workflowMode]);

  useEffect(() => {
    if (!isOpen) return;
    if (initialFormValuesAppliedRef.current) return;
    initialFormValuesAppliedRef.current = true;
    if (initialMode) {
      setWorkflowMode(initialMode);
      setValue('mode', initialMode, { shouldDirty: false, shouldValidate: false });
    }
    if (initialWorkflowName !== undefined) {
      setValue('workflowName', initialWorkflowName, { shouldDirty: false, shouldValidate: false });
    }
    if (initialReferenceWorkflow !== undefined) {
      setValue('referenceWorkflow', initialReferenceWorkflow, { shouldDirty: false, shouldValidate: false });
    }
    if (initialRequirements !== undefined) {
      setValue('requirements', initialRequirements, { shouldDirty: false, shouldValidate: false });
    }
    if (initialDescription !== undefined) {
      setValue('description', initialDescription, { shouldDirty: false, shouldValidate: false });
    }
    if (initialWorkingDirectory !== undefined) {
      setValue('workingDirectory', initialWorkingDirectory, { shouldDirty: false, shouldValidate: false });
    }
    if (initialWorkspaceMode !== undefined) {
      setValue('workspaceMode', initialWorkspaceMode, { shouldDirty: false, shouldValidate: false });
    }
  }, [initialDescription, initialMode, initialReferenceWorkflow, initialRequirements, initialWorkflowName, initialWorkingDirectory, initialWorkspaceMode, isOpen, setValue]);

  useEffect(() => {
    if (!isOpen || !focusRequirementsOnOpen || resumeCreationSessionId) return;
    const timer = window.setTimeout(() => {
      requirementsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      requirementsInputRef.current?.focus({ preventScroll: true });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [focusRequirementsOnOpen, isOpen, resumeCreationSessionId, workflowMode]);

  const applyRestoredSession = useCallback((session: any) => {
    hydratingRestoredSessionRef.current = true;
    initialFormValuesAppliedRef.current = true;
    beginSessionRestoreGuard();
    setPreviewSession(session);
    setPreviewConfigValidation(null);
    setWorkflowMode(session.mode || 'ai-guided');
    setDraftCreationSessionId(session.id);
    draftSessionCreatedInCurrentOpenRef.current = true;
    stageSessionsRef.current = session.stageSessions || {} as Record<CreationStageKey, any>;
    setAiEngine(session.planningEngine || inheritEngine);
    aiEngineRef.current = session.planningEngine || inheritEngine;
    setAiModel(session.planningModel || inheritModel);
    aiModelRef.current = session.planningModel || inheritModel;
    const latestStageSession = session.stageSessions?.workflowDraft || session.stageSessions?.specPlanning || session.stageSessions?.clarification;
    if (latestStageSession?.backendSessionId) {
      setBackendSessionId(latestStageSession.backendSessionId);
      backendSessionEngineRef.current = session.planningEngine || inheritEngine;
      backendSessionModelRef.current = session.planningModel || inheritModel;
    }
    reset({
      mode: session.mode || 'ai-guided',
      workflowName: session.workflowName || '',
      filename: session.filename || '',
      referenceWorkflow: session.referenceWorkflow || '',
      workingDirectory: session.workingDirectory || '',
      workspaceMode: session.workspaceMode || 'in-place',
      description: session.description || '',
      requirements: session.requirements || '',
      persistMode: session.specCoding?.persistMode || 'none',
      specRoot: session.specCoding?.specRoot || '.spec',
    });
    setPlanningFrontendSessionId((prev) => (
      session.stageSessions?.workflowDraft?.frontendSessionId
      || session.stageSessions?.specPlanning?.frontendSessionId
      || session.stageSessions?.clarification?.frontendSessionId
      || session.chatSessionId
      || prev
    ));
    if (session.uiState?.clarificationForm) {
      setClarificationForm(session.uiState.clarificationForm);
      setClarificationAnswers(session.uiState.clarificationAnswers || {});
      setPlanningStage(session.uiState.planningStage || 'awaiting-answers');
    } else {
      setClarificationForm(null);
      setClarificationAnswers(session.uiState?.clarificationAnswers || {});
      setPlanningStage(session.uiState?.planningStage || 'idle');
    }
    const resolvedStep = Math.max(session.uiState?.formStep || 1, resolveFormStepFromSession(session)) as 1 | 2 | 3 | 4 | 5;
    setFormStep(resolvedStep);
    setAiPhase(resolvedStep === 3 || resolvedStep === 5 ? 'waiting' : 'idle');
    setIsGeneratingPlan(false);
    setCurrentStream('');
    setCurrentThinking('');
    finishRestoredSessionHydration();
  }, [beginSessionRestoreGuard, finishRestoredSessionHydration, inheritEngine, inheritModel, reset, resolveFormStepFromSession]);

  useEffect(() => {
    if (!isOpen || !resumeCreationSessionId) return;
    let cancelled = false;
    modalSessionJsonFetch<any>(`/api/spec-coding/sessions/${encodeURIComponent(resumeCreationSessionId)}`)
      .then((data) => {
        if (cancelled || !data?.session) return;
        applyRestoredSession(data.session);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [applyRestoredSession, isOpen, resumeCreationSessionId]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setReferenceLoading(true);
    modalAuthJsonFetch<{ configs: ReferenceWorkflowSummary[] }>('/api/configs')
      .then((data) => {
        if (cancelled) return;
        setReferenceWorkflows((data.configs || []) as ReferenceWorkflowSummary[]);
      })
      .catch(() => {
        if (!cancelled) {
          setReferenceWorkflows([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReferenceLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !referenceWorkflowValue) return;
    const selectedWorkflow = referenceWorkflows.find((workflow) => workflow.filename === referenceWorkflowValue);
    if (!selectedWorkflow) return;
    if (normalizeReferenceWorkflowMode(selectedWorkflow.mode) !== referenceWorkflowMode) {
      setValue('referenceWorkflow', '', { shouldDirty: true, shouldValidate: true });
      setReferenceConfig(null);
    }
  }, [isOpen, referenceWorkflowMode, referenceWorkflowValue, referenceWorkflows, setValue]);

  useEffect(() => {
    if (!isOpen || !effectiveReferenceWorkflowValue) {
      setReferenceConfig(null);
      return;
    }
    let cancelled = false;
    setReferenceConfigLoading(true);
    modalAuthJsonFetch<{ config: any; raw: string }>(`/api/configs/${encodeURIComponent(effectiveReferenceWorkflowValue)}`)
      .then((data) => {
        if (!cancelled) {
          setReferenceConfig({ config: data.config, raw: data.raw });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReferenceConfig(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReferenceConfigLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveReferenceWorkflowValue, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setCreationRecommendations(null);
      return;
    }

    const seed = `${workflowNameValue || ''}${requirementsValue || ''}${workingDirectoryValue || ''}${referenceWorkflowValue || ''}`.trim();
    if (seed.length < 4 && !referenceWorkflowValue) {
      setCreationRecommendations(null);
      return;
    }

    let cancelled = false;
    setRecommendationsLoading(true);
    const timer = window.setTimeout(() => {
      modalAuthJsonFetch<{ recommendations: WorkflowCreationRecommendations | null }>('/api/configs/recommendations', {
        method: 'POST',
        body: JSON.stringify({
          workflowName: workflowNameValue || '',
          requirements: requirementsValue || descriptionValue || '',
          workingDirectory: workingDirectoryValue || '',
          referenceWorkflow: referenceWorkflowValue || '',
          workflowMode: referenceWorkflowMode,
        }),
      })
        .then((result) => {
          if (!cancelled) {
            setCreationRecommendations(result.recommendations || null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCreationRecommendations(null);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setRecommendationsLoading(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [descriptionValue, isOpen, referenceWorkflowMode, referenceWorkflowValue, requirementsValue, workflowNameValue, workingDirectoryValue]);

  useEffect(() => {
    if (restoringSessionRef.current) return;
    if (hydratingRestoredSessionRef.current) return;
    if (!previewSession) return;
    const changed =
      !isEqualOptionalString(previewSession.workflowName, workflowNameValue)
      || !isEqualOptionalString(previewSession.filename, filenameValue)
      || !isEqualOptionalString(previewSession.referenceWorkflow, referenceWorkflowValue)
      || !isEqualOptionalString(previewSession.workingDirectory, workingDirectoryValue)
      || !isEqualOptionalString(previewSession.workspaceMode, workspaceModeValue)
      || !isEqualOptionalString(previewSession.description, descriptionValue)
      || !isEqualOptionalString(previewSession.requirements, requirementsValue)
      || !isEqualOptionalString(previewSession.specCoding?.persistMode || 'none', persistModeValue || 'none')
      || !isEqualOptionalString(previewSession.specCoding?.specRoot || '.spec', specRootValue || '.spec')
      || previewSession.mode !== workflowMode;
    if (changed) {
      if (formStep !== 1) return;
      setPreviewSession(null);
      setPreviewConfigValidation(null);
      setPlanningStage('idle');
      setClarificationForm(null);
      setClarificationAnswers({});
    }
  }, [
    descriptionValue,
    filenameValue,
    formStep,
    persistModeValue,
    previewSession,
    requirementsValue,
    specRootValue,
    referenceWorkflowValue,
    workflowMode,
    workflowNameValue,
    workingDirectoryValue,
    workspaceModeValue,
  ]);

  const artifactsSyncKey = previewSession?.specCoding?.artifacts
    ? `${(previewSession.specCoding.artifacts.requirements || '').length}:${(previewSession.specCoding.artifacts.design || '').length}:${(previewSession.specCoding.artifacts.tasks || '').length}`
    : '';
  useEffect(() => {
    if (!previewSession?.specCoding) return;
    setArtifactDrafts(buildArtifactDrafts(previewSession.specCoding));
  }, [previewSession?.id, previewSession?.specCoding, previewSession?.specCoding?.version, artifactsSyncKey]);

  useEffect(() => {
    const snapshots = previewSession?.artifactSnapshots || [];
    const previous = [...snapshots]
      .filter((item: any) => item.version !== previewSession?.specCoding?.version)
      .sort((a: any, b: any) => b.version - a.version)[0];
    setSelectedSnapshotVersion(previous ? String(previous.version) : 'current');
  }, [previewSession?.artifactSnapshots, previewSession?.specCoding?.version]);

  const applySchemaIssues = useCallback((issues: Array<{ path?: (string | number)[]; message?: string }>) => {
    const supported = ['filename', 'workflowName', 'referenceWorkflow', 'workingDirectory', 'workspaceMode', 'description', 'requirements', 'mode', 'persistMode', 'specRoot'];
    clearErrors();
    const messages: string[] = [];
    for (const issue of issues) {
      const field = issue?.path?.[0];
      const message = issue?.message || '输入不合法';
      if (typeof field === 'string' && supported.includes(field)) {
        setError(field as keyof NewConfigForm, { type: 'validate', message });
      }
      messages.push(message);
    }
    if (messages.length > 0) {
      toast('error', [...new Set(messages)].join('\n'));
    }
  }, [clearErrors, setError, toast]);

  const unlockPlanningAutoScroll = useCallback(() => {
    streamAutoScrollLockedRef.current = false;
    setShowStreamScrollBtn(false);
  }, []);

  const scrollPlanningStreamToBottom = useCallback(() => {
    const scroller = streamContentRef.current;
    if (!scroller) return;
    unlockPlanningAutoScroll();
    streamProgrammaticScrollRef.current = true;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    window.setTimeout(() => {
      streamProgrammaticScrollRef.current = false;
    }, 500);
  }, [unlockPlanningAutoScroll]);

  useEffect(() => {
    const scroller = streamContentRef.current;
    if (!scroller) return;
    const handleScroll = () => {
      if (streamProgrammaticScrollRef.current) return;
      const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
      streamAutoScrollLockedRef.current = !nearBottom;
      setShowStreamScrollBtn(!nearBottom);
    };
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => scroller.removeEventListener('scroll', handleScroll);
  }, [formStep, clarificationForm, creationActivityCollapsed]);

  // Auto-scroll streaming content only while the user stays near the bottom.
  useEffect(() => {
    const scroller = streamContentRef.current;
    if (!scroller || streamAutoScrollLockedRef.current) return;
    streamProgrammaticScrollRef.current = true;
    scroller.scrollTop = scroller.scrollHeight;
    window.setTimeout(() => {
      streamProgrammaticScrollRef.current = false;
    }, 100);
  }, [aiMessages, currentStream, currentThinking, formStep]);

  useEffect(() => {
    setModalHistoryExpanded(false);
  }, [formStep, planningStage, isOpen]);

  const renderModalAiMessage = useCallback((msg: ModalAiMessage, index: number, options?: { showUserMessages?: boolean }) => {
    const showUserMessages = options?.showUserMessages ?? false;
    if (isModalAiRepairDiagnosticMessage(msg)) {
      return (
        <ModalRepairDiagnosticPanel
          key={`${msg.role}-${index}`}
          message={msg}
        />
      );
    }

    if (msg.role === 'ai' || msg.role === 'thinking') {
      const displayContent = getDisplayContentForAiStream(msg.content);
      const { text, cards } = parseActions(displayContent);
      if (!text.trim() && cards.length === 0) return null;
      return (
        <ChatMessage
          key={`${msg.role}-${index}`}
          message={{
            id: `modal-history-${index}`,
            role: 'assistant',
            content: text,
            rawContent: displayContent || msg.content,
            cards,
          }}
          isStreaming={false}
          onConfirmAction={modalChatActionNoop}
          onRejectAction={modalChatActionNoop}
          onUndoAction={modalChatActionNoop}
          onRetryAction={modalChatActionNoop}
          onAction={modalChatPromptNoop}
        />
      );
    }

    if (msg.role === 'user') {
      if (!showUserMessages) return null;
      return (
        <div key={`${msg.role}-${index}`} className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-blue-500 px-4 py-2 text-white">
            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
          </div>
        </div>
      );
    }

    return null;
  }, []);

  const renderModalHistorySection = useCallback((options?: { showUserMessages?: boolean; tailContent?: React.ReactNode }) => {
    const showUserMessages = options?.showUserMessages ?? false;
    const visibleMessages = mergeModalAiThinkingMessages(aiMessages)
      .filter((message) => showUserMessages || message.role !== 'user');
    const hiddenCount = Math.max(visibleMessages.length - MODAL_HISTORY_RECENT_WINDOW, 0);
    const hiddenMessages = visibleMessages.slice(0, hiddenCount);
    const recentMessages = visibleMessages.slice(hiddenCount);

    return (
      <MessageHistoryCollapse
        hiddenCount={hiddenCount}
        recentCount={Math.min(MODAL_HISTORY_RECENT_WINDOW, visibleMessages.length)}
        open={modalHistoryExpanded}
        onOpenChange={setModalHistoryExpanded}
        hiddenContent={<div className="space-y-3">{hiddenMessages.map((msg, index) => renderModalAiMessage(msg, index, { showUserMessages }))}</div>}
        recentContent={(
          <div className="space-y-3">
            {recentMessages.map((msg, index) => renderModalAiMessage(msg, hiddenCount + index, { showUserMessages }))}
            {options?.tailContent}
          </div>
        )}
      />
    );
  }, [aiMessages, modalHistoryExpanded, renderModalAiMessage]);

  const detachStreamSubscription = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // Cleanup on unmount/close
  const cleanupStream = useCallback((options?: { preserveRun?: boolean }) => {
    const activeChatId = chatIdRef.current;
    detachStreamSubscription();
    if (options?.preserveRun) {
      chatIdRef.current = null;
      return;
    }
    if (activeChatId) {
      fetch(`/api/chat/stream?id=${encodeURIComponent(activeChatId)}`, { method: 'DELETE' }).catch(() => {});
    }
    chatIdRef.current = null;
  }, [detachStreamSubscription]);

  const interruptPlanningRun = useCallback(() => {
    cleanupStream();
    setCurrentStream('');
    setCurrentThinking('');
    setIsGeneratingPlan(false);
  }, [cleanupStream]);

  const appendPlanningAssistantMessage = useCallback(async (
    sessionId: string | null | undefined,
    content: string,
    backendSid?: string | null
  ) => {
    if (!sessionId || !content.trim()) return;
    // When the modal is opened from the homepage chat session, keep the chat
    // timeline lightweight: only append visible workflow-stage tags there.
    // The detailed planning draft/revision content stays inside the modal UI.
    if (frontendSessionId && sessionId === frontendSessionId) return;
    await appendSessionMessage(sessionId, {
      role: 'assistant',
      content,
      rawContent: content,
      engine: aiEngineRef.current || undefined,
      model: aiModelRef.current || undefined,
    }, { backendSessionId: backendSid });
  }, [appendSessionMessage, frontendSessionId]);

  const appendCreationSessionTag = useCallback(async (
    sessionId: string | null | undefined,
    label: string
  ) => {
    if (!sessionId) return;
    await appendVisibleSessionTag(sessionId, `${CREATION_SESSION_TAG_PREFIX} ${label}`).catch(() => {});
  }, [appendVisibleSessionTag]);

  const appendCreationSessionTags = useCallback(async (
    session: any,
    stageLabel: string
  ) => {
    if (!session?.id) return;
    const targetChatSessionIds = Array.from(new Set([
      session?.chatSessionId,
      planningFrontendSessionId,
      frontendSessionId,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
    if (targetChatSessionIds.length === 0) return;
    const tag = [
      session.workflowName || '新工作流',
      session.filename || '未命名配置',
      stageLabel,
    ].join(' · ');
    await Promise.all(targetChatSessionIds.map((sessionId) => appendCreationSessionTag(sessionId, tag)));
  }, [appendCreationSessionTag, frontendSessionId, planningFrontendSessionId]);

  const resetAll = useCallback(() => {
    interruptPlanningRun();
    setAiPhase('idle');
    setAiMessages([]);
    setAiFilename('');
    setWorkflowDraftConfig(null);
    setWorkflowDraftValidation(null);
    setWorkflowDraftPreview(null);
    setIsSavingWorkflowDraft(false);
    setFormStep(1);
    setPlanningStage('idle');
    setClarificationForm(null);
    setClarificationAnswers({});
    setPlanWorkspaceOpen(false);
    setPlanWorkspaceTab('artifacts');
    setPlanWorkspaceFullscreen(false);
    setCreationFullscreen(false);
    setCreationContextCollapsed(false);
    setCreationActivityCollapsed(false);
    setWorkflowCreationProgressState(createEmptyWorkflowCreationState());
    setWorkflowCreationProgressStage(null);
    setWorkflowCreationActiveStep(null);
    setWorkflowCreationRetryNotice(null);
    clarificationAbortRef.current = false;
    setPreviewSession(null);
    setPreviewConfigValidation(null);
    stageSessionsRef.current = {} as Record<CreationStageKey, any>;
  }, [interruptPlanningRun]);

  // When engine or model changes during workflow creation, restart the AI conversation
  const handleAiEngineChange = (engine: string) => {
    setAiEngine(engine);
    aiEngineRef.current = engine;
    if (backendSessionId && engine !== backendSessionEngineRef.current) {
      setBackendSessionId(undefined);
      backendSessionEngineRef.current = engine;
      backendSessionModelRef.current = aiModelRef.current;
    }
    void restartPlanningConversation();
    if (formStep === 5) {
      setAiRestartFlag((f) => f + 1);
    }
  };
  const handleAiModelChange = (model: string) => {
    setAiModel(model);
    aiModelRef.current = model;
    if (backendSessionId && model !== backendSessionModelRef.current) {
      setBackendSessionId(undefined);
      backendSessionEngineRef.current = aiEngineRef.current;
      backendSessionModelRef.current = model;
    }
    void restartPlanningConversation();
    if (formStep === 5) {
      setAiRestartFlag((f) => f + 1);
    }
  };

  const validateWorkflowDraftConfig = useCallback(async (config: any) => {
    const data = await modalAuthJsonFetch<any>('/api/configs/validate', {
      method: 'POST',
      body: JSON.stringify({ config }),
    });
    const baseValidation = data.validation || data;
    const requireExplicitBindings = workflowMode === 'ai-guided' && specPlanningEnabled;
    if (!requireExplicitBindings) {
      return baseValidation;
    }

    const bindingCompilation = compileStepTaskBindings(baseValidation?.normalized || config, previewSession?.specCoding, {
      requireExplicit: true,
    });
    return mergeWorkflowDraftValidation(baseValidation, bindingCompilation.validation);
  }, [previewSession?.specCoding, specPlanningEnabled, workflowMode]);

  const checkExistingWorkflowFile = useCallback(async (filename: string) => {
    try {
      const data = await modalAuthJsonFetch<any>(`/api/configs/${encodeURIComponent(filename)}`);
      const validation = data.validation || await validateWorkflowDraftConfig(data.config);
      return {
        exists: true,
        ok: Boolean(validation?.ok),
        config: data.config,
        validation,
      };
    } catch (error: any) {
      return {
        exists: false,
        ok: false,
        config: null,
        validation: { ok: false, issues: [], message: error?.message || '配置文件不存在或无法读取' },
      };
    }
  }, [validateWorkflowDraftConfig]);

  const bindCurrentDraftToChatSession = useCallback(async (targetChatSessionId: string | null | undefined) => {
    const targetCreationSessionId = draftCreationSessionId || previewSession?.id;
    if (!targetChatSessionId || !targetCreationSessionId) return;
    const creationBinding = {
      creationSessionId: targetCreationSessionId,
      filename: getValues('filename') || previewSession?.filename,
      workflowName: getValues('workflowName') || previewSession?.workflowName,
      status: previewSession?.status || 'draft',
      specCodingId: previewSession?.specCoding?.id,
      createdAt: previewSession?.createdAt,
      updatedAt: previewSession?.updatedAt,
    };
    const sessionData = await modalSessionJsonFetch<any>(`/api/chat/sessions/${encodeURIComponent(targetChatSessionId)}`).catch(() => null);
    if (sessionData?.session) {
      await modalSessionJsonFetch(`/api/chat/sessions/${encodeURIComponent(targetChatSessionId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...sessionData.session,
          creationSession: creationBinding,
        }),
      }).catch(() => {});
    }
    await updateSessionCreationBinding(targetChatSessionId, creationBinding).catch(() => {});
  }, [draftCreationSessionId, getValues, previewSession, updateSessionCreationBinding]);

  const createPlanningChatSession = useCallback(async () => {
    const data = await modalSessionJsonFetch<any>('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({
        title: `创建计划：${getValues('workflowName') || '新工作流'}`,
        model: aiModelRef.current || undefined,
        engine: aiEngineRef.current || undefined,
        visibility: 'private',
      }),
    });
    if (!data?.session?.id) {
      throw new Error(data?.error || '创建计划会话失败');
    }
    setPlanningFrontendSessionId(data.session.id);
    restoredPlanningSessionRef.current = null;
    reconnectingPlanningChatIdRef.current = null;
    await bindCurrentDraftToChatSession(data.session.id).catch(() => {});
    return data.session.id as string;
  }, [bindCurrentDraftToChatSession, getValues]);

  const persistStageSessionBinding = useCallback(async (
    stage: CreationStageKey,
    input: {
      frontendSessionId?: string | null;
      backendSessionId?: string | null;
    }
  ) => {
    const hasBackendSessionId = hasOwnKey(input, 'backendSessionId');
    const nextStageSessions = {
      ...stageSessionsRef.current,
      [stage]: {
        ...(stageSessionsRef.current?.[stage] || {}),
        frontendSessionId: input.frontendSessionId || stageSessionsRef.current?.[stage]?.frontendSessionId,
        backendSessionId: hasBackendSessionId
          ? (input.backendSessionId || undefined)
          : stageSessionsRef.current?.[stage]?.backendSessionId,
        engine: aiEngineRef.current || undefined,
        model: aiModelRef.current || undefined,
        updatedAt: Date.now(),
      },
    };
    stageSessionsRef.current = nextStageSessions;
    const targetCreationSessionId = draftCreationSessionId || previewSession?.id;
    if (!targetCreationSessionId) return;
    await modalSessionJsonFetch(`/api/spec-coding/sessions/${encodeURIComponent(targetCreationSessionId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        chatSessionId: input.frontendSessionId || planningFrontendSessionId || undefined,
        planningEngine: aiEngineRef.current || undefined,
        planningModel: aiModelRef.current || undefined,
        stageSessions: nextStageSessions,
      }),
    }).catch(() => {});
    if (input.frontendSessionId) {
      await bindCurrentDraftToChatSession(input.frontendSessionId).catch(() => {});
    }
  }, [bindCurrentDraftToChatSession, draftCreationSessionId, planningFrontendSessionId, previewSession?.id]);

  const persistPlanningSessionBinding = useCallback(async (chatSessionId: string | null | undefined) => {
    const targetCreationSessionId = draftCreationSessionId || previewSession?.id;
    if (!targetCreationSessionId) return;
    await modalSessionJsonFetch(`/api/spec-coding/sessions/${encodeURIComponent(targetCreationSessionId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        chatSessionId: chatSessionId || undefined,
        planningEngine: aiEngineRef.current || undefined,
        planningModel: aiModelRef.current || undefined,
        stageSessions: stageSessionsRef.current,
      }),
    }).catch(() => {});
    if (chatSessionId) {
      await bindCurrentDraftToChatSession(chatSessionId).catch(() => {});
    }
  }, [bindCurrentDraftToChatSession, draftCreationSessionId, previewSession?.id]);

  const ensurePlanningChatSession = useCallback(async (forceFresh = false) => {
    if (!forceFresh && planningFrontendSessionId) return planningFrontendSessionId;
    const sessionId = await createPlanningChatSession();
    await persistPlanningSessionBinding(sessionId);
    return sessionId;
  }, [createPlanningChatSession, persistPlanningSessionBinding, planningFrontendSessionId]);

  const restartPlanningConversation = useCallback(async () => {
    interruptPlanningRun();
    setAiMessages([]);
    setCurrentStream('');
    setCurrentThinking('');
    setAiFilename('');
    setWorkflowDraftConfig(null);
    setWorkflowDraftValidation(null);
    setWorkflowDraftPreview(null);
    setBackendSessionId(undefined);
    restoredPlanningSessionRef.current = null;
    reconnectingPlanningChatIdRef.current = null;
    const nextPlanningSessionId = await ensurePlanningChatSession(true);
    await persistPlanningSessionBinding(nextPlanningSessionId);
  }, [ensurePlanningChatSession, interruptPlanningRun, persistPlanningSessionBinding]);

  const buildPreviewConfigFromForm = useCallback(() => {
    const values = getValues();
    if (referenceConfig?.config) {
      return cloneReferenceWorkflowConfig(referenceConfig.config, {
        workflowName: values.workflowName,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode,
        description: values.description,
        requirements: values.requirements,
      });
    }
    if (workflowMode === 'state-machine' || workflowMode === 'ai-guided') {
      return createStateMachinePreviewConfig(
        values.workflowName,
        values.workingDirectory,
        values.workspaceMode,
        values.description,
        recommendedAgents,
        recommendedSupervisorAgent
      );
    }
    return createPhaseBasedPreviewConfig(
      values.workflowName,
      values.workingDirectory,
      values.workspaceMode,
      values.description,
      recommendedAgents,
      recommendedSupervisorAgent
    );
  }, [getValues, recommendedAgents, recommendedSupervisorAgent, referenceConfig?.config, workflowMode]);

  const validatePersistedSpecSelection = useCallback(async (values?: Partial<NewConfigForm>) => {
    const draftValues = values || getValues();
    const { persistMode, specRoot } = normalizePersistSpecValues(draftValues);
    if (persistMode !== 'repository') {
      clearErrors('specRoot');
      return;
    }

    try {
      await modalSessionJsonFetch('/api/spec-coding/validate-persisted-root', {
        method: 'POST',
        body: JSON.stringify({
          workingDirectory: draftValues.workingDirectory,
          persistMode,
          specRoot,
        }),
      });
      clearErrors('specRoot');
    } catch (error: any) {
      const message = error?.message || '持久化 Spec 目录或 spec.md 校验失败';
      setError('specRoot', { type: 'validate', message });
      toast('error', message);
      throw error;
    }
  }, [clearErrors, getValues, setError, toast]);

  const bindDraftCreationSessionToChat = useCallback(async (session: any) => {
    if (!session?.id) return;
    const creationBinding = {
      creationSessionId: session.id,
      filename: session.filename,
      workflowName: session.workflowName,
      status: session.status,
      specCodingId: session.specCoding?.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
    const targetChatSessionIds = Array.from(new Set([
      session?.chatSessionId,
      planningFrontendSessionId,
      frontendSessionId,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
    if (targetChatSessionIds.length === 0 || !session?.id) return;

    await Promise.all(targetChatSessionIds.map(async (targetChatSessionId) => {
      const sessionData = await modalSessionJsonFetch<any>(`/api/chat/sessions/${encodeURIComponent(targetChatSessionId)}`).catch(() => null);
      if (sessionData?.session) {
        await modalSessionJsonFetch(`/api/chat/sessions/${encodeURIComponent(targetChatSessionId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            ...sessionData.session,
            creationSession: creationBinding,
          }),
        }).catch(() => {});
      }
      await updateSessionCreationBinding(targetChatSessionId, creationBinding).catch(() => {});
    }));
  }, [frontendSessionId, planningFrontendSessionId, updateSessionCreationBinding]);

  const createInitialDraftCreationSession = useCallback(async () => {
    if (draftCreationSessionId && draftSessionCreatedInCurrentOpenRef.current) {
      return draftCreationSessionId;
    }

    const planningSessionId = await ensurePlanningChatSession();
    const values = getValues();
    const { persistMode, specRoot } = normalizePersistSpecValues(values);
    const config = buildPreviewConfigFromForm();
    const data = await modalSessionJsonFetch<any>('/api/spec-coding/sessions', {
      method: 'POST',
      body: JSON.stringify({
        chatSessionId: planningSessionId,
        homeChatSessionId: frontendSessionId || undefined,
        status: 'draft',
        specCodingStatus: 'draft',
        filename: values.filename || generateDefaultFilename(),
        workflowName: values.workflowName || '新工作流',
        referenceWorkflow: effectiveReferenceWorkflowValue,
        mode: workflowMode,
        planningEngine: aiEngineRef.current || undefined,
        planningModel: aiModelRef.current || undefined,
        stageSessions: stageSessionsRef.current,
        workingDirectory: values.workingDirectory || '',
        workspaceMode: values.workspaceMode || 'in-place',
        description: values.description,
        requirements: values.requirements,
        persistMode,
        specRoot,
        config,
        uiState: {
          formStep: 1,
          planningStage: 'idle',
          clarificationAnswers: {},
        },
      }),
    });
    if (!data?.session?.id) {
      throw new Error(data?.error || '创建创建态草稿失败');
    }
    setDraftCreationSessionId(data.session.id);
    setPlanningFrontendSessionId(planningSessionId);
    draftSessionCreatedInCurrentOpenRef.current = true;
    await bindDraftCreationSessionToChat(data.session);
    await appendCreationSessionTags(data.session, '已开始');
    return data.session.id as string;
  }, [
    appendCreationSessionTags,
    bindDraftCreationSessionToChat,
    buildPreviewConfigFromForm,
    draftCreationSessionId,
    effectiveReferenceWorkflowValue,
    ensurePlanningChatSession,
    frontendSessionId,
    generateDefaultFilename,
    getValues,
    workflowMode,
  ]);

  const createPreviewSession = useCallback(async (draft?: PlanDraftResult, chatSessionId?: string | null) => {
    const values = getValues();
    const { persistMode, specRoot } = normalizePersistSpecValues(values);
    const previewConfig = buildPreviewConfigFromForm();
    const targetChatSessionId = chatSessionId || undefined;
    const draftData = await modalSessionJsonFetch<any>('/api/spec-coding/ai-draft', {
      method: 'POST',
      body: JSON.stringify({
        filename: values.filename,
        workflowName: values.workflowName,
        referenceWorkflow: effectiveReferenceWorkflowValue,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode,
        description: values.description,
        requirements: values.requirements,
        persistMode,
        specRoot,
        config: previewConfig,
        draft,
      }),
    });
    if (!draftData?.specCoding) {
      throw new Error(draftData?.error || '生成计划 AI 草案失败');
    }
    setPreviewConfigValidation(draftData.configValidation || null);
    const sessionPayload = {
      chatSessionId: targetChatSessionId,
      homeChatSessionId: frontendSessionId || undefined,
      status: 'draft',
      specCodingStatus: 'draft',
      filename: values.filename,
      workflowName: values.workflowName,
      referenceWorkflow: effectiveReferenceWorkflowValue,
      mode: workflowMode,
      planningEngine: aiEngineRef.current || undefined,
      planningModel: aiModelRef.current || undefined,
      stageSessions: stageSessionsRef.current,
      workingDirectory: values.workingDirectory,
      workspaceMode: values.workspaceMode,
      description: values.description,
      requirements: values.requirements,
      persistMode,
      specRoot,
      clarification: draftData.clarification,
      config: previewConfig,
      specCoding: {
        ...draftData.specCoding,
        persistMode,
        specRoot,
      },
      uiState: {
        formStep: 4,
        planningStage: 'idle',
        clarificationForm: clarificationForm || undefined,
        clarificationAnswers,
      },
    };
    const shouldUpdateExistingSession = Boolean(draftCreationSessionId && draftSessionCreatedInCurrentOpenRef.current);
    let data: any;
    if (shouldUpdateExistingSession) {
      data = await modalSessionJsonFetch<any>(`/api/spec-coding/sessions/${encodeURIComponent(draftCreationSessionId as string)}`, {
        method: 'PUT',
        body: JSON.stringify(sessionPayload),
      }).catch(() => null);
      if (!data?.session) {
        data = await modalSessionJsonFetch<any>('/api/spec-coding/sessions', {
          method: 'POST',
          body: JSON.stringify(sessionPayload),
        });
      }
    } else {
      data = await modalSessionJsonFetch<any>('/api/spec-coding/sessions', {
        method: 'POST',
        body: JSON.stringify(sessionPayload),
      });
    }
    if (!data?.session) {
      throw new Error(data?.error || '生成计划预览失败');
    }
    setPreviewSession(data.session);
    setDraftCreationSessionId(data.session.id);
    draftSessionCreatedInCurrentOpenRef.current = true;
    await bindDraftCreationSessionToChat(data.session);
    await appendCreationSessionTags(data.session, '计划草案已生成');
    return data.session;
  }, [appendCreationSessionTags, bindDraftCreationSessionToChat, buildPreviewConfigFromForm, clarificationAnswers, clarificationForm, draftCreationSessionId, effectiveReferenceWorkflowValue, frontendSessionId, getValues, workflowMode]);

  const updatePreviewSessionFromPlanDraft = useCallback(async (draft: PlanDraftResult, revisionSummary: string) => {
    if (!previewSession?.id) {
      throw new Error('当前没有可修订的计划预览');
    }

    const values = getValues();
    const { persistMode, specRoot } = normalizePersistSpecValues(values);
    const previewConfig = buildPreviewConfigFromForm();
    const draftData = await modalSessionJsonFetch<any>('/api/spec-coding/ai-draft', {
      method: 'POST',
      body: JSON.stringify({
        filename: values.filename,
        workflowName: values.workflowName,
        referenceWorkflow: effectiveReferenceWorkflowValue,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode,
        description: values.description,
        requirements: values.requirements,
        persistMode,
        specRoot,
        config: previewConfig,
        draft,
      }),
    });
    if (!draftData?.specCoding) {
      throw new Error(draftData?.error || '生成修订计划草案失败');
    }

    setPreviewConfigValidation(draftData.configValidation || null);
    const data = await modalSessionJsonFetch<any>(`/api/spec-coding/sessions/${encodeURIComponent(previewSession.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        chatSessionId: planningFrontendSessionId || previewSession.chatSessionId,
        homeChatSessionId: frontendSessionId || previewSession.homeChatSessionId || undefined,
        status: 'draft',
        specCodingStatus: 'draft',
        filename: values.filename,
        workflowName: values.workflowName,
        referenceWorkflow: effectiveReferenceWorkflowValue,
        mode: workflowMode,
        planningEngine: aiEngineRef.current || undefined,
        planningModel: aiModelRef.current || undefined,
        stageSessions: stageSessionsRef.current,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode,
        description: values.description,
        requirements: values.requirements,
        persistMode,
        specRoot,
        clarification: draftData.clarification,
        config: previewConfig,
        specCoding: {
          ...draftData.specCoding,
          persistMode,
          specRoot,
        },
        uiState: {
          formStep: 4,
          planningStage: 'idle',
          clarificationForm: clarificationForm || undefined,
          clarificationAnswers,
        },
        revisionSummary,
      }),
    });
    if (!data?.session) {
      throw new Error(data?.error || '保存修订计划预览失败');
    }

    setPreviewSession(data.session);
    setDraftCreationSessionId(data.session.id);
    await bindDraftCreationSessionToChat(data.session);
    await appendCreationSessionTags(data.session, '计划草案已修订');
    return data.session;
  }, [appendCreationSessionTags, bindDraftCreationSessionToChat, buildPreviewConfigFromForm, clarificationAnswers, clarificationForm, effectiveReferenceWorkflowValue, frontendSessionId, getValues, planningFrontendSessionId, previewSession, workflowMode]);

  const ensureDraftCreationSession = useCallback(async (chatSessionId?: string | null) => {
    if (draftCreationSessionId && draftSessionCreatedInCurrentOpenRef.current) return draftCreationSessionId;
    if (!chatSessionId) {
      return createInitialDraftCreationSession();
    }
    const values = getValues();
    const { persistMode, specRoot } = normalizePersistSpecValues(values);
    const config = buildPreviewConfigFromForm();
    const data = await modalSessionJsonFetch<any>('/api/spec-coding/sessions', {
      method: 'POST',
      body: JSON.stringify({
        chatSessionId: chatSessionId || undefined,
        homeChatSessionId: frontendSessionId || undefined,
        status: 'draft',
        specCodingStatus: 'draft',
        filename: values.filename,
        workflowName: values.workflowName,
        referenceWorkflow: effectiveReferenceWorkflowValue,
        mode: workflowMode,
        planningEngine: aiEngineRef.current || undefined,
        planningModel: aiModelRef.current || undefined,
        stageSessions: stageSessionsRef.current,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode,
        description: values.description,
        requirements: values.requirements,
        persistMode,
        specRoot,
        config,
        uiState: {
          formStep: 2,
          planningStage: 'clarifying',
          clarificationAnswers: {},
        },
      }),
    });
    if (!data?.session?.id) {
      throw new Error(data?.error || '创建服务端澄清会话失败');
    }
    setDraftCreationSessionId(data.session.id);
    draftSessionCreatedInCurrentOpenRef.current = true;
    await bindDraftCreationSessionToChat(data.session);
    await appendCreationSessionTags(data.session, '补充问答中');
    return data.session.id as string;
  }, [appendCreationSessionTags, bindDraftCreationSessionToChat, buildPreviewConfigFromForm, createInitialDraftCreationSession, draftCreationSessionId, effectiveReferenceWorkflowValue, frontendSessionId, getValues, workflowMode]);

  const persistDraftUiState = useCallback(async (input: {
    formStep: 2 | 3 | 4 | 5;
    planningStage: 'idle' | 'clarifying' | 'awaiting-answers' | 'generating-plan';
    clarificationForm?: ClarificationFormResult | null;
    clarificationAnswers?: Record<string, ClarificationAnswerValue>;
  }) => {
    const targetSessionId = await ensureDraftCreationSession(planningFrontendSessionId);
    await modalSessionJsonFetch(`/api/spec-coding/sessions/${encodeURIComponent(targetSessionId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        chatSessionId: planningFrontendSessionId || undefined,
        planningEngine: aiEngineRef.current || undefined,
        planningModel: aiModelRef.current || undefined,
        stageSessions: stageSessionsRef.current,
        uiState: {
          formStep: input.formStep,
          planningStage: input.planningStage,
          clarificationForm: input.clarificationForm || undefined,
          clarificationAnswers: input.clarificationAnswers || {},
        },
      }),
    }).catch(() => {});
  }, [ensureDraftCreationSession, planningFrontendSessionId]);

  useEffect(() => {
    if (!isOpen || resumeCreationSessionId || !frontendSessionId || draftCreationSessionId || draftBootstrapStartedRef.current || !specPlanningEnabled) return;
    let cancelled = false;
    draftBootstrapStartedRef.current = true;

    modalSessionJsonFetch<any>(`/api/spec-coding/sessions?chatSessionId=${encodeURIComponent(frontendSessionId)}`)
      .then(async (data) => {
        if (cancelled) return;
        const resumable = Array.isArray(data?.sessions)
          ? data.sessions.find((session: any) => (
              session?.id
              && ['draft', 'confirmed'].includes(session.status)
              && !['config-generated', 'run-bound', 'archived'].includes(session.status)
            ))
          : null;
        if (!resumable) {
          draftBootstrapStartedRef.current = false;
          await createInitialDraftCreationSession().catch(() => {
            if (!cancelled) draftBootstrapStartedRef.current = false;
          });
          return;
        }

        const detail = await modalSessionJsonFetch<any>(`/api/spec-coding/sessions/${encodeURIComponent(resumable.id)}`).catch(() => null);
        if (cancelled) return;
        if (!detail?.session) {
          draftBootstrapStartedRef.current = false;
          await createInitialDraftCreationSession().catch(() => {
            if (!cancelled) draftBootstrapStartedRef.current = false;
          });
          return;
        }
        applyRestoredSession(detail.session);
        await bindDraftCreationSessionToChat(detail.session);
      })
      .catch(() => {
        if (!cancelled) draftBootstrapStartedRef.current = false;
      });

    return () => {
      cancelled = true;
      draftBootstrapStartedRef.current = false;
    };
  }, [
    bindDraftCreationSessionToChat,
    createInitialDraftCreationSession,
    draftCreationSessionId,
    frontendSessionId,
    isOpen,
    resumeCreationSessionId,
    applyRestoredSession,
    specPlanningEnabled,
  ]);

  useEffect(() => {
    if (!isOpen || resumeCreationSessionId || !specPlanningEnabled || frontendSessionId) return;
    if (draftCreationSessionId || draftBootstrapStartedRef.current) return;
    draftBootstrapStartedRef.current = true;
    createInitialDraftCreationSession().catch(() => {
      draftBootstrapStartedRef.current = false;
    });
  }, [createInitialDraftCreationSession, draftCreationSessionId, frontendSessionId, isOpen, resumeCreationSessionId, specPlanningEnabled]);

  useEffect(() => {
    if (!isOpen || !draftCreationSessionId || restoringSessionRef.current) return;

    if (draftFieldSyncTimerRef.current) {
      clearTimeout(draftFieldSyncTimerRef.current);
    }

    draftFieldSyncTimerRef.current = setTimeout(() => {
      const values = getValues();
      const { persistMode, specRoot } = normalizePersistSpecValues(values);
      const config = buildPreviewConfigFromForm();
      void modalSessionJsonFetch(`/api/spec-coding/sessions/${encodeURIComponent(draftCreationSessionId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          chatSessionId: planningFrontendSessionId || undefined,
          homeChatSessionId: frontendSessionId || undefined,
          filename: values.filename || generateDefaultFilename(),
          workflowName: values.workflowName || '新工作流',
          referenceWorkflow: effectiveReferenceWorkflowValue,
          mode: workflowMode,
          planningEngine: aiEngineRef.current || undefined,
          planningModel: aiModelRef.current || undefined,
          stageSessions: stageSessionsRef.current,
          workingDirectory: values.workingDirectory || '',
          workspaceMode: values.workspaceMode || 'in-place',
          description: values.description,
          requirements: values.requirements,
          persistMode,
          specRoot,
          config,
          uiState: {
            formStep: formStep === 2 || formStep === 3 || formStep === 4 || formStep === 5 ? formStep : undefined,
            planningStage,
            clarificationForm: clarificationForm || undefined,
            clarificationAnswers,
          },
        }),
      }).catch(() => {});
    }, 250);

    return () => {
      if (draftFieldSyncTimerRef.current) {
        clearTimeout(draftFieldSyncTimerRef.current);
        draftFieldSyncTimerRef.current = null;
      }
    };
  }, [
    aiEngine,
    aiModel,
    buildPreviewConfigFromForm,
    clarificationAnswers,
    clarificationForm,
    descriptionValue,
    draftCreationSessionId,
    effectiveReferenceWorkflowValue,
    filenameValue,
    formStep,
    generateDefaultFilename,
    getValues,
    isOpen,
    persistModeValue,
    planningFrontendSessionId,
    planningStage,
    requirementsValue,
    specRootValue,
    workflowMode,
    workflowNameValue,
    workingDirectoryValue,
    workspaceModeValue,
    frontendSessionId,
  ]);

  const runWorkflowCreationItemStream = useCallback(async (input: {
    step: WorkflowCreationItemStep;
    stage: CreationStageKey;
    frontendSessionId: string;
    backendSessionId?: string;
    systemPrompt: string;
    message: string;
    workingDirectory?: string;
    maxAttempts?: number;
    validationContext?: WorkflowCreationItemValidationContext;
  }): Promise<{
    result: WorkflowCreationItemResult;
    finalContent: string;
    backendSessionId?: string;
  }> => {
    let activeBackendSessionId = input.backendSessionId;
    const maxAttempts = input.maxAttempts ?? MAX_CREATION_AI_REPAIR_ATTEMPTS;
    setWorkflowCreationProgressStage(input.stage);
    setWorkflowCreationActiveStep({
      stage: input.stage,
      kind: input.step.kind,
      title: input.step.title,
    });
    setWorkflowCreationRetryNotice(null);

    const runAttempt = async (message: string, attempt: number): Promise<{
      result: WorkflowCreationItemResult;
      finalContent: string;
      backendSessionId?: string;
    }> => {
      setAiPhase('streaming');
      setCurrentStream('');
      setCurrentThinking('');
      await persistStageSessionBinding(input.stage, {
        frontendSessionId: input.frontendSessionId,
        backendSessionId: activeBackendSessionId,
      });

      const startRes = await modalAuthFetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          model: aiModelRef.current,
          engine: aiEngineRef.current,
          sessionId: activeBackendSessionId || undefined,
          frontendSessionId: input.frontendSessionId,
          streamScope: PLANNING_STREAM_SCOPE,
          mode: 'dashboard',
          workingDirectory: input.workingDirectory || getValues('workingDirectory') || undefined,
          extraSystemPrompt: input.systemPrompt,
        }),
      });

      const startData = await startRes.json().catch(() => null);
      if (!startRes.ok || !startData?.chatId) {
        throw new Error([
          `启动小点「${input.step.title}」生成失败。`,
          `HTTP status=${startRes.status} ${startRes.statusText || ''}`.trim(),
          `engine=${aiEngineRef.current || '(empty)'}`,
          `model=${aiModelRef.current || '(empty)'}`,
          `frontendSessionId=${input.frontendSessionId}`,
          `backendSessionId=${activeBackendSessionId || '(new session)'}`,
          '服务端响应：',
          formatStreamPayloadPreview(startData ? JSON.stringify(startData, null, 2) : '<non-json response>'),
          '修改方式：根据上面的 HTTP 状态和服务端响应修正引擎、模型、会话或后端错误后，再重试当前小点；不要从头生成整个 workflow。',
        ].join('\n'));
      }

      const chatId = startData.chatId;
      chatIdRef.current = chatId;

      return new Promise((resolve, reject) => {
        const es = createSafeEventSource(`/api/chat/stream?id=${chatId}`);
        eventSourceRef.current = es;
        let accumulated = '';
        let thinkingAccumulated = '';

        es.addEventListener('delta', (event) => {
          try {
            const data = JSON.parse(event.data);
            accumulated += data.content || '';
            setCurrentStream(accumulated);
          } catch (error) {
            es.close();
            eventSourceRef.current = null;
            chatIdRef.current = null;
            reject(new Error([
              `小点「${input.step.title}」解析 delta 事件失败。`,
              formatErrorForRepair(error),
              '原始 delta event.data：',
              formatStreamPayloadPreview((event as MessageEvent).data),
            ].join('\n')));
          }
        });

        es.addEventListener('thinking', (event) => {
          try {
            const data = JSON.parse(event.data);
            thinkingAccumulated += data.content || '';
            setCurrentThinking(thinkingAccumulated);
          } catch (error) {
            es.close();
            eventSourceRef.current = null;
            chatIdRef.current = null;
            reject(new Error([
              `小点「${input.step.title}」解析 thinking 事件失败。`,
              formatErrorForRepair(error),
              '原始 thinking event.data：',
              formatStreamPayloadPreview((event as MessageEvent).data),
            ].join('\n')));
          }
        });

        es.addEventListener('done', async (event) => {
          try {
            const data = JSON.parse(event.data);
            es.close();
            eventSourceRef.current = null;
            chatIdRef.current = null;

            const finalContent = data.result || accumulated;
            if (hasOwnKey(data, 'sessionId')) {
              activeBackendSessionId = normalizeBackendSessionId(data.sessionId);
              setBackendSessionId(activeBackendSessionId);
              backendSessionEngineRef.current = aiEngineRef.current;
              backendSessionModelRef.current = aiModelRef.current;
            }
            await persistStageSessionBinding(input.stage, {
              frontendSessionId: input.frontendSessionId,
              backendSessionId: activeBackendSessionId,
            });

            setAiMessages((prev) => {
              const next = [...prev];
              if (thinkingAccumulated) next.push({ role: 'thinking', content: thinkingAccumulated });
              next.push({ role: 'ai', content: finalContent });
              return next;
            });
            await appendPlanningAssistantMessage(input.frontendSessionId, finalContent, activeBackendSessionId);
            setCurrentStream('');
            setCurrentThinking('');

            const extracted = extractWorkflowCreationItemResult(finalContent, input.step.kind, input.validationContext);
            if (!extracted.ok) {
              if (attempt < maxAttempts) {
                const nextAttempt = attempt + 1;
                const repairPrompt = buildWorkflowCreationItemRepairMessage(input.step, finalContent, extracted.error);
                setWorkflowCreationRetryNotice({
                  stage: input.stage,
                  kind: input.step.kind,
                  title: input.step.title,
                  attempt: nextAttempt,
                  maxAttempts,
                  reason: extracted.error,
                });
                appendRepairDiagnosticMessage({
                  stage: input.stage,
                  kind: input.step.kind,
                  title: input.step.title,
                  failedOutput: finalContent,
                  repairPrompt,
                  attempt: nextAttempt,
                  maxAttempts,
                  reason: extracted.error,
                });
                const repaired = await runAttempt(repairPrompt, nextAttempt);
                resolve(repaired);
                return;
              }
              reject(new Error(`${input.step.title} 连续 ${maxAttempts} 次后仍未返回合法结果：${extracted.error}`));
              return;
            }

            setWorkflowCreationRetryNotice(null);
            resolve({
              result: extracted.result,
              finalContent,
              backendSessionId: activeBackendSessionId,
            });
          } catch (error) {
            reject(new Error([
              `小点「${input.step.title}」处理 done 事件失败。`,
              formatErrorForRepair(error),
              '已接收正文片段：',
              formatStreamPayloadPreview(accumulated),
              '已接收 thinking 片段：',
              formatStreamPayloadPreview(thinkingAccumulated),
            ].join('\n')));
          }
        });

        es.addEventListener('error', (event) => {
          es.close();
          eventSourceRef.current = null;
          chatIdRef.current = null;
          setCurrentStream('');
          setCurrentThinking('');
          reject(new Error([
            `小点「${input.step.title}」生成流中断。`,
            `chatId=${chatId}`,
            `backendSessionId=${activeBackendSessionId || '(new session)'}`,
            `readyState=${es.readyState}`,
            'EventSource error event：',
            formatStreamPayloadPreview((event as MessageEvent).data || JSON.stringify({
              type: event.type,
              isTrusted: event.isTrusted,
            })),
            '已接收正文片段：',
            formatStreamPayloadPreview(accumulated),
            '已接收 thinking 片段：',
            formatStreamPayloadPreview(thinkingAccumulated),
            '修改方式：这不是结构化结果字段错误；应先根据连接中断信息、后端日志或引擎错误修复流式生成问题，然后重试当前小点。',
          ].join('\n')));
        });
      });
    };

    return runAttempt(input.message, 0);
  }, [appendPlanningAssistantMessage, appendRepairDiagnosticMessage, getValues, persistStageSessionBinding]);

  const generateClarificationWithChatSession = useCallback(async () => {
    const values = getValues();
    const targetFrontendSessionId = await ensurePlanningChatSession();

    interruptPlanningRun();
    setIsGeneratingPlan(true);
    setFormStep(2);
    setPlanningStage('clarifying');
    setAiPhase('streaming');
    setAiMessages([]);
    setCurrentStream('');
    setCurrentThinking('');
    setClarificationForm(null);
    setClarificationAnswers({});
    clarificationAbortRef.current = false;
    const emptyCreationState = createEmptyWorkflowCreationState();
    setWorkflowCreationProgressState(emptyCreationState);
    setWorkflowCreationProgressStage('clarification');
    setWorkflowCreationActiveStep(null);
    setWorkflowCreationRetryNotice(null);
    const activeDraftSessionId = await ensureDraftCreationSession(targetFrontendSessionId);
    await persistStageSessionBinding('clarification', {
      frontendSessionId: targetFrontendSessionId,
      backendSessionId: backendSessionId,
    });

    let activeBackendSessionId = backendSessionId;
    let creationState = emptyCreationState;
    const reqs = values.requirements || values.description || '';
    const referenceContext = values.referenceWorkflow && referenceConfig
      ? [
          `工作流模板：${values.referenceWorkflow}`,
          '模板摘要：优先参考它体现出的流程骨架、关键检查点和 Agent 协作安排。',
          '模板 YAML：',
          '```yaml',
          truncateForPrompt(referenceConfig.raw, 4000),
          '```',
        ].join('\n')
      : '';
    const baseContext = [
      `工作流名称：${values.workflowName}`,
      `目标文件：configs/${values.filename}`,
      `工作目录：${values.workingDirectory}`,
      `工作区模式：${values.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place'}`,
      `需求描述：${reqs}`,
      values.description ? `补充说明：${values.description}` : '',
      referenceContext,
      buildCreationRecommendationsPrompt(creationRecommendations),
    ].filter(Boolean).join('\n\n');
    const steps: WorkflowCreationItemStep[] = [
      {
        kind: WORKFLOW_CLARIFICATION_SUMMARY_KIND,
        name: 'current_understanding',
        title: '当前理解摘要',
        guidance: '用用户主语言概括当前目标、业务对象、预期结果和最关键的不确定性。',
      },
      {
        kind: WORKFLOW_CLARIFICATION_FACTS_KIND,
        name: 'confirmed_facts',
        title: '已确认事实',
        guidance: '列出 3-6 条已经从表单、需求、补充说明或模板中确认的信息；不要把推测写成事实。',
      },
      {
        kind: WORKFLOW_CLARIFICATION_GAPS_KIND,
        name: 'decision_gaps',
        title: '待补信息',
        guidance: '列出会影响方案、范围、兼容、验收或任务拆分的缺口；用 blocking/optional 前缀标出优先级。',
      },
      {
        kind: WORKFLOW_CLARIFICATION_QUESTION_KIND,
        name: 'target_outcome',
        title: '澄清问题：目标结果',
        guidance: '生成一个关于目标用户、成功结果或交付形态的问题。id 固定为 target_outcome，提供 2-4 个选项和默认推荐项。',
      },
      {
        kind: WORKFLOW_CLARIFICATION_QUESTION_KIND,
        name: 'scope_boundaries',
        title: '澄清问题：范围边界',
        guidance: '生成一个关于本次必须覆盖与明确排除范围的问题。id 固定为 scope_boundaries，selectionMode 优先 multiple。',
      },
      {
        kind: WORKFLOW_CLARIFICATION_QUESTION_KIND,
        name: 'failure_compatibility',
        title: '澄清问题：异常兼容',
        guidance: '生成一个关于失败路径、兼容策略、旧数据或外部依赖异常时系统行为的问题。id 固定为 failure_compatibility。',
      },
      {
        kind: WORKFLOW_CLARIFICATION_QUESTION_KIND,
        name: 'validation_evidence',
        title: '澄清问题：验证证据',
        guidance: '生成一个关于自动检查、人工验收或制品审阅证据的问题。id 固定为 validation_evidence，required 可以为 false。',
      },
    ];

    try {
      for (const step of steps) {
        const output = await runWorkflowCreationItemStream({
          step,
          stage: 'clarification',
          frontendSessionId: targetFrontendSessionId,
          backendSessionId: activeBackendSessionId,
          systemPrompt: buildWorkflowCreationItemSystemPrompt(step, baseContext),
          message: buildWorkflowCreationItemUserMessage(step, creationState),
          workingDirectory: values.workingDirectory,
        });
        activeBackendSessionId = output.backendSessionId;
        creationState = applyWorkflowCreationItem(creationState, output.result);
        setWorkflowCreationProgressState(creationState);
        const partialClarification = assembleClarificationForm(creationState);
        if (partialClarification.questions.length > 0) {
          setClarificationForm(partialClarification);
          setPlanningStage('clarifying');
          void persistDraftUiState({
            formStep: 2,
            planningStage: 'clarifying',
            clarificationForm: partialClarification,
            clarificationAnswers,
          });
        }
      }

      const clarification = assembleClarificationForm(creationState);
      if (clarification.questions.length === 0) {
        throw new Error('澄清小点已生成，但没有可展示的问题');
      }

      setAiPhase('idle');
      setIsGeneratingPlan(false);
      setPlanningStage('awaiting-answers');
      setWorkflowCreationActiveStep(null);
      setClarificationForm(clarification);
      await persistDraftUiState({
        formStep: 2,
        planningStage: 'awaiting-answers',
        clarificationForm: clarification,
        clarificationAnswers: {},
      });
      if (activeDraftSessionId) {
        await appendCreationSessionTags({
          id: activeDraftSessionId,
          chatSessionId: targetFrontendSessionId,
          workflowName: values.workflowName,
          filename: values.filename,
        }, '等待补充回答');
      }
    } catch (error) {
      setWorkflowCreationActiveStep(null);
      setAiPhase('waiting');
      setIsGeneratingPlan(false);
      if (clarificationAbortRef.current) {
        setPlanningStage('idle');
        return;
      }
      setPlanningStage('idle');
      throw error;
    }
  }, [appendCreationSessionTags, backendSessionId, clarificationAnswers, creationRecommendations, ensureDraftCreationSession, ensurePlanningChatSession, getValues, interruptPlanningRun, persistDraftUiState, persistStageSessionBinding, referenceConfig, runWorkflowCreationItemStream]);

  const generatePlanWithChatSession = useCallback(async () => {
    const values = getValues();
    const answerContext = buildClarificationAnswerContext(clarificationForm?.questions || [], clarificationAnswers);
    const targetFrontendSessionId = await ensurePlanningChatSession();

    interruptPlanningRun();
    setIsGeneratingPlan(true);
    setFormStep(3);
    setPlanningStage('generating-plan');
    setAiPhase('streaming');
    setAiMessages([]);
    setCurrentStream('');
    setCurrentThinking('');
    setWorkflowCreationProgressStage('specPlanning');
    setWorkflowCreationActiveStep(null);
    setWorkflowCreationRetryNotice(null);
    await persistDraftUiState({
      formStep: 3,
      planningStage: 'generating-plan',
      clarificationForm,
      clarificationAnswers,
    });
    await persistStageSessionBinding('specPlanning', {
      frontendSessionId: targetFrontendSessionId,
      backendSessionId: backendSessionId,
    });

    let activeBackendSessionId = backendSessionId;
    let creationState = createEmptyWorkflowCreationState();
    if (clarificationForm) {
      creationState.clarification = {
        summary: clarificationForm.summary || '',
        knownFacts: clarificationForm.knownFacts || [],
        missingFields: clarificationForm.missingFields || [],
        questions: clarificationForm.questions || [],
      };
    }
    setWorkflowCreationProgressState(creationState);

    const reqs = values.requirements || values.description || '';
    const baseContext = [
      `工作流名称：${values.workflowName}`,
      `目标文件：configs/${values.filename}`,
      `工作目录：${values.workingDirectory}`,
      `工作区模式：${values.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place'}`,
      `原始需求：${reqs}`,
      values.description ? `补充说明：${values.description}` : '',
      clarificationForm?.summary ? `澄清摘要：${clarificationForm.summary}` : '',
      answerContext ? `用户补充回答：\n${answerContext}` : '',
      buildCreationRecommendationsPrompt(creationRecommendations),
    ].filter(Boolean).join('\n\n');
    const steps: WorkflowCreationItemStep[] = [
      {
        kind: SPEC_CODING_META_KIND,
        name: 'plan_meta',
        title: '计划摘要与边界',
        guidance: '生成正式计划的 summary、goals、nonGoals、constraints，并补充 3-6 个 glossary 术语定义。内容围绕业务目标、范围边界、工作目录和验证约束。',
      },
      {
        kind: SPEC_REQUIREMENT_KIND,
        name: 'R1',
        title: '需求：核心目标',
        guidance: '生成编号为 R1 的需求，聚焦用户最核心目标和可观察成功结果。包含 userStory 和 2-4 条 acceptanceCriteria。',
      },
      {
        kind: SPEC_REQUIREMENT_KIND,
        name: 'R2',
        title: '需求：主流程与边界',
        guidance: '生成编号为 R2 的需求，聚焦主流程、输入输出、边界或非目标约束。包含 userStory 和验收标准。',
      },
      {
        kind: SPEC_REQUIREMENT_KIND,
        name: 'R3',
        title: '需求：异常与验证',
        guidance: '生成编号为 R3 的需求，聚焦失败路径、兼容策略、验证证据或交付标准。包含 userStory 和验收标准。',
      },
      {
        kind: SPEC_DESIGN_KIND,
        name: 'design_overview',
        title: '设计概览',
        guidance: '生成设计概览，包括 overview、architecture、components、interfaces、dataModels、pseudocode、keyCode、testPlan、compatibility、assumptions，可给一个简短 mermaid 流程。',
      },
      {
        kind: SPEC_DECISION_KIND,
        name: 'D1',
        title: '设计决策：流程拆分',
        guidance: '生成编号为 D1 的设计决策，说明为什么这样拆分主流程、阶段或职责。',
      },
      {
        kind: SPEC_DECISION_KIND,
        name: 'D2',
        title: '设计决策：验证与风险',
        guidance: '生成编号为 D2 的设计决策，说明验证策略、失败恢复或风险控制取舍。',
      },
      {
        kind: SPEC_TASK_KIND,
        name: 'T1.1',
        title: '任务：核心实现',
        guidance: '生成编号为 T1.1 的任务，精确绑定 R1 和相关设计决策，不要为了凑完整绑定无关 R/D；列出 actions、deliverables 和 validation。',
      },
      {
        kind: SPEC_TASK_KIND,
        name: 'T1.2',
        title: '任务：流程边界',
        guidance: '生成编号为 T1.2 的任务，精确绑定 R2 和相关设计决策，聚焦主流程、边界或集成点。',
      },
      {
        kind: SPEC_TASK_KIND,
        name: 'T2.1',
        title: '任务：异常验证',
        guidance: '生成编号为 T2.1 的任务，精确绑定 R3 和相关设计决策，聚焦异常、兼容、自动检查或人工验收证据。',
      },
      {
        kind: SPEC_TASK_KIND,
        name: 'T3.1',
        title: '任务：收口交付',
        guidance: '生成编号为 T3.1 的任务，绑定 R1/R2/R3，聚合验证结果、风险和交付说明。',
      },
    ];

    try {
      for (const step of steps) {
        const output = await runWorkflowCreationItemStream({
          step,
          stage: 'specPlanning',
          frontendSessionId: targetFrontendSessionId,
          backendSessionId: activeBackendSessionId,
          systemPrompt: buildWorkflowCreationItemSystemPrompt(step, baseContext),
          message: buildWorkflowCreationItemUserMessage(step, creationState),
          workingDirectory: values.workingDirectory,
        });
        activeBackendSessionId = output.backendSessionId;
        creationState = applyWorkflowCreationItem(creationState, output.result);
        setWorkflowCreationProgressState(creationState);
      }

      const draft = assemblePlanDraftFromItems(creationState, {
        workflowName: values.workflowName,
        filename: values.filename,
        description: values.description,
        requirements: values.requirements,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place',
        recommendedAgents: creationRecommendations?.recommendedAgents,
        recommendedSupervisorAgent: creationRecommendations?.recommendedSupervisorAgent,
      });
      await createPreviewSession(draft, targetFrontendSessionId);
      setAiPhase('idle');
      setIsGeneratingPlan(false);
      setPlanningStage('idle');
      setWorkflowCreationActiveStep(null);
      setFormStep(4);
      await persistDraftUiState({
        formStep: 4,
        planningStage: 'idle',
        clarificationForm,
        clarificationAnswers,
      });
    } catch (error) {
      setWorkflowCreationActiveStep(null);
      setAiPhase('waiting');
      setIsGeneratingPlan(false);
      setPlanningStage('awaiting-answers');
      throw error;
    }
  }, [backendSessionId, clarificationAnswers, clarificationForm, createPreviewSession, creationRecommendations, ensurePlanningChatSession, getValues, interruptPlanningRun, persistDraftUiState, persistStageSessionBinding, runWorkflowCreationItemStream]);

  const applyRecoveredPlanningOutput = useCallback(async (
    stage: CreationStageKey,
    finalContent: string,
    targetFrontendSessionId: string,
    recoveredSessionId?: string
  ) => {
    setBackendSessionId(recoveredSessionId);
    await persistStageSessionBinding(stage, {
      frontendSessionId: targetFrontendSessionId,
      backendSessionId: recoveredSessionId || null,
    });
    setAiMessages((prev) => {
      if (!finalContent) return prev;
      const last = prev[prev.length - 1];
      if (last?.role === 'ai' && last.content === finalContent) return prev;
      return [...prev, { role: 'ai', content: finalContent }];
    });
    setCurrentStream('');
    setCurrentThinking('');
    setIsGeneratingPlan(false);
    setAiPhase('waiting');
    if (stage === 'clarification') setPlanningStage('idle');
    if (stage === 'specPlanning') setPlanningStage('awaiting-answers');
    if (stage === 'workflowDraft') {
      setWorkflowDraftContinueReason('后台生成的小点已恢复到历史记录；需要重新生成 workflow 草案时会基于当前上下文装配。');
    }
  }, [persistStageSessionBinding]);

  useEffect(() => {
    if (!isOpen || !planningFrontendSessionId) return;
    if (restoredPlanningSessionRef.current === planningFrontendSessionId) return;
    let cancelled = false;

    modalSessionJsonFetch<any>(`/api/chat/sessions/${encodeURIComponent(planningFrontendSessionId)}`)
      .then(async (data) => {
        if (cancelled || !data?.session) return;
        restoredPlanningSessionRef.current = planningFrontendSessionId;
        if (data.session.backendSessionId) {
          setBackendSessionId(data.session.backendSessionId);
        }
        const restoredMessages = mapPlanningChatMessages(data.session.messages || []);
        if (restoredMessages.length > 0) {
          setAiMessages(restoredMessages);
        }
        if (!getLatestAiMessageContent(restoredMessages)) return;
        if (formStep === 2 || formStep === 3 || (formStep === 5 && aiPhase !== 'done')) {
          setAiPhase('waiting');
          setIsGeneratingPlan(false);
          if (formStep === 3) setPlanningStage('awaiting-answers');
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    aiPhase,
    formStep,
    isOpen,
    planningFrontendSessionId,
  ]);

  useEffect(() => {
    if (!isOpen || !planningFrontendSessionId || eventSourceRef.current) return;
    let cancelled = false;

    const stageKey = formStep === 5
      ? 'workflowDraft'
      : planningStage === 'generating-plan'
        ? 'specPlanning'
        : planningStage === 'clarifying'
          ? 'clarification'
          : null;
    if (!stageKey) return;

    const reconnect = async () => {
      const checkRes = await fetch(`/api/chat/stream?checkActive=${encodeURIComponent(planningFrontendSessionId)}&streamScope=${encodeURIComponent(PLANNING_STREAM_SCOPE)}`);
      const checkData = await checkRes.json().catch(() => null);
      if (cancelled || !checkData?.found || !checkData.chatId) return;
      if (reconnectingPlanningChatIdRef.current === checkData.chatId) return;

      const recoverFinalState = async (finalContent: string, recoveredSessionId?: string) => {
        await applyRecoveredPlanningOutput(stageKey, finalContent, planningFrontendSessionId, recoveredSessionId);
      };

      if (!checkData.active) {
        if (checkData.status === 'completed' && checkData.streamContent) {
          await recoverFinalState(checkData.streamContent, checkData.backendSessionId || undefined);
        } else if (checkData.status === 'failed' || checkData.status === 'killed') {
          setCurrentStream('');
          setCurrentThinking('');
          setAiPhase('waiting');
          setIsGeneratingPlan(false);
        }
        return;
      }

      reconnectingPlanningChatIdRef.current = checkData.chatId;
      chatIdRef.current = checkData.chatId;
      if (stageKey === 'clarification') {
        setFormStep(2);
        setIsGeneratingPlan(true);
        setPlanningStage('clarifying');
      } else if (stageKey === 'specPlanning') {
        setFormStep(3);
        setIsGeneratingPlan(true);
        setPlanningStage('generating-plan');
      } else {
        setFormStep(5);
      }
      setAiPhase('streaming');
      setCurrentThinking('');
      if (checkData.streamContent) {
        setCurrentStream(checkData.streamContent);
      }
      if (checkData.backendSessionId) {
        setBackendSessionId(checkData.backendSessionId);
      }

      const es = createSafeEventSource(`/api/chat/stream?id=${encodeURIComponent(checkData.chatId)}`);
      eventSourceRef.current = es;
      let accumulated = checkData.streamContent || '';
      let thinkingAccumulated = '';

      es.addEventListener('delta', (event) => {
        const data = JSON.parse(event.data);
        accumulated += data.content || '';
        setCurrentStream(accumulated);
      });

      es.addEventListener('thinking', (event) => {
        const data = JSON.parse(event.data);
        thinkingAccumulated += data.content || '';
        setCurrentThinking(thinkingAccumulated);
      });

      es.addEventListener('done', async (event) => {
        try {
          const data = JSON.parse(event.data);
          es.close();
          eventSourceRef.current = null;
          chatIdRef.current = null;
          reconnectingPlanningChatIdRef.current = null;

          const finalContent = data.result || accumulated || '';
          setAiMessages((prev) => {
            const next = [...prev];
            if (thinkingAccumulated) next.push({ role: 'thinking', content: thinkingAccumulated });
            return next;
          });
          await appendPlanningAssistantMessage(planningFrontendSessionId, finalContent, data.sessionId);
          const recoveredBackendSessionId = hasOwnKey(data, 'sessionId')
            ? normalizeBackendSessionId(data.sessionId)
            : (checkData.backendSessionId || undefined);
          await recoverFinalState(finalContent, recoveredBackendSessionId);
        } catch {
          setAiPhase('waiting');
          setIsGeneratingPlan(false);
        }
      });

      es.addEventListener('error', () => {
        es.close();
        eventSourceRef.current = null;
        chatIdRef.current = null;
        reconnectingPlanningChatIdRef.current = null;
        setCurrentStream('');
        setCurrentThinking('');
        setAiPhase('waiting');
        setIsGeneratingPlan(false);
      });
    };

    void reconnect();

    return () => {
      cancelled = true;
    };
  }, [
    appendPlanningAssistantMessage,
    applyRecoveredPlanningOutput,
    formStep,
    isOpen,
    planningFrontendSessionId,
    planningStage,
  ]);

  const confirmPreviewSession = useCallback(async (session: any) => {
    const values = getValues();
    const data = await modalSessionJsonFetch<any>(`/api/spec-coding/sessions/${encodeURIComponent(session.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        status: 'confirmed',
        specCodingStatus: 'confirmed',
        workflowName: values.workflowName,
        filename: values.filename,
        referenceWorkflow: effectiveReferenceWorkflowValue,
        planningEngine: aiEngineRef.current || undefined,
        planningModel: aiModelRef.current || undefined,
        stageSessions: stageSessionsRef.current,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode,
        description: values.description,
        requirements: values.requirements,
      }),
    });
    if (!data?.session) {
      throw new Error(data?.error || '确认计划失败');
    }
    setPreviewSession(data.session);
    return data.session;
  }, [effectiveReferenceWorkflowValue, getValues]);

  const regeneratePreviewWithRevision = useCallback(async () => {
    if (!previewSession) return;
    const trimmed = revisionNotes.trim();
    if (!trimmed) {
      toast('error', '请先填写修订说明');
      return;
    }

    const revisionTargetLabel = {
      requirements: 'requirements.md',
      design: 'design.md',
      tasks: 'tasks.md',
    }[revisionTarget];
    const revisionImpactLabel = {
      phases: '阶段拆分',
      agents: 'Agent 分工',
      checkpoints: '检查点设计',
      transitions: '状态流转',
    }[revisionImpactArea];
    const revisionSummary = `用户在确认前补充针对 ${revisionTargetLabel} 的修订要求，主要影响 ${revisionImpactLabel}：${trimmed}`;
    const values = getValues();
    const currentSpecCoding = previewSession.specCoding || {};
    const currentArtifacts = currentSpecCoding.artifacts || {};
    const targetArtifactKey: SpecCodingArtifactKey = revisionTarget;

    try {
      const targetFrontendSessionId = await ensurePlanningChatSession();
      setPlanWorkspaceOpen(true);
      setPlanWorkspaceTab('revisions');
      setIsRevisingPlan(true);
      setAiPhase('streaming');
      setCurrentStream('');
      setCurrentThinking('');
      setWorkflowCreationProgressStage('specPlanning');
      setWorkflowCreationActiveStep(null);
      setWorkflowCreationRetryNotice(null);

      let activeBackendSessionId = backendSessionId;
      let creationState = createEmptyWorkflowCreationState();
      if (clarificationForm) {
        creationState.clarification = {
          summary: clarificationForm.summary || '',
          knownFacts: clarificationForm.knownFacts || [],
          missingFields: clarificationForm.missingFields || [],
          questions: clarificationForm.questions || [],
        };
      }
      setWorkflowCreationProgressState(creationState);

      const baseContext = [
        `工作流名称：${values.workflowName}`,
        values.requirements ? `原始需求：${values.requirements}` : '',
        values.description ? `原始补充说明：${values.description}` : '',
        `修订目标：${revisionTargetLabel}`,
        `主要影响：${revisionImpactLabel}`,
        `用户修订说明：${trimmed}`,
        '',
        '当前计划摘要：',
        currentSpecCoding.summary || '无',
        '',
        '当前 goals / nonGoals / constraints：',
        '```json',
        JSON.stringify({
          goals: currentSpecCoding.goals || [],
          nonGoals: currentSpecCoding.nonGoals || [],
          constraints: currentSpecCoding.constraints || [],
        }, null, 2),
        '```',
        '',
        '当前 requirements.md：',
        '```markdown',
        truncateForPrompt(currentArtifacts.requirements, 5000),
        '```',
        '',
        '当前 design.md：',
        '```markdown',
        truncateForPrompt(currentArtifacts.design, 5000),
        '```',
        '',
        '当前 tasks.md：',
        '```markdown',
        truncateForPrompt(currentArtifacts.tasks, 5000),
        '```',
        '',
        SPEC_LANGUAGE_RULE,
      ].filter(Boolean).join('\n\n');

      const steps: WorkflowCreationItemStep[] = [
        {
          kind: SPEC_CODING_META_KIND,
          name: 'revision_meta',
          title: '修订后的计划摘要与边界',
          guidance: '根据用户修订说明重新生成 summary、goals、nonGoals、constraints 和 glossary，明确本次修订影响和不影响的范围。',
        },
        {
          kind: SPEC_REQUIREMENT_KIND,
          name: 'R1',
          title: '修订需求：核心目标',
          guidance: '生成编号为 R1 的修订后核心需求，吸收用户修订说明，保留清晰 userStory 和验收标准。',
        },
        {
          kind: SPEC_REQUIREMENT_KIND,
          name: 'R2',
          title: '修订需求：流程边界',
          guidance: '生成编号为 R2 的修订后流程/边界需求，强调修订目标会影响的入口、范围或非目标。',
        },
        {
          kind: SPEC_REQUIREMENT_KIND,
          name: 'R3',
          title: '修订需求：验证风险',
          guidance: '生成编号为 R3 的修订后异常、验证或风险需求，确保后续 tasks 有验证闭环。',
        },
        {
          kind: SPEC_DESIGN_KIND,
          name: 'revision_design',
          title: '修订后的设计概览',
          guidance: '重新生成设计概览、组件、接口、dataModels、pseudocode、keyCode、testPlan、compatibility、假设和 Mermaid。重点说明修订说明带来的设计变化。',
        },
        {
          kind: SPEC_DECISION_KIND,
          name: 'D1',
          title: '修订决策：主变化',
          guidance: '生成编号为 D1 的修订决策，说明采用该修订方案的选择和理由。',
        },
        {
          kind: SPEC_DECISION_KIND,
          name: 'D2',
          title: '修订决策：验证与风险',
          guidance: '生成编号为 D2 的修订决策，说明验证、回退、失败处理或兼容取舍。',
        },
        {
          kind: SPEC_TASK_KIND,
          name: 'T1.1',
          title: '修订任务：核心实现',
          guidance: '生成编号为 T1.1 的任务，精确绑定 R1 和相关设计决策，不要为了凑完整绑定无关 R/D；列出动作、交付物和验证。',
        },
        {
          kind: SPEC_TASK_KIND,
          name: 'T1.2',
          title: '修订任务：流程边界',
          guidance: '生成编号为 T1.2 的任务，精确绑定 R2 和相关设计决策，聚焦修订影响的流程、边界或集成点。',
        },
        {
          kind: SPEC_TASK_KIND,
          name: 'T2.1',
          title: '修订任务：验证收口',
          guidance: '生成编号为 T2.1 的任务，精确绑定 R3 和相关设计决策，聚焦自动检查、人工验收或风险验证。',
        },
        {
          kind: SPEC_TASK_KIND,
          name: 'T3.1',
          title: '修订任务：交付检查点',
          guidance: '生成编号为 T3.1 的检查点任务，聚合修订后的验证结果、风险和交付说明。',
        },
      ];

      for (const step of steps) {
        const output = await runWorkflowCreationItemStream({
          step,
          stage: 'specPlanning',
          frontendSessionId: targetFrontendSessionId,
          backendSessionId: activeBackendSessionId,
          systemPrompt: buildWorkflowCreationItemSystemPrompt(step, baseContext),
          message: buildWorkflowCreationItemUserMessage(step, creationState, revisionSummary),
          workingDirectory: values.workingDirectory,
        });
        activeBackendSessionId = output.backendSessionId;
        creationState = applyWorkflowCreationItem(creationState, output.result);
        setWorkflowCreationProgressState(creationState);
      }

      const draft = assemblePlanDraftFromItems(creationState, {
        workflowName: values.workflowName,
        filename: values.filename,
        description: values.description,
        requirements: values.requirements,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place',
        recommendedAgents: creationRecommendations?.recommendedAgents,
        recommendedSupervisorAgent: creationRecommendations?.recommendedSupervisorAgent,
      });
      await updatePreviewSessionFromPlanDraft(draft, revisionSummary);
      setRevisionNotes('');
      setSelectedArtifactKey(targetArtifactKey);
      setArtifactViewMode('preview');
      setSelectedSnapshotVersion('current');
      setPlanWorkspaceTab('artifacts');
      setAiPhase('idle');
      setWorkflowCreationActiveStep(null);
      toast('success', '已根据修订说明刷新正式计划制品');
    } catch (error: any) {
      setWorkflowCreationActiveStep(null);
      setAiPhase('waiting');
      toast('error', error?.message || '重新生成计划预览失败');
    } finally {
      setIsRevisingPlan(false);
      setCurrentStream('');
      setCurrentThinking('');
    }
  }, [backendSessionId, clarificationForm, creationRecommendations, ensurePlanningChatSession, getValues, previewSession, revisionImpactArea, revisionNotes, revisionTarget, runWorkflowCreationItemStream, toast, updatePreviewSessionFromPlanDraft]);

  const saveArtifactEdits = useCallback(async () => {
    if (!previewSession?.id || !previewSession?.specCoding) return;

    const artifactLabel = {
      requirements: 'requirements.md',
      design: 'design.md',
      tasks: 'tasks.md',
    }[selectedArtifactKey];

    const currentSpecCoding = previewSession.specCoding;
    const originalDrafts = buildArtifactDrafts(currentSpecCoding);
    const edited = artifactDrafts[selectedArtifactKey];
    const original = originalDrafts[selectedArtifactKey];

    if (edited === original) {
      toast('warning', '当前制品没有变更');
      return;
    }

    const nextSpecCoding = {
      ...currentSpecCoding,
      artifacts: {
        ...currentSpecCoding.artifacts,
        requirements: artifactDrafts.requirements,
        design: artifactDrafts.design,
        tasks: artifactDrafts.tasks,
      },
    };

    try {
      setSavingArtifact(true);
      const data = await modalSessionJsonFetch<any>(`/api/spec-coding/sessions/${encodeURIComponent(previewSession.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          planningEngine: aiEngineRef.current || undefined,
          planningModel: aiModelRef.current || undefined,
          stageSessions: stageSessionsRef.current,
          specCoding: nextSpecCoding,
          specCodingStatus: currentSpecCoding.status || 'draft',
          revisionSummary: `用户直接编辑 ${artifactLabel}，并在确认前保存制品级修订。`,
        }),
      });
      if (!data?.session) {
        throw new Error(data?.error || '保存计划制品编辑失败');
      }
      setPreviewSession(data.session);
      setArtifactDrafts(buildArtifactDrafts(data.session.specCoding));
      setArtifactViewMode('preview');
      toast('success', `${artifactLabel} 已保存到创建态计划`);
    } catch (error: any) {
      toast('error', error?.message || '保存计划制品编辑失败');
    } finally {
      setSavingArtifact(false);
    }
  }, [artifactDrafts, previewSession, selectedArtifactKey, toast]);

  const startAiStream = useCallback(async (sourceSession?: any, instruction?: string) => {
    const values = getValues();
    const filename = (values.filename || '').trim();
    const reqs = values.requirements || values.description || '';
    const activePreviewSession = sourceSession || previewSession;
    const specCoding = activePreviewSession?.specCoding || {};
    const hasConfirmedSpecCoding = Boolean(specPlanningEnabled && specCoding?.id);
    const artifacts = specCoding.artifacts || {};
    const targetFrontendSessionId = await ensurePlanningChatSession();

    interruptPlanningRun();
    setFormStep(5);
    setAiFilename('');
    setAiMessages([]);
    setCurrentStream('');
    setCurrentThinking('');
    setWorkflowDraftConfig(null);
    setWorkflowDraftValidation(null);
    setWorkflowDraftPreview(null);
    setWorkflowDraftContinueReason('');
    setBackendSessionId(undefined);
    setAiPhase('streaming');
    setWorkflowCreationProgressStage('workflowDraft');
    setWorkflowCreationActiveStep(null);
    setWorkflowCreationRetryNotice(null);
    await persistStageSessionBinding('workflowDraft', {
      frontendSessionId: targetFrontendSessionId,
      backendSessionId,
    });

    let activeBackendSessionId = backendSessionId;
    let creationState = createEmptyWorkflowCreationState();
    creationState.spec.summary = specCoding.summary || activePreviewSession?.workflowDraftSummary?.summary || '';
    creationState.spec.goals = Array.isArray(specCoding.goals) ? specCoding.goals : [];
    creationState.spec.nonGoals = Array.isArray(specCoding.nonGoals) ? specCoding.nonGoals : [];
    creationState.spec.constraints = Array.isArray(specCoding.constraints) ? specCoding.constraints : [];
    setWorkflowCreationProgressState(creationState);

    const referenceContext = values.referenceWorkflow && referenceConfig
      ? [
          `工作流模板：${values.referenceWorkflow}`,
          '优先参考模板体现出的状态/阶段顺序、关键检查点、Agent 协作和失败处理；当前需求明确冲突时再调整。',
          '模板 YAML：',
          '```yaml',
          truncateForPrompt(referenceConfig.raw, 8000),
          '```',
        ].join('\n')
      : '';
    const specContext = specCoding?.id
      ? [
          '已确认 SpecCoding：',
          `- ID: ${specCoding.id}`,
          `- 摘要: ${specCoding.summary || '无'}`,
          `- Goals: ${(specCoding.goals || []).join('；') || '无'}`,
          `- NonGoals: ${(specCoding.nonGoals || []).join('；') || '无'}`,
          `- Constraints: ${(specCoding.constraints || []).join('；') || '无'}`,
          '',
          'Spec 结构化任务：',
          '```json',
          JSON.stringify({
            phases: specCoding.phases || [],
            assignments: specCoding.assignments || [],
            checkpoints: specCoding.checkpoints || [],
            tasks: specCoding.tasks || [],
            workflowDraftSummary: activePreviewSession?.workflowDraftSummary || null,
          }, null, 2),
          '```',
          '',
          'requirements.md：',
          '```markdown',
          truncateForPrompt(artifacts.requirements, 6000),
          '```',
          '',
          'design.md：',
          '```markdown',
          truncateForPrompt(artifacts.design, 6000),
          '```',
          '',
          'tasks.md：',
          '```markdown',
          truncateForPrompt(artifacts.tasks, 6000),
          '```',
        ].join('\n')
      : '';
    const baseContext = [
      `目标文件：configs/${filename}`,
      `工作流名称：${values.workflowName}`,
      `工作目录：${values.workingDirectory}`,
      `工作区模式：${values.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place'}`,
      `需求描述：${reqs}`,
      values.description ? `补充说明：${values.description}` : '',
      !hasConfirmedSpecCoding
        ? '创建模式：跳过 Spec，直接根据上面的需求内容编排可执行 workflow。不要创建“生成/修订 Spec”的工作流，除非用户需求本身就是管理 Spec。'
        : '',
      instruction ? `用户本轮补充或修复要求：\n${instruction}` : '',
      referenceContext,
      specContext,
      buildCreationRecommendationsPrompt(creationRecommendations),
      '',
      'Workflow 装配规则：状态按主要执行顺序组织；如果审查、返工、失败恢复或提前收口需要不同目标，请在 transitions 中明确 pass / conditional_pass / fail 的目标状态。并发只允许出现在同一个状态的 steps 内，用相同 parallelGroup 表达。',
      `Supervisor "${creationRecommendations?.recommendedSupervisorAgent || recommendedSupervisorAgent}" 只用于 workflow.supervisor 的调度、审阅和检查点建议，不作为任何 state.steps 或 phase.steps 的执行 agent；步骤 agent 必须选择普通执行角色。`,
      '每个非终态状态都应该有 1-4 个步骤；如果需要红蓝审查或多角色协作，把这些并行或协作步骤放在同一个状态中。',
      hasConfirmedSpecCoding
        ? '如果提供了 SpecCoding 任务，specTaskBinding.taskIds 必须优先使用当前 tasks 中真实存在的叶子任务 id。'
        : '当前没有 SpecCoding 任务；不要输出 specTaskBinding，不要把状态或步骤设计成创建 Spec 文档。',
    ].filter(Boolean).join('\n\n');

    try {
      const outlineStep: WorkflowCreationItemStep = {
        kind: WORKFLOW_STATE_OUTLINE_KIND,
        name: 'state_outline',
        title: 'Workflow 状态轮廓',
        guidance: '生成 3-5 个按主要执行顺序组织的状态。第一个状态是初始状态，最后一个状态标记 isFinal=true。状态名短、稳定、适合状态图展示；如果流程需要返工、审查分支或失败恢复，可在非终态状态上补 transitions，使用 condition.verdict=pass/conditional_pass/fail 指向目标状态。',
      };
      const outlineOutput = await runWorkflowCreationItemStream({
        step: outlineStep,
        stage: 'workflowDraft',
        frontendSessionId: targetFrontendSessionId,
        backendSessionId: activeBackendSessionId,
        systemPrompt: buildWorkflowCreationItemSystemPrompt(outlineStep, baseContext),
        message: buildWorkflowCreationItemUserMessage(outlineStep, creationState),
        workingDirectory: values.workingDirectory,
      });
      activeBackendSessionId = outlineOutput.backendSessionId;
      creationState = applyWorkflowCreationItem(creationState, outlineOutput.result);
      setWorkflowCreationProgressState(creationState);

      const statesNeedingSteps = creationState.workflow.outline.filter((state) => !state.isFinal);
      for (const outlineState of statesNeedingSteps) {
        const step: WorkflowCreationItemStep = {
          kind: WORKFLOW_STATE_STEPS_KIND,
          name: outlineState.name,
          title: `状态步骤：${outlineState.name}`,
          guidance: [
            `只为状态 "${outlineState.name}" 生成 steps。data.stateName 必须完全等于 "${outlineState.name}"。`,
            '每个步骤包含 name、agent、task；如果需要并发，只能给同一状态内的多个步骤设置相同 parallelGroup。',
            '不要描述跨状态并发，不要创建下一状态的步骤；但可以在 data.transitions 中补充当前状态的 pass/conditional_pass/fail 流转目标。',
            hasConfirmedSpecCoding
              ? '必须给每个步骤补上 specTaskBinding.taskIds、requirementIds、artifactKeys，只能引用当前 SpecCoding tasks 中真实存在的叶子任务。'
              : '不要输出 specTaskBinding、taskIds、requirementIds 或 artifactKeys；步骤 task 必须直接围绕用户需求本身，不要创建“生成/修订 Spec”的步骤。',
          ].join('\n'),
        };
        const output = await runWorkflowCreationItemStream({
          step,
          stage: 'workflowDraft',
          frontendSessionId: targetFrontendSessionId,
          backendSessionId: activeBackendSessionId,
          systemPrompt: buildWorkflowCreationItemSystemPrompt(step, baseContext),
          message: buildWorkflowCreationItemUserMessage(step, creationState),
          workingDirectory: values.workingDirectory,
          validationContext: buildWorkflowCreationValidationContext(
            step,
            creationRecommendations,
            recommendedSupervisorAgent,
          ),
        });
        activeBackendSessionId = output.backendSessionId;
        creationState = applyWorkflowCreationItem(creationState, output.result);
        setWorkflowCreationProgressState(creationState);
        const partialConfig = assembleWorkflowConfigFromItems(creationState, {
          workflowName: values.workflowName,
          filename,
          description: values.description,
          requirements: values.requirements,
          workingDirectory: values.workingDirectory,
          workspaceMode: values.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place',
          recommendedAgents: creationRecommendations?.recommendedAgents,
          recommendedSupervisorAgent: creationRecommendations?.recommendedSupervisorAgent,
          specCoding: hasConfirmedSpecCoding ? specCoding : undefined,
          includeSpecTaskBindings: hasConfirmedSpecCoding,
        });
        setWorkflowDraftConfig(partialConfig);
        setWorkflowDraftPreview({
          source: 'result-json',
          filename,
          config: partialConfig,
          yaml: stringifyYaml(partialConfig),
          validation: null,
        });
      }

      const config = assembleWorkflowConfigFromItems(creationState, {
        workflowName: values.workflowName,
        filename,
        description: values.description,
        requirements: values.requirements,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place',
        recommendedAgents: creationRecommendations?.recommendedAgents,
        recommendedSupervisorAgent: creationRecommendations?.recommendedSupervisorAgent,
        specCoding: hasConfirmedSpecCoding ? specCoding : undefined,
        includeSpecTaskBindings: hasConfirmedSpecCoding,
      });
      const validation = await validateWorkflowDraftConfig(config);
      const normalizedConfig = validation?.normalized || config;
      setWorkflowDraftConfig(validation?.ok ? normalizedConfig : null);
      setWorkflowDraftValidation(validation);
      setWorkflowDraftPreview({
        source: 'result-json',
        filename,
        config: normalizedConfig,
        yaml: stringifyYaml(normalizedConfig),
        validation,
      });
      setAiPhase('waiting');
      setWorkflowDraftContinueReason(validation?.ok ? '' : formatValidationIssuesForPrompt(validation));
      setWorkflowCreationActiveStep(null);
      setAiMessages((prev) => [...prev, {
        role: 'ai',
        content: validation?.ok
          ? `工作流草案已装配并通过系统校验。确认后会保存 configs/${filename}。`
          : `工作流草案已装配，但系统校验未通过：\n${formatValidationIssuesForPrompt(validation)}`,
      }]);
    } catch (error: any) {
      setWorkflowCreationActiveStep(null);
      setAiPhase('waiting');
      setWorkflowDraftContinueReason(error?.message || '工作流草案生成失败');
      setAiMessages((prev) => [...prev, {
        role: 'ai',
        content: `工作流草案生成失败：${error?.message || '未知错误'}`,
      }]);
      toast('error', error?.message || '工作流草案生成失败');
    } finally {
      setIsGeneratingPlan(false);
      setCurrentStream('');
      setCurrentThinking('');
    }
  }, [backendSessionId, creationRecommendations, ensurePlanningChatSession, getValues, interruptPlanningRun, persistStageSessionBinding, previewSession, recommendedSupervisorAgent, referenceConfig, runWorkflowCreationItemStream, specPlanningEnabled, toast, validateWorkflowDraftConfig]);

  // Re-trigger AI stream after engine/model change
  useEffect(() => {
    if (aiRestartFlag > 0 && formStep === 5) {
      startAiStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRestartFlag]);

  // Handle "下一步": validate form then enter plan preview
  const handleNextStep = async () => {
    const draft = getValues();
    const normalizedDraft = normalizeNewConfigFormValues({
      filename: draft.filename,
      workflowName: draft.workflowName,
      referenceWorkflow: draft.referenceWorkflow,
      workingDirectory: draft.workingDirectory,
      workspaceMode: draft.workspaceMode,
      description: draft.description,
      requirements: draft.requirements,
      persistMode: draft.persistMode,
      specRoot: draft.specRoot,
    }, workflowMode);
    const validation = newConfigFormSchema.safeParse(normalizedDraft);
    if (!validation.success) {
      applySchemaIssues(validation.error.issues as any);
      return;
    }

    try {
      if (specPlanningEnabled) {
        await validatePersistedSpecSelection(validation.data);
      }
    } catch {
      return;
    }

    const reqs = getValues('requirements') || '';
    if (reqs.trim().length < 5) {
      toast('error', '请提供需求描述（至少5个字符）');
      return;
    }

    if (workflowMode !== 'ai-guided') {
      await onSubmit(validation.data as NewConfigForm);
      return;
    }

    try {
      if (!specPlanningEnabled) {
        setFormStep(5);
        setPreviewSession(null);
        setDraftCreationSessionId(null);
        setAiMessages([]);
        setCurrentStream('');
        setCurrentThinking('');
        setAiPhase('streaming');
        setAiFilename('');
        setWorkflowDraftConfig(null);
        setWorkflowDraftValidation(null);
        setWorkflowDraftPreview(null);
        setBackendSessionId(undefined);
        await startAiStream(null);
        return;
      }
      if (previewSession) {
        const resolvedStep = resolveFormStepFromSession(previewSession);
        if (resolvedStep >= 4) {
          setFormStep(4);
          return;
        }
        // spec not fully generated — restart from clarification
      }
      await generateClarificationWithChatSession();
    } catch (error: any) {
      toast('error', error?.message || '生成澄清问题失败');
    }
  };

  const handleSubmitClarificationAnswers = async () => {
    const questions = clarificationForm?.questions || [];
    if (questions.length === 0) {
      toast('warning', '至少等 AI 生成一个问题后再继续');
      return;
    }
    if (isGeneratingPlan || planningStage === 'clarifying') {
      toast('warning', 'AI 还在生成完整问题，请等出题完成后再提交回答');
      return;
    }
    if (planningStage !== 'awaiting-answers') {
      toast('warning', '当前补充问答还没有生成完成，请重新提问并等待 AI 完成出题');
      return;
    }
    const missingRequired = questions.find((item) => {
      if (item.required === false) return false;
      const answer = clarificationAnswers[item.id];
      return (!answer?.optionIds?.length) && !answer?.note.trim();
    });
    if (missingRequired) {
      toast('error', `请先填写「${missingRequired.label}」`);
      return;
    }

    await persistDraftUiState({
      formStep: 2,
      planningStage: 'awaiting-answers',
      clarificationForm,
      clarificationAnswers,
    });
    if (draftCreationSessionId || previewSession?.id) {
      await appendCreationSessionTags({
        id: draftCreationSessionId || previewSession?.id,
        chatSessionId: planningFrontendSessionId,
        workflowName: getValues('workflowName'),
        filename: getValues('filename'),
      }, '计划生成中');
    }

    try {
      await generatePlanWithChatSession();
    } catch (error: any) {
      toast('error', error?.message || '生成计划预览失败');
    }
  };

  const handleConfirmPreview = async () => {
    if (isRevisingPlan) {
      toast('warning', '计划修订仍在生成中，请等待正式计划制品刷新完成后再进入下一步');
      return;
    }
	    try {
	      const session = previewSession || await createPreviewSession();
	      const confirmedSession = await confirmPreviewSession(session);
	      const values = getValues();
	      if (workflowMode === 'ai-guided') {
	        setFormStep(5);
	        setAiMessages([]);
	        setCurrentStream('');
	        setCurrentThinking('');
	        setAiPhase('streaming');
	        setAiFilename('');
	        setWorkflowDraftConfig(null);
	        setWorkflowDraftValidation(null);
	        setWorkflowDraftPreview(null);
	        setBackendSessionId(undefined);
	        await persistDraftUiState({
	          formStep: 5,
	          planningStage: 'idle',
	          clarificationForm,
	          clarificationAnswers,
	        });
	        await startAiStream(confirmedSession);
	        return;
	      }
      await onSubmit({
        ...values,
        mode: workflowMode,
      } as NewConfigForm);
    } catch (error: any) {
      toast('error', error?.message || '确认计划失败');
    }
  };

  const createWorkflowFromValidatedDraft = useCallback(async () => {
    const values = getValues();
    const filename = (values.filename || '').trim();
    if (!filename) {
      toast('error', '缺少工作流文件名');
      return false;
    }

    const existing = await checkExistingWorkflowFile(filename);
    if (existing.ok) {
      setAiFilename(filename);
      setWorkflowDraftConfig(existing.config);
      setWorkflowDraftValidation(existing.validation);
      setWorkflowDraftPreview({
        source: 'yaml',
        filename,
        config: existing.config,
        yaml: stringifyYaml(existing.config),
        validation: existing.validation,
      });
      setAiPhase('done');
      setAiMessages((prev) => [...prev, {
        role: 'ai',
        content: `工作流配置 configs/${filename} 已存在且系统校验通过。是否打开工作流设计页面？`,
      }]);
      toast('success', '系统已确认配置文件存在且校验通过');
      return true;
    }

    const draftConfigToSave = resolveValidatedWorkflowDraftConfig({
      workflowDraftConfig,
      workflowDraftValidation,
      workflowDraftPreview,
    });
    if (!draftConfigToSave) {
      toast('warning', '当前还没有已校验通过的 workflow 草案，请等待生成完成或查看校验信息。');
      return true;
    }

    const validation = await validateWorkflowDraftConfig(draftConfigToSave);
    setWorkflowDraftValidation(validation);
    setWorkflowDraftPreview((prev) => ({
      ...(prev || { source: 'result-json' as const, filename }),
      filename,
      config: validation?.normalized || draftConfigToSave,
      yaml: stringifyYaml(validation?.normalized || draftConfigToSave),
      validation,
    }));
    if (!validation?.ok) {
      setWorkflowDraftContinueReason(formatValidationIssuesForPrompt(validation));
      toast('error', 'workflow 草案校验未通过，请查看校验信息并重新生成草案。');
      return true;
    }

    setIsSavingWorkflowDraft(true);
    try {
      const response = await modalAuthFetch('/api/configs/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...values,
          mode: workflowMode,
          frontendSessionId: planningFrontendSessionId || frontendSessionId,
          creationSessionId: specPlanningEnabled ? previewSession?.id : undefined,
          skipSpecCoding: !specPlanningEnabled,
          configDraft: validation.normalized || draftConfigToSave,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const details = Array.isArray(result?.details?.issues)
          ? result.details.issues
          : Array.isArray(result?.details)
            ? result.details
            : [];
        const message = details.length
          ? details.map((issue: any) => `${issue.path?.join('.') || '(root)'}: ${issue.message}`).join('\n')
          : result?.message || result?.error || '保存 workflow 草案失败';
        const retryExisting = await checkExistingWorkflowFile(filename);
        if (retryExisting.ok) {
          setAiFilename(filename);
          setWorkflowDraftConfig(retryExisting.config);
          setWorkflowDraftValidation(retryExisting.validation);
          setWorkflowDraftPreview({
            source: 'yaml',
            filename,
            config: retryExisting.config,
            yaml: stringifyYaml(retryExisting.config),
            validation: retryExisting.validation,
          });
          setAiPhase('done');
          setAiMessages((prev) => [...prev, {
            role: 'ai',
            content: `工作流配置 configs/${filename} 已存在且系统校验通过。是否打开工作流设计页面？`,
          }]);
          toast('success', '系统已确认配置文件存在且校验通过');
          return true;
        }
        const bindingErrors = Array.isArray(result?.bindingValidation?.errors)
          ? result.bindingValidation.errors
          : [];
        throw Object.assign(new Error(message), {
          validation: bindingErrors.length > 0
            ? {
                ok: false,
                issues: bindingErrors.map((bindingError: string) => ({
                  severity: 'error',
                  path: ['workflow', 'steps', 'specTaskBinding'],
                  message: bindingError,
                })),
              }
            : undefined,
        });
      }

      const createdFilename = result?.filename || filename;
      if (result?.creationSession) {
        setPreviewSession(result.creationSession);
        setDraftCreationSessionId(result.creationSession.id);
        await bindDraftCreationSessionToChat(result.creationSession).catch(() => {});
        await appendCreationSessionTags(result.creationSession, '配置已生成');
      }
      setAiFilename(createdFilename);
      setWorkflowDraftConfig(validation.normalized || draftConfigToSave);
      setWorkflowDraftValidation(validation);
      setWorkflowDraftPreview((prev) => ({
        ...(prev || { source: 'result-json' as const }),
        filename: createdFilename,
        config: validation.normalized || draftConfigToSave,
        yaml: stringifyYaml(validation.normalized || draftConfigToSave),
        validation,
      }));
      setAiPhase('done');
      setAiMessages((prev) => [...prev, {
        role: 'ai',
        content: `工作流配置 configs/${createdFilename} 已创建并通过系统校验。是否打开工作流设计页面？`,
      }]);
      toast('success', '工作流配置已创建并通过校验');
      return true;
    } catch (error: any) {
      const errorMsg = error?.message || '保存 workflow 草案失败';
      if (error?.validation) {
        setWorkflowDraftContinueReason(formatValidationIssuesForPrompt(error.validation));
      } else {
        setWorkflowDraftContinueReason(errorMsg);
      }
      setAiMessages(prev => [...prev, {
        role: 'ai',
        content: `创建失败：${errorMsg}\n请检查错误信息后重新生成草案。`,
      }]);
      toast('error', errorMsg);
      return true;
    } finally {
      setIsSavingWorkflowDraft(false);
    }
  }, [
    appendCreationSessionTags,
    bindDraftCreationSessionToChat,
    checkExistingWorkflowFile,
    frontendSessionId,
    getValues,
    planningFrontendSessionId,
    previewSession,
    specPlanningEnabled,
    toast,
    validateWorkflowDraftConfig,
    workflowDraftConfig,
    workflowDraftPreview,
    workflowDraftValidation,
    workflowMode,
  ]);

  const handleQuickConfirm = async () => {
    await createWorkflowFromValidatedDraft();
  };

  const stopWorkflowDraftGeneration = () => {
    cleanupStream();
    setAiPhase('waiting');
    setIsGeneratingPlan(false);
    setWorkflowCreationActiveStep(null);
    if (currentThinking) {
      setAiMessages(prev => [...prev, { role: 'thinking', content: currentThinking }]);
    }
    if (currentStream) {
      setAiMessages(prev => [...prev, { role: 'ai', content: currentStream }]);
    }
    setCurrentThinking('');
    setCurrentStream('');
  };

  const onSubmit = async (data: NewConfigForm) => {
    // AI-guided mode uses preview + AI flow, not direct submit
    if (workflowMode === 'ai-guided') return;
    const normalizedData = normalizeNewConfigFormValues(data, workflowMode);
    const validation = newConfigFormSchema.safeParse(normalizedData);
    if (!validation.success) {
      applySchemaIssues(validation.error.issues as any);
      return;
    }
    const values = validation.data;

    try {
      if (specPlanningEnabled) {
        await validatePersistedSpecSelection(values);
      }
    } catch {
      return;
    }

    try {
      const response = await modalAuthFetch('/api/configs/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...values,
          frontendSessionId: planningFrontendSessionId || frontendSessionId,
          creationSessionId: specPlanningEnabled ? (previewSession?.id || draftCreationSessionId || undefined) : undefined,
          skipSpecCoding: !specPlanningEnabled,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        const details = Array.isArray(result.details)
          ? result.details
          : Array.isArray(result.details?.issues)
            ? result.details.issues
            : [];
        if (details.length > 0) {
          for (const issue of details) {
            const field = issue?.path?.[0];
            if (typeof field === 'string' && ['filename', 'workflowName', 'referenceWorkflow', 'workingDirectory', 'workspaceMode', 'description', 'requirements', 'mode', 'persistMode', 'specRoot'].includes(field)) {
              setError(field as keyof NewConfigForm, { type: 'server', message: issue.message });
            }
          }
          toast('error', '表单验证失败:\n' + details.map((e: any) => e?.message || '未知校验错误').join('\n'));
        } else {
          toast('error', result.message || result.error);
        }
        return;
      }
      toast('success', result.message || '配置文件已创建');
      if (result.creationSession) {
        await bindDraftCreationSessionToChat(result.creationSession).catch(() => {});
        await appendCreationSessionTags(result.creationSession, '配置已生成');
      }
      reset();
      onSuccess(values.filename, { creationSession: result.creationSession });
      onClose();
    } catch (error: any) {
      toast('error', '创建失败: ' + error.message);
    }
  };

  const onInvalid = (formErrors: FieldErrors<NewConfigForm>) => {
    const messages = [
      formErrors.filename?.message,
      formErrors.workflowName?.message,
      formErrors.referenceWorkflow?.message,
      formErrors.workingDirectory?.message,
      formErrors.workspaceMode?.message,
      formErrors.persistMode?.message,
      formErrors.specRoot?.message,
      formErrors.description?.message,
      formErrors.requirements?.message,
    ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    if (messages.length > 0) {
      toast('error', messages.join('\n'));
      return;
    }
    toast('error', '请先修正表单中的错误项');
  };

  const handleClose = () => {
    const isStreaming = aiPhase === 'streaming';
    if (formStep === 2 || formStep === 3 || formStep === 4 || formStep === 5 || isStreaming) {
      void persistDraftUiState({
        formStep: (formStep === 2 || formStep === 3 || formStep === 4 || formStep === 5) ? formStep : 2 as 2,
        planningStage,
        clarificationForm,
        clarificationAnswers,
      });
    }
    if (isStreaming) {
      detachStreamSubscription();
      toast('info', '生成仍在后台运行中，可稍后从草稿箱继续');
    }
    onClose();
  };

  useEffect(() => {
    return () => {
      detachStreamSubscription();
      if (draftFieldSyncTimerRef.current) {
        clearTimeout(draftFieldSyncTimerRef.current);
      }
      if (restoreGuardTimerRef.current) {
        clearTimeout(restoreGuardTimerRef.current);
      }
    };
  }, [detachStreamSubscription]);

  useEffect(() => {
    if (!isOpen || !clarificationForm || formStep !== 2) return;
    void persistDraftUiState({
      formStep: 2,
      planningStage,
      clarificationForm,
      clarificationAnswers,
    });
  }, [clarificationAnswers, clarificationForm, formStep, isOpen, persistDraftUiState, planningStage]);

  const handleBackToStep1 = () => {
    cleanupStream();
    // Only stop active streaming, keep conversation history and form data
    if (aiPhase === 'streaming') {
      if (currentThinking) {
        setAiMessages(prev => [...prev, { role: 'thinking', content: currentThinking }]);
      }
      if (currentStream) {
        setAiMessages(prev => [...prev, { role: 'ai', content: currentStream }]);
      }
      setCurrentStream('');
      setCurrentThinking('');
    }
    setAiPhase('idle');
    setFormStep(4);
  };

  const createCreationSessionForExistingConfig = useCallback(async (filename: string) => {
    const configResponse = await modalAuthFetch(`/api/configs/${encodeURIComponent(filename)}`);
    if (!configResponse.ok) {
      throw new Error('读取已生成工作流配置失败');
    }
    const configResult = await configResponse.json();
    const values = getValues();
    const { persistMode, specRoot } = normalizePersistSpecValues(values);
    const targetSessionId = previewSession?.id;
    const sessionResponse = await modalAuthFetch(targetSessionId
      ? `/api/spec-coding/sessions/${encodeURIComponent(targetSessionId)}`
      : '/api/spec-coding/sessions', {
      method: targetSessionId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatSessionId: planningFrontendSessionId || previewSession?.chatSessionId || undefined,
        homeChatSessionId: frontendSessionId || previewSession?.homeChatSessionId || undefined,
        status: 'config-generated',
        specCodingStatus: 'confirmed',
        filename,
        workflowName: values.workflowName,
        referenceWorkflow: effectiveReferenceWorkflowValue,
        mode: workflowMode,
        planningEngine: aiEngineRef.current || undefined,
        planningModel: aiModelRef.current || undefined,
        stageSessions: stageSessionsRef.current,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode,
        description: values.description,
        requirements: values.requirements,
        persistMode,
        specRoot,
        config: configResult.config,
        rebuildSpecCodingFromConfig: true,
      }),
    });
    if (!sessionResponse.ok) {
      const data = await sessionResponse.json().catch(() => null);
      throw new Error(data?.error || '创建创建态会话失败');
    }
    const sessionResult = await sessionResponse.json();
    if (sessionResult?.session?.specCoding) {
      await bindDraftCreationSessionToChat(sessionResult.session).catch(() => {});
      await appendCreationSessionTags(sessionResult.session, '配置已生成');
    }
    setPreviewSession(sessionResult.session);
    return sessionResult.session;
  }, [appendCreationSessionTags, bindDraftCreationSessionToChat, effectiveReferenceWorkflowValue, frontendSessionId, getValues, planningFrontendSessionId, previewSession, workflowMode]);

  const handleAiComplete = async () => {
    const filename = aiFilename;
    let creationSession: any;
    const workflowName = getValues('workflowName') || '新工作流';
    if (filename && specPlanningEnabled) {
      try {
        creationSession = await createCreationSessionForExistingConfig(filename);
      } catch (error: any) {
        toast('error', error?.message || '创建态会话回写失败');
      }
    }
    resetAll();
    reset();
    onSuccess(filename, creationSession ? { creationSession } : undefined);
    onClose();
  };

  const normalizeFilenameField = () => {
    const raw = (getValues('filename') || '').trim();
    if (!raw) return;

    let normalized = raw;
    if (/\.yml$/i.test(normalized)) {
      normalized = normalized.replace(/\.yml$/i, '.yaml');
    } else if (!/\.yaml$/i.test(normalized)) {
      normalized = `${normalized}.yaml`;
    }

    if (normalized !== getValues('filename')) {
      setValue('filename', normalized, { shouldDirty: true, shouldValidate: true });
    }
  };

  // PLACEHOLDER_RENDER_AI_VIEW

  const canSubmitClarificationAnswers = Boolean(clarificationForm?.questions?.length)
    && planningStage === 'awaiting-answers'
    && !isGeneratingPlan;
  const shouldShowClarificationGenerationStatus = Boolean(clarificationForm)
    && (isGeneratingPlan || Boolean(currentThinking) || Boolean(currentStream) || Boolean(workflowCreationRetryNotice));
  const validatedWorkflowDraftConfig = resolveValidatedWorkflowDraftConfig({
    workflowDraftConfig,
    workflowDraftValidation,
    workflowDraftPreview,
  });
  const canConfirmWorkflowDraft = Boolean(validatedWorkflowDraftConfig)
    && !aiFilename
    && aiPhase === 'waiting'
    && !isSavingWorkflowDraft;

  const creationEngineControls = (
    <EngineModelSelect
      engine={aiEngine}
      model={aiModel}
      onEngineChange={handleAiEngineChange}
      onModelChange={handleAiModelChange}
      className="w-56"
    />
  );

  const renderCreationContextPanel = (showClarification = false) => (
    <PlanningContextSnapshot
      workflowName={workflowNameValue}
      filename={filenameValue}
      workingDirectory={workingDirectoryValue}
      workspaceMode={workspaceModeValue}
      referenceWorkflow={effectiveReferenceWorkflowValue}
      description={descriptionValue}
      requirements={requirementsValue}
      clarificationForm={clarificationForm}
      clarificationAnswers={clarificationAnswers}
      showClarification={showClarification}
    />
  );

  const renderCreationActivityPanel = ({
    showUserMessages = false,
    title,
    description,
    isStreaming,
    emptyLabel,
  }: {
    showUserMessages?: boolean;
    title: string;
    description: string;
    isStreaming: boolean;
    emptyLabel: string;
  }) => (
    <div className="space-y-4 pb-12">
      {renderModalHistorySection({
        showUserMessages,
        tailContent: (
          <>
            {currentThinking || currentStream || isStreaming ? (
              <ModalAiGenerationPanel
                content={joinModalAiProcessContent(currentThinking, currentStream)}
                isStreaming={isStreaming}
                title={title}
                description={description}
                className="border-blue-500/20 bg-blue-500/5"
              />
            ) : null}
            {!aiMessages.length && !currentThinking && !currentStream && !isStreaming ? (
              <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
                {emptyLabel}
              </div>
            ) : null}
          </>
        ),
      })}
      <PlanningScrollToBottomButton show={showStreamScrollBtn} onClick={scrollPlanningStreamToBottom} />
    </div>
  );

  const renderClarificationResultPanel = () => {
    if (!clarificationForm) {
      return (
        <div className="flex min-h-[24rem] flex-col gap-4">
          <WorkflowCreationProgressPanel
            state={workflowCreationProgressState}
            stage={workflowCreationProgressStage}
            activeStep={workflowCreationActiveStep}
            retryNotice={workflowCreationRetryNotice}
            retryEvents={workflowCreationRetryEvents}
          />
          <div className="flex min-h-[16rem] flex-1 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 px-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
            <div className="mt-3 text-sm font-medium">正在整理关键问题</div>
            <div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              结构化问答生成后会直接出现在这里，右侧保留完整 AI 输出和自动修复记录。
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">AI 补充问答表</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              已生成的问题可以先回答；AI 继续出题时，新问题会追加到下面。
            </div>
          </div>
          {isGeneratingPlan ? (
            <Badge variant="outline" className="gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              继续出题中
            </Badge>
          ) : (
            <Badge variant="secondary">已生成 {clarificationForm.questions.length} 题</Badge>
          )}
          {clarificationForm.summary ? (
            <div className="basis-full text-xs leading-5 text-muted-foreground">{clarificationForm.summary}</div>
          ) : null}
        </div>

        {workflowCreationRetryNotice ? (
          <WorkflowCreationRetryCallout
            notice={workflowCreationRetryNotice}
            events={workflowCreationRetryEvents}
          />
        ) : null}

        {(clarificationForm.knownFacts?.length || clarificationForm.missingFields?.length) ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {clarificationForm.knownFacts?.length ? (
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs font-medium">已确认信息</div>
                <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                  {clarificationForm.knownFacts.map((item) => (
                    <div key={item}>- {item}</div>
                  ))}
                </div>
              </div>
            ) : null}
            {clarificationForm.missingFields?.length ? (
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs font-medium">待补全信息</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {clarificationForm.missingFields.map((item) => (
                    <Badge key={item} variant="outline">{item}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-4">
          {clarificationForm.questions.map((item, index) => (
            <div key={item.id} className="space-y-3 rounded-lg border bg-background p-4">
              {(() => {
                const options = getClarificationQuestionOptions(item);
                const noteSuggestions = getClarificationNoteSuggestions(item);
                const selectionMode = item.selectionMode === 'multiple' ? 'multiple' : 'single';
                return (
                  <>
                    <Label htmlFor={`clarification-${item.id}`} className="text-sm">
                      {index + 1}. {item.label}
                      {item.required !== false ? <span className="text-destructive"> *</span> : null}
                    </Label>
                    <div className="text-xs leading-5 text-muted-foreground">{item.question}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {selectionMode === 'multiple' ? '可多选，按需要勾选所有适用项。' : '单选，请选择最接近当前需求的一项。'}
                    </div>
                    <div className="grid gap-2">
                      {options.map((option) => {
                        const selected = clarificationAnswers[item.id]?.optionIds?.includes(option.id) || false;
                        return (
                          <label
                            key={`${item.id}-${option.id}`}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors',
                              selected
                                ? 'border-primary bg-primary/5'
                                : 'border-border bg-background hover:bg-muted/40',
                            )}
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
                                <div className={cn('h-4 w-4 rounded-full border', selected ? 'border-primary' : 'border-muted-foreground/40')}>
                                  <div className={cn('m-[3px] h-2 w-2 rounded-full', selected ? 'bg-primary' : 'bg-transparent')} />
                                </div>
                              </button>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium">{option.label}</div>
                                {option.recommended ? <Badge variant="secondary">推荐</Badge> : null}
                              </div>
                              {option.description ? (
                                <div className="mt-2 text-xs leading-5 text-muted-foreground">{option.description}</div>
                              ) : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <Textarea
                      id={`clarification-${item.id}`}
                      rows={4}
                      value={clarificationAnswers[item.id]?.note || ''}
                      placeholder={item.placeholder || '请输入你的回答'}
                      onChange={(event) => setClarificationAnswers((prev) => ({
                        ...prev,
                        [item.id]: {
                          optionIds: prev[item.id]?.optionIds || [],
                          note: event.target.value,
                        },
                      }))}
                    />
                    {noteSuggestions.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-muted-foreground">推荐补充</span>
                        {noteSuggestions.map((suggestion) => (
                          <button
                            key={`${item.id}-${suggestion}`}
                            type="button"
                            className="max-w-full truncate rounded-full border bg-muted/40 px-2.5 py-1 text-left text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
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
                    <div className="text-[11px] leading-5 text-muted-foreground">
                      先选一个最接近的方案；如果需要补充边界、例外或更具体的要求，再在下方补充说明。
                    </div>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderSpecPlanResultPanel = () => (
    <div className="space-y-4">
      <WorkflowCreationProgressPanel
        state={workflowCreationProgressState}
        stage={workflowCreationProgressStage}
        activeStep={workflowCreationActiveStep}
        retryNotice={workflowCreationRetryNotice}
        retryEvents={workflowCreationRetryEvents}
      />
      {!workflowCreationProgressState.spec.requirements.length
        && !workflowCreationProgressState.spec.tasks.length
        && !workflowCreationProgressState.spec.design.overview ? (
          <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 px-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
            <div className="mt-3 text-sm font-medium">正在生成正式计划制品</div>
            <div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              requirements、design、tasks 的结构化结果会实时填充到这里，右侧显示完整生成过程。
            </div>
          </div>
        ) : null}
    </div>
  );

  const renderWorkflowDraftResultPanel = () => (
    <div className="space-y-4">
      <WorkflowDraftPreviewCard preview={workflowDraftPreview} />
      <WorkflowCreationProgressPanel
        state={workflowCreationProgressState}
        stage={workflowCreationProgressStage}
        activeStep={workflowCreationActiveStep}
        retryNotice={workflowCreationRetryNotice}
        retryEvents={workflowCreationRetryEvents}
      />
      {!workflowDraftPreview ? (
        <div className="flex min-h-[22rem] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 px-6 text-center">
          {aiPhase === 'streaming' ? <Loader2 className="h-6 w-6 animate-spin text-green-500" /> : <span className="material-symbols-outlined text-3xl text-muted-foreground">account_tree</span>}
          <div className="mt-3 text-sm font-medium">等待 workflow 草案</div>
          <div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            草案通过解析后会在这里展示结构、Agent 分工、校验结果和 YAML。
          </div>
        </div>
      ) : null}
      {aiPhase === 'waiting' && validatedWorkflowDraftConfig && !aiFilename ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          系统已校验 workflow 草案，点击“确认创建”后写入 configs/{getValues('filename')}。
        </div>
      ) : null}
      {aiPhase === 'waiting' && workflowDraftValidation && !workflowDraftValidation.ok ? (
        <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <div>workflow 草案未通过系统校验。请查看校验信息并重新生成草案。</div>
          {Array.isArray(workflowDraftValidation?.issues) && workflowDraftValidation.issues.length > 0 ? (
            <div className="space-y-1">
              {workflowDraftValidation.issues.map((issue: any, index: number) => (
                <div key={`${issue.path?.join('.') || 'root'}-${index}`}>
                  {index + 1}. {issue.path?.join('.') || '(root)'}: {issue.message}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (formStep === 2) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent
          onInteractOutside={preventCreationDialogOutsideClose}
          className={creationStageDialogClassName}
        >
          <ComboboxPortalProvider>
            <CreationWorkspaceShell
              currentStep={2}
              title="补充问答"
              subtitle="先补全会影响计划和 Agent 编排的关键信息，然后再生成正式计划。"
              icon="route"
              iconClassName="text-amber-500"
              statusLabel={isGeneratingPlan ? '分析中' : clarificationForm ? `已生成 ${clarificationForm.questions.length} 题` : '等待问题'}
              statusTone={isGeneratingPlan ? 'amber' : clarificationForm ? 'emerald' : 'muted'}
              statusSpinning={isGeneratingPlan}
              engineControls={creationEngineControls}
              onBack={() => {
                interruptPlanningRun();
                setAiMessages([]);
                setAiPhase('idle');
                setPlanningStage('idle');
                setClarificationForm(null);
                setClarificationAnswers({});
                setFormStep(1);
              }}
              backTitle="返回基础输入"
              fullscreen={creationFullscreen}
              onToggleFullscreen={() => setCreationFullscreen((prev) => !prev)}
              onClose={handleClose}
              context={renderCreationContextPanel(false)}
              contextCollapsed={creationContextCollapsed}
              onToggleContext={() => setCreationContextCollapsed((prev) => !prev)}
              activity={renderCreationActivityPanel({
                title: '生成补充问答表',
                description: clarificationForm
                  ? 'AI 还在继续整理后续问题；已出现的问题可以先回答。'
                  : 'AI 正在整理已知事实、缺失信息和需要确认的问题。',
                isStreaming: isGeneratingPlan,
                emptyLabel: 'AI 过程会在这里出现。',
              })}
              activityCollapsed={creationActivityCollapsed}
              onToggleActivity={() => setCreationActivityCollapsed((prev) => !prev)}
              activityScrollRef={streamContentRef}
              resultTitle="问答结果"
              resultDescription="中间区域只放可操作的结构化问答，生成过程移到右侧，避免把表单挤到下面。"
              resultMeta={clarificationForm ? <Badge variant="outline">{planningStage === 'awaiting-answers' ? '等待回答' : '可继续补充'}</Badge> : null}
              footerStatus={clarificationForm ? '回答完成后进入正式计划生成。' : 'AI 会先提出会影响后续计划和 Agent 编排的关键问题。'}
              footerRight={isGeneratingPlan ? (
                <Button type="button" variant="outline" onClick={() => {
                  clarificationAbortRef.current = true;
                  interruptPlanningRun();
                  setAiPhase('waiting');
                  setPlanningStage('idle');
                  setWorkflowCreationActiveStep(null);
                  void persistDraftUiState({
                    formStep: 2,
                    planningStage: 'idle',
                    clarificationForm,
                    clarificationAnswers,
                  });
                }}>
                  停止出题
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => void generateClarificationWithChatSession()}>
                    重新提问
                  </Button>
                  <Button type="button" onClick={() => void handleSubmitClarificationAnswers()} disabled={!canSubmitClarificationAnswers}>
                    {canSubmitClarificationAnswers ? '提交回答并生成计划' : '出题完成后可继续'}
                  </Button>
                </>
              )}
            >
              {renderClarificationResultPanel()}
            </CreationWorkspaceShell>
          </ComboboxPortalProvider>
        </DialogContent>
      </Dialog>
    );
  }

  if (formStep === 3) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent
          onInteractOutside={preventCreationDialogOutsideClose}
          className={creationStageDialogClassName}
        >
          <ComboboxPortalProvider>
            <CreationWorkspaceShell
              currentStep={3}
              title="计划生成"
              subtitle="系统正在结合补充回答生成 requirements、design 和 tasks，完成后会进入确认阶段。"
              icon="map"
              iconClassName="text-amber-500"
              statusLabel={isGeneratingPlan ? '生成中' : '可重试'}
              statusTone={isGeneratingPlan ? 'amber' : 'muted'}
              statusSpinning={isGeneratingPlan}
              engineControls={creationEngineControls}
              onBack={() => {
                interruptPlanningRun();
                setAiMessages([]);
                setAiPhase('idle');
                setPlanningStage('awaiting-answers');
                setFormStep(2);
              }}
              backTitle="返回补充问答"
              fullscreen={creationFullscreen}
              onToggleFullscreen={() => setCreationFullscreen((prev) => !prev)}
              onClose={handleClose}
              context={renderCreationContextPanel(true)}
              contextCollapsed={creationContextCollapsed}
              onToggleContext={() => setCreationContextCollapsed((prev) => !prev)}
              activity={renderCreationActivityPanel({
                title: '生成正式计划制品',
                description: 'AI 正在生成 requirements、design 和 tasks，并把机器可读草案写入结构化结果。',
                isStreaming: isGeneratingPlan,
                emptyLabel: '计划生成过程会在这里出现。',
              })}
              activityCollapsed={creationActivityCollapsed}
              onToggleActivity={() => setCreationActivityCollapsed((prev) => !prev)}
              activityScrollRef={streamContentRef}
              resultTitle="正式计划"
              resultDescription="这里实时展示已经通过结构化解析的小点；右侧保留完整自然语言输出和修复记录。"
              resultMeta={workflowCreationActiveStep ? <Badge variant="outline">正在处理：{workflowCreationActiveStep.title}</Badge> : null}
              footerStatus="计划生成完成后会自动进入确认阶段。"
              footerRight={isGeneratingPlan ? (
                <Button type="button" variant="outline" onClick={() => {
                  interruptPlanningRun();
                  setAiPhase('waiting');
                  setPlanningStage('awaiting-answers');
                  setFormStep(2);
                }}>
                  停止并返回问答
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => setFormStep(2)}>
                    返回问答
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void generatePlanWithChatSession()}>
                    重试生成
                  </Button>
                </>
              )}
            >
              {renderSpecPlanResultPanel()}
            </CreationWorkspaceShell>
          </ComboboxPortalProvider>
        </DialogContent>
      </Dialog>
    );
  }

  // AI conversation view (post-plan confirmation for ai-guided mode)
  if (formStep === 5 && workflowMode === 'ai-guided') {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent
          onInteractOutside={preventCreationDialogOutsideClose}
          className={creationStageDialogClassName}
        >
          <ComboboxPortalProvider>
            <CreationWorkspaceShell
              currentStep={4}
              title="AI 工作流创建"
              subtitle="把已确认的计划整理成可保存的 workflow 配置草案，并在确认前完成校验预览。"
              icon="auto_awesome"
              iconClassName="text-green-500"
              statusLabel={aiPhase === 'streaming' ? '生成中' : aiPhase === 'waiting' ? '等待确认' : aiPhase === 'done' ? '创建完成' : '准备中'}
              statusTone={aiPhase === 'streaming' ? 'green' : aiPhase === 'waiting' ? 'blue' : aiPhase === 'done' ? 'emerald' : 'muted'}
              statusSpinning={aiPhase === 'streaming'}
              engineControls={creationEngineControls}
              onBack={handleBackToStep1}
              backTitle="返回上一步"
              fullscreen={creationFullscreen}
              onToggleFullscreen={() => setCreationFullscreen((prev) => !prev)}
              onClose={handleClose}
              context={renderCreationContextPanel(true)}
              contextCollapsed={creationContextCollapsed}
              onToggleContext={() => setCreationContextCollapsed((prev) => !prev)}
              activity={renderCreationActivityPanel({
                showUserMessages: true,
                title: '生成 workflow 草案',
                description: 'AI 正在生成可保存的 workflow 配置草案，结构化结果完成后会自动进入校验预览。',
                isStreaming: aiPhase === 'streaming',
                emptyLabel: 'workflow 草案生成过程会在这里出现。',
              })}
              activityCollapsed={creationActivityCollapsed}
              onToggleActivity={() => setCreationActivityCollapsed((prev) => !prev)}
              activityScrollRef={streamContentRef}
              resultTitle="Workflow 草案"
              resultDescription="结构预览、Agent 分配、校验信息和 YAML 都固定在这里，便于确认后写入配置。"
              resultMeta={workflowDraftPreview?.validation ? (
                <Badge variant={workflowDraftPreview.validation.ok ? 'default' : 'outline'}>
                  {workflowDraftPreview.validation.ok ? '校验通过' : '待修正'}
                </Badge>
              ) : null}
              footerStatus={aiPhase === 'waiting' && validatedWorkflowDraftConfig && !aiFilename ? `将写入 configs/${getValues('filename')}` : undefined}
              footerRight={(
                <>
                  {aiPhase === 'streaming' ? (
                    <Button type="button" variant="outline" onClick={stopWorkflowDraftGeneration}>
                      <span className="material-symbols-outlined mr-1 text-sm">stop</span>
                      停止生成
                    </Button>
                  ) : !aiFilename ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void startAiStream(previewSession)}
                        disabled={isSavingWorkflowDraft}
                      >
                        <span className="material-symbols-outlined mr-1 text-sm">refresh</span>
                        重新生成
                      </Button>
                      <Button type="button" onClick={handleQuickConfirm} disabled={!canConfirmWorkflowDraft}>
                        {isSavingWorkflowDraft ? '正在创建...' : canConfirmWorkflowDraft ? '确认创建' : '等待草案校验'}
                      </Button>
                    </>
                  ) : null}
                  {aiPhase === 'done' && aiFilename ? (
                    <Button type="button" onClick={handleAiComplete}>
                      <span className="material-symbols-outlined mr-1 text-sm">open_in_new</span>
                      打开设计页面
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" onClick={handleClose}>
                    关闭
                  </Button>
                </>
              )}
            >
              {renderWorkflowDraftResultPanel()}
            </CreationWorkspaceShell>
          </ComboboxPortalProvider>
        </DialogContent>
      </Dialog>
    );
  }

  // AI conversation view (post-plan confirmation for ai-guided mode)
  // PLACEHOLDER_RENDER_FORM

  if (formStep === 4 && previewSession) {
    const specCoding = previewSession.specCoding;
    const draftSummary = previewSession.workflowDraftSummary;
    const draftMode = draftSummary?.mode || previewSession.generatedConfigSummary?.mode || 'phase-based';
    const draftNodes = draftSummary?.nodes || [];
    const artifactItems = [
      { key: 'requirements' as const, title: 'requirements.md', content: specCoding.artifacts?.requirements || '' },
      { key: 'design' as const, title: 'design.md', content: specCoding.artifacts?.design || '' },
      { key: 'tasks' as const, title: 'tasks.md', content: specCoding.artifacts?.tasks || '' },
    ].filter((item) => item.content);
    const activeArtifact = artifactItems.find((item) => item.key === selectedArtifactKey) || artifactItems[0] || null;
    const activeDraft = activeArtifact ? artifactDrafts[activeArtifact.key] || '' : '';
    const hasArtifactChanges = activeArtifact ? activeDraft !== (activeArtifact.content || '') : false;
    const artifactSnapshots = [...(previewSession.artifactSnapshots || [])].sort((a: any, b: any) => b.version - a.version);
    const selectedSnapshot = selectedSnapshotVersion === 'current'
      ? null
      : artifactSnapshots.find((item: any) => String(item.version) === selectedSnapshotVersion) || null;
    const latestRevision = specCoding.revisions?.length ? specCoding.revisions[specCoding.revisions.length - 1] : null;
    const latestRevisionMeta = latestRevision ? parseRevisionSummaryMeta(latestRevision.summary || '') : {};
    const planTaskAgentMappings = buildPlanTaskAgentMappings(specCoding, previewSession.config);
    const workflowAgentSummaries = (() => {
      const direct = buildWorkflowAgentTaskSummaries(previewSession.config);
      if (direct.length > 0) return direct;
      const fallbackAgents = Array.from(new Set([
        ...(specCoding.assignments || []).map((assignment: any) => assignment.agent).filter(Boolean),
        ...planTaskAgentMappings.flatMap((row) => row.agentNames || []).filter(Boolean),
      ]));
      return fallbackAgents.map((agent) => ({
        agent,
        role: agent === (previewSession.config?.workflow?.supervisor?.agent || recommendedSupervisorAgent) ? 'supervisor' : null,
        stepCount: planTaskAgentMappings.filter((row) => row.agentNames.includes(agent)).length,
        taskCount: planTaskAgentMappings.filter((row) => row.agentNames.includes(agent)).length,
        items: planTaskAgentMappings
          .filter((row) => row.agentNames.includes(agent))
          .map((row) => ({
            nodeName: row.phaseName,
            stepName: row.stepName,
            task: row.taskTitle,
            role: null,
          })),
      }));
    })();
    const workflowAgentNames = workflowAgentSummaries.map((item) => item.agent);
    const creationTimeline = [
      {
        id: 'session-created',
        title: '创建记录建立',
        time: previewSession.createdAt,
        detail: `开始围绕 ${previewSession.workflowName} 收集需求、约束和工作目录。`,
      },
      previewSession.clarification?.summary ? {
        id: 'clarification-ready',
        title: '需求澄清完成',
        time: previewSession.updatedAt,
        detail: previewSession.clarification.summary,
      } : null,
      latestRevision ? {
        id: `revision-${latestRevision.id}`,
        title: '最近一次制品修订',
        time: latestRevision.createdAt ? new Date(latestRevision.createdAt).getTime() : previewSession.updatedAt,
        detail: latestRevision.summary,
      } : null,
      draftSummary ? {
        id: 'workflow-draft-ready',
        title: 'Workflow 草案已可生成',
        time: previewSession.updatedAt,
        detail: draftSummary.sourceSummary || '当前计划已具备继续整理 workflow 草案的条件。',
      } : null,
    ].filter(Boolean) as Array<{ id: string; title: string; time: number; detail: string }>;
    return (
      <>
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
          <DialogContent
            onInteractOutside={preventCreationDialogOutsideClose}
            className={creationStageDialogClassName}
          >
            <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setFormStep(3)} disabled={isRevisingPlan} title="返回计划生成" className="gap-1.5 px-2">
                  <span className="material-symbols-outlined">arrow_back</span>
                  <span>上一步</span>
                </Button>
                <DialogTitle>确认计划</DialogTitle>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setCreationFullscreen((prev) => !prev)}
                  title={creationFullscreen ? '退出全屏' : '全屏'}
                >
                  <span className="material-symbols-outlined">
                    {creationFullscreen ? 'close_fullscreen' : 'open_in_full'}
                  </span>
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={handleClose}>
                  <span className="material-symbols-outlined">close</span>
                </Button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6">
              <CreationStageStepper currentStep={4} />

              <div className="mt-4 max-h-[24vh] flex-shrink-0 overflow-auto rounded-xl border bg-muted/30 p-4 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm font-medium">{previewSession.workflowName}</span>
                  <span className="text-xs rounded-full border px-2 py-0.5">创建进度 {previewSession.status}</span>
                  <span className="text-xs rounded-full border px-2 py-0.5">计划 {specCoding.status}</span>
                  <span className="text-xs rounded-full border px-2 py-0.5">v{specCoding.version}</span>
                </div>
                {specCoding.summary ? (
                  <p className="text-sm text-muted-foreground leading-6">{specCoding.summary}</p>
                ) : null}
                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>配置文件：{previewSession.filename}</div>
                  <div>工作流模板：{previewSession.referenceWorkflow || '无'}</div>
                  <div>工作目录：{previewSession.workingDirectory}</div>
                  <div>工作区模式：{previewSession.workspaceMode}</div>
                  <div>计划节点数：{specCoding.phases?.length || 0}</div>
                  <div>计划 Agent 数：{workflowAgentNames.length || 0}</div>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 overflow-auto space-y-4 pr-1">
              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-xl border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">正式计划工作台</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        正式计划制品、Spec 节点、Agent 分工和修订说明已移到单独弹窗，便于全屏检查与编辑。
                      </div>
                    </div>
                    <Button type="button" onClick={() => setPlanWorkspaceOpen(true)}>
                      <span className="material-symbols-outlined mr-1 text-sm">open_in_new</span>
                      打开计划工作台
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="text-[11px] text-muted-foreground">计划制品</div>
                      <div className="mt-1 text-sm font-medium">{artifactItems.length} 份</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {artifactItems.map((item) => item.title).join(' / ') || '尚未生成'}
                      </div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="text-[11px] text-muted-foreground">Spec 节点</div>
                      <div className="mt-1 text-sm font-medium">{specCoding.phases?.length || 0} 个</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        目标、owner 与阶段状态在弹窗中查看
                      </div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="text-[11px] text-muted-foreground">Agent 编队</div>
                      <div className="mt-1 text-sm font-medium">{workflowAgentNames.length || 0} 个</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        会展示节点、步骤、任务与 Agent 对应关系
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {workflowAgentNames.length > 0 ? workflowAgentNames.map((agent) => (
                      <Badge key={agent} variant="outline">{agent}</Badge>
                    )) : (
                      <div className="text-xs text-muted-foreground">当前草案还没有可用的 Agent 映射。</div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border p-4 space-y-3">
                  <div className="text-sm font-medium">对话标签历史</div>
                  <div className="space-y-2">
                    {creationTimeline.map((entry) => (
                      <div key={entry.id} className="rounded-md border bg-muted/20 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-medium">{entry.title}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {entry.time ? new Date(entry.time).toLocaleString() : '未知时间'}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground leading-5">{entry.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {previewSession.requirements ? (
                <div className="rounded-xl border p-4 space-y-2">
                  <div className="text-sm font-medium">需求澄清输入</div>
                  <div className="text-sm text-muted-foreground leading-6 whitespace-pre-wrap">
                    {previewSession.requirements}
                  </div>
                </div>
              ) : null}
              {previewSession.clarification ? (
                <div className="rounded-xl border p-4 space-y-3">
                  <div className="text-sm font-medium">AI 需求澄清</div>
                  {previewSession.clarification.summary ? (
                    <div className="text-sm text-muted-foreground leading-6">{previewSession.clarification.summary}</div>
                  ) : null}
                  {previewSession.clarification.knownFacts?.length ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium">已确认信息</div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {previewSession.clarification.knownFacts.map((item: string) => (
                          <div key={item}>- {item}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {previewSession.clarification.missingFields?.length ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium">仍缺信息</div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {previewSession.clarification.missingFields.map((item: string) => (
                          <div key={item}>- {item}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {previewSession.clarification.questions?.length ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium">建议继续确认的问题</div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {previewSession.clarification.questions.map((item: string) => (
                          <div key={item}>- {item}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {previewConfigValidation?.issues?.length ? (
                <div className="rounded-xl border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">Workflow 草案校验</div>
                    <span className="text-xs rounded-full border px-2 py-0.5">
                      {previewConfigValidation.ok ? '通过' : '待修正'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {previewConfigValidation.issues.map((issue: any, index: number) => (
                      <div key={`${issue.path?.join('.') || 'root'}-${index}`} className="rounded-lg border bg-muted/20 p-3">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="rounded-full border px-2 py-0.5">
                            {issue.severity === 'error' ? '错误' : '警告'}
                          </span>
                          <span className="text-muted-foreground">{issue.path?.join('.') || 'root'}</span>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground leading-6">{issue.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

                <div className="rounded-xl border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">下一步将生成的 Workflow 草案</div>
                  <span className="text-[10px] rounded-full border px-2 py-0.5">
                    {draftMode === 'state-machine' ? '状态机' : '阶段式'}
                  </span>
                </div>
                <div className="text-xs leading-5 text-muted-foreground">
                  确认当前计划后，系统会据此整理 workflow 步骤、阶段结构和 Agent 分配。
                </div>
                {latestRevision ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">当前历史承接焦点</div>
                    <div>{latestRevision.summary}</div>
                    {latestRevisionMeta.artifact ? (
                      <div>修订制品：{latestRevisionMeta.artifact}</div>
                    ) : null}
                    {latestRevisionMeta.impactArea ? (
                      <div>影响草案：{latestRevisionMeta.impactArea}</div>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                    <div>文件名：{previewSession.filename}</div>
                    <div>工作流名：{previewSession.workflowName}</div>
                    <div>工作目录：{previewSession.workingDirectory}</div>
                    <div>工作流模板：{previewSession.referenceWorkflow || '无'}</div>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                    <div>结构类型：{draftMode === 'state-machine' ? '状态机 workflow' : '阶段式 workflow'}</div>
                    <div>阶段/状态数：{draftNodes.length}</div>
                    <div>Supervisor：{previewSession.config?.workflow?.supervisor?.agent || recommendedSupervisorAgent}</div>
                  </div>
                </div>
                {draftSummary?.sourceSummary ? (
                  <div className="rounded-lg border border-dashed p-3 text-xs leading-5 text-muted-foreground">
                    {draftSummary.sourceSummary}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {draftNodes.length > 0 ? draftNodes.map((item: any) => (
                    <span
                      key={item.name}
                      className={`rounded-full border bg-background px-2 py-1 text-[10px] ${
                        latestRevisionMeta.impactArea === '阶段拆分'
                          ? 'border-amber-500/50 text-amber-700 dark:text-amber-300'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {item.name} · {item.detail}
                    </span>
                  )) : (
                    <div className="text-xs text-muted-foreground">当前草案尚未生成阶段/状态摘要。</div>
                  )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-end p-6 pt-4 border-t flex-shrink-0">
              <Button type="button" variant="outline" onClick={() => setFormStep(3)} disabled={isRevisingPlan}>
                返回计划
              </Button>
              <Button type="button" onClick={handleConfirmPreview} disabled={isSubmitting || isRevisingPlan}>
                {isRevisingPlan ? '计划修订生成中...' : workflowMode === 'ai-guided' ? '确认并进入 Workflow 草案' : '确认并创建配置'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={planWorkspaceOpen} onOpenChange={setPlanWorkspaceOpen}>
          <DialogContent
            onInteractOutside={preventCreationDialogOutsideClose}
            className={planWorkspaceDialogClassName}
          >
            <div className="flex items-center justify-between border-b p-6 pb-4 flex-shrink-0">
              <div>
                <DialogTitle>正式计划工作台</DialogTitle>
                <div className="mt-1 text-xs text-muted-foreground">
                  在这里查看正式计划制品、Spec 节点、Agent 分工与修订关系。
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setPlanWorkspaceFullscreen((prev) => !prev)}
                  title={planWorkspaceFullscreen ? '退出全屏' : '全屏'}
                >
                  <span className="material-symbols-outlined">
                    {planWorkspaceFullscreen ? 'close_fullscreen' : 'open_in_full'}
                  </span>
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => setPlanWorkspaceOpen(false)}>
                  <span className="material-symbols-outlined">close</span>
                </Button>
              </div>
            </div>

            <div className="border-b px-6 py-3">
              <Tabs value={planWorkspaceTab} onValueChange={(value) => setPlanWorkspaceTab(value as typeof planWorkspaceTab)}>
                <TabsList className="w-full justify-start overflow-auto">
                  <TabsTrigger value="artifacts">正式计划制品</TabsTrigger>
                  <TabsTrigger value="nodes">Spec 节点</TabsTrigger>
                  <TabsTrigger value="assignments">Agent 分工</TabsTrigger>
                  <TabsTrigger value="revisions">修订</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
              {planWorkspaceTab === 'artifacts' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">正式计划制品</div>
                    {activeArtifact ? (
                      <div className="flex items-center gap-2">
                        <Select value={selectedSnapshotVersion} onValueChange={setSelectedSnapshotVersion}>
                          <SelectTrigger className="h-8 w-[190px]">
                            <SelectValue placeholder="选择对比版本" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="current">与当前版本比较</SelectItem>
                            {artifactSnapshots.map((snapshot: any) => (
                              <SelectItem key={snapshot.version} value={String(snapshot.version)}>
                                v{snapshot.version} · {snapshot.summary.slice(0, 24)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {hasArtifactChanges ? <Badge variant="outline">未保存修改</Badge> : null}
                        <div className="inline-flex h-8 overflow-hidden rounded-md border bg-background">
                          <Button
                            type="button"
                            size="sm"
                            variant={artifactViewMode === 'preview' ? 'secondary' : 'ghost'}
                            className="h-8 rounded-none border-0 px-3"
                            onClick={() => setArtifactViewMode('preview')}
                          >
                            原文
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={artifactViewMode === 'edit' ? 'secondary' : 'ghost'}
                            className="h-8 rounded-none border-0 border-l px-3"
                            onClick={() => setArtifactViewMode('edit')}
                          >
                            编辑
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={artifactViewMode === 'diff' ? 'secondary' : 'ghost'}
                            className="h-8 rounded-none border-0 border-l px-3"
                            onClick={() => setArtifactViewMode('diff')}
                          >
                            差异
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {artifactItems.length ? (
                    <Tabs value={activeArtifact?.key || selectedArtifactKey} onValueChange={(value) => setSelectedArtifactKey(value as SpecCodingArtifactKey)}>
                      <TabsList className="w-full justify-start overflow-auto">
                        {artifactItems.map((artifact) => (
                          <TabsTrigger key={artifact.key} value={artifact.key}>{artifact.title}</TabsTrigger>
                        ))}
                      </TabsList>
                      {artifactItems.map((artifact) => {
                        const draftValue = artifactDrafts[artifact.key] || '';
                        const changed = draftValue !== (artifact.content || '');
                        const compareBase = selectedSnapshot?.artifacts?.[artifact.key] ?? artifact.content ?? '';
                        const diffTarget = changed ? draftValue : (artifact.content || '');
                        const diffRows = computeSimpleDiff(compareBase, diffTarget);
                        return (
                          <TabsContent key={artifact.key} value={artifact.key} className="mt-4">
                            <div className="rounded-lg border overflow-hidden">
                              <div className="border-b bg-muted/20 px-3 py-2 text-xs font-medium flex items-center justify-between gap-2">
                                <span>{artifact.title}</span>
                                <div className="flex items-center gap-2">
                                  {changed ? <Badge variant="outline">已修改</Badge> : <Badge variant="secondary">未修改</Badge>}
                                  {selectedSnapshot ? <Badge variant="outline">对比 v{selectedSnapshot.version}</Badge> : null}
                                </div>
                              </div>
                              {artifactViewMode === 'edit' ? (
                                <div className="p-3 space-y-3">
                                  <div className="h-[58vh] overflow-hidden rounded-md border">
                                    <MonacoEditor
                                      height="100%"
                                      defaultLanguage="markdown"
                                      language="markdown"
                                      value={draftValue}
                                      theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
                                      onChange={(value) => setArtifactDrafts((prev) => ({ ...prev, [artifact.key]: value ?? '' }))}
                                      options={{
                                        minimap: { enabled: false },
                                        wordWrap: 'on',
                                        fontSize: 12,
                                        lineNumbers: 'on',
                                        scrollBeyondLastLine: false,
                                        automaticLayout: true,
                                      }}
                                    />
                                  </div>
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setArtifactDrafts((prev) => ({ ...prev, [artifact.key]: artifact.content || '' }))}
                                    >
                                      放弃当前修改
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={() => void saveArtifactEdits()}
                                      disabled={savingArtifact || selectedArtifactKey !== artifact.key || !changed}
                                    >
                                      {savingArtifact && selectedArtifactKey === artifact.key ? '保存中...' : '保存制品修订'}
                                    </Button>
                                  </div>
                                </div>
                              ) : artifactViewMode === 'diff' ? (
                                <div className="max-h-[58vh] overflow-auto bg-background p-3 font-mono text-[11px] leading-5">
                                  {(changed || selectedSnapshot) ? diffRows.map((row, index) => (
                                    <div
                                      key={`${artifact.key}-diff-${index}`}
                                      className={
                                        row.type === 'add'
                                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                          : row.type === 'remove'
                                            ? 'bg-destructive/10 text-destructive'
                                            : 'text-muted-foreground'
                                      }
                                    >
                                      <span className="mr-2 inline-block w-4 text-center">
                                        {row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' '}
                                      </span>
                                      <span className="whitespace-pre-wrap break-all">{row.text || ' '}</span>
                                    </div>
                                  )) : (
                                    <div className="text-xs text-muted-foreground">当前制品没有未保存差异。</div>
                                  )}
                                </div>
                              ) : (
                                <div className="h-[58vh] overflow-auto rounded-md border bg-background p-4">
                                  <div className="mb-3 rounded-md border border-dashed bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                                    当前为只读预览。切换到“编辑”后可直接修改并保存为计划修订。
                                  </div>
                                  <div className="prose prose-sm dark:prose-invert max-w-none">
                                    <Markdown>{artifact.content || ''}</Markdown>
                                  </div>
                                </div>
                              )}
                            </div>
                          </TabsContent>
                        );
                      })}
                    </Tabs>
                  ) : (
                    <div className="text-xs text-muted-foreground">当前会话还没有生成正式计划制品。</div>
                  )}
                </div>
              ) : null}

              {planWorkspaceTab === 'nodes' ? (
                <div className="space-y-4">
                  <div className="rounded-xl border bg-muted/20 p-4 space-y-2">
                    <div className="text-sm font-medium">对话标签历史</div>
                    <div className="space-y-2">
                      {creationTimeline.map((entry) => (
                        <div key={entry.id} className="rounded-md border bg-background/70 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-medium">{entry.title}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {entry.time ? new Date(entry.time).toLocaleString() : '未知时间'}
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground leading-5">{entry.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {specCoding.phases?.length ? specCoding.phases.map((phase: any) => (
                      <div key={phase.id} className="rounded-xl border p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium">{phase.title}</div>
                          <span className="text-[10px] rounded-full border px-2 py-0.5">{phase.status}</span>
                        </div>
                        {phase.objective ? (
                          <div className="text-xs text-muted-foreground leading-5">{phase.objective}</div>
                        ) : null}
                        {phase.ownerAgents?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {phase.ownerAgents.map((agent: string) => (
                              <Badge key={agent} variant="outline">{agent}</Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )) : (
                      <div className="text-xs text-muted-foreground">当前 spec 还没有拆出节点。</div>
                    )}
                  </div>
                </div>
              ) : null}

              {planWorkspaceTab === 'assignments' ? (
                <div className="space-y-4">
                  <div className="rounded-xl border bg-muted/20 p-4">
                    <div className="text-sm font-medium">当前将调用的 Agent</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {workflowAgentNames.length > 0 ? workflowAgentNames.map((agent) => (
                        <Badge key={agent} variant="outline">{agent}</Badge>
                      )) : <span className="text-xs text-muted-foreground">暂无 Agent</span>}
                    </div>
                  </div>
                  <div className="rounded-xl border p-4 space-y-3">
                    <div className="text-sm font-medium">任务与 Agent 对应</div>
                    <div className="text-xs text-muted-foreground">
                      这里直接展示计划任务、阶段步骤与实际绑定 Agent 的对应关系，不再只看职责摘要。
                    </div>
                    {planTaskAgentMappings.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[160px]">阶段</TableHead>
                            <TableHead className="w-[160px]">步骤 / Task</TableHead>
                            <TableHead>任务内容</TableHead>
                            <TableHead className="w-[220px]">绑定 Agent</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {planTaskAgentMappings.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="align-top">
                                <div className="text-sm font-medium">{row.phaseName}</div>
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                  {row.source === 'task' ? '计划任务' : '执行步骤'}
                                </div>
                              </TableCell>
                              <TableCell className="align-top">
                                <div className="text-sm">{row.stepName}</div>
                              </TableCell>
                              <TableCell className="align-top">
                                <div className="text-sm leading-6">{row.taskTitle}</div>
                                {row.detail && row.detail !== row.taskTitle ? (
                                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{row.detail}</div>
                                ) : null}
                              </TableCell>
                              <TableCell className="align-top">
                                <div className="flex flex-wrap gap-2">
                                  {row.agentNames.length > 0 ? row.agentNames.map((agent) => (
                                    <Badge key={`${row.id}-${agent}`} variant="outline">{agent}</Badge>
                                  )) : (
                                    <span className="text-xs text-muted-foreground">待分配</span>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="text-xs text-muted-foreground">当前预览还没有生成任务与 Agent 的直接映射。</div>
                    )}
                  </div>
                  {specCoding.assignments?.length ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {specCoding.assignments.map((assignment: any) => (
                        <div key={assignment.agent} className="rounded-xl border p-4">
                          <div className="text-sm font-medium">{assignment.agent}</div>
                          <div className="mt-1 text-xs text-muted-foreground leading-5">{assignment.responsibility}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="grid gap-3 xl:grid-cols-2">
                    {workflowAgentSummaries.length > 0 ? workflowAgentSummaries.map((summary) => (
                      <div key={summary.agent} className="rounded-xl border p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">{summary.agent}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {summary.role ? `默认角色：${summary.role}` : '未声明默认角色'}
                            </div>
                          </div>
                          <Badge variant="secondary">{summary.stepCount} 步</Badge>
                        </div>
                        <div className="space-y-2">
                          {summary.items.map((item, index) => (
                            <div key={`${summary.agent}-${item.nodeName}-${item.stepName}-${index}`} className="rounded-lg border bg-muted/20 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-medium">{item.nodeName}</span>
                                <span className="text-[10px] rounded-full border px-2 py-0.5">{item.stepName}</span>
                                {item.role ? <span className="text-[10px] rounded-full border px-2 py-0.5">{item.role}</span> : null}
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground leading-5">
                                {item.task || '当前步骤还没有明确任务描述。'}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )) : (
                      <div className="text-xs text-muted-foreground">当前预览还没有可展示的 Agent 编排映射。</div>
                    )}
                  </div>
                </div>
              ) : null}

              {planWorkspaceTab === 'revisions' ? (
                <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
                  <div className="space-y-4">
                    {specCoding.revisions?.length ? (
                      <div className="rounded-xl border p-4 space-y-2">
                        <div className="text-sm font-medium">修订记录</div>
                        <div className="space-y-2">
                          {[...specCoding.revisions].reverse().map((revision: any) => (
                            <div key={revision.id} className="rounded-md border bg-muted/20 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[11px] font-medium">v{revision.version}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  {revision.createdAt ? new Date(revision.createdAt).toLocaleString() : '未知时间'}
                                </div>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground leading-5">{revision.summary}</div>
                              {revision.createdBy ? (
                                <div className="mt-1 text-[10px] text-muted-foreground">修订者：{revision.createdBy}</div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border p-4 text-xs text-muted-foreground">当前还没有修订记录。</div>
                    )}
                  </div>

                  <div className="rounded-xl border border-dashed p-4 space-y-3">
                    <div className="text-sm font-medium">修订说明</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">修订哪份制品</Label>
                        <Select
                          value={revisionTarget}
                          onValueChange={(value) => setRevisionTarget(value as 'requirements' | 'design' | 'tasks')}
                          disabled={isRevisingPlan}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="requirements">requirements.md</SelectItem>
                            <SelectItem value="design">design.md</SelectItem>
                            <SelectItem value="tasks">tasks.md</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">主要影响哪块 workflow 草案</Label>
                        <Select
                          value={revisionImpactArea}
                          onValueChange={(value) => setRevisionImpactArea(value as 'phases' | 'agents' | 'checkpoints' | 'transitions')}
                          disabled={isRevisingPlan}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="phases">阶段拆分</SelectItem>
                            <SelectItem value="agents">Agent 分工</SelectItem>
                            <SelectItem value="checkpoints">检查点设计</SelectItem>
                            <SelectItem value="transitions">状态流转</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Textarea
                      value={revisionNotes}
                      onChange={(event) => setRevisionNotes(event.target.value)}
                      rows={8}
                      disabled={isRevisingPlan}
                      placeholder="例如：阶段拆分过粗、需要加入人工检查点、希望沿用某个 Agent 分工..."
                    />
                    <div className="rounded-md border bg-muted/20 p-3 text-[11px] leading-5 text-muted-foreground">
                      系统会把修订目标、影响区域和修订说明一起写入 revision，便于后续把这条修订和 workflow 草案变化对应起来。
                    </div>
                    {isRevisingPlan ? (
                      <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                          AI 正在按修订说明重新生成正式计划制品
                        </div>
                        <div className="text-[11px] leading-5 text-amber-700/80 dark:text-amber-300/80">
                          修订完成前不能进入下一步；完成后会自动刷新 requirements、design、tasks，并记录 revision。
                        </div>
                        {currentThinking || currentStream || isRevisingPlan ? (
                          <ModalAiGenerationPanel
                            content={joinModalAiProcessContent(currentThinking, currentStream)}
                            isStreaming={isRevisingPlan}
                            title="修订正式计划制品"
                            description="AI 正在按修订说明刷新正式计划，并把新的机器可读草案写入结构化结果。"
                            className="bg-background"
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex justify-end">
                      <Button type="button" onClick={() => void regeneratePreviewWithRevision()} disabled={isRevisingPlan || !revisionNotes.trim()}>
                        {isRevisingPlan ? 'AI 修订生成中...' : '按修订说明重新生成预览'}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Step 1: Form view (all modes)
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        onInteractOutside={preventCreationDialogOutsideClose}
        className={creationDialogClassName}
      >
        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
          <DialogTitle>新建工作流配置</DialogTitle>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setCreationFullscreen((prev) => !prev)}
              title={creationFullscreen ? '退出全屏' : '全屏'}
            >
              <span className="material-symbols-outlined">
                {creationFullscreen ? 'close_fullscreen' : 'open_in_full'}
              </span>
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={handleClose}>
              <span className="material-symbols-outlined">close</span>
            </Button>
          </div>
        </div>
        <form id="new-config-form" onSubmit={handleSubmit(onSubmit, onInvalid)} className="flex-1 overflow-auto px-6 space-y-6">
          {useSpecPlanningFlow && !hideAiGuided ? (
            <>
              <CreationStageStepper currentStep={1} />

              <div className="rounded-xl border bg-muted/20 p-4 text-xs leading-6 text-muted-foreground">
                当前处于第 1 步：先收敛需求与约束，并按 `skills/aceharness-spec-coding` 生成正式计划制品。确认计划后，系统才会进入 workflow 草案阶段。
              </div>
            </>
          ) : workflowMode === 'ai-guided' ? (
            <div className="rounded-xl border bg-muted/20 p-4 text-xs leading-6 text-muted-foreground">
              当前处于快速编排模式：会跳过 Spec 计划、补充问答和正式制品确认，下一步直接进入 workflow 草案生成。
            </div>
          ) : workflowMode === 'state-machine' && !specPlanningEnabled ? (
            <div className="rounded-xl border bg-muted/20 p-4 text-xs leading-6 text-muted-foreground">
              当前处于快速编排模式：会直接创建状态机 workflow 配置，不生成 Spec 基线，也不会写入 spec 修订链路。
            </div>
          ) : workflowMode === 'state-machine' ? (
            <div className="rounded-xl border bg-muted/20 p-4 text-xs leading-6 text-muted-foreground">
              当前会在创建配置时同步建立 Spec 基线，后续可在设计页继续查看和修订 requirements / design / tasks。
            </div>
          ) : null}

          <input type="hidden" {...register('mode')} />
          <input type="hidden" {...register('referenceWorkflow')} />
          <input type="hidden" {...register('workingDirectory')} />
          <input type="hidden" {...register('workspaceMode')} />
          <input type="hidden" {...register('persistMode')} />

          {true && (
            <>
              <div className="space-y-2">
                <Label className="text-base font-semibold">
                  选择工作流模式 <span className="text-destructive">*</span>
                </Label>
                <WorkflowModeSelector
                  value={workflowMode}
                  onChange={setWorkflowMode}
                  showDetails={true}
                  hideAiGuided={hideAiGuided}
                />
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700" />
            </>
          )}

          {/* AI 引导模式的需求输入 */}
          {workflowMode === 'ai-guided' && (
            <div
              ref={requirementsSectionRef}
              className={homepageCompact ? 'space-y-2' : 'space-y-4 bg-green-50 dark:bg-green-950/30 rounded-lg p-4 border border-green-200 dark:border-green-800'}
            >
              {!homepageCompact && (
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <span className="material-symbols-outlined">auto_awesome</span>
                  <span className="font-medium">描述你的工作流需求</span>
                </div>
              )}
              {homepageCompact && (
                <Label htmlFor="requirements">
                  需求描述 <span className="text-destructive">*</span>
                </Label>
              )}
              <Textarea
                {...requirementsField}
                ref={(element) => {
                  requirementsField.ref(element);
                  requirementsInputRef.current = element;
                }}
                id="requirements"
                placeholder="例如：我想创建一个代码审查工作流，包含设计评审、代码审查、测试验证等阶段，需要支持发现问题时自动回退..."
                rows={5}
                className="bg-background"
              />
              {!homepageCompact && (
                <p className="text-xs text-green-600 dark:text-green-500">
                  AI 将根据你的需求描述，实时分析、设计并生成工作流配置。你可以在对话中查看 AI 的思考过程，确认方案后 AI 会自动创建并验证文件。
                </p>
              )}
            </div>
          )}

          {showSpecPlanningToggle ? (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="specPlanningEnabled">Spec 计划模式</Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {workflowMode === 'ai-guided'
                      ? '开启后会先生成 requirements/design/tasks 并支持确认前修订；关闭后会直接进入 workflow 编排草案。'
                      : '开启后会为新工作流建立 Spec 基线并支持后续修订；关闭后只创建 workflow 配置，直接按非 Spec 模式运行。'}
                  </p>
                </div>
                <Switch
                  id="specPlanningEnabled"
                  checked={specPlanningEnabled}
                  onCheckedChange={(checked: boolean) => {
                    setSpecPlanningEnabled(Boolean(checked));
                    if (!checked) {
                      setValue('persistMode', 'none', { shouldDirty: true, shouldValidate: false });
                    }
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={specPlanningEnabled ? 'secondary' : 'outline'}>
                  {specPlanningEnabled ? '先修订 Spec' : '跳过 Spec'}
                </Badge>
                <Badge variant="outline">
                  {workflowMode === 'ai-guided'
                    ? (specPlanningEnabled ? '完整计划链路' : '直接编排 workflow')
                    : (specPlanningEnabled ? '创建并附带 Spec 基线' : '仅创建 workflow 配置')}
                </Badge>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="workflowName">
              工作流名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="workflowName"
              placeholder="我的工作流"
              {...register('workflowName')}
              className={errors.workflowName ? 'border-destructive' : ''}
            />
            {errors.workflowName && (
              <p className="text-sm text-destructive">{errors.workflowName.message}</p>
            )}
          </div>

          {workflowMode !== 'ai-guided' ? (
            <div ref={requirementsSectionRef} className="space-y-2">
              <Label htmlFor="requirements">
                需求描述 <span className="text-destructive">*</span>
              </Label>
              <Textarea
                {...requirementsField}
                ref={(element) => {
                  requirementsField.ref(element);
                  requirementsInputRef.current = element;
                }}
                id="requirements"
                placeholder="描述这个工作流要解决的问题、目标产物和验收标准..."
                rows={5}
                className={errors.requirements ? 'border-destructive' : ''}
              />
              {errors.requirements && (
                <p className="text-sm text-destructive">{errors.requirements.message}</p>
              )}
            </div>
          ) : null}

          {showReferenceWorkflowOptions ? (
            <div className="space-y-2">
              <Label htmlFor="referenceWorkflow">工作流模板（可选）</Label>
              <Select
                value={referenceWorkflowValue || '__none__'}
                onValueChange={(value) => {
                  setValue('referenceWorkflow', value === '__none__' ? '' : value, { shouldDirty: true, shouldValidate: true });
                }}
              >
                <SelectTrigger id="referenceWorkflow">
                  <SelectValue placeholder={referenceLoading ? '加载工作流模板中...' : '选择一个同类型工作流模板'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不使用工作流模板</SelectItem>
                  {filteredReferenceWorkflows.length === 0 && !referenceLoading ? (
                    <SelectItem value="__empty__" disabled>
                      暂无同类型工作流模板
                    </SelectItem>
                  ) : null}
                  {filteredReferenceWorkflows.map((workflow) => (
                    <SelectItem key={workflow.filename} value={workflow.filename}>
                      {workflow.name} ({workflow.filename})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {referenceConfigLoading ? (
                <p className="text-xs text-muted-foreground">正在读取工作流模板结构...</p>
              ) : effectiveReferenceWorkflowValue && referenceConfig ? (
                <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                  <div className="font-medium text-foreground">
                    {referenceWorkflowValue ? '已选择工作流模板' : '系统自动采用工作流模板'}
                  </div>
                  <div>文件：{effectiveReferenceWorkflowValue}</div>
                  <div>模式：{referenceConfig.config?.workflow?.mode === 'state-machine' ? '状态机' : '阶段式'}</div>
                  <div>
                    说明：会尽量继承模板的流程结构、关键节点和 Agent 安排，只更新当前需求与任务说明。
                    {!referenceWorkflowValue && creationRecommendations?.referenceWorkflow?.source === 'recommended-experience'
                      ? ' 当前未手动指定工作流模板，系统已按相关历史经验自动采用这份骨架。'
                      : ''}
                  </div>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                只能选择同类型工作流；阶段式参考阶段式，状态机参考状态机。
              </p>
              {recommendationsLoading ? (
                <p className="text-xs text-muted-foreground">正在整理经验库和编队推荐...</p>
              ) : creationRecommendations ? (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">编排推荐</div>
                  <Badge variant="outline">经验库 + 关系系统</Badge>
                </div>
                {creationRecommendations.referenceWorkflow ? (
                  <div className="rounded-lg border bg-background/80 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">工作流模板骨架</div>
                    <div>{creationRecommendations.referenceWorkflow.name || creationRecommendations.referenceWorkflow.filename}</div>
                    <div>模式：{creationRecommendations.referenceWorkflow.mode === 'state-machine' ? '状态机' : '阶段式'}</div>
                    {creationRecommendations.referenceWorkflow.supervisorAgent ? (
                      <div>指挥官：{creationRecommendations.referenceWorkflow.supervisorAgent}</div>
                    ) : null}
                    {creationRecommendations.referenceWorkflow.autoApply ? (
                      <div>自动决策：当前未手动指定时，将默认采用这份工作流模板骨架参与预览生成。</div>
                    ) : null}
                    {creationRecommendations.referenceWorkflow.agents.length ? (
                      <div>候选角色：{creationRecommendations.referenceWorkflow.agents.join('、')}</div>
                    ) : null}
                  </div>
                ) : null}
                {creationRecommendations.recommendedAgents.length || creationRecommendations.recommendedSupervisorAgent ? (
                  <div className="rounded-lg border bg-background/80 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">自动编排决策</div>
                    <div>指挥官：{creationRecommendations.recommendedSupervisorAgent || 'default-supervisor'}</div>
                    {creationRecommendations.recommendedAgents.length ? (
                      <div>默认角色编队：{creationRecommendations.recommendedAgents.join('、')}</div>
                    ) : (
                      <div>默认角色编队：将回退到基础角色骨架。</div>
                    )}
                    <div>当你未手动提供工作流模板时，SpecCoding 预览和 workflow 草案会直接采用这组编排决策。</div>
                  </div>
                ) : null}
                {creationRecommendations.relationshipHints.length ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-foreground">高协同编队</div>
                    {creationRecommendations.relationshipHints.slice(0, 3).map((item) => (
                      <div key={`${item.agent}-${item.counterpart}`} className="rounded-lg border bg-background/80 p-3 text-xs text-muted-foreground space-y-1">
                        <div className="font-medium text-foreground">{item.agent} × {item.counterpart}</div>
                        <div>协作倾向：{item.synergyScore >= 0 ? '+' : ''}{item.synergyScore}</div>
                        {item.strengths.length ? <div>强项：{item.strengths.join('、')}</div> : null}
                        {item.lastConfigFile ? <div>最近出现于：{item.lastConfigFile}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {creationRecommendations.experiences.length ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-foreground">相关历史经验</div>
                    {creationRecommendations.experiences.slice(0, 2).map((item) => (
                      <div key={item.runId} className="rounded-lg border bg-background/80 p-3 text-xs text-muted-foreground space-y-1">
                        <div className="font-medium text-foreground">{item.workflowName || item.configFile}</div>
                        <div>{item.summary}</div>
                        {item.experience[0] ? <div>经验：{item.experience[0]}</div> : null}
                        {item.nextFocus[0] ? <div>后续重点：{item.nextFocus[0]}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="workingDirectory">
              工作目录 <span className="text-destructive">*</span>
            </Label>
            <WorkspaceDirectoryPicker
              workspaceRoot="/"
              value={workingDirectoryValue || ''}
              onChange={handleWorkingDirectoryChange}
              autoSelectRootWhenEmpty
              className={errors.workingDirectory ? 'rounded-md border border-destructive p-1' : undefined}
            />
            {errors.workingDirectory && (
              <p className="text-sm text-destructive">{errors.workingDirectory.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              工作流执行时的工作目录
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspaceMode">
              工作区模式 <span className="text-destructive">*</span>
            </Label>
            <Select
              value={workspaceModeValue}
              onValueChange={(value: 'isolated-copy' | 'in-place') => {
                setValue('workspaceMode', value, { shouldDirty: true, shouldValidate: true });
              }}
            >
              <SelectTrigger id="workspaceMode" className={errors.workspaceMode ? 'border-destructive' : ''}>
                <SelectValue placeholder="选择工作区模式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in-place">直接在工作目录执行</SelectItem>
                <SelectItem value="isolated-copy">先创建副本工程再执行</SelectItem>
              </SelectContent>
            </Select>
            {errors.workspaceMode && (
              <p className="text-sm text-destructive">{errors.workspaceMode.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              推荐默认直接在工作目录执行；只有需要隔离原工程时再选择创建副本
            </p>
          </div>

          {specPlanningEnabled ? (
          <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
            <div className="space-y-1">
              <Label htmlFor="persistMode">Spec 持久化</Label>
              <p className="text-xs text-muted-foreground">
                可选择是否把正式计划制品同步保存到工作目录下，系统会记住本次选择。
              </p>
            </div>
            <Select
              value={persistModeValue}
              onValueChange={(value: 'none' | 'repository') => {
                setValue('persistMode', value, { shouldDirty: true, shouldValidate: true });
                if (value === 'repository' && !(getValues('specRoot') || '').trim()) {
                  setValue('specRoot', '.spec', { shouldDirty: true, shouldValidate: true });
                }
              }}
            >
              <SelectTrigger id="persistMode" className={errors.persistMode ? 'border-destructive' : ''}>
                <SelectValue placeholder="选择 Spec 持久化模式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不启用持久化 Spec</SelectItem>
                <SelectItem value="repository">启用仓库持久化 Spec</SelectItem>
              </SelectContent>
            </Select>
            {errors.persistMode && (
              <p className="text-sm text-destructive">{errors.persistMode.message}</p>
            )}
            {persistModeValue === 'repository' && (
              <div className="space-y-2">
                <Label htmlFor="specRoot">Spec 名称 / 目录</Label>
                <Input
                  id="specRoot"
                  placeholder=".spec"
                  {...register('specRoot')}
                  className={errors.specRoot ? 'border-destructive' : ''}
                />
                {errors.specRoot && (
                  <p className="text-sm text-destructive">{errors.specRoot.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  相对于工作目录保存，例如 `.spec`；留空时默认使用 `.spec`。
                </p>
              </div>
            )}
          </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="filename">
              文件名 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="filename"
              placeholder="my-workflow.yaml"
              {...register('filename', {
                onBlur: normalizeFilenameField,
              })}
              className={errors.filename ? 'border-destructive' : ''}
            />
            {errors.filename && (
              <p className="text-sm text-destructive">{errors.filename.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              文件名必须以 .yaml 结尾，只能包含字母、数字、下划线和连字符
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">描述（可选）</Label>
            <Textarea
              id="description"
              rows={3}
              placeholder="描述这个工作流的用途..."
              {...register('description')}
            />
          </div>
        </form>

        <div className="flex gap-2 justify-end p-6 pt-4 border-t flex-shrink-0">
          <Button type="button" variant="outline" onClick={handleClose}>
            取消
          </Button>
          <Button
            type="button"
            onClick={handleNextStep}
            disabled={isSubmitting || isGeneratingPlan}
          >
            {workflowMode === 'ai-guided'
              ? specPlanningEnabled
                ? (isGeneratingPlan ? '生成计划中...' : '下一步')
                : (isGeneratingPlan ? '生成草案中...' : '直接进入编排')
              : workflowMode === 'state-machine' && !specPlanningEnabled
                ? (isSubmitting ? '创建中...' : '创建')
                : (isSubmitting ? '创建中...' : '创建')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
