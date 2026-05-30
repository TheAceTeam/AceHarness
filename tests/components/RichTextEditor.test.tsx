// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { insertMarkdownAtSelection } from '@/components/ui/RichTextEditor';

describe('RichTextEditor markdown paste helpers', () => {
  test('inserts markdown through the command API without re-entering paste handling', () => {
    const insertContent = vi.fn(() => true);
    const pasteText = vi.fn(() => {
      throw new Error('pasteText should not be called from handlePaste');
    });

    const result = insertMarkdownAtSelection(
      {
        isDestroyed: false,
        commands: { insertContent },
        view: { pasteText },
      } as any,
      '# Report\n\n- item\n',
    );

    expect(result).toBe(true);
    expect(insertContent).toHaveBeenCalledWith('# Report\n\n- item\n', { contentType: 'markdown' });
    expect(pasteText).not.toHaveBeenCalled();
  });

  test('can trim trailing newlines before markdown insertion', () => {
    const insertContent = vi.fn(() => true);

    insertMarkdownAtSelection(
      {
        isDestroyed: false,
        commands: { insertContent },
      },
      '## Title\n\n\n',
      { trimTrailingNewlines: true },
    );

    expect(insertContent).toHaveBeenCalledWith('## Title', { contentType: 'markdown' });
  });
});
