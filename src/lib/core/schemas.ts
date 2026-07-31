import { z } from 'zod';
import { mcpServerSchema } from '@/lib/mcp/types';
import {
  LIGHTWEIGHT_TASKLIST_SKILL,
  LIGHTWEIGHT_WORKFLOW_PROFILE,
  normalizeLightweightTasklistDirectory,
} from '@/lib/workflow/lightweight';

const agentTeamSchema = z.enum(['blue', 'red', 'judge', 'black-gold']);
const agentRoleTypeSchema = z.enum(['normal', 'supervisor']);
const agentAvatarConfigSchema = z.object({
  mode: z.enum(['deterministic', 'generated', 'uploaded', 'preset', 'sprite']),
  seed: z.string().optional(),
  style: z.enum(['personas', 'adventurer', 'pixel-art']).optional(),
  category: z.string().optional(),
  spriteSheet: z.string().optional(),
  spriteIndex: z.number().int().min(0).optional(),
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
  stageReviewAsync: z.boolean().default(true),
  checkpointAdviceEnabled: z.boolean().default(true),
  scoringEnabled: z.boolean().default(true),
  experienceEnabled: z.boolean().default(true),
}).optional();

const workflowHumanHelpConfigSchema = z.object({
  enabled: z.boolean().default(false),
  supervisorReviewEnabled: z.boolean().default(true),
  blockUntilAnswered: z.boolean().default(true),
  defaultSelectionMode: z.enum(['single', 'multiple']).default('single'),
}).optional();

// 并发设计元数据 Schema（当前用于设计/展示；运行时仍按现有执行器能力调度）
export const joinPolicySchema = z.object({
  mode: z.enum(['all', 'any', 'quorum', 'manual']).default('all'),
  quorum: z.number().int().min(1).optional(),
  timeoutMinutes: z.number().min(1).optional(),
  onTimeout: z.enum(['continue', 'fail', 'manual-review']).optional(),
});

export const channelBindingSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  type: z.enum(['shared', 'supervisor', 'agent-direct']).default('shared'),
  participants: z.array(z.string()).default([]),
  description: z.string().optional(),
});

export const agentInstanceSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  label: z.string().optional(),
  channelIds: z.array(z.string()).default([]),
  maxParallelTasks: z.number().int().min(1).optional(),
});

export const specTaskBindingSchema = z.object({
  taskId: z.string().min(1).optional(),
  taskIds: z.array(z.string().min(1)).default([]).optional(),
  requirementIds: z.array(z.string()).default([]),
  artifactKeys: z.array(z.string()).default([]),
});

export const stepTaskBindingSnapshotSchema = z.object({
  stepKey: z.string(),
  containerName: z.string(),
  stepName: z.string(),
  agent: z.string(),
  taskIds: z.array(z.string()).default([]),
  requirementIds: z.array(z.string()).default([]),
  artifactKeys: z.array(z.string()).default([]),
  source: z.enum(['explicit', 'auto-title', 'auto-index', 'auto-container', 'missing']),
});

export const stepTaskBindingValidationSchema = z.object({
  ok: z.boolean(),
  errors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  bindings: z.array(stepTaskBindingSnapshotSchema).default([]),
  uncoveredTaskIds: z.array(z.string()).default([]),
  unboundStepKeys: z.array(z.string()).default([]),
  invalidTaskIds: z.array(z.string()).default([]),
  checkedAt: z.string(),
});

export const stepConcurrencySchema = z.object({
  groupId: z.string().optional(),
  branchId: z.string().optional(),
  joinPolicy: joinPolicySchema.optional(),
});

export const workflowConcurrencySchema = z.object({
  enabled: z.boolean().default(false).optional(),
  agentInstances: z.array(agentInstanceSchema).default([]).optional(),
  channels: z.array(channelBindingSchema).default([]).optional(),
  joinPolicies: z.record(z.string(), joinPolicySchema).default({}).optional(),
}).optional();

