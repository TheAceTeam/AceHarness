import { cp, mkdir, readdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { parse, stringify } from 'yaml';
import {
  getInstallConfigPath,
  getInstallConfigsDir,
  getWorkspaceAgentsDir,
  getWorkspaceConfigPath,
  getWorkspaceConfigsDir,
} from '@/lib/core/app-paths';
import { RETIRED_CATALOG_AGENT_NAMES } from '@/lib/agent/catalog';

const DELETED_MARKER = '.deleted.json';

const LEGACY_BUILTIN_AGENT_PROMPTS: Readonly<Record<string, string>> = {
  analyst: '你是一位分析专家。将复杂问题拆成目标、事实、约束、假设、选项和影响，形成可执行的判断。\n必须说明关键推理依据、数据缺口和决策权衡。',
  architect: '你是一位软件架构师。先理解现有系统、约束和目标，再设计最小可演进的技术方案。\n交付模块边界、关键接口、数据流、风险、迁移步骤和验证策略，并说明每项取舍依据。',
  'code-hunter': '你是一位代码审查者。以需求、设计和现有行为为依据，寻找会影响正确性、安全性、兼容性、可维护性或验证可信度的问题。\n每个发现必须包含位置、触发条件、影响和可执行的修复建议；没有证据时明确说明。',
  'code-judge': '你是一位软件交付裁判。基于实现、测试、审查和反例证据，判断当前阶段是否达到目标。\n输出 pass、conditional_pass 或 fail，逐项说明接受或驳回的发现、阻塞项和下一步条件。',
  copywriter: '你是一位产品文案专家。为产品、功能和流程提供自然、准确、符合使用场景的文字。\n保持术语一致，突出用户能完成的事情，并在关键操作和异常状态中减少歧义。',
  'default-supervisor': '你是系统 Supervisor，负责协调工作流而非替代步骤 Agent 完成任务。\n基于已提交的产物、日志和裁决，判断是否可以继续、需要补充证据，还是应升级给用户。\n你只给出明确的检查点建议、风险和下一步，不重复执行实现、研究或测试工作。',
  'design-judge': '你是一位设计裁判。基于方案、挑战意见和用户目标，判断当前设计是否具备进入实施的条件。\n输出明确 verdict，逐项说明已满足的标准、阻塞项和放行条件。',
  developer: '你是一位软件开发者。先定位相关代码和约束，按现有项目模式实现最小完整改动。\n同步补齐必要测试和文档，交付修改范围、验证命令、结果和已知限制。',
  'documentation-writer': '你是一位技术文档作者。将已验证的决策、操作步骤、接口、限制和验证结果整理为便于后续使用的文档。\n面向实际读者组织内容，保留必要上下文和可定位的证据。',
  'evidence-judge': '你是一位证据裁判。评估主张、支持材料和反证是否足以支撑当前结论。\n输出 pass、conditional_pass 或 fail，并逐项说明裁决依据、缺口和放行条件。',
  'experience-designer': '你是一位体验设计师。以用户任务和真实使用情境为中心，设计清晰、可理解、可完成的流程与界面行为。\n说明关键状态、异常路径、反馈和可访问性要求，并给出可验收的交互描述。',
  'fact-checker': '你是事实核查者，负责挑战研究、分析和内容中的关键主张。\n对每项重要结论给出支持证据、冲突证据或无法验证的原因，并指出会影响结论的缺口。',
  generalist: '你是一位通用交付专家。先澄清目标、约束和已有材料，再选择最小可验证的行动完成任务。\n输出可直接交接的结果：做了什么、依据是什么、验证情况和下一步。',
  'issue-reproducer': '你是一位问题复现专家。把现象、环境和输入收敛为稳定的最小复现，并记录观察结果与可排除因素。\n若不能复现，说明已尝试的路径、证据缺口和下一条最有效的诊断动作。',
  'performance-breaker': '你是一位性能挑战者。针对目标路径构造现实负载、边界输入和资源竞争场景，检查时间、内存、吞吐和稳定性退化。\n用可复现的测量、基线和影响范围报告问题，不把没有数据的担忧作为结论。',
  'performance-judge': '你是一位性能裁判。评估基准设计、环境一致性、样本质量和性能结论是否足够支持放行。\n输出明确 verdict，并说明指标、置信边界、残余风险和需要补充的测量。',
  'product-manager': '你是一位产品经理。围绕用户目标、核心场景、范围和成功标准收敛需求，形成可交付的计划。\n明确必须项、后续项、依赖和验收标准，避免把尚未确认的假设当成需求。',
  researcher: '你是一位研究专家。把问题拆为待验证的事实和待比较的选项，优先使用一手材料和可定位来源。\n交付结论时标明证据、适用条件、未知项和可继续验证的方向。',
  'solution-breaker': '你是一位方案挑战者。主动寻找产品和体验方案中未覆盖的用户、场景、约束、依赖和失败路径。\n每个问题要给出触发条件、影响和最小补充动作，避免只给抽象意见。',
  'stress-tester': '你是一位稳定性测试专家。设计异常、边界、高负载和恢复场景，验证系统在压力下的行为、资源边界和错误诊断。\n报告精确触发方式、观察结果、影响和最小修复或缓解建议。',
  tester: '你是一位测试工程师。根据需求、实现和风险设计可重复的验证，覆盖核心流程、边界和错误处理。\n交付测试范围、执行结果、失败证据和未覆盖风险；发现问题时给出稳定复现路径。',
  writer: '你是一位专业写作者。根据受众、目标和来源材料组织准确、清楚、易读的内容。\n先建立结构，再完成表达；保留关键事实的出处和不确定性。',
};

let seedPromise: Promise<void> | null = null;

async function loadDeletedSet(configsDir: string): Promise<Set<string>> {
  const markerPath = resolve(configsDir, DELETED_MARKER);
  if (!existsSync(markerPath)) return new Set();
  try {
    const content = await readFile(markerPath, 'utf-8');
    const list: string[] = JSON.parse(content);
    return new Set(list);
  } catch {
    return new Set();
  }
}

async function saveDeletedSet(configsDir: string, deleted: Set<string>): Promise<void> {
  const markerPath = resolve(configsDir, DELETED_MARKER);
  await writeFile(markerPath, JSON.stringify([...deleted], null, 2), 'utf-8');
}

export async function markConfigDeleted(configsDir: string, relativePath: string): Promise<void> {
  const deleted = await loadDeletedSet(configsDir);
  deleted.add(relativePath);
  await saveDeletedSet(configsDir, deleted);
}

export async function unmarkConfigDeleted(configsDir: string, relativePath: string): Promise<void> {
  const deleted = await loadDeletedSet(configsDir);
  if (!deleted.has(relativePath)) return;
  deleted.delete(relativePath);
  await saveDeletedSet(configsDir, deleted);
}

async function copyMissingRecursive(src: string, dst: string, deletedSet: Set<string>, baseDir: string): Promise<void> {
  const srcStat = await stat(src);
  if (srcStat.isDirectory()) {
    await mkdir(dst, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await copyMissingRecursive(resolve(src, entry.name), resolve(dst, entry.name), deletedSet, baseDir);
    }
    return;
  }

  const rel = relative(baseDir, dst);
  if (deletedSet.has(rel)) return;

  if (existsSync(dst)) return;
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { force: false });
}

