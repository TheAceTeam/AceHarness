import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { GET } from '@/server/api-routes/workspace/tree/route';
import { PUT } from '@/server/api-routes/workspace/file/route';
import { defaultWorkflowBoardLayout, parseWorkflowBoardLayout, WORKFLOW_BOARD_LAYOUT_FILE } from '@/lib/workspace/workflow-board-layout';

it('returns Markdown and stores layout independently in the same workspace', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-board-layout-'));
  const file = path.join(workspace, '.board', 'map.md');
  const markdown = '# 模块图\n\n```mermaid\nflowchart LR\nA-->B\n```\n';
  try {
    await fs.mkdir(path.dirname(file));
    await fs.writeFile(file, markdown);
    const query = () => GET(new Request('http://localhost/api/workspace/tree?' + new URLSearchParams({ path: workspace, view: 'boards' })));
    const initial = await (await query()).json();
    expect(initial).toMatchObject({ layout: null, boards: [{ title: '模块图', filename: 'map.md' }] });
    const layout = defaultWorkflowBoardLayout(initial.boards);
    const save = (content: string) => PUT(new Request('http://localhost/api/workspace/file', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, file: WORKFLOW_BOARD_LAYOUT_FILE, content }),
    }));
    expect((await save(JSON.stringify(layout))).ok).toBe(true);
    layout.pages[0].title = '新的看板页';
    expect((await save(JSON.stringify(layout))).ok).toBe(true);
    expect((await save('{"version":99}')).status).toBe(400);
    expect(await (await query()).json()).toMatchObject({ layout });
    expect(await fs.readFile(file, 'utf8')).toBe(markdown);
    expect(parseWorkflowBoardLayout(await fs.readFile(path.join(workspace, WORKFLOW_BOARD_LAYOUT_FILE), 'utf8'))).toEqual(layout);
  } finally {
    await fs.rm(workspace, { force: true, recursive: true });
  }
});
