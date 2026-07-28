// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import LanguageSelectorDropdown from '@/components/ui/language-selector-dropdown';

describe('LanguageSelectorDropdown', () => {
  test('keeps the dropdown arrow anchored inside a narrow trigger', () => {
    render(<LanguageSelectorDropdown className="w-12" />);

    const trigger = screen.getByRole('button', { name: '切换语言' });
    const chevron = trigger.querySelector('svg');
    const value = trigger.querySelector('span');

    expect(trigger).toHaveClass('relative', 'min-w-0', 'overflow-hidden', 'pr-9');
    expect(value).toHaveClass('min-w-0', 'overflow-hidden');
    expect(chevron).toHaveClass('absolute', 'right-3', 'pointer-events-none');
  });
});