async function removeRetiredBuiltinAgents(configsDir: string): Promise<void> {
  const agentsDir = resolve(configsDir, 'agents');
  for (const name of RETIRED_CATALOG_AGENT_NAMES) {
    for (const extension of ['.yaml', '.yml']) {
      const filePath = resolve(agentsDir, `${name}${extension}`);
      if (!existsSync(filePath)) continue;
      try {
        await unlink(filePath);
      } catch {
        // A legacy file must never prevent the current catalog from seeding.
      }
    }
  }
}

function getAgentSystemPrompt(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const prompt = (value as Record<string, unknown>).systemPrompt;
  return typeof prompt === 'string' ? prompt.trim() : '';
}

async function upgradeLegacyBuiltinAgentPrompts(installConfigsDir: string, runtimeConfigsDir: string): Promise<void> {
  const bundledAgentsDir = resolve(installConfigsDir, 'agents');
  const runtimeAgentsDir = resolve(runtimeConfigsDir, 'agents');

  for (const [name, legacyPrompt] of Object.entries(LEGACY_BUILTIN_AGENT_PROMPTS)) {
    const bundledPath = resolve(bundledAgentsDir, `${name}.yaml`);
    const runtimePath = resolve(runtimeAgentsDir, `${name}.yaml`);
    if (!existsSync(bundledPath) || !existsSync(runtimePath)) continue;

    try {
      const [bundledContent, runtimeContent] = await Promise.all([
        readFile(bundledPath, 'utf-8'),
        readFile(runtimePath, 'utf-8'),
      ]);
      const bundledAgent = parse(bundledContent);
      const runtimeAgent = parse(runtimeContent);
      const currentPrompt = getAgentSystemPrompt(runtimeAgent);
      const bundledPrompt = getAgentSystemPrompt(bundledAgent);
      if (currentPrompt !== legacyPrompt || !bundledPrompt || bundledPrompt === legacyPrompt) continue;

      await writeFile(runtimePath, stringify({
        ...(runtimeAgent as Record<string, unknown>),
        systemPrompt: bundledPrompt,
      }), 'utf-8');
    } catch {
      // A malformed or user-managed Agent config stays untouched.
    }
  }
}

export async function ensureRuntimeConfigsSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    const runtimeConfigsDir = getWorkspaceConfigsDir();
    const installConfigsDir = getInstallConfigsDir();

    if (!existsSync(runtimeConfigsDir)) {
      await mkdir(dirname(runtimeConfigsDir), { recursive: true });
      await cp(installConfigsDir, runtimeConfigsDir, { recursive: true, force: false });
      return;
    }

    const deletedSet = await loadDeletedSet(runtimeConfigsDir);

    // Remove tombstoned files that still exist on disk
    for (const rel of deletedSet) {
      const fullPath = resolve(runtimeConfigsDir, rel);
      if (existsSync(fullPath)) {
        try { await unlink(fullPath); } catch { /* ignore */ }
      }
    }

    // Retired bundled identities are removed from the runtime catalog. Existing
    // workflow YAML must use an active Agent ID before it can be executed.
    await removeRetiredBuiltinAgents(runtimeConfigsDir);

    await copyMissingRecursive(installConfigsDir, runtimeConfigsDir, deletedSet, runtimeConfigsDir);
    await upgradeLegacyBuiltinAgentPrompts(installConfigsDir, runtimeConfigsDir);
  })().finally(() => {
    seedPromise = null;
  });

  return seedPromise;
}

export async function getRuntimeWorkflowConfigPath(filename: string): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigPath(filename);
}

export async function getRuntimeAgentConfigPath(name: string): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigPath('agents', `${name}.yaml`);
}

export async function getRuntimeModelsConfigPath(): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigPath('models', 'models.yaml');
}

export async function getRuntimeSdkSettingsPath(): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigPath('settings', 'cangjie-sdks.yaml');
}

export async function getRuntimeConfigsDirPath(): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigsDir();
}

export async function getRuntimeAgentsDirPath(): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceAgentsDir();
}

export function getBundledWorkflowConfigPath(filename: string): string {
  return getInstallConfigPath(filename);
}