export const subworkflowInputsSchema = z.object({
  requirements: z.union([z.literal('inherit'), z.string()]).default('inherit').optional(),
  workspace: z.enum(['inherit', 'child-isolated-copy', 'config']).default('inherit').optional(),
  context: z.enum(['inherit', 'none', 'custom']).default('inherit').optional(),
  specCoding: z.enum(['inherit', 'none']).default('inherit').optional(),
  globalContext: z.enum(['inherit', 'none', 'custom']).default('inherit').optional(),
  stateContexts: z.enum(['inherit', 'none', 'relevant']).default('relevant').optional(),
  mcpServers: z.enum(['inherit', 'merge', 'child-only', 'parent-only']).default('merge').optional(),
  skills: z.enum(['inherit', 'merge', 'child-only', 'parent-only']).default('merge').optional(),
  rag: z.enum(['inherit', 'merge', 'child-only', 'parent-only']).default('merge').optional(),
  engine: z.enum(['inherit', 'child', 'override']).default('child').optional(),
}).optional();

export const subworkflowResultMappingSchema = z.object({
  completed: z.enum(['pass', 'conditional_pass', 'fail']).default('pass').optional(),
  failed: z.enum(['pass', 'conditional_pass', 'fail']).default('fail').optional(),
  stopped: z.enum(['pass', 'conditional_pass', 'fail']).default('fail').optional(),
  crashed: z.enum(['pass', 'conditional_pass', 'fail']).default('fail').optional(),
}).optional();

export const subworkflowRuntimeSchema = z.object({
  humanQuestions: z.enum(['bubble', 'child-only']).default('bubble').optional(),
  stopPropagation: z.enum(['cascade', 'detach']).default('cascade').optional(),
  timeoutMinutes: z.number().min(1).optional(),
  timeoutStrategy: z.enum(['stop', 'ask-human']).default('stop').optional(),
  maxDepth: z.number().int().min(1).max(8).optional(),
  workspaceConflictPolicy: z.literal('shared').default('shared').optional(),
  onUnjoinedBranches: z.enum(['stop', 'detach', 'wait-background']).default('stop').optional(),
}).optional();

export const subworkflowReferenceSchema = z.object({
  configFile: z.string().min(1, '子工作流配置不能为空'),
  inputs: subworkflowInputsSchema,
  result: subworkflowResultMappingSchema,
  runtime: subworkflowRuntimeSchema,
});

export interface WorkflowStep {
  id?: string;
  name: string;
  agent: string;
  task: string;
  preCommands?: string[];
  type?: 'agent' | 'subworkflow';
  workflow?: string;
  subworkflow?: Partial<SubworkflowReference>;
  inputs?: SubworkflowInputs;
  result?: SubworkflowResultMapping;
  runtime?: SubworkflowRuntime;
  role?: 'attacker' | 'defender' | 'judge';
  constraints?: string[];
  parallelGroup?: string;
  concurrency?: StepConcurrency;
  agentInstanceId?: string;
  channelIds?: string[];
  specTaskBinding?: SpecTaskBinding;
  enableReviewPanel?: boolean;
  skills?: string[];
}

// 工作流步骤 Schema
export const workflowStepSchema: z.ZodType<WorkflowStep> = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1, '步骤名称不能为空'),
  agent: z.string().optional(),
  task: z.string().optional(),
  // 可选：在执行 Agent 之前，由系统自动执行的一组预命令（通常是编译 / 测试命令）
  // 注意：这些命令在后端 Node 环境中串行执行，stdout/stderr 会被收集并注入上下文，
  // 不会中断整个步骤（即使命令本身返回非 0 退出码）。
  preCommands: z.array(z.string()).optional(),
  type: z.enum(['agent', 'subworkflow']).optional(),
  workflow: z.string().optional(),
  subworkflow: subworkflowReferenceSchema.partial({ configFile: true }).optional(),
  inputs: subworkflowInputsSchema,
  result: subworkflowResultMappingSchema,
  runtime: subworkflowRuntimeSchema,
  role: z.enum(['attacker', 'defender', 'judge']).optional(),
  constraints: z.array(z.string()).optional(),
  parallelGroup: z.string().optional(),
  concurrency: stepConcurrencySchema.optional(),
  agentInstanceId: z.string().optional(),
  channelIds: z.array(z.string()).optional(),
  specTaskBinding: specTaskBindingSchema.optional(),
  enableReviewPanel: z.boolean().optional(), // 是否启用会审模式
  skills: z.array(z.string().min(1)).optional(),
}).superRefine((step, ctx) => {
  if (step.type === 'subworkflow') {
    const configFile = step.workflow?.trim() || step.subworkflow?.configFile?.trim();
    if (!configFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workflow'],
        message: '子工作流步骤必须设置 workflow 或 subworkflow.configFile',
      });
    }
    return;
  }

  if (!step.agent?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['agent'],
      message: 'Agent 名称不能为空',
    });
  }
  if (!step.task?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['task'],
      message: '任务描述不能为空',
    });
  }
}) as any;

