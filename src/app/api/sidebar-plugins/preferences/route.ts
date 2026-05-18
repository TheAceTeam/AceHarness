import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import {
  getUserSidebarPluginDisabledIds,
  updateUserSidebarPluginDisabledIds,
} from '@/lib/core/user-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const disabledPluginIds = await getUserSidebarPluginDisabledIds(user.id);
    return NextResponse.json({ disabledPluginIds });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '读取侧边栏插件设置失败' }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const body = await request.json();
    const disabledPluginIds = Array.isArray(body?.disabledPluginIds)
      ? body.disabledPluginIds.filter((item: unknown) => typeof item === 'string')
      : null;
    if (!disabledPluginIds) {
      return NextResponse.json({ error: 'disabledPluginIds 必须是字符串数组' }, { status: 400 });
    }

    const updated = await updateUserSidebarPluginDisabledIds(user.id, disabledPluginIds);
    return NextResponse.json({
      disabledPluginIds: updated.preferences?.sidebarPlugins?.disabledIds || [],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '保存侧边栏插件设置失败' }, { status: 400 });
  }
}
