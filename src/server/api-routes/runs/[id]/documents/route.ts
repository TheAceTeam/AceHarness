import { jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import {
  deleteRunDocuments,
  listRunDocuments,
  paginateDocuments,
  readOffsetLimit,
  readRunDocumentContent,
  renameRunDocument,
  RunDocumentOperationError,
  type RunDocumentReference,
  type RunDocumentSource,
} from '@/lib/run/documents';
import { isSafeDocumentRename, isSafeRunDocumentId } from '@/lib/run/document-roots';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  const runId = (await params).id;
  if (!isSafeRunDocumentId(runId)) return jsonOk({ error: '未找到运行记录' }, { status: 404 });

  const searchParams = requestUrl(request).searchParams;
  const requestedFile = searchParams.get('file');
  const sourceParam = searchParams.get('source');
  const requestedSource = sourceParam ? readDocumentSource(sourceParam) : undefined;
  if (sourceParam && !requestedSource) {
    return jsonOk({ error: '非法的文档来源' }, { status: 400 });
  }

  try {
    if (requestedFile) {
      const source = requestedSource;
      if (!source) return jsonOk({ error: '非法的文档来源' }, { status: 400 });
      const result = await readRunDocumentContent(runId, {
        source,
        sourceRunId: searchParams.get('sourceRunId') || undefined,
        file: requestedFile,
      });
      if (!result) return jsonOk({ error: '文件不存在' }, { status: 404 });
      return jsonOk(result);
    }

    const { offset, limit } = readOffsetLimit(searchParams, 200);
    const result = await listRunDocuments(runId, {
      includeChildren: searchParams.get('includeChildren') === '1',
      scope: readScope(searchParams),
      childRunId: searchParams.get('childRunId') || undefined,
      source: requestedSource || undefined,
      groupKey: searchParams.get('groupKey') || undefined,
      documentKind: readDocumentKind(searchParams),
      summaryOnly: searchParams.get('summaryOnly') === '1',
      sortDirection: searchParams.get('sortDirection') === 'desc' ? 'desc' : 'asc',
    });
    if (!result) return jsonOk({ error: '未找到运行记录' }, { status: 404 });

    const paged = paginateDocuments(result.files, offset, limit);
    return jsonOk({
      runId,
      includeChildren: searchParams.get('includeChildren') === '1',
      files: paged.items,
      documentRoots: result.documentRoots,
      documentDirectory: result.documentDirectory,
      childRuns: result.childRuns,
      pagination: paged.pagination,
      lazy: {
        content: true,
        summaryOnly: searchParams.get('summaryOnly') === '1',
        groupKey: searchParams.get('groupKey') || null,
        scope: readScope(searchParams) || 'root',
      },
    });
  } catch (error: any) {
    return jsonOk(
      { error: '获取文档失败', message: error?.message || String(error) },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  const runId = (await params).id;
  if (!isSafeRunDocumentId(runId)) return jsonOk({ error: '未找到运行记录' }, { status: 404 });

  try {
    const body = await readJsonBody<Partial<RunDocumentReference> & { newName?: unknown }>(request, {});
    const sourceRunId = typeof body.sourceRunId === 'string' ? body.sourceRunId.trim() : '';
    if (!body.file || !isSafeDocumentRename(body.newName)) {
      return jsonOk({ error: '缺少或非法的重命名参数' }, { status: 400 });
    }
    if (sourceRunId && sourceRunId !== runId) {
      return jsonOk({ error: '子工作流文档只能在其自身运行中修改' }, { status: 403 });
    }
    const source = readDocumentSource(body.source);
    if (!source) return jsonOk({ error: '非法的文档来源' }, { status: 400 });

    const result = await renameRunDocument(runId, {
      source,
      sourceRunId: sourceRunId || undefined,
      file: body.file,
      newName: body.newName,
    });
    if (!result) return jsonOk({ error: '文件不存在' }, { status: 404 });
    return jsonOk({ ok: true, ...result });
  } catch (error: any) {
    const status = error instanceof RunDocumentOperationError ? error.status : 500;
    return jsonOk({ error: '重命名失败', message: error?.message || String(error) }, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  const runId = (await params).id;
  if (!isSafeRunDocumentId(runId)) return jsonOk({ error: '未找到运行记录' }, { status: 404 });

  try {
    const body = await readJsonBody<{ files?: RunDocumentReference[] }>(request, {});
    if (!Array.isArray(body.files) || body.files.length === 0) {
      return jsonOk({ error: '缺少文档参数' }, { status: 400 });
    }

    const references: RunDocumentReference[] = [];
    for (const entry of body.files) {
      if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') {
        return jsonOk({ error: '缺少或非法的文档参数' }, { status: 400 });
      }
      const sourceRunId = typeof entry.sourceRunId === 'string' ? entry.sourceRunId.trim() : '';
      if (sourceRunId && sourceRunId !== runId) {
        return jsonOk({ error: '子工作流文档只能在其自身运行中修改' }, { status: 403 });
      }
      const source = readDocumentSource(entry.source);
      if (!source) return jsonOk({ error: '非法的文档来源' }, { status: 400 });
      references.push({
        source,
        sourceRunId: sourceRunId || undefined,
        file: entry.file,
      });
    }
    if (references.length === 0) return jsonOk({ error: '缺少文档参数' }, { status: 400 });

    const deleted = await deleteRunDocuments(runId, references);
    if (!deleted) return jsonOk({ error: '未找到运行记录' }, { status: 404 });
    return jsonOk({ ok: true, deleted });
  } catch (error: any) {
    return jsonOk({ error: '删除失败', message: error?.message || String(error) }, { status: 500 });
  }
}

function readDocumentSource(value: unknown): RunDocumentSource | undefined {
  return value === 'tasklist' || value === 'runtime-output' ? value : undefined;
}

function readScope(searchParams: URLSearchParams): 'root' | 'children' | 'child' | undefined {
  const value = searchParams.get('scope');
  return value === 'children' || value === 'child' || value === 'root' ? value : undefined;
}

function readDocumentKind(searchParams: URLSearchParams): 'conclusion' | 'detail' | undefined {
  const value = searchParams.get('documentKind');
  return value === 'conclusion' || value === 'detail' ? value : undefined;
}
