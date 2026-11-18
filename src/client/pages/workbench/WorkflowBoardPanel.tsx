import { useMemo, useState, type ReactNode } from 'react';
import { Check, Ellipsis, GitFork, GripVertical, Group, Image as ImageIcon, Layers, Maximize2, MoveHorizontal, Pencil, Plus, RefreshCw, Trash2, Ungroup, X } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/core/utils';
import {
  BOARD_COLUMNS, BOARD_DEFAULT_HEIGHT, BOARD_MAX_PAGES, BOARD_MAX_TILES,
  defaultWorkflowBoardLayout, groupWorkflowBoardTiles,
  type WorkflowBoardLayout, type WorkflowBoardPage, type WorkflowBoardPosition, type WorkflowBoardTile,
} from '@/lib/workspace/workflow-board-layout';
import { WORKFLOW_BOARD_MAX_BYTES, type WorkflowBoard } from '@/lib/workspace/workflow-boards';
import { BOARD_DRAG_TYPE, WorkflowBoardGrid } from './WorkflowBoardGrid';
import { WorkflowBoardDiagram } from './WorkflowBoardDiagram';
import { WorkflowBoardMarkdown } from './WorkflowBoardMarkdown';

type Props = {
  boards: WorkflowBoard[];
  workspacePath?: string;
  layout: WorkflowBoardLayout | null;
  loading: boolean;
  error: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onSave: (layout: WorkflowBoardLayout) => Promise<void>;
};

function makeId() {
  return 'board-' + Array.from(crypto.getRandomValues(new Uint32Array(2)), (value) => value.toString(36)).join('-');
}

