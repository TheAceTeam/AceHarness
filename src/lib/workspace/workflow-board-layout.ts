import { isWorkflowBoardFilename, type WorkflowBoard } from './workflow-boards';

export const WORKFLOW_BOARD_LAYOUT_FILE = '.board/layout.json';
export const BOARD_COLUMNS = 12;
export const BOARD_DEFAULT_HEIGHT = 8;
export const BOARD_MAX_PAGES = 24;
export const BOARD_MAX_TILES = 48;

export type WorkflowBoardPosition = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type WorkflowBoardTile = WorkflowBoardPosition & {
  id: string;
  files: string[];
};

export type WorkflowBoardPage = { id: string; title: string; tiles: WorkflowBoardTile[] };
export type WorkflowBoardLayout = { version: 1; pages: WorkflowBoardPage[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z\d_-]{1,64}$/i.test(value);
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function parseTile(value: unknown): WorkflowBoardTile | null {
  if (!isObject(value)) return null;
  const { id, x, y, w, h, files } = value;
  if (!isId(id) || !isInteger(x, 0, BOARD_COLUMNS - 1) || !isInteger(y, 0, 10000)
    || !isInteger(w, 1, BOARD_COLUMNS) || !isInteger(h, 1, 100) || x + w > BOARD_COLUMNS
    || !Array.isArray(files) || files.length === 0 || files.length > BOARD_MAX_TILES
    || !files.every((file): file is string => typeof file === 'string' && isWorkflowBoardFilename(file))
    || new Set(files).size !== files.length) return null;
  return { id, x, y, w, h, files };
}

function parsePage(value: unknown): WorkflowBoardPage | null {
  if (!isObject(value)) return null;
  const { id, title, tiles } = value;
  if (!isId(id) || typeof title !== 'string' || !title.trim() || title.length > 80
    || !Array.isArray(tiles) || tiles.length > BOARD_MAX_TILES) return null;
  const parsed: WorkflowBoardTile[] = [];
  const ids = new Set<string>();
  for (const item of tiles) {
    const tile = parseTile(item);
    if (!tile || ids.has(tile.id)) return null;
    ids.add(tile.id);
    parsed.push(tile);
  }
  return { id, title: title.trim(), tiles: parsed };
}

export function parseWorkflowBoardLayout(text: string): WorkflowBoardLayout | null {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.pages)
    || !value.pages.length || value.pages.length > BOARD_MAX_PAGES) return null;
  const pages: WorkflowBoardPage[] = [];
  const ids = new Set<string>();
  for (const item of value.pages) {
    const page = parsePage(item);
    if (!page || ids.has(page.id)) return null;
    ids.add(page.id);
    pages.push(page);
  }
  return { version: 1, pages };
}

export function defaultWorkflowBoardLayout(boards: WorkflowBoard[]): WorkflowBoardLayout {
  const files = boards.slice(0, BOARD_MAX_TILES);
  return {
    version: 1,
    pages: [{
      id: 'overview',
      title: '项目看板',
      tiles: files.map((board, index) => ({
        id: 'tile-' + index,
        files: [board.filename],
        x: 0,
        y: index * BOARD_DEFAULT_HEIGHT,
        w: BOARD_COLUMNS,
        h: BOARD_DEFAULT_HEIGHT,
      })),
    }],
  };
}

export function groupWorkflowBoardTiles(tiles: WorkflowBoardTile[], selectedIds: Set<string>, id: string): WorkflowBoardTile[] {
  const selected = tiles.filter((tile) => selectedIds.has(tile.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  if (selected.length < 2) return tiles;
  const files = Array.from(new Set(selected.flatMap((tile) => tile.files)));
  if (files.length > BOARD_MAX_TILES) return tiles;
  const x = Math.min(...selected.map((tile) => tile.x));
  const y = Math.min(...selected.map((tile) => tile.y));
  const right = Math.max(...selected.map((tile) => tile.x + tile.w));
  const bottom = Math.max(...selected.map((tile) => tile.y + tile.h));
  return [...tiles.filter((tile) => !selectedIds.has(tile.id)),
    { id, files, x, y, w: right - x, h: Math.min(bottom - y, 100) }];
}
