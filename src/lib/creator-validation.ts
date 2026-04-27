import { existsSync, readdirSync, statSync } from 'fs';
import { isAbsolute } from 'path';
import type { ZodIssue } from 'zod';
import {
  roleConfigSchema,
  unifiedWorkflowConfigSchema,
} from '@/lib/schemas';
import { getWorkspaceAgentsDir } from '@/lib/app-paths';

export interface ValidationIssue {
  path: string[];
  message: string;
  severity: 'error' | 'warning';
  code?: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  normalized: T | null;
  issues: ValidationIssue[];
}

function zodIssuesToValidationIssues(issues: ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map((item) => String(item)),
    message: issue.message,
    severity: 'error',
    code: issue.code,
  }));
}

function pushIssue(
  issues: ValidationIssue[],
  severity: 'error' | 'warning',
  path: string[],
  message: string,
  code?: string,
) {
  issues.push({ severity, path, message, code });
}

function normalizeWorkflowMode(input: any): 'phase-based' | 'state-machine' {
  return input?.workflow?.mode === 'state-machine' ? 'state-machine' : 'phase-based';
}

function getAvailableAgents(): string[] {
  try {
    const agentsDir = getWorkspaceAgentsDir();
    if (!existsSync(agentsDir)) return [];
    return readdirSync(agentsDir)
      .filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml'))
      .map((entry) => entry.replace(/\.(yaml|yml)$/i, ''));
  } catch {
    return [];
  }
}

export function buildDefaultAgentDraft(input?: Partial<any>) {
  return {
    name: typeof input?.name === 'string' ? input.name : 'example-agent',
    team: typeof input?.team === 'string' ? input.team : 'blue',
    roleType: typeof input?.roleType === 'string' ? input.roleType : (input?.team === 'black-gold' ? 'supervisor' : 'normal'),
    engineModels: input?.engineModels && typeof input.engineModels === 'object' ? input.engineModels : {},
    activeEngine: typeof input?.activeEngine === 'string' ? input.activeEngine : '',
    capabilities: Array.isArray(input?.capabilities) && input.capabilities.length > 0 ? input.capabilities : ['通用协作'],
    systemPrompt: typeof input?.systemPrompt === 'string' && input.systemPrompt.trim()
      ? input.systemPrompt
      : '你是一个专业、可靠的 ACEHarness Agent。',
    description: typeof input?.description === 'string' ? input.description : '示例 Agent',
    keywords: Array.isArray(input?.keywords) ? input.keywords : ['示例'],
    tags: Array.isArray(input?.tags) ? input.tags : ['AI创建'],
  };
}

export function validateAgentDraft(input: any): ValidationResult<any> {
  const parsed = roleConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      normalized: null,
      issues: zodIssuesToValidationIssues(parsed.error.issues),
    };
  }

  const issues: ValidationIssue[] = [];
  const normalized = parsed.data;

  if (!normalized.name || !/^[a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff-]*$/i.test(normalized.name)) {
    pushIssue(issues, 'error', ['name'], 'name 必须适合作为 agent 文件名，推荐 kebab-case');
  }

  if (normalized.team === 'black-gold' && normalized.roleType !== 'supervisor') {
    pushIssue(issues, 'error', ['roleType'], 'black-gold 阵营必须使用 supervisor 角色类型');
  }

  if (normalized.activeEngine && !normalized.engineModels[normalized.activeEngine]) {
    pushIssue(issues, 'error', ['activeEngine'], 'activeEngine 必须能在 engineModels 中找到对应模型');
  }

  if (!normalized.activeEngine && Object.keys(normalized.engineModels || {}).length > 0) {
    pushIssue(issues, 'warning', ['activeEngine'], '当前保存了 engineModels，但 activeEngine 为空，将回退为跟随全局引擎');
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    normalized,
    issues,
  };
}

