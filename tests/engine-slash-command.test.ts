import { describe, expect, test } from 'vitest';
import { normalizeEngineNamespacedSlashCommand } from '@/lib/chat/engine-slash-command';

describe('engine namespaced slash commands', () => {
  test('converts matching OpenCode commands to raw engine slash prompts', () => {
    expect(normalizeEngineNamespacedSlashCommand('/opencode:init', 'opencode-sdk')).toEqual({
      prompt: '/init',
      rawPrompt: true,
    });
    expect(normalizeEngineNamespacedSlashCommand('/opencode:skill customize-opencode', 'opencode')).toEqual({
      prompt: '/skill customize-opencode',
      rawPrompt: true,
    });
  });

  test('leaves native and mismatched slash commands unchanged', () => {
    expect(normalizeEngineNamespacedSlashCommand('/compact', 'opencode-sdk')).toEqual({
      prompt: '/compact',
      rawPrompt: false,
    });
    expect(normalizeEngineNamespacedSlashCommand('/opencode:init', 'claude-code')).toEqual({
      prompt: '/opencode:init',
      rawPrompt: false,
    });
  });

  test('accepts logical namespaces for ACP engines', () => {
    expect(normalizeEngineNamespacedSlashCommand('/claude-code:help', 'claude-code-acp')).toEqual({
      prompt: '/help',
      rawPrompt: true,
    });
    expect(normalizeEngineNamespacedSlashCommand('/cursor:command arg', 'cursor')).toEqual({
      prompt: '/command arg',
      rawPrompt: true,
    });
    expect(normalizeEngineNamespacedSlashCommand('/trae-cli:plan now', 'trae-cli')).toEqual({
      prompt: '/plan now',
      rawPrompt: true,
    });
  });
});
