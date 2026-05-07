import { describe, expect, test, vi } from 'vitest';
import { parseNeedInfo, routeInfoRequest } from '@/lib/supervisor-router';
import type { AgentSummary } from '@/lib/supervisor-router';

const mockStep = { name: 'test-step', agent: 'developer', task: 'do something' };

describe('parseNeedInfo', () => {
  test('extracts single NEED_INFO block', () => {
    // The regex captures until the next [NEED_INFO] tag or end of string
    const output = 'Some text\n[NEED_INFO]\nWhat is the API endpoint?';
    const requests = parseNeedInfo(mockStep, output);
    expect(requests).toHaveLength(1);
    expect(requests[0].fromAgent).toBe('developer');
    expect(requests[0].question).toBe('What is the API endpoint?');
    expect(requests[0].isHuman).toBe(false);
  });

  test('extracts multiple NEED_INFO blocks', () => {
    const output = '[NEED_INFO]\nQuestion 1\n[NEED_INFO]\nQuestion 2';
    const requests = parseNeedInfo(mockStep, output);
    expect(requests).toHaveLength(2);
    expect(requests[0].question).toBe('Question 1');
    expect(requests[1].question).toBe('Question 2');
  });

  test('detects :human variant', () => {
    const output = '[NEED_INFO:human]\nPlease approve this design.';
    const requests = parseNeedInfo(mockStep, output);
    expect(requests).toHaveLength(1);
    expect(requests[0].isHuman).toBe(true);
    expect(requests[0].question).toBe('Please approve this design.');
  });

  test('handles multi-line question body', () => {
    const output = '[NEED_INFO]\nLine 1\nLine 2\nLine 3';
    const requests = parseNeedInfo(mockStep, output);
    expect(requests).toHaveLength(1);
    expect(requests[0].question).toContain('Line 1');
    expect(requests[0].question).toContain('Line 2');
    expect(requests[0].question).toContain('Line 3');
  });

  test('returns empty array when no NEED_INFO found', () => {
    const output = 'Just regular output with no special tags.';
    expect(parseNeedInfo(mockStep, output)).toEqual([]);
  });

  test('skips empty questions', () => {
    // NEED_INFO with only whitespace content (end of string) gets filtered out
    const output = '[NEED_INFO]\n   \n';
    const requests = parseNeedInfo(mockStep, output);
    // The captured content is whitespace-only, trimmed to empty, skipped by if(question)
    expect(requests).toHaveLength(0);
  });
});

describe('routeInfoRequest', () => {
  const agents: AgentSummary[] = [
    { name: 'security-expert', description: 'Handles security reviews', keywords: ['security', 'vulnerability', 'CVE'] },
    { name: 'performance-analyst', description: 'Performance analysis', keywords: ['performance', 'latency', 'benchmark'] },
    { name: 'code-reviewer', description: 'Code review', keywords: ['review', 'code quality'] },
  ];

  test('routes to agent matching keyword in question', async () => {
    const req = { fromAgent: 'developer', question: 'Is there a security vulnerability in this code?', isHuman: false };
    const decision = await routeInfoRequest(req, agents, 'test-step');
    expect(decision).not.toBeNull();
    expect(decision!.route_to).toBe('security-expert');
    expect(decision!.method).toBe('keyword');
  });

  test('keyword match is case-insensitive', async () => {
    const req = { fromAgent: 'developer', question: 'Check PERFORMANCE of this function', isHuman: false };
    const decision = await routeInfoRequest(req, agents, 'test-step');
    expect(decision).not.toBeNull();
    expect(decision!.route_to).toBe('performance-analyst');
  });

  test('returns null when no keyword matches and no llmCaller', async () => {
    const req = { fromAgent: 'developer', question: 'What color should the button be?', isHuman: false };
    const decision = await routeInfoRequest(req, agents, 'test-step');
    expect(decision).toBeNull();
  });

  test('falls back to llmCaller when no keyword match', async () => {
    const req = { fromAgent: 'developer', question: 'What color should the button be?', isHuman: false };
    const llmCaller = vi.fn().mockResolvedValue('code-reviewer');
    const decision = await routeInfoRequest(req, agents, 'test-step', llmCaller);
    expect(decision).not.toBeNull();
    expect(decision!.route_to).toBe('code-reviewer');
    expect(decision!.method).toBe('llm');
    expect(llmCaller).toHaveBeenCalledOnce();
  });

  test('llmCaller response with fuzzy agent name match', async () => {
    const req = { fromAgent: 'developer', question: 'Help me with something', isHuman: false };
    const llmCaller = vi.fn().mockResolvedValue('I think the security-expert should handle this');
    const decision = await routeInfoRequest(req, agents, 'test-step', llmCaller);
    expect(decision).not.toBeNull();
    expect(decision!.route_to).toBe('security-expert');
  });

  test('returns null when llmCaller returns unmatched name', async () => {
    const req = { fromAgent: 'developer', question: 'Help', isHuman: false };
    const llmCaller = vi.fn().mockResolvedValue('nonexistent-agent');
    const decision = await routeInfoRequest(req, agents, 'test-step', llmCaller);
    expect(decision).toBeNull();
  });

  test('returns null when llmCaller throws', async () => {
    const req = { fromAgent: 'developer', question: 'Help', isHuman: false };
    const llmCaller = vi.fn().mockRejectedValue(new Error('LLM error'));
    const decision = await routeInfoRequest(req, agents, 'test-step', llmCaller);
    expect(decision).toBeNull();
  });

  test('first matching keyword wins when multiple agents match', async () => {
    const req = { fromAgent: 'developer', question: 'security review needed', isHuman: false };
    const decision = await routeInfoRequest(req, agents, 'test-step');
    expect(decision!.route_to).toBe('security-expert');
  });
});
