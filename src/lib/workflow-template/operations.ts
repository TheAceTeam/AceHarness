import { access, readFile, readdir, unlink, writeFile } from 'fs/promises';
import { isAbsolute, join } from 'path';
import { parse, stringify } from 'yaml';
import { canAccessConfigMeta, getConfigMeta, setConfigMeta } from '@/lib/config/metadata';
import { validateWorkflowDraft } from '@/lib/core/creator-validation';
import { loadMcpRegistry } from '@/lib/mcp/registry';
import { ensureRuntimeConfigsSeeded, getRuntimeAgentsDirPath, getRuntimeConfigsDirPath } from '@/lib/run/runtime-configs';
import { getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';
import { validateSubworkflowDependenciesForConfig } from '@/lib/workflow/subworkflow-config';
import {
  getWorkflowTemplate,
  normalizeTemplateDependencies,
  WorkflowTemplateError,
  writeLocalWorkflowTemplatePackage,
  type WorkflowTemplateAccessContext,
} from '@/lib/workflow-template/registry';
import {
  WORKFLOW_TEMPLATE_API_VERSION,
  instantiateWorkflowTemplateInputSchema,
  saveWorkflowTemplateInputSchema,
  workflowTemplateManifestSchema,
  type InstantiateWorkflowTemplateInput,
  type SaveWorkflowTemplateInput,
  type WorkflowTemplateDependencyReport,
  type WorkflowTemplateDetail,
  type WorkflowTemplateManifest,
} from '@/lib/workflow-template/types';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function unique(values: unknown[]): string[] {
  return Array.from(new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function getWorkflowNodes(config: Record<string, any>): Array<Record<string, any>> {
  const workflow = config.workflow || {};
  if (Array.isArray(workflow.states)) return workflow.states;
  if (Array.isArray(workflow.phases)) return workflow.phases;
  return [];
}

function getWorkflowSteps(config: Record<string, any>): Array<Record<string, any>> {
  return getWorkflowNodes(config).flatMap((node) => Array.isArray(node.steps) ? node.steps : []);
}

function getSubworkflowRef(step: Record<string, any>): string {
  if (step.type !== 'subworkflow') return '';
  return String(step.workflow || step.subworkflow?.configFile || '').trim();
}

function getMcpServerName(server: unknown): string {
  if (typeof server === 'string') return server;
  if (server && typeof server === 'object' && typeof (server as { name?: unknown }).name === 'string') {
    return (server as { name: string }).name;
  }
  return '';
}

export function deriveWorkflowTemplateDependencies(config: Record<string, any>) {
  const steps = getWorkflowSteps(config);
  const roles = Array.isArray(config.roles) ? config.roles : [];
  const supervisorAgent = typeof config.workflow?.supervisor?.agent === 'string'
    ? config.workflow.supervisor.agent
    : '';
  const agents = unique([
    supervisorAgent,
    ...steps.filter((step) => step.type !== 'subworkflow').map((step) => step.agent),
  ]);
  const skills = unique([
    ...(Array.isArray(config.context?.skills) ? config.context.skills : []),
    ...steps.flatMap((step) => Array.isArray(step.skills) ? step.skills : []),
    ...roles.flatMap((role: any) => Array.isArray(role.skills) ? role.skills : []),
  ]);
  const mcpServers = unique([
    ...(Array.isArray(config.context?.mcpServers) ? config.context.mcpServers : []),
    ...roles.flatMap((role: any) => Array.isArray(role.mcpServers) ? role.mcpServers.map(getMcpServerName) : []),
  ]);
  const subworkflows = unique(steps.map(getSubworkflowRef));
  return normalizeTemplateDependencies({ agents, skills, mcpServers, subworkflows });
}

async function listYamlBasenames(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => entry.name.replace(/\.ya?ml$/i, ''));
  } catch {
    return [];
  }
}

async function listSkillNames(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function configExists(configFile: string): Promise<boolean> {
  try {
    await access(join(await getRuntimeConfigsDirPath(), configFile));
    return true;
  } catch {
    return false;
  }
}

export async function buildWorkflowTemplateDependencyReport(config: Record<string, any>): Promise<WorkflowTemplateDependencyReport> {
  const dependencies = deriveWorkflowTemplateDependencies(config);
  const [agentNames, skillNames, mcpRegistry, subworkflowExists] = await Promise.all([
    listYamlBasenames(await getRuntimeAgentsDirPath()),
    listSkillNames(await getRuntimeSkillsDirPath()),
    loadMcpRegistry(),
    Promise.all(dependencies.subworkflows.map(configExists)),
  ]);
  const availableAgents = new Set(agentNames);
  const availableSkills = new Set(skillNames);
  const availableMcpServers = new Set(mcpRegistry.map((server) => server.name));
  return {
    ...dependencies,
    missingAgents: dependencies.agents.filter((name) => !availableAgents.has(name)),
    missingSkills: dependencies.skills.filter((name) => !availableSkills.has(name)),
    missingMcpServers: dependencies.mcpServers.filter((name) => !availableMcpServers.has(name)),
    missingSubworkflows: dependencies.subworkflows.filter((_name, index) => !subworkflowExists[index]),
  };
}

function stripSpecTaskBindings(config: Record<string, any>): void {
  for (const step of getWorkflowSteps(config)) {
    delete step.specTaskBinding;
  }
}

function sanitizeWorkflowForTemplate(config: Record<string, any>): Record<string, any> {
  const sanitized = deepClone(config);
  sanitized.context = sanitized.context || {};
  sanitized.context.projectRoot = '';
  sanitized.context.requirements = '';
  delete sanitized.context.codebase;
  const databases = sanitized.context?.capabilitySkills?.sqlite?.databases;
  if (Array.isArray(databases)) {
    for (const database of databases) {
      if (typeof database?.path === 'string' && isAbsolute(database.path)) {
        database.path = '';
      }
    }
  }
  stripSpecTaskBindings(sanitized);
  return sanitized;
}

function defaultTemplateParameters(config: Record<string, any>): WorkflowTemplateManifest['spec']['parameters'] {
  const workspaceMode = config.context?.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place';
  return [
    {
      id: 'workflowName',
      label: '工作流名称',
      type: 'string',
      bind: '/workflow/name',
      required: true,
      default: String(config.workflow?.name || '新工作流'),
    },
    {
      id: 'description',
      label: '工作流描述',
      type: 'text',
      bind: '/workflow/description',
      required: false,
      default: String(config.workflow?.description || ''),
    },
    {
      id: 'projectRoot',
      label: '工作目录',
      description: '工作流执行时使用的项目绝对路径',
      type: 'directory',
      bind: '/context/projectRoot',
      required: true,
    },
    {
      id: 'workspaceMode',
      label: '工作区模式',
      type: 'enum',
      bind: '/context/workspaceMode',
      required: true,
      default: workspaceMode,
      options: [
        { label: '原目录执行', value: 'in-place' },
        { label: '隔离副本', value: 'isolated-copy' },
      ],
    },
    {
      id: 'requirements',
      label: '本次需求',
      description: '补充当前实例的目标和约束',
      type: 'text',
      bind: '/context/requirements',
      required: false,
      default: '',
    },
  ];
}

function parseInput<T>(result: { success: true; data: T } | { success: false; error: { issues: unknown[] } }, message: string): T {
  if (!result.success) {
    throw new WorkflowTemplateError(message, 400, 'WORKFLOW_TEMPLATE_INPUT_INVALID', result.error.issues);
  }
  return result.data;
}

export async function saveWorkflowAsTemplate(
  rawInput: SaveWorkflowTemplateInput,
  accessContext: WorkflowTemplateAccessContext,
): Promise<WorkflowTemplateDetail> {
  const input = parseInput(saveWorkflowTemplateInputSchema.safeParse(rawInput), '模板信息校验失败');
  await ensureRuntimeConfigsSeeded();
  const meta = await getConfigMeta(input.sourceFilename, 'workflow');
  if (!canAccessConfigMeta(meta, accessContext.userId, accessContext.role)) {
    throw new WorkflowTemplateError('无权限访问源工作流', 403, 'WORKFLOW_TEMPLATE_SOURCE_FORBIDDEN');
  }
  let source: Record<string, any>;
  try {
    source = parse(await readFile(join(await getRuntimeConfigsDirPath(), input.sourceFilename), 'utf8'));
  } catch (error) {
    throw new WorkflowTemplateError('源工作流不存在或无法读取', 404, 'WORKFLOW_TEMPLATE_SOURCE_NOT_FOUND', error instanceof Error ? error.message : String(error));
  }
  const sourceValidation = validateWorkflowDraft(source, { mode: 'portable' });
  if (!sourceValidation.ok || !sourceValidation.normalized) {
    throw new WorkflowTemplateError('源工作流配置无效', 422, 'WORKFLOW_TEMPLATE_SOURCE_INVALID', sourceValidation.issues);
  }
  const sanitized = sanitizeWorkflowForTemplate(sourceValidation.normalized);
  const portableValidation = validateWorkflowDraft(sanitized, { mode: 'portable' });
  if (!portableValidation.ok || !portableValidation.normalized) {
    throw new WorkflowTemplateError('工作流无法转换为可移植模板', 422, 'WORKFLOW_TEMPLATE_SANITIZE_FAILED', portableValidation.issues);
  }
  const mode = portableValidation.normalized.workflow?.mode === 'state-machine' ? 'state-machine' : 'phase-based';
  const manifest = parseInput(workflowTemplateManifestSchema.safeParse({
    apiVersion: WORKFLOW_TEMPLATE_API_VERSION,
    kind: 'WorkflowTemplate',
    metadata: {
      id: input.id,
      version: input.version,
      name: input.name,
      description: input.description,
      category: input.category,
      tags: input.tags,
      featured: false,
    },
    spec: {
      entrypoint: 'workflow.yaml',
      mode,
      compatibility: { csiharness: '>=0.1.0 <1.0.0' },
      parameters: defaultTemplateParameters(portableValidation.normalized),
      dependencies: deriveWorkflowTemplateDependencies(portableValidation.normalized),
    },
  }), '模板包清单校验失败');
  return writeLocalWorkflowTemplatePackage({
    manifest,
    workflow: portableValidation.normalized,
    createdBy: accessContext.userId,
    visibility: input.visibility,
  });
}

function decodeJsonPointer(pointer: string): string[] {
  return pointer.slice(1).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function setJsonPointer(target: Record<string, any>, pointer: string, value: unknown): void {
  const segments = decodeJsonPointer(pointer);
  let current: any = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
      throw new WorkflowTemplateError('参数绑定包含不安全路径', 400, 'WORKFLOW_TEMPLATE_BINDING_UNSAFE');
    }
    if (Array.isArray(current)) {
      const arrayIndex = Number(segment);
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= current.length) {
        throw new WorkflowTemplateError(`参数绑定路径不存在: ${pointer}`, 422, 'WORKFLOW_TEMPLATE_BINDING_INVALID');
      }
      current = current[arrayIndex];
    } else {
      if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
        throw new WorkflowTemplateError(`参数绑定路径不存在: ${pointer}`, 422, 'WORKFLOW_TEMPLATE_BINDING_INVALID');
      }
      current = current[segment];
    }
  }
  const finalSegment = segments[segments.length - 1];
  if (!current || typeof current !== 'object' || finalSegment === '__proto__' || finalSegment === 'prototype' || finalSegment === 'constructor') {
    throw new WorkflowTemplateError(`参数绑定路径无效: ${pointer}`, 422, 'WORKFLOW_TEMPLATE_BINDING_INVALID');
  }
  if (Array.isArray(current)) {
    const arrayIndex = Number(finalSegment);
    if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= current.length) {
      throw new WorkflowTemplateError(`参数绑定路径不存在: ${pointer}`, 422, 'WORKFLOW_TEMPLATE_BINDING_INVALID');
    }
    current[arrayIndex] = value;
  } else {
    current[finalSegment] = value;
  }
}

