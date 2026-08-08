import { existsSync, readdirSync, statSync } from 'fs';
import { isAbsolute } from 'path';
import type { ZodIssue } from 'zod';
import {
  roleConfigSchema,
  unifiedWorkflowConfigSchema,
} from '@/lib/core/schemas';
import { normalizeAgentAvatar } from '@/lib/agent/personas';
import { getWorkspaceAgentsDir } from '@/lib/core/app-paths';
import { getSubworkflowConfigFile, isSubworkflowStep, normalizeWorkflowConfigRef } from '@/lib/workflow/subworkflow-config';
import { DEFAULT_SUPERVISOR_NAME } from '@/lib/core/default-supervisor';
import {
  isStandardReviewStructure,
  isStateLevelReviewAdopted,
  isStrictAdversarialRoleSequence,
  normalizeStateMachineWorkflowConfig,
} from '@/lib/workflow/state-review-policy';

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

export interface WorkflowValidationOptions {
  mode?: 'runtime' | 'portable';
  materializeIds?: boolean;
  workflowKey?: string;
  /**
   * Adopt the review protocol for states that carry no policy yet. Only paths
   * where the user explicitly opted in should set this — validating or saving an
   * existing workflow must not rewrite its execution shape.
   */
  adoptLegacyPolicy?: boolean;
}

function expandZodIssue(issue: ZodIssue, inheritedPath: string[] = []): ValidationIssue[] {
  const currentPath = [...inheritedPath, ...issue.path.map((item) => String(item))];
  const nestedErrors = (issue as any)?.errors;

  if (issue.code === 'invalid_union' && Array.isArray(nestedErrors) && nestedErrors.length > 0) {
    const expanded = nestedErrors.flatMap((branchIssues: unknown) => (
      Array.isArray(branchIssues)
        ? branchIssues.flatMap((branchIssue) => expandZodIssue(branchIssue as ZodIssue, currentPath))
        : []
    ));
    if (expanded.length > 0) {
      const deduped = new Map<string, ValidationIssue>();
      for (const entry of expanded) {
        const key = `${entry.path.join('.')}|${entry.message}|${entry.code || ''}`;
        if (!deduped.has(key)) {
          deduped.set(key, entry);
        }
      }
      return [...deduped.values()];
    }
  }

  return [{
    path: currentPath,
    message: issue.message,
    severity: 'error',
    code: issue.code,
  }];
}

