// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import ResizablePanels, {
  dispatchWorkflowRunHide,
  dispatchWorkflowRunRestore,
  dispatchWorkflowRunResetLayout,
  WORKFLOW_RUN_VISIBILITY_EVENT,
} from '@/components/ResizablePanels';

describe('ResizablePanels', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  test('toggles side panels through workflow window events without remounting a dock grid', async () => {
    const visibilityEvents: Array<Partial<Record<string, boolean>>> = [];
    const handleVisibility = (event: Event) => {
      visibilityEvents.push((event as CustomEvent<Partial<Record<string, boolean>>>).detail);
    };
    window.addEventListener(WORKFLOW_RUN_VISIBILITY_EVENT, handleVisibility);

    render(
      <ResizablePanels
        leftPanel={<div>left-content</div>}
        centerPanel={<div>center-content</div>}
        rightPanel={<div>right-content</div>}
        storageKey="aceharness:test:workflow-run-layout"
      />,
    );

    expect(screen.getByText('left-content')).toBeInTheDocument();
    expect(screen.getByText('center-content')).toBeInTheDocument();
    expect(screen.getByText('right-content')).toBeInTheDocument();

    dispatchWorkflowRunHide('left');
    await waitFor(() => expect(screen.queryByText('left-content')).not.toBeInTheDocument());
    expect(screen.getByText('center-content')).toBeInTheDocument();

    dispatchWorkflowRunRestore('left');
    await waitFor(() => expect(screen.getByText('left-content')).toBeInTheDocument());

    dispatchWorkflowRunHide('right');
    await waitFor(() => expect(screen.queryByText('right-content')).not.toBeInTheDocument());

    dispatchWorkflowRunRestore('right');
    await waitFor(() => expect(screen.getByText('right-content')).toBeInTheDocument());

    dispatchWorkflowRunResetLayout();
    await waitFor(() => {
      expect(screen.getByText('left-content')).toBeInTheDocument();
      expect(screen.getByText('right-content')).toBeInTheDocument();
    });

    expect(visibilityEvents.some((event) => event.left === false)).toBe(true);
    expect(visibilityEvents.some((event) => event.right === false)).toBe(true);

    window.removeEventListener(WORKFLOW_RUN_VISIBILITY_EVENT, handleVisibility);
  });
});
