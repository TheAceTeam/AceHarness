import { z } from 'zod';

const agentTeamSchema = z.enum(['blue', 'red', 'judge', 'yellow', 'black-gold']);
const agentRoleTypeSchema = z.enum(['normal', 'supervisor']);
const agentAvatarConfigSchema = z.object({
  mode: z.enum(['deterministic', 'generated', 'uploaded', 'preset']),
  seed: z.string().optional(),
  style: z.enum(['personas', 'adventurer', 'pixel-art']).optional(),
  prompt: z.string().optional(),
  imageUrl: z.string().optional(),
  thumbUrl: z.string().optional(),
  presetName: z.string().optional(),
  generatedAt: z.string().optional(),
});

const workflowSupervisorConfigSchema = z.object({
  enabled: z.boolean().default(true),
  agent: z.string().min(1).default('default-supervisor'),
  stageReviewEnabled: z.boolean().default(true),
  checkpointAdviceEnabled: z.boolean().default(true),
  scoringEnabled: z.boolean().default(true),
  experienceEnabled: z.boolean().default(true),
}).optional();

// 迭代配置 Schema
export const iterationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxIterations: z.number().min(1).max(20).default(5),
  exitCondition: z.enum(['no_new_bugs_3_rounds', 'all_resolved', 'manual']).default('no_new_bugs_3_rounds'),
  consecutiveCleanRounds: z.number().min(1).max(10).default(3),
  escalateToHuman: z.boolean().default(true),
});

// 工作流步骤 Schema
export const workflowStepSchema = z.object({
  name: z.string().min(1, '步骤名称不能为空'),
  agent: z.string().min(1, 'Agent 名称不能为空'),
  task: z.string().min(1, '任务描述不能为空'),
  // 可选：在执行 Agent 之前，由系统自动执行的一组预命令（通常是编译 / 测试命令）
  // 注意：这些命令在后端 Node 环境中串行执行，stdout/stderr 会被收集并注入上下文，
  // 不会中断整个步骤（即使命令本身返回非 0 退出码）。
  preCommands: z.array(z.string()).optional(),
  type: z.string().optional(),
  role: z.enum(['attacker', 'defender', 'judge']).optional(),
  constraints: z.array(z.string()).optional(),
  parallelGroup: z.string().optional(),
  enableReviewPanel: z.boolean().optional(), // 是否启用会审模式
  skills: z.array(z.string()).optional(), // 步骤级别的 skills
});

// 检查点 Schema
export const checkpointSchema = z.object({
  name: z.string().min(1, '检查点名称不能为空'),
  message: z.string().min(1, '检查点消息不能为空'),
});

// 工作流阶段 Schema
export const workflowPhaseSchema = z.object({
  name: z.string().min(1, '阶段名称不能为空'),
  steps: z.array(workflowStepSchema).min(1, '至少需要一个步骤'),
  checkpoint: checkpointSchema.optional(),
  iteration: iterationConfigSchema.optional(),
});

// 角色配置 Schema
export const roleConfigSchema = z.object({
  name: z.string().min(1, '角色名称不能为空'),
  team: agentTeamSchema,
  roleType: agentRoleTypeSchema.optional().default('normal'),
  avatar: z.union([z.string(), agentAvatarConfigSchema]).optional(),
  title: z.string().optional(),
  persona: z.string().optional(),
  greeting: z.string().optional(),
  rarity: z.enum(['common', 'rare', 'epic', 'legendary']).optional(),
  engineModels: z.record(z.string(), z.string()), // 引擎→模型映射，仅保存具体引擎；跟随全局时不保存模型
  activeEngine: z.string(), // 当前启用的引擎 key（""=跟随全局）
  temperature: z.number().optional(),
  capabilities: z.array(z.string()).min(1, '至少需要一个能力'),
  systemPrompt: z.string().min(1, '系统提示不能为空'),
  iterationPrompt: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  specialtyTags: z.array(z.string()).optional(),
  alwaysAvailableForChat: z.boolean().optional(),
  // ---- Supervisor-Lite 新增（给 Supervisor 路由器用，不注入 Agent prompt）----
  keywords: z.array(z.string()).optional(), // 路由关键词
  description: z.string().optional(), // Agent 能力描述
  reviewPanel: z.object({
    enabled: z.boolean(),
    description: z.string().optional(),
    subAgents: z.record(z.string(), z.object({
      description: z.string(),
      prompt: z.string(),
      tools: z.array(z.string()),
      model: z.string(),
    })),
  }).optional(),
  mcpServers: z.array(z.object({
    name: z.string().min(1),
    type: z.enum(['cangjie-magic', 'stdio']),
    command: z.string().min(1),
    projectDir: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  })).optional(),
});

