// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import LightweightTaskBoard from '@/components/workflow/LightweightTaskBoard';
import { adaptLightweightTaskBoardEvidence } from '@/components/workflow/lightweight-task-board-evidence';
import { buildLightweightTaskExecutionGraphModel } from '@/components/workflow/LightweightTaskExecutionGraph';
import {
  buildWorkbenchPreviewDetailNavItems,
  buildWorkbenchRunDetailNavItems,
  resolveLightweightWorkbenchRunTabRedirect,
  resolveWorkbenchPreviewRouteSection,
} from '@/client/pages/workbench/WorkbenchClient';

describe('lightweight task board evidence', () => {
  test('derives serial tasks from task evidence without inventing a group', () => {
    const model = adaptLightweightTaskBoardEvidence({
      workflow: {
        profile: 'lightweight',
        states: [{ steps: [{ agent: 'lead-agent' }] }],
      },
      run: {
        agents: [{ name: 'lead-agent', status: 'running' }],
        completedSteps: ['T1'],
      },
      tasklist: {
        tasks: [
          { id: 'T1', title: '分析需求', owner: 'lead-agent', status: 'completed' },
          { id: 'T2', title: '实现功能', owner: 'lead-agent', dependsOn: ['T1'], status: 'running', executionMode: 'serial' },
        ],
      },
    });

    expect(model.primaryAgent?.name).toBe('lead-agent');
    expect(model.childAgents).toEqual([]);
    expect(model.progressPercent).toBe(50);
    expect(model.tasks).toMatchObject([
      { id: 'T1', executionMode: null, parallelGroup: null, status: 'completed' },
      { id: 'T2', dependencies: ['T1'], executionMode: 'serial', status: 'running' },
    ]);
  });

  test('preserves explicit parallel groups and progress evidence', () => {
    const model = adaptLightweightTaskBoardEvidence({
      workflow: { profile: 'lightweight', primaryAgent: 'lead-agent' },
      run: { agents: [{ name: 'lead-agent' }] },
      tasklist: {
        tasks: [
          { id: 'A', title: '并行分析 A', parallelGroup: 'analysis', progress: 25 },
          { id: 'B', title: '并行分析 B', groupId: 'analysis', executionMode: 'parallel', progress: 75 },
        ],
      },
    });

    expect(model.progressPercent).toBe(50);
    expect(model.tasks.map((task) => [task.parallelGroup, task.executionMode])).toEqual([
      ['analysis', 'parallel'],
      ['analysis', 'parallel'],
    ]);
  });

  test('shows only runtime child-agent evidence and excludes supervisor or workflow roles', () => {
    const model = adaptLightweightTaskBoardEvidence({
      workflow: {
        profile: 'lightweight',
        states: [{ steps: [{ agent: 'lead-agent' }] }],
      },
      run: {
        agents: [
          { name: 'lead-agent', status: 'running' },
          { name: 'child-agent', status: 'completed', currentTask: '验证结果' },
          { name: 'default-supervisor', status: 'running' },
          { name: 'bare-roster-role' },
          { name: 'idle-roster-role', status: 'idle' },
          { name: 'waiting-roster-role', status: 'waiting' },
        ],
        agentActivity: [{ agentName: 'activity-agent', status: 'running', task: '补充证据' }],
      },
      tasklist: { tasks: [{ id: 'T1', title: '主任务', status: 'running' }] },
    });

    expect(model.primaryAgent?.name).toBe('lead-agent');
    expect(model.childAgents.map((agent) => agent.name)).toEqual(['child-agent', 'activity-agent']);
  });

  test('derives child-agent activity from canonicalized ACPX orchestration tool events', () => {
    const model = adaptLightweightTaskBoardEvidence({
      workflow: { profile: 'lightweight', primaryAgent: 'lead-agent' },
      run: {
        agents: [{ name: 'lead-agent', status: 'running' }],
        toolEvents: [
          {
            toolName: 'subagent-dispatch',
            status: 'completed',
            input: {
              agent: 'dependency-analyst',
              description: '检查依赖图',
              childAgentCount: 1,
              model: 'gpt-5.6-luna',
              reasoningEffort: 'high',
            },
          },
          {
            toolName: 'subagent-wait',
            status: 'running',
            input: { childAgentCount: 1 },
          },
        ],
      },
      tasklist: { tasks: [{ id: 'T1', title: '分析依赖', status: 'running' }] },
    });

    expect(model.childAgents).toEqual([
      expect.objectContaining({
        name: 'dependency-analyst',
        status: '执行中',
        currentTask: '检查依赖图',
        summary: 'gpt-5.6-luna · high',
        source: 'runtime-tool',
      }),
    ]);
  });

  test('returns an explicit empty state when task evidence is absent', () => {
    const model = adaptLightweightTaskBoardEvidence({
      workflow: { profile: 'lightweight', primaryAgent: 'lead-agent' },
      run: { agents: [{ name: 'lead-agent', status: 'running' }] },
    });

    expect(model.tasks).toEqual([]);
    expect(model.progressPercent).toBeNull();
    expect(model.emptyReason).toBe('no-task-evidence');

    render(<LightweightTaskBoard workflow={{ profile: 'lightweight', primaryAgent: 'lead-agent' }} run={{ agents: [{ name: 'lead-agent' }] }} />);
    expect(screen.getByLabelText('主 Agent')).toBeInTheDocument();
    expect(screen.getByLabelText('子 Agent 活动')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '任务数据状态' })).toHaveTextContent('暂无可用任务数据');
    expect(screen.queryByText('1/1')).not.toBeInTheDocument();
  });

  test('renders real task progress and keeps state-machine data isolated', () => {
    const model = adaptLightweightTaskBoardEvidence({
      workflow: { profile: 'lightweight', primaryAgent: 'lead-agent' },
      run: { agents: [{ name: 'lead-agent', status: 'running' }] },
      tasklist: { tasks: [{ id: 'T1', title: '已完成任务', progress: 40 }, { id: 'T2', title: '进行中任务', progress: 80 }] },
    });
    expect(model.progressPercent).toBe(60);

    const stateMachine = adaptLightweightTaskBoardEvidence({
      workflow: { profile: 'state-machine', primaryAgent: 'ordinary-agent' } as any,
      run: { agents: [{ name: 'ordinary-agent' }, { name: 'another-agent' }] },
      tasklist: { tasks: [{ id: 'T1', title: '普通状态机步骤', status: 'completed' }] },
    });
    expect(stateMachine.isLightweight).toBe(false);
    expect(stateMachine.primaryAgent).toBeNull();
    expect(stateMachine.childAgents).toEqual([]);
    expect(stateMachine.tasks).toEqual([]);
  });

  test('renders child current task or summary without inventing a task label', () => {
    render(
      <LightweightTaskBoard
        workflow={{ profile: 'lightweight', primaryAgent: 'lead-agent' }}
        run={{
          agents: [
            { name: 'lead-agent', status: 'running' },
            { name: 'active-child', status: 'running', currentTask: '检查编译结果' },
            { name: 'finished-child', status: 'completed', summary: '已完成依赖核验' },
            { name: 'no-task-child', status: 'completed' },
          ],
        }}
        tasklist={{
          tasks: [
            { id: 'S1', title: '串行任务', executionMode: 'serial', dependsOn: ['S0'] },
            { id: 'P1', title: '并行任务', executionMode: 'parallel', parallelGroup: '验证组' },
          ],
        }}
      />,
    );

    expect(screen.getByText('检查编译结果')).toBeInTheDocument();
    expect(screen.getByText('已完成依赖核验')).toBeInTheDocument();
    expect(screen.queryByText('no-task-child 的任务')).not.toBeInTheDocument();
    expect(screen.getByText('串行')).toBeInTheDocument();
    expect(screen.getByText('并行')).toBeInTheDocument();
    expect(screen.getByText('验证组')).toBeInTheDocument();
    expect(screen.getByText('依赖：S0')).toBeInTheDocument();
  });

  test('builds a task dependency graph from explicit task evidence only', () => {
    const model = buildLightweightTaskExecutionGraphModel([
      { id: 'T1', title: '分析需求', owner: 'lead-agent', dependencies: [], parallelGroup: null, executionMode: 'serial', status: 'completed', progressPercent: 100 },
      { id: 'T2', title: '实现功能', owner: 'lead-agent', dependencies: ['T1'], parallelGroup: null, executionMode: 'serial', status: 'running', progressPercent: 50 },
      { id: 'T3', title: '并行验证 A', owner: 'tester-a', dependencies: ['T2'], parallelGroup: '验证组', executionMode: 'parallel', status: 'pending', progressPercent: null },
      { id: 'T4', title: '并行验证 B', owner: 'tester-b', dependencies: ['T2', 'missing-task'], parallelGroup: '验证组', executionMode: 'parallel', status: 'pending', progressPercent: null },
    ]);

    expect(model.available).toBe(true);
    expect(model.nodes.map((node) => node.id)).toEqual(['T1', 'T2', 'T3', 'T4']);
    expect(model.edges.map((edge) => edge.id).sort()).toEqual(['T1->T2', 'T2->T3', 'T2->T4']);
    expect(model.parallelGroups).toEqual([{ id: '验证组', taskIds: ['T3', 'T4'] }]);
    expect(model.mode).toBe('mixed');
    expect(model.nodes.find((node) => node.id === 'T4')?.data.unresolvedDependencyCount).toBe(1);
    expect(model.nodes.some((node) => node.id === 'missing-task')).toBe(false);
  });

  test('does not invent graph nodes or dependency edges when task evidence is unavailable', () => {
    const empty = buildLightweightTaskExecutionGraphModel([]);
    expect(empty.available).toBe(false);
    expect(empty.nodes).toEqual([]);
    expect(empty.edges).toEqual([]);

    const noDependencies = buildLightweightTaskExecutionGraphModel([
      { id: 'T1', title: '单项任务', owner: null, dependencies: [], parallelGroup: null, executionMode: null, status: 'unknown', progressPercent: null },
    ]);
    expect(noDependencies.available).toBe(true);
    expect(noDependencies.nodes.map((node) => node.id)).toEqual(['T1']);
    expect(noDependencies.edges).toEqual([]);
    expect(noDependencies.hasExplicitDependencies).toBe(false);
  });

  test('resolves lightweight Workbench top-level state graph and removes top-level Agents tab', () => {
    const previewItems = buildWorkbenchPreviewDetailNavItems({
      isLightweightWorkflow: true,
      runtimeSpecAvailable: true,
    });
    const runItems = buildWorkbenchRunDetailNavItems({
      isLightweightWorkflow: true,
      runtimeSpecAvailable: true,
    });

    expect(previewItems.map((item) => item.key)).toContain('state');
    expect(previewItems.map((item) => item.key)).not.toContain('agents');
    expect(runItems.map((item) => item.key)).toContain('state');
    expect(runItems.map((item) => item.key)).not.toContain('agents');
    expect(runItems).toContainEqual(expect.objectContaining({
      id: 'tasklist',
      key: 'documents',
      documentSource: 'tasklist',
    }));

    expect(resolveWorkbenchPreviewRouteSection('preview-state')).toBe('state');
    expect(resolveLightweightWorkbenchRunTabRedirect({
      requestedTab: 'state',
      requestedDocumentSource: 'all',
    })).toBeNull();
    expect(resolveLightweightWorkbenchRunTabRedirect({
      requestedTab: 'agents',
      requestedDocumentSource: 'all',
    })).toEqual({
      section: 'overview',
      tab: 'overview',
      documentSource: 'all',
    });
  });
});
