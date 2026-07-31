'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Layers3,
  LayoutTemplate,
  Loader2,
  Lock,
  PackageOpen,
  RefreshCw,
  ShieldCheck,
  Users,
  WandSparkles,
} from 'lucide-react';
import Link from '@/lib/navigation/client';
import { useAgentsQuery } from '@/client/query/agents';
import {
  useInstantiateWorkflowTemplateMutation,
  useWorkflowTemplateDetailQuery,
  useWorkflowTemplatesQuery,
} from '@/client/query/workflow-templates';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/core/utils';
import type { WorkflowTemplateDetail, WorkflowTemplateParameter, WorkflowTemplateSummary } from '@/lib/workflow-template/types';

type TemplateIdentity = Pick<WorkflowTemplateSummary, 'source' | 'id' | 'version'>;
type WorkflowTemplateStep = {
  name?: string;
  agent?: string;
  task?: string;
  description?: string;
};
type WorkflowTemplateNode = {
  name: string;
  description?: string;
  stepCount: number;
  final: boolean;
  steps: WorkflowTemplateStep[];
};

export interface WorkflowTemplateBrowserProps {
  onInstantiated: (filename: string) => void;
  variant?: 'standalone' | 'embedded';
  className?: string;
}

function sourceBadge(template: WorkflowTemplateSummary) {
  if (template.source === 'builtin') {
    return <Badge variant="secondary"><ShieldCheck className="mr-1 h-3 w-3" />内置</Badge>;
  }
  if (template.visibility === 'public') {
    return <Badge variant="outline"><Users className="mr-1 h-3 w-3" />团队</Badge>;
  }
  return <Badge variant="outline"><Lock className="mr-1 h-3 w-3" />个人</Badge>;
}

const PARAMETER_TYPE_LABELS: Record<WorkflowTemplateParameter['type'], string> = {
  string: '单行文本',
  text: '多行文本',
  directory: '路径选择',
  enum: '下拉选择',
  boolean: '开关',
  number: '数字',
};

function getWorkflowNodes(template: WorkflowTemplateDetail): WorkflowTemplateNode[] {
  const workflow = template.workflow?.workflow as Record<string, any> | undefined;
  return (Array.isArray(workflow?.states) ? workflow.states : []).map((state: any) => ({
    name: state.name,
    description: state.description,
    steps: Array.isArray(state.steps) ? state.steps : [],
    stepCount: Array.isArray(state.steps) ? state.steps.length : 0,
    final: state.isFinal === true,
  }));
}

function formatParameterDefault(parameter: WorkflowTemplateParameter) {
  if (parameter.default === undefined || parameter.default === '') return null;
  if (parameter.type === 'enum') {
    const matchedOption = parameter.options?.find((option) => option.value === parameter.default);
    if (matchedOption) return matchedOption.label;
  }
  if (parameter.type === 'boolean') return parameter.default ? '是' : '否';
  return String(parameter.default);
}

function parameterMetaItem(label: string, value: string, emphasis = false) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] leading-none',
        emphasis && 'border-primary/25 bg-primary/5',
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

function getStepSummary(step: WorkflowTemplateStep) {
  const summary = String(step.task || step.description || '').trim();
  return summary || '未填写任务描述';
}

function initializeValues(template: WorkflowTemplateDetail): Record<string, string | number | boolean> {
  return Object.fromEntries(template.manifest.spec.parameters.map((parameter) => [
    parameter.id,
    parameter.default ?? (parameter.type === 'boolean' ? false : parameter.type === 'number' ? 0 : ''),
  ]));
}

