'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { useTheme } from 'next-themes';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { newConfigFormSchema, type NewConfigForm } from '@/lib/schemas';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import WorkflowModeSelector from './WorkflowModeSelector';
import { EngineModelSelect } from './EngineModelSelect';
import { ComboboxPortalProvider } from './ui/combobox';
import Markdown from './Markdown';
import UniversalCard from './chat/cards/UniversalCard';
import { parseActions } from '@/lib/chat-actions';
import WorkspaceDirectoryPicker from './common/WorkspaceDirectoryPicker';
import { useChat } from '@/contexts/ChatContext';
import { agentApi } from '@/lib/api';
import { resolveAgentAvatarSrc } from '@/lib/agent-personas';

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

const MAX_PLAN_DRAFT_REPAIR_ATTEMPTS = 2;
const MAX_WORKFLOW_DRAFT_REPAIR_ATTEMPTS = 2;
const CREATION_SESSION_TAG_PREFIX = '创建工作流 ·';
const SPEC_LANGUAGE_RULE = [
  '语言一致性规则：先判断用户原始需求、补充说明和澄清回答的主语言；所有 summary、clarification、requirements.md、design.md、tasks.md 必须统一使用该主语言。',
  '如果输入混合多种语言，以用户需求正文占比最高的语言为准；若用户最后明确指定语言，则以用户指定语言为准。',
  '文件名、代码、YAML key、API 名称、技术专名和产品名可以保留原文，但不要在多份正式计划制品之间混用中文和英文标题/说明。',
].join('\n');
const WORKFLOW_DRAFT_SYSTEM_GUARD_PROMPT = [
  '## Workflow 草案阶段硬约束',
  '当前处于创建工作流的 workflow 草案阶段。AI 只负责根据已确认的 SpecCoding/计划制品生成草案文本和机器可读 workflow_draft。',
  '可以为整理草案文本或辅助生成内容使用脚本，但不要写入最终 workflow 文件。',
  '禁止自行校验 workflow/YAML：不要调用 validateWorkflowDraft，不要运行 ts-node/Node 脚本校验 YAML，不要调用 config.validate，不要输出 action，也不要声称“我会做本地结构校验”或“我已本地校验”。',
  '系统会在你输出后自动解析 <result> 或 YAML 代码块，并使用服务端内建校验器判断 valid/invalid；校验失败时系统会把错误反馈给你继续修。',
  '你可以在心里做一致性自检，但对用户只展示草案、必要说明，以及最后的 <result> JSON。不要把“检查可用 Agent”“推断 schema”“本地校验”“运行 validateWorkflowDraft”写成任务列表。',
].join('\n');

type ModalAiMessage = { role: 'ai' | 'user' | 'thinking'; content: string };

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