function resolveParameterValues(
  manifest: WorkflowTemplateManifest,
  providedValues: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const knownParameters = new Set(manifest.spec.parameters.map((parameter) => parameter.id));
  const unknownKeys = Object.keys(providedValues).filter((key) => !knownParameters.has(key));
  if (unknownKeys.length > 0) {
    throw new WorkflowTemplateError(`包含未知模板参数: ${unknownKeys.join(', ')}`, 400, 'WORKFLOW_TEMPLATE_PARAMETER_UNKNOWN');
  }
  const values: Record<string, string | number | boolean> = {};
  for (const parameter of manifest.spec.parameters) {
    const hasProvidedValue = Object.prototype.hasOwnProperty.call(providedValues, parameter.id);
    const rawValue = hasProvidedValue ? providedValues[parameter.id] : parameter.default;
    if (rawValue === undefined || rawValue === null || (typeof rawValue === 'string' && !rawValue.trim() && parameter.required)) {
      if (parameter.required) {
        throw new WorkflowTemplateError(`缺少必填参数: ${parameter.label}`, 400, 'WORKFLOW_TEMPLATE_PARAMETER_REQUIRED', { parameterId: parameter.id });
      }
      continue;
    }
    const validType = parameter.type === 'boolean'
      ? typeof rawValue === 'boolean'
      : parameter.type === 'number'
        ? typeof rawValue === 'number' && Number.isFinite(rawValue)
        : typeof rawValue === 'string';
    if (!validType) {
      throw new WorkflowTemplateError(`参数类型错误: ${parameter.label}`, 400, 'WORKFLOW_TEMPLATE_PARAMETER_TYPE', { parameterId: parameter.id });
    }
    if (parameter.type === 'enum' && !parameter.options?.some((option) => option.value === rawValue)) {
      throw new WorkflowTemplateError(`参数选项无效: ${parameter.label}`, 400, 'WORKFLOW_TEMPLATE_PARAMETER_OPTION', { parameterId: parameter.id });
    }
    values[parameter.id] = rawValue as string | number | boolean;
  }
  return values;
}

