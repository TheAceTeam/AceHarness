import type { LightweightTaskBoardInput } from './lightweight-task-board-evidence';

export interface TasklistDocumentContent {
  file: string;
  content: string;
}

function clean(value: string): string {
  return value
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(value: string, pattern: RegExp): string {
  return clean(value.match(pattern)?.[1] || '');
}

function parseList(value: string): string[] {
  const normalized = clean(value).replace(/^(none|n\/a|无|暂无)$/i, '');
  if (!normalized) return [];
  return Array.from(new Set(
    normalized
      .split(/[,，、;；]|\s+and\s+/i)
      .map((item) => clean(item).replace(/^[-*+]\s*/, ''))
      .filter(Boolean),
  ));
}

function taskId(title: string, file: string, index: number): string {
  const headingId = firstMatch(title, /^task\s+([\w.-]+)/i);
  if (headingId) return `Task ${headingId}`;
  const fileId = firstMatch(file.split('/').at(-1) || file, /^(\d+)[-_]/);
  return fileId ? `Task ${fileId}` : `evidence-${index + 1}`;
}

function parseAttributes(lines: string[]) {
  const body = lines.join('\n');
  const fields = new Map<string, string>();
  for (const line of lines) {
    const match = line.replace(/^\s*[-*+]\s*/, '').match(/^([^:：]+)\s*[:：]\s*(.+)$/);
    if (match) fields.set(clean(match[1]).toLowerCase(), clean(match[2]));
  }
  const read = (labels: string[]) => labels.map((label) => fields.get(label.toLowerCase()) || '').find(Boolean) || '';
  const status = read(['status', '状态']);
  const owner = read(['delegated owner', 'owner', '负责人', '执行者']);
  const dependencies = read(['depends on', 'depends', '依赖']);
  const execution = read(['execution', '执行方式', '执行']);
  const progressValue = firstMatch(body, /(?:progress|进度)\s*[:：]\s*([0-9]{1,3})\s*%?/i);
  const checked = lines.some((line) => /^\s*[-*+]\s*\[[xX]\]/.test(line));
  return {
    status: status || (checked ? 'completed' : ''),
    completed: checked || undefined,
    owner: owner || undefined,
    dependencies: parseList(dependencies),
    executionMode: /parallel|并行|concurrent/i.test(execution)
      ? 'parallel'
      : /serial|sequential|串行|顺序/i.test(execution)
        ? 'serial'
        : undefined,
    progress: progressValue ? Number(progressValue) : undefined,
  };
}

function parseTaskDocument(file: string, content: string, index: number): Record<string, unknown>[] {
  const lines = String(content || '').slice(0, 600_000).split(/\r?\n/);
  const heading = lines.find((line) => /^\s*#{1,6}\s+/.test(line));
  const title = clean(heading?.replace(/^\s*#{1,6}\s+/, '') || file.split('/').at(-1) || '任务');
  if (!title || /^(readme|index)$/i.test(title) || !/^task\b/i.test(title)) return [];
  return [{ id: taskId(title, file, index), title, ...parseAttributes(lines) }];
}

function parseReadmeTasks(file: string, content: string, startIndex: number): Record<string, unknown>[] {
  const tasks: Record<string, unknown>[] = [];
  const lines = String(content || '').slice(0, 600_000).split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/^\s*[-*+]\s*\[([ xX])\]\s+(.+?)\s*$/);
    if (!match || !/task\s+\d+/i.test(match[2])) return;
    const title = clean(match[2]);
    tasks.push({
      id: taskId(title, file, startIndex + index),
      title,
      status: match[1].toLowerCase() === 'x' ? 'completed' : 'pending',
      completed: match[1].toLowerCase() === 'x',
    });
  });
  return tasks;
}

export function parseTasklistDocuments(documents: TasklistDocumentContent[]): LightweightTaskBoardInput['tasklist'] {
  const tasks: Record<string, unknown>[] = [];
  documents.forEach((document, index) => {
    const fileName = document.file.split('/').at(-1) || document.file;
    const isReadme = /^readme(?:\.[^.]+)?$/i.test(fileName);
    const parsed = isReadme
      ? parseReadmeTasks(document.file, document.content, index)
      : parseTaskDocument(document.file, document.content, index);
    tasks.push(...parsed);
  });

  const byId = new Map<string, Record<string, unknown>>();
  for (const task of tasks) {
    const id = String(task.id || task.title || '').trim();
    if (!id) continue;
    const previous = byId.get(id);
    if (!previous) {
      byId.set(id, task);
      continue;
    }
    const merged = { ...previous, ...task };
    for (const key of ['owner', 'executionMode', 'progress']) {
      if (task[key] === undefined || task[key] === '') merged[key] = previous[key];
    }
    if (Array.isArray(task.dependencies) && task.dependencies.length === 0) merged.dependencies = previous.dependencies;
    byId.set(id, merged);
  }
  return { tasks: Array.from(byId.values()) };
}
