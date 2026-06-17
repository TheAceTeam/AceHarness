import { NextRequest, NextResponse } from 'next/server';
import {
  clearMemoryEntries,
  getMemoryBucket,
  replaceMemoryEntries,
} from '@/lib/workflow/memory-store';
import { resolveAgentRoleMemory } from '@/lib/agent/memory-resolver';

function clampMaxChars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5000;
  return Math.max(0, Math.min(50000, Math.floor(parsed)));
}

async function buildResponse(agentName: string, maxChars = 5000) {
  const bucket = await getMemoryBucket({ scope: 'role', key: agentName });
  const snapshot = await resolveAgentRoleMemory({
    agentName,
    maxChars,
    runtimeEnabled: true,
  });
  const fullContent = bucket.entries.map((entry) => entry.content.trim()).filter(Boolean).join('\n\n');
  return {
    agentName,
    storageScope: 'role',
    storageKey: agentName,
    entries: bucket.entries,
    baseMemory: fullContent,
    mergedContent: snapshot.mergedContent,
    charCount: fullContent.length,
    maxChars: snapshot.maxChars,
    overLimit: fullContent.length > snapshot.maxChars,
    updatedAt: bucket.updatedAt,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const name = decodeURIComponent((await params).name);
    const maxChars = clampMaxChars(request.nextUrl.searchParams.get('maxChars'));
    return NextResponse.json(await buildResponse(name, maxChars));
  } catch (error: any) {
    return NextResponse.json(
      { error: '读取 Agent 记忆失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const name = decodeURIComponent((await params).name);
    const body = await request.json();
    const maxChars = clampMaxChars(body?.maxChars);
    const baseMemory = typeof body?.baseMemory === 'string'
      ? body.baseMemory
      : typeof body?.content === 'string'
        ? body.content
        : '';
    const normalizedContent = baseMemory.trim();
    if (normalizedContent.length > maxChars) {
      return NextResponse.json(
        { error: `Agent 基础记忆不能超过 ${maxChars} 个字符`, charCount: normalizedContent.length, maxChars },
        { status: 400 }
      );
    }

    if (!normalizedContent) {
      await clearMemoryEntries({ scope: 'role', key: name });
      return NextResponse.json({ success: true, ...(await buildResponse(name, maxChars)) });
    }

    await replaceMemoryEntries({
      scope: 'role',
      key: name,
      entries: [{
        id: `role-${name}-base`,
        kind: 'base',
        title: '基础长期记忆',
        content: normalizedContent,
        source: 'manual',
        agent: name,
        tags: ['base-memory'],
      }],
    });

    return NextResponse.json({ success: true, ...(await buildResponse(name, maxChars)) });
  } catch (error: any) {
    return NextResponse.json(
      { error: '保存 Agent 记忆失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const name = decodeURIComponent((await params).name);
    const maxChars = clampMaxChars(request.nextUrl.searchParams.get('maxChars'));
    await clearMemoryEntries({ scope: 'role', key: name });
    return NextResponse.json({ success: true, ...(await buildResponse(name, maxChars)) });
  } catch (error: any) {
    return NextResponse.json(
      { error: '清空 Agent 记忆失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export const POST = PUT;
