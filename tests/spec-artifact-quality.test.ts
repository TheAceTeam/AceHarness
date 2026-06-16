import { describe, expect, test } from 'vitest';
import { validateSpecArtifactsQuality } from '@/lib/spec/artifact-quality';
import { buildSpecCodingFromWorkflowConfig } from '@/lib/spec/coding-store';

function config() {
  return {
    workflow: {
      name: 'Quality Workflow',
      phases: [
        {
          name: 'Plan',
          steps: [{ name: 'Plan step', agent: 'architect', task: 'Plan implementation' }],
        },
        {
          name: 'Build',
          steps: [{ name: 'Build step', agent: 'developer', task: 'Build implementation' }],
        },
      ],
    },
    context: {
      projectRoot: 'C:\\tmp\\quality',
      workspaceMode: 'in-place',
      requirements: 'Create a high quality spec',
    },
  };
}

describe('spec artifact quality', () => {
  test('accepts generated SpecCoding baseline artifacts', () => {
    const specCoding = buildSpecCodingFromWorkflowConfig({
      workflowName: 'Quality Workflow',
      filename: 'quality.yaml',
      workingDirectory: 'C:\\tmp\\quality',
      workspaceMode: 'in-place',
      requirements: 'Create a high quality spec',
      description: 'Quality gate test',
      config: config(),
    });

    const report = validateSpecArtifactsQuality(specCoding.artifacts);

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.taskValidation.ok).toBe(true);
  });

  test('rejects placeholder-only artifacts', () => {
    const report = validateSpecArtifactsQuality({
      requirements: '# 需求文档：X\n\n## 需求\n\n### 需求 R1：占位\n\nTODO',
      design: '# 设计文档：X\n\nTODO',
      tasks: '# 实现计划：X\n\n## 任务\n\n- [ ] T1.1 TODO',
    });

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain('requirements_placeholder');
    expect(report.errors.map((issue) => issue.code)).toContain('design_placeholder');
    expect(report.errors.map((issue) => issue.code)).toContain('tasks_placeholder');
  });
});

