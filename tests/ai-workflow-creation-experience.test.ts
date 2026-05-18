/**
 * AI Workflow Creation Experience Test
 *
 * This test simulates an AI agent attempting to create a valid workflow configuration
 * from scratch, following the skill documentation and system prompts.
 *
 * Goal: Identify friction points in the current workflow creation guidance.
 */

import { describe, test, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  extractWorkflowDraftPreview,
  extractPlanDraftResult,
  extractClarificationFormResult,
} from '../src/lib/ai/result-normalizers';
import { extractStructuredResult } from '../src/lib/ai/result-channel';

describe('AI Workflow Creation Experience', () => {
  describe('Phase 1: Understanding Output Protocol', () => {
    test('AI should understand it needs to output workflow_draft with config object', () => {
      // Simulating AI's first attempt based on PROMPT.md line 25:
      // "创建弹窗 | YAML 草案 | <result> 内输出 {\"kind\":\"workflow_draft\",\"payload\":{...}}"

      const aiAttempt1 = `
<result>
{
  "kind": "workflow_draft",
  "payload": {
    "filename": "test-workflow.yaml",
    "summary": "测试工作流",
    "config": {
      "workflow": {
        "name": "测试",
        "mode": "state-machine"
      }
    }
  }
}
</result>
`;

      const result = extractWorkflowDraftPreview(aiAttempt1, 'test.yaml');

      expect(result.source).toBe('result-json');
      expect(result.config).toBeTruthy();
      expect(result.parseError).toBeUndefined();
    });

    test('AI might incorrectly output YAML in fenced code block', () => {
      // Common mistake: AI outputs YAML instead of JSON
      // This is explicitly forbidden in PROMPT.md line 30-32

      const aiAttempt2 = `
<result>
\`\`\`yaml
workflow:
  name: 测试
  mode: state-machine
\`\`\`
</result>
`;

      const result = extractWorkflowDraftPreview(aiAttempt2, 'test.yaml');

      // System should handle this gracefully and extract from YAML fallback
      expect(result.source).toBe('yaml');
      expect(result.config).toBeTruthy();
    });
  });

  describe('Phase 2: Creating Minimal Valid Workflow', () => {
    test('AI creates minimal state-machine workflow following template', () => {
      // Based on feature-dev.yaml.md template
      const minimalWorkflow = {
        workflow: {
          name: '简单功能开发',
          description: '测试最小可行工作流',
          mode: 'state-machine',
          maxTransitions: 30,
          states: [
            {
              name: '设计',
              description: '设计阶段',
              requireHumanApproval: true,
              isInitial: true,
              isFinal: false,
              steps: [
                {
                  id: 'design-plan',
                  name: '方案设计',
                  agent: 'architect',
                  role: 'defender',
                  specTaskBinding: {
                    taskIds: ['T1.1'],
                    requirementIds: ['R1'],
                    artifactKeys: ['requirements', 'design'],
                  },
                  task: '设计方案',
                },
              ],
              transitions: [
                {
                  to: '完成',
                  condition: { verdict: 'pass' },
                  priority: 1,
                  label: '设计通过',
                },
              ],
            },
            {
              name: '完成',
              description: '完成',
              isInitial: false,
              isFinal: true,
              steps: [
                {
                  id: 'done',
                  name: '完成',
                  agent: 'documentation-writer',
                  role: 'defender',
                  task: '生成报告',
                },
              ],
              transitions: [],
            },
          ],
        },
        context: {
          projectRoot: '/test/project',
          workspaceMode: 'in-place',
          requirements: '测试需求',
          timeoutMinutes: 180,
        },
      };

      const aiOutput = `
<result>
{
  "kind": "workflow_draft",
  "payload": {
    "filename": "simple-feature.yaml",
    "summary": "简单功能开发工作流",
    "config": ${JSON.stringify(minimalWorkflow)}
  }
}
</result>
`;

      const result = extractWorkflowDraftPreview(aiOutput);

      expect(result.source).toBe('result-json');
      expect(result.config).toBeTruthy();
      expect(result.config.workflow.mode).toBe('state-machine');
      expect(result.config.workflow.states).toHaveLength(2);

      // Validate state machine structure
      const initialStates = result.config.workflow.states.filter((s: any) => s.isInitial);
      const finalStates = result.config.workflow.states.filter((s: any) => s.isFinal);

      expect(initialStates).toHaveLength(1);
      expect(finalStates).toHaveLength(1);
    });

    test('AI includes required specTaskBinding fields in each step', () => {
      // Testing if AI understands specTaskBinding is required
      // Based on user's analysis: "缺少显式的 specTaskBinding.taskIds"

      const workflowWithBinding = {
        workflow: {
          name: '测试',
          mode: 'state-machine',
          states: [
            {
              name: '开始',
              isInitial: true,
              isFinal: false,
              steps: [
                {
                  id: 'step1',
                  name: '步骤1',
                  agent: 'developer',
                  role: 'defender',
                  specTaskBinding: {
                    taskIds: ['T1.1'],
                    requirementIds: ['R1'],
                    artifactKeys: ['design'],
                  },
                  task: '执行任务',
                },
              ],
              transitions: [{ to: '完成', priority: 1 }],
            },
            {
              name: '完成',
              isInitial: false,
              isFinal: true,
              steps: [
                {
                  id: 'done',
                  name: '完成',
                  agent: 'developer',
                  task: '完成',
                },
              ],
              transitions: [],
            },
          ],
        },
        context: {
          projectRoot: '/test',
          workspaceMode: 'in-place',
        },
      };

      const aiOutput = `
<result>
{"kind":"workflow_draft","payload":{"config":${JSON.stringify(workflowWithBinding)}}}
</result>
`;

      const result = extractWorkflowDraftPreview(aiOutput);

      expect(result.config).toBeTruthy();
      const firstStep = result.config.workflow.states[0].steps[0];
      expect(firstStep.specTaskBinding).toBeDefined();
      expect(firstStep.specTaskBinding.taskIds).toEqual(['T1.1']);
    });
  });

  describe('Phase 3: Common AI Mistakes', () => {
    test('AI might forget to wrap config in workflow_draft payload', () => {
      // Common mistake: outputting config directly instead of wrapping it
      const directConfigOutput = `
<result>
{
  "workflow": {
    "name": "测试",
    "mode": "state-machine"
  }
}
</result>
`;

      const result = extractWorkflowDraftPreview(directConfigOutput);

      // This should fail to parse as workflow_draft
      expect(result.source).toBe('none');
      expect(result.parseError).toBeTruthy();
    });

    test('AI might output YAML preview instead of JSON', () => {
      // Based on user's analysis: "强迫 AI 输出完整 YAML 预览而非简单输出"
      const yamlPreview = `
这是工作流配置：

\`\`\`yaml
workflow:
  name: 测试工作流
  mode: state-machine
  states:
    - name: 开始
      isInitial: true
      isFinal: false
      steps:
        - id: step1
          name: 步骤1
          agent: developer
          task: 执行
      transitions:
        - to: 完成
    - name: 完成
      isInitial: false
      isFinal: true
      steps:
        - id: done
          name: 完成
          agent: developer
          task: 完成
      transitions: []
context:
  projectRoot: /test
  workspaceMode: in-place
\`\`\`
`;

      const result = extractWorkflowDraftPreview(yamlPreview);

      // System has fallback to parse YAML, but this is not the preferred format
      expect(result.source).toBe('yaml');
      expect(result.config).toBeTruthy();
    });

    test('AI might confuse home_sidebar with workflow_draft', () => {
      // Based on user's analysis: "模态冲突：创建弹窗运行在 dashboard 模式"
      const confusedOutput = `
<result>
{
  "kind": "home_sidebar",
  "payload": {
    "shouldOpenModal": true,
    "workflowDraft": {
      "workflow": {
        "name": "测试"
      }
    }
  }
}
</result>
`;

      const result = extractWorkflowDraftPreview(confusedOutput);

      // This should fail because it's home_sidebar, not workflow_draft
      expect(result.source).toBe('none');
      expect(result.parseError).toBeTruthy();
    });
  });

  describe('Phase 4: Red-Blue-Judge Pattern', () => {
    test('AI creates red-blue-judge pattern within single state', () => {
      // Based on SKILL.md lines 33-36: "红队、蓝队、黄队在默认设计里是同一个 node 内的多个 steps"
      const redBlueJudgeWorkflow = {
        workflow: {
          name: '红蓝对抗工作流',
          mode: 'state-machine',
          states: [
            {
              name: '设计',
              requireHumanApproval: true,
              isInitial: true,
              isFinal: false,
              steps: [
                {
                  id: 'design-defender',
                  name: '方案设计',
                  agent: 'architect',
                  role: 'defender',
                  specTaskBinding: {
                    taskIds: ['T1.1'],
                    requirementIds: ['R1'],
                    artifactKeys: ['design'],
                  },
                  task: '设计方案',
                },
                {
                  id: 'design-attacker',
                  name: '方案攻击',
                  agent: 'design-breaker',
                  role: 'attacker',
                  specTaskBinding: {
                    taskIds: ['T1.2'],
                    requirementIds: ['R1'],
                    artifactKeys: ['design'],
                  },
                  task: '攻击方案',
                },
                {
                  id: 'design-judge',
                  name: '方案裁决',
                  agent: 'design-judge',
                  role: 'judge',
                  specTaskBinding: {
                    taskIds: ['T1.3'],
                    requirementIds: ['R1'],
                    artifactKeys: ['design'],
                  },
                  task: '裁决',
                },
              ],
              transitions: [
                { to: '完成', condition: { verdict: 'pass' }, priority: 1 },
              ],
            },
            {
              name: '完成',
              isInitial: false,
              isFinal: true,
              steps: [
                {
                  id: 'done',
                  name: '完成',
                  agent: 'documentation-writer',
                  task: '生成报告',
                },
              ],
              transitions: [],
            },
          ],
        },
        context: {
          projectRoot: '/test',
          workspaceMode: 'in-place',
        },
      };

      const aiOutput = `
<result>
{"kind":"workflow_draft","payload":{"config":${JSON.stringify(redBlueJudgeWorkflow)}}}
</result>
`;

      const result = extractWorkflowDraftPreview(aiOutput);

      expect(result.config).toBeTruthy();

      const designState = result.config.workflow.states[0];
      expect(designState.steps).toHaveLength(3);
      expect(designState.steps[0].role).toBe('defender');
      expect(designState.steps[1].role).toBe('attacker');
      expect(designState.steps[2].role).toBe('judge');
    });

    test('AI incorrectly splits red-blue-judge into separate states', () => {
      // Anti-pattern: Based on SKILL.md lines 35-37
      // "不要把'设计蓝队''设计红队''设计裁判'各自拆成独立状态"
      const incorrectPattern = {
        workflow: {
          name: '错误的红蓝对抗',
          mode: 'state-machine',
          states: [
            {
              name: '设计红队',
              isInitial: true,
              isFinal: false,
              steps: [
                {
                  id: 'defender',
                  name: '红队设计',
                  agent: 'architect',
                  role: 'defender',
                  task: '设计',
                },
              ],
              transitions: [{ to: '设计蓝队', priority: 1 }],
            },
            {
              name: '设计蓝队',
              isInitial: false,
              isFinal: false,
              steps: [
                {
                  id: 'attacker',
                  name: '蓝队攻击',
                  agent: 'attacker',
                  role: 'attacker',
                  task: '攻击',
                },
              ],
              transitions: [{ to: '设计裁判', priority: 1 }],
            },
            {
              name: '设计裁判',
              isInitial: false,
              isFinal: true,
              steps: [
                {
                  id: 'judge',
                  name: '裁判',
                  agent: 'judge',
                  role: 'judge',
                  task: '裁决',
                },
              ],
              transitions: [],
            },
          ],
        },
        context: {
          projectRoot: '/test',
          workspaceMode: 'in-place',
        },
      };

      // This is technically valid but violates the recommended pattern
      const aiOutput = `
<result>
{"kind":"workflow_draft","payload":{"config":${JSON.stringify(incorrectPattern)}}}
</result>
`;

      const result = extractWorkflowDraftPreview(aiOutput);

      expect(result.config).toBeTruthy();
      // This passes parsing but is not the recommended structure
      expect(result.config.workflow.states).toHaveLength(3);
    });
  });

  describe('Phase 5: Context and Workspace Mode', () => {
    test('AI defaults to in-place workspace mode', () => {
      // Based on SKILL.md line 41: "优先推荐 context.workspaceMode: in-place"
      const workflow = {
        workflow: {
          name: '测试',
          mode: 'state-machine',
          states: [
            {
              name: '开始',
              isInitial: true,
              isFinal: true,
              steps: [
                {
                  id: 'step1',
                  name: '步骤',
                  agent: 'developer',
                  task: '执行',
                },
              ],
              transitions: [],
            },
          ],
        },
        context: {
          projectRoot: '/test/project',
          workspaceMode: 'in-place',
          requirements: '测试需求',
        },
      };

      const aiOutput = `
<result>
{"kind":"workflow_draft","payload":{"config":${JSON.stringify(workflow)}}}
</result>
`;

      const result = extractWorkflowDraftPreview(aiOutput);

      expect(result.config.context.workspaceMode).toBe('in-place');
    });

    test('AI uses isolated-copy when explicitly requested', () => {
      const workflow = {
        workflow: {
          name: '隔离测试',
          mode: 'state-machine',
          states: [
            {
              name: '开始',
              isInitial: true,
              isFinal: true,
              steps: [
                {
                  id: 'step1',
                  name: '步骤',
                  agent: 'developer',
                  task: '执行',
                },
              ],
              transitions: [],
            },
          ],
        },
        context: {
          projectRoot: '/test/project',
          workspaceMode: 'isolated-copy',
        },
      };

      const aiOutput = `
<result>
{"kind":"workflow_draft","payload":{"config":${JSON.stringify(workflow)}}}
</result>
`;

      const result = extractWorkflowDraftPreview(aiOutput);

      expect(result.config.context.workspaceMode).toBe('isolated-copy');
    });
  });

  describe('Phase 6: Integration Test - Full Workflow Creation', () => {
    test('AI creates complete feature development workflow in one attempt', () => {
      // This is the ultimate test: can AI create a valid, complete workflow
      // following all the guidelines in one shot?

      const completeWorkflow = {
        workflow: {
          name: '完整功能开发',
          description: 'AI 一次性生成的完整工作流',
          mode: 'state-machine',
          maxTransitions: 30,
          supervisor: {
            enabled: true,
            agent: 'default-supervisor',
            stageReviewEnabled: true,
            checkpointAdviceEnabled: true,
          },
          states: [
            {
              name: '设计',
              description: '设计阶段',
              requireHumanApproval: true,
              isInitial: true,
              isFinal: false,
              steps: [
                {
                  id: 'design-defender',
                  name: '方案设计',
                  agent: 'architect',
                  role: 'defender',
                  specTaskBinding: {
                    taskIds: ['T1.1'],
                    requirementIds: ['R1'],
                    artifactKeys: ['requirements', 'design'],
                  },
                  task: '设计完整方案',
                },
                {
                  id: 'design-attacker',
                  name: '方案攻击',
                  agent: 'design-breaker',
                  role: 'attacker',
                  specTaskBinding: {
                    taskIds: ['T1.2'],
                    requirementIds: ['R1'],
                    artifactKeys: ['design'],
                  },
                  task: '攻击设计方案',
                },
                {
                  id: 'design-judge',
                  name: '方案裁决',
                  agent: 'design-judge',
                  role: 'judge',
                  specTaskBinding: {
                    taskIds: ['T1.3'],
                    requirementIds: ['R1'],
                    artifactKeys: ['design', 'tasks'],
                  },
                  task: '裁决方案',
                },
              ],
              transitions: [
                {
                  to: '实施',
                  condition: { verdict: 'pass' },
                  priority: 1,
                  label: '方案通过',
                },
                {
                  to: '设计',
                  condition: { verdict: 'conditional_pass' },
                  priority: 2,
                  label: '需修复设计',
                },
                {
                  to: '终止',
                  condition: { verdict: 'fail' },
                  priority: 3,
                  label: '设计不可行',
                },
              ],
            },
            {
              name: '实施',
              description: '编码实现',
              requireHumanApproval: true,
              isInitial: false,
              isFinal: false,
              steps: [
                {
                  id: 'implement-defender',
                  name: '编码',
                  agent: 'developer',
                  role: 'defender',
                  specTaskBinding: {
                    taskIds: ['T2.1'],
                    requirementIds: ['R2'],
                    artifactKeys: ['design', 'tasks'],
                  },
                  task: '实现功能',
                },
                {
                  id: 'implement-attacker',
                  name: '代码攻击',
                  agent: 'code-hunter',
                  role: 'attacker',
                  specTaskBinding: {
                    taskIds: ['T2.2'],
                    requirementIds: ['R2'],
                    artifactKeys: ['design', 'tasks'],
                  },
                  task: '攻击代码',
                },
                {
                  id: 'implement-judge',
                  name: '代码裁决',
                  agent: 'fix-judge',
                  role: 'judge',
                  specTaskBinding: {
                    taskIds: ['T2.3'],
                    requirementIds: ['R2'],
                    artifactKeys: ['tasks'],
                  },
                  task: '裁决代码',
                },
              ],
              transitions: [
                {
                  to: '完成',
                  condition: { verdict: 'pass' },
                  priority: 1,
                  label: '代码通过',
                },
                {
                  to: '实施',
                  condition: { verdict: 'conditional_pass' },
                  priority: 2,
                  label: '需继续修复',
                },
                {
                  to: '终止',
                  condition: { verdict: 'fail' },
                  priority: 3,
                  label: '实施不可接受',
                },
              ],
            },
            {
              name: '完成',
              description: '开发完成',
              isInitial: false,
              isFinal: true,
              steps: [
                {
                  id: 'delivery',
                  name: '交付报告',
                  agent: 'documentation-writer',
                  role: 'defender',
                  specTaskBinding: {
                    taskIds: ['T3.1'],
                    requirementIds: ['R3'],
                    artifactKeys: ['requirements', 'design', 'tasks'],
                  },
                  task: '生成交付报告',
                },
              ],
              transitions: [],
            },
            {
              name: '终止',
              description: '异常终止',
              isInitial: false,
              isFinal: true,
              steps: [
                {
                  id: 'abort',
                  name: '终止记录',
                  agent: 'documentation-writer',
                  role: 'defender',
                  task: '记录终止原因',
                },
              ],
              transitions: [],
            },
          ],
        },
        context: {
          projectRoot: '/test/project',
          workspaceMode: 'in-place',
          requirements: '完整的功能需求描述',
          timeoutMinutes: 180,
        },
      };

      const aiOutput = `
<result>
{
  "kind": "workflow_draft",
  "payload": {
    "filename": "complete-feature-dev.yaml",
    "summary": "完整的功能开发工作流，包含设计、实施两个阶段，每个阶段都有红蓝对抗机制",
    "config": ${JSON.stringify(completeWorkflow)}
  }
}
</result>
`;

      const result = extractWorkflowDraftPreview(aiOutput);

      // Validate successful parsing
      expect(result.source).toBe('result-json');
      expect(result.config).toBeTruthy();
      expect(result.parseError).toBeUndefined();

      // Validate workflow structure
      expect(result.config.workflow.mode).toBe('state-machine');
      expect(result.config.workflow.states).toHaveLength(4);

      // Validate state machine rules
      const initialStates = result.config.workflow.states.filter((s: any) => s.isInitial);
      const finalStates = result.config.workflow.states.filter((s: any) => s.isFinal);
      expect(initialStates).toHaveLength(1);
      expect(finalStates.length).toBeGreaterThanOrEqual(1);

      // Validate red-blue-judge pattern in design state
      const designState = result.config.workflow.states.find((s: any) => s.name === '设计');
      expect(designState.steps).toHaveLength(3);
      expect(designState.steps[0].role).toBe('defender');
      expect(designState.steps[1].role).toBe('attacker');
      expect(designState.steps[2].role).toBe('judge');

      // Validate human approval on critical states
      expect(designState.requireHumanApproval).toBe(true);
      const implementState = result.config.workflow.states.find((s: any) => s.name === '实施');
      expect(implementState.requireHumanApproval).toBe(true);

      // Validate context
      expect(result.config.context.workspaceMode).toBe('in-place');
      expect(result.config.context.projectRoot).toBeTruthy();
    });
  });
});
