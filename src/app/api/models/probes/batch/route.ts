import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAdmin } from '@/lib/auth/middleware';
import { createModelProbe, listModelProbes } from '@/lib/models/probes';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const probes = Array.isArray(body?.probes) ? body.probes : [];
    if (probes.length === 0) {
      return NextResponse.json({ error: 'probes is required' }, { status: 400 });
    }

    const created = [];
    const groupId = String(body?.groupId || '').trim() || randomUUID();
    const groupName = String(body?.groupName || '').trim() || 'New Group';
    for (const item of probes) {
      created.push(await createModelProbe({
        ...(item || {}),
        groupId,
        groupName,
      }));
    }

    const data = await listModelProbes();
    return NextResponse.json({
      success: true,
      createdCount: created.length,
      created,
      ...data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to batch create model probes' },
      { status: 400 },
    );
  }
}