export function validateWorkflowDraft(input: any): ValidationResult<any> {
  const parsed = unifiedWorkflowConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      normalized: null,
      issues: zodIssuesToValidationIssues(parsed.error.issues),
    };
  }

  const normalized = parsed.data;
  const issues: ValidationIssue[] = [];
  const mode = normalizeWorkflowMode(normalized);
  const workflowAny = normalized.workflow as any;
  const projectRoot = typeof normalized?.context?.projectRoot === 'string'
    ? normalized.context.projectRoot.trim()
    : '';

  if (!projectRoot) {
    pushIssue(issues, 'error', ['context', 'projectRoot'], 'context.projectRoot 不能为空');
  } else if (!isAbsolute(projectRoot)) {
    pushIssue(issues, 'error', ['context', 'projectRoot'], 'context.projectRoot 必须是绝对路径');
  } else if (!existsSync(projectRoot)) {
    pushIssue(issues, 'error', ['context', 'projectRoot'], 'context.projectRoot 指向的目录不存在');
  } else {
    try {
      if (!statSync(projectRoot).isDirectory()) {
        pushIssue(issues, 'error', ['context', 'projectRoot'], 'context.projectRoot 必须指向目录');
      }
    } catch {
      pushIssue(issues, 'error', ['context', 'projectRoot'], '无法访问 context.projectRoot');
    }
  }

  if (normalized.context.workspaceMode && !['isolated-copy', 'in-place'].includes(normalized.context.workspaceMode)) {
    pushIssue(issues, 'error', ['context', 'workspaceMode'], 'workspaceMode 只能是 isolated-copy 或 in-place');
  }

  const availableAgents = new Set(getAvailableAgents());
  const referencedAgents = new Set<string>();
  if (mode === 'state-machine') {
    const stateNames = new Set<string>();
    for (const state of workflowAny.states || []) {
      if (stateNames.has(state.name)) {
        pushIssue(issues, 'error', ['workflow', 'states'], `状态名称重复: ${state.name}`);
      }
      stateNames.add(state.name);
      for (const step of state.steps || []) {
        referencedAgents.add(step.agent);
      }
      for (const transition of state.transitions || []) {
        if (!stateNames.has(transition.to) && !(workflowAny.states || []).some((item: any) => item.name === transition.to)) {
          pushIssue(issues, 'error', ['workflow', 'states', state.name, 'transitions'], `状态 "${state.name}" 的转移目标 "${transition.to}" 不存在`);
        }
      }
    }
    const initialCount = (workflowAny.states || []).filter((state: any) => state.isInitial).length;
    const finalCount = (workflowAny.states || []).filter((state: any) => state.isFinal).length;
    if (initialCount !== 1) {
      pushIssue(issues, 'error', ['workflow', 'states'], '状态机必须且只能有一个初始状态');
    }
    if (finalCount < 1) {
      pushIssue(issues, 'error', ['workflow', 'states'], '状态机必须至少有一个终止状态');
    }
    for (const state of workflowAny.states || []) {
      if (state.isFinal && Array.isArray(state.transitions) && state.transitions.length > 0) {
        pushIssue(issues, 'warning', ['workflow', 'states', state.name, 'transitions'], `终止状态 "${state.name}" 通常不应再配置转移规则`);
      }
    }
  } else {
    for (const phase of workflowAny.phases || []) {
      for (const step of phase.steps || []) {
        referencedAgents.add(step.agent);
      }
    }
  }

  const supervisorAgent = normalized.workflow.supervisor?.agent?.trim();
  if (!supervisorAgent) {
    pushIssue(issues, 'warning', ['workflow', 'supervisor', 'agent'], '未显式指定 supervisor，将回退到 default-supervisor');
  } else if (availableAgents.size > 0 && !availableAgents.has(supervisorAgent)) {
    pushIssue(issues, 'error', ['workflow', 'supervisor', 'agent'], `supervisor "${supervisorAgent}" 当前未在 agents 目录中找到`);
  }

  for (const agent of referencedAgents) {
    if (availableAgents.size > 0 && !availableAgents.has(agent)) {
      pushIssue(issues, 'error', ['workflow'], `引用的 Agent 不存在: ${agent}`);
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    normalized,
    issues,
  };
}

export function formatValidationIssuesForResponse(result: ValidationResult<any>) {
  return {
    ok: result.ok,
    issues: result.issues,
  };
}
