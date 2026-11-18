import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readLocalWorkflowBoards } from '@/server/api-route-runtime/workflow-boards';
import { parseWorkflowBoard } from '@/lib/workspace/workflow-boards';
import { renderMermaidDiagram } from '@/lib/markdown/pele';
import {
  buildWorkbenchPreviewDetailNavItems,
  buildWorkbenchRunDetailNavItems,
  resolveWorkbenchPreviewRouteSection,
} from '@/client/pages/workbench/WorkbenchClient';

const source = '# 模块图\n\n```mermaid\nmindmap\n  root((应用))\n    首页\n```\n';
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })));
});

describe('workflow boards', () => {
  it('accepts one H1 and one Mermaid block on Windows and Unix', () => {
    expect(parseWorkflowBoard('模块.md', '\uFEFF' + source.replace(/\n/g, '\r\n'))).toMatchObject({ title: '模块图', diagram: expect.stringContaining('mindmap') });
    expect(parseWorkflowBoard('modules.md', source.replace(/```/g, '~~~'))).not.toBeNull();
  });

  it('rejects multiple headings, multiple blocks, and a malformed fence', () => {
    expect(parseWorkflowBoard('modules.md', '# 多余标题\n' + source)).toBeNull();
    expect(parseWorkflowBoard('modules.md', source + '\n```mermaid\nA\n```')).toBeNull();
    expect(parseWorkflowBoard('modules.md', source.replace(/```\n$/, '~~~\n'))).toBeNull();
    expect(parseWorkflowBoard('../modules.md', source)).toBeNull();
  });

  it('returns only valid Markdown files directly below .board', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-workflow-board-'));
    directories.push(root);
    expect(await readLocalWorkflowBoards(root)).toEqual([]);
    const boardRoot = path.join(root, '.board');
    const nested = path.join(boardRoot, 'nested');
    await fs.mkdir(nested, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(boardRoot, 'modules.md'), source),
      fs.writeFile(path.join(boardRoot, 'invalid.md'), '# 缺少图'),
      fs.writeFile(path.join(boardRoot, 'ignored.txt'), source),
      fs.writeFile(path.join(nested, 'nested.md'), source),
    ]);
    expect(await readLocalWorkflowBoards(root)).toEqual([parseWorkflowBoard('modules.md', source)]);
  });

  it('renders the board and existing diagram syntax through Pele', async () => {
    const board = parseWorkflowBoard('modules.md', source)!;
    const result = await renderMermaidDiagram(board.diagram, 'board-test');
    expect(result.svg).toContain('pele-mindmap');
    expect(result.svg).toContain('首页');
    expect((await renderMermaidDiagram('flowchart LR\nA-->B', 'flowchart-test')).svg).toContain('pele-flowchart');
  });

  it('places the board after the state graph only when available', () => {
    for (const items of [buildWorkbenchPreviewDetailNavItems, buildWorkbenchRunDetailNavItems]) {
      expect(items({ isLightweightWorkflow: false }).map((item) => item.key)).not.toContain('board');
      expect(items({ isLightweightWorkflow: false, hasBoards: true }).slice(0, 4).map((item) => item.key))
        .toEqual(['overview', 'state', 'board', 'agents']);
    }
    expect(resolveWorkbenchPreviewRouteSection('preview-board')).toBe('board');
  });
});
