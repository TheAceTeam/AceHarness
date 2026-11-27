// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ModelEffortSelect } from '@/components/ModelEffortSelect';
afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
test('hides effort selection for models without effort support', () => {
  render(<ModelEffortSelect value="" onChange={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '思考强度' })).toBeNull();
});
test('offers advertised efforts and retains an older selection without inventing choices', async () => {
  const onChange = vi.fn();
  render(<ModelEffortSelect value="legacy" efforts={['low', 'future']} onChange={onChange} />);
  expect(screen.getByRole('button', { name: '思考强度' })).toHaveTextContent(/^legacy$/);
  await userEvent.setup().click(screen.getByRole('button', { name: '思考强度' }));
  const slider = await screen.findByRole('slider');
  expect(slider).toHaveAttribute('aria-valuemax', '2');
  expect(slider).toHaveAttribute('aria-valuetext', 'legacy');
  expect(slider.querySelectorAll('[data-slot="effort-slider-tick"]')).toHaveLength(3);
  slider.focus();
  await userEvent.setup().keyboard('{Home}{ArrowRight}');
  expect(onChange).toHaveBeenCalledWith('future');
});

test('renders a single advertised level without invalid slider geometry', async () => {
  render(<ModelEffortSelect value="only" efforts={['only']} onChange={vi.fn()} />);
  await userEvent.setup().click(screen.getByRole('button', { name: '思考强度' }));
  const slider = await screen.findByRole('slider');
  expect(slider).toHaveAttribute('aria-valuemax', '0');
  const tick = slider.querySelector('[data-slot="effort-slider-tick"]') as HTMLElement;
  expect(tick.style.left).not.toContain('NaN');
  expect(slider).toHaveAttribute('aria-valuetext', 'only');
});
