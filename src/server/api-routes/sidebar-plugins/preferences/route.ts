import { requireAuth } from '@/lib/auth/middleware';
import {
  getUserSidebarPluginPreferenceIds,
  updateUserSidebarPluginPreferenceIds,
} from '@/lib/core/user-store';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const preferences = await getUserSidebarPluginPreferenceIds(user.id);
    return jsonOk({
      disabledPluginIds: preferences.disabledIds,
      enabledPluginIds: preferences.enabledIds,
    });
  } catch (error: any) {
    return jsonOk({ error: error?.message || '读取侧边栏插件设置失败' }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const body = await readJsonBody<any>(request, {});
    const disabledPluginIds = Array.isArray(body?.disabledPluginIds)
      ? body.disabledPluginIds.filter((item: unknown) => typeof item === 'string')
      : null;
    if (!disabledPluginIds) {
      return jsonOk({ error: 'disabledPluginIds 必须是字符串数组' }, { status: 400 });
    }
    const enabledPluginIds = Array.isArray(body?.enabledPluginIds)
      ? body.enabledPluginIds.filter((item: unknown) => typeof item === 'string')
      : undefined;

    const updated = await updateUserSidebarPluginPreferenceIds(user.id, { disabledIds: disabledPluginIds, enabledIds: enabledPluginIds });
    return jsonOk({
      disabledPluginIds: updated.preferences?.sidebarPlugins?.disabledIds || [],
      enabledPluginIds: updated.preferences?.sidebarPlugins?.enabledIds || [],
    });
  } catch (error: any) {
    return jsonOk({ error: error?.message || '保存侧边栏插件设置失败' }, { status: 400 });
  }
}
