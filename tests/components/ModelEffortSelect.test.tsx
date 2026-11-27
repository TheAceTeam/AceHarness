// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ModelEffortSelect } from '@/components/ModelEffortSelect';
afterEach(cleanup);
test('keeps the effort entry visible when model metadata is missing', () => {
  render(<ModelEffortSelect value="" onChange={vi.fn()} />);
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.getByText('思考强度')).toBeInTheDocument();
});
test('offers advertised efforts and retains an older selection without inventing choices', async () => {
  const onChange = vi.fn();
  render(<ModelEffortSelect value="legacy" efforts={['low', 'future']} onChange={onChange} />);
  expect(screen.getByText('legacy')).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'ultra' })).toBeNull();
  await userEvent.setup().click(screen.getByRole('combobox'));
  await userEvent.setup().click(await screen.findByRole('option', { name: 'future' }));
  expect(onChange).toHaveBeenCalledWith('future');
});