// 上下文配置 Schema
export const contextConfigSchema = z.object({
  projectRoot: z.string().optional(),
  workspaceMode: z.enum(['isolated-copy', 'in-place']).optional(),
  requirements: z.string().optional(),
  codebase: z.string().optional(),
  timeoutMinutes: z.number().min(1).optional(),
  engine: z.string().optional(), // 工作流级别引擎覆盖
  skills: z.array(z.string()).optional(), // 启用的 skills 列表
  routerModel: z.string().optional(), // Supervisor-Lite 路由模型（可选）
});

// 完整工作流配置 Schema
export const workflowConfigSchema = z.object({
  workflow: z.object({
    name: z.string().min(1, '工作流名称不能为空'),
    description: z.string().optional(),
    phases: z.array(workflowPhaseSchema).min(1, '至少需要一个阶段'),
    supervisor: workflowSupervisorConfigSchema,
  }),
  roles: z.array(roleConfigSchema).optional(),
  context: contextConfigSchema,
});

// TypeScript 类型导出
export type IterationConfig = z.infer<typeof iterationConfigSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type WorkflowPhase = z.infer<typeof workflowPhaseSchema>;
export type RoleConfig = z.infer<typeof roleConfigSchema>;
export type ContextConfig = z.infer<typeof contextConfigSchema>;
export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;

// 新建配置表单 Schema
export const newConfigFormSchema = z.object({
  filename: z
    .string()
    .min(1, '文件名不能为空')
    .regex(/^[a-zA-Z0-9_-]+\.yaml$/, '文件名必须以 .yaml 结尾且只包含字母、数字、下划线和连字符'),
  workflowName: z.string().min(1, '工作流名称不能为空'),
  referenceWorkflow: z.string().optional(),
  workingDirectory: z
    .string()
    .min(1, '工作目录不能为空'),
  workspaceMode: z.enum(['isolated-copy', 'in-place']).default('in-place'),
  description: z.string().optional(),
  mode: z.enum(['phase-based', 'state-machine', 'ai-guided']).default('phase-based').optional(),
  requirements: z.string().optional(), // AI 引导模式下的需求描述
});

export type NewConfigForm = z.infer<typeof newConfigFormSchema>;

// 复制配置表单 Schema
export const copyConfigFormSchema = z.object({
  newFilename: z
    .string()
    .min(1, '文件名不能为空')
    .regex(/^[a-zA-Z0-9_-]+\.yaml$/, '文件名必须以 .yaml 结尾且只包含字母、数字、下划线和连字符'),
  workflowName: z
    .string()
    .min(1, '工作流名称不能为空')
    .max(100, '工作流名称不能超过100个字符'),
});

export type CopyConfigForm = z.infer<typeof copyConfigFormSchema>;

export const specCodingStatusSchema = z.enum(['draft', 'confirmed', 'in-progress', 'completed', 'archived']);
export const specCodingProgressStatusSchema = z.enum(['pending', 'in-progress', 'completed', 'blocked']);