export const agentWorkspaceProfileSchema = z.object({
  displayName: z.string().optional(),
  nickname: z.string().optional(),
  officeRole: z.string().optional(),
  residency: z.object({
    office: z.boolean().optional(),
    meetingRoom: z.boolean().optional(),
    defaultDirectRoom: z.boolean().optional(),
  }).optional(),
  roomPresence: z.object({
    recommendForMeetingRoom: z.boolean().optional(),
    autoShowInOffice: z.boolean().optional(),
  }).optional(),
  visual: z.object({
    accent: z.string().optional(),
    deskVariant: z.string().optional(),
    desk: z.string().optional(),
    order: z.number().optional(),
    zone: z.string().optional(),
    column: z.number().optional(),
    row: z.number().optional(),
  }).optional(),
  motion: z.object({
    activity: z.enum(['typing', 'walking', 'talking', 'thinking', 'reviewing', 'presenting']).optional(),
    speed: z.number().min(0.2).max(3).optional(),
  }).optional(),
  memory: z.object({
    baseBudget: z.number().min(0).max(50000).optional(),
    deepSearchEnabled: z.boolean().optional(),
  }).optional(),
}).optional();

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
  skills: z.array(z.string()).optional(), // Agent 默认可用的 skills
  ragKnowledgeBases: z.array(z.string()).optional(), // Agent 默认关联的 RAG 知识库
  allowedTools: z.array(z.string()).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  specialtyTags: z.array(z.string()).optional(),
  alwaysAvailableForChat: z.boolean().optional(),
  workspaceProfile: agentWorkspaceProfileSchema,
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
  mcpServers: z.array(z.union([z.string(), mcpServerSchema])).optional(),
});

export const workflowAgentExecutionOverrideSchema = z.object({
  enabled: z.boolean().default(false),
  engine: z.string().optional(),
  model: z.string().optional(),
});

export const workflowExecutionPolicySchema = z.object({
  defaultEngine: z.string().optional(),
  defaultModel: z.string().optional(),
  autoCompactOnStepChange: z.boolean().optional(),
  agentOverrides: z.record(z.string(), workflowAgentExecutionOverrideSchema).default({}),
});

export const ragCapabilitySkillSchema = z.object({
  enabled: z.boolean().default(false).optional(),
  knowledgeBases: z.array(z.string()).default(['default']).optional(),
  topK: z.number().int().min(1).max(50).default(8).optional(),
  autoInject: z.boolean().default(false).optional(),
  allowAgentQuery: z.boolean().default(true).optional(),
}).default({});

export const sqliteCapabilityDatabaseSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'SQLite 数据库名称只能包含字母、数字、下划线和连字符'),
  path: z.string().min(1, 'SQLite 数据库路径不能为空'),
  allowCreate: z.boolean().default(true).optional(),
  allowDelete: z.boolean().default(false).optional(),
  readOnly: z.boolean().default(false).optional(),
});

export const sqliteCapabilitySkillSchema = z.object({
  enabled: z.boolean().default(false).optional(),
  root: z.literal('workspace').default('workspace').optional(),
  databases: z.array(sqliteCapabilityDatabaseSchema).default([]).optional(),
}).default({});

