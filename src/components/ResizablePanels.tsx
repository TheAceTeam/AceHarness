'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/core/utils';

type WorkflowRunDockPanelId = 'left' | 'center' | 'right';

interface ResizableThreePanelsProps {
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
  storageKey?: string;
}

const PANEL_TITLES: Record<WorkflowRunDockPanelId, string> = {
  left: '运行信息',
  center: '执行工作区',
  right: '输出详情',
};

const DEFAULT_STORAGE_KEY = 'aceharness:workflow-run:dock-layout:v3';
const SIDE_PANEL_DEFAULT_WIDTH = 400;
const SIDE_PANEL_MIN_WIDTH = 280;
const SIDE_PANEL_MAX_WIDTH = 720;

export const WORKFLOW_RUN_RESTORE_EVENT = 'aceharness:workflow-run-dock:restore-panel';
export const WORKFLOW_RUN_HIDE_EVENT = 'aceharness:workflow-run-dock:hide-panel';
export const WORKFLOW_RUN_RESET_EVENT = 'aceharness:workflow-run-dock:reset-layout';
export const WORKFLOW_RUN_VISIBILITY_EVENT = 'aceharness:workflow-run-dock:visibility';

export type WorkflowRunWindowId = WorkflowRunDockPanelId | 'summary' | 'directory';

type DockLayoutState = {
  left: boolean;
  right: boolean;
  leftWidth: number;
  rightWidth: number;
};

const DEFAULT_LAYOUT: DockLayoutState = {
  left: true,
  right: true,
  leftWidth: SIDE_PANEL_DEFAULT_WIDTH,
  rightWidth: SIDE_PANEL_DEFAULT_WIDTH,
};

function dispatchWorkflowRunVisibility(detail: Partial<Record<WorkflowRunWindowId, boolean>>) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WORKFLOW_RUN_VISIBILITY_EVENT, { detail }));
}

export function dispatchWorkflowRunRestore(id: WorkflowRunWindowId) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WORKFLOW_RUN_RESTORE_EVENT, { detail: { id } }));
}

export function dispatchWorkflowRunHide(id: WorkflowRunWindowId) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WORKFLOW_RUN_HIDE_EVENT, { detail: { id } }));
}

export function dispatchWorkflowRunResetLayout() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WORKFLOW_RUN_RESET_EVENT));
}

function clampPanelWidth(width: unknown) {
  if (typeof width !== 'number' || !Number.isFinite(width)) return SIDE_PANEL_DEFAULT_WIDTH;
  return Math.min(SIDE_PANEL_MAX_WIDTH, Math.max(SIDE_PANEL_MIN_WIDTH, Math.round(width)));
}

function readStoredLayout(storageKey: string): DockLayoutState {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<DockLayoutState>;
    return {
      left: parsed.left !== false,
      right: parsed.right !== false,
      leftWidth: clampPanelWidth(parsed.leftWidth),
      rightWidth: clampPanelWidth(parsed.rightWidth),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function PanelShell({
  id,
  title,
  children,
  onClose,
}: {
  id: WorkflowRunDockPanelId;
  title: string;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col border-border/70 bg-background" data-panel-id={id}>
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/70 bg-muted/30 px-2">
        <div className="truncate text-xs font-medium text-muted-foreground">{title}</div>
        {onClose ? (
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
            aria-label={`关闭 ${title}`}
            title="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

function ResizeHandle({
  side,
  onResize,
}: {
  side: 'left' | 'right';
  onResize: (deltaX: number) => void;
}) {
  const dragStartRef = useRef<{ x: number } | null>(null);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStartRef.current = { x: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current;
    if (!dragStart) return;
    const rawDelta = event.clientX - dragStart.x;
    const delta = side === 'left' ? rawDelta : -rawDelta;
    dragStartRef.current = { x: event.clientX };
    onResize(delta);
  }, [onResize, side]);

  const stopDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
  }, []);

  return (
    <div
      className="group flex h-full w-1.5 shrink-0 cursor-col-resize items-stretch justify-center bg-border/30 transition-colors hover:bg-primary/25"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <div className="h-full w-px bg-border transition-colors group-hover:bg-primary/50" />
    </div>
  );
}

export default function ResizablePanels({
  leftPanel,
  centerPanel,
  rightPanel,
  storageKey = DEFAULT_STORAGE_KEY,
}: ResizableThreePanelsProps) {
  const [layout, setLayout] = useState<DockLayoutState>(() => readStoredLayout(storageKey));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {}
  }, [layout, storageKey]);

  useEffect(() => {
    dispatchWorkflowRunVisibility({
      left: layout.left,
      center: true,
      right: layout.right,
    });
  }, [layout.left, layout.right]);

  const setPanelVisible = useCallback((id: WorkflowRunDockPanelId, visible: boolean) => {
    if (id === 'center') return;
    setLayout((current) => ({ ...current, [id]: visible }));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT);
  }, []);

  useEffect(() => {
    const restoreListener = (event: Event) => {
      const id = (event as CustomEvent<{ id?: WorkflowRunWindowId }>).detail?.id;
      if (id === 'left' || id === 'right') setPanelVisible(id, true);
    };
    const hideListener = (event: Event) => {
      const id = (event as CustomEvent<{ id?: WorkflowRunWindowId }>).detail?.id;
      if (id === 'left' || id === 'right') setPanelVisible(id, false);
    };
    const resetListener = () => resetLayout();
    window.addEventListener(WORKFLOW_RUN_RESTORE_EVENT, restoreListener);
    window.addEventListener(WORKFLOW_RUN_HIDE_EVENT, hideListener);
    window.addEventListener(WORKFLOW_RUN_RESET_EVENT, resetListener);
    return () => {
      window.removeEventListener(WORKFLOW_RUN_RESTORE_EVENT, restoreListener);
      window.removeEventListener(WORKFLOW_RUN_HIDE_EVENT, hideListener);
      window.removeEventListener(WORKFLOW_RUN_RESET_EVENT, resetListener);
    };
  }, [resetLayout, setPanelVisible]);

  const resizeLeft = useCallback((deltaX: number) => {
    setLayout((current) => ({ ...current, leftWidth: clampPanelWidth(current.leftWidth + deltaX) }));
  }, []);

  const resizeRight = useCallback((deltaX: number) => {
    setLayout((current) => ({ ...current, rightWidth: clampPanelWidth(current.rightWidth + deltaX) }));
  }, []);

  const containerClassName = useMemo(() => cn(
    'relative h-full min-h-0 min-w-0 flex-1 overflow-hidden',
    'ace-workflow-run-dock',
  ), []);

  return (
    <div className={containerClassName}>
      <div className="flex h-full min-h-0 w-full overflow-hidden border border-border/60 bg-background">
        {layout.left ? (
          <>
            <div className="h-full min-h-0 shrink-0 overflow-hidden" style={{ width: layout.leftWidth }}>
              <PanelShell id="left" title={PANEL_TITLES.left} onClose={() => setPanelVisible('left', false)}>
                {leftPanel}
              </PanelShell>
            </div>
            <ResizeHandle side="left" onResize={resizeLeft} />
          </>
        ) : null}

        <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
          <PanelShell id="center" title={PANEL_TITLES.center}>
            {centerPanel}
          </PanelShell>
        </div>

        {layout.right ? (
          <>
            <ResizeHandle side="right" onResize={resizeRight} />
            <div className="h-full min-h-0 shrink-0 overflow-hidden" style={{ width: layout.rightWidth }}>
              <PanelShell id="right" title={PANEL_TITLES.right} onClose={() => setPanelVisible('right', false)}>
                {rightPanel}
              </PanelShell>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
