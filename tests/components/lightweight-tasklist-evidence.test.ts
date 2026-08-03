import { describe, expect, test } from 'vitest';
import { parseTasklistDocuments } from '@/components/workflow/lightweight-tasklist-evidence';

describe('lightweight tasklist document evidence', () => {
  test('parses README task entries and task-document execution metadata', () => {
    const result = parseTasklistDocuments([
      {
        file: 'README.md',
        content: '- [x] Task 1: 需求分析\n- [ ] Task 2: 实现',
      },
      {
        file: '02-implementation.md',
        content: '# Task 2: 实现\n\nStatus: In Progress\n- Delegated owner: builder\n- Depends on: Task 1\n- Execution: serial\nProgress: 45%',
      },
    ]);

    expect(result).toMatchObject({
      tasks: [
        { id: 'Task 1', title: 'Task 1: 需求分析', status: 'completed' },
        {
          id: 'Task 2',
          owner: 'builder',
          dependencies: ['Task 1'],
          executionMode: 'serial',
          progress: 45,
        },
      ],
    });
  });

  test('returns no fabricated task when the documents contain no task evidence', () => {
    expect(parseTasklistDocuments([{ file: 'notes.md', content: '# Notes\nNo task items yet.' }])).toEqual({ tasks: [] });
  });
});
