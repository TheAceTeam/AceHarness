#!/usr/bin/env node
/**
 * Aceharness 工作流配置验证脚本
 * 用法: node /abs/path/to/validate-workflow.mjs <config.yaml>
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, dirname, isAbsolute, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeRequire = createRequire(resolve(homedir(), '.aceharness', 'node_modules', '_placeholder.js'));
const cwdRequire = createRequire(resolve(process.cwd(), 'package.json'));

function requireDependency(name) {
  try {
    return runtimeRequire(name);
  } catch {
    return cwdRequire(name);
  }
}

const { parse } = requireDependency('yaml');
const { z } = requireDependency('zod');

function resolveRuntimeRoot() {
  const aceHome = process.env.ACE_HOME?.trim();
  if (aceHome) return resolve(aceHome);

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim();
    if (appData) return resolve(appData, 'ACEHarness');
  }

  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  if (xdgDataHome) return resolve(xdgDataHome, 'aceharness');

  return resolve(homedir(), '.aceharness');
}

const RUNTIME_ROOT = resolveRuntimeRoot();
const RUNTIME_CONFIGS_DIR = resolve(RUNTIME_ROOT, 'configs');

// --- Schemas (mirror of src/lib/schemas.ts) ---

const iterationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxIterations: z.number().min(1).max(20).default(5),
  exitCondition: z.enum(['no_new_bugs_3_rounds', 'all_resolved', 'manual']).default('no_new_bugs_3_rounds'),
  consecutiveCleanRounds: z.number().min(1).max(10).default(3),
  escalateToHuman: z.boolean().default(true),
});

const joinPolicySchema = z.object({
  mode: z.enum(['all', 'any', 'quorum', 'manual']).default('all'),
  quorum: z.number().int().min(1).optional(),
  timeoutMinutes: z.number().min(1).optional(),
  onTimeout: z.enum(['continue', 'fail', 'manual-review']).optional(),
});

const channelBindingSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  type: z.enum(['shared', 'supervisor', 'agent-direct']).default('shared'),
  participants: z.array(z.string()).default([]),
  description: z.string().optional(),
});

const agentInstanceSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  label: z.string().optional(),
  channelIds: z.array(z.string()).default([]),
  maxParallelTasks: z.number().int().min(1).optional(),
});

const specTaskBindingSchema = z.object({
  taskId: z.string().min(1).optional(),
  taskIds: z.array(z.string().min(1)).default([]).optional(),
  requirementIds: z.array(z.string()).default([]),
  artifactKeys: z.array(z.string()).default([]),
});

const stepConcurrencySchema = z.object({
  groupId: z.string().optional(),
  branchId: z.string().optional(),
  joinPolicy: joinPolicySchema.optional(),
});

const workflowConcurrencySchema = z.object({
  enabled: z.boolean().default(false).optional(),
  agentInstances: z.array(agentInstanceSchema).default([]).optional(),
  channels: z.array(channelBindingSchema).default([]).optional(),
  joinPolicies: z.record(z.string(), joinPolicySchema).default({}).optional(),
}).optional();

const workflowStepSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  agent: z.string().min(1),
  task: z.string().min(1),
  preCommands: z.array(z.string()).optional(),
  type: z.string().optional(),
  role: z.enum(['attacker', 'defender', 'judge']).optional(),
  constraints: z.array(z.string()).optional(),
  parallelGroup: z.string().optional(),
  concurrency: stepConcurrencySchema.optional(),
  agentInstanceId: z.string().optional(),
  channelIds: z.array(z.string()).optional(),
  specTaskBinding: specTaskBindingSchema.optional(),
  enableReviewPanel: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
});

const checkpointSchema = z.object({
  name: z.string().min(1),
  message: z.string().min(1),
});

const workflowPhaseSchema = z.object({
  name: z.string().min(1),
  steps: z.array(workflowStepSchema).min(1),
  checkpoint: checkpointSchema.optional(),
  iteration: iterationConfigSchema.optional(),
});

const contextConfigSchema = z.object({
  projectRoot: z.string().optional(),
  workspaceMode: z.enum(['isolated-copy', 'in-place']).optional(),
  requirements: z.string().optional(),
  codebase: z.string().optional(),
  timeoutMinutes: z.number().min(1).optional(),
  engine: z.string().optional(),
  executionPolicy: z.object({
    defaultEngine: z.string().optional(),
    defaultModel: z.string().optional(),
    agentOverrides: z.record(z.string(), z.object({
      enabled: z.boolean().default(false),
      engine: z.string().optional(),
      model: z.string().optional(),
    })).default({}),
  }).optional(),
  skills: z.array(z.string()).optional(),
  routerModel: z.string().optional(),
});

const transitionConditionSchema = z.object({
  verdict: z.enum(['pass', 'conditional_pass', 'fail']).optional(),
  issueTypes: z.array(z.enum(['design', 'implementation', 'test', 'performance', 'security'])).optional(),
  severities: z.array(z.enum(['critical', 'major', 'minor'])).optional(),
  minIssueCount: z.number().optional(),
  maxIssueCount: z.number().optional(),
  custom: z.string().optional(),
});

const stateTransitionSchema = z.object({
  to: z.string().min(1),
  condition: transitionConditionSchema,
  priority: z.number().default(100),
  label: z.string().optional(),
});

const stateMachineStateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['normal', 'human-checkpoint']).default('normal').optional(),
  requireHumanApproval: z.boolean().default(false).optional(),
  steps: z.array(workflowStepSchema).min(1),
  transitions: z.array(stateTransitionSchema),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  isInitial: z.boolean().default(false),
  isFinal: z.boolean().default(false),
  maxSelfTransitions: z.number().min(1).max(100).default(3).optional(),
  executionMode: z.enum(['sequential', 'parallel']).optional(),
  joinPolicy: joinPolicySchema.optional(),
  channels: z.array(z.string()).optional(),
  instancePolicy: z.enum(['single', 'multi-instance']).optional(),
  specPhaseId: z.string().optional(),
});

const issueRoutingRuleSchema = z.object({
  pattern: z.string().min(1),
  targetState: z.string().min(1),
  issueType: z.enum(['design', 'implementation', 'test', 'performance', 'security']),
  priority: z.number().default(100),
});

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

const roleConfigSchema = z.object({
  name: z.string().min(1),
  team: z.enum(['blue', 'red', 'judge', 'black-gold']),
  roleType: z.enum(['normal', 'supervisor']).default('normal').optional(),
  avatar: z.union([z.string(), agentAvatarConfigSchema]).optional(),
  title: z.string().optional(),
  persona: z.string().optional(),
  greeting: z.string().optional(),
  rarity: z.enum(['common', 'rare', 'epic', 'legendary']).optional(),
  engineModels: z.record(z.string(), z.string()),
  activeEngine: z.string(),
  temperature: z.number().optional(),
  capabilities: z.array(z.string()).min(1),
  systemPrompt: z.string().min(1),
  iterationPrompt: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  specialtyTags: z.array(z.string()).optional(),
  alwaysAvailableForChat: z.boolean().optional(),
  keywords: z.array(z.string()).optional(),
  description: z.string().optional(),
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

// PLACEHOLDER_CONTINUE

const workflowSupervisorConfigSchema = z.object({
  enabled: z.boolean().default(true),
  agent: z.string().min(1).default('default-supervisor'),
  stageReviewEnabled: z.boolean().default(true),
  checkpointAdviceEnabled: z.boolean().default(true),
  scoringEnabled: z.boolean().default(true),
  experienceEnabled: z.boolean().default(true),
}).optional();

const phaseBasedSchema = z.object({
  workflow: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    mode: z.literal('phase-based').optional().default('phase-based'),
    phases: z.array(workflowPhaseSchema).min(1),
    supervisor: workflowSupervisorConfigSchema,
    concurrency: workflowConcurrencySchema,
  }),
  roles: z.array(roleConfigSchema).optional(),
  context: contextConfigSchema,
});

const stateMachineSchema = z.object({
  workflow: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    mode: z.literal('state-machine'),
    states: z.array(stateMachineStateSchema).min(1),
    issueRouting: z.array(issueRoutingRuleSchema).optional(),
    maxTransitions: z.number().min(1).max(100).default(50),
    supervisor: workflowSupervisorConfigSchema,
    concurrency: workflowConcurrencySchema,
  }),
  roles: z.array(roleConfigSchema).optional(),
  context: contextConfigSchema,
});

const unifiedSchema = z.union([phaseBasedSchema, stateMachineSchema]);

// --- Validation Logic ---

function getAvailableAgents() {
  const agentsDir = resolve(RUNTIME_CONFIGS_DIR, 'agents');
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir)
    .filter(f => f.endsWith('.yaml'))
    .map(f => f.replace(/\.yaml$/, ''));
}

function validate(configPath) {
  const errors = [];
  const warnings = [];

  // 1. Read and parse YAML
  let raw, config;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (e) {
    console.error(`❌ 无法读取文件: ${configPath}`);
    process.exit(1);
  }
  try {
    config = parse(raw);
  } catch (e) {
    console.error(`❌ YAML 语法错误: ${e.message}`);
    process.exit(1);
  }

  // 2. Zod schema validation
  const result = unifiedSchema.safeParse(config);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`Schema: ${issue.path.join('.')} - ${issue.message}`);
    }
  }

  // 3. Agent reference check
  const availableAgents = getAvailableAgents();
  const referencedAgents = new Set();
  const mode = config?.workflow?.mode;

  // 3.1 projectRoot / 工作目录校验（强制）
  const projectRoot = typeof config?.context?.projectRoot === 'string'
    ? config.context.projectRoot.trim()
    : '';
  if (!projectRoot) {
    errors.push('context.projectRoot 不能为空（必须填写工作目录）');
  } else if (!isAbsolute(projectRoot)) {
    errors.push(`context.projectRoot 必须是绝对路径: "${projectRoot}"`);
  } else if (!existsSync(projectRoot)) {
    errors.push(`context.projectRoot 指向的目录不存在: "${projectRoot}"`);
  } else {
    try {
      const st = statSync(projectRoot);
      if (!st.isDirectory()) {
        errors.push(`context.projectRoot 必须是目录: "${projectRoot}"`);
      }
    } catch (e) {
      errors.push(`无法访问 context.projectRoot: "${projectRoot}"`);
    }
  }

  const workspaceMode = typeof config?.context?.workspaceMode === 'string'
    ? config.context.workspaceMode.trim()
    : '';
  if (workspaceMode && workspaceMode !== 'isolated-copy' && workspaceMode !== 'in-place') {
    errors.push(`context.workspaceMode 非法: "${workspaceMode}"，只能是 "isolated-copy" 或 "in-place"`);
  }

  if (mode === 'state-machine' && config?.workflow?.states) {
    for (const state of config.workflow.states) {
      for (const step of state.steps || []) {
        referencedAgents.add(step.agent);
      }
    }
  } else if (config?.workflow?.phases) {
    for (const phase of config.workflow.phases) {
      for (const step of phase.steps || []) {
        referencedAgents.add(step.agent);
      }
    }
  }

  for (const agent of referencedAgents) {
    if (!availableAgents.includes(agent)) {
      errors.push(`Agent "${agent}" 不存在于运行时 configs/agents/，可用: ${availableAgents.join(', ')}`);
    }
  }

  // 4. State-machine specific checks
  if (mode === 'state-machine' && config?.workflow?.states) {
    const states = config.workflow.states;
    const stateNames = new Set(states.map(s => s.name));
    const requiredVerdicts = ['pass', 'conditional_pass', 'fail'];

    // Check initial/final states
    const initials = states.filter(s => s.isInitial);
    const finals = states.filter(s => s.isFinal);
    if (initials.length === 0) errors.push('缺少初始状态（isInitial: true）');
    if (initials.length > 1) errors.push(`有 ${initials.length} 个初始状态，应该只有 1 个`);
    if (finals.length === 0) errors.push('缺少终止状态（isFinal: true）');

    // Check transition targets
    for (const state of states) {
      for (const t of state.transitions || []) {
        if (!stateNames.has(t.to)) {
          errors.push(`状态 "${state.name}" 的转移目标 "${t.to}" 不存在`);
        }
      }
    }

    // Check non-final states have exactly one pass / conditional_pass / fail transition.
    for (const state of states) {
      if (state.isFinal) continue;
      const transitions = Array.isArray(state.transitions) ? state.transitions : [];
      const verdictTransitions = transitions.filter(t => typeof t?.condition?.verdict === 'string');
      const nonVerdictTransitions = transitions.filter(t => typeof t?.condition?.verdict !== 'string');
      if (nonVerdictTransitions.length > 0) {
        errors.push(`状态 "${state.name}" 包含未指定 verdict 的转移规则；非终止状态必须使用 pass/conditional_pass/fail 三路转移`);
      }
      for (const verdict of requiredVerdicts) {
        const matches = verdictTransitions.filter(t => t.condition.verdict === verdict);
        if (matches.length === 0) {
          errors.push(`状态 "${state.name}" 缺少 ${verdict} 转移路径`);
        } else if (matches.length > 1) {
          errors.push(`状态 "${state.name}" 的 ${verdict} 转移路径重复`);
        }
      }
    }

    // Check final states have no transitions
    for (const state of finals) {
      if (state.transitions && state.transitions.length > 0) {
        warnings.push(`终止状态 "${state.name}" 有 ${state.transitions.length} 个转移规则，通常应为空`);
      }
    }
  }

  // 5. Output results
  console.log(`\n📋 验证: ${configPath}\n`);

  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ 配置验证通过！');
    const stateCount = config?.workflow?.states?.length || config?.workflow?.phases?.length || 0;
    let stepCount = 0;
    for (const s of config?.workflow?.states || config?.workflow?.phases || []) {
      stepCount += (s.steps || []).length;
    }
    console.log(`   模式: ${mode || 'phase-based'}`);
    console.log(`   ${mode === 'state-machine' ? '状态' : '阶段'}: ${stateCount}`);
    console.log(`   步骤: ${stepCount}`);
    console.log(`   Agent: ${referencedAgents.size}`);
    process.exit(0);
  }

  if (errors.length > 0) {
    console.log(`❌ 发现 ${errors.length} 个错误:\n`);
    errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  }
  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} 个警告:\n`);
    warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

// --- Main ---
const configPath = process.argv[2];
if (!configPath) {
  console.error('用法: node validate-workflow.mjs <config.yaml>');
  process.exit(1);
}
const resolvedConfigPath = isAbsolute(configPath)
  ? configPath
  : (existsSync(resolve(RUNTIME_ROOT, configPath))
      ? resolve(RUNTIME_ROOT, configPath)
      : existsSync(resolve(RUNTIME_CONFIGS_DIR, configPath))
        ? resolve(RUNTIME_CONFIGS_DIR, configPath)
      : resolve(process.cwd(), configPath));

validate(resolvedConfigPath);
