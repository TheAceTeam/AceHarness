'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
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
import type { WorkflowTemplateDetail, WorkflowTemplateParameter, WorkflowTemplateSummary } from '@/lib/workflow-template/types';

type TemplateIdentity = Pick<WorkflowTemplateSummary, 'source' | 'id' | 'version'>;

export interface WorkflowTemplatesPanelProps {
  onInstantiated: (filename: string) => void;
}

function modeLabel(mode: WorkflowTemplateSummary['mode']) {
  return mode === 'state-machine' ? '状态机' : '阶段模式';
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

function getWorkflowNodes(template: WorkflowTemplateDetail) {
  const workflow = template.workflow?.workflow as Record<string, any> | undefined;
  if (Array.isArray(workflow?.states)) {
    return workflow.states.map((state: any) => ({
      name: state.name,
      description: state.description,
      stepCount: Array.isArray(state.steps) ? state.steps.length : 0,
      final: state.isFinal === true,
    }));
  }
  return (Array.isArray(workflow?.phases) ? workflow.phases : []).map((phase: any) => ({
    name: phase.name,
    description: phase.description,
    stepCount: Array.isArray(phase.steps) ? phase.steps.length : 0,
    final: false,
  }));
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

export default function WorkflowTemplatesPanel({ onInstantiated }: WorkflowTemplatesPanelProps) {
  const { toast } = useToast();
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('all');
  const [mode, setMode] = useState('all');
  const [source, setSource] = useState('all');
  const [selectedIdentity, setSelectedIdentity] = useState<TemplateIdentity | null>(null);
  const [instantiateTemplate, setInstantiateTemplate] = useState<WorkflowTemplateDetail | null>(null);
  const [filename, setFilename] = useState('');
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [agentMappings, setAgentMappings] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const templatesQuery = useWorkflowTemplatesQuery({ keyword, category, mode, source });
  const detailQuery = useWorkflowTemplateDetailQuery(selectedIdentity);
  const agentsQuery = useAgentsQuery();
  const instantiateMutation = useInstantiateWorkflowTemplateMutation();
  const templates = templatesQuery.data?.templates || [];
  const selectedTemplate = detailQuery.data?.template;
  const availableAgents = agentsQuery.data?.agents || [];
  const availableAgentNames = useMemo(() => new Set(availableAgents.map((agent) => agent.name)), [availableAgents]);
  const missingAgents = useMemo(() => (
    instantiateTemplate?.manifest.spec.dependencies.agents.filter((name) => !availableAgentNames.has(name)) || []
  ), [availableAgentNames, instantiateTemplate]);
  const supervisorAgent = String((instantiateTemplate?.workflow?.workflow as any)?.supervisor?.agent || '');
  const getReplacementAgents = (missingAgent: string) => availableAgents.filter((agent) => (
    missingAgent === supervisorAgent ? agent.roleType === 'supervisor' : agent.roleType !== 'supervisor'
  ));

  useEffect(() => {
    if (!instantiateTemplate) return;
    setFilename(`${instantiateTemplate.id}.yaml`);
    setValues(initializeValues(instantiateTemplate));
    setAgentMappings({});
    setSubmitError('');
  }, [instantiateTemplate]);

  const openInstantiate = (template: WorkflowTemplateDetail) => {
    setSelectedIdentity(null);
    setInstantiateTemplate(template);
  };

  const handleInstantiate = async () => {
    if (!instantiateTemplate) return;
    setSubmitError('');
    try {
      const result = await instantiateMutation.mutateAsync({
        source: instantiateTemplate.source,
        id: instantiateTemplate.id,
        version: instantiateTemplate.version,
        filename,
        values,
        agentMappings,
      });
      toast('success', `已从模板创建 ${result.filename}`);
      setInstantiateTemplate(null);
      setSelectedIdentity(null);
      onInstantiated(result.filename);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '模板实例化失败');
    }
  };

  return (
    <section className="space-y-4">
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
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="w-full sm:w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模式</SelectItem>
              <SelectItem value="state-machine">状态机</SelectItem>
              <SelectItem value="phase-based">阶段模式</SelectItem>
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
          <Button variant="outline" size="icon" onClick={() => void templatesQuery.refetch()} title="刷新模板">
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

      {templatesQuery.isLoading ? (
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <article key={`${template.source}:${template.id}`} className="flex min-h-[238px] flex-col border bg-card p-4">
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
                <span className="inline-flex items-center"><GitBranch className="mr-1 h-3.5 w-3.5" />{modeLabel(template.mode)}</span>
                <span className="inline-flex items-center"><Layers3 className="mr-1 h-3.5 w-3.5" />{template.stateCount || template.phaseCount} 个{template.mode === 'state-machine' ? '状态' : '阶段'}</span>
                <span className="inline-flex items-center"><Boxes className="mr-1 h-3.5 w-3.5" />{template.stepCount} 个步骤</span>
              </div>
              <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3">
                <span className="truncate text-xs text-muted-foreground">{template.category}</span>
                <Button size="sm" variant="outline" onClick={() => setSelectedIdentity(template)}>
                  查看模板<ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={Boolean(selectedIdentity)} onOpenChange={(open) => { if (!open) setSelectedIdentity(null); }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
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
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  {sourceBadge(selectedTemplate)}
                  <Badge variant="outline">v{selectedTemplate.version}</Badge>
                  <Badge variant="outline">{modeLabel(selectedTemplate.mode)}</Badge>
                  {selectedTemplate.versions.length > 1 ? (
                    <Select
                      value={selectedTemplate.version}
                      onValueChange={(version) => setSelectedIdentity({
                        source: selectedTemplate.source,
                        id: selectedTemplate.id,
                        version,
                      })}
                    >
                      <SelectTrigger className="h-7 w-[112px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {selectedTemplate.versions.map((version) => <SelectItem key={version} value={version}>v{version}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
                <DialogTitle className="pt-2">{selectedTemplate.name}</DialogTitle>
                <DialogDescription>{selectedTemplate.description}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                  <h4 className="mb-2 text-sm font-medium">流程结构</h4>
                  <div className="border">
                    {getWorkflowNodes(selectedTemplate).map((node, index, nodes) => (
                      <div key={`${node.name}-${index}`} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{index + 1}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{node.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{node.stepCount} 个步骤{node.final ? ' · 终止状态' : ''}</div>
                        </div>
                        {index < nodes.length - 1 ? <ArrowRight className="h-4 w-4 text-muted-foreground" /> : null}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-4 border-l pl-4">
                  <div>
                    <h4 className="text-sm font-medium">参数</h4>
                    <div className="mt-1 text-sm text-muted-foreground">{selectedTemplate.parameterCount} 项</div>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium">Agent 依赖</h4>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedTemplate.dependencies.agents.map((agent) => <Badge key={agent} variant="outline">{agent}</Badge>)}
                    </div>
                  </div>
                  {selectedTemplate.preCommandCount > 0 ? (
                    <div className="flex gap-2 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      包含 {selectedTemplate.preCommandCount} 条预命令
                    </div>
                  ) : null}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedIdentity(null)}>关闭</Button>
                <Button onClick={() => openInstantiate(selectedTemplate)}>
                  <WandSparkles className="mr-2 h-4 w-4" />使用模板
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(instantiateTemplate)} onOpenChange={(open) => { if (!open && !instantiateMutation.isPending) setInstantiateTemplate(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>从模板新建工作流</DialogTitle>
            <DialogDescription>{instantiateTemplate?.name} · v{instantiateTemplate?.version}</DialogDescription>
          </DialogHeader>
          {instantiateTemplate ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="template-instance-filename">配置文件名</Label>
                <Input id="template-instance-filename" value={filename} onChange={(event) => setFilename(event.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {instantiateTemplate.manifest.spec.parameters.map((parameter) => (
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
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={instantiateMutation.isPending} onClick={() => setInstantiateTemplate(null)}>取消</Button>
            <Button disabled={instantiateMutation.isPending || missingAgents.some((agent) => !agentMappings[agent])} onClick={() => void handleInstantiate()}>
              {instantiateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-2 h-4 w-4" />}
              创建工作流
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
