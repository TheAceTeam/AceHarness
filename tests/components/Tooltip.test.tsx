// @vitest-environment jsdom
import React from 'react';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

describe('TooltipContent', () => {
  test('renders through a portal instead of inside the trigger container', () => {
    render(
      <div data-testid="host">
        <TooltipProvider delayDuration={0}>
          <Tooltip open>
            <TooltipTrigger asChild>
              <button type="button">trigger</button>
            </TooltipTrigger>
            <TooltipContent>头像提示</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>,
    );

    const host = screen.getByTestId('host');
    const tooltip = screen.getByRole('tooltip');

    expect(document.body).toContainElement(tooltip);
    expect(host).not.toContainElement(tooltip);
  });
});
