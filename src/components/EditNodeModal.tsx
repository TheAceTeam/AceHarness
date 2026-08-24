'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { SingleCombobox, MultiCombobox, ComboboxPortalProvider } from '@/components/ui/combobox';
import SpriteAvatar from '@/components/SpriteAvatar';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import { useAgentsQuery } from '@/client/query/agents';
import { useConfigOptionsQuery } from '@/client/query/configs';
import { useSkillsQuery } from '@/client/query/skills';
import { isWorkflowStepSelectableAgent } from '@/lib/agent/catalog';

const stepSchema = z.object({
  type: z.enum(['agent', 'subworkflow']).optional(),
  name: z.string().min(1, '步骤名称不能为空'),
  agent: z.string().optional(),
  task: z.string().optional(),
  workflow: z.string().optional(),
  subworkflowRequirements: z.string().optional(),
  inputWorkspace: z.enum(['inherit', 'child-isolated-copy', 'config']).optional(),
  inputContext: z.enum(['inherit', 'none', 'custom']).optional(),
  inputSkills: z.enum(['inherit', 'merge', 'child-only', 'parent-only']).optional(),
  inputMcpServers: z.enum(['inherit', 'merge', 'child-only', 'parent-only']).optional(),
  inputRag: z.enum(['inherit', 'merge', 'child-only', 'parent-only']).optional(),
  inputEngine: z.enum(['inherit', 'child', 'override']).optional(),
  constraints: z.string().optional(),
  preCommands: z.string().optional(),
  enableReviewPanel: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
  ragKnowledgeBases: z.array(z.string()).optional(),
  specTaskId: z.string().optional(),
  requirementIds: z.string().optional(),
  artifactKeys: z.string().optional(),
}).superRefine((step, ctx) => {
  if (step.type === 'subworkflow') {
    if (!step.workflow?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['workflow'], message: '子工作流配置不能为空' });
    }
    return;
  }
  if (!step.agent?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['agent'], message: 'Agent 名称不能为空' });
  }
  if (!step.task?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['task'], message: '任务描述不能为空' });
  }
});

type StepForm = z.infer<typeof stepSchema>;

const listToInput = (value: unknown) => Array.isArray(value) ? value.join(', ') : '';
const inputToList = (value: unknown) => typeof value === 'string'
  ? value.split(',').map((item) => item.trim()).filter(Boolean)
  : [];
const linesToList = (value: unknown) => typeof value === 'string'
  ? value.split('\n').map((item) => item.trim()).filter(Boolean)
  : [];
const cleanString = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const normalizeSkillNames = (value: unknown) => Array.from(new Set(
  (Array.isArray(value) ? value : [])
    .filter((skill): skill is string => typeof skill === 'string')
    .map((skill) => skill.trim())
    .filter(Boolean),
));
const normalizeMcpServerNames = (value: unknown) => Array.from(new Set(
  (Array.isArray(value) ? value : [])
    .map((server) => typeof server === 'string' ? server : (server as any)?.name)
    .filter((server): server is string => typeof server === 'string')
    .map((server) => server.trim())
    .filter(Boolean),
));

export type StepCapabilitySources = {
  step: string[];
  agent: string[];
  workflow: string[];
  effective: string[];
};

export function getStepCapabilitySources(input: {
  step?: unknown;
  agent?: unknown;
  workflow?: unknown;
}): StepCapabilitySources {
  const step = normalizeMcpServerNames(input.step);
  const agent = normalizeMcpServerNames(input.agent);
  const workflow = normalizeMcpServerNames(input.workflow);
  return { step, agent, workflow, effective: Array.from(new Set([...workflow, ...agent, ...step])) };
}

interface RoleOption {
  name: string;
  team: string;
  roleType?: 'normal' | 'supervisor';
  catalogVisibility?: 'default' | 'optional' | 'system';
  avatar?: any;
  category?: string;
  tags?: string[];
  description?: string;
  capabilities?: string[];
  skills?: string[];
  mcpServers?: string[];
  ragKnowledgeBases?: string[];
  alwaysAvailableForChat?: boolean;
}

interface SkillOption {
  name: string;
  description: string;
  tags?: string[];
}

interface SpecTaskOption {
  id: string;
  title: string;
  phaseTitle?: string;
  ownerAgents?: string[];
}

interface KnowledgeBaseOption {
  id: string;
  name: string;
  description?: string;
  chunkCount?: number;
}

interface McpServerOption {
  name: string;
  command?: string;
}

interface WorkflowOption {
  filename: string;
  name: string;
  description?: string;
  mode?: 'lightweight' | 'state-machine';
  kind?: 'lightweight' | 'state-machine';
  profile?: 'lightweight';
  stateCount?: number;
  stepCount?: number;
}

function isLightweightWorkflowOption(workflow: WorkflowOption) {
  return workflow.mode === 'lightweight'
    || workflow.kind === 'lightweight'
    || workflow.profile === 'lightweight';
}

