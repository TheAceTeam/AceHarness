import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { GridItemHTMLElement, GridStack } from 'gridstack';
import 'gridstack/dist/gridstack.min.css';
import {
  BOARD_COLUMNS, BOARD_DEFAULT_HEIGHT,
  type WorkflowBoardPosition, type WorkflowBoardTile,
} from '@/lib/workspace/workflow-board-layout';

export const BOARD_DRAG_TYPE = 'application/x-ace-workflow-board';

type Props = {
  tiles: WorkflowBoardTile[];
  editing: boolean;
  onLayout: (positions: Map<string, WorkflowBoardPosition>) => void;
  onDropDocument: (filename: string, position: Pick<WorkflowBoardPosition, 'x' | 'y'>) => void;
  children: (tile: WorkflowBoardTile) => ReactNode;
};

function gridPositions(grid: GridStack) {
  const positions = new Map<string, WorkflowBoardPosition>();
  for (const element of grid.getGridItems()) {
    const node = element.gridstackNode;
    if (node?.id == null || node.x == null || node.y == null || node.w == null || node.h == null) continue;
    positions.set(String(node.id), { x: node.x, y: node.y, w: node.w, h: node.h });
  }
  return positions;
}

export function WorkflowBoardGrid({ tiles, editing, onLayout, onDropDocument, children }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState<GridStack>();
  const [failure, setFailure] = useState(false);
  const [hosts, setHosts] = useState<Map<string, HTMLElement>>(() => new Map());
  const currentOnLayout = useRef(onLayout);
  currentOnLayout.current = onLayout;
  const items = useRef(new Map<string, GridItemHTMLElement>());

  useEffect(() => {
    const element = root.current;
    const elements = items.current;
    if (!element) return;
    let live = true;
    let instance: GridStack | undefined;
    void import('gridstack').then(({ GridStack }) => {
      if (!live) return;
      const initialized = GridStack.init({
        column: BOARD_COLUMNS,
        cellHeight: 52,
        margin: 6,
        minRow: BOARD_DEFAULT_HEIGHT,
        staticGrid: true,
        draggable: { handle: '.workflow-board-drag-handle', cancel: 'button,input,[data-board-diagram]' },
        resizable: { handles: 'e,s,se' },
      }, element);
      if (!initialized) throw new Error('Unable to initialize the board grid.');
      instance = initialized;
      const save = () => currentOnLayout.current(gridPositions(initialized));
      initialized.on('dragstop', save).on('resizestop', save);
      setGrid(initialized);
    }).catch(() => { if (live) setFailure(true); });
    return () => {
      live = false;
      instance?.destroy(false);
      elements.clear();
      element.replaceChildren();
    };
  }, []);

  useEffect(() => {
    if (!grid) return;
    grid.setStatic(!editing);
    if (editing) for (const item of items.current.values()) grid.refreshDragHandles(item);
  }, [grid, editing, hosts]);

  useEffect(() => {
    if (!grid) return;
    const elements = items.current;
    const ids = new Set(tiles.map((tile) => tile.id));
    let hostsChanged = false;
    grid.batchUpdate();
    for (const [id, element] of elements) {
      if (ids.has(id)) continue;
      grid.removeWidget(element);
      elements.delete(id);
      hostsChanged = true;
    }
    for (const { id, x, y, w, h } of tiles) {
      const element = elements.get(id);
      if (element) {
        const node = element.gridstackNode;
        if (!node || node.x !== x || node.y !== y || node.w !== w || node.h !== h) grid.update(element, { x, y, w, h });
      } else {
        const widget = grid.addWidget({ id, x, y, w, h, minW: 2, minH: 3, maxH: 100 });
        if (widget) {
          elements.set(id, widget);
          hostsChanged = true;
        }
      }
    }
    grid.batchUpdate(false);
    if (hostsChanged) {
      const next = new Map<string, HTMLElement>();
      for (const [id, element] of elements) {
        const host = element.querySelector<HTMLElement>('.grid-stack-item-content');
        if (host) next.set(id, host);
      }
      setHosts(next);
    }
    if (editing) currentOnLayout.current(gridPositions(grid));
  }, [grid, editing, tiles]);

  function drop(event: DragEvent<HTMLDivElement>) {
    if (!editing || !grid || !event.dataTransfer.types.includes(BOARD_DRAG_TYPE)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(BOARD_COLUMNS - 1, Math.floor((event.clientX - bounds.left) / grid.cellWidth())));
    const y = Math.max(0, Math.floor((event.clientY - bounds.top) / grid.getCellHeight(true)));
    onDropDocument(event.dataTransfer.getData(BOARD_DRAG_TYPE), { x, y });
  }

  return (
    <>
      {failure && <p role="alert" className="px-4 py-3 text-sm text-destructive">看板网格加载失败。</p>}
      <div
        ref={root}
        className={'grid-stack [&_.grid-stack-item-content]:!overflow-hidden'
          + (editing ? ' rounded-lg border border-dashed border-border/80 bg-muted/20' : '')}
        aria-label="看板布局"
        onDragOver={(event) => {
          if (editing && event.dataTransfer.types.includes(BOARD_DRAG_TYPE)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={drop}
      />
      {tiles.map((tile) => {
        const host = hosts.get(tile.id);
        return host ? createPortal(children(tile), host, tile.id) : null;
      })}
    </>
  );
}
