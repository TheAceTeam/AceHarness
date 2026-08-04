import { z } from 'zod';

export const WORKFLOW_TEMPLATE_API_VERSION = 'aceharness.io/v1alpha1' as const;

export const workflowTemplateSourceSchema = z.enum(['builtin', 'local']);
export const workflowTemplateVisibilitySchema = z.enum(['private', 'public']);
export const workflowTemplateModeSchema = z.literal('state-machine');

const templateIdSchema = z.string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, '模板 ID 必须使用小写字母、数字和连字符');

const templateVersionSchema = z.string()
  .max(64)
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, '模板版本必须使用语义化版本，例如 1.0.0');

const workflowConfigFilenameSchema = z.string()
  .min(1, '源工作流文件不能为空')
  .max(240, '源工作流文件名过长')
  .refine((value) => !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value.trim()), '源工作流文件必须是相对路径')
  .transform((value) => value.trim().replace(/\\/g, '/').split('/').filter(Boolean).join('/'))
  .refine((value) => /\.ya?ml$/i.test(value), '源工作流文件必须以 .yaml 或 .yml 结尾')
  .refine((value) => !value.includes('\0'), '源工作流文件名包含非法字符')
  .refine((value) => {
    const segments = value.split('/');
    return segments.length > 0 && segments.every((segment) => segment !== '.' && segment !== '..');
  }, '源工作流文件名不能包含 . 或 .. 路径段');

export const workflowTemplateIdentitySchema = z.object({
  source: workflowTemplateSourceSchema,
  id: templateIdSchema,
  version: templateVersionSchema,
});

const jsonPointerSchema = z.string()
  .startsWith('/', '参数绑定必须是 JSON Pointer')
  .refine((value) => !/(?:^|\/)(?:__proto__|prototype|constructor)(?:\/|$)/.test(value), '参数绑定包含不安全路径');

const templateParameterOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string(),
});

export const workflowTemplateParameterSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  label: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  type: z.enum(['string', 'text', 'directory', 'enum', 'boolean', 'number']),
  bind: jsonPointerSchema,
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(templateParameterOptionSchema).min(1).optional(),
}).superRefine((parameter, ctx) => {
  if (parameter.type === 'enum' && !parameter.options?.length) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: 'enum 参数必须提供 options' });
  }
  if (parameter.default !== undefined) {
    const matchesType = parameter.type === 'boolean'
      ? typeof parameter.default === 'boolean'
      : parameter.type === 'number'
        ? typeof parameter.default === 'number'
        : typeof parameter.default === 'string';
    if (!matchesType) {
      ctx.addIssue({ code: 'custom', path: ['default'], message: '默认值类型与参数类型不匹配' });
    }
  }
});

export const workflowTemplateManifestSchema = z.object({
  apiVersion: z.literal(WORKFLOW_TEMPLATE_API_VERSION),
  kind: z.literal('WorkflowTemplate'),
  metadata: z.object({
    id: templateIdSchema,
    version: templateVersionSchema,
    name: z.string().min(1).max(100),
    description: z.string().max(1000).default(''),
    category: z.string().min(1).max(60).default('其他'),
    tags: z.array(z.string().min(1).max(40)).max(12).default([]),
    featured: z.boolean().default(false),
  }),
  spec: z.object({
    entrypoint: z.literal('workflow.yaml').default('workflow.yaml'),
    mode: workflowTemplateModeSchema,
    parameters: z.array(workflowTemplateParameterSchema).max(30).default([]),
    compatibility: z.object({
      aceharness: z.string().optional(),
    }).default({}),
    dependencies: z.object({
      agents: z.array(z.string()).default([]),
      skills: z.array(z.string()).default([]),
      mcpServers: z.array(z.string()).default([]),
      subworkflows: z.array(z.string()).default([]),
    }).default({ agents: [], skills: [], mcpServers: [], subworkflows: [] }),
  }),
}).superRefine((manifest, ctx) => {
  const ids = new Set<string>();
  const bindings = new Set<string>();
  for (const [index, parameter] of manifest.spec.parameters.entries()) {
    if (ids.has(parameter.id)) {
      ctx.addIssue({ code: 'custom', path: ['spec', 'parameters', index, 'id'], message: '参数 ID 不能重复' });
    }
    if (bindings.has(parameter.bind)) {
      ctx.addIssue({ code: 'custom', path: ['spec', 'parameters', index, 'bind'], message: '参数绑定不能重复' });
    }
    ids.add(parameter.id);
    bindings.add(parameter.bind);
  }
});

export const saveWorkflowTemplateInputSchema = z.object({
  sourceFilename: workflowConfigFilenameSchema,
  id: templateIdSchema,
  version: templateVersionSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  category: z.string().min(1).max(60).default('自定义'),
  tags: z.array(z.string().min(1).max(40)).max(12).default([]),
  visibility: workflowTemplateVisibilitySchema.default('private'),
});

export const instantiateWorkflowTemplateInputSchema = z.object({
  ...workflowTemplateIdentitySchema.shape,
  filename: z.string().regex(/^[a-zA-Z0-9_-]+\.yaml$/, '文件名必须以 .yaml 结尾且只包含字母、数字、下划线和连字符'),
  values: z.record(z.string(), z.unknown()).default({}),
  agentMappings: z.record(z.string(), z.string()).default({}),
});

export type WorkflowTemplateSource = z.infer<typeof workflowTemplateSourceSchema>;
export type WorkflowTemplateVisibility = z.infer<typeof workflowTemplateVisibilitySchema>;
export type WorkflowTemplateMode = z.infer<typeof workflowTemplateModeSchema>;
export type WorkflowTemplateParameter = z.infer<typeof workflowTemplateParameterSchema>;
export type WorkflowTemplateManifest = z.infer<typeof workflowTemplateManifestSchema>;
export type SaveWorkflowTemplateInput = z.infer<typeof saveWorkflowTemplateInputSchema>;
export type InstantiateWorkflowTemplateInput = z.infer<typeof instantiateWorkflowTemplateInputSchema>;

export interface WorkflowTemplateIdentity {
  source: WorkflowTemplateSource;
  id: string;
  version: string;
}

export interface WorkflowTemplateDependencyReport {
  agents: string[];
  skills: string[];
  mcpServers: string[];
  subworkflows: string[];
  missingAgents: string[];
  missingSkills: string[];
  missingMcpServers: string[];
  missingSubworkflows: string[];
}

export interface WorkflowTemplateSummary extends WorkflowTemplateIdentity {
  name: string;
  description: string;
  category: string;
  tags: string[];
  featured: boolean;
  mode: WorkflowTemplateMode;
  digest: string;
  versions: string[];
  visibility: WorkflowTemplateVisibility | 'builtin';
  editable: boolean;
  createdAt?: number;
  ownerId?: string;
  stateCount: number;
  stepCount: number;
  parameterCount: number;
  preCommandCount: number;
  dependencies: WorkflowTemplateManifest['spec']['dependencies'];
}

export interface WorkflowTemplateDetail extends WorkflowTemplateSummary {
  manifest: WorkflowTemplateManifest;
  workflow: Record<string, unknown>;
}

export interface WorkflowTemplateLocalMeta {
  createdBy: string;
  visibility: WorkflowTemplateVisibility;
  createdAt: number;
}
