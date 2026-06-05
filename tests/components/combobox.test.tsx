// @vitest-environment jsdom
import React from 'react';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SingleCombobox } from '@/components/ui/combobox';

describe('SingleCombobox', () => {
  test('keeps selected display visible while the input remains focused', () => {
    render(
      <SingleCombobox
        value="defender"
        onValueChange={() => {}}
        options={[
          { value: 'defender', label: 'Defender Agent' },
          { value: 'judge', label: 'Judge Agent' },
        ]}
      />
    );

    const selectedDisplay = screen.getByText('Defender Agent');
    expect(selectedDisplay.parentElement).not.toHaveClass('peer-focus:hidden');
  });
});
