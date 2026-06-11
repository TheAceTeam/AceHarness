// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ModelSelect } from '@/components/ModelSelect';

const toastSpy = vi.fn();

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock('@/components/AiModelSelectorField', () => ({
  AiModelSelectorField: ({ disabled, onValueChange, options = [] }: any) => (
    <button
      type="button"
      disabled={disabled || options.length === 0}
      onClick={() => onValueChange(options[0].value)}
    >
      {options[0]?.label || 'loading'}
    </button>
  ),
}));

describe('ModelSelect', () => {
  beforeEach(() => {
    toastSpy.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        models: [
          {
            value: 'gpt-5',
            label: 'GPT-5',
            costMultiplier: 1,
          },
        ],
      }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('suppresses change toast when showChangeToast is false', async () => {
    const onChange = vi.fn();
    render(<ModelSelect value="" onChange={onChange} showChangeToast={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'GPT-5' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('gpt-5'));
    expect(toastSpy).not.toHaveBeenCalled();
  });

  test('shows a change toast by default', async () => {
    const onChange = vi.fn();
    render(<ModelSelect value="" onChange={onChange} />);

    fireEvent.click(await screen.findByRole('button', { name: 'GPT-5' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('gpt-5'));
    expect(toastSpy).toHaveBeenCalledWith('info', '模型已切换: GPT-5 (1x)');
  });
});
