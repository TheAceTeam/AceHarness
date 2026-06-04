'use client';

import { useMemo, useState } from 'react';
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

const phaseSchema = z.object({
  name: z.string().min(1, '阶段名称不能为空'),
  checkpointEnabled: z.boolean(),
  checkpointName: z.string().optional(),
  checkpointMessage: z.string().optional(),
  iterationEnabled: z.boolean(),
  maxIterations: z.number().min(1).max(20).optional(),
  exitCondition: z.string().optional(),
  consecutiveCleanRounds: z.number().min(1).max(10).optional(),
  escalateToHuman: z.boolean().optional(),
});

const stepSchema = z.object({
  name: z.string().min(1, '步骤名称不能为空'),
  agent: z.string().min(1, 'Agent 名称不能为空'),
  task: z.string().min(1, '任务描述不能为空'),
  constraints: z.string().optional(),
  preCommands: z.string().optional(),
  enableReviewPanel: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
  specTaskId: z.string().optional(),
  requirementIds: z.string().optional(),
  artifactKeys: z.string().optional(),
});

type PhaseForm = z.infer<typeof phaseSchema>;
type StepForm = z.infer<typeof stepSchema>;

const listToInput = (value: unknown) => Array.isArray(value) ? value.join(', ') : '';
const inputToList = (value: unknown) => typeof value === 'string'
  ? value.split(',').map((item) => item.trim()).filter(Boolean)
  : [];
const linesToList = (value: unknown) => typeof value === 'string'
  ? value.split('\n').map((item) => item.trim()).filter(Boolean)
  : [];
const cleanString = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;

