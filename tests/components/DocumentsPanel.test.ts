import { describe, expect, test } from 'vitest';
import {
  extractDocumentHighlights,
  findRunDocumentByWorkspacePath,
  formatDocumentPhaseLabel,
  getDocumentFolderGroup,
  type DocFile,
} from '@/components/DocumentsPanel';
import { queryKeys } from '@/client/query/query-keys';

describe('DocumentsPanel folder grouping', () => {
  test('turns workflow phase ids into readable stage labels', () => {
    expect(formatDocumentPhaseLabel('evidence_intake')).toBe('证据接收与核验');
    expect(formatDocumentPhaseLabel('metric_calc')).toBe('指标计算');
    expect(formatDocumentPhaseLabel('report_checkpoint')).toBe('最终汇总与检查');
    expect(formatDocumentPhaseLabel('custom_validation')).toBe('custom · 验证');
  });

  test('normalizes spaces around filename hyphens for fallback folder labels', () => {
    const compact = getDocumentFolderGroup({
      filename: '根因定位-定位空指针路径.md',
      phaseName: '',
      documentSource: 'runtime-output',
    });
    const spaced = getDocumentFolderGroup({
      filename: '根因定位 - 定位空指针路径.md',
      phaseName: '',
      documentSource: 'runtime-output',
    });

    expect(compact.label).toBe('运行输出 / 根因定位');
    expect(spaced.label).toBe('运行输出 / 根因定位');
    expect(spaced.key).toBe(compact.key);
  });

  test('uses workflow phase or state metadata before parsing filenames', () => {
    const spaceLabel = getDocumentFolderGroup({
      filename: '2026-03-20T14-30-00-ArkUI DSL 获取-解析 UX DSL.md',
      phaseName: 'ArkUI DSL 获取',
      documentSource: 'runtime-output',
    });
    const hyphenLabel = getDocumentFolderGroup({
      filename: '2026-03-20T14-30-00-ArkUI-DSL 获取-解析 UX DSL.md',
      phaseName: 'ArkUI-DSL 获取',
      documentSource: 'runtime-output',
    });

    expect(spaceLabel.label).toBe('运行输出 / ArkUI DSL 获取');
    expect(hyphenLabel.label).toBe('运行输出 / ArkUI-DSL 获取');
    expect(hyphenLabel.key).toBe(spaceLabel.key);
  });

  test('keeps tasklist and runtime-output folders separate for each child run', () => {
    const tasklist = getDocumentFolderGroup({
      filename: 'plan.md',
      phaseName: '',
      documentSource: 'tasklist',
      sourceRunId: 'child-run',
      sourceLabel: '子工作流 / 实现',
    });
    const runtimeOutput = getDocumentFolderGroup({
      filename: 'plan.md',
      phaseName: '',
      documentSource: 'runtime-output',
      sourceRunId: 'child-run',
      sourceLabel: '子工作流 / 实现',
    });

    expect(tasklist.label).toBe('任务文档 / 子工作流 / 实现 / plan');
    expect(runtimeOutput.label).toBe('运行输出 / 子工作流 / 实现 / plan');
    expect(tasklist.key).not.toBe(runtimeOutput.key);
  });
});

describe('DocumentsPanel summary highlights', () => {
  test('prioritizes conclusion, risk, action and evidence sections', () => {
    const highlights = extractDocumentHighlights(`
# 授信审查报告
## 关键结论
- 建议有条件批准 5000 万元增额授信。
## 主要风险
- 回款覆盖率低于内部审查阈值。
## 后续行动
1. 放款前补齐母公司担保文件。
## 核验依据
- 财务模型与交叉核验台账结论一致。
`);

    expect(highlights.map((item) => item.kind)).toEqual(['conclusion', 'risk', 'action', 'evidence']);
    expect(highlights[0].points[0]).toContain('有条件批准');
  });

  test('falls back to a compact bullet overview for flat documents', () => {
    const highlights = extractDocumentHighlights(`
- 第一项关键发现需要业务复核。
- 第二项风险需要补充证明材料。
- 第三项行动是在放款前完成整改。
`);

    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({ kind: 'summary', heading: '重点摘要' });
    expect(highlights[0].points).toHaveLength(3);
  });
});

describe('DocumentsPanel run document links', () => {
  test('uses source-qualified content cache keys for same-name documents', () => {
    const tasklistKey = queryKeys.documentContent('run-1', {
      source: 'tasklist',
      sourceRunId: 'run-1',
      file: 'plan.md',
    });
    const runtimeOutputKey = queryKeys.documentContent('run-1', {
      source: 'runtime-output',
      sourceRunId: 'run-1',
      file: 'plan.md',
    });

    expect(tasklistKey).not.toEqual(runtimeOutputKey);
  });

  test('matches an encoded absolute workspace link to its run artifact', () => {
    const file = {
      filename: '2026-07-14T00-56-52-evidence_intake-交叉核验台账列矛盾.md',
      baseName: '2026-07-14T00-56-52-evidence_intake-交叉核验台账列矛盾.md',
    } as DocFile;

    const matched = findRunDocumentByWorkspacePath(
      [file],
      '/Users/demo/ace-workspace/2026-07-14T00-56-52-evidence_intake-%E4%BA%A4%E5%8F%89%E6%A0%B8%E9%AA%8C%E5%8F%B0%E8%B4%A6%E5%88%97%E7%9F%9B%E7%9B%BE.md#result',
    );

    expect(matched).toBe(file);
  });

  test('uses the source root for duplicate filenames and leaves ambiguous bare paths unopened', () => {
    const tasklistFile = {
      filename: 'plan.md',
      relativePath: 'plan.md',
      documentSource: 'tasklist',
      documentDirectory: '/workspace/docs/tasklists/current',
    } as DocFile;
    const runtimeOutputFile = {
      filename: 'plan.md',
      relativePath: 'plan.md',
      documentSource: 'runtime-output',
      documentDirectory: '/workspace/.aceharness/data/runs/run-1/outputs',
    } as DocFile;

    expect(findRunDocumentByWorkspacePath(
      [tasklistFile, runtimeOutputFile],
      '/workspace/.aceharness/data/runs/run-1/outputs/plan.md',
    )).toBe(runtimeOutputFile);
    expect(findRunDocumentByWorkspacePath(
      [tasklistFile, runtimeOutputFile],
      '/unrelated/plan.md',
    )).toBeNull();
  });
});