export const capabilitySkillsSchema = z.object({
  rag: ragCapabilitySkillSchema.optional(),
  sqlite: sqliteCapabilitySkillSchema.optional(),
}).optional();

export const workflowTaskInputFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'url']).default('text').optional(),
  required: z.boolean().default(false).optional(),
  placeholder: z.string().optional(),
  description: z.string().optional(),
});

export const workflowTaskInputConfigSchema = z.object({
  fields: z.array(workflowTaskInputFieldSchema).default([]).optional(),
}).optional();

// 上下文配置 Schema
export const contextConfigSchema = z.object({
  projectRoot: z.string().optional(),
  workspaceMode: z.enum(['isolated-copy', 'in-place']).optional(),
  requirements: z.string().optional(),
  taskInput: workflowTaskInputConfigSchema,
  codebase: z.string().optional(),
  timeoutMinutes: z.number().min(1).optional(),
  segmentDelayMs: z.number().int().min(0).max(30000).optional(),
  engine: z.string().optional(), // 工作流级别引擎覆盖
  gitBaselineEnabled: z.boolean().optional(), // 是否为运行建立 Git 基线和步骤快照，默认开启
  executionPolicy: workflowExecutionPolicySchema.optional(),
  skills: z.array(z.string()).optional(), // 启用的 skills 列表
  capabilitySkills: capabilitySkillsSchema,
  mcpServers: z.array(z.string()).optional(), // 启用的 MCP server 名称
  routerModel: z.string().optional(), // Supervisor-Lite 路由模型（可选）
});

// TypeScript 类型导出
export type JoinPolicy = z.infer<typeof joinPolicySchema>;
export type ChannelBinding = z.infer<typeof channelBindingSchema>;
export type AgentInstance = z.infer<typeof agentInstanceSchema>;
export type SpecTaskBinding = z.infer<typeof specTaskBindingSchema>;
export type StepTaskBindingSnapshot = z.infer<typeof stepTaskBindingSnapshotSchema>;
export type StepTaskBindingValidation = z.infer<typeof stepTaskBindingValidationSchema>;
export type StepConcurrency = z.infer<typeof stepConcurrencySchema>;
export type WorkflowConcurrency = z.infer<typeof workflowConcurrencySchema>;
export type SubworkflowInputs = z.infer<typeof subworkflowInputsSchema>;
export type SubworkflowResultMapping = z.infer<typeof subworkflowResultMappingSchema>;
export type SubworkflowRuntime = z.infer<typeof subworkflowRuntimeSchema>;
export type SubworkflowReference = z.infer<typeof subworkflowReferenceSchema>;
export type RoleConfig = z.infer<typeof roleConfigSchema>;
export type WorkflowAgentExecutionOverride = z.infer<typeof workflowAgentExecutionOverrideSchema>;
export type WorkflowExecutionPolicy = z.infer<typeof workflowExecutionPolicySchema>;
export type CapabilitySkillsConfig = z.infer<typeof capabilitySkillsSchema>;
export type SqliteCapabilityDatabase = z.infer<typeof sqliteCapabilityDatabaseSchema>;
export type WorkflowTaskInputFieldConfig = z.infer<typeof workflowTaskInputFieldSchema>;
export type WorkflowTaskInputConfig = z.infer<typeof workflowTaskInputConfigSchema>;
export type ContextConfig = z.infer<typeof contextConfigSchema>;

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
  mode: z.enum(['state-machine', 'lightweight']).default('state-machine').optional(),
  requirements: z.string().optional(),
  persistMode: z.enum(['none', 'repository']).default('none').optional(),
  specRoot: z.string().optional(),
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
  persistMode: z.enum(['none', 'repository']).optional(),
  specRoot: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  confirmedAt: z.string().optional(),
});

export const creationSessionStatusSchema = z.enum(['draft', 'confirmed', 'config-generated', 'run-bound', 'archived']);