export const specCodingRequirementSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  category: z.enum(['goal', 'constraint', 'acceptance', 'context']).default('goal'),
});

export const specCodingPhaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  objective: z.string().optional(),
  ownerAgents: z.array(z.string()).default([]),
  status: specCodingProgressStatusSchema.default('pending'),
});

export const specCodingAssignmentSchema = z.object({
  agent: z.string(),
  responsibility: z.string(),
  phaseIds: z.array(z.string()).default([]),
});

export const specCodingCheckpointSchema = z.object({
  id: z.string(),
  title: z.string(),
  phaseId: z.string().optional(),
  status: specCodingProgressStatusSchema.default('pending'),
});

export const specCodingProgressSchema = z.object({
  overallStatus: specCodingProgressStatusSchema.default('pending'),
  completedPhaseIds: z.array(z.string()).default([]),
  activePhaseId: z.string().optional(),
  summary: z.string().optional(),
});

export interface SpecCodingTaskInput {
  id: string;
  title: string;
  detail?: string;
  status?: z.infer<typeof specCodingProgressStatusSchema>;
  requirements?: string[];
  children: SpecCodingTaskInput[];
  phaseId?: string;
  ownerAgents?: string[];
  updatedAt?: string;
  updatedBy?: string;
  validation?: string;
}

export const specCodingTaskSchema: z.ZodType<SpecCodingTaskInput> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    detail: z.string().optional(),
    status: specCodingProgressStatusSchema.default('pending'),
    requirements: z.array(z.string()).default([]),
    children: z.array(specCodingTaskSchema).default([]),
    phaseId: z.string().optional(),
    ownerAgents: z.array(z.string()).default([]),
    updatedAt: z.string().optional(),
    updatedBy: z.string().optional(),
    validation: z.string().optional(),
  })
);

export const specCodingRevisionSchema = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  summary: z.string(),
  createdAt: z.string(),
  createdBy: z.string().optional(),
});

export const specCodingArtifactsSchema = z.object({
  requirements: z.string().default(''),
  design: z.string().default(''),
  tasks: z.string().default(''),
});

export const specCodingDocumentSchema = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  status: specCodingStatusSchema.default('draft'),
  title: z.string(),
  workflowName: z.string(),
  summary: z.string().optional(),
  goals: z.array(z.string()).default([]),
  nonGoals: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  requirements: z.array(specCodingRequirementSchema).default([]),
  phases: z.array(specCodingPhaseSchema).default([]),
  assignments: z.array(specCodingAssignmentSchema).default([]),
  checkpoints: z.array(specCodingCheckpointSchema).default([]),
  tasks: z.array(specCodingTaskSchema).default([]),
  progress: specCodingProgressSchema,
  revisions: z.array(specCodingRevisionSchema).default([]),
  artifacts: specCodingArtifactsSchema.default({
    requirements: '',
    design: '',
    tasks: '',
  }),
  linkedConfigFilename: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  confirmedAt: z.string().optional(),
});

export const creationSessionStatusSchema = z.enum(['draft', 'confirmed', 'config-generated', 'run-bound', 'archived']);

