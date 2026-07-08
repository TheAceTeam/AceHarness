import { jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import {
  deleteRunDocuments,
  listRunDocuments,
  paginateDocuments,
  readOffsetLimit,
  readRunDocumentContent,
  renameRunDocument,
} from '@/lib/run/documents';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  const runId = (await params).id;
  const searchParams = requestUrl(request).searchParams;
  const requestedFile = searchParams.get('file');
  const sourceRunId = searchParams.get('sourceRunId') || runId;

  try {
    if (requestedFile) {
      const result = await readRunDocumentContent(sourceRunId, requestedFile);
      if (!result) return jsonOk({ error: '文件不存在' }, { status: 404 });
      return jsonOk(result);
    }

    const { offset, limit } = readOffsetLimit(searchParams, 200);
    const result = await listRunDocuments(runId, {
      includeChildren: searchParams.get('includeChildren') === '1',
      scope: readScope(searchParams),
      childRunId: searchParams.get('childRunId') || undefined,
      groupKey: searchParams.get('groupKey') || undefined,
      documentKind: readDocumentKind(searchParams),
      summaryOnly: searchParams.get('summaryOnly') === '1',
      sortDirection: searchParams.get('sortDirection') === 'desc' ? 'desc' : 'asc',
    });
    if (!result) return jsonOk({ error: '未找到运行记录或未配置项目根目录' }, { status: 404 });
    const paged = paginateDocuments(result.files, offset, limit);

    return jsonOk({
      runId,
      includeChildren: searchParams.get('includeChildren') === '1',
      files: paged.items,
      aceDir: result.aceDir,
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
      { error: '获取文档失败', message: error.message },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  const runId = (await params).id;
  try {
    const { file, newName } = await readJsonBody<any>(request, {});
    if (!file || !newName) return jsonOk({ error: '缺少参数' }, { status: 400 });
    const newFilename = await renameRunDocument(runId, file, newName);
    if (!newFilename) return jsonOk({ error: '文件不存在' }, { status: 404 });
    return jsonOk({ ok: true, newFilename });
  } catch (error: any) {
    return jsonOk({ error: '重命名失败', message: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  const runId = (await params).id;
  try {
    const { files } = await readJsonBody<{ files?: string[] }>(request, {});
    if (!files?.length) return jsonOk({ error: '缺少参数' }, { status: 400 });
    const deleted = await deleteRunDocuments(runId, files);
    if (!deleted) return jsonOk({ error: '未找到运行记录' }, { status: 404 });
    return jsonOk({ ok: true, deleted });
  } catch (error: any) {
    return jsonOk({ error: '删除失败', message: error.message }, { status: 500 });
  }
}

function readScope(searchParams: URLSearchParams): 'root' | 'children' | 'child' | undefined {
  const value = searchParams.get('scope');
  return value === 'children' || value === 'child' || value === 'root' ? value : undefined;
}

function readDocumentKind(searchParams: URLSearchParams): 'conclusion' | 'detail' | undefined {
  const value = searchParams.get('documentKind');
  return value === 'conclusion' || value === 'detail' ? value : undefined;
}