const lightweightCreationSessionSchema = z.object({
  agent: z.string().optional(),
  task: z.string().optional(),
  skills: z.array(z.string()).default([]),
  tasklistDirectory: z.string().optional(),
});

export const creationSessionSchema = z.object({
  id: z.string(),
  chatSessionId: z.string().optional(),
  homeChatSessionId: z.string().optional(),
  createdBy: z.string().optional(),
  status: creationSessionStatusSchema.default('draft'),
  workflowName: z.string(),
  filename: z.string(),
  mode: z.enum(['state-machine', 'lightweight']),
  referenceWorkflow: z.string().optional(),
  planningEngine: z.string().optional(),
  planningModel: z.string().optional(),
  workingDirectory: z.string(),
  workspaceMode: z.enum(['isolated-copy', 'in-place']),
  description: z.string().optional(),
  requirements: z.string().optional(),
  lightweight: lightweightCreationSessionSchema.optional(),
  clarification: z.object({
    summary: z.string().optional(),
    knownFacts: z.array(z.string()).default([]),
    missingFields: z.array(z.string()).default([]),
    questions: z.array(z.string()).default([]),
  }).optional(),
  stageSessions: z.object({
    clarification: z.object({
      frontendSessionId: z.string().optional(),
      backendSessionId: z.string().optional(),
      engine: z.string().optional(),
      model: z.string().optional(),
      updatedAt: z.number().optional(),
    }).optional(),
    specPlanning: z.object({
      frontendSessionId: z.string().optional(),
      backendSessionId: z.string().optional(),
      engine: z.string().optional(),
      model: z.string().optional(),
      updatedAt: z.number().optional(),
    }).optional(),
    workflowDraft: z.object({
      frontendSessionId: z.string().optional(),
      backendSessionId: z.string().optional(),
      engine: z.string().optional(),
      model: z.string().optional(),
      updatedAt: z.number().optional(),
    }).optional(),
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
    mode: z.literal('state-machine'),
    stateCount: z.number().int().min(0).default(0),
    agentNames: z.array(z.string()).default([]),
  }).optional(),
  workflowDraftSummary: z.object({
    mode: z.literal('state-machine'),
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
  bindingValidation: stepTaskBindingValidationSchema.optional(),
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
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheCreationInputTokens: z.number().optional(),
  cacheReadInputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
});

export type RunRecord = z.infer<typeof runRecordSchema>;

// 配置摘要（首页卡片用）
export interface ConfigSummary {
  filename: string;
  name: string;
  description: string;
  stateCount: number;
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
  enableSpecRevisionOnComplete: z.boolean().default(false).optional(), // 状态结束后是否发起 Spec 修订表决
  steps: z.array(workflowStepSchema),
  transitions: z.array(stateTransitionSchema), // 终止状态允许空数组
  position: z.object({ x: z.number(), y: z.number() }).optional(), // 可视化位置
  isInitial: z.boolean().default(false), // 是否为初始状态
  isFinal: z.boolean().default(false), // 是否为终止状态
  maxSelfTransitions: z.number().min(1).max(100).default(3).optional(), // 最大自我转换次数，超出后自动熔断
  executionMode: z.enum(['sequential', 'parallel']).optional(), // 并发设计元数据；当前执行器不保证真实并发
  joinPolicy: joinPolicySchema.optional(),
  channels: z.array(z.string()).optional(),
  instancePolicy: z.enum(['single', 'multi-instance']).optional(),
  specPhaseId: z.string().optional(),
});

// 问题路由规则 Schema
export const issueRoutingRuleSchema = z.object({
  pattern: z.string().min(1, '匹配模式不能为空'),
  targetState: z.string().min(1, '目标状态不能为空'),
  issueType: z.enum(['design', 'implementation', 'test', 'performance', 'security']),
  priority: z.number().default(100),
});

// 状态机工作流配置 Schema
const lightweightWorkflowConfigSchema = z.object({
  tasklistDirectory: z.string().trim().min(1, 'tasklistDirectory is required'),
});

export const stateMachineWorkflowSchema = z.object({
  workflow: z.object({
    name: z.string().min(1, '工作流名称不能为空'),
    description: z.string().optional(),
    mode: z.literal('state-machine'),
    profile: z.literal(LIGHTWEIGHT_WORKFLOW_PROFILE).optional(),
    lightweight: lightweightWorkflowConfigSchema.optional(),
    states: z.array(stateMachineStateSchema).min(1, '至少需要一个状态'),
    issueRouting: z.array(issueRoutingRuleSchema).optional(),
    maxTransitions: z.number().min(1).max(100).default(50), // 最大状态转移次数，防止死循环
    supervisor: workflowSupervisorConfigSchema,
    humanHelp: workflowHumanHelpConfigSchema,
    concurrency: workflowConcurrencySchema,
  }),
  roles: z.array(roleConfigSchema).optional(),
  context: contextConfigSchema,
}).superRefine((config, ctx) => {
  const workflow = config.workflow;
  const isLightweight = workflow.profile === LIGHTWEIGHT_WORKFLOW_PROFILE;

  if (!isLightweight) {
    if (workflow.lightweight) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workflow', 'lightweight'],
        message: 'workflow.lightweight requires workflow.profile: lightweight',
      });
    }
    return;
  }

  if (!workflow.lightweight) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflow', 'lightweight'],
      message: 'lightweight workflows require workflow.lightweight.tasklistDirectory',
    });
  } else {
    try {
      normalizeLightweightTasklistDirectory(workflow.lightweight.tasklistDirectory);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workflow', 'lightweight', 'tasklistDirectory'],
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (workflow.states.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflow', 'states'],
      message: 'lightweight workflows require exactly one state',
    });
    return;
  }

  const state = workflow.states[0];
  if (!state.isInitial) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflow', 'states', 0, 'isInitial'],
      message: 'the lightweight state must be initial',
    });
  }
  if (!state.isFinal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflow', 'states', 0, 'isFinal'],
      message: 'the lightweight state must be final',
    });
  }
  if (state.transitions.length !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflow', 'states', 0, 'transitions'],
      message: 'the lightweight state must not define transitions',
    });
  }
  if (state.steps.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflow', 'states', 0, 'steps'],
      message: 'lightweight workflows require exactly one agent step',
    });
    return;
  }

  const step = state.steps[0];
  if (step.type === 'subworkflow') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflow', 'states', 0, 'steps', 0, 'type'],
      message: 'lightweight workflows cannot contain subworkflow steps',
    });
  }
  if (!Array.isArray(step.skills) || !step.skills.includes(LIGHTWEIGHT_TASKLIST_SKILL)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflow', 'states', 0, 'steps', 0, 'skills'],
      message: `lightweight steps must include ${LIGHTWEIGHT_TASKLIST_SKILL}`,
    });
  }
});

// State machine is the only supported workflow contract.
export const unifiedWorkflowConfigSchema = stateMachineWorkflowSchema;

// TypeScript 类型导出
export type Issue = z.infer<typeof issueSchema>;
export type TransitionCondition = z.infer<typeof transitionConditionSchema>;
export type StateTransition = z.infer<typeof stateTransitionSchema>;
export type StateMachineState = z.infer<typeof stateMachineStateSchema>;
export type IssueRoutingRule = z.infer<typeof issueRoutingRuleSchema>;
export type StateMachineWorkflowConfig = z.infer<typeof stateMachineWorkflowSchema>;
export type LightweightWorkflowConfig = StateMachineWorkflowConfig & {
  workflow: StateMachineWorkflowConfig['workflow'] & {
    profile: typeof LIGHTWEIGHT_WORKFLOW_PROFILE;
    lightweight: z.infer<typeof lightweightWorkflowConfigSchema>;
  };
};
export type UnifiedWorkflowConfig = z.infer<typeof unifiedWorkflowConfigSchema>;

// 状态转移记录（运行时）
export interface StateTransitionRecord {
  from: string;
  to: string;
  reason: string;
  issues: Issue[];
  timestamp: string;
}