function BoardAction({ label, children, className, ...props }: ButtonProps & { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...props} variant="ghost" size="icon" aria-label={label}
          className={cn('size-8 shrink-0 rounded-md text-muted-foreground hover:text-foreground', className)}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="px-2 py-1 text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

export function WorkflowBoardPanel({ boards, workspacePath = '', layout, loading, error, refreshing, onRefresh, onSave }: Props) {
  const fallback = useMemo(() => defaultWorkflowBoardLayout(boards), [boards]);
  const boardByName = useMemo(() => new Map(boards.map((board) => [board.filename, board])), [boards]);
  const [draft, setDraft] = useState<WorkflowBoardLayout | null>(null);
  const [pageId, setPageId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [focusTile, setFocusTile] = useState<WorkflowBoardTile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const displayed = draft ?? layout ?? fallback;
  const page = displayed.pages.find((item) => item.id === pageId) ?? displayed.pages[0];
  const editing = draft !== null;
  const usedFiles = new Set(page.tiles.flatMap((tile) => tile.files));

  function switchPage(id: string) {
    setPageId(id);
    setSelected(new Set());
  }

  function changePage(update: (page: WorkflowBoardPage) => WorkflowBoardPage) {
    if (saving) return;
    setDraft((current) => {
      if (!current) return current;
      const next = current.pages.map((item) => item.id === page.id ? update(item) : item);
      return next.every((item, index) => item === current.pages[index]) ? current : { ...current, pages: next };
    });
  }

  function addPage() {
    const next: WorkflowBoardPage = { id: makeId(), title: '看板页 ' + (displayed.pages.length + 1), tiles: [] };
    setDraft({ ...displayed, pages: [...displayed.pages, next] });
    switchPage(next.id);
  }

  function addDocument(filename: string, position?: Pick<WorkflowBoardPosition, 'x' | 'y'>) {
    if (!boardByName.has(filename)) return;
    changePage((item) => {
      if (item.tiles.length >= BOARD_MAX_TILES || item.tiles.some((tile) => tile.files.includes(filename))) return item;
      const width = position ? BOARD_COLUMNS / 2 : BOARD_COLUMNS;
      const floor = Math.max(0, ...item.tiles.map((tile) => tile.y + tile.h));
      const tile: WorkflowBoardTile = {
        id: makeId(), files: [filename], x: Math.min(position?.x ?? 0, BOARD_COLUMNS - width),
        y: position?.y ?? floor, w: width, h: BOARD_DEFAULT_HEIGHT,
      };
      return { ...item, tiles: [...item.tiles, tile] };
    });
  }

  function applyGridLayout(positions: Map<string, WorkflowBoardPosition>) {
    changePage((item) => {
      const tiles = item.tiles.map((tile) => {
        const next = positions.get(tile.id);
        return !next || (next.x === tile.x && next.y === tile.y && next.w === tile.w && next.h === tile.h)
          ? tile : { ...tile, ...next };
      });
      return tiles.every((tile, index) => tile === item.tiles[index]) ? item : { ...item, tiles };
    });
  }

  async function save() {
    if (!draft) return;
    const normalized = { ...draft, pages: draft.pages.map((item) => ({ ...item, title: item.title.trim() || '看板页' })) };
    if (new TextEncoder().encode(JSON.stringify(normalized, null, 2) + '\n').length > WORKFLOW_BOARD_MAX_BYTES) {
      setSaveError('看板布局文件太大，请减少页面或卡片后再保存。');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      await onSave(normalized);
      setDraft(null);
      setSelected(new Set());
    } catch (issue) {
      setSaveError(issue instanceof Error ? issue.message : '保存看板布局失败。');
    } finally {
      setSaving(false);
    }
  }

  function renderDocuments(tile: WorkflowBoardTile) {
    return (
      <div
        data-board-diagram
        className={tile.files.length > 1
          ? 'grid h-full min-h-0 min-w-0 gap-3 overflow-hidden [grid-auto-rows:minmax(0,1fr)] [grid-template-columns:repeat(auto-fit,minmax(min(18rem,100%),1fr))]'
          : 'h-full min-h-0 min-w-0 overflow-hidden'}
      >
        {tile.files.map((file) => {
          const board = boardByName.get(file);
          return (
            <section key={file} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
              {tile.files.length > 1 && <h4 className="shrink-0 truncate px-1 text-sm font-medium">{board?.title ?? file}</h4>}
              <div className="min-h-0 flex-1 overflow-hidden">
                {board?.markdown ? <WorkflowBoardMarkdown content={board.markdown} workspace={workspacePath} />
                  : board ? <WorkflowBoardDiagram code={board.diagram} /> : <p className="truncate p-3 text-sm text-muted-foreground">找不到 {file}</p>}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  function tileTitle(tile: WorkflowBoardTile) {
    return tile.files.length === 1 ? boardByName.get(tile.files[0])?.title ?? tile.files[0] : '组合 · ' + tile.files.length + ' 张图';
  }

  function renderTile(tile: WorkflowBoardTile) {
    const title = tileTitle(tile);
    const isSelected = selected.has(tile.id);
    return (
      <article className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm',
        isSelected ? 'border-primary/65 ring-1 ring-inset ring-primary/25' : 'border-border/75')}>
        <header className={cn('workflow-board-drag-handle flex h-11 shrink-0 items-center justify-between gap-1.5 border-b border-border/70 bg-muted/25 px-2.5',
          editing && 'cursor-grab active:cursor-grabbing', isSelected && 'bg-primary/5')}>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {editing && (
              <>
                <GripVertical className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                <input
                  type="checkbox"
                  aria-label={'选中 ' + title}
                  className="size-3.5 shrink-0 cursor-pointer accent-primary"
                  checked={isSelected}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (checked) next.add(tile.id);
                      else next.delete(tile.id);
                      return next;
                    });
                  }}
                />
              </>
            )}
            <h3 className="truncate text-[13px] font-medium" title={title}>{title}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <BoardAction label={'最大化 ' + title} className="size-7" onClick={() => setFocusTile(tile)}>
              <Maximize2 className="size-3.5" aria-hidden="true" />
            </BoardAction>
            {editing && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={title + ' 卡片操作'} title="卡片操作"
                    className="size-7 rounded-md text-muted-foreground hover:text-foreground">
                    <Ellipsis className="size-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem className="gap-2" onSelect={() => changePage((item) => ({
                    ...item, tiles: item.tiles.map((other) => other.id === tile.id ? { ...other, x: 0, w: BOARD_COLUMNS } : other),
                  }))}>
                    <MoveHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />占满一行
                  </DropdownMenuItem>
                  {tile.files.length > 1 && (
                    <DropdownMenuItem className="gap-2" disabled={page.tiles.length - 1 + tile.files.length > BOARD_MAX_TILES}
                      onSelect={() => {
                        changePage((item) => ({
                          ...item,
                          tiles: [...item.tiles.filter((other) => other.id !== tile.id),
                            ...tile.files.map((file, index) => ({
                              id: makeId(), files: [file],
                              x: (index % 2) * (BOARD_COLUMNS / 2), y: tile.y + Math.floor(index / 2) * BOARD_DEFAULT_HEIGHT,
                              w: BOARD_COLUMNS / 2, h: BOARD_DEFAULT_HEIGHT,
                            }))],
                        }));
                        setSelected(new Set());
                      }}>
                      <Ungroup className="size-4 text-muted-foreground" aria-hidden="true" />取消组合
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onSelect={() => {
                    changePage((item) => ({ ...item, tiles: item.tiles.filter((other) => other.id !== tile.id) }));
                    setSelected((previous) => new Set([...previous].filter((id) => id !== tile.id)));
                  }}>
                    <Trash2 className="size-4" aria-hidden="true" />移除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden p-3">{renderDocuments(tile)}</div>
      </article>
    );
  }

  return (
    <TooltipProvider delayDuration={250}>
      <section className="h-full min-h-0 overflow-auto bg-muted/25 text-foreground" aria-label="看板">
        <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-2 border-b border-border/75 bg-background/95 px-3 backdrop-blur-sm sm:px-4">
          <nav className="-mb-px flex min-w-0 items-center gap-0.5 self-stretch overflow-x-auto px-0.5 [scrollbar-width:none] sm:gap-1" aria-label="看板页">
            {displayed.pages.map((item) => (
              <button key={item.id} type="button" aria-pressed={item.id === page.id} onClick={() => switchPage(item.id)}
                title={item.title}
                className={cn('flex max-w-40 shrink-0 items-center gap-1.5 border-b-2 px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-3',
                  item.id === page.id ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                <Layers className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.title || '看板页'}</span>
              </button>
            ))}
            <BoardAction label="添加看板页" className="mx-1" onClick={addPage} disabled={saving || loading || displayed.pages.length >= BOARD_MAX_PAGES}>
              <Plus className="size-4" aria-hidden="true" />
            </BoardAction>
          </nav>
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <BoardAction label="刷新看板" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={cn('size-4', refreshing && 'motion-safe:animate-spin')} aria-hidden="true" />
            </BoardAction>
            <span className="mx-1 h-5 border-l border-border/80" aria-hidden="true" />
            {editing ? (
              <>
                <BoardAction label="取消" disabled={saving} onClick={() => {
                  setDraft(null);
                  setSelected(new Set());
                  setSaveError('');
                }}><X className="size-4" aria-hidden="true" /></BoardAction>
                <Button variant="primary" size="sm" className="h-8 gap-1.5 px-2.5" aria-label="保存布局" disabled={saving} onClick={() => void save()}>
                  <Check className="size-4" aria-hidden="true" />{saving ? '保存中' : '保存'}
                </Button>
              </>
            ) : (
              <BoardAction label="编辑布局" className="bg-muted/70 text-foreground" disabled={loading || error} onClick={() => setDraft(displayed)}>
                <Pencil className="size-4" aria-hidden="true" />
              </BoardAction>
            )}
          </div>
        </header>
        {saveError && <p role="alert" className="px-5 pt-3 text-sm text-destructive">{saveError}</p>}
        {loading && <p role="status" className="p-5 text-sm text-muted-foreground">正在读取工作区看板…</p>}
        {error && <p role="status" className="p-5 text-sm text-muted-foreground">读取工作区看板失败。</p>}
        <div className={editing ? 'flex flex-col gap-3 p-3 lg:flex-row' : 'p-3 sm:p-4'}>
          {editing && (
            <aside className="w-full shrink-0 self-start overflow-hidden rounded-xl border border-border/75 bg-card lg:sticky lg:top-[4.25rem] lg:w-52" aria-label="布局编辑">
              <div className="space-y-1.5 border-b border-border/70 p-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="workflow-board-page-name">页名</label>
                  {displayed.pages.length > 1 && (
                    <BoardAction label="删除此页" className="size-7 hover:text-destructive" disabled={saving} onClick={() => {
                      setDraft({ ...displayed, pages: displayed.pages.filter((item) => item.id !== page.id) });
                      switchPage('');
                    }}><Trash2 className="size-3.5" aria-hidden="true" /></BoardAction>
                  )}
                </div>
                <input id="workflow-board-page-name" className="w-full rounded-md border bg-background px-2.5 py-1.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={saving}
                  value={page.title} maxLength={80} onChange={(event) => {
                    const title = event.target.value;
                    changePage((item) => ({ ...item, title }));
                  }} />
              </div>
              <div className="space-y-2 p-2.5">
                <div className="px-1">
                  <h3 className="text-xs font-semibold">Markdown 文件</h3>
                  <p className="mt-1 text-xs text-muted-foreground">拖入画布或点击添加</p>
                </div>
                <div className="max-h-64 space-y-0.5 overflow-auto">
                  {boards.map((board) => {
                    const added = usedFiles.has(board.filename);
                    const FileIcon = board.markdown ? ImageIcon : GitFork;
                    return (
                      <button key={board.filename} type="button" disabled={saving || added} draggable={!saving && !added}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'copy';
                          event.dataTransfer.setData(BOARD_DRAG_TYPE, board.filename);
                        }}
                        onClick={() => addDocument(board.filename)}
                        className="group flex min-h-9 w-full cursor-grab items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:text-muted-foreground">
                        <span className="grid size-6 shrink-0 place-items-center rounded bg-muted/70 text-muted-foreground">
                          <FileIcon className="size-3.5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1 truncate" title={board.title}>{board.title}</span>
                        {added ? <Check className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          : <Plus className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
              {selected.size > 0 && (
                <div className="flex items-center justify-between border-t border-border/70 bg-muted/30 px-3 py-2">
                  <span className="text-xs text-muted-foreground">已选 {selected.size} 张</span>
                  <BoardAction label="组合选中卡片" disabled={selected.size < 2 || saving} onClick={() => {
                    changePage((item) => ({ ...item, tiles: groupWorkflowBoardTiles(item.tiles, selected, makeId()) }));
                    setSelected(new Set());
                  }}><Group className="size-4" aria-hidden="true" /></BoardAction>
                </div>
              )}
            </aside>
          )}
          <main className="min-w-0 flex-1">
            {!loading && !error && page.tiles.length === 0 && (
              <p className="mb-2 px-2 text-sm text-muted-foreground">{editing ? '把 Markdown 拖到下方画布。' : '这个看板页还没有卡片。'}</p>
            )}
            <WorkflowBoardGrid key={page.id} tiles={page.tiles} editing={editing && !saving} onLayout={applyGridLayout}
              onDropDocument={addDocument}>{renderTile}</WorkflowBoardGrid>
          </main>
        </div>
        <Dialog open={focusTile !== null} onOpenChange={(open) => { if (!open) setFocusTile(null); }}>
          {focusTile && (
            <DialogContent className="flex h-[85vh] w-[94vw] max-w-[94vw] flex-col overflow-hidden">
              <DialogTitle>{tileTitle(focusTile)}</DialogTitle>
              <div className="min-h-0 flex-1 overflow-hidden">{renderDocuments(focusTile)}</div>
            </DialogContent>
          )}
        </Dialog>
      </section>
    </TooltipProvider>
  );
}
