'use client';

import { useEffect, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SingleCombobox } from '@/components/ui/combobox';
import type { StateMachineState, WorkflowStep } from '@/lib/core/schemas';
import { configApi } from '@/lib/core/api';
import {
  LIGHTWEIGHT_TASKLIST_SKILL,
  LIGHTWEIGHT_WORKFLOW_DESCRIPTION,
} from '@/lib/workflow/lightweight';
import { isWorkflowStepSelectableAgent } from '@/lib/agent/catalog';

type AgentOption = {
  name: string;
  description?: string;
  team?: string;
  roleType?: string;
  catalogVisibility?: 'default' | 'optional' | 'system';
};

export type LightweightWorkflowDesignMetadata = {
  workflowName?: string;
  workspace?: string;
};

type LightweightWorkflowDesignPanelProps = {
  states: StateMachineState[];
  onStatesChange: (states: StateMachineState[]) => void;
  availableAgents: AgentOption[];
  metadata?: LightweightWorkflowDesignMetadata;
};

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
    specTaskBinding: _specTaskBinding,
    inputs: _inputs,
    result: _result,
    runtime: _runtime,
    ...agentStep
  } = currentStep as any;
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
      skills: [LIGHTWEIGHT_TASKLIST_SKILL],
    }],
    transitions: [],
  } as StateMachineState;
}

export default function LightweightWorkflowDesignPanel({
  states,
  onStatesChange,
  availableAgents,
  metadata,
}: LightweightWorkflowDesignPanelProps) {
  const [resolvedMetadata, setResolvedMetadata] = useState<LightweightWorkflowDesignMetadata | null>(null);
  const state = states[0];
  const step = state?.steps?.[0];
  const workflowStepAgents = useMemo(
    () => availableAgents.filter(isWorkflowStepSelectableAgent),
    [availableAgents],
  );
  const agentOptions = useMemo(() => workflowStepAgents.map((agent) => ({
    value: agent.name,
    label: agent.name,
    description: [agent.description, agent.team, agent.roleType].filter(Boolean).join(' · '),
  })), [workflowStepAgents]);
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

        <dl className="grid gap-x-6 gap-y-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">名称</dt>
            <dd className="mt-1 break-words font-medium">{displayMetadata?.workflowName || '当前工作流'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">工作区</dt>
            <dd className="mt-1 break-all font-medium">{displayMetadata?.workspace || '由工作流配置定义'}</dd>
          </div>
        </dl>

        <section className="space-y-4 rounded-lg border p-4">
          <div>
            <div>
              <h3 className="text-sm font-semibold">执行设置</h3>
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
            <Label htmlFor="lightweight-step-task">完整目标</Label>
            <Textarea
              id="lightweight-step-task"
              value={step?.task || ''}
              onChange={(event) => updateStep({ task: event.target.value })}
              rows={6}
              placeholder="描述要完成的任务、目标产物和验收条件..."
            />
          </div>

        </section>
      </div>
    </div>
  );
}
