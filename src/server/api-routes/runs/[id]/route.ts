import { getRun, updateRun } from '@/lib/run/store';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const run = await getRun(id);
    if (!run) {
      return jsonOk({ error: '运行记录不存在' }, { status: 404 });
    }
    return jsonOk(run);
  } catch (error: any) {
    return jsonOk(
      { error: '获取运行记录失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const patch = await readJsonBody(request, {});
    await updateRun(id, patch);
    return jsonOk({ success: true });
  } catch (error: any) {
    return jsonOk(
      { error: '更新运行记录失败', message: error.message },
      { status: 500 }
    );
  }
}
