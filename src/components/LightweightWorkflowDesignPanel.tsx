'use client';

import { useEffect, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MultiCombobox, SingleCombobox } from '@/components/ui/combobox';
import type { StateMachineState, WorkflowStep } from '@/lib/core/schemas';
import { configApi } from '@/lib/core/api';
import {
  LIGHTWEIGHT_TASKLIST_SKILL,
  LIGHTWEIGHT_WORKFLOW_DESCRIPTION,
} from '@/lib/workflow/lightweight';

type AgentOption = {
  name: string;
  description?: string;
  team?: string;
  roleType?: string;
};

type SkillOption = {
  name: string;
  description: string;
};

export type LightweightWorkflowDesignMetadata = {
  workflowName?: string;
  workspace?: string;
  tasklistDirectory?: string;
};

interface LightweightWorkflowDesignPanelProps {
  states: StateMachineState[];
  onStatesChange: (states: StateMachineState[]) => void;
  availableAgents: AgentOption[];
  availableSkills?: SkillOption[];
  metadata?: LightweightWorkflowDesignMetadata;
}

export function hasLightweightWorkflowTopology(states: StateMachineState[]): boolean {
  const state = states[0];
  const step = state?.steps?.[0];
  return states.length === 1
    && Boolean(state?.isInitial)
    && Boolean(state?.isFinal)
    && (state?.transitions?.length || 0) === 0
    && (state?.steps?.length || 0) === 1
    && step?.type !== 'subworkflow'
    && Array.isArray(step?.skills)
    && step.skills.includes(LIGHTWEIGHT_TASKLIST_SKILL);
}

function buildFixedState(state: StateMachineState | undefined, changes: Partial<WorkflowStep>): StateMachineState {
  const currentStep = state?.steps?.[0] || ({} as WorkflowStep);
  const {
    parallelGroup: _parallelGroup,
    concurrency: _concurrency,
    workflow: _workflow,
    subworkflow: _subworkflow,
    inputs: _inputs,
    result: _result,
    runtime: _runtime,
    ...agentStep
  } = currentStep as any;
  const skills = Array.isArray(changes.skills) ? changes.skills : agentStep.skills;
  const normalizedSkills = [...new Set([
    LIGHTWEIGHT_TASKLIST_SKILL,
    ...(Array.isArray(skills) ? skills : []).filter((skill): skill is string => typeof skill === 'string' && skill.trim().length > 0),
  ])];
  return {
    ...state,
    name: state?.name || '执行',
    description: state?.description || LIGHTWEIGHT_WORKFLOW_DESCRIPTION,
    isInitial: true,
    isFinal: true,
    steps: [{
      ...agentStep,
      ...changes,
      type: 'agent',
      name: changes.name || agentStep.name || '执行任务',
      agent: changes.agent || agentStep.agent || '',
      task: changes.task || agentStep.task || '',
      skills: normalizedSkills,
    }],
    transitions: [],
  } as StateMachineState;
}

export default function LightweightWorkflowDesignPanel({
  states,
  onStatesChange,
  availableAgents,
  availableSkills = [],
  metadata,
}: LightweightWorkflowDesignPanelProps) {
  const [resolvedMetadata, setResolvedMetadata] = useState<LightweightWorkflowDesignMetadata | null>(null);
  const state = states[0];
  const step = state?.steps?.[0];
  const optionalSkills = (step?.skills || []).filter((skill) => skill !== LIGHTWEIGHT_TASKLIST_SKILL);
  const agentOptions = useMemo(() => availableAgents.map((agent) => ({
    value: agent.name,
    label: agent.name,
    description: [agent.description, agent.team, agent.roleType].filter(Boolean).join(' · '),
  })), [availableAgents]);
  const skillOptions = useMemo(() => {
    const byName = new Map<string, SkillOption>();
    for (const skill of availableSkills) byName.set(skill.name, skill);
    for (const skill of optionalSkills) {
      if (!byName.has(skill)) byName.set(skill, { name: skill, description: '当前步骤已选择的 Skill' });
    }
    return [...byName.values()]
      .filter((skill) => skill.name !== LIGHTWEIGHT_TASKLIST_SKILL)
      .map((skill) => ({ value: skill.name, label: skill.name, description: skill.description }));
  }, [availableSkills, optionalSkills]);

  const updateStep = (changes: Partial<WorkflowStep>) => {
    onStatesChange([buildFixedState(state, changes)]);
  };

  useEffect(() => {
    if (metadata || typeof window === 'undefined') return;
    const route = new URLSearchParams(window.location.search).get('route') || window.location.pathname;
    const match = route.match(/\/workbench\/([^/?]+)/);
    if (!match?.[1]) return;
    let cancelled = false;
    let configFile = '';
    try {
      configFile = decodeURIComponent(match[1]);
    } catch {
      return;
    }
    void configApi.getConfig(configFile).then((result) => {
      if (cancelled) return;
      const config = result?.config;
      setResolvedMetadata({
        workflowName: config?.workflow?.name,
        workspace: config?.context?.projectRoot,
        tasklistDirectory: config?.workflow?.lightweight?.tasklistDirectory,
      });
    }).catch(() => {
      // The editor remains usable when its parent does not expose a config route.
    });
    return () => {
      cancelled = true;
    };
  }, [metadata]);

  const displayMetadata = metadata || resolvedMetadata;

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div>
            <h2 className="text-base font-semibold">轻量工作流设计</h2>
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">名称</dt>
            <dd className="mt-1 break-words font-medium">{displayMetadata?.workflowName || '当前工作流'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">工作区</dt>
            <dd className="mt-1 break-all font-medium">{displayMetadata?.workspace || '由工作流配置定义'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">任务清单目录（只读）</dt>
            <dd className="mt-1 break-all font-medium">{displayMetadata?.tasklistDirectory || '由工作流配置定义'}</dd>
          </div>
        </dl>

        <section className="space-y-4 rounded-lg border p-4">
          <div>
            <div>
              <h3 className="text-sm font-semibold">步骤设置</h3>
            </div>
          </div>

          <div className="space-y-2">
            <Label>执行 Agent</Label>
            <SingleCombobox
              value={step?.agent || ''}
              onValueChange={(agent) => updateStep({ agent })}
              options={agentOptions}
              placeholder="选择执行 Agent"
              emptyText="没有可用 Agent"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lightweight-step-task">执行任务</Label>
            <Textarea
              id="lightweight-step-task"
              value={step?.task || ''}
              onChange={(event) => updateStep({ task: event.target.value })}
              rows={6}
              placeholder="描述要完成的任务、目标产物和验收条件..."
            />
          </div>

          <div className="space-y-3">
            <Label>步骤 Skills</Label>
            <MultiCombobox
              value={optionalSkills}
              onValueChange={(skills) => updateStep({ skills: [LIGHTWEIGHT_TASKLIST_SKILL, ...skills] })}
              options={skillOptions}
              placeholder="选择可选步骤 Skills"
            />
            <p className="text-xs leading-5 text-muted-foreground">Skills 保存到 `step.skills`，不会修改 Agent 的全局 Skills。</p>
          </div>
        </section>
      </div>
    </div>
  );
}