function getAgentTeamTone(team?: string) {
  if (team === 'red') {
    return {
      option: 'my-0.5 border border-red-500/10 bg-red-500/10 data-[highlighted]:bg-red-500/20',
      chip: 'border-red-500/30 bg-red-500/12 text-red-700 dark:text-red-200',
      avatar: 'ring-red-400/40',
    };
  }
  if (team === 'judge') {
    return {
      option: 'my-0.5 border border-amber-500/10 bg-amber-500/10 data-[highlighted]:bg-amber-500/20',
      chip: 'border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-200',
      avatar: 'ring-amber-400/40',
    };
  }
  if (team === 'black-gold') {
    return {
      option: 'my-0.5 border border-yellow-500/10 bg-yellow-500/10 data-[highlighted]:bg-yellow-500/20',
      chip: 'border-yellow-500/30 bg-yellow-500/12 text-yellow-700 dark:text-yellow-200',
      avatar: 'ring-yellow-400/40',
    };
  }
  return {
    option: 'my-0.5 border border-blue-500/10 bg-blue-500/10 data-[highlighted]:bg-blue-500/20',
    chip: 'border-blue-500/30 bg-blue-500/12 text-blue-700 dark:text-blue-200',
    avatar: 'ring-blue-400/40',
  };
}

function AgentAvatar({
  role,
  className = 'h-6 w-6',
}: {
  role?: RoleOption;
  className?: string;
}) {
  const name = role?.name || 'Agent';
  const tone = getAgentTeamTone(role?.team);
  const avatarSrc = resolveAgentAvatarSrc(role?.avatar, name, {
    team: role?.team as any,
    roleType: role?.roleType,
  });
  return (
    <SpriteAvatar
      avatar={avatarSrc}
      seed={name}
      category="agent-default"
      alt={name}
      fallback={name.charAt(0).toUpperCase()}
      className={`${className} shrink-0 ring-2 ${tone.avatar}`}
      fallbackClassName="bg-primary/10 text-[10px] font-semibold text-primary"
    />
  );
}

function AgentOptionContent({ role }: { role?: RoleOption }) {
  if (!role) return null;
  const tone = getAgentTeamTone(role.team);
  const meta = [role.category, role.team, ...(role.tags || []).slice(0, 2)].filter(Boolean).join(' · ');
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <AgentAvatar role={role} className="h-7 w-7" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{role.name}</span>
          {role.roleType === 'supervisor' ? (
            <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${tone.chip}`}>Supervisor</Badge>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">{role.description || meta || '暂无描述'}</div>
      </div>
    </div>
  );
}

function AgentSelectedContent({ role, fallbackName }: { role?: RoleOption; fallbackName?: string }) {
  const name = role?.name || fallbackName || '';
  if (!name) return null;
  const tone = getAgentTeamTone(role?.team);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <AgentAvatar role={role || { name, team: 'blue' }} className="h-5 w-5" />
      <span className="truncate">{name}</span>
      {role?.team ? (
        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${tone.chip}`}>
          {role.team}
        </span>
      ) : null}
    </span>
  );
}

function CapabilitySourceSummary({
  title,
  sources,
  stepEmptyText,
  registryUnavailable = false,
}: {
  title: string;
  sources: StepCapabilitySources;
  stepEmptyText: string;
  registryUnavailable?: boolean;
}) {
  const rows = [
    { label: '步骤专属', values: sources.step, tone: 'bg-primary/10 text-primary' },
    { label: 'Agent 继承', values: sources.agent, tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300' },
    { label: '工作流继承', values: sources.workflow, tone: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  ];
  return (
    <section className="rounded-xl border border-border/70 bg-muted/20 p-3" aria-label={`${title}能力来源`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">有效 {title}</div>
        <span className="text-[11px] text-muted-foreground">运行时合并 {sources.effective.length} 项</span>
      </div>
      <div className="mt-2 space-y-2 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={`border-0 text-[10px] ${row.tone}`}>{row.label}</Badge>
            {row.values.length ? row.values.map((value) => (
              <Badge key={`${row.label}-${value}`} variant="secondary" className="text-[10px] font-normal">{value}</Badge>
            )) : row.label === '步骤专属' ? (
              <span className="text-muted-foreground">{stepEmptyText}</span>
            ) : (
              <span className="text-muted-foreground">未配置</span>
            )}
          </div>
        ))}
      </div>
      {registryUnavailable ? (
        <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
          注册表未加载，以上已绑定名称会保留；运行前需校验。
        </p>
      ) : null}
    </section>
  );
}

interface EditNodeModalProps {
  [key: string]: unknown;
  isOpen: boolean;
  data: any;
  roles?: RoleOption[];
  availableSkills?: SkillOption[];
  availableMcpServers?: McpServerOption[];
  mcpRegistryStatus?: 'loading' | 'ready' | 'unavailable';
  availableKnowledgeBases?: KnowledgeBaseOption[];
  workflowSkills?: string[];
  workflowMcpServers?: string[];
  isNew?: boolean;
  type: string;
  existingSteps?: any[];
  specTasks?: SpecTaskOption[];
  initialSection?: 'spec';
  onClose: () => void;
  onSave: (data: any) => void;
  onAgentMcpServersChange?: (agentName: string, servers: string[]) => void | Promise<void>;
  onAgentRagKnowledgeBasesChange?: (agentName: string, knowledgeBases: string[]) => void | Promise<void>;
  onDelete?: () => void;
}