function zodIssuesToValidationIssues(issues: ZodIssue[]): ValidationIssue[] {
  return issues.flatMap((issue) => expandZodIssue(issue));
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

function hasAdvancedTransitionFilters(transition: any): boolean {
  return Boolean(
    transition?.condition?.issueTypes?.length
    || transition?.condition?.severities?.length
    || transition?.condition?.minIssueCount !== undefined
    || transition?.condition?.maxIssueCount !== undefined
    || transition?.condition?.custom?.trim()
  );
}

function getAvailableAgents(): string[] {
  try {
    const agentsDir = getWorkspaceAgentsDir();
    if (!existsSync(agentsDir)) return [];
    const names = readdirSync(agentsDir)
      .filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml'))
      .map((entry) => entry.replace(/\.(yaml|yml)$/i, ''));
    return Array.from(new Set([...names, DEFAULT_SUPERVISOR_NAME]));
  } catch {
    return [];
  }
}

export function buildDefaultAgentDraft(input?: Partial<any>) {
  return {
    name: typeof input?.name === 'string' ? input.name : 'example-agent',
    team: typeof input?.team === 'string' ? input.team : 'red',
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
    expertPacks: Array.isArray(input?.expertPacks) ? input.expertPacks : [],
    catalogVisibility: typeof input?.catalogVisibility === 'string' ? input.catalogVisibility : 'default',
    baseCapability: typeof input?.baseCapability === 'string' ? input.baseCapability : undefined,
    taskModes: Array.isArray(input?.taskModes) ? input.taskModes : [],
    skills: Array.isArray(input?.skills) ? input.skills : [],
  };
}

function preprocessAgentDraftInput(input: any) {
  if (!input || typeof input !== 'object') return input;
  const source = input as Record<string, any>;
  const team = ['blue', 'red', 'judge', 'black-gold'].includes(String(source.team || ''))
    ? source.team
    : 'red';
  const hasExplicitRoleType = typeof source.roleType === 'string';
  const roleType = source.roleType === 'supervisor'
    ? 'supervisor'
    : hasExplicitRoleType
      ? 'normal'
      : team === 'black-gold'
        ? 'supervisor'
        : 'normal';
  const seed = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : 'agent';
  const isDefaultSupervisor = seed === DEFAULT_SUPERVISOR_NAME;
  const normalizedTeam = isDefaultSupervisor ? 'black-gold' : team;
  const normalizedRoleType = isDefaultSupervisor ? 'supervisor' : roleType;

  return {
    ...source,
    name: seed,
    team: normalizedTeam,
    roleType: normalizedRoleType,
    catalogVisibility: isDefaultSupervisor ? 'system' : source.catalogVisibility,
    avatar: normalizeAgentAvatar(source.avatar, seed, { team: normalizedTeam, roleType: normalizedRoleType }),
  };
}

export function validateAgentDraft(input: any): ValidationResult<any> {
  const parsed = roleConfigSchema.safeParse(preprocessAgentDraftInput(input));
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

  if (normalized.roleType === 'supervisor' && normalized.name !== DEFAULT_SUPERVISOR_NAME) {
    pushIssue(issues, 'error', ['roleType'], '系统只保留 default-supervisor 作为唯一 Supervisor');
  }

  if (normalized.name === DEFAULT_SUPERVISOR_NAME && normalized.catalogVisibility !== 'system') {
    pushIssue(issues, 'error', ['catalogVisibility'], 'default-supervisor 必须作为系统指挥官保留');
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

export function validateWorkflowDraft(input: any, options: WorkflowValidationOptions = {}): ValidationResult<any> {
  const normalizedInput = normalizeStateMachineWorkflowConfig(input, {
    materializeIds: options.materializeIds,
    workflowKey: options.workflowKey,
    adoptLegacyPolicy: options.adoptLegacyPolicy,
  });
  const parsed = unifiedWorkflowConfigSchema.safeParse(normalizedInput);
  if (!parsed.success) {
    return {
      ok: false,
      normalized: null,
      issues: zodIssuesToValidationIssues(parsed.error.issues),
    };
  }

  const normalized = parsed.data;
  const issues: ValidationIssue[] = [];
  const validationMode = options.mode || 'runtime';
  const shouldCheckRuntimeEnvironment = validationMode === 'runtime';
  const workflowAny = normalized.workflow as any;
  const isLightweightWorkflow = workflowAny.profile === 'lightweight';
  const projectRoot = typeof normalized?.context?.projectRoot === 'string'
    ? normalized.context.projectRoot.trim()
    : '';
  const stepAgentRefs: Array<{
    agent: string;
    path: string[];
    nodeName: string;
    stepName: string;
  }> = [];

  if (shouldCheckRuntimeEnvironment) {
    if (!projectRoot) {
      pushIssue(issues, 'error', ['context', 'projectRoot'], 'context.projectRoot 不能为空');
    } else if (!isAbsolute(projectRoot)) {
      pushIssue(issues, 'error', ['context', 'projectRoot'], 'context.projectRoot 必须是绝对路径，必须以 / 开头，例如 "/Users/xxx/project" 或 "/home/user/repo"');
    } else if (!existsSync(projectRoot)) {
      pushIssue(issues, 'error', ['context', 'projectRoot'], 'context.projectRoot 指向的目录不存在，请确认路径正确且目录已创建');
    } else {
      try {
        if (!statSync(projectRoot).isDirectory()) {
          pushIssue(issues, 'error', ['context', 'projectRoot'], 'context.projectRoot 必须指向目录，不能是文件路径');
        }
      } catch {
        pushIssue(issues, 'error', ['context', 'projectRoot'], '无法访问 context.projectRoot');
      }
    }
  }

  if (normalized.context.workspaceMode && !['isolated-copy', 'in-place'].includes(normalized.context.workspaceMode)) {
    pushIssue(issues, 'error', ['context', 'workspaceMode'], 'workspaceMode 只能是 isolated-copy 或 in-place');
  }

  const availableAgents = shouldCheckRuntimeEnvironment ? new Set(getAvailableAgents()) : null;
  const referencedAgents = new Set<string>();
  const requiredVerdicts = ['pass', 'conditional_pass', 'fail'] as const;
  const stateNames = new Set<string>();
  for (const [stateIndex, state] of (workflowAny.states || []).entries()) {
    if (stateNames.has(state.name)) {
      pushIssue(issues, 'error', ['workflow', 'states'], `状态名称重复: ${state.name}`);
    }
    stateNames.add(state.name);
    if (!state.isFinal && (!Array.isArray(state.steps) || state.steps.length === 0)) {
      pushIssue(
        issues,
        'error',
        ['workflow', 'states', String(stateIndex), 'steps'],
        `非终止状态 "${state.name || `状态 ${stateIndex + 1}`}" 至少需要一个步骤`
      );
    }
    for (const [stepIndex, step] of (state.steps || []).entries()) {
      if (isSubworkflowStep(step)) {
        const childConfigFile = getSubworkflowConfigFile(step);
        try {
          normalizeWorkflowConfigRef(childConfigFile);
        } catch (error: any) {
          pushIssue(
            issues,
            'error',
            ['workflow', 'states', String(stateIndex), 'steps', String(stepIndex), 'workflow'],
            error?.message || '子工作流配置路径非法'
          );
        }
        continue;
      }
      referencedAgents.add(step.agent);
      stepAgentRefs.push({
        agent: step.agent,
        path: ['workflow', 'states', String(stateIndex), 'steps', String(stepIndex), 'agent'],
        nodeName: state.name || `状态 ${stateIndex + 1}`,
        stepName: step.name || `步骤 ${stepIndex + 1}`,
      });
    }
    for (const transition of state.transitions || []) {
      if (!stateNames.has(transition.to) && !(workflowAny.states || []).some((item: any) => item.name === transition.to)) {
        pushIssue(issues, 'error', ['workflow', 'states', state.name, 'transitions'], `状态 "${state.name}" 的转移目标 "${transition.to}" 不存在。当前已定义的状态: [${[...stateNames].join(', ')}]。修复方法：将 to 改为已定义的状态名之一`);
      }
    }
  }
  const initialCount = (workflowAny.states || []).filter((state: any) => state.isInitial).length;
  const finalCount = (workflowAny.states || []).filter((state: any) => state.isFinal).length;
  if (initialCount !== 1) {
    pushIssue(issues, 'error', ['workflow', 'states'], `状态机必须且只能有一个初始状态（isInitial: true），当前有 ${initialCount} 个。修复方法：确保有且仅有一个状态设置 isInitial: true`);
  }
  if (finalCount < 1) {
    pushIssue(issues, 'error', ['workflow', 'states'], '状态机必须至少有一个终止状态（isFinal: true）。修复方法：添加一个 {"name": "完成", "isFinal": true, "steps": [], "transitions": []} 状态');
  }
  // Adoption is a property of the workflow, not of whichever state happens to
  // carry a policy: attaching one to a single new state must not make every
  // pre-protocol state in the same config suddenly invalid. Once adopted, the
  // guard keeps applying on every save, not only at the moment of adoption.
  const protocolAdopted = Boolean(options.adoptLegacyPolicy) || isStateLevelReviewAdopted(input);
  for (const state of workflowAny.states || []) {
    if (state.isFinal && Array.isArray(state.transitions) && state.transitions.length > 0) {
      pushIssue(issues, 'warning', ['workflow', 'states', state.name, 'transitions'], `终止状态 "${state.name}" 通常不应再配置转移规则`);
      continue;
    }
    if (state.isFinal) {
      continue;
    }

    if (!isLightweightWorkflow) {
      if (!state.reviewPolicy) {
        // Only a workflow that has adopted the protocol owes a policy on every
        // non-final state. Demanding it from a pre-protocol config would make
        // saving one impossible unless it were silently rewritten.
        if (protocolAdopted) {
          pushIssue(issues, 'error', ['workflow', 'states', state.name, 'reviewPolicy'], `非终态 "${state.name}" 必须包含 reviewPolicy`);
        }
      } else if (state.reviewPolicy.mode === 'adversarial' && !isStrictAdversarialRoleSequence(state)) {
        pushIssue(
          issues,
          'error',
          ['workflow', 'states', state.name, 'steps'],
          `对抗状态 "${state.name}" 必须严格按 defender 段 → 串行 attacker → 最终串行 judge 编排`,
          'invalid_adversarial_sequence',
        );
      } else if (state.reviewPolicy.mode === 'adversarial') {
        const roleSteps = (state.steps || []).filter((step: any) => ['defender', 'attacker', 'judge'].includes(step.role));
        const missingInstance = roleSteps.find((step: any) => !String(step.agentInstanceId || '').trim());
        if (missingInstance) {
          pushIssue(
            issues,
            'error',
            ['workflow', 'states', state.name, 'steps'],
            `对抗状态 "${state.name}" 的角色步骤 "${missingInstance.name}" 缺少 agentInstanceId`,
            'missing_adversarial_instance',
          );
        }
        const rolesByInstance = new Map<string, Set<string>>();
        for (const step of roleSteps) {
          const instanceId = String(step.agentInstanceId || '').trim();
          if (!instanceId) continue;
          const roles = rolesByInstance.get(instanceId) || new Set<string>();
          roles.add(step.role);
          rolesByInstance.set(instanceId, roles);
        }
        const collision = [...rolesByInstance.entries()].find(([, roles]) => roles.size > 1);
        if (collision) {
          pushIssue(
            issues,
            'error',
            ['workflow', 'states', state.name, 'steps'],
            `对抗状态 "${state.name}" 的运行实例 "${collision[0]}" 被多个角色复用`,
            'adversarial_instance_collision',
          );
        }
      } else if (
        state.reviewPolicy.mode === 'standard'
        && ['ai', 'user'].includes(state.reviewPolicy.source)
        && (state.steps || []).some((step: any) => step.role === 'attacker' || step.role === 'judge')
      ) {
        pushIssue(
          issues,
          'error',
          ['workflow', 'states', state.name, 'steps'],
          `标准状态 "${state.name}" 不应包含 attacker 或独立 judge`,
          'invalid_standard_roles',
        );
      } else if (
        state.reviewPolicy.mode === 'standard'
        && ['ai', 'user'].includes(state.reviewPolicy.source)
        && !isStandardReviewStructure(state)
      ) {
        pushIssue(
          issues,
          'error',
          ['workflow', 'states', state.name, 'steps'],
          `标准状态 "${state.name}" 必须以一个串行步骤收口并输出 verdict`,
          'missing_standard_verdict_closer',
        );
      }
    }

    const transitions = Array.isArray(state.transitions) ? state.transitions : [];
    const verdictTransitions = transitions.filter((transition: any) => (
      typeof transition?.condition?.verdict === 'string'
      && requiredVerdicts.includes(transition.condition.verdict)
    ));
    const nonVerdictTransitions = transitions.filter((transition: any) => !requiredVerdicts.includes(transition?.condition?.verdict));

    if (nonVerdictTransitions.length > 0) {
      pushIssue(
        issues,
        'error',
        ['workflow', 'states', state.name, 'transitions'],
        `状态 "${state.name}" 现在要求使用固定三路 verdict 转移，不再支持未指定 verdict 的额外转移规则`
      );
    }

    for (const verdict of requiredVerdicts) {
      const matches = verdictTransitions.filter((transition: any) => transition.condition.verdict === verdict);
      if (matches.length === 0) {
        pushIssue(
          issues,
          'error',
          ['workflow', 'states', state.name, 'transitions'],
          `状态 "${state.name}" 缺少 ${verdict} 转移路径。每个非终止状态必须有 pass、conditional_pass、fail 三条转移。修复方法：添加 {"to": "<目标状态名>", "condition": {"verdict": "${verdict}"}}`
        );
        continue;
      }

      const fallbackMatches = matches.filter((transition: any) => !hasAdvancedTransitionFilters(transition));
      if (fallbackMatches.length === 0) {
        pushIssue(
          issues,
          'error',
          ['workflow', 'states', state.name, 'transitions'],
          `状态 "${state.name}" 的 ${verdict} 缺少兜底转移。每个 verdict 必须保留 1 条无过滤条件的基础路径。修复方法：补充一条仅包含 {"verdict": "${verdict}"} 的转移`
        );
      } else if (fallbackMatches.length > 1) {
        pushIssue(
          issues,
          'error',
          ['workflow', 'states', state.name, 'transitions'],
          `状态 "${state.name}" 的 ${verdict} 存在多条兜底转移（共 ${fallbackMatches.length} 条）。每个 verdict 只能保留 1 条无过滤条件的基础路径，其余规则需要补充过滤条件或删除`
        );
      }
    }
  }

  const supervisorAgent = normalized.workflow.supervisor?.agent?.trim();
  const effectiveSupervisorAgent = isLightweightWorkflow
    ? undefined
    : (supervisorAgent || DEFAULT_SUPERVISOR_NAME);
  if (isLightweightWorkflow) {
    if (input?.workflow?.supervisor) {
      pushIssue(issues, 'error', ['workflow', 'supervisor'], '轻量工作流不支持 Supervisor 配置');
    }
    // The schema supplies defaults for ordinary state-machine workflows. Do
    // not let that default leak into the normalized lightweight config.
    delete workflowAny.supervisor;
  } else if (!supervisorAgent) {
    pushIssue(issues, 'warning', ['workflow', 'supervisor', 'agent'], '未显式指定 supervisor，将回退到 default-supervisor');
  } else if (availableAgents && availableAgents.size > 0 && !availableAgents.has(supervisorAgent)) {
    pushIssue(issues, 'error', ['workflow', 'supervisor', 'agent'], `supervisor "${supervisorAgent}" 当前未在 agents 目录中找到`);
  }

  for (const stepRef of stepAgentRefs) {
    if (effectiveSupervisorAgent && stepRef.agent === effectiveSupervisorAgent) {
      pushIssue(
        issues,
        'error',
        stepRef.path,
        `步骤 "${stepRef.nodeName} / ${stepRef.stepName}" 不能使用 supervisor "${effectiveSupervisorAgent}" 作为任务 Agent。supervisor 只负责调度、审阅和检查点建议；请把该步骤 agent 改为普通执行 Agent，例如 developer、architect、tester 或你的业务 Agent。`,
        'supervisor_step_agent'
      );
    }
  }

  for (const agent of referencedAgents) {
    if (availableAgents && availableAgents.size > 0 && !availableAgents.has(agent)) {
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
