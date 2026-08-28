import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import StateMachineDiagram from '@/components/StateMachineDiagram';
import type { ReviewPolicy, StateMachineState, WorkflowStep } from '@/lib/core/schemas';

function policy(mode: ReviewPolicy['mode']): ReviewPolicy {
  return {
    mode,
    source: mode === 'adversarial' ? 'ai' : 'user',
    locked: mode === 'standard',
    confidence: 'high',
    riskSignals: [],
    rationale: mode === 'adversarial' ? '需要独立挑战。' : '本次关闭对抗。',
  };
}

function step(input: Partial<WorkflowStep> & Pick<WorkflowStep, 'name'>): WorkflowStep {
  return {
    agent: 'reviewer',
    task: input.name,
    ...input,
  };
}

describe('StateMachineDiagram run semantics', () => {
  test('renders the real run mode, adversarial roles, and isolated sessions instead of inferring from names', async () => {
    const states: StateMachineState[] = [
      {
        name: '按需状态',
        description: '本次实际采用对抗编排',
        isInitial: true,
        isFinal: false,
        reviewPolicy: policy('adversarial'),
        steps: [
          step({ name: '生成方案', role: 'defender', agentInstanceId: 'review-instance-defender' }),
          step({ name: '质疑方案', role: 'attacker', agentInstanceId: 'review-instance-attacker' }),
          step({ name: '裁决方案', role: 'judge', agentInstanceId: 'review-instance-judge' }),
        ],
        transitions: [],
      },
      {
        name: '关闭状态',
        description: '步骤名称保留但按标准模式运行',
        isInitial: false,
        isFinal: false,
        reviewPolicy: policy('standard'),
        steps: [
          step({ name: '质疑方案', provenance: { origin: 'user' } }),
          step({ name: '裁决方案', provenance: { origin: 'user', managedRole: 'standard-closer' } }),
        ],
        transitions: [],
      },
    ];

    render(<div style={{ width: 1200, height: 800 }}><StateMachineDiagram states={states} /></div>);

    expect(await screen.findByLabelText('按需状态：本次对抗')).toBeInTheDocument();
    expect(screen.getByLabelText('关闭状态：本次标准')).toBeInTheDocument();
    expect(screen.getByLabelText('生成方案：执行方')).toBeInTheDocument();
    expect(screen.getByLabelText('质疑方案：挑战方')).toBeInTheDocument();
    expect(screen.getByLabelText('裁决方案：裁决方')).toBeInTheDocument();
    expect(screen.getAllByText('独立')).toHaveLength(4); // 3 steps plus the legend
    expect(screen.getByLabelText('质疑方案：标准步骤')).toBeInTheDocument();
    expect(screen.getByLabelText('裁决方案：标准收口')).toBeInTheDocument();
  });
});
