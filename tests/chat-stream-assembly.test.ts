import { describe, expect, test } from 'vitest';

import { buildFinalRawContent } from '@/contexts/ChatContext';

describe('chat stream assembly', () => {
  test('completes a trailing ACP result chunk from done when delta stops mid-json', () => {
    const streamed = [
      'All three PRs are compatible.',
      '',
      '<!-- chunk-boundary -->',
      '',
      '{"isCompatible": true, "reason": "align build.py and docs with existing envsetup behavior.", "uuid": "compat_req_1779419820757_05ce3214b82d4',
    ].join('\n');
    const doneResult = [
      '<!-- chunk-boundary -->',
      '',
      '{"isCompatible": true, "reason": "align build.py and docs with existing envsetup behavior.", "uuid": "compat_req_1779419820757_05ce3214b82d4","sessionId":"ses_1"}',
    ].join('\n');

    expect(buildFinalRawContent(streamed, streamed, doneResult)).toBe(
      `${streamed}","sessionId":"ses_1"}`
    );
  });

  test('extends the raw stream when done returns the full final message', () => {
    expect(buildFinalRawContent('Hello wor', 'Hello wor', 'Hello world')).toBe('Hello world');
  });

  test('recovers the full ACP done result when the connected stream only saw the suffix', () => {
    const streamedSuffix = '{"files": ["ace.js"]}';
    const doneResult = [
      '<ace-process>{"kind":"tool-call","toolName":"read","toolId":"tool-1"}</ace-process>',
      '',
      '<ace-process>{"kind":"tool-result","toolName":"read","output":"ace.js","toolId":"tool-1"}</ace-process>',
      '',
      '<!-- chunk-boundary -->',
      '',
      streamedSuffix,
    ].join('\n');

    expect(buildFinalRawContent(streamedSuffix, streamedSuffix, doneResult)).toBe(doneResult);
  });
});
