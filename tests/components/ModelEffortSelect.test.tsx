// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ModelEffortSelect } from '@/components/ModelEffortSelect';
afterEach(cleanup);
test('offers advertised efforts and retains an older selection without inventing choices', async () => {
  const onChange = vi.fn();
  render(<ModelEffortSelect value="legacy" efforts={['low', 'future']} onChange={onChange} />);
  expect(screen.getByRole('combobox')).toHaveValue('legacy');
  expect(screen.queryByRole('option', { name: 'ultra' })).toBeNull();
  await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'future');
  expect(onChange).toHaveBeenCalledWith('future');
});