export const creationSessionSchema = z.object({
  id: z.string(),
  chatSessionId: z.string().optional(),
  createdBy: z.string().optional(),
  status: creationSessionStatusSchema.default('draft'),
  workflowName: z.string(),
  filename: z.string(),
  mode: z.enum(['phase-based', 'state-machine', 'ai-guided']),
  referenceWorkflow: z.string().optional(),
  workingDirectory: z.string(),
  workspaceMode: z.enum(['isolated-copy', 'in-place']),
  description: z.string().optional(),
  requirements: z.string().optional(),
  clarification: z.object({
    summary: z.string().optional(),
    knownFacts: z.array(z.string()).default([]),
    missingFields: z.array(z.string()).default([]),
    questions: z.array(z.string()).default([]),
  }).optional(),
  uiState: z.object({
    formStep: z.number().int().min(1).max(5).optional(),
    planningStage: z.enum(['idle', 'clarifying', 'awaiting-answers', 'generating-plan']).optional(),
    clarificationForm: z.object({
      type: z.literal('clarification_form'),
      summary: z.string().optional(),
      knownFacts: z.array(z.string()).default([]),
      missingFields: z.array(z.string()).default([]),
      questions: z.array(z.object({
        id: z.string(),
        label: z.string(),
        question: z.string(),
        selectionMode: z.enum(['single', 'multiple']).optional(),
        options: z.array(z.object({
          id: z.string(),
          label: z.string(),
          description: z.string().optional(),
          recommended: z.boolean().optional(),
        })).default([]),
        placeholder: z.string().optional(),
        required: z.boolean().optional(),
      })).default([]),
    }).optional(),
    clarificationAnswers: z.record(z.string(), z.object({
      optionIds: z.array(z.string()).default([]),
      note: z.string().default(''),
    })).default({}),
  }).optional(),
  specCoding: specCodingDocumentSchema,
  generatedConfigSummary: z.object({
    mode: z.enum(['phase-based', 'state-machine']),
    phaseCount: z.number().int().min(0).default(0),
    stateCount: z.number().int().min(0).default(0),
    agentNames: z.array(z.string()).default([]),
  }).optional(),
  workflowDraftSummary: z.object({
    mode: z.enum(['phase-based', 'state-machine']),
    nodes: z.array(z.object({
      name: z.string(),
      detail: z.string(),
      ownerAgents: z.array(z.string()).default([]),
    })).default([]),
    assignments: z.array(z.object({
      agent: z.string(),
      responsibility: z.string(),
    })).default([]),
    sourceSummary: z.string().optional(),
  }).optional(),
  artifactSnapshots: z.array(z.object({
    version: z.number().int().min(1),
    summary: z.string(),
    createdAt: z.string(),
    createdBy: z.string().optional(),
    artifacts: specCodingArtifactsSchema,
  })).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type SpecCodingRequirement = z.infer<typeof specCodingRequirementSchema>;
export type SpecCodingPhase = z.infer<typeof specCodingPhaseSchema>;
export type SpecCodingAssignment = z.infer<typeof specCodingAssignmentSchema>;
export type SpecCodingCheckpoint = z.infer<typeof specCodingCheckpointSchema>;
export type SpecCodingProgressStatus = z.infer<typeof specCodingProgressStatusSchema>;
export type SpecCodingProgress = z.infer<typeof specCodingProgressSchema>;
export type SpecCodingTask = SpecCodingTaskInput;
export type SpecCodingRevision = z.infer<typeof specCodingRevisionSchema>;
export type SpecCodingArtifacts = z.infer<typeof specCodingArtifactsSchema>;
export type SpecCodingDocument = z.infer<typeof specCodingDocumentSchema>;
export type CreationSession = z.infer<typeof creationSessionSchema>;

// 运行记录 Schema
export const runRecordSchema = z.object({
  id: z.string(),
  configFile: z.string(),
  configName: z.string(),
  startTime: z.string(),
  endTime: z.string().nullable(),
  status: z.enum(['preparing', 'running', 'completed', 'failed', 'stopped', 'crashed']),
  currentPhase: z.string().nullable(),
  totalSteps: z.number(),
  completedSteps: z.number(),
});

export type RunRecord = z.infer<typeof runRecordSchema>;

// 配置摘要（首页卡片用）
export interface ConfigSummary {
  filename: string;
  name: string;
  description: string;
  phaseCount: number;
  stepCount: number;
  agentCount: number;
}

// ============ 状态机工作流 Schema ============

// 问题分类 Schema
export const issueSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['design', 'implementation', 'test', 'performance', 'security']),
  severity: z.enum(['critical', 'major', 'minor']),
  description: z.string(),
  foundInState: z.string().optional(),
  foundByAgent: z.string().optional(),
  targetState: z.string().optional(),
});

