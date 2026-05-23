import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';
import { resolveAgentSelection } from '@/lib/agent/engine-selection';
import { getEngineConfigPath, getWorkspaceDataFile } from '@/lib/core/app-paths';
import { getConfiguredEngine } from '@/lib/engines/engine-factory';
import { getRuntimeAgentConfigPath } from '@/lib/run/runtime-configs';
import type { RoleConfig } from '@/lib/core/schemas';

export type AgoraGuestSourceType = 'preset' | 'custom';
export type AgoraGuestStatus = 'available' | 'unavailable';
export type AgoraGuestRuntimeStrategy = 'system' | 'explicit';

export interface AgoraGuestPreset {
  id: string;
  displayName: string;
  templateAgent?: string;
  description: string;
  personaPrompt: string;
  engine?: string;
  model?: string;
  status?: AgoraGuestStatus;
  statusReason?: string;
}

export interface AgoraGuestConfig {
  id: string;
  displayName: string;
  runtimeAgentName: string;
  sourceType: AgoraGuestSourceType;
  sourceAgent?: string;
  presetId?: string;
  personaPrompt: string;
  systemPrompt: string;
  runtimeStrategy?: AgoraGuestRuntimeStrategy;
  engine?: string;
  model?: string;
  resolvedEngine?: string;
  resolvedModel?: string;
  status: AgoraGuestStatus;
  statusReason?: string;
  createdAt: number;
  updatedAt: number;
}

export const AGORA_GUEST_PRESETS: AgoraGuestPreset[] = [
  {
    id: 'engineer',
    displayName: '工程师',
    templateAgent: 'developer',
    description: '负责实现方案、拆分代码任务、评估落地成本。',
    personaPrompt: '高级软件开发工程师，关注实现质量、边界条件、可维护性和工程落地。',
  },
  {
    id: 'code-reviewer',
    displayName: '代码评审',
    templateAgent: 'code-auditor',
    description: '负责发现缺陷、规范风险、安全问题和测试缺口。',
    personaPrompt: '资深代码评审专家，优先指出具体风险、回归隐患和可执行修复建议。',
  },
  {
    id: 'architect',
    displayName: '架构师',
    templateAgent: 'architect',
    description: '负责系统边界、模块关系、演进路线和关键取舍。',
    personaPrompt: '资深架构师，关注长期演进、接口契约、模块职责和复杂度控制。',
  },
  {
    id: 'tester',
    displayName: '测试',
    templateAgent: 'tester',
    description: '负责测试策略、验收标准、边界场景和回归覆盖。',
    personaPrompt: '测试开发工程师，关注可验证性、失败场景、端到端路径和质量门禁。',
  },
  {
    id: 'product-manager',
    displayName: '产品经理',
    templateAgent: 'product-manager',
    description: '负责目标、用户路径、优先级和验收口径。',
    personaPrompt: '产品经理，关注用户价值、需求边界、优先级、信息架构和可交付验收标准。',
  },
  {
    id: 'copywriter',
    displayName: '文案',
    templateAgent: 'copywriter',
    description: '负责表达、命名、提示语、发布说明和对外叙事。',
    personaPrompt: '产品文案与技术写作者，关注简洁表达、信息层级、语气一致性和用户理解成本。',
  },
];

const GUEST_ID_RE = /^[a-zA-Z0-9_-]+$/;

function getGuestsDir() {
  return getWorkspaceDataFile('agora-guests');
}

function sanitizeSlug(input: string, fallback = 'guest') {
  const normalized = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44);
  return normalized || fallback;
}

