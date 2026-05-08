import type { SpecCodingDocument, SpecCodingProgressStatus, SpecCodingTask } from '@/lib/schemas';
import {
  appendSpecCodingRevision,
  normalizeSpecCodingDocument,
  updateSpecCodingTaskStatuses,
} from '@/lib/spec-coding-store';

function flattenTasks(tasks: SpecCodingTask[]): SpecCodingTask[] {
  const result: SpecCodingTask[] = [];
  const walk = (items: SpecCodingTask[]) => {
    for (const task of items) {
      result.push(task);
      if (task.children?.length) walk(task.children);
    }
  };
  walk(tasks || []);
  return result;
}

export function importWorkspaceArtifactsIntoRunSpecCoding(input: {
  current: SpecCodingDocument;
  artifacts: Partial<SpecCodingDocument['artifacts']>;
  summary?: string;
  createdBy?: string;
}): SpecCodingDocument {
  const current = normalizeSpecCodingDocument(input.current);
  const statusById = new Map(
    flattenTasks(current.tasks || []).map((task) => [task.id, {
      status: (task.status || 'pending') as SpecCodingProgressStatus,
      validation: task.validation,
    }])
  );

  let next = normalizeSpecCodingDocument({
    ...current,
    artifacts: {
      requirements: input.artifacts.requirements ?? current.artifacts.requirements ?? '',
      design: input.artifacts.design ?? current.artifacts.design ?? '',
      tasks: input.artifacts.tasks ?? current.artifacts.tasks ?? '',
    },
    updatedAt: new Date().toISOString(),
  });

  const nextTaskIds = new Set(flattenTasks(next.tasks || []).map((task) => task.id));
  const preservedUpdates = Array.from(statusById.entries())
    .filter(([id]) => nextTaskIds.has(id))
    .map(([id, value]) => ({
      id,
      status: value.status,
      validation: value.validation,
    }));

  if (preservedUpdates.length > 0) {
    next = updateSpecCodingTaskStatuses(next, {
      updates: preservedUpdates,
      updatedBy: 'system',
    });
  }

  return appendSpecCodingRevision(next, {
    summary: input.summary || 'Imported workspace delta spec edits into runtime SpecCoding.',
    createdBy: input.createdBy,
    status: next.status,
    progressSummary: 'Workspace delta spec edits were imported by user request; task status remains system-maintained.',
  });
}