interface RoleOption {
  name: string;
  team: string;
  roleType?: 'normal' | 'supervisor';
  avatar?: any;
  category?: string;
  tags?: string[];
  description?: string;
  capabilities?: string[];
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

interface EditNodeModalProps {
  isOpen: boolean;
  type: 'phase' | 'step';
  data: any;
  roles?: RoleOption[];
  availableSkills?: SkillOption[];
  isNew?: boolean;
  existingPhases?: any[];
  existingSteps?: any[];
  specTasks?: SpecTaskOption[];
  initialSection?: 'spec';
  onClose: () => void;
  onSave: (data: any) => void;
  onDelete?: () => void;
}

export default function EditNodeModal({
  isOpen,
  type,
  data,
  roles = [],
  availableSkills = [],
  isNew = false,
  existingPhases = [],
  existingSteps = [],
  specTasks = [],
  initialSection,
  onClose,
  onSave,
  onDelete,
}: EditNodeModalProps) {
  const isPhase = type === 'phase';
  const schema = isPhase ? phaseSchema : stepSchema;
  const [showAdvancedBindings, setShowAdvancedBindings] = useState(initialSection === 'spec');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
    setValue,
    reset,
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: isPhase
      ? {
          name: data?.name || '',
          checkpointEnabled: !!data?.checkpoint,
          checkpointName: data?.checkpoint?.name || '',
          checkpointMessage: data?.checkpoint?.message || '',
          iterationEnabled: !!data?.iteration?.enabled,
          maxIterations: data?.iteration?.maxIterations || 5,
          exitCondition: data?.iteration?.exitCondition || 'no_new_bugs_3_rounds',
          consecutiveCleanRounds: data?.iteration?.consecutiveCleanRounds || 3,
          escalateToHuman: data?.iteration?.escalateToHuman ?? true,
        }
      : {
          name: data?.name || '',
          agent: data?.agent || '',
          task: data?.task || '',
          constraints: Array.isArray(data?.constraints) ? data.constraints.join('\n') : (data?.constraints || ''),
          preCommands: Array.isArray(data?.preCommands) ? data.preCommands.join('\n') : '',
          enableReviewPanel: data?.enableReviewPanel || false,
          skills: data?.skills || [],
          specTaskId: [
            ...((data?.specTaskBinding?.taskIds || []) as string[]),
            data?.specTaskBinding?.taskId,
          ].filter(Boolean).join(', '),
          requirementIds: listToInput(data?.specTaskBinding?.requirementIds),
          artifactKeys: listToInput(data?.specTaskBinding?.artifactKeys),
        },
  });

  const checkpointEnabled = watch('checkpointEnabled');
  const iterationEnabled = watch('iterationEnabled');
  const selectedAgentName = (watch('agent') || data?.agent || '') as string;
  const selectedAgent = roles.find((role) => role.name === selectedAgentName);
  const selectedSpecTaskIds = inputToList(watch('specTaskId'));
  const selectedSpecTaskDetails = useMemo(
    () => specTasks.filter((task) => selectedSpecTaskIds.includes(task.id)),
    [specTasks, selectedSpecTaskIds]
  );
  const agentOptions = roles.map((role) => {
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

  const handleCopyFrom = (sourceName: string) => {
    if (!sourceName) return;
    if (isPhase) {
      const source = existingPhases.find((p: any) => p.name === sourceName);
      if (!source) return;
      reset({
        name: source.name + ' (副本)',
        checkpointEnabled: !!source.checkpoint,
        checkpointName: source.checkpoint?.name || '',
        checkpointMessage: source.checkpoint?.message || '',
        iterationEnabled: !!source.iteration?.enabled,
        maxIterations: source.iteration?.maxIterations || 5,
        exitCondition: source.iteration?.exitCondition || 'no_new_bugs_3_rounds',
        consecutiveCleanRounds: source.iteration?.consecutiveCleanRounds || 3,
        escalateToHuman: source.iteration?.escalateToHuman ?? true,
      });
    } else {
      const source = existingSteps.find((s: any) => s.name === sourceName);
      if (!source) return;
      reset({
        name: source.name + ' (副本)',
        agent: source.agent || '',
        task: source.task || '',
        constraints: Array.isArray(source.constraints) ? source.constraints.join('\n') : (source.constraints || ''),
        preCommands: Array.isArray(source.preCommands) ? source.preCommands.join('\n') : '',
        enableReviewPanel: source.enableReviewPanel || false,
        skills: source.skills || [],
        specTaskId: '',
        requirementIds: '',
        artifactKeys: '',
      });
    }
  };

  const onSubmit = (formData: any) => {
    if (isPhase) {
      const phaseData: any = { name: formData.name };
      if (formData.checkpointEnabled) {
        phaseData.checkpoint = {
          name: formData.checkpointName,
          message: formData.checkpointMessage,
        };
      }
      if (formData.iterationEnabled) {
        phaseData.iteration = {
          enabled: true,
          maxIterations: Number(formData.maxIterations) || 5,
          exitCondition: formData.exitCondition || 'no_new_bugs_3_rounds',
          consecutiveCleanRounds: Number(formData.consecutiveCleanRounds) || 3,
          escalateToHuman: formData.escalateToHuman ?? true,
        };
      } else {
        phaseData.iteration = { enabled: false };
      }
      onSave(phaseData);
    } else {
      const stepData: any = {
        name: formData.name,
        agent: formData.agent,
        task: formData.task,
      };
      if (data?.role === 'attacker' || data?.role === 'defender' || data?.role === 'judge') {
        stepData.role = data.role;
      }
      if (formData.constraints) {
        stepData.constraints = formData.constraints
          .split('\n')
          .filter((c: string) => c.trim());
      }
      if (formData.preCommands !== undefined) {
        stepData.preCommands = linesToList(formData.preCommands);
      }
      if (formData.enableReviewPanel !== undefined) {
        stepData.enableReviewPanel = formData.enableReviewPanel;
      }
      if (formData.skills && formData.skills.length > 0) {
        stepData.skills = formData.skills;
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
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl w-[92vw] max-h-[88vh] flex flex-col p-0">
        <ComboboxPortalProvider>
        <div className="flex items-start justify-between gap-4 border-b px-6 py-5 flex-shrink-0">
          <div>
            <DialogTitle className="text-xl">{isNew ? (isPhase ? '新建阶段' : '新建步骤') : (isPhase ? '编辑阶段' : '编辑步骤')}</DialogTitle>
            {!isPhase ? (
              <p className="mt-1 text-sm text-muted-foreground">
                调整 Agent、任务描述、约束与 Spec 绑定。保存配置时会统一校验 task 覆盖情况。
              </p>
            ) : null}
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </Button>
        </div>
        <form id="edit-node-form" onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-auto px-6 py-5 space-y-5">
          {isNew && ((isPhase && existingPhases.length > 0) || (!isPhase && existingSteps.length > 0)) && (
            <div className="space-y-2">
              <Label>从现有复制</Label>
              <SingleCombobox
                value=""
                onValueChange={handleCopyFrom}
                options={(isPhase ? existingPhases : existingSteps).map((item: any) => ({
                  value: item.name,
                  label: item.name,
                  icon: <span className="material-symbols-outlined text-sm">content_copy</span>,
                }))}
                placeholder="选择要复制的模板..."
                searchable={false}
              />
            </div>
          )}
          {isPhase ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">
                  阶段名称 <span className="text-destructive">*</span>
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

              <div className="flex items-center justify-between">
                <Label htmlFor="checkpointEnabled">启用检查点</Label>
                <Switch
                  id="checkpointEnabled"
                  checked={checkpointEnabled as boolean}
                  onCheckedChange={(v) => setValue('checkpointEnabled', v)}
                />
              </div>

              {checkpointEnabled && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="checkpointName">检查点名称</Label>
                    <Input id="checkpointName" {...register('checkpointName')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="checkpointMessage">检查点消息</Label>
                    <Textarea id="checkpointMessage" rows={3} {...register('checkpointMessage')} />
                  </div>
                </>
              )}

              <div className="flex items-center justify-between">
                <Label htmlFor="iterationEnabled">启用对抗迭代</Label>
                <Switch
                  id="iterationEnabled"
                  checked={iterationEnabled as boolean}
                  onCheckedChange={(v) => setValue('iterationEnabled', v)}
                />
              </div>
              {iterationEnabled && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="maxIterations">最大迭代次数 (1-20)</Label>
                    <Input id="maxIterations" type="number" min={1} max={20} {...register('maxIterations', { valueAsNumber: true })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="exitCondition">退出条件</Label>
                    <SingleCombobox
                      value={watch('exitCondition') || data?.iteration?.exitCondition || 'no_new_bugs_3_rounds'}
                      onValueChange={(v) => setValue('exitCondition', v)}
                      options={[
                        { value: 'no_new_bugs_3_rounds', label: '连续 N 轮无新 Bug' },
                        { value: 'all_resolved', label: '所有问题已解决' },
                        { value: 'manual', label: '手动停止' },
                      ]}
                      searchable={false}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="consecutiveCleanRounds">连续无 Bug 轮数</Label>
                    <Input id="consecutiveCleanRounds" type="number" min={1} max={10} {...register('consecutiveCleanRounds', { valueAsNumber: true })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="escalateToHuman">达到上限时升级人工</Label>
                    <Switch
                      id="escalateToHuman"
                      checked={watch('escalateToHuman') as boolean}
                      onCheckedChange={(v) => setValue('escalateToHuman', v)}
                    />
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.95fr)]">
                <div className="space-y-5">
                  <div className="rounded-2xl border bg-background/70 p-4 space-y-4">
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
                              role={roles.find((role) => role.name === option?.value)}
                              fallbackName={option?.label || selectedAgentName}
                            />
                          )}
                          renderOption={(option) => (
                            <AgentOptionContent role={roles.find((role) => role.name === option.value)} />
                          )}
                        />
                        {errors.agent && (
                          <p className="text-sm text-destructive">{errors.agent.message as string}</p>
                        )}
                      </div>
                    </div>

                    {selectedAgent ? (
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

                  </div>
                </div>

                <div className="space-y-5">
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

                    {availableSkills.length > 0 && (
                      <div className="space-y-2">
                        <Label>Skills</Label>
                        <MultiCombobox
                          value={watch('skills') || []}
                          onValueChange={(v) => setValue('skills', v)}
                          options={availableSkills.map(skill => ({
                            value: skill.name,
                            label: skill.name,
                            description: skill.description,
                          }))}
                          placeholder="选择 Skills..."
                        />
                      </div>
                    )}
                  </div>

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
            </>
          )}

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
            {isSubmitting ? '保存中...' : '保存'}
          </Button>
        </div>
        </ComboboxPortalProvider>
      </DialogContent>
    </Dialog>
  );
}
