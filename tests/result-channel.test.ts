import { describe, expect, test } from 'vitest';
import { extractJsonObject, extractStructuredResult, getResultSections } from '@/lib/ai/result-channel';

describe('result-channel', () => {
  test('parses bare json payload', () => {
    expect(extractJsonObject('{"kind":"home_sidebar","payload":{"activeTab":"workflow"}}')).toEqual({
      kind: 'home_sidebar',
      payload: { activeTab: 'workflow' },
    });
  });

  test('parses legacy fenced json payload', () => {
    expect(extractJsonObject('```json\n{"kind":"card","payload":{"blocks":[]}}\n```')).toEqual({
      kind: 'card',
      payload: { blocks: [] },
    });
  });

  test('repairs lightly malformed json payloads', () => {
    expect(extractJsonObject('{kind: "home_sidebar", payload: {activeTab: workflow}}')).toEqual({
      kind: 'home_sidebar',
      payload: { activeTab: 'workflow' },
    });
  });

  test('uses schema-guided repair for known result protocols', () => {
    expect(extractJsonObject('{"kind":"spec_coding_revision","payload":{"apply":"true","affectedArtifacts":"tasks.md","impact":["ok"]}}')).toEqual({
      kind: 'spec_coding_revision',
      payload: {
        apply: true,
        affectedArtifacts: ['tasks.md'],
        impact: ['ok'],
      },
    });
  });

  test('extracts structured result from result channel', () => {
    const markdown = [
      '说明文字',
      '<result>',
      '{"kind":"workflow_draft","payload":{"filename":"wf.yaml","config":{"workflow":{"name":"x"}}}}',
      '</result>',
    ].join('\n');

    const parsed = extractStructuredResult(markdown, (value: any): value is any => value?.kind === 'workflow_draft');
    expect(parsed).toEqual({
      kind: 'workflow_draft',
      payload: {
        filename: 'wf.yaml',
        config: { workflow: { name: 'x' } },
      },
    });
  });

  test('collects multiple result sections in order', () => {
    const markdown = [
      '前文',
      '<result>{"kind":"home_sidebar","payload":{"activeTab":"workflow"}}</result>',
      '中间',
      '<result>{"kind":"card","payload":{"blocks":[{"type":"text","content":"ok"}]}}</result>',
    ].join('\n');

    expect(getResultSections(markdown).map((section) => section.content.trim())).toEqual([
      '{"kind":"home_sidebar","payload":{"activeTab":"workflow"}}',
      '{"kind":"card","payload":{"blocks":[{"type":"text","content":"ok"}]}}',
    ]);
  });

  test('ignores result examples inside ace-process tool payloads', () => {
    const markdown = [
      '基于工具结果继续整理。',
      '<ace-process>{"kind":"tool-result","toolName":"read","title":"读取","output":"<result>{\\"kind\\":\\"plan_draft\\",\\"payload\\":{\\"summary\\":\\"模板示例\\"}}</result>"}</ace-process>',
      '<result>{"kind":"plan_draft","payload":{"summary":"正式草案","artifacts":{"requirements":"# req","design":"# design","tasks":"# tasks"}}}</result>',
    ].join('\n');

    expect(getResultSections(markdown).map((section) => section.content.trim())).toEqual([
      '{"kind":"plan_draft","payload":{"summary":"正式草案","artifacts":{"requirements":"# req","design":"# design","tasks":"# tasks"}}}',
    ]);
    const parsed = extractStructuredResult(markdown, (value: any): value is any => value?.kind === 'plan_draft');
    expect(parsed?.payload?.summary).toBe('正式草案');
  });

  test('extracts first matching structured result when multiple result sections exist', () => {
    const markdown = [
      '<result>{"kind":"card","payload":{"blocks":[{"type":"text","content":"first"}]}}</result>',
      '<result>{"kind":"workflow_draft","payload":{"filename":"wf.yaml","config":{"workflow":{"name":"x"}}}}</result>',
      '<result>{"kind":"workflow_draft","payload":{"filename":"wf-2.yaml","config":{"workflow":{"name":"y"}}}}</result>',
    ].join('\n');

    const parsed = extractStructuredResult(markdown, (value: any): value is any => value?.kind === 'workflow_draft');
    expect(parsed?.payload?.filename).toBe('wf.yaml');
  });

  test('supports same-line legacy fenced result payloads', () => {
    expect(extractJsonObject('```json {"type":"home_sidebar","activeTab":"workflow"} ```')).toEqual({
      type: 'home_sidebar',
      activeTab: 'workflow',
    });
  });

  test('returns null for incomplete json payloads', () => {
    expect(extractJsonObject('{"kind":"home_sidebar","payload":{"activeTab":"workflow"')).toBeNull();
  });
});