function createId(prefix: string) {
  return `${sanitizeSlug(prefix)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function assertGuestId(id: string) {
  if (!id || !GUEST_ID_RE.test(id)) {
    throw new Error('无效嘉宾 ID');
  }
}

function guestPath(id: string) {
  assertGuestId(id);
  return path.join(getGuestsDir(), `${id}.yaml`);
}

async function loadAgentTemplate(name: string): Promise<RoleConfig | null> {
  try {
    const raw = await readFile(await getRuntimeAgentConfigPath(name), 'utf-8');
    return parse(raw) as RoleConfig;
  } catch {
    return null;
  }
}

function buildFallbackSystemPrompt(displayName: string, personaPrompt: string) {
  return [
    `你是议场嘉宾「${displayName}」。`,
    personaPrompt,
    '你正在真实多人群聊中发言，只代表你自己的观点。',
    '优先给出结论、依据、风险和下一步建议。',
    '不要自称业务 Agent，不要展示工具过程，不要替其他嘉宾发言。',
  ].filter(Boolean).join('\n');
}

function readGlobalEngineSelection(): { engine?: string; defaultModel?: string } {
  try {
    if (!existsSync(getEngineConfigPath())) return {};
    const raw = JSON.parse(readFileSync(getEngineConfigPath(), 'utf-8'));
    return {
      engine: typeof raw?.engine === 'string' ? raw.engine : undefined,
      defaultModel: typeof raw?.defaultModel === 'string' ? raw.defaultModel : undefined,
    };
  } catch {
    return {};
  }
}

async function resolveGuestRuntime(input: {
  template?: RoleConfig | null;
  runtimeStrategy?: AgoraGuestRuntimeStrategy;
  engine?: string;
  model?: string;
}): Promise<{ engine: string; model: string; status: AgoraGuestStatus; statusReason?: string }> {
  const explicitEngine = String(input.engine || '').trim();
  const explicitModel = String(input.model || '').trim();
  const runtimeStrategy: AgoraGuestRuntimeStrategy = input.runtimeStrategy === 'explicit'
    ? 'explicit'
    : 'system';
  const globalSelection = readGlobalEngineSelection();
  const configuredEngine = await getConfiguredEngine().catch(() => globalSelection.engine || '');
  const templateSelection = resolveAgentSelection(input.template, globalSelection, undefined);
  const templateModels = input.template?.engineModels || {};
  const engine = runtimeStrategy === 'system'
    ? (explicitEngine || configuredEngine || globalSelection.engine || templateSelection.effectiveEngine || '')
    : (explicitEngine || templateSelection.effectiveEngine || configuredEngine || globalSelection.engine || '');
  const model = runtimeStrategy === 'system'
    ? (
      explicitModel
      || globalSelection.defaultModel
      || (engine ? templateModels[engine] : '')
      || templateSelection.effectiveModel
      || ''
    )
    : (
      explicitModel
      || (engine ? templateModels[engine] : '')
      || templateSelection.effectiveModel
      || globalSelection.defaultModel
      || ''
    );

  if (!engine) {
    return { engine, model, status: 'unavailable', statusReason: '未配置可用引擎' };
  }
  if (!model) {
    return { engine, model, status: 'unavailable', statusReason: '未配置可用模型' };
  }
  return { engine, model, status: 'available' };
}

async function hydrateGuestConfig(config: AgoraGuestConfig): Promise<AgoraGuestConfig> {
  const template = config.sourceAgent ? await loadAgentTemplate(config.sourceAgent) : null;
  if (config.sourceAgent && !template) {
    return {
      ...config,
      status: 'unavailable',
      statusReason: `未找到模板 Agent：${config.sourceAgent}`,
    };
  }
  const runtimeStrategy: AgoraGuestRuntimeStrategy = config.runtimeStrategy === 'explicit'
    ? 'explicit'
    : (String(config.engine || '').trim() ? 'explicit' : 'system');
  const runtime = await resolveGuestRuntime({
    template,
    runtimeStrategy,
    engine: config.engine,
    model: config.model,
  });
  return {
    ...config,
    runtimeStrategy,
    resolvedEngine: runtime.engine,
    resolvedModel: runtime.model,
    status: runtime.status,
    statusReason: runtime.statusReason,
  };
}

export async function listAgoraGuestPresets(): Promise<AgoraGuestPreset[]> {
  return Promise.all(AGORA_GUEST_PRESETS.map(async (preset) => {
    const template = preset.templateAgent ? await loadAgentTemplate(preset.templateAgent) : null;
    if (preset.templateAgent && !template) {
      return {
        ...preset,
        status: 'unavailable',
        statusReason: `未找到模板 Agent：${preset.templateAgent}`,
      };
    }
    const runtime = await resolveGuestRuntime({ template, runtimeStrategy: 'system' });
    return {
      ...preset,
      engine: runtime.engine,
      model: runtime.model,
      status: runtime.status,
      statusReason: runtime.statusReason,
    };
  }));
}

export async function listAgoraGuestConfigs(): Promise<AgoraGuestConfig[]> {
  const dir = getGuestsDir();
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'));
  const guests: AgoraGuestConfig[] = [];
  for (const file of files) {
    try {
      const parsed = parse(await readFile(path.join(dir, file), 'utf-8')) as AgoraGuestConfig | null;
      if (parsed?.id && parsed.displayName && parsed.runtimeAgentName) guests.push(await hydrateGuestConfig(parsed));
    } catch {
      // Ignore malformed guest config files.
    }
  }
  return guests.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getAgoraGuestConfig(id: string): Promise<AgoraGuestConfig | null> {
  try {
    const parsed = parse(await readFile(guestPath(id), 'utf-8')) as AgoraGuestConfig;
    return parsed ? hydrateGuestConfig(parsed) : null;
  } catch {
    return null;
  }
}

export async function saveAgoraGuestConfig(input: {
  id?: string;
  displayName: string;
  sourceType: AgoraGuestSourceType;
  sourceAgent?: string;
  presetId?: string;
  personaPrompt?: string;
  engine?: string;
  model?: string;
}): Promise<AgoraGuestConfig> {
  const now = Date.now();
  const displayName = String(input.displayName || '').trim();
  if (!displayName) throw new Error('嘉宾名称不能为空');

  const sourceType: AgoraGuestSourceType = input.sourceType === 'custom' ? 'custom' : 'preset';
  const preset = input.presetId ? AGORA_GUEST_PRESETS.find((item) => item.id === input.presetId) : undefined;
  const sourceAgent = String(input.sourceAgent || preset?.templateAgent || '').trim();
  const template = sourceAgent ? await loadAgentTemplate(sourceAgent) : null;
  if (sourceAgent && !template) {
    throw new Error(`嘉宾「${displayName}」不可用：未找到模板 Agent：${sourceAgent}`);
  }
  const rawEngine = String(input.engine || '').trim();
  const rawModel = String(input.model || '').trim();
  const runtimeStrategy: AgoraGuestRuntimeStrategy = rawEngine ? 'explicit' : 'system';
  const personaPrompt = String(input.personaPrompt || preset?.personaPrompt || template?.persona || template?.description || '').trim();
  const systemPrompt = template?.systemPrompt
    ? [
        `你是议场嘉宾「${displayName}」。下面是你的性格与专业背景模板，请以这个身份参与真实群聊。`,
        template.systemPrompt,
        personaPrompt ? `\n议场中的补充定位：${personaPrompt}` : '',
        '\n发言要求：只代表自己，不要自称业务 Agent；回答要自然、紧凑、可行动。',
      ].filter(Boolean).join('\n')
    : buildFallbackSystemPrompt(displayName, personaPrompt);
  const runtime = await resolveGuestRuntime({
    template,
    runtimeStrategy,
    engine: rawEngine,
    model: rawModel,
  });
  if (runtime.status === 'unavailable') {
    throw new Error(`嘉宾「${displayName}」不可用：${runtime.statusReason || '模型或引擎未配置'}`);
  }

  const id = input.id && GUEST_ID_RE.test(input.id) ? input.id : createId(displayName);
  const existing = input.id ? await getAgoraGuestConfig(input.id) : null;
  const config: AgoraGuestConfig = {
    id,
    displayName,
    runtimeAgentName: existing?.runtimeAgentName || `agora-guest-${id}`,
    sourceType,
    sourceAgent: sourceAgent || undefined,
    presetId: input.presetId || preset?.id,
    personaPrompt,
    systemPrompt,
    runtimeStrategy,
    engine: rawEngine || undefined,
    model: rawModel || undefined,
    resolvedEngine: runtime.engine,
    resolvedModel: runtime.model,
    status: runtime.status,
    statusReason: runtime.statusReason,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await mkdir(getGuestsDir(), { recursive: true });
  await writeFile(guestPath(id), stringify(config), 'utf-8');
  return config;
}

export async function deleteAgoraGuestConfig(id: string): Promise<void> {
  await unlink(guestPath(id)).catch((error: any) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}