function applyAgentMappings(config: Record<string, any>, mappings: Record<string, string>): void {
  const normalizedMappings = Object.fromEntries(
    Object.entries(mappings).map(([source, target]) => [source.trim(), target.trim()]).filter(([source, target]) => source && target),
  );
  if (config.workflow?.supervisor?.agent && normalizedMappings[config.workflow.supervisor.agent]) {
    config.workflow.supervisor.agent = normalizedMappings[config.workflow.supervisor.agent];
  }
  for (const step of getWorkflowSteps(config)) {
    if (step.type !== 'subworkflow' && step.agent && normalizedMappings[step.agent]) {
      step.agent = normalizedMappings[step.agent];
    }
  }
  const overrides = config.context?.executionPolicy?.agentOverrides;
  if (overrides && typeof overrides === 'object') {
    config.context.executionPolicy.agentOverrides = Object.fromEntries(
      Object.entries(overrides).map(([agent, value]) => [normalizedMappings[agent] || agent, value]),
    );
  }
}

function reportHasMissingDependencies(report: WorkflowTemplateDependencyReport): boolean {
  return report.missingAgents.length > 0
    || report.missingSkills.length > 0
    || report.missingMcpServers.length > 0
    || report.missingSubworkflows.length > 0;
}

export async function instantiateWorkflowTemplate(
  rawInput: InstantiateWorkflowTemplateInput,
  accessContext: WorkflowTemplateAccessContext,
): Promise<{
  filename: string;
  config: Record<string, unknown>;
  template: WorkflowTemplateDetail;
  dependencyReport: WorkflowTemplateDependencyReport;
}> {
  const input = parseInput(instantiateWorkflowTemplateInputSchema.safeParse(rawInput), '实例化参数校验失败');
  const template = await getWorkflowTemplate(input, accessContext);
  const values = resolveParameterValues(template.manifest, input.values);
  const config = deepClone(template.workflow);
  for (const parameter of template.manifest.spec.parameters) {
    if (Object.prototype.hasOwnProperty.call(values, parameter.id)) {
      setJsonPointer(config, parameter.bind, values[parameter.id]);
    }
  }
  applyAgentMappings(config, input.agentMappings);
  stripSpecTaskBindings(config);

  await ensureRuntimeConfigsSeeded();
  const runtimeValidation = validateWorkflowDraft(config, { mode: 'runtime' });
  if (!runtimeValidation.ok || !runtimeValidation.normalized) {
    throw new WorkflowTemplateError('模板实例校验失败', 422, 'WORKFLOW_TEMPLATE_INSTANCE_INVALID', runtimeValidation.issues);
  }
  const dependencyReport = await buildWorkflowTemplateDependencyReport(runtimeValidation.normalized);
  if (reportHasMissingDependencies(dependencyReport)) {
    throw new WorkflowTemplateError('模板依赖未就绪', 422, 'WORKFLOW_TEMPLATE_DEPENDENCIES_MISSING', dependencyReport);
  }
  const subworkflowIssues = await validateSubworkflowDependenciesForConfig(runtimeValidation.normalized);
  if (subworkflowIssues.length > 0) {
    throw new WorkflowTemplateError('子工作流依赖校验失败', 422, 'WORKFLOW_TEMPLATE_SUBWORKFLOW_INVALID', subworkflowIssues);
  }

  const destination = join(await getRuntimeConfigsDirPath(), input.filename);
  try {
    await writeFile(destination, stringify(runtimeValidation.normalized), { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'EEXIST') {
      throw new WorkflowTemplateError('工作流文件已存在', 409, 'WORKFLOW_CONFIG_EXISTS');
    }
    throw new WorkflowTemplateError('写入工作流配置失败', 500, 'WORKFLOW_TEMPLATE_INSTANCE_WRITE_FAILED', error instanceof Error ? error.message : String(error));
  }
  try {
    await setConfigMeta(input.filename, {
      createdBy: accessContext.userId,
      visibility: 'private',
      createdAt: Date.now(),
      specCodingEnabled: false,
      specCodingSkipped: true,
      templateRef: {
        source: template.source,
        id: template.id,
        version: template.version,
        digest: template.digest,
        instantiatedAt: Date.now(),
        parameterKeys: Object.keys(values).sort(),
      },
    }, 'workflow');
  } catch (error) {
    await unlink(destination).catch(() => undefined);
    throw new WorkflowTemplateError('写入工作流元数据失败', 500, 'WORKFLOW_TEMPLATE_INSTANCE_METADATA_FAILED', error instanceof Error ? error.message : String(error));
  }
  return {
    filename: input.filename,
    config: runtimeValidation.normalized,
    template,
    dependencyReport,
  };
}
