// @vitest-environment jsdom
'use client';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ToastProvider, useToast } from '@/components/ui/toast';

function ToastHarness() {
  const { toast, updateToast } = useToast();

  return (
    <div>
      <button type="button" onClick={() => toast('info', '信息提示')}>
        info
      </button>
      <button
        type="button"
        onClick={() => {
          const id = toast('loading', '加载中');
          updateToast(id, 'info', '加载完成');
        }}
      >
        loading-to-info
      </button>
    </div>
  );
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  test('auto dismisses info toasts after 3 seconds', () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'info' }));
    expect(screen.getByText('信息提示')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText('信息提示')).toBeNull();
  });

  test('auto dismisses toasts updated to info after 3 seconds', () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'loading-to-info' }));
    expect(screen.getByText('加载完成')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText('加载完成')).toBeNull();
  });
});
