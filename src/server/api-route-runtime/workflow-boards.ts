import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { RemoteWorkspaceProvider } from '@/lib/core/remote-workspace';
import { parseWorkflowBoardLayout, WORKFLOW_BOARD_LAYOUT_FILE } from '@/lib/workspace/workflow-board-layout';
import {
  isWorkflowBoardFilename,
  parseWorkflowBoard,
  WORKFLOW_BOARD_DIRECTORY,
  WORKFLOW_BOARD_MAX_BYTES,
  type WorkflowBoard,
} from '@/lib/workspace/workflow-boards';

function isAbsent(error: unknown): boolean {
  const code = (error as { code?: string | number } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 2;
}

async function readMatchingBoards(entries: string[], read: (name: string) => Promise<Buffer | null>): Promise<WorkflowBoard[]> {
  const boards: WorkflowBoard[] = [];
  const candidates = entries.filter(isWorkflowBoardFilename).sort((a, b) => a.localeCompare(b));
  for (const filename of candidates) {
    try {
      const data = await read(filename);
      if (!data || data.length > WORKFLOW_BOARD_MAX_BYTES) continue;
      const board = parseWorkflowBoard(filename, data.toString('utf8'));
      if (board) boards.push(board);
    } catch (error) {
      if (!isAbsent(error)) throw error;
    }
  }
  return boards;
}

export async function readLocalWorkflowBoards(workspace: string): Promise<WorkflowBoard[]> {
  const directory = path.join(workspace, WORKFLOW_BOARD_DIRECTORY);
  try {
    if (!(await fs.lstat(directory)).isDirectory()) return [];
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return await readMatchingBoards(entries.filter((entry) => entry.isFile()).map((entry) => entry.name), async (filename) => {
      return readLocalBoardFile(path.join(directory, filename));
    });
  } catch (error) {
    if (isAbsent(error)) return [];
    throw error;
  }
}

export async function readRemoteWorkflowBoards(provider: RemoteWorkspaceProvider) {
  const root = await provider.list('');
  if (!root.some((entry) => entry.name === WORKFLOW_BOARD_DIRECTORY && entry.type === 'directory')) return { boards: [], layout: null };
  const entries = await provider.list(WORKFLOW_BOARD_DIRECTORY);
  const boards = await readMatchingBoards(entries.filter((entry) => entry.type === 'file').map((entry) => entry.name), async (filename) => {
    const file = WORKFLOW_BOARD_DIRECTORY + '/' + filename;
    const stat = await provider.stat(file);
    if (stat.type !== 'file' || stat.size > WORKFLOW_BOARD_MAX_BYTES) return null;
    return provider.readFile(file);
  });
  const layout = entries.some((entry) => entry.type === 'file' && entry.name === 'layout.json')
    ? await readRemoteWorkflowBoardLayout(provider) : null;
  return { boards, layout };
}

async function readLocalBoardFile(file: string) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size > WORKFLOW_BOARD_MAX_BYTES) return null;
  // NTFS reparse points are filtered by lstat. On Unix also refuse a swapped symlink at open.
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    if (!(await handle.stat()).isFile()) return null;
    const bytes = Buffer.alloc(WORKFLOW_BOARD_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function readLocalWorkflowBoardLayout(workspace: string) {
  try {
    if (!(await fs.lstat(path.join(workspace, WORKFLOW_BOARD_DIRECTORY))).isDirectory()) return null;
    const data = await readLocalBoardFile(path.join(workspace, WORKFLOW_BOARD_LAYOUT_FILE));
    return data && data.length <= WORKFLOW_BOARD_MAX_BYTES ? parseWorkflowBoardLayout(data.toString('utf8')) : null;
  } catch (error) {
    if (isAbsent(error)) return null;
    throw error;
  }
}

async function readRemoteWorkflowBoardLayout(provider: RemoteWorkspaceProvider) {
  try {
    const stat = await provider.stat(WORKFLOW_BOARD_LAYOUT_FILE);
    if (stat.type !== 'file' || stat.size > WORKFLOW_BOARD_MAX_BYTES) return null;
    const data = await provider.readFile(WORKFLOW_BOARD_LAYOUT_FILE);
    return data.length <= WORKFLOW_BOARD_MAX_BYTES ? parseWorkflowBoardLayout(data.toString('utf8')) : null;
  } catch (error) {
    if (isAbsent(error)) return null;
    throw error;
  }
}