export default function EditNodeModal({
  isOpen,
  data,
  roles = [],
  availableSkills = [],
  availableMcpServers = [],
  mcpRegistryStatus = 'ready',
  availableKnowledgeBases = [],
  workflowSkills = [],
  workflowMcpServers = [],
  isNew = false,
  existingSteps = [],
  specTasks = [],
  initialSection,
  onClose,
  onSave,
  onAgentMcpServersChange,
  onAgentRagKnowledgeBasesChange,
  onDelete,
}: EditNodeModalProps) {
  const [showAdvancedBindings, setShowAdvancedBindings] = useState(initialSection === 'spec');
  const agentsQuery = useAgentsQuery();
  const skillsQuery = useSkillsQuery({ enabled: isOpen });
  const workflowOptionsQuery = useConfigOptionsQuery({ mode: 'state-machine', sortKey: 'name', sortDirection: 'asc' });
  const queryRoles = (agentsQuery.data?.agents || []) as RoleOption[];
  const effectiveRoles = (roles.length > 0 ? roles : queryRoles)
    .filter(isWorkflowStepSelectableAgent);
  const querySkills = (skillsQuery.data?.skills || []) as SkillOption[];
  const effectiveSkills = availableSkills.length > 0 ? availableSkills : querySkills;
  const initialAgent = effectiveRoles.find((role) => role.name === data?.agent);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
    setValue,
    reset,
  } = useForm<StepForm>({
    resolver: zodResolver(stepSchema),
    defaultValues: {
      type: data?.type === 'subworkflow' ? 'subworkflow' : 'agent',
      name: data?.name || '',
      agent: data?.agent || '',
      task: data?.task || '',
      workflow: data?.workflow || data?.subworkflow?.configFile || '',
      subworkflowRequirements: typeof data?.inputs?.requirements === 'string' && data.inputs.requirements !== 'inherit'
        ? data.inputs.requirements
        : '',
      inputWorkspace: data?.inputs?.workspace || 'inherit',
      inputContext: data?.inputs?.context || 'inherit',
      inputSkills: data?.inputs?.skills || 'merge',
      inputMcpServers: data?.inputs?.mcpServers || 'merge',
      inputRag: data?.inputs?.rag || 'merge',
      inputEngine: data?.inputs?.engine || 'child',
      constraints: Array.isArray(data?.constraints) ? data.constraints.join('\n') : (data?.constraints || ''),
      preCommands: Array.isArray(data?.preCommands) ? data.preCommands.join('\n') : '',
      enableReviewPanel: data?.enableReviewPanel || false,
      skills: Array.isArray(data?.skills) ? data.skills : [],
      mcpServers: Array.isArray(initialAgent?.mcpServers)
        ? initialAgent?.mcpServers
        : (Array.isArray(data?.mcpServers) ? data.mcpServers : []),
      ragKnowledgeBases: Array.isArray(initialAgent?.ragKnowledgeBases)
        ? initialAgent?.ragKnowledgeBases
        : (Array.isArray(data?.ragKnowledgeBases) ? data.ragKnowledgeBases : []),
      specTaskId: [
        ...((data?.specTaskBinding?.taskIds || []) as string[]),
        data?.specTaskBinding?.taskId,
      ].filter(Boolean).join(', '),
      requirementIds: listToInput(data?.specTaskBinding?.requirementIds),
      artifactKeys: listToInput(data?.specTaskBinding?.artifactKeys),
    },
  });

  const stepType = (watch('type') || 'agent') as 'agent' | 'subworkflow';
  const selectedAgentName = (watch('agent') || data?.agent || '') as string;
  const workflowOptions = useMemo(
    () => ((workflowOptionsQuery.data?.configs || []) as WorkflowOption[]),
    [workflowOptionsQuery.data?.configs]
  );
  const workflowOptionsLoading = workflowOptionsQuery.isFetching;
  const workflowOptionsError = workflowOptionsQuery.error instanceof Error ? workflowOptionsQuery.error.message : '';
  const selectedAgent = effectiveRoles.find((role) => role.name === selectedAgentName);
  const selectedSkillNames = Array.isArray(watch('skills')) ? watch('skills') as string[] : [];
  const selectedMcpServers = Array.isArray(watch('mcpServers')) ? watch('mcpServers') as string[] : [];
  const selectedRagKnowledgeBases = Array.isArray(watch('ragKnowledgeBases')) ? watch('ragKnowledgeBases') as string[] : [];
  const [mcpBindingsDirty, setMcpBindingsDirty] = useState(false);
  const agentSkillNames = normalizeSkillNames(selectedAgent?.skills);
  const workflowSkillNames = normalizeSkillNames(workflowSkills);
  const agentMcpServerNames = normalizeMcpServerNames(selectedAgent?.mcpServers);
  const workflowMcpServerNames = normalizeMcpServerNames(workflowMcpServers);
  const skillSources = getStepCapabilitySources({
    step: selectedSkillNames,
    agent: agentSkillNames,
    workflow: workflowSkillNames,
  });
  const mcpSources = getStepCapabilitySources({
    // Agent steps do not persist an MCP field. Keeping this empty makes the
    // summary honest instead of implying that changing the Agent binding is a
    // step-local override.
    step: [],
    // Before the user edits the picker, show the persisted Agent binding. Once
    // it is edited, including an intentional clear, reflect the pending value.
    agent: mcpBindingsDirty ? selectedMcpServers : agentMcpServerNames,
    workflow: workflowMcpServerNames,
  });
  const mcpRegistryAvailable = mcpRegistryStatus === 'ready';
  const handleRagKnowledgeBasesChange = (value: string[]) => {
    setValue('ragKnowledgeBases', value);
    if (value.length > 0 && !selectedSkillNames.includes('aceharness-rag')) {
      setValue('skills', [...selectedSkillNames, 'aceharness-rag']);
    }
  };
  const selectedSpecTaskIds = inputToList(watch('specTaskId'));
  const selectedSpecTaskDetails = useMemo(
    () => specTasks.filter((task) => selectedSpecTaskIds.includes(task.id)),
    [specTasks, selectedSpecTaskIds]
  );
  const agentOptions = effectiveRoles.map((role) => {
    const meta = [role.category, role.team, ...(role.tags || []).slice(0, 2)].filter(Boolean);
    const tone = getAgentTeamTone(role.team);
    return {
      value: role.name,
      label: role.name,
      description: role.description || meta.join(' · '),
      className: tone.option,
    };
  });

  const specTaskOptions = specTasks.map((task) => ({
    value: task.id,
    label: task.id,
    description: [task.title, task.phaseTitle, ...(task.ownerAgents || []).slice(0, 2)].filter(Boolean).join(' · '),
  }));
  const skillOptions = useMemo(() => {
    const byName = new Map<string, SkillOption>();
    for (const skill of effectiveSkills) {
      byName.set(skill.name, skill);
    }
    for (const skillName of selectedSkillNames) {
      if (!byName.has(skillName)) {
        byName.set(skillName, { name: skillName, description: '当前步骤已选择的 Skill' });
      }
    }
    return Array.from(byName.values());
  }, [effectiveSkills, selectedSkillNames]);
  const mcpOptions = useMemo(() => {
    const registry = new Map(availableMcpServers.map((server) => [server.name, server]));
    const names = Array.from(new Set([
      ...availableMcpServers.map((server) => server.name),
      ...agentMcpServerNames,
      ...selectedMcpServers,
      ...workflowMcpServerNames,
    ]));
    return names.map((name) => ({
      value: name,
      label: name,
      description: registry.get(name)?.command || (mcpRegistryAvailable ? '' : '已配置，注册表未加载，运行前需校验'),
    }));
  }, [agentMcpServerNames, availableMcpServers, mcpRegistryAvailable, selectedMcpServers, workflowMcpServerNames]);

  useEffect(() => {
    if (!selectedAgentName) return;
    const agentMcpServers = selectedAgent?.mcpServers;
    const agentRagKnowledgeBases = selectedAgent?.ragKnowledgeBases;
    const preRuntimeStepMcp = selectedAgentName === data?.agent && Array.isArray(data?.mcpServers) ? data.mcpServers : [];
    const preRuntimeStepRag = selectedAgentName === data?.agent && Array.isArray(data?.ragKnowledgeBases) ? data.ragKnowledgeBases : [];
    setValue('mcpServers', Array.isArray(agentMcpServers) ? agentMcpServers.map((server: any) => typeof server === 'string' ? server : server?.name).filter(Boolean) : preRuntimeStepMcp);
    setValue('ragKnowledgeBases', Array.isArray(agentRagKnowledgeBases) ? agentRagKnowledgeBases : preRuntimeStepRag);
    setMcpBindingsDirty(false);
  }, [data?.agent, data?.mcpServers, data?.ragKnowledgeBases, selectedAgent?.mcpServers, selectedAgent?.ragKnowledgeBases, selectedAgentName, setValue]);

  const handleCopyFrom = (sourceName: string) => {
    if (!sourceName) return;
    const source = existingSteps.find((s: any) => s.name === sourceName);
    if (!source) return;
    const sourceRole = effectiveRoles.find((role) => role.name === source.agent);
    reset({
      type: source.type === 'subworkflow' ? 'subworkflow' : 'agent',
      name: source.name + ' (副本)',
      agent: source.agent || '',
      task: source.task || '',
      workflow: source.workflow || source.subworkflow?.configFile || '',
      subworkflowRequirements: typeof source.inputs?.requirements === 'string' && source.inputs.requirements !== 'inherit'
        ? source.inputs.requirements
        : '',
      inputWorkspace: source.inputs?.workspace || 'inherit',
      inputContext: source.inputs?.context || 'inherit',
      inputSkills: source.inputs?.skills || 'merge',
      inputMcpServers: source.inputs?.mcpServers || 'merge',
      inputRag: source.inputs?.rag || 'merge',
      inputEngine: source.inputs?.engine || 'child',
      constraints: Array.isArray(source.constraints) ? source.constraints.join('\n') : (source.constraints || ''),
      preCommands: Array.isArray(source.preCommands) ? source.preCommands.join('\n') : '',
      enableReviewPanel: source.enableReviewPanel || false,
      skills: Array.isArray(source.skills) ? source.skills : [],
      mcpServers: Array.isArray(sourceRole?.mcpServers)
        ? sourceRole.mcpServers.map((server: any) => typeof server === 'string' ? server : server?.name).filter(Boolean)
        : (Array.isArray(source.mcpServers) ? source.mcpServers : []),
      ragKnowledgeBases: Array.isArray(sourceRole?.ragKnowledgeBases)
        ? sourceRole.ragKnowledgeBases
        : (Array.isArray(source.ragKnowledgeBases) ? source.ragKnowledgeBases : []),
      specTaskId: '',
      requirementIds: '',
      artifactKeys: '',
    });
  };

  const onSubmit = async (formData: StepForm) => {
    const stepData: any = { name: formData.name };
    if (formData.type === 'subworkflow') {
      stepData.type = 'subworkflow';
      stepData.workflow = formData.workflow;
      stepData.subworkflow = { configFile: formData.workflow };
      stepData.inputs = {
        requirements: cleanString(formData.subworkflowRequirements) || 'inherit',
        workspace: formData.inputWorkspace || 'inherit',
        context: formData.inputContext || 'inherit',
        skills: formData.inputSkills || 'merge',
        mcpServers: formData.inputMcpServers || 'merge',
        rag: formData.inputRag || 'merge',
        engine: formData.inputEngine || 'child',
      };
    } else {
      stepData.agent = formData.agent;
      stepData.task = formData.task;
      stepData.skills = normalizeSkillNames(formData.skills);
    }
    if (formData.type !== 'subworkflow' && onAgentMcpServersChange && formData.agent) {
      try {
        // A missing registry must not turn an untouched inherited Agent binding
        // into an empty write merely because the picker had no options to show.
        const mcpServersToSave = !mcpRegistryAvailable && !mcpBindingsDirty
          ? agentMcpServerNames
          : normalizeMcpServerNames(formData.mcpServers);
        await onAgentMcpServersChange(formData.agent, mcpServersToSave);
      } catch (error: any) {
        alert(error?.message || '保存 Agent MCP Servers 失败');
        return;
      }
    }
    if (data?.role === 'attacker' || data?.role === 'defender' || data?.role === 'judge') {
      stepData.role = data.role;
    }
    if (formData.type !== 'subworkflow' && formData.constraints) {
      stepData.constraints = formData.constraints
        .split('\n')
        .filter((c: string) => c.trim());
    }
    if (formData.type !== 'subworkflow' && formData.preCommands !== undefined) {
      stepData.preCommands = linesToList(formData.preCommands);
    }
    if (formData.type !== 'subworkflow' && formData.enableReviewPanel !== undefined) {
      stepData.enableReviewPanel = formData.enableReviewPanel;
    }
    if (formData.type !== 'subworkflow' && onAgentRagKnowledgeBasesChange && formData.agent) {
      try {
        await onAgentRagKnowledgeBasesChange(formData.agent, Array.isArray(formData.ragKnowledgeBases) ? formData.ragKnowledgeBases : []);
      } catch (error: any) {
        alert(error?.message || '保存 Agent RAG 知识库失败');
        return;
      }
    }

    if (data?.parallelGroup) stepData.parallelGroup = data.parallelGroup;
    if (data?.concurrency) stepData.concurrency = data.concurrency;
    if (data?.agentInstanceId) stepData.agentInstanceId = data.agentInstanceId;
    if (Array.isArray(data?.channelIds) && data.channelIds.length > 0) stepData.channelIds = data.channelIds;
    const specTaskIds = inputToList(formData.specTaskId);
    stepData.specTaskBinding = specTaskIds.length > 0
      ? {
          taskId: specTaskIds[0],
          taskIds: specTaskIds,
          requirementIds: inputToList(formData.requirementIds),
          artifactKeys: inputToList(formData.artifactKeys),
        }
      : undefined;
    onSave(stepData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl w-[92vw] max-h-[88vh] flex flex-col p-0">
        <ComboboxPortalProvider>
        <div className="flex items-start justify-between gap-4 border-b px-6 py-5 flex-shrink-0">
          <div>
            <DialogTitle className="text-xl">{isNew ? '新建步骤' : '编辑步骤'}</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              调整 Agent、任务描述、约束与 Spec 绑定。保存配置时会统一校验 task 覆盖情况。
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </Button>
        </div>
        <form id="edit-node-form" onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-auto px-6 py-5 space-y-5">
          {isNew && existingSteps.length > 0 && (
            <div className="space-y-2">
              <Label>从现有复制</Label>
              <SingleCombobox
                value=""
                onValueChange={handleCopyFrom}
                options={existingSteps.map((item: any) => ({
                  value: item.name,
                  label: item.name,
                  icon: <span className="material-symbols-outlined text-sm">content_copy</span>,
                }))}
                placeholder="选择要复制的模板..."
                searchable={false}
              />
            </div>
          )}
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.95fr)]">
                <div className="space-y-5">
                  <div className="rounded-2xl border bg-background/70 p-4 space-y-4">
                    <div className="space-y-2">
                      <Label>步骤类型</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { value: 'agent', label: 'Agent 步骤', icon: 'person' },
                          { value: 'subworkflow', label: '子工作流', icon: 'account_tree' },
                        ].map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setValue('type', option.value as any, { shouldDirty: true })}
                            className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                              stepType === option.value
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border bg-background hover:bg-muted/50'
                            }`}
                          >
                            <span className="material-symbols-outlined text-base">{option.icon}</span>
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="name">
                          步骤名称 <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="name"
                          {...register('name')}
                          className={errors.name ? 'border-destructive' : ''}
                        />
                        {errors.name && (
                          <p className="text-sm text-destructive">{errors.name.message as string}</p>
                        )}
                      </div>

                      {stepType === 'agent' ? (
                      <div className="space-y-2">
                        <Label htmlFor="agent">
                          Agent <span className="text-destructive">*</span>
                        </Label>
                        <SingleCombobox
                          value={selectedAgentName}
                          onValueChange={(v) => setValue('agent', v)}
                          options={agentOptions}
                          placeholder="选择 Agent..."
                          triggerClassName={errors.agent ? 'border-destructive' : ''}
                          renderSelected={(option) => (
                            <AgentSelectedContent
                              role={effectiveRoles.find((role) => role.name === option?.value)}
                              fallbackName={option?.label || selectedAgentName}
                            />
                          )}
                          renderOption={(option) => (
                            <AgentOptionContent role={effectiveRoles.find((role) => role.name === option.value)} />
                          )}
                        />
                        {errors.agent && (
                          <p className="text-sm text-destructive">{errors.agent.message as string}</p>
                        )}
                      </div>
                      ) : (
                      <div className="space-y-2">
                        <Label htmlFor="workflow">
                          子工作流配置 <span className="text-destructive">*</span>
                        </Label>
                        <SingleCombobox
                          value={(watch('workflow') || '') as string}
                          onValueChange={(v) => setValue('workflow', v, { shouldDirty: true })}
                          options={workflowOptions.map((workflow) => ({
                            value: workflow.filename,
                            label: isLightweightWorkflowOption(workflow)
                              ? `${workflow.name || workflow.filename}（轻量工作流）`
                              : (workflow.name || workflow.filename),
                            description: [
                              workflow.filename,
                              isLightweightWorkflowOption(workflow) ? '轻量工作流' : '状态机',
                              `${workflow.stateCount ?? 0} 状态`,
                              `${workflow.stepCount || 0} 步骤`,
                              workflow.description,
                            ].filter(Boolean).join(' · '),
                          }))}
                          placeholder={workflowOptionsLoading ? '加载工作流...' : '选择子工作流...'}
                          emptyText={workflowOptionsError || '没有可选子工作流'}
                          triggerClassName={errors.workflow ? 'border-destructive' : ''}
                        />
                        {errors.workflow && (
                          <p className="text-sm text-destructive">{errors.workflow.message as string}</p>
                        )}
                      </div>
                      )}
                    </div>

                    {stepType === 'agent' && selectedAgent ? (
                      <div className="rounded-xl border bg-muted/20 p-4 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {selectedAgent.roleType === 'supervisor' ? <Badge variant="outline" className="text-[10px]">Supervisor</Badge> : null}
                          {selectedAgent.team ? <Badge variant="outline" className="text-[10px]">{selectedAgent.team}</Badge> : null}
                          {selectedAgent.category ? <Badge variant="outline" className="text-[10px]">{selectedAgent.category}</Badge> : null}
                        </div>
                        {selectedAgent.description ? (
                          <p className="mt-2 leading-5 text-muted-foreground">{selectedAgent.description}</p>
                        ) : (
                          <p className="mt-2 leading-5 text-muted-foreground">暂无能力描述，请在 Agent 配置中补充 description。</p>
                        )}
                        {selectedAgent.capabilities?.length ? (
                          <div className="mt-3 flex flex-wrap gap-1">
                            {selectedAgent.capabilities.slice(0, 8).map((capability) => (
                              <Badge key={capability} variant="secondary" className="text-[10px] font-normal">
                                {capability}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {stepType === 'agent' ? (
                    <>
                    <div className="space-y-2">
                      <Label htmlFor="task">
                        任务描述 <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        id="task"
                        rows={7}
                        {...register('task')}
                        className={errors.task ? 'border-destructive' : ''}
                      />
                      {errors.task && (
                        <p className="text-sm text-destructive">{errors.task.message as string}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="constraints">约束条件（每行一条）</Label>
                      <Textarea
                        id="constraints"
                        rows={5}
                        {...register('constraints')}
                        placeholder={"不得修改公共 API 接口\n必须保持向后兼容\n单个文件不超过 500 行"}
                      />
                    </div>
                    </>
                    ) : (
                    <div className="space-y-4 rounded-xl border bg-muted/15 p-4">
                      <div>
                        <div className="text-sm font-semibold">子工作流输入</div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          设置传给子流程的任务说明；留空时继承父工作流 requirements。
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="subworkflowRequirements">任务说明 / Requirements override</Label>
                        <Textarea
                          id="subworkflowRequirements"
                          rows={5}
                          {...register('subworkflowRequirements')}
                          placeholder="留空表示继承父工作流 requirements"
                        />
                      </div>
                    </div>
                    )}

                  </div>
                </div>

                <div className="space-y-5">
                  {stepType === 'agent' ? (
                  <div className="rounded-2xl border bg-background/70 p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="enableReviewPanel">启用专家模式</Label>
                        <p className="text-xs leading-5 text-muted-foreground">
                          启用后将启动多个专家子 Agent 从不同角度进行分析
                        </p>
                      </div>
                      <Switch
                        id="enableReviewPanel"
                        checked={watch('enableReviewPanel') as boolean}
                        onCheckedChange={(v) => setValue('enableReviewPanel', v)}
                      />
                    </div>

                    <div className="space-y-3 border-t border-border/60 pt-4">
                      <div>
                        <div className="text-sm font-semibold">本步骤的能力来源</div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Skills 与 MCP 会按步骤、Agent、工作流三个层级合并；这里展示本步骤实际会继承到的能力。
                        </p>
                      </div>
                      <CapabilitySourceSummary
                        title="Skills"
                        sources={skillSources}
                        stepEmptyText={skillSources.agent.length || skillSources.workflow.length
                          ? '未额外绑定，仍继承下方 Agent / 工作流 Skills'
                          : '未额外绑定'}
                      />
                      <CapabilitySourceSummary
                        title="MCP"
                        sources={mcpSources}
                        stepEmptyText={mcpSources.agent.length || mcpSources.workflow.length
                          ? '未额外绑定，仍继承下方 Agent / 工作流 MCP'
                          : '未额外绑定；当前没有可继承 MCP'}
                        registryUnavailable={!mcpRegistryAvailable}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>步骤专属 Skills</Label>
                      <p className="text-xs leading-5 text-muted-foreground">仅为本步骤新增的 Skills；未选择时仍会继承 Agent 和工作流 Skills。</p>
                      <MultiCombobox
                        value={watch('skills') || []}
                        onValueChange={(v) => setValue('skills', v)}
                        options={skillOptions.map(skill => ({
                          value: skill.name,
                          label: skill.name,
                          description: skill.description,
                        }))}
                        placeholder={skillOptions.length > 0 ? '选择步骤专属 Skills...' : '未额外绑定，仍按上方来源继承'}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Agent MCP 绑定</Label>
                      <p className="text-xs leading-5 text-muted-foreground">
                        该设置属于所选 Agent，保存后写入 Agent 配置；工作流 MCP 会在运行时额外合并。
                      </p>
                      <MultiCombobox
                        value={selectedMcpServers}
                        onValueChange={(v) => {
                          setMcpBindingsDirty(true);
                          setValue('mcpServers', v);
                        }}
                        options={mcpOptions}
                        placeholder={mcpRegistryAvailable
                          ? '选择 Agent MCP Servers...'
                          : '注册表未加载；保留已有绑定，运行前需校验'}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Agent RAG 知识库</Label>
                      <p className="text-xs leading-5 text-muted-foreground">
                        跟随所选 Agent；保存后写入 Agent 配置，运行时会自动授权这些知识库给该 Agent 使用。
                      </p>
                      <MultiCombobox
                        value={selectedRagKnowledgeBases}
                        onValueChange={handleRagKnowledgeBasesChange}
                        options={availableKnowledgeBases.map((kb) => ({
                          value: kb.id,
                          label: kb.name || kb.id,
                          description: [kb.description, `Chunks ${kb.chunkCount ?? 0}`].filter(Boolean).join(' · '),
                        }))}
                        placeholder={availableKnowledgeBases.length > 0 ? '选择 RAG 知识库...' : '当前没有可用 RAG 知识库'}
                      />
                    </div>
                  </div>
                  ) : (
                  <div className="rounded-2xl border bg-background/70 p-4 space-y-4">
                    <div>
                      <div className="text-sm font-semibold">继承设置</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        控制子流程从父流程继承的工作区、上下文和能力配置。
                      </p>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">工作区</Label>
                        <SingleCombobox
                          value={(watch('inputWorkspace') || 'inherit') as string}
                          onValueChange={(v) => setValue('inputWorkspace', v as any)}
                          options={[
                            { value: 'inherit', label: '继承父工作区' },
                            { value: 'child-isolated-copy', label: '子流程隔离副本' },
                            { value: 'config', label: '使用子配置' },
                          ]}
                          searchable={false}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">上下文</Label>
                        <SingleCombobox
                          value={(watch('inputContext') || 'inherit') as string}
                          onValueChange={(v) => setValue('inputContext', v as any)}
                          options={[
                            { value: 'inherit', label: '继承' },
                            { value: 'none', label: '不传递' },
                            { value: 'custom', label: '自定义' },
                          ]}
                          searchable={false}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Skills</Label>
                        <SingleCombobox
                          value={(watch('inputSkills') || 'merge') as string}
                          onValueChange={(v) => setValue('inputSkills', v as any)}
                          options={[
                            { value: 'merge', label: '合并父子' },
                            { value: 'inherit', label: '继承父级' },
                            { value: 'child-only', label: '仅子流程' },
                            { value: 'parent-only', label: '仅父级' },
                          ]}
                          searchable={false}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">MCP Servers</Label>
                        <SingleCombobox
                          value={(watch('inputMcpServers') || 'merge') as string}
                          onValueChange={(v) => setValue('inputMcpServers', v as any)}
                          options={[
                            { value: 'merge', label: '合并父子' },
                            { value: 'inherit', label: '继承父级' },
                            { value: 'child-only', label: '仅子流程' },
                            { value: 'parent-only', label: '仅父级' },
                          ]}
                          searchable={false}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">RAG 知识库</Label>
                        <SingleCombobox
                          value={(watch('inputRag') || 'merge') as string}
                          onValueChange={(v) => setValue('inputRag', v as any)}
                          options={[
                            { value: 'merge', label: '合并父子' },
                            { value: 'inherit', label: '继承父级' },
                            { value: 'child-only', label: '仅子流程' },
                            { value: 'parent-only', label: '仅父级' },
                          ]}
                          searchable={false}
                        />
                      </div>
                    </div>
                  </div>
                  )}

                  {(specTaskOptions.length > 0 || watch('specTaskId') || showAdvancedBindings) && (
                    <div className="space-y-3 rounded-2xl border bg-muted/15 p-4">
                  <div>
                    <div className="text-sm font-semibold">Spec 计划绑定</div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      可手动调整当前步骤绑定的 tasks.md 任务；保存配置时系统会重新校验绑定完整性。
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>绑定任务</Label>
                    <MultiCombobox
                      value={selectedSpecTaskIds}
                      onValueChange={(value) => setValue('specTaskId', value.join(', '), { shouldDirty: true })}
                      options={specTaskOptions}
                      placeholder={specTaskOptions.length > 0 ? '选择要绑定的 tasks.md 任务...' : '当前没有可选任务'}
                    />
                  </div>
                  {selectedSpecTaskDetails.length > 0 ? (
                    <div className="space-y-2 rounded-xl border bg-background/70 p-3">
                      <div className="text-xs font-medium text-muted-foreground">当前绑定任务</div>
                      <div className="space-y-2">
                        {selectedSpecTaskDetails.slice(0, 5).map((task) => (
                          <div key={task.id} className="rounded-lg border bg-muted/20 px-3 py-2">
                            <div className="text-xs font-medium">{task.id}</div>
                            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{task.title}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-xl border bg-background/60 p-3">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-left text-xs font-medium text-muted-foreground"
                      onClick={() => setShowAdvancedBindings((v) => !v)}
                    >
                      <span>{watch('specTaskId') ? `已绑定 Spec 计划任务：${watch('specTaskId')}` : '查看系统绑定信息'}</span>
                      <span className="material-symbols-outlined text-sm">{showAdvancedBindings ? 'expand_less' : 'expand_more'}</span>
                    </button>
                    {showAdvancedBindings && (
                      <div className="mt-3 grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
                        <div>
                          <div className="text-muted-foreground">Spec 任务</div>
                          <div className="mt-1 break-words font-medium">{watch('specTaskId') || '未绑定'}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">关联需求</div>
                          <div className="mt-1 truncate font-medium">{watch('requirementIds') || '系统推导'}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">产物类型</div>
                          <div className="mt-1 truncate font-medium">{watch('artifactKeys') || '系统推导'}</div>
                        </div>
                      </div>
                    )}
                  </div>
                    </div>
                  )}

                  <div className="hidden">
                    <input {...register('specTaskId')} />
                    <input {...register('requirementIds')} />
                    <input {...register('artifactKeys')} />
                  </div>
                </div>
              </div>

        </form>
        <div className="flex gap-2 justify-end p-6 border-t bg-background/95 flex-shrink-0">
          {onDelete && (
            <Button type="button" variant="destructive" onClick={onDelete} className="mr-auto">
              <span className="material-symbols-outlined text-base mr-1">delete</span>
              删除
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="edit-node-form" disabled={isSubmitting}>
            {isSubmitting ? '确认中...' : '确认'}
          </Button>
        </div>
        </ComboboxPortalProvider>
      </DialogContent>
    </Dialog>
  );
}