// 状态转移条件 Schema
export const transitionConditionSchema = z.object({
  verdict: z.enum(['pass', 'conditional_pass', 'fail']).optional(),
  issueTypes: z.array(z.enum(['design', 'implementation', 'test', 'performance', 'security'])).optional(),
  severities: z.array(z.enum(['critical', 'major', 'minor'])).optional(),
  minIssueCount: z.number().optional(),
  maxIssueCount: z.number().optional(),
  custom: z.string().optional(), // 自定义条件表达式
});

// 状态转移规则 Schema
export const stateTransitionSchema = z.object({
  to: z.string().min(1, '目标状态不能为空'),
  condition: transitionConditionSchema,
  priority: z.number().default(100),
  label: z.string().optional(), // 转移边的标签
});

// 状态机状态 Schema
export const stateMachineStateSchema = z.object({
  name: z.string().min(1, '状态名称不能为空'),
  description: z.string().optional(),
  type: z.enum(['normal', 'human-checkpoint']).default('normal').optional(), // 状态类型（将废弃）
  requireHumanApproval: z.boolean().default(false).optional(), // 完成后是否需要人工审查（跳转到自身除外）
  steps: z.array(workflowStepSchema).min(1, '至少需要一个步骤'),
  transitions: z.array(stateTransitionSchema), // 终止状态允许空数组
  position: z.object({ x: z.number(), y: z.number() }).optional(), // 可视化位置
  isInitial: z.boolean().default(false), // 是否为初始状态
  isFinal: z.boolean().default(false), // 是否为终止状态
  maxSelfTransitions: z.number().min(1).max(100).default(3).optional(), // 最大自我转换次数，超出后自动熔断
});

// 问题路由规则 Schema
export const issueRoutingRuleSchema = z.object({
  pattern: z.string().min(1, '匹配模式不能为空'),
  targetState: z.string().min(1, '目标状态不能为空'),
  issueType: z.enum(['design', 'implementation', 'test', 'performance', 'security']),
  priority: z.number().default(100),
});

// 状态机工作流配置 Schema
export const stateMachineWorkflowSchema = z.object({
  workflow: z.object({
    name: z.string().min(1, '工作流名称不能为空'),
    description: z.string().optional(),
    mode: z.literal('state-machine'),
    states: z.array(stateMachineStateSchema).min(1, '至少需要一个状态'),
    issueRouting: z.array(issueRoutingRuleSchema).optional(),
    maxTransitions: z.number().min(1).max(100).default(50), // 最大状态转移次数，防止死循环
    supervisor: workflowSupervisorConfigSchema,
  }),
  roles: z.array(roleConfigSchema).optional(),
  context: contextConfigSchema,
});

// 统一工作流配置 Schema（支持两种模式）
export const unifiedWorkflowConfigSchema = z.union([
  workflowConfigSchema.extend({
    workflow: workflowConfigSchema.shape.workflow.extend({
      mode: z.literal('phase-based').optional().default('phase-based'),
    }),
  }),
  stateMachineWorkflowSchema,
]);

// TypeScript 类型导出
export type Issue = z.infer<typeof issueSchema>;
export type TransitionCondition = z.infer<typeof transitionConditionSchema>;
export type StateTransition = z.infer<typeof stateTransitionSchema>;
export type StateMachineState = z.infer<typeof stateMachineStateSchema>;
export type IssueRoutingRule = z.infer<typeof issueRoutingRuleSchema>;
export type StateMachineWorkflowConfig = z.infer<typeof stateMachineWorkflowSchema>;
export type UnifiedWorkflowConfig = z.infer<typeof unifiedWorkflowConfigSchema>;

// 状态转移记录（运行时）
export interface StateTransitionRecord {
  from: string;
  to: string;
  reason: string;
  issues: Issue[];
  timestamp: string;
}