function buildPlanDraftRepairMessage(previousOutput: string) {
  return [
    '系统校验错误：上一轮回复没有在 <result> 内返回可读取的正式计划草案。',
    '',
    '请继续当前对话，不要重新询问用户，不要解释错误原因，不要输出普通总结。',
    '你必须基于前文已经完成的澄清问答和上一轮内容，直接补发完整的机器可读计划草案。',
    '',
    '硬性格式要求：',
    '1. 最终输出必须包含一个 <result>...</result> 块。',
    '2. <result> 内只能放一个 ```json 代码块。',
    '3. JSON 顶层必须是 {"type":"plan_draft", ...}。',
    '4. 必须包含 summary、goals、nonGoals、constraints、clarification、artifacts。',
    '5. artifacts 必须包含 requirements、design、tasks 三个字符串字段。',
    '6. artifacts 字符串内如需 Mermaid 或代码块，用 ~~~ 代替 ``` 作为分隔符，避免与外层 JSON 代码块冲突。',
    '7. 输出 </result> 后不要再追加任何文字。',
    '',
    SPEC_LANGUAGE_RULE,
    '',
    '上一轮未通过校验的输出如下，供你提取内容并修正为合法结构：',
    '```text',
    previousOutput.slice(0, 6000),
    '```',
  ].join('\n');
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

function buildWorkflowDraftRepairMessage(previousOutput: string, validation: any, filename: string) {
  return [
    '系统校验错误：上一轮 workflow 草案没有通过内建校验，或者没有返回可读取的 workflow_draft 结果。',
    '',
    '请继续当前对话，不要重新询问用户，不要只输出解释，不要声明文件已经写入。',
    '禁止自行校验 workflow/YAML：不要调用 validateWorkflowDraft，不要运行 ts-node/Node 脚本校验 YAML，不要调用 config.validate，不要输出 action，也不要声称会做本地结构校验。',
    '系统已经完成解析/校验，并会继续负责下一次校验；你只需要按错误修正并补发完整 workflow_draft。',
    '你必须基于前文已确认的 SpecCoding、Agent 分工和上一轮草案，直接补发一个修正后的完整 workflow_draft。',
    '',
    '硬性格式要求：',
    '1. 最终输出必须包含一个 <result>...</result> 块。',
    '2. <result> 内只能放一个 ```json 代码块。',
    '3. JSON 顶层必须是 {"type":"workflow_draft", ...}。',
    `4. filename 必须是 "${filename}"。`,
    '5. config 必须是完整 AceHarness workflow 配置对象，包含 workflow 和 context。',
    '6. workflow.supervisor.agent 以及所有 step.agent 必须引用当前可用 Agent。',
    '7. context.projectRoot 必须是用户提供的绝对工作目录。',
    '8. 输出 </result> 后不要再追加任何文字。',
    '',
    '内建校验结果：',
    formatValidationIssuesForPrompt(validation),
    '',
    '上一轮未通过校验的输出如下，供你提取并修正：',
    '```text',
    previousOutput.slice(0, 8000),
    '```',
  ].join('\n');
}

function truncateForPrompt(input: string | undefined, limit = 5000) {
  const text = (input || '').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n...[已截断，原文过长]`;
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
  relationshipHints: Array<{
    agent: string;
    counterpart: string;
    synergyScore: number;
    strengths: string[];
    lastConfigFile?: string;
  }>;
};

type SpecCodingArtifactKey = 'requirements' | 'design' | 'tasks';

type SpecCodingArtifactDrafts = Record<SpecCodingArtifactKey, string>;

type PlanDraftResult = {
  type: 'plan_draft';
  summary?: string;
  goals?: string[];
  nonGoals?: string[];
  constraints?: string[];
  clarification?: {
    summary?: string;
    knownFacts?: string[];
    missingFields?: string[];
    questions?: string[];
  };
  artifacts?: {
    requirements?: string;
    design?: string;
    tasks?: string;
  };
};

type WorkflowDraftPreviewState = {
  source: 'result-json' | 'yaml' | 'none';
  filename?: string;
  summary?: string;
  yaml?: string;
  config?: any | null;
  parseError?: string;
  validation?: any;
};

type ClarificationQuestionItem = {
  id: string;
  label: string;
  question: string;
  selectionMode?: 'single' | 'multiple';
  options: Array<{
    id: string;
    label: string;
    description?: string;
    recommended?: boolean;
  }>;
  placeholder?: string;
  required?: boolean;
};

type ClarificationAnswerValue = {
  optionIds: string[];
  note: string;
};

type ClarificationFormResult = {
  type: 'clarification_form';
  summary?: string;
  knownFacts?: string[];
  missingFields?: string[];
  questions: ClarificationQuestionItem[];
};

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

async function modalAuthJsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

function formatWorkflowCondition(condition: any): string {
  if (!condition || typeof condition !== 'object') return '';
  if (typeof condition.verdict === 'string') return `verdict=${condition.verdict}`;
  const entries = Object.entries(condition)
    .filter(([, value]) => value !== undefined && value !== null)
    .slice(0, 3);
  if (entries.length === 0) return '';
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(', ');
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

function extractStructuredResult<T>(markdown: string, expectedType: string): T | null {
  const resultRegex = /<result>([\s\S]*?)<\/result>/g;
  let resultMatch: RegExpExecArray | null;

  while ((resultMatch = resultRegex.exec(markdown)) !== null) {
    const content = resultMatch[1];
    const jsonRegex = /```json\s*([\s\S]*?)```/g;
    let jsonMatch: RegExpExecArray | null;

    while ((jsonMatch = jsonRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (parsed?.type === expectedType) {
          return parsed as T;
        }
      } catch {
        // ignore malformed json block
      }
    }
  }

  return null;
}

function extractPlanDraftResult(markdown: string): PlanDraftResult | null {
  return extractStructuredResult<PlanDraftResult>(markdown, 'plan_draft');
}

function extractWorkflowDraftPreview(markdown: string, fallbackFilename?: string): WorkflowDraftPreviewState {
  let parseError = '';
  const resultRegex = /<result>([\s\S]*?)<\/result>/g;
  let resultMatch: RegExpExecArray | null;

  while ((resultMatch = resultRegex.exec(markdown)) !== null) {
    const content = resultMatch[1];
    const jsonRegex = /```json\s*([\s\S]*?)```/g;
    let jsonMatch: RegExpExecArray | null;

    while ((jsonMatch = jsonRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (parsed?.type !== 'workflow_draft') continue;
        if (!parsed.config || typeof parsed.config !== 'object') {
          return {
            source: 'result-json',
            filename: typeof parsed.filename === 'string' ? parsed.filename : fallbackFilename,
            summary: typeof parsed.summary === 'string' ? parsed.summary : '',
            config: null,
            parseError: 'workflow_draft.config 缺失或不是对象',
          };
        }
        return {
          source: 'result-json',
          filename: typeof parsed.filename === 'string' ? parsed.filename : fallbackFilename,
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
          config: parsed.config,
          yaml: stringifyYaml(parsed.config),
        };
      } catch (error: any) {
        parseError = `workflow_draft JSON 解析失败: ${error?.message || 'JSON 格式错误'}`;
      }
    }
  }

  const yamlBlocks = [...markdown.matchAll(/```ya?ml\s*([\s\S]*?)```/gi)];
  for (let index = yamlBlocks.length - 1; index >= 0; index -= 1) {
    const rawYaml = yamlBlocks[index]?.[1]?.trim() || '';
    if (!rawYaml) continue;
    try {
      const config = parseYaml(rawYaml);
      if (!config || typeof config !== 'object') {
        parseError = 'YAML 解析成功，但结果不是对象';
        continue;
      }
      return {
        source: 'yaml',
        filename: fallbackFilename,
        config,
        yaml: rawYaml,
      };
    } catch (error: any) {
      parseError = `YAML 解析失败: ${error?.message || 'YAML 格式错误'}`;
    }
  }

  return {
    source: 'none',
    filename: fallbackFilename,
    config: null,
    parseError: parseError || '未检测到可读取的 workflow_draft JSON 或 YAML 代码块',
  };
}

function extractClarificationFormResult(markdown: string): ClarificationFormResult | null {
  const parsed = extractStructuredResult<ClarificationFormResult>(markdown, 'clarification_form');
  if (!parsed) return null;
  return {
    ...parsed,
    questions: Array.isArray(parsed.questions)
      ? parsed.questions
        .filter((item) => item && typeof item.question === 'string')
        .map((item, index) => ({
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `question_${index + 1}`,
          label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : `问题 ${index + 1}`,
          question: item.question.trim(),
          selectionMode: ((item as any).selectionMode === 'multiple' ? 'multiple' : 'single') as 'single' | 'multiple',
          options: Array.isArray((item as any).options)
            ? (item as any).options
              .filter((option: any) => option && typeof option.label === 'string' && option.label.trim())
              .map((option: any, optionIndex: number) => ({
                id: typeof option.id === 'string' && option.id.trim() ? option.id.trim() : `option_${optionIndex + 1}`,
                label: option.label.trim(),
                description: typeof option.description === 'string' ? option.description.trim() : '',
                recommended: option.recommended === true,
              }))
              .slice(0, 4)
            : [],
          placeholder: typeof item.placeholder === 'string' ? item.placeholder.trim() : '',
          required: item.required !== false,
        }))
        .filter((item) => item.options.length > 0)
        .slice(0, 6)
      : [],
  };
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
      `- 参考 workflow: ${recommendations.referenceWorkflow.name || recommendations.referenceWorkflow.filename}`,
      `- 模式: ${recommendations.referenceWorkflow.mode === 'state-machine' ? '状态机' : '阶段式'}`,
      recommendations.referenceWorkflow.agents.length
        ? `- 可优先复用的角色: ${recommendations.referenceWorkflow.agents.join('、')}`
        : '',
      recommendations.referenceWorkflow.supervisorAgent
        ? `- 可复用指挥官: ${recommendations.referenceWorkflow.supervisorAgent}`
        : '',
      recommendations.referenceWorkflow.autoApply
        ? '- 当前若未手动指定参考工作流，系统会自动采用这份骨架参与生成'
        : '',
    ].filter(Boolean).join('\n'));
  }

  if (recommendations.recommendedAgents.length || recommendations.recommendedSupervisorAgent) {
    sections.push([
      '**自动编排决策**',
      recommendations.recommendedSupervisorAgent ? `- 指挥官: ${recommendations.recommendedSupervisorAgent}` : '',
      recommendations.recommendedAgents.length ? `- 推荐角色编队: ${recommendations.recommendedAgents.join('、')}` : '',
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
  usedAgents: Set<string>
) {
  const candidate = (recommendedAgents || []).find((agent) => agent && !usedAgents.has(agent));
  if (candidate) {
    usedAgents.add(candidate);
    return candidate;
  }
  usedAgents.add(fallback);
  return fallback;
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
  const primaryAgent = pickRecommendedAgent(recommendedAgents, 'developer', usedAgents);
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
  const analysisAgent = pickRecommendedAgent(recommendedAgents, 'architect', usedAgents);
  const designAgent = pickRecommendedAgent(recommendedAgents, analysisAgent || 'architect', usedAgents);
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
          transitions: [
            { to: '方案设计', condition: { verdict: 'pass' }, priority: 1, label: '分析完成' },
            { to: '需求分析', condition: { verdict: 'conditional_pass' }, priority: 2, label: '继续澄清' },
          ],
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
          transitions: [
            { to: '完成', condition: { verdict: 'pass' }, priority: 1, label: '设计完成' },
            { to: '方案设计', condition: { verdict: 'conditional_pass' }, priority: 2, label: '继续调整' },
          ],
        },
        {
          name: '完成',
          description: '输出 workflow 配置草案并等待确认。',
          isInitial: false,
          isFinal: true,
          position: { x: 640, y: 160 },
          steps: [
            { name: '输出草案', agent: recommendedSupervisorAgent || 'default-supervisor', role: 'judge', task: '整理 workflow 草案，等待用户确认。' },
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
      description: '确认目标、约束、工作目录与参考 workflow',
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
    <div className="grid grid-cols-4 gap-3 rounded-xl border bg-muted/20 p-4">
        {items.map((item) => {
          const state = item.step < currentStep ? 'done' : item.step === currentStep ? 'current' : 'pending';
          return (
            <div
              key={item.step}
              className={`min-w-0 rounded-xl border p-3 transition-colors ${
                state === 'current'
                  ? 'border-primary bg-primary/5'
                  : state === 'done'
                    ? 'border-emerald-500/40 bg-emerald-500/5'
                    : 'border-border bg-background'
              }`}
            >
              <div className="flex items-center gap-2 whitespace-nowrap">
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    state === 'current'
                      ? 'bg-primary text-primary-foreground'
                      : state === 'done'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {state === 'done' ? '✓' : item.step}
                </div>
                <div className="truncate text-sm font-medium">{item.title}</div>
              </div>
              <div className="mt-2 hidden truncate whitespace-nowrap text-xs text-muted-foreground xl:block">{item.description}</div>
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
          {issues.slice(0, 5).map((issue: any, index: number) => (
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
}: NewConfigModalProps) {
  const { toast } = useToast();
  const { appendVisibleSessionTag, appendSessionMessage } = useChat();
  const { resolvedTheme } = useTheme();
  const [workflowMode, setWorkflowMode] = useState<'phase-based' | 'state-machine' | 'ai-guided'>('phase-based');
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
  const [savingArtifact, setSavingArtifact] = useState(false);
  const [isRevisingPlan, setIsRevisingPlan] = useState(false);
  const [selectedSnapshotVersion, setSelectedSnapshotVersion] = useState<string>('current');
  const [planningStage, setPlanningStage] = useState<'idle' | 'clarifying' | 'awaiting-answers' | 'generating-plan'>('idle');
  const [clarificationForm, setClarificationForm] = useState<ClarificationFormResult | null>(null);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, ClarificationAnswerValue>>({});

  // AI streaming state
  const [aiPhase, setAiPhase] = useState<'idle' | 'streaming' | 'waiting' | 'done'>('idle');
  const [aiMessages, setAiMessages] = useState<ModalAiMessage[]>([]);
  const [currentStream, setCurrentStream] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [userInput, setUserInput] = useState('');
  const [aiFilename, setAiFilename] = useState('');
  const [workflowDraftConfig, setWorkflowDraftConfig] = useState<any | null>(null);
  const [workflowDraftValidation, setWorkflowDraftValidation] = useState<any | null>(null);
  const [workflowDraftPreview, setWorkflowDraftPreview] = useState<WorkflowDraftPreviewState | null>(null);
  const [isSavingWorkflowDraft, setIsSavingWorkflowDraft] = useState(false);
  const [backendSessionId, setBackendSessionId] = useState<string | undefined>();
  const streamContentRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const userInputRef = useRef<HTMLInputElement>(null);
  const restoringSessionRef = useRef(false);
  const restoreGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredPlanningSessionRef = useRef<string | null>(null);
  const reconnectingPlanningChatIdRef = useRef<string | null>(null);

  // Engine/model selection for AI mode
  const [aiEngine, setAiEngine] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiRestartFlag, setAiRestartFlag] = useState(0);
  const [referenceWorkflows, setReferenceWorkflows] = useState<ReferenceWorkflowSummary[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceConfig, setReferenceConfig] = useState<{ config: any; raw: string } | null>(null);
  const [referenceConfigLoading, setReferenceConfigLoading] = useState(false);
  const [creationRecommendations, setCreationRecommendations] = useState<WorkflowCreationRecommendations | null>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [planningFrontendSessionId, setPlanningFrontendSessionId] = useState<string | null>(frontendSessionId || null);
  const [draftCreationSessionId, setDraftCreationSessionId] = useState<string | null>(resumeCreationSessionId || null);
  // Refs to always read latest engine/model in sendToAi
  const aiEngineRef = useRef('');
  const aiModelRef = useRef('');

  const resolveFormStepFromSession = useCallback((session: any): 1 | 2 | 3 | 4 | 5 => {
    if (!session?.specCoding) return 1;
    if (session.status === 'draft') return 4;
    if (session.mode === 'ai-guided' && session.status === 'confirmed') {
      return 5;
    }
    if (session.status === 'confirmed' || session.status === 'config-generated' || session.status === 'run-bound') {
      return 4;
    }
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
    }, 0);
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
    },
  });
  const workflowNameValue = watch('workflowName');
  const filenameValue = watch('filename');
  const referenceWorkflowValue = watch('referenceWorkflow');
  const workingDirectoryValue = watch('workingDirectory');
  const workspaceModeValue = watch('workspaceMode');
  const descriptionValue = watch('description');
  const requirementsValue = watch('requirements');
  const effectiveReferenceWorkflowValue = useMemo(() => {
    if (referenceWorkflowValue) return referenceWorkflowValue;
    if (creationRecommendations?.referenceWorkflow?.autoApply) {
      return creationRecommendations.referenceWorkflow.filename;
    }
    return '';
  }, [creationRecommendations?.referenceWorkflow, referenceWorkflowValue]);
  const recommendedAgents = creationRecommendations?.recommendedAgents || [];
  const recommendedSupervisorAgent = creationRecommendations?.recommendedSupervisorAgent || 'default-supervisor';
  const creationDialogClassName = creationFullscreen
    ? 'flex h-screen max-h-none w-screen max-w-none flex-col p-0 sm:rounded-none'
    : 'max-w-4xl flex flex-col p-0 max-h-[90vh]';
  const planWorkspaceDialogClassName = planWorkspaceFullscreen
    ? 'flex h-screen max-h-none w-screen max-w-none flex-col p-0 sm:rounded-none'
    : 'flex h-[92vh] max-h-[92vh] w-[96vw] max-w-[96vw] flex-col p-0';

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
    if (!isOpen || !resumeCreationSessionId) return;
    let cancelled = false;
    modalSessionJsonFetch<any>(`/api/spec-coding/sessions/${encodeURIComponent(resumeCreationSessionId)}`)
      .then((data) => {
        if (cancelled || !data?.session) return;
        const session = data.session;
        beginSessionRestoreGuard();
        setPreviewSession(session);
        setPreviewConfigValidation(null);
        setWorkflowMode(session.mode || 'ai-guided');
        setDraftCreationSessionId(session.id);
        setValue('mode', session.mode || 'ai-guided', { shouldDirty: false, shouldValidate: false });
        setValue('workflowName', session.workflowName || '', { shouldDirty: false, shouldValidate: false });
        setValue('filename', session.filename || '', { shouldDirty: false, shouldValidate: false });
        setValue('referenceWorkflow', session.referenceWorkflow || '', { shouldDirty: false, shouldValidate: false });
        setValue('workingDirectory', session.workingDirectory || '', { shouldDirty: false, shouldValidate: false });
        setValue('workspaceMode', session.workspaceMode || 'in-place', { shouldDirty: false, shouldValidate: false });
        setValue('description', session.description || '', { shouldDirty: false, shouldValidate: false });
        setValue('requirements', session.requirements || '', { shouldDirty: false, shouldValidate: false });
        setPlanningFrontendSessionId((prev) => session.chatSessionId || prev);
        if (session.uiState?.clarificationForm) {
          setClarificationForm(session.uiState.clarificationForm);
          setClarificationAnswers(session.uiState.clarificationAnswers || {});
          setPlanningStage(session.uiState.planningStage || 'awaiting-answers');
        }
        setFormStep(session.uiState?.formStep || resolveFormStepFromSession(session));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [beginSessionRestoreGuard, isOpen, resolveFormStepFromSession, resumeCreationSessionId, setValue]);

  useEffect(() => {
    if (!isOpen || resumeCreationSessionId || previewSession || !frontendSessionId) return;
    let cancelled = false;
    modalSessionJsonFetch<any>(`/api/spec-coding/sessions?chatSessionId=${encodeURIComponent(frontendSessionId)}`)
      .then((data) => {
        if (cancelled || !Array.isArray(data?.sessions) || data.sessions.length === 0) return;
        const session = data.sessions[0];
        if (!session) return;
        beginSessionRestoreGuard();
        setPreviewSession(session);
        setDraftCreationSessionId(session.id);
        setPlanningFrontendSessionId((prev) => session.chatSessionId || prev);
        setWorkflowMode(session.mode || 'ai-guided');
        setValue('mode', session.mode || 'ai-guided', { shouldDirty: false, shouldValidate: false });
        setValue('workflowName', session.workflowName || '', { shouldDirty: false, shouldValidate: false });
        setValue('filename', session.filename || '', { shouldDirty: false, shouldValidate: false });
        setValue('referenceWorkflow', session.referenceWorkflow || '', { shouldDirty: false, shouldValidate: false });
        setValue('workingDirectory', session.workingDirectory || '', { shouldDirty: false, shouldValidate: false });
        setValue('workspaceMode', session.workspaceMode || 'in-place', { shouldDirty: false, shouldValidate: false });
        setValue('description', session.description || '', { shouldDirty: false, shouldValidate: false });
        setValue('requirements', session.requirements || '', { shouldDirty: false, shouldValidate: false });
        if (session.uiState?.clarificationForm) {
          setClarificationForm(session.uiState.clarificationForm);
          setClarificationAnswers(session.uiState.clarificationAnswers || {});
          setPlanningStage(session.uiState.planningStage || 'awaiting-answers');
        }
        setFormStep(session.uiState?.formStep || resolveFormStepFromSession(session));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [beginSessionRestoreGuard, frontendSessionId, isOpen, previewSession, resolveFormStepFromSession, resumeCreationSessionId, setValue]);

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
  }, [descriptionValue, isOpen, referenceWorkflowValue, requirementsValue, workflowNameValue, workingDirectoryValue]);

  useEffect(() => {
    if (restoringSessionRef.current) return;
    if (!previewSession) return;
    const changed =
      previewSession.workflowName !== workflowNameValue
      || previewSession.filename !== filenameValue
      || (previewSession.referenceWorkflow || '') !== (effectiveReferenceWorkflowValue || '')
      || previewSession.workingDirectory !== workingDirectoryValue
      || previewSession.workspaceMode !== workspaceModeValue
      || (previewSession.description || '') !== (descriptionValue || '')
      || (previewSession.requirements || '') !== (requirementsValue || '')
      || previewSession.mode !== workflowMode;
    if (changed) {
      setPreviewSession(null);
      setPreviewConfigValidation(null);
      if (formStep === 2 || formStep === 3 || formStep === 4) {
        setFormStep(1);
      }
      setPlanningStage('idle');
      setClarificationForm(null);
      setClarificationAnswers({});
    }
  }, [
    descriptionValue,
    filenameValue,
    formStep,
    previewSession,
    requirementsValue,
    effectiveReferenceWorkflowValue,
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
  }, [previewSession?.id, previewSession?.specCoding?.version, artifactsSyncKey]);

  useEffect(() => {
    const snapshots = previewSession?.artifactSnapshots || [];
    const previous = [...snapshots]
      .filter((item: any) => item.version !== previewSession?.specCoding?.version)
      .sort((a: any, b: any) => b.version - a.version)[0];
    setSelectedSnapshotVersion(previous ? String(previous.version) : 'current');
  }, [previewSession?.artifactSnapshots, previewSession?.specCoding?.version]);

  const applySchemaIssues = useCallback((issues: Array<{ path?: (string | number)[]; message?: string }>) => {
    const supported = ['filename', 'workflowName', 'referenceWorkflow', 'workingDirectory', 'workspaceMode', 'description', 'requirements', 'mode'];
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

  // Auto-scroll streaming content
  useEffect(() => {
    if (streamContentRef.current) {
      streamContentRef.current.scrollTop = streamContentRef.current.scrollHeight;
    }
  }, [aiMessages, currentStream, currentThinking]);

  // Focus input when waiting
  useEffect(() => {
    if (aiPhase === 'waiting' && userInputRef.current) {
      userInputRef.current.focus();
    }
  }, [aiPhase]);

  // Cleanup on unmount/close
  const cleanupStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (chatIdRef.current) {
      fetch(`/api/chat/stream?id=${encodeURIComponent(chatIdRef.current)}`, { method: 'DELETE' }).catch(() => {});
      chatIdRef.current = null;
    }
  }, []);

  const interruptPlanningRun = useCallback(() => {
    cleanupStream();
    setCurrentStream('');
    setCurrentThinking('');
    setIsGeneratingPlan(false);
  }, [cleanupStream]);

  const appendPlanningAssistantMessage = useCallback(async (
    sessionId: string | null | undefined,
    content: string,
    backendSid?: string
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

  const resetAll = useCallback(() => {
    interruptPlanningRun();
    setAiPhase('idle');
    setAiMessages([]);
    setUserInput('');
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
    setPreviewSession(null);
    setPreviewConfigValidation(null);
  }, [interruptPlanningRun]);

  // When engine or model changes during workflow creation, restart the AI conversation
  const handleAiEngineChange = (engine: string) => {
    setAiEngine(engine);
    aiEngineRef.current = engine;
    if (formStep === 5) {
      cleanupStream();
      setAiMessages([]);
      setCurrentStream('');
      setCurrentThinking('');
      setAiFilename('');
      setWorkflowDraftConfig(null);
      setWorkflowDraftValidation(null);
      setWorkflowDraftPreview(null);
      setBackendSessionId(undefined);
      setAiRestartFlag(f => f + 1);
    }
  };
  const handleAiModelChange = (model: string) => {
    setAiModel(model);
    aiModelRef.current = model;
    if (formStep === 5) {
      cleanupStream();
      setAiMessages([]);
      setCurrentStream('');
      setCurrentThinking('');
      setAiFilename('');
      setWorkflowDraftConfig(null);
      setWorkflowDraftValidation(null);
      setWorkflowDraftPreview(null);
      setBackendSessionId(undefined);
      setAiRestartFlag(f => f + 1);
    }
  };

  const validateWorkflowDraftConfig = useCallback(async (config: any) => {
    const data = await modalAuthJsonFetch<any>('/api/configs/validate', {
      method: 'POST',
      body: JSON.stringify({ config }),
    });
    return data.validation || data;
  }, []);

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

  // Send a message to the AI stream and show the response
  const sendToAi = useCallback(async (
    message: string,
    sessionId?: string,
    options?: { workflowDraftAttempt?: number }
  ) => {
    setAiPhase('streaming');
    setCurrentStream('');
    setCurrentThinking('');
    const workflowDraftAttempt = options?.workflowDraftAttempt || 0;

    try {
      const startRes = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          model: aiModelRef.current,
          engine: aiEngineRef.current,
          sessionId: sessionId || undefined,
          mode: 'dashboard',
          workingDirectory: getValues('workingDirectory') || undefined,
          extraSystemPrompt: formStep === 5 ? WORKFLOW_DRAFT_SYSTEM_GUARD_PROMPT : undefined,
        }),
      });

      const startData = await startRes.json();
      if (!startRes.ok || !startData.chatId) {
        toast('error', startData.error || 'AI 流式请求失败');
        setAiPhase('waiting');
        return;
      }

      const chatId = startData.chatId;
      chatIdRef.current = chatId;

      const es = new EventSource(`/api/chat/stream?id=${chatId}`);
      eventSourceRef.current = es;
      let accumulated = '';
      let thinkingAccumulated = '';

      es.addEventListener('delta', (e) => {
        const { content } = JSON.parse(e.data);
        accumulated += content;
        setCurrentStream(accumulated);
      });

      es.addEventListener('thinking', (e) => {
        const { content } = JSON.parse(e.data);
        thinkingAccumulated += content;
        setCurrentThinking(thinkingAccumulated);
      });

      es.addEventListener('done', async (e) => {
        const data = JSON.parse(e.data);
        es.close();
        eventSourceRef.current = null;
        chatIdRef.current = null;

        if (data.sessionId) {
          setBackendSessionId(data.sessionId);
        }

        const finalContent = data.result || accumulated;
        const activeSessionId = data.sessionId || sessionId;

        setAiMessages(prev => {
          const msgs = [...prev];
          if (thinkingAccumulated) {
            msgs.push({ role: 'thinking', content: thinkingAccumulated });
          }
          msgs.push({ role: 'ai', content: finalContent });
          return msgs;
        });
        setCurrentStream('');
        setCurrentThinking('');

        const expectedFilename = (getValues('filename') || '').trim();
        const fileMention = finalContent.match(/configs\/([a-zA-Z0-9_.-]+\.ya?ml)/i);
        const mentionedFilename = fileMention?.[1]?.replace(/\.yml$/i, '.yaml') || '';
        const targetFilename = expectedFilename || mentionedFilename;
        const draftPreview = extractWorkflowDraftPreview(finalContent, targetFilename);
        const draftConfig = draftPreview.config && typeof draftPreview.config === 'object' ? draftPreview.config : null;
        setWorkflowDraftPreview(draftPreview);

        if (draftConfig) {
          const validation = await validateWorkflowDraftConfig(draftConfig);
          const previewWithValidation = {
            ...draftPreview,
            config: validation?.normalized || draftConfig,
            yaml: draftPreview.yaml || stringifyYaml(validation?.normalized || draftConfig),
            validation,
          };
          setWorkflowDraftPreview(previewWithValidation);
          setWorkflowDraftValidation(validation);
          if (!validation?.ok) {
            setWorkflowDraftConfig(null);
            setWorkflowDraftPreview(previewWithValidation);
            if (workflowDraftAttempt < MAX_WORKFLOW_DRAFT_REPAIR_ATTEMPTS) {
              await sendToAi(
                buildWorkflowDraftRepairMessage(finalContent, validation, targetFilename || draftPreview.filename || 'workflow.yaml'),
                activeSessionId,
                { workflowDraftAttempt: workflowDraftAttempt + 1 }
              );
              return;
            }
            setAiPhase('waiting');
            return;
          }
          setWorkflowDraftConfig(validation.normalized || draftConfig);
        }

        if (targetFilename) {
          const existing = await checkExistingWorkflowFile(targetFilename);
          if (existing.ok) {
            setAiFilename(targetFilename);
            setWorkflowDraftConfig(existing.config);
            setWorkflowDraftValidation(existing.validation);
            setWorkflowDraftPreview({
              source: 'yaml',
              filename: targetFilename,
              config: existing.config,
              yaml: stringifyYaml(existing.config),
              validation: existing.validation,
            });
            setAiPhase('done');
            return;
          }
        }

        if (!draftConfig && targetFilename && workflowDraftAttempt < MAX_WORKFLOW_DRAFT_REPAIR_ATTEMPTS) {
          await sendToAi(
            buildWorkflowDraftRepairMessage(
              finalContent,
              { ok: false, message: draftPreview.parseError || `系统未检测到已创建且合规的 configs/${targetFilename}，并且上一轮没有返回 workflow_draft.config。` },
              targetFilename
            ),
            activeSessionId,
            { workflowDraftAttempt: workflowDraftAttempt + 1 }
          );
          return;
        }

        if (draftConfig) {
          setAiFilename('');
          setAiPhase('waiting');
        } else if (finalContent.includes('验证通过') || finalContent.includes('创建成功') || finalContent.includes('已写入')) {
          setAiPhase('waiting');
        } else {
          setAiPhase('waiting');
        }
      });

      es.addEventListener('error', () => {
        es.close();
        eventSourceRef.current = null;
        chatIdRef.current = null;
        if (accumulated) {
          setAiMessages(prev => {
            const msgs = [...prev];
            if (thinkingAccumulated) msgs.push({ role: 'thinking', content: thinkingAccumulated });
            msgs.push({ role: 'ai', content: accumulated });
            return msgs;
          });
        }
        setCurrentStream('');
        setCurrentThinking('');
        setAiPhase('waiting');
      });
    } catch (err: any) {
      toast('error', 'AI 请求失败: ' + err.message);
      setAiPhase('waiting');
    }
  }, [checkExistingWorkflowFile, formStep, getValues, toast, validateWorkflowDraftConfig]);

  // PLACEHOLDER_SUBMIT_AND_RENDER

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

  const bindDraftCreationSessionToChat = useCallback(async (session: any) => {
    if (!frontendSessionId || !session?.id) return;
    const sessionData = await modalSessionJsonFetch<any>(`/api/chat/sessions/${encodeURIComponent(frontendSessionId)}`);
    if (!sessionData?.session) return;
    await modalSessionJsonFetch(`/api/chat/sessions/${encodeURIComponent(frontendSessionId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...sessionData.session,
        creationSession: {
          creationSessionId: session.id,
          filename: session.filename,
          workflowName: session.workflowName,
          status: session.status,
          specCodingId: session.specCoding?.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
      }),
    }).catch(() => {});
  }, [frontendSessionId]);

  const createPreviewSession = useCallback(async (draft?: PlanDraftResult, chatSessionId?: string | null) => {
    const values = getValues();
    const previewConfig = buildPreviewConfigFromForm();
    const targetChatSessionId = chatSessionId || frontendSessionId || undefined;
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
      status: 'draft',
      specCodingStatus: 'draft',
      filename: values.filename,
      workflowName: values.workflowName,
      referenceWorkflow: effectiveReferenceWorkflowValue,
      mode: workflowMode,
      workingDirectory: values.workingDirectory,
      workspaceMode: values.workspaceMode,
      description: values.description,
      requirements: values.requirements,
      clarification: draftData.clarification,
      config: previewConfig,
      specCoding: draftData.specCoding,
      uiState: {
        formStep: 4,
        planningStage: 'idle',
        clarificationForm: clarificationForm || undefined,
        clarificationAnswers,
      },
    };
    const data = draftCreationSessionId
      ? await modalSessionJsonFetch<any>(`/api/spec-coding/sessions/${encodeURIComponent(draftCreationSessionId)}`, {
          method: 'PUT',
          body: JSON.stringify(sessionPayload),
        })
      : await modalSessionJsonFetch<any>('/api/spec-coding/sessions', {
          method: 'POST',
          body: JSON.stringify(sessionPayload),
        });
    if (!data?.session) {
      throw new Error(data?.error || '生成计划预览失败');
    }
    setPreviewSession(data.session);
    setDraftCreationSessionId(data.session.id);
    await bindDraftCreationSessionToChat(data.session);
    return data.session;
  }, [bindDraftCreationSessionToChat, buildPreviewConfigFromForm, clarificationAnswers, clarificationForm, draftCreationSessionId, effectiveReferenceWorkflowValue, frontendSessionId, getValues, workflowMode]);

  const updatePreviewSessionFromPlanDraft = useCallback(async (draft: PlanDraftResult, revisionSummary: string) => {
    if (!previewSession?.id) {
      throw new Error('当前没有可修订的计划预览');
    }

    const values = getValues();
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
        chatSessionId: planningFrontendSessionId || frontendSessionId || previewSession.chatSessionId,
        status: 'draft',
        specCodingStatus: 'draft',
        filename: values.filename,
        workflowName: values.workflowName,
        referenceWorkflow: effectiveReferenceWorkflowValue,
        mode: workflowMode,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode,
        description: values.description,
        requirements: values.requirements,
        clarification: draftData.clarification,
        config: previewConfig,
        specCoding: draftData.specCoding,
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
    return data.session;
  }, [bindDraftCreationSessionToChat, buildPreviewConfigFromForm, clarificationAnswers, clarificationForm, effectiveReferenceWorkflowValue, frontendSessionId, getValues, planningFrontendSessionId, previewSession, workflowMode]);

  const ensureDraftCreationSession = useCallback(async (chatSessionId?: string | null) => {
    if (draftCreationSessionId) return draftCreationSessionId;
    const values = getValues();
    const config = buildPreviewConfigFromForm();
    const data = await modalSessionJsonFetch<any>('/api/spec-coding/sessions', {
      method: 'POST',
      body: JSON.stringify({
        chatSessionId: chatSessionId || frontendSessionId || undefined,
        status: 'draft',
        specCodingStatus: 'draft',
        filename: values.filename,
        workflowName: values.workflowName,
        referenceWorkflow: effectiveReferenceWorkflowValue,
        mode: workflowMode,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode,
        description: values.description,
        requirements: values.requirements,
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
    await bindDraftCreationSessionToChat(data.session);
    return data.session.id as string;
  }, [bindDraftCreationSessionToChat, buildPreviewConfigFromForm, draftCreationSessionId, effectiveReferenceWorkflowValue, frontendSessionId, getValues, workflowMode]);

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
        uiState: {
          formStep: input.formStep,
          planningStage: input.planningStage,
          clarificationForm: input.clarificationForm || undefined,
          clarificationAnswers: input.clarificationAnswers || {},
        },
      }),
    }).catch(() => {});
  }, [ensureDraftCreationSession, planningFrontendSessionId]);

  const ensurePlanningChatSession = useCallback(async () => {
    if (frontendSessionId) return frontendSessionId;
    if (planningFrontendSessionId) return planningFrontendSessionId;
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
    return data.session.id as string;
  }, [frontendSessionId, getValues, planningFrontendSessionId]);

  const buildClarificationSystemPrompt = useCallback((previewConfig: any) => {
    const data = getValues();
    const reqs = data.requirements || data.description || '';
    const workDir = data.workingDirectory;
    const referencePrompt = data.referenceWorkflow && referenceConfig
      ? [
          `参考工作流: ${data.referenceWorkflow}`,
          '请把它作为结构和协作风格参考，但当前阶段不要直接产出最终计划制品。',
        ].join('\n')
      : '';

    return [
      '你正在帮助用户做正式计划前的需求访谈。目标不是多问问题，而是补齐会改变方案、边界、兼容、验收或任务拆分的关键信息。',
      '先从用户输入、工作目录、参考工作流和已有上下文中提炼已确认事实；不要重复询问已经给出的信息，也不要把推测写成事实。',
      '本轮输出必须像资深产品/技术负责人做需求访谈：先给当前理解，再指出证据来源，再把缺口分为 blocking 与 optional，最后只问 3 到 7 个高价值问题。',
      '问题必须落到具体决策：目标用户与成功结果、当前行为与目标行为、范围与非目标、输入/输出/状态、兼容/迁移、失败/边界、安全/隐私、性能/可靠性、验证/发布。',
      '每个问题都使用结构化表单表达：声明 selectionMode=single 或 selectionMode=multiple，提供 2 到 4 个选项，至少一个选项带 recommended=true，同时保留 placeholder 供用户补充自由文本。',
      '每个问题的题面都要说明“这个答案会影响什么决策”，避免“还需要什么功能”“是否要优化体验”“是否需要联调”这类无法直接落地的问题。',
      '如果用户跳过某个问题，后续计划应采用保守默认假设；因此问题的 placeholder 或选项描述里要能看出默认假设和剩余风险。',
      '机器可读结果放在 <result>...</result> 内，并且 <result> 内只放一个独立的 ```json 代码块。',
      SPEC_LANGUAGE_RULE,
      '结构如下：',
      '<result>',
      '```json',
      JSON.stringify({
        type: 'clarification_form',
        summary: '当前理解：用户要为某个工作目录创建可执行工作流；已知目标、入口或约束不足，需要先确认会影响计划 DSL 的关键决策。',
        knownFacts: [
          '用户已提供工作流名称和工作目录，证据来自表单字段。',
          '用户已描述主要诉求，证据来自需求描述。',
        ],
        missingFields: [
          'blocking: 目标用户、成功结果和本次必须覆盖的主流程仍未确认',
          'blocking: 当前行为、目标行为和不做范围仍未确认',
          'blocking: 兼容/迁移和失败路径要求仍未确认',
          'optional: 验证命令、人工验收证据和发布偏好可进一步补充',
        ],
        questions: [
          {
            id: 'target_outcome',
            label: '目标结果',
            question: '这次工作流创建完成后，最重要的可观察成功结果是什么？这个答案会决定 requirements 的目标、需求优先级和验收标准。',
            selectionMode: 'single',
            options: [
              {
                id: 'implementation_ready',
                label: '可直接实现(推荐)',
                description: '产出能直接进入编码、验证和交付的计划，包含明确任务、入口、数据和验收证据。',
                recommended: true,
              },
              {
                id: 'decision_review',
                label: '方案评审',
                description: '重点产出方案比较、关键决策、风险和需要人工确认的边界。',
              },
              {
                id: 'process_automation',
                label: '流程自动化',
                description: '重点产出可派生 workflow 的阶段、角色分工、检查点和失败处理。',
              },
            ],
            placeholder: '如果跳过，将默认以“可直接实现”为目标，并把未确认评审点记录为 open questions。',
            required: true,
          },
          {
            id: 'scope_boundaries',
            label: '范围边界',
            question: '本次必须覆盖和明确排除的入口、角色、数据或场景有哪些？这个答案会决定 spec 的需求范围和 tasks 不能越界的非目标。',
            selectionMode: 'multiple',
            options: [
              {
                id: 'user_flow',
                label: '用户主流程(推荐)',
                description: '覆盖用户从输入需求到确认计划、生成 workflow 草案的完整主路径。',
                recommended: true,
              },
              {
                id: 'api_state',
                label: 'API/状态',
                description: '覆盖 API payload、状态字段、持久化记录或历史会话读取。',
              },
              {
                id: 'ui_feedback',
                label: 'UI反馈',
                description: '覆盖加载、错误、空数据、确认和修订等用户可见状态。',
              },
              {
                id: 'exclude_migration',
                label: '排除迁移',
                description: '本次只处理新流程，不迁移旧配置或旧会话；若选择此项，兼容风险需记录。',
              },
            ],
            placeholder: '请补充必须不做的内容。例如：不改历史 API 字段、不迁移旧 workflow、不新增权限模型。',
            required: true,
          },
          {
            id: 'failure_compatibility',
            label: '异常兼容',
            question: '遇到缺失输入、旧数据、模型输出不合规或外部依赖失败时，系统应如何处理？这个答案会决定 design 的失败路径、兼容策略和验证任务。',
            selectionMode: 'single',
            options: [
              {
                id: 'conservative_continue',
                label: '保守继续(推荐)',
                description: '使用明确默认假设继续生成计划，并把风险写入 missingFields/open questions。',
                recommended: true,
              },
              {
                id: 'block_until_answered',
                label: '阻止继续',
                description: 'blocking 信息缺失时不生成正式计划，要求用户先补齐。',
              },
              {
                id: 'fallback_existing',
                label: '沿用旧逻辑',
                description: '旧配置、旧会话或参考 workflow 可读时优先沿用，失败时再提示用户确认。',
              },
            ],
            placeholder: '如果跳过，将默认保守继续：生成计划但显式标注假设、风险和待确认项。',
            required: true,
          },
          {
            id: 'validation_evidence',
            label: '验证证据',
            question: '后续用什么证据判断计划或实现完成？这个答案会决定 tasks 的验证方式和收口标准。',
            selectionMode: 'multiple',
            options: [
              {
                id: 'automated_checks',
                label: '自动检查(推荐)',
                description: '使用类型检查、构建、测试、schema 或规范校验命令作为证据。',
                recommended: true,
              },
              {
                id: 'manual_acceptance',
                label: '人工验收',
                description: '用用户可见流程、错误路径、状态刷新和持久化结果做验收记录。',
              },
              {
                id: 'artifact_review',
                label: '制品审阅',
                description: '审查 requirements/design/tasks 之间的追踪链、一致性和非目标边界。',
              },
            ],
            placeholder: '请补充项目已有命令或验收入口。例如：npm run build、npx tsc --noEmit、指定页面操作路径。',
            required: false,
          },
        ],
      }, null, 2),
      '```',
      '</result>',
      '',
      `工作流名称: ${data.workflowName}`,
      `工作目录: ${workDir}`,
      `工作区模式: ${data.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place'}`,
      `需求描述: ${reqs}`,
      data.description ? `补充说明: ${data.description}` : '',
      data.referenceWorkflow ? `参考工作流: ${data.referenceWorkflow}` : '',
      referencePrompt,
      '',
      '需求访谈检查清单：',
      '1. 先写 current understanding：用户要解决什么问题、影响谁、成功后能观察到什么结果。',
      '2. knownFacts 必须带证据来源，例如“来自需求描述”“来自参考工作流”“来自工作目录”。',
      '3. missingFields 必须显式区分 blocking 与 optional；blocking 缺失会改变实现或验收，optional 只影响偏好或增强。',
      '4. 问题必须领域化：使用用户需求里的实体、入口、数据、流程、失败条件，不要只问通用项目管理问题。',
      '5. 优先问会改变计划的变量：范围/非目标、兼容/迁移、数据模型、UI/API 行为、权限、安全、验证证据。',
      '6. 不要问代码或用户输入已经回答过的问题；如果信息能从参考 workflow 推断，就写成事实或假设再问是否覆盖当前需求。',
      '7. 每个问题都要能映射到后续 requirements/design/tasks 的字段，不能只收集偏好。',
      '8. 如果信息不足，也要给出跳过问题时的保守假设，并把风险留在 missingFields。',
    ].filter(Boolean).join('\n\n');
  }, [getValues, referenceConfig]);

  const buildPlanningSystemPrompt = useCallback((previewConfig: any) => {
    const data = getValues();
    const reqs = data.requirements || data.description || '';
    const workDir = data.workingDirectory;
    const referencePrompt = data.referenceWorkflow && referenceConfig
      ? [
          `参考工作流: ${data.referenceWorkflow}`,
          '请继承它的整体结构、阶段或状态拆分、Agent 选用与协作骨架，只更新当前需求、步骤任务说明以及必要的任务分配。',
          '',
          '参考工作流 YAML:',
          '```yaml',
          referenceConfig.raw,
          '```',
        ].join('\n')
      : '';
    const recommendationPrompt = buildCreationRecommendationsPrompt(creationRecommendations);

    return [
      '你正在帮助用户生成正式计划，并且当前处于“业务计划生成”阶段。',
      '这一步要产出一套可以直接执行、可以继续迭代、可以被人工审查的正式计划制品。',
      '你显式使用 aceharness-spec-coding skill 来组织正式计划文档；底层制品仍采用 SpecCoding-style 的 specs/changes 结构，但文档内容本身必须完全围绕业务目标、业务规则和真实实现约束展开。',
      '请把输出写成稳定的计划 DSL，而不是自由散文。后续 workflow 和角色分工会根据这些正式制品自动派生，所以结构必须清晰、可引用、可追踪。',
      '你可以分多段普通文本逐步展示分析、思路和计划制品草案。',
      '机器可读的结构化结果放在 <result>...</result> 内，并且 <result> 内只放一个独立的 ```json 代码块。',
      '重要：artifacts 中的 requirements、design、tasks 是 JSON 字符串值。字符串内的换行用 \\n 表示，字符串内如果需要 Mermaid 或代码块，用 ~~~ 代替 ``` 作为 fenced code block 分隔符（例如 ~~~mermaid\\n...\\n~~~），这样不会与外层 JSON 代码块冲突。不要在 JSON 字符串值内使用 ``` 三个反引号。',
      SPEC_LANGUAGE_RULE,
      '当你完成本轮计划草案时，输出如下结构化结果：',
      '<result>',
      '```json',
      JSON.stringify({
        type: 'plan_draft',
        summary: '计划摘要',
        goals: ['目标'],
        nonGoals: ['非目标'],
        constraints: ['约束'],
        clarification: {
          summary: '需求澄清结论',
          knownFacts: ['已确认信息'],
          missingFields: ['仍缺的信息'],
          questions: ['下一步要问的问题'],
        },
        artifacts: {
          requirements: '# requirements.md\\n...',
          design: '# design.md\\n...',
          tasks: '# tasks.md\\n...',
        },
      }, null, 2),
      '```',
      '</result>',
      '',
      `目标文件名: configs/${data.filename}`,
      `工作流名称: ${data.workflowName}`,
      `工作目录: ${workDir}`,
      `工作区模式: ${data.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place'}`,
      `需求描述: ${reqs}`,
      data.description ? `补充说明: ${data.description}` : '',
      data.referenceWorkflow ? `参考工作流: ${data.referenceWorkflow}` : '',
      referencePrompt,
      recommendationPrompt,
      '',
      '生成原则：',
      '1. 先识别最终业务目标和业务对象，再据此展开业务范围、约束、设计、任务和验证。',
      '2. 需求拆分要足够细，必须能支撑后续逐项执行和审查，不要停留在口号式总结。',
      '3. requirements/spec 应优先采用如下 DSL：术语表 -> 编号化需求 -> 目标用户与诉求 -> 场景/验收标准。验收标准优先使用“当 <条件> 时，系统应 <结果>”句式。',
      '4. design.md 必须包含 Overview、Architecture、Core Components、Data Models、Interfaces And Contracts、Assumptions And Unknowns、清晰的流程图或 Mermaid 图，以及与真实业务规则对应的伪代码、判定逻辑或步骤算法。',
      '4.1 如果使用 Mermaid，必须写成独立的 ~~~mermaid fenced code block（注意用 ~~~ 而非 ```）；不要写成"Mermaid 流程图如下：flowchart ..."这种普通段落。',
      '5. tasks.md 必须按阶段和任务编号细拆，每项任务都写清楚关联需求、关联设计、任务类型、目标、输入或依赖、具体动作、交付产物、验证方式和完成标准。每个任务项必须使用 `- [ ]` checkbox 格式（例如 `- [ ] T1.1 实现用户登录接口`），方便后续追踪完成状态。',
      '6. requirements 要写清用户故事和 WHEN/THEN 验收标准；design 要写清主链路和关键决策；tasks 要写清执行顺序和验证闭环。',
      '7. 正式制品中不要直接写 workflow、Agent、状态机、编排等系统术语，但任务切片和阶段结构必须足够稳定，以便后续派生 workflow 和角色分工。',
      '8. 输出前先做一次一致性自检，确保 requirements/design/tasks 没有互相矛盾、越界或把假设写成事实。',
      '9. 如果仍有少量待确认项，就把它们自然地整理进 clarification.missingFields/questions，并同时给出当前最佳业务计划草案。',
    ].filter(Boolean).join('\n\n');
  }, [creationRecommendations, getValues, referenceConfig]);

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
    const config = buildPreviewConfigFromForm();
    const planningSystemPrompt = buildPlanningSystemPrompt(config);
    const targetArtifactKey: SpecCodingArtifactKey = revisionTarget;

    try {
      const targetFrontendSessionId = await ensurePlanningChatSession();
      setPlanWorkspaceOpen(true);
      setPlanWorkspaceTab('revisions');
      setIsRevisingPlan(true);
      setAiPhase('streaming');
      setCurrentStream('');
      setCurrentThinking('');

      await appendVisibleSessionTag(
        targetFrontendSessionId,
        `创建工作流 · AI修订计划 · ${values.workflowName}`
      );

      const revisionRequestMessage = [
        '请基于当前已生成的正式计划制品和用户修订说明，重新生成完整计划草案。',
        '这不是普通总结，也不是只改一份文档；你必须输出完整 plan_draft JSON，并同步刷新 requirements.md、design.md、tasks.md。',
        '修订后各制品必须语言统一、术语统一、需求编号和任务追踪关系自洽。',
        SPEC_LANGUAGE_RULE,
        '',
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
        '',
        '输出要求：',
        '1. 可以先用普通文本说明你的修订思路，页面会实时显示。',
        '2. 最终必须在 <result>...</result> 内输出一个 ```json 代码块。',
        '3. JSON 顶层必须是 {"type":"plan_draft", ...}，并包含 summary、goals、nonGoals、constraints、clarification、artifacts。',
        '4. artifacts 必须包含完整 requirements、design、tasks 三个字符串字段，不能只返回被修订的片段。',
        '5. artifacts 字符串内如需 Mermaid 或代码块，用 ~~~ 代替 ``` 作为分隔符，避免与外层 JSON 代码块冲突。',
        '6. 输出 </result> 后不要追加任何文字。',
      ].filter(Boolean).join('\n\n');

      let activeBackendSessionId = backendSessionId;
      const runRevisionStream = async (message: string, attempt: number): Promise<void> => {
        setAiPhase('streaming');
        setCurrentStream('');
        setCurrentThinking('');

        const startRes = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            model: aiModelRef.current,
            engine: aiEngineRef.current,
            sessionId: activeBackendSessionId || undefined,
            frontendSessionId: targetFrontendSessionId,
            mode: 'dashboard',
            workingDirectory: values.workingDirectory,
            extraSystemPrompt: planningSystemPrompt,
          }),
        });

        const startData = await startRes.json().catch(() => null);
        if (!startRes.ok || !startData?.chatId) {
          throw new Error(startData?.error || '启动计划修订失败');
        }

        const chatId = startData.chatId;
        chatIdRef.current = chatId;

        await new Promise<void>((resolve, reject) => {
          const es = new EventSource(`/api/chat/stream?id=${chatId}`);
          eventSourceRef.current = es;
          let accumulated = '';
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

              if (data.sessionId) {
                activeBackendSessionId = data.sessionId;
                setBackendSessionId(data.sessionId);
              }

              const finalContent = data.result || accumulated;
              setAiMessages((prev) => {
                const next = [...prev];
                if (thinkingAccumulated) next.push({ role: 'thinking', content: thinkingAccumulated });
                next.push({ role: 'ai', content: finalContent });
                return next;
              });
              await appendPlanningAssistantMessage(targetFrontendSessionId, finalContent, data.sessionId);

              const draft = extractPlanDraftResult(finalContent);
              if (!draft) {
                if (attempt < MAX_PLAN_DRAFT_REPAIR_ATTEMPTS) {
                  await runRevisionStream(buildPlanDraftRepairMessage(finalContent), attempt + 1);
                  resolve();
                  return;
                }
                reject(new Error('AI 没有在 <result> 内返回可读取的计划修订草案'));
                return;
              }

              await updatePreviewSessionFromPlanDraft(draft, revisionSummary);
              setRevisionNotes('');
              setSelectedArtifactKey(targetArtifactKey);
              setArtifactViewMode('preview');
              setSelectedSnapshotVersion('current');
              setPlanWorkspaceTab('artifacts');
              setAiPhase('idle');
              resolve();
            } catch (error) {
              reject(error);
            }
          });

          es.addEventListener('error', async () => {
            es.close();
            eventSourceRef.current = null;
            chatIdRef.current = null;
            if (accumulated) {
              setAiMessages((prev) => [...prev, { role: 'ai', content: accumulated }]);
              await appendPlanningAssistantMessage(targetFrontendSessionId, accumulated);
            }
            reject(new Error('计划修订流中断'));
          });
        });
      };

      await runRevisionStream(revisionRequestMessage, 0);
      toast('success', '已根据修订说明刷新正式计划制品');
    } catch (error: any) {
      setAiPhase('waiting');
      toast('error', error?.message || '重新生成计划预览失败');
    } finally {
      setIsRevisingPlan(false);
      setCurrentStream('');
      setCurrentThinking('');
    }
  }, [appendPlanningAssistantMessage, appendVisibleSessionTag, backendSessionId, buildPlanningSystemPrompt, buildPreviewConfigFromForm, ensurePlanningChatSession, getValues, previewSession, revisionImpactArea, revisionNotes, revisionTarget, toast, updatePreviewSessionFromPlanDraft]);

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

  // Start AI-guided workflow YAML drafting after SpecCoding has been confirmed.
  const startAiStream = async (sourceSession?: any) => {
    const data = getValues();
    const filename = data.filename;
    const reqs = data.requirements || data.description || '';
    const workDir = data.workingDirectory;
    const activePreviewSession = sourceSession || previewSession;
    const specCoding = activePreviewSession?.specCoding || {};
    const artifacts = specCoding.artifacts || {};
    const workflowDraftSummary = activePreviewSession?.workflowDraftSummary;

    setAiFilename('');
    setAiMessages([]);
    setCurrentStream('');
    setCurrentThinking('');
    setWorkflowDraftConfig(null);
    setWorkflowDraftValidation(null);
    setWorkflowDraftPreview(null);
    setBackendSessionId(undefined);

    const referencePrompt = data.referenceWorkflow && referenceConfig
      ? `
**参考工作流**: ${data.referenceWorkflow}
请继承它的整体结构、阶段或状态拆分、Agent 选用与协作骨架，只更新当前需求、步骤任务说明以及必要的任务分配。

参考工作流 YAML:
\`\`\`yaml
${referenceConfig.raw}
\`\`\`
`
      : '';
    const recommendationPrompt = buildCreationRecommendationsPrompt(creationRecommendations);
    const confirmedSpecPrompt = specCoding?.id
      ? `
**已确认 SpecCoding**
- SpecCoding ID: ${specCoding.id}
- 版本: v${specCoding.version || 1}
- 摘要: ${specCoding.summary || '无'}
- Goals: ${(specCoding.goals || []).join('；') || '无'}
- NonGoals: ${(specCoding.nonGoals || []).join('；') || '无'}
- Constraints: ${(specCoding.constraints || []).join('；') || '无'}

**SpecCoding 分工/阶段投影**
\`\`\`json
${JSON.stringify({
  phases: specCoding.phases || [],
  assignments: specCoding.assignments || [],
  checkpoints: specCoding.checkpoints || [],
  workflowDraftSummary: workflowDraftSummary || null,
}, null, 2)}
\`\`\`

**requirements.md**
\`\`\`markdown
${truncateForPrompt(artifacts.requirements, 4000)}
\`\`\`

**design.md**
\`\`\`markdown
${truncateForPrompt(artifacts.design, 5000)}
\`\`\`

**tasks.md**
\`\`\`markdown
${truncateForPrompt(artifacts.tasks, 5000)}
\`\`\`
`
      : '';

    const prompt = `请基于用户已经确认的 SpecCoding 和 Agent 分工，直接搭建 AceHarness 工作流 YAML 草案。

**目标文件名**: configs/${filename}
**工作流名称**: ${data.workflowName}
${data.referenceWorkflow ? `**参考工作流**: ${data.referenceWorkflow}` : ''}
**工作目录**: ${workDir}
**工作区模式**: ${data.workspaceMode === 'isolated-copy' ? '创建副本工程后执行（isolated-copy）' : '直接在工作目录执行（in-place）'}
**需求描述**: ${reqs}
${data.description ? `**补充说明**: ${data.description}` : ''}
${referencePrompt}
${recommendationPrompt}
${confirmedSpecPrompt}

当前阶段要求：
1. 不要重新生成 SpecCoding，不要重新澄清需求，不要把前面的 spec 制品再次作为输出目标。
2. 直接读取上面的已确认 SpecCoding、tasks、design、阶段/分工投影和参考工作流，生成 workflow YAML 草案。
3. 草案必须明确 workflow mode、context、supervisor、roles、phases/states、steps、agent 分配、checkpoint 和必要的 preCommands。
4. 如果引用 Agent，请优先使用已确认 SpecCoding assignments、推荐 Agent、参考工作流结构和本提示中已经出现的 Agent 名称；不要为了校验 Agent/YAML 自行读取 configs/agents 或运行校验脚本。
5. 你不要直接写入 configs/${filename}，也不要只声明“确认后写入”。系统会负责保存和校验。
6. 先把完整 YAML 草案展示给用户确认；然后在回复末尾输出机器可读结果，供系统立即校验。
7. 机器可读结果必须放在 <result>...</result> 内，且 <result> 内只能放一个独立的 \`\`\`json 代码块。
8. JSON 顶层必须是 {"type":"workflow_draft","filename":"${filename}","summary":"...","config":{...}}，config 必须是完整 AceHarness workflow 配置对象。
9. 输出 </result> 后不要再追加任何文字。
10. 禁止输出“现在我会做本地结构校验/运行 validateWorkflowDraft/运行 YAML 校验”这类过程描述；系统收到你的 <result> 后会自动完成解析与校验。

请现在直接开始生成 workflow YAML 草案。系统会校验 <result> 内的 config；如有问题，系统会把校验错误直接反馈给你继续修正。`;

    await sendToAi(prompt);
  };

  const generateClarificationWithChatSession = useCallback(async () => {
    const values = getValues();
    const previewConfig = buildPreviewConfigFromForm();
    const clarificationSystemPrompt = buildClarificationSystemPrompt(previewConfig);
    const clarificationRequestMessage = [
      '请先不要生成正式计划。',
      '先分析当前输入，提出必须补充确认的问题，并输出一个供用户填写的表单。',
      `工作流名称：${values.workflowName}`,
      values.requirements ? `需求：${values.requirements}` : '',
      values.description ? `补充说明：${values.description}` : '',
    ].filter(Boolean).join('\n');
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

    await appendVisibleSessionTag(
      targetFrontendSessionId,
      `创建工作流 · 生成澄清问题 · ${values.workflowName}`
    );
    await ensureDraftCreationSession(targetFrontendSessionId);

    const startRes = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: clarificationRequestMessage,
        model: aiModelRef.current,
        engine: aiEngineRef.current,
        sessionId: backendSessionId || undefined,
        frontendSessionId: targetFrontendSessionId,
        mode: 'dashboard',
        workingDirectory: values.workingDirectory,
        extraSystemPrompt: clarificationSystemPrompt,
      }),
    });

    const startData = await startRes.json().catch(() => null);
    if (!startRes.ok || !startData?.chatId) {
      setIsGeneratingPlan(false);
      setAiPhase('waiting');
      throw new Error(startData?.error || '启动计划生成失败');
    }

    const chatId = startData.chatId;
    chatIdRef.current = chatId;

    await new Promise<void>((resolve, reject) => {
      const es = new EventSource(`/api/chat/stream?id=${chatId}`);
      eventSourceRef.current = es;
      let accumulated = '';
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

          if (data.sessionId) {
            setBackendSessionId(data.sessionId);
          }

          const finalContent = data.result || accumulated;
          setAiMessages((prev) => {
            const next = [...prev];
            if (thinkingAccumulated) next.push({ role: 'thinking', content: thinkingAccumulated });
            next.push({ role: 'ai', content: finalContent });
            return next;
          });
          await appendPlanningAssistantMessage(targetFrontendSessionId, finalContent, data.sessionId);
          setCurrentStream('');
          setCurrentThinking('');

          const clarification = extractClarificationFormResult(finalContent);
          if (!clarification || clarification.questions.length === 0) {
            setAiPhase('waiting');
            setIsGeneratingPlan(false);
            setPlanningStage('idle');
            reject(new Error('AI 没有返回可填写的澄清表单，请重试'));
            return;
          }

          setAiPhase('idle');
          setIsGeneratingPlan(false);
          setPlanningStage('awaiting-answers');
          setClarificationForm(clarification);
          await persistDraftUiState({
            formStep: 2,
            planningStage: 'awaiting-answers',
            clarificationForm: clarification,
            clarificationAnswers: {},
          });
          resolve();
        } catch (error) {
          setAiPhase('waiting');
          setIsGeneratingPlan(false);
          setPlanningStage('idle');
          reject(error);
        }
      });

      es.addEventListener('error', async () => {
        es.close();
        eventSourceRef.current = null;
        chatIdRef.current = null;
        if (accumulated) {
          setAiMessages((prev) => {
            const next = [...prev];
            if (thinkingAccumulated) next.push({ role: 'thinking', content: thinkingAccumulated });
            next.push({ role: 'ai', content: accumulated });
            return next;
          });
          await appendPlanningAssistantMessage(targetFrontendSessionId, accumulated);
        }
        setCurrentStream('');
        setCurrentThinking('');
        setAiPhase('waiting');
        setIsGeneratingPlan(false);
        setPlanningStage('idle');
        reject(new Error('计划生成流中断'));
      });
    });
  }, [appendPlanningAssistantMessage, appendVisibleSessionTag, backendSessionId, buildClarificationSystemPrompt, buildPreviewConfigFromForm, ensureDraftCreationSession, ensurePlanningChatSession, getValues, interruptPlanningRun, persistDraftUiState]);

  const generatePlanWithChatSession = useCallback(async () => {
    const values = getValues();
    const previewConfig = buildPreviewConfigFromForm();
    const planningSystemPrompt = buildPlanningSystemPrompt(previewConfig);
    const answerContext = buildClarificationAnswerContext(clarificationForm?.questions || [], clarificationAnswers);
    const planningRequestMessage = [
      '请基于已完成的澄清问答开始生成正式计划草案。',
      `工作流名称：${values.workflowName}`,
      values.requirements ? `原始需求：${values.requirements}` : '',
      values.description ? `原始补充说明：${values.description}` : '',
      clarificationForm?.summary ? `澄清结论：${clarificationForm.summary}` : '',
      answerContext ? `用户补充回答：\n${answerContext}` : '',
    ].filter(Boolean).join('\n\n');
    const targetFrontendSessionId = await ensurePlanningChatSession();

    interruptPlanningRun();
    setIsGeneratingPlan(true);
    setFormStep(3);
    setPlanningStage('generating-plan');
    setAiPhase('streaming');
    setAiMessages([]);
    setCurrentStream('');
    setCurrentThinking('');

    await appendVisibleSessionTag(
      targetFrontendSessionId,
      `创建工作流 · 生成计划草案 · ${values.workflowName}`
    );
    await persistDraftUiState({
      formStep: 3,
      planningStage: 'generating-plan',
      clarificationForm,
      clarificationAnswers,
    });

    let activeBackendSessionId = backendSessionId;
    const runPlanDraftStream = async (message: string, attempt: number): Promise<void> => {
      setAiPhase('streaming');
      setCurrentStream('');
      setCurrentThinking('');

      const startRes = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          model: aiModelRef.current,
          engine: aiEngineRef.current,
          sessionId: activeBackendSessionId || undefined,
          frontendSessionId: targetFrontendSessionId,
          mode: 'dashboard',
          workingDirectory: values.workingDirectory,
          extraSystemPrompt: planningSystemPrompt,
        }),
      });

      const startData = await startRes.json().catch(() => null);
      if (!startRes.ok || !startData?.chatId) {
        setIsGeneratingPlan(false);
        setAiPhase('waiting');
        setPlanningStage('awaiting-answers');
        throw new Error(startData?.error || '启动计划生成失败');
      }

      const chatId = startData.chatId;
      chatIdRef.current = chatId;

      await new Promise<void>((resolve, reject) => {
        const es = new EventSource(`/api/chat/stream?id=${chatId}`);
        eventSourceRef.current = es;
        let accumulated = '';
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

            if (data.sessionId) {
              activeBackendSessionId = data.sessionId;
              setBackendSessionId(data.sessionId);
            }

            const finalContent = data.result || accumulated;
            setAiMessages((prev) => {
              const next = [...prev];
              if (thinkingAccumulated) next.push({ role: 'thinking', content: thinkingAccumulated });
              next.push({ role: 'ai', content: finalContent });
              return next;
            });
            await appendPlanningAssistantMessage(targetFrontendSessionId, finalContent, data.sessionId);
            setCurrentStream('');
            setCurrentThinking('');

            const draft = extractPlanDraftResult(finalContent);
            if (!draft) {
              if (attempt < MAX_PLAN_DRAFT_REPAIR_ATTEMPTS) {
                await runPlanDraftStream(buildPlanDraftRepairMessage(finalContent), attempt + 1);
                resolve();
                return;
              }
              setAiPhase('waiting');
              setIsGeneratingPlan(false);
              setPlanningStage('awaiting-answers');
              resolve();
              return;
            }

            await createPreviewSession(draft, targetFrontendSessionId);
            setAiPhase('idle');
            setIsGeneratingPlan(false);
            setPlanningStage('idle');
            setFormStep(4);
            await persistDraftUiState({
              formStep: 4,
              planningStage: 'idle',
              clarificationForm,
              clarificationAnswers,
            });
            resolve();
          } catch (error) {
            setAiPhase('waiting');
            setIsGeneratingPlan(false);
            setPlanningStage('awaiting-answers');
            reject(error);
          }
        });

        es.addEventListener('error', async () => {
          es.close();
          eventSourceRef.current = null;
          chatIdRef.current = null;
          if (accumulated) {
            setAiMessages((prev) => {
              const next = [...prev];
              if (thinkingAccumulated) next.push({ role: 'thinking', content: thinkingAccumulated });
              next.push({ role: 'ai', content: accumulated });
              return next;
            });
            await appendPlanningAssistantMessage(targetFrontendSessionId, accumulated);
          }
          setCurrentStream('');
          setCurrentThinking('');
          setAiPhase('waiting');
          setIsGeneratingPlan(false);
          setPlanningStage('awaiting-answers');
          reject(new Error('计划生成流中断'));
        });
      });
    };

    await runPlanDraftStream(planningRequestMessage, 0);
  }, [appendPlanningAssistantMessage, appendVisibleSessionTag, backendSessionId, buildPlanningSystemPrompt, buildPreviewConfigFromForm, clarificationAnswers, clarificationForm, createPreviewSession, ensurePlanningChatSession, getValues, interruptPlanningRun, persistDraftUiState]);

  useEffect(() => {
    if (!isOpen || !planningFrontendSessionId) return;
    if (restoredPlanningSessionRef.current === planningFrontendSessionId) return;
    let cancelled = false;

    modalSessionJsonFetch<any>(`/api/chat/sessions/${encodeURIComponent(planningFrontendSessionId)}`)
      .then((data) => {
        if (cancelled || !data?.session) return;
        restoredPlanningSessionRef.current = planningFrontendSessionId;
        if (data.session.backendSessionId) {
          setBackendSessionId(data.session.backendSessionId);
        }
        const restoredMessages = mapPlanningChatMessages(data.session.messages || []);
        if (restoredMessages.length > 0) {
          setAiMessages(restoredMessages);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isOpen, planningFrontendSessionId]);

  useEffect(() => {
    if (!isOpen || !planningFrontendSessionId || planningStage !== 'generating-plan') return;
    if (eventSourceRef.current) return;
    let cancelled = false;

    const reconnect = async () => {
      const checkRes = await fetch(`/api/chat/stream?checkActive=${encodeURIComponent(planningFrontendSessionId)}`);
      const checkData = await checkRes.json().catch(() => null);
      if (cancelled || !checkData?.active || !checkData.chatId) return;
      if (reconnectingPlanningChatIdRef.current === checkData.chatId) return;

      reconnectingPlanningChatIdRef.current = checkData.chatId;
      chatIdRef.current = checkData.chatId;
      setFormStep(3);
      setIsGeneratingPlan(true);
      setAiPhase('streaming');
      setCurrentThinking('');
      if (checkData.streamContent) {
        setCurrentStream(checkData.streamContent);
      }

      const es = new EventSource(`/api/chat/stream?id=${encodeURIComponent(checkData.chatId)}`);
      eventSourceRef.current = es;
      let accumulated = '';
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

          if (data.sessionId) {
            setBackendSessionId(data.sessionId);
          }

          const finalContent = data.result || accumulated || checkData.streamContent || '';
          setAiMessages((prev) => {
            const next = [...prev];
            if (thinkingAccumulated) next.push({ role: 'thinking', content: thinkingAccumulated });
            if (finalContent) next.push({ role: 'ai', content: finalContent });
            return next;
          });
          await appendPlanningAssistantMessage(planningFrontendSessionId, finalContent, data.sessionId);
          setCurrentStream('');
          setCurrentThinking('');

          const draft = extractPlanDraftResult(finalContent);
          if (!draft) {
            setAiPhase('waiting');
            setIsGeneratingPlan(false);
            setPlanningStage('awaiting-answers');
            setFormStep(2);
            return;
          }

          await createPreviewSession(draft, planningFrontendSessionId);
          setAiPhase('idle');
          setIsGeneratingPlan(false);
          setPlanningStage('idle');
          setFormStep(4);
          await persistDraftUiState({
            formStep: 4,
            planningStage: 'idle',
            clarificationForm,
            clarificationAnswers,
          });
        } catch {
          setAiPhase('waiting');
          setIsGeneratingPlan(false);
          setPlanningStage('awaiting-answers');
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
        setPlanningStage('awaiting-answers');
      });
    };

    void reconnect();

    return () => {
      cancelled = true;
    };
  }, [appendPlanningAssistantMessage, clarificationAnswers, clarificationForm, createPreviewSession, isOpen, persistDraftUiState, planningFrontendSessionId, planningStage]);

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
    const validation = newConfigFormSchema.safeParse({
      filename: draft.filename,
      workflowName: draft.workflowName,
      referenceWorkflow: draft.referenceWorkflow,
      workingDirectory: draft.workingDirectory,
      workspaceMode: draft.workspaceMode,
      description: draft.description,
      requirements: draft.requirements,
      mode: workflowMode,
    });
    if (!validation.success) {
      applySchemaIssues(validation.error.issues as any);
      return;
    }

    const reqs = getValues('requirements') || '';
    if (reqs.trim().length < 5) {
      toast('error', '请提供需求描述（至少5个字符）');
      return;
    }

    try {
      if (previewSession) {
        setFormStep(4);
        return;
      }
      await generateClarificationWithChatSession();
    } catch (error: any) {
      toast('error', error?.message || '生成澄清问题失败');
    }
  };

  const handleSubmitClarificationAnswers = async () => {
    const questions = clarificationForm?.questions || [];
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
	        if (frontendSessionId) {
          await appendVisibleSessionTag(
            frontendSessionId,
	            `创建工作流 · 进入 Workflow 草案 · ${values.workflowName}`
	          );
	        }
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
      if (frontendSessionId) {
        await appendVisibleSessionTag(
          frontendSessionId,
          `创建工作流 · 确认计划并创建配置 · ${values.workflowName}`
        );
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

    if (!workflowDraftConfig) {
      const repairPrompt = buildWorkflowDraftRepairMessage(
        '当前没有可保存的 workflow_draft.config。',
        { ok: false, message: `系统未检测到已创建且合规的 configs/${filename}，也没有可保存的 workflow_draft.config。` },
        filename
      );
      await sendToAi(repairPrompt, backendSessionId, { workflowDraftAttempt: 1 });
      return true;
    }

    const validation = await validateWorkflowDraftConfig(workflowDraftConfig);
    setWorkflowDraftValidation(validation);
    setWorkflowDraftPreview((prev) => ({
      ...(prev || { source: 'result-json' as const, filename }),
      filename,
      config: validation?.normalized || workflowDraftConfig,
      yaml: stringifyYaml(validation?.normalized || workflowDraftConfig),
      validation,
    }));
    if (!validation?.ok) {
      const repairPrompt = buildWorkflowDraftRepairMessage(
        JSON.stringify(workflowDraftConfig, null, 2),
        validation,
        filename
      );
      setWorkflowDraftConfig(null);
      await sendToAi(repairPrompt, backendSessionId, { workflowDraftAttempt: 1 });
      return true;
    }

    setIsSavingWorkflowDraft(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
      const response = await fetch('/api/configs/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...values,
          mode: workflowMode,
          frontendSessionId,
          creationSessionId: previewSession?.id,
          configDraft: validation.normalized || workflowDraftConfig,
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
        throw new Error(message);
      }

      const createdFilename = result?.filename || filename;
      if (result?.creationSession) {
        setPreviewSession(result.creationSession);
        setDraftCreationSessionId(result.creationSession.id);
        await bindDraftCreationSessionToChat(result.creationSession).catch(() => {});
      }
      setAiFilename(createdFilename);
      setWorkflowDraftConfig(validation.normalized || workflowDraftConfig);
      setWorkflowDraftValidation(validation);
      setWorkflowDraftPreview((prev) => ({
        ...(prev || { source: 'result-json' as const }),
        filename: createdFilename,
        config: validation.normalized || workflowDraftConfig,
        yaml: stringifyYaml(validation.normalized || workflowDraftConfig),
        validation,
      }));
      setAiPhase('done');
      setAiMessages((prev) => [...prev, {
        role: 'ai',
        content: `工作流配置 configs/${createdFilename} 已创建并通过系统校验。是否打开工作流设计页面？`,
      }]);
      toast('success', '工作流配置已创建并通过校验');
      if (frontendSessionId) {
        await appendVisibleSessionTag(
          frontendSessionId,
          `创建工作流 · 配置已创建 · ${values.workflowName || createdFilename}`
        );
      }
      return true;
    } catch (error: any) {
      const errorMsg = error?.message || '保存 workflow 草案失败';
      // 将错误自动发回 AI 进行修复，而不是只显示 toast
      const repairPrompt = buildWorkflowDraftRepairMessage(
        JSON.stringify(workflowDraftConfig, null, 2),
        { ok: false, message: errorMsg },
        filename
      );
      setWorkflowDraftConfig(null);
      setAiMessages(prev => [...prev, {
        role: 'ai',
        content: `创建失败: ${errorMsg}，正在自动修复...`,
      }]);
      await sendToAi(repairPrompt, backendSessionId, { workflowDraftAttempt: 1 });
      return true;
    } finally {
      setIsSavingWorkflowDraft(false);
    }
  }, [
    appendVisibleSessionTag,
    backendSessionId,
    checkExistingWorkflowFile,
    frontendSessionId,
    getValues,
    onClose,
    onSuccess,
    previewSession?.id,
    reset,
    resetAll,
    sendToAi,
    toast,
    validateWorkflowDraftConfig,
    workflowDraftConfig,
    workflowMode,
    bindDraftCreationSessionToChat,
  ]);

  // Handle user reply in AI conversation
  const handleUserReply = async () => {
    const text = userInput.trim();
    if (!text) return;
    setAiMessages(prev => [...prev, { role: 'user', content: text }]);
    setUserInput('');
    await sendToAi(text, backendSessionId);
  };

  const handleQuickConfirm = async () => {
    if (await createWorkflowFromValidatedDraft()) return;
    const text = '确认，请基于已校验结果继续生成可保存的 workflow_draft';
    const workflowName = getValues('workflowName') || '新工作流';
    if (frontendSessionId) {
      await appendVisibleSessionTag(
        frontendSessionId,
        `创建工作流 · AI确认创建文件 · ${workflowName}`
      );
    }
    setAiMessages(prev => [...prev, { role: 'user', content: text }]);
    await sendToAi(text, backendSessionId, { workflowDraftAttempt: 1 });
  };

  const onSubmit = async (data: NewConfigForm) => {
    // AI-guided mode uses preview + AI flow, not direct submit
    if (workflowMode === 'ai-guided') return;
    const validation = newConfigFormSchema.safeParse({ ...data, mode: workflowMode });
    if (!validation.success) {
      applySchemaIssues(validation.error.issues as any);
      return;
    }

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
      const response = await fetch('/api/configs/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...data,
          mode: workflowMode,
          frontendSessionId,
          creationSessionId: previewSession?.id,
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
            if (typeof field === 'string' && ['filename', 'workflowName', 'referenceWorkflow', 'workingDirectory', 'workspaceMode', 'description', 'requirements', 'mode'].includes(field)) {
              setError(field as keyof NewConfigForm, { type: 'server', message: issue.message });
            }
          }
          toast('error', '表单验证失败:\n' + details.map((e: any) => e.message).join('\n'));
        } else {
          toast('error', result.message || result.error);
        }
        return;
      }
      toast('success', result.message || '配置文件已创建');
      if (frontendSessionId) {
        await appendVisibleSessionTag(
          frontendSessionId,
          `创建工作流 · 配置已创建 · ${data.workflowName}`
        );
      }
      reset();
      onSuccess(data.filename, { creationSession: result.creationSession });
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
    resetAll();
    setRevisionNotes('');
    reset();
    onClose();
  };

  useEffect(() => {
    return () => {
      if (restoreGuardTimerRef.current) {
        clearTimeout(restoreGuardTimerRef.current);
      }
    };
  }, []);

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
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
    const configResponse = await fetch(`/api/configs/${encodeURIComponent(filename)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!configResponse.ok) {
      throw new Error('读取已生成工作流配置失败');
    }
    const configResult = await configResponse.json();
    const values = getValues();
    const targetSessionId = previewSession?.id;
    const sessionResponse = await fetch(targetSessionId
      ? `/api/spec-coding/sessions/${encodeURIComponent(targetSessionId)}`
      : '/api/spec-coding/sessions', {
      method: targetSessionId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        chatSessionId: frontendSessionId || undefined,
        status: 'config-generated',
        specCodingStatus: 'confirmed',
        filename,
        workflowName: values.workflowName,
        referenceWorkflow: effectiveReferenceWorkflowValue,
        mode: workflowMode,
        workingDirectory: values.workingDirectory,
        workspaceMode: values.workspaceMode,
        description: values.description,
        requirements: values.requirements,
        config: configResult.config,
        rebuildSpecCodingFromConfig: true,
      }),
    });
    if (!sessionResponse.ok) {
      const data = await sessionResponse.json().catch(() => null);
      throw new Error(data?.error || '创建创建态会话失败');
    }
    const sessionResult = await sessionResponse.json();
    if (frontendSessionId && sessionResult?.session) {
      await fetch(`/api/chat/sessions/${encodeURIComponent(frontendSessionId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...(await (async () => {
            const sessionResp = await fetch(`/api/chat/sessions/${encodeURIComponent(frontendSessionId)}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            const sessionData = await sessionResp.json().catch(() => null);
            return sessionData?.session || {};
          })()),
          creationSession: {
            creationSessionId: sessionResult.session.id,
            filename: sessionResult.session.filename,
            workflowName: sessionResult.session.workflowName,
            status: sessionResult.session.status,
            specCodingId: sessionResult.session.specCoding.id,
            createdAt: sessionResult.session.createdAt,
            updatedAt: sessionResult.session.updatedAt,
          },
        }),
      }).catch(() => {});
    }
    setPreviewSession(sessionResult.session);
    return sessionResult.session;
  }, [effectiveReferenceWorkflowValue, frontendSessionId, getValues, previewSession?.id, workflowMode]);

  const handleAiComplete = async () => {
    const filename = aiFilename;
    let creationSession: any;
    const workflowName = getValues('workflowName') || '新工作流';
    if (filename) {
      try {
        creationSession = await createCreationSessionForExistingConfig(filename);
      } catch (error: any) {
        toast('error', error?.message || '创建态会话回写失败');
      }
    }
    if (frontendSessionId && filename) {
      await appendVisibleSessionTag(
        frontendSessionId,
        `创建工作流 · 配置已创建 · ${workflowName}`
      );
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

  if (formStep === 2) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className={`${creationDialogClassName} ${creationFullscreen ? '' : 'h-[80vh]'}`}>
          <div className="px-6 pt-6">
            <CreationStageStepper currentStep={2} />
          </div>
          <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="icon" onClick={() => {
                interruptPlanningRun();
                setAiMessages([]);
                setAiPhase('idle');
                setPlanningStage('idle');
                setClarificationForm(null);
                setClarificationAnswers({});
                setFormStep(1);
              }} title="返回上一步">
                <span className="material-symbols-outlined">arrow_back</span>
              </Button>
              <DialogTitle className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-500">route</span>
                补充问答
                {isGeneratingPlan ? (
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground font-normal">
                    <span className="animate-pulse text-amber-500">●</span> 分析中...
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground font-normal">
                    先补全关键信息，再生成正式计划
                  </span>
                )}
              </DialogTitle>
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
          <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
            <div className="text-xs leading-5 text-muted-foreground">
              AI 会先提出会影响后续计划和 Agent 编排的关键问题。你用表单补全后，系统才会继续生成正式计划。
            </div>
            <div className="mt-4 flex-1 overflow-y-auto rounded-xl border bg-background p-4">
                {clarificationForm ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm font-medium">AI 补充问答表</div>
                      {clarificationForm.summary ? (
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">{clarificationForm.summary}</div>
                      ) : null}
                    </div>
                    {clarificationForm.knownFacts?.length ? (
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <div className="text-xs font-medium">已确认信息</div>
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
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
                    <div className="space-y-4">
                      {clarificationForm.questions.map((item, index) => (
                        <div key={item.id} className="space-y-2 rounded-lg border p-3">
                          {(() => {
                            const options = getClarificationQuestionOptions(item);
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
                                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors ${
                                    selected
                                      ? 'border-primary bg-primary/5'
                                      : 'border-border bg-background hover:bg-muted/40'
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
                                      <div className={`h-4 w-4 rounded-full border ${selected ? 'border-primary' : 'border-muted-foreground/40'}`}>
                                        <div className={`m-[3px] h-2 w-2 rounded-full ${selected ? 'bg-primary' : 'bg-transparent'}`} />
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
                          <div className="text-[11px] text-muted-foreground">
                            先选一个最接近的方案；如果需要补充边界、例外或更具体的要求，再在下方补充说明。
                          </div>
                              </>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div ref={streamContentRef} className="h-full space-y-3 overflow-auto">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
                      <div className="flex items-center gap-2 font-medium">
                        {isGeneratingPlan ? <Loader2 className="h-4 w-4 animate-spin text-amber-500" /> : <span className="material-symbols-outlined text-base">help</span>}
                        {isGeneratingPlan ? 'AI 正在分析并生成补充问答表' : '等待生成补充问答表'}
                      </div>
                      <div className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/80">
                        {isGeneratingPlan ? '下面会实时显示 AI 的分析过程；问题生成完成后，这个过程块会直接替换为问答表。' : '点击“重新提问”后，这里会显示 AI 的完整分析过程。'}
                      </div>
                    </div>

                    {aiMessages.map((msg, i) => (
                      <div key={`${msg.role}-${i}`}>
                        {msg.role === 'thinking' ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                              <span className="material-symbols-outlined text-sm">psychology</span>
                              思考过程
                            </div>
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-amber-800 dark:text-amber-300">{msg.content}</pre>
                          </div>
                        ) : msg.role === 'user' ? null : (
                          (() => {
                            const { text, cards } = parseActions(msg.content);
                            return (
                              <div className="space-y-3 rounded-lg border bg-muted/50 p-4">
                                {text ? <Markdown>{text}</Markdown> : null}
                                {cards.map((card, ci) => (
                                  <UniversalCard key={ci} card={card} />
                                ))}
                              </div>
                            );
                          })()
                        )}
                      </div>
                    ))}

                    {currentThinking ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                          <span className="material-symbols-outlined text-sm">psychology</span>
                          思考过程<span className="animate-pulse">...</span>
                        </div>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-amber-800 dark:text-amber-300">{currentThinking}</pre>
                      </div>
                    ) : null}

                    {currentStream ? (
                      (() => {
                        const { text, cards } = parseActions(currentStream);
                        return (
                          <div className="space-y-3 rounded-lg border bg-muted/50 p-4">
                            {text ? <Markdown>{text}</Markdown> : null}
                            {cards.map((card, ci) => (
                              <UniversalCard key={ci} card={card} />
                            ))}
                            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-green-500" />
                          </div>
                        );
                      })()
                    ) : null}

                    {!aiMessages.length && !currentThinking && !currentStream ? (
                      <div className="h-full" />
                    ) : null}
                  </div>
                )}
            </div>
          </div>
          <div className="flex gap-2 justify-end p-6 pt-4 border-t flex-shrink-0">
            {isGeneratingPlan ? (
              <Button type="button" variant="outline" onClick={() => {
                interruptPlanningRun();
                setAiPhase('waiting');
                setPlanningStage('awaiting-answers');
              }}>
                停止
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => void generateClarificationWithChatSession()}>
                  重新提问
                </Button>
                <Button type="button" onClick={() => void handleSubmitClarificationAnswers()} disabled={!clarificationForm}>
                  提交回答并生成计划
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (formStep === 3) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className={`${creationDialogClassName} ${creationFullscreen ? '' : 'h-[80vh]'}`}>
          <div className="px-6 pt-6">
            <CreationStageStepper currentStep={3} />
          </div>
          <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="icon" onClick={() => {
                interruptPlanningRun();
                setAiMessages([]);
                setAiPhase('idle');
                setPlanningStage('awaiting-answers');
                setFormStep(2);
              }} title="返回补充问答">
                <span className="material-symbols-outlined">arrow_back</span>
              </Button>
              <DialogTitle className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-500">map</span>
                计划生成
                {isGeneratingPlan ? (
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground font-normal">
                    <span className="animate-pulse text-amber-500">●</span> 生成中...
                  </span>
                ) : null}
              </DialogTitle>
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
          <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
            <div className="text-xs leading-5 text-muted-foreground">
              系统正在结合你的补充回答生成正式计划制品。完成后会自动进入确认阶段。
            </div>
            <div ref={streamContentRef} className="mt-4 min-h-0 flex-1 space-y-3 overflow-auto rounded-xl border bg-background p-4">
              {aiMessages.map((msg, i) => (
                <div key={`${msg.role}-${i}`}>
                  {msg.role === 'thinking' ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <span className="material-symbols-outlined text-sm">psychology</span>
                        思考过程
                      </div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-amber-800 dark:text-amber-300">{msg.content}</pre>
                    </div>
                  ) : msg.role === 'user' ? null : (
                    (() => {
                      const { text, cards } = parseActions(msg.content);
                      return (
                        <div className="space-y-3 rounded-lg border bg-muted/50 p-4">
                          {text ? <Markdown>{text}</Markdown> : null}
                          {cards.map((card, ci) => (
                            <UniversalCard key={ci} card={card} />
                          ))}
                        </div>
                      );
                    })()
                  )}
                </div>
              ))}

              {currentThinking ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <span className="material-symbols-outlined text-sm">psychology</span>
                    思考过程<span className="animate-pulse">...</span>
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-amber-800 dark:text-amber-300">{currentThinking}</pre>
                </div>
              ) : null}

              {currentStream ? (
                (() => {
                  const { text, cards } = parseActions(currentStream);
                  return (
                    <div className="space-y-3 rounded-lg border bg-muted/50 p-4">
                      {text ? <Markdown>{text}</Markdown> : null}
                      {cards.map((card, ci) => (
                        <UniversalCard key={ci} card={card} />
                      ))}
                      <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-green-500" />
                    </div>
                  );
                })()
              ) : null}
            </div>
          </div>
          <div className="flex gap-2 justify-end p-6 pt-4 border-t flex-shrink-0">
            <Button type="button" variant="outline" onClick={() => {
              interruptPlanningRun();
              setAiPhase('waiting');
              setPlanningStage('awaiting-answers');
              setFormStep(2);
            }}>
              停止并返回问答
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // AI conversation view (post-plan confirmation for ai-guided mode)
  if (formStep === 5 && workflowMode === 'ai-guided') {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className={`${creationDialogClassName} ${creationFullscreen ? '' : 'h-[80vh]'}`}>
          <ComboboxPortalProvider>
          <div className="px-6 pt-6">
            <CreationStageStepper currentStep={4} />
          </div>
          <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="icon" onClick={handleBackToStep1} title="返回上一步">
                <span className="material-symbols-outlined">arrow_back</span>
              </Button>
              <DialogTitle className="flex items-center gap-2">
                <span className="material-symbols-outlined text-green-500">auto_awesome</span>
                AI 工作流创建
                {aiPhase === 'streaming' && (
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground font-normal">
                    <span className="animate-pulse text-green-500">●</span> 生成中...
                  </span>
                )}
                {aiPhase === 'waiting' && (
                  <span className="inline-flex items-center gap-1 text-sm text-blue-500 font-normal">
                    ● 等待回复
                  </span>
                )}
                {aiPhase === 'done' && (
                  <span className="inline-flex items-center gap-1 text-sm text-green-600 font-normal">
                    ✓ 创建完成
                  </span>
                )}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2">
              <EngineModelSelect
                engine={aiEngine}
                model={aiModel}
                onEngineChange={handleAiEngineChange}
                onModelChange={handleAiModelChange}
                className="w-56"
              />
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

          {/* Conversation area */}
          <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
            <div ref={streamContentRef} className="min-h-0 flex-1 overflow-auto space-y-4">
            {aiMessages.map((msg, i) => (
              <div key={i}>
                {msg.role === 'thinking' ? (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                    <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 mb-1 font-medium">
                      <span className="material-symbols-outlined text-sm">psychology</span>
                      思考过程
                    </div>
                    <pre className="text-xs text-amber-800 dark:text-amber-300 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-auto">{msg.content}</pre>
                  </div>
                ) : msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="bg-blue-500 text-white px-4 py-2 rounded-2xl rounded-br-md max-w-[80%]">
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  (() => {
                    const { text, cards } = parseActions(stripUnclosedResultTail(msg.content));
                    return (
                      <div className="bg-muted/50 rounded-lg p-4 border space-y-3">
                        {text && <Markdown>{text}</Markdown>}
                        {cards.map((card, ci) => (
                          <UniversalCard key={ci} card={card} />
                        ))}
                      </div>
                    );
                  })()
                )}
              </div>
            ))}

            {currentThinking && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 mb-1 font-medium">
                  <span className="material-symbols-outlined text-sm">psychology</span>
                  思考过程<span className="animate-pulse">...</span>
                </div>
                <pre className="text-xs text-amber-800 dark:text-amber-300 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-auto">{currentThinking}</pre>
              </div>
            )}

            {currentStream && (
              (() => {
                const { text, cards } = parseActions(stripUnclosedResultTail(currentStream));
                return (
                  <div className="bg-muted/50 rounded-lg p-4 border space-y-3">
                    {text && <Markdown>{text}</Markdown>}
                    {cards.map((card, ci) => (
                      <UniversalCard key={ci} card={card} />
                    ))}
                    <span className="inline-block w-2 h-4 bg-green-500 animate-pulse ml-0.5" />
                  </div>
                );
              })()
            )}

            <WorkflowDraftPreviewCard preview={workflowDraftPreview} />

            {aiPhase === 'streaming' && !currentStream && !currentThinking && (
              <div className="flex items-center gap-3 text-muted-foreground py-4">
                <div className="animate-spin w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full" />
                <span className="text-sm">AI 正在根据计划制品生成工作流...</span>
              </div>
            )}
            </div>
          </div>

          {/* Input area for user replies */}
          {aiPhase === 'waiting' && (
            <div className="px-6 pb-2 space-y-2">
              {workflowDraftValidation?.ok && workflowDraftConfig && !aiFilename && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                  系统已校验 workflow 草案，点击“确认创建”后写入 configs/{getValues('filename')}。
                </div>
              )}
              {workflowDraftValidation && !workflowDraftValidation.ok && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  workflow 草案未通过系统校验，已要求 AI 按校验结果修正。
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  setAiMessages(prev => [...prev, { role: 'user', content: '分析完成，请继续下一步' }]);
                  sendToAi('分析完成，请继续下一步', backendSessionId);
                }}>
                  → 下一步
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleQuickConfirm} disabled={isSavingWorkflowDraft}>
                  ✓ 确认创建
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  setAiMessages(prev => [...prev, { role: 'user', content: '请调整方案，然后重新展示预览' }]);
                  sendToAi('请调整方案，然后重新展示预览', backendSessionId);
                }}>
                  ↻ 调整方案
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  ref={userInputRef}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleUserReply(); } }}
                  placeholder="输入回复..."
                  className="flex-1"
                />
                <Button type="button" onClick={handleUserReply} disabled={!userInput.trim()}>
                  发送
                </Button>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end p-6 pt-4 border-t flex-shrink-0">
            {aiPhase === 'streaming' && (
              <Button type="button" variant="outline" onClick={() => {
                cleanupStream();
                setAiPhase('waiting');
                if (currentStream) {
                  setAiMessages(prev => [...prev, { role: 'ai', content: currentStream }]);
                  setCurrentStream('');
                }
              }}>
                <span className="material-symbols-outlined text-sm mr-1">stop</span>
                停止
              </Button>
            )}
            <Button type="button" variant="outline" onClick={handleClose}>
              关闭
            </Button>
            {aiPhase === 'done' && aiFilename && (
              <Button type="button" onClick={handleAiComplete}>
                <span className="material-symbols-outlined text-sm mr-1">open_in_new</span>
                打开设计页面
              </Button>
            )}
          </div>
          </ComboboxPortalProvider>
        </DialogContent>
      </Dialog>
    );
  }

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
        title: '创建态会话建立',
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
          <DialogContent className={creationDialogClassName}>
            <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="icon" onClick={() => setFormStep(1)} disabled={isRevisingPlan} title="返回修改需求">
                  <span className="material-symbols-outlined">arrow_back</span>
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

            <div className="flex-1 overflow-auto px-6 pb-6 space-y-4">
              <CreationStageStepper currentStep={4} />

              <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm font-medium">{previewSession.workflowName}</span>
                  <span className="text-xs rounded-full border px-2 py-0.5">创建态 {previewSession.status}</span>
                  <span className="text-xs rounded-full border px-2 py-0.5">计划 {specCoding.status}</span>
                  <span className="text-xs rounded-full border px-2 py-0.5">v{specCoding.version}</span>
                </div>
                {specCoding.summary ? (
                  <p className="text-sm text-muted-foreground leading-6">{specCoding.summary}</p>
                ) : null}
                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>配置文件：{previewSession.filename}</div>
                  <div>参考工作流：{previewSession.referenceWorkflow || '无'}</div>
                  <div>工作目录：{previewSession.workingDirectory}</div>
                  <div>工作区模式：{previewSession.workspaceMode}</div>
                  <div>计划节点数：{specCoding.phases?.length || 0}</div>
                  <div>计划 Agent 数：{workflowAgentNames.length || 0}</div>
                </div>
              </div>

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
                  <div className="text-sm font-medium">创建态历史承接</div>
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
                    <div>参考工作流：{previewSession.referenceWorkflow || '无'}</div>
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

            <div className="flex gap-2 justify-end p-6 pt-4 border-t flex-shrink-0">
              <Button type="button" variant="outline" onClick={() => setFormStep(1)} disabled={isRevisingPlan}>
                返回修改
              </Button>
              <Button type="button" onClick={handleConfirmPreview} disabled={isSubmitting || isRevisingPlan}>
                {isRevisingPlan ? '计划修订生成中...' : workflowMode === 'ai-guided' ? '确认并进入 Workflow 草案' : '确认并创建配置'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={planWorkspaceOpen} onOpenChange={setPlanWorkspaceOpen}>
          <DialogContent className={planWorkspaceDialogClassName}>
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
                        <Button
                          type="button"
                          size="sm"
                          variant={artifactViewMode === 'preview' ? 'default' : 'outline'}
                          onClick={() => setArtifactViewMode('preview')}
                        >
                          原文
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={artifactViewMode === 'edit' ? 'default' : 'outline'}
                          onClick={() => setArtifactViewMode('edit')}
                        >
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={artifactViewMode === 'diff' ? 'default' : 'outline'}
                          onClick={() => setArtifactViewMode('diff')}
                        >
                          差异
                        </Button>
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
                    <div className="text-sm font-medium">创建态历史承接</div>
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
                          <Loader2 className="h-4 w-4 animate-spin" />
                          AI 正在按修订说明重新生成正式计划制品
                        </div>
                        <div className="text-[11px] leading-5 text-amber-700/80 dark:text-amber-300/80">
                          修订完成前不能进入下一步；完成后会自动刷新 requirements、design、tasks，并记录 revision。
                        </div>
                        {currentThinking ? (
                          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                            <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-400">思考过程</div>
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-amber-800 dark:text-amber-300">{currentThinking}</pre>
                          </div>
                        ) : null}
                        {currentStream ? (
                          (() => {
                            const { text, cards } = parseActions(currentStream);
                            return (
                              <div className="space-y-3 rounded-md border bg-background p-3">
                                {text ? <Markdown>{text}</Markdown> : null}
                                {cards.map((card, ci) => (
                                  <UniversalCard key={ci} card={card} />
                                ))}
                                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-amber-500" />
                              </div>
                            );
                          })()
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
      <DialogContent className={creationDialogClassName}>
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
          <CreationStageStepper currentStep={1} />

          <div className="rounded-xl border bg-muted/20 p-4 text-xs leading-6 text-muted-foreground">
            当前处于第 1 步：先收敛需求与约束，并按 `skills/aceharness-spec-coding` 生成正式计划制品。确认计划后，系统才会进入 workflow 草案阶段。
          </div>

          <input type="hidden" {...register('mode')} />
          <input type="hidden" {...register('referenceWorkflow')} />
          <input type="hidden" {...register('workingDirectory')} />
          <input type="hidden" {...register('workspaceMode')} />

          {!homepageCompact && (
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
            <div className={homepageCompact ? 'space-y-2' : 'space-y-4 bg-green-50 dark:bg-green-950/30 rounded-lg p-4 border border-green-200 dark:border-green-800'}>
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
                {...register('requirements')}
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

          <div className="space-y-2">
            <Label htmlFor="referenceWorkflow">参考工作流（可选）</Label>
            <Select
              value={referenceWorkflowValue || '__none__'}
              onValueChange={(value) => {
                setValue('referenceWorkflow', value === '__none__' ? '' : value, { shouldDirty: true, shouldValidate: true });
              }}
            >
              <SelectTrigger id="referenceWorkflow">
                <SelectValue placeholder={referenceLoading ? '加载参考工作流中...' : '选择一个已有工作流作为结构参考'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">不使用参考工作流</SelectItem>
                {referenceWorkflows.map((workflow) => (
                  <SelectItem key={workflow.filename} value={workflow.filename}>
                    {workflow.name} ({workflow.filename})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {referenceConfigLoading ? (
              <p className="text-xs text-muted-foreground">正在读取参考工作流结构...</p>
            ) : effectiveReferenceWorkflowValue && referenceConfig ? (
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <div className="font-medium text-foreground">
                  {referenceWorkflowValue ? '已选择参考工作流' : '系统自动采用参考工作流'}
                </div>
                <div>文件：{effectiveReferenceWorkflowValue}</div>
                <div>模式：{referenceConfig.config?.workflow?.mode === 'state-machine' ? '状态机' : '阶段式'}</div>
                <div>
                  说明：将继承它的结构和 Agent 选用，只更新需求与任务说明。
                  {!referenceWorkflowValue && creationRecommendations?.referenceWorkflow?.source === 'recommended-experience'
                    ? ' 当前未手动指定参考工作流，系统已按相关历史经验自动采用这份骨架。'
                    : ''}
                </div>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              选择后会优先沿用参考工作流的阶段/状态结构和 Agent 选用，替代原有的“复制工作流”模式。
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
                    <div className="font-medium text-foreground">参考 workflow 角色骨架</div>
                    <div>{creationRecommendations.referenceWorkflow.name || creationRecommendations.referenceWorkflow.filename}</div>
                    <div>模式：{creationRecommendations.referenceWorkflow.mode === 'state-machine' ? '状态机' : '阶段式'}</div>
                    {creationRecommendations.referenceWorkflow.supervisorAgent ? (
                      <div>指挥官：{creationRecommendations.referenceWorkflow.supervisorAgent}</div>
                    ) : null}
                    {creationRecommendations.referenceWorkflow.autoApply ? (
                      <div>自动决策：当前未手动指定时，将默认采用这份 workflow 骨架参与预览生成。</div>
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
                    <div>当你未手动提供参考骨架时，SpecCoding 预览和 workflow 草案会直接采用这组编排决策。</div>
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

          <div className="space-y-2">
            <Label htmlFor="workingDirectory">
              工作目录 <span className="text-destructive">*</span>
            </Label>
            <WorkspaceDirectoryPicker
              workspaceRoot="/"
              value={workingDirectoryValue || ''}
              onChange={(path) => setValue('workingDirectory', path, { shouldDirty: true, shouldValidate: true })}
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
            {isGeneratingPlan ? '生成计划中...' : '下一步'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