function ParameterField({
  parameter,
  value,
  onChange,
}: {
  parameter: WorkflowTemplateParameter;
  value: unknown;
  onChange: (value: string | number | boolean) => void;
}) {
  if (parameter.type === 'text') {
    return (
      <Textarea
        id={`template-param-${parameter.id}`}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
      />
    );
  }
  if (parameter.type === 'directory') {
    return (
      <WorkspaceDirectoryPicker
        value={String(value ?? '')}
        onChange={onChange}
        autoSelectRootWhenEmpty={false}
        emptyDisplayValue="选择工作目录"
      />
    );
  }
  if (parameter.type === 'enum') {
    return (
      <Select value={String(value ?? '')} onValueChange={onChange}>
        <SelectTrigger id={`template-param-${parameter.id}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          {parameter.options?.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (parameter.type === 'boolean') {
    return (
      <div className="flex h-10 items-center">
        <Checkbox
          id={`template-param-${parameter.id}`}
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
      </div>
    );
  }
  return (
    <Input
      id={`template-param-${parameter.id}`}
      type={parameter.type === 'number' ? 'number' : 'text'}
      value={String(value ?? '')}
      onChange={(event) => onChange(parameter.type === 'number' ? Number(event.target.value) : event.target.value)}
    />
  );
}

function WorkflowTemplateDetailPanel({
  template,
  embedded,
  onUse,
  onClose,
  onVersionChange,
}: {
  template: WorkflowTemplateDetail;
  embedded: boolean;
  onUse: () => void;
  onClose: () => void;
  onVersionChange: (version: string) => void;
}) {
  const nodes = useMemo(() => getWorkflowNodes(template), [template]);
  const parameters = template.manifest.spec.parameters;
  const availableAgentsQuery = useAgentsQuery();
  const availableAgentNames = useMemo(() => (
    new Set((availableAgentsQuery.data?.agents || []).map((agent) => agent.name))
  ), [availableAgentsQuery.data?.agents]);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedNodes(nodes.length > 0 ? { '0': true } : {});
  }, [nodes]);

  const toggleNode = (key: string) => {
    setExpandedNodes((current) => ({ ...current, [key]: !current[key] }));
  };

  const agentLink = (agent: string, compact = false) => {
    const known = availableAgentNames.has(agent);
    const loadingAgents = availableAgentsQuery.isLoading || availableAgentsQuery.isFetching;
    const href = `/agents?agent=${encodeURIComponent(agent)}`;
    return (
      <Button
        key={agent}
        size="sm"
        variant="outline"
        className={cn(
          'h-7 max-w-full rounded-full px-2 text-xs',
          !known && !loadingAgents && 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
          compact && 'h-6 px-1.5',
        )}
        asChild
      >
        <Link href={href} target="_blank" rel="noreferrer" title={`在新窗口查看 Agent：${agent}`}>
          <span className="min-w-0 truncate">{agent}</span>
          <ExternalLink className="ml-1 h-3 w-3 shrink-0" />
        </Link>
      </Button>
    );
  };

  const header = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {sourceBadge(template)}
        <Badge variant="outline">v{template.version}</Badge>
        <Badge variant="outline">状态机</Badge>
        {template.versions.length > 1 ? (
          <Select value={template.version} onValueChange={onVersionChange}>
            <SelectTrigger className="h-7 w-[112px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {template.versions.map((version) => <SelectItem key={version} value={version}>v{version}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {embedded ? (
        <>
          <h3 className="pt-2 text-base font-semibold">{template.name}</h3>
          <p className="text-sm text-muted-foreground">{template.description}</p>
        </>
      ) : (
        <>
          <DialogTitle className="pt-2">{template.name}</DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </>
      )}
    </>
  );

  const actions = (
    <>
      <Button type="button" variant="outline" onClick={onClose}>关闭</Button>
      <Button type="button" onClick={onUse}>
        <WandSparkles className="mr-2 h-4 w-4" />使用模板
      </Button>
    </>
  );

  const structurePanel = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">流程结构</h4>
        <span className="text-xs text-muted-foreground">
          {nodes.length} 个状态 · {template.stepCount} 个步骤
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {nodes.map((node, index) => {
          const nodeKey = String(index);
          const expanded = expandedNodes[nodeKey] === true;
          return (
            <div key={`${node.name}-${index}`} className="overflow-hidden rounded-md border bg-card">
              <button
                type="button"
                className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/45"
                onClick={() => toggleNode(nodeKey)}
                aria-expanded={expanded}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium leading-5 text-foreground">{node.name}</span>
                    {node.final ? <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">终止</Badge> : null}
                  </div>
                  <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {node.description || `${node.stepCount} 个步骤`}
                  </div>
                </div>
                {expanded ? (
                  <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>
              {expanded ? (
                <div className="space-y-2 border-t bg-muted/20 px-3 py-3">
                  {node.steps.length > 0 ? node.steps.map((step, stepIndex) => (
                    <div key={`${node.name}-${step.name || stepIndex}`} className="rounded-md border bg-background px-2.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium leading-5 text-foreground">
                            {step.name || `步骤 ${stepIndex + 1}`}
                          </div>
                          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{getStepSummary(step)}</p>
                        </div>
                        {step.agent ? <div className="max-w-[48%] shrink-0">{agentLink(step.agent, true)}</div> : null}
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">暂无步骤</div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
        {nodes.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground sm:col-span-2">
            暂无流程节点
          </div>
        ) : null}
      </div>
    </div>
  );

  const parameterPanel = (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">创建时需要填写</h4>
        <span className="text-xs text-muted-foreground">{parameters.length} 项</span>
      </div>
      <div className="mt-2 space-y-2">
        {parameters.length > 0 ? parameters.map((parameter) => {
          const defaultValue = formatParameterDefault(parameter);
          return (
            <div key={parameter.id} className="rounded-md border bg-muted/10 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium leading-5 text-foreground">{parameter.label}</div>
                {parameter.description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{parameter.description}</p> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {parameterMetaItem('类型', PARAMETER_TYPE_LABELS[parameter.type])}
                {parameterMetaItem('要求', parameter.required ? '必填' : '选填', parameter.required)}
              </div>
              {parameter.type === 'enum' && parameter.options?.length ? (
                <div className="mt-2 flex min-w-0 items-start gap-2 text-xs">
                  <span className="shrink-0 leading-6 text-muted-foreground">可选值</span>
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {parameter.options.slice(0, 4).map((option) => (
                      <span key={option.value} className="rounded-md bg-muted px-2 py-1 text-[11px] leading-none text-foreground">{option.label}</span>
                    ))}
                    {parameter.options.length > 4 ? <span className="rounded-md bg-muted px-2 py-1 text-[11px] leading-none text-muted-foreground">+{parameter.options.length - 4}</span> : null}
                  </div>
                </div>
              ) : null}
              {defaultValue !== null ? (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>默认值</span>
                  <span className="font-medium text-foreground">{defaultValue}</span>
                </div>
              ) : null}
            </div>
          );
        }) : (
          <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">创建时无需额外填写</div>
        )}
      </div>
    </div>
  );

  const dependencyPanel = (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      {parameterPanel}
      <div>
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-medium">Agent 依赖</h4>
          <span className="text-xs text-muted-foreground">{template.dependencies.agents.length} 个</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {template.dependencies.agents.length > 0 ? template.dependencies.agents.map((agent) => agentLink(agent)) : (
            <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">无 Agent 依赖</div>
          )}
        </div>
        {template.dependencies.agents.some((agent) => !availableAgentNames.has(agent)) && !availableAgentsQuery.isLoading ? (
          <div className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-400">浅黄色项表示当前环境未找到同名 Agent。</div>
        ) : null}
      </div>
      {template.preCommandCount > 0 ? (
        <div className="flex gap-2 text-xs text-amber-700 dark:text-amber-400 sm:col-span-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          包含 {template.preCommandCount} 条预命令
        </div>
      ) : null}
    </div>
  );

  return (
    <div className={cn('space-y-5', embedded && 'rounded-lg border bg-background p-4')}>
      {embedded ? <div>{header}</div> : <DialogHeader>{header}</DialogHeader>}
      <div className="space-y-5">
        {structurePanel}
        {dependencyPanel}
      </div>
      {embedded ? (
        <div className="flex justify-end gap-2 border-t pt-4">{actions}</div>
      ) : (
        <DialogFooter>{actions}</DialogFooter>
      )}
    </div>
  );
}

function WorkflowTemplateInstantiateForm({
  template,
  embedded,
  onCancel,
  onInstantiated,
}: {
  template: WorkflowTemplateDetail;
  embedded: boolean;
  onCancel: () => void;
  onInstantiated: (filename: string) => void;
}) {
  const { toast } = useToast();
  const [filename, setFilename] = useState('');
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [agentMappings, setAgentMappings] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const agentsQuery = useAgentsQuery();
  const instantiateMutation = useInstantiateWorkflowTemplateMutation();
  const availableAgents = agentsQuery.data?.agents || [];
  const availableAgentNames = useMemo(() => new Set(availableAgents.map((agent) => agent.name)), [availableAgents]);
  const missingAgents = useMemo(() => (
    template.manifest.spec.dependencies.agents.filter((name) => !availableAgentNames.has(name))
  ), [availableAgentNames, template]);
  const supervisorAgent = String((template.workflow?.workflow as any)?.supervisor?.agent || '');
  const getReplacementAgents = (missingAgent: string) => availableAgents.filter((agent) => (
    missingAgent === supervisorAgent ? agent.roleType === 'supervisor' : agent.roleType !== 'supervisor'
  ));

  useEffect(() => {
    setFilename(`${template.id}.yaml`);
    setValues(initializeValues(template));
    setAgentMappings({});
    setSubmitError('');
  }, [template]);

  const handleInstantiate = async () => {
    setSubmitError('');
    try {
      const result = await instantiateMutation.mutateAsync({
        source: template.source,
        id: template.id,
        version: template.version,
        filename,
        values,
        agentMappings,
      });
      toast('success', `已从模板创建 ${result.filename}`);
      onInstantiated(result.filename);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '模板实例化失败');
    }
  };

  const actions = (
    <>
      <Button type="button" variant="outline" disabled={instantiateMutation.isPending} onClick={onCancel}>取消</Button>
      <Button
        type="button"
        disabled={instantiateMutation.isPending || missingAgents.some((agent) => !agentMappings[agent])}
        onClick={() => void handleInstantiate()}
      >
        {instantiateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-2 h-4 w-4" />}
        创建工作流
      </Button>
    </>
  );

  return (
    <div className={cn('space-y-4', embedded && 'rounded-lg border bg-background p-4')}>
      {embedded ? (
        <div className="space-y-1">
          <h3 className="text-base font-semibold">从模板新建工作流</h3>
          <p className="text-sm text-muted-foreground">{template.name} · v{template.version}</p>
        </div>
      ) : (
        <DialogHeader>
          <DialogTitle>从模板新建工作流</DialogTitle>
          <DialogDescription>{template.name} · v{template.version}</DialogDescription>
        </DialogHeader>
      )}
      <div className="space-y-2">
        <Label htmlFor="template-instance-filename">配置文件名</Label>
        <Input id="template-instance-filename" value={filename} onChange={(event) => setFilename(event.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {template.manifest.spec.parameters.map((parameter) => (
          <div key={parameter.id} className={parameter.type === 'text' || parameter.type === 'directory' ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
            <Label htmlFor={`template-param-${parameter.id}`}>
              {parameter.label}{parameter.required ? <span className="ml-1 text-destructive">*</span> : null}
            </Label>
            <ParameterField
              parameter={parameter}
              value={values[parameter.id]}
              onChange={(value) => setValues((current) => ({ ...current, [parameter.id]: value }))}
            />
            {parameter.description ? <p className="text-xs text-muted-foreground">{parameter.description}</p> : null}
          </div>
        ))}
      </div>
      {missingAgents.length > 0 ? (
        <div className="space-y-3 border-t pt-4">
          <div>
            <h4 className="text-sm font-medium">替换缺失 Agent</h4>
            <p className="mt-1 text-xs text-muted-foreground">{missingAgents.join('、')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {missingAgents.map((missingAgent) => (
              <div key={missingAgent} className="space-y-1.5">
                <Label>{missingAgent}</Label>
                <Select
                  value={agentMappings[missingAgent] || ''}
                  onValueChange={(value) => setAgentMappings((current) => ({ ...current, [missingAgent]: value }))}
                >
                  <SelectTrigger><SelectValue placeholder="选择替代 Agent" /></SelectTrigger>
                  <SelectContent>
                    {getReplacementAgents(missingAgent).map((agent) => <SelectItem key={agent.name} value={agent.name}>{agent.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {submitError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}
      {embedded ? (
        <div className="flex justify-end gap-2 border-t pt-4">{actions}</div>
      ) : (
        <DialogFooter>{actions}</DialogFooter>
      )}
    </div>
  );
}

export default function WorkflowTemplateBrowser({
  onInstantiated,
  variant = 'standalone',
  className,
}: WorkflowTemplateBrowserProps) {
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('all');
  const [source, setSource] = useState('all');
  const [selectedIdentity, setSelectedIdentity] = useState<TemplateIdentity | null>(null);
  const [instantiateTemplate, setInstantiateTemplate] = useState<WorkflowTemplateDetail | null>(null);
  const templatesQuery = useWorkflowTemplatesQuery({ keyword, category, mode: 'state-machine', source });
  const detailQuery = useWorkflowTemplateDetailQuery(selectedIdentity);
  const templates = templatesQuery.data?.templates || [];
  const selectedTemplate = detailQuery.data?.template;
  const embedded = variant === 'embedded';
  const hasActiveTemplatePane = Boolean(selectedIdentity || instantiateTemplate);

  const handleTemplateInstantiated = (filename: string) => {
    setInstantiateTemplate(null);
    setSelectedIdentity(null);
    onInstantiated(filename);
  };

  const openInstantiate = (template: WorkflowTemplateDetail) => {
    setSelectedIdentity(null);
    setInstantiateTemplate(template);
  };

  const handleVersionChange = (version: string) => {
    if (!selectedTemplate) return;
    setSelectedIdentity({
      source: selectedTemplate.source,
      id: selectedTemplate.id,
      version,
    });
  };

  const listContent = templatesQuery.isLoading ? (
    <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载模板...
    </div>
  ) : templates.length === 0 ? (
    <div className="flex min-h-56 flex-col items-center justify-center border border-dashed text-center">
      <PackageOpen className="mb-3 h-10 w-10 text-muted-foreground/50" />
      <div className="font-medium">没有匹配的模板</div>
      <div className="mt-1 text-sm text-muted-foreground">调整筛选条件，或从工作流菜单另存模板。</div>
    </div>
  ) : (
    <div className={cn(
      'grid gap-3',
      embedded ? 'md:grid-cols-2 lg:grid-cols-1' : 'md:grid-cols-2 xl:grid-cols-3',
    )}>
      {templates.map((template) => (
        <article
          key={`${template.source}:${template.id}`}
          className={cn('flex flex-col border bg-card p-4', embedded ? 'min-h-[198px]' : 'min-h-[238px]')}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {sourceBadge(template)}
                <Badge variant="outline">v{template.version}</Badge>
              </div>
              <h3 className="mt-3 truncate text-base font-semibold">{template.name}</h3>
            </div>
            <LayoutTemplate className="h-5 w-5 shrink-0 text-primary" />
          </div>
          <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{template.description}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center"><GitBranch className="mr-1 h-3.5 w-3.5" />状态机</span>
            <span className="inline-flex items-center"><Layers3 className="mr-1 h-3.5 w-3.5" />{template.stateCount} 个状态</span>
            <span className="inline-flex items-center"><Boxes className="mr-1 h-3.5 w-3.5" />{template.stepCount} 个步骤</span>
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3">
            <span className="truncate text-xs text-muted-foreground">{template.category}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setSelectedIdentity(template)}>
              查看模板<ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </article>
      ))}
    </div>
  );

  const embeddedDetail = instantiateTemplate ? (
    <WorkflowTemplateInstantiateForm
      template={instantiateTemplate}
      embedded
      onCancel={() => setInstantiateTemplate(null)}
      onInstantiated={handleTemplateInstantiated}
    />
  ) : selectedIdentity ? (
    detailQuery.isError ? (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>模板详情加载失败</AlertTitle>
        <AlertDescription>{detailQuery.error instanceof Error ? detailQuery.error.message : '请稍后重试'}</AlertDescription>
      </Alert>
    ) : detailQuery.isLoading || !selectedTemplate ? (
      <div className="flex min-h-56 items-center justify-center rounded-lg border text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载模板详情...
      </div>
    ) : (
      <WorkflowTemplateDetailPanel
        template={selectedTemplate}
        embedded
        onClose={() => setSelectedIdentity(null)}
        onUse={() => openInstantiate(selectedTemplate)}
        onVersionChange={handleVersionChange}
      />
    )
  ) : (
    <div className="flex min-h-56 flex-col justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
      <LayoutTemplate className="mb-3 h-8 w-8 text-muted-foreground/60" />
      <div className="font-medium text-foreground">选择一个模板</div>
      <div className="mt-1 leading-5">查看流程结构、创建输入和 Agent 依赖后再创建独立工作流配置。</div>
    </div>
  );

  return (
    <section className={cn('space-y-4', className)}>
      <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索模板..."
            aria-label="搜索模板"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-[140px]"><SelectValue placeholder="全部分类" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {templatesQuery.data?.categories?.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-full sm:w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部来源</SelectItem>
              <SelectItem value="builtin">内置</SelectItem>
              <SelectItem value="local">本地</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="icon" onClick={() => void templatesQuery.refetch()} title="刷新模板">
            <RefreshCw className={templatesQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>
      </div>

      {templatesQuery.data?.issues?.length ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>部分模板包不可用</AlertTitle>
          <AlertDescription>{templatesQuery.data.issues.length} 个模板包未通过校验。</AlertDescription>
        </Alert>
      ) : null}

      {embedded ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <div className="min-w-0">{listContent}</div>
          <aside className={cn('min-w-0', hasActiveTemplatePane ? 'order-first xl:order-none' : 'order-last xl:order-none')}>
            {embeddedDetail}
          </aside>
        </div>
      ) : (
        listContent
      )}

      {!embedded ? (
        <>
          <Dialog open={Boolean(selectedIdentity)} onOpenChange={(open) => { if (!open) setSelectedIdentity(null); }}>
            <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
              {detailQuery.isError ? (
                <>
                  <DialogHeader className="sr-only">
                    <DialogTitle>模板详情</DialogTitle>
                    <DialogDescription>模板详情加载失败</DialogDescription>
                  </DialogHeader>
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>模板详情加载失败</AlertTitle>
                    <AlertDescription>{detailQuery.error instanceof Error ? detailQuery.error.message : '请稍后重试'}</AlertDescription>
                  </Alert>
                </>
              ) : detailQuery.isLoading || !selectedTemplate ? (
                <>
                  <DialogHeader className="sr-only">
                    <DialogTitle>模板详情</DialogTitle>
                    <DialogDescription>正在加载模板详情</DialogDescription>
                  </DialogHeader>
                  <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载模板详情...
                  </div>
                </>
              ) : (
                <WorkflowTemplateDetailPanel
                  template={selectedTemplate}
                  embedded={false}
                  onClose={() => setSelectedIdentity(null)}
                  onUse={() => openInstantiate(selectedTemplate)}
                  onVersionChange={handleVersionChange}
                />
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={Boolean(instantiateTemplate)} onOpenChange={(open) => { if (!open) setInstantiateTemplate(null); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              {instantiateTemplate ? (
                <WorkflowTemplateInstantiateForm
                  template={instantiateTemplate}
                  embedded={false}
                  onCancel={() => setInstantiateTemplate(null)}
                  onInstantiated={handleTemplateInstantiated}
                />
              ) : null}
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </section>
  );
}
