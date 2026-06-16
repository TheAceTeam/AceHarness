import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { discoverOpenCodeSdkCommands } from '@/lib/engines/opencode-sdk-wrapper';
import { discoverCodegenieSdkCommands } from '@/lib/engines/codegenie-sdk-wrapper';
import { discoverNgaSdkCommands } from '@/lib/engines/nga-sdk-wrapper';
import { createEngine, getLogicalEngineId, resolveRequestedEngineType } from '@/lib/engines/engine-factory';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import type { EngineOptions } from '@/lib/engines/engine-interface';

type DiscoverableAcpWrapper = {
  discoverCommands(options: Pick<EngineOptions, 'workingDirectory' | 'userId'>): Promise<Array<{ name: string; description: string; source?: string; type?: string; kind?: string; category?: string }>>;
};

function commandNamespaceForEngine(engine: string): string {
  const logical = getLogicalEngineId(engine) || engine;
  if (logical === 'nga') return 'codeagent';
  return logical;
}

async function discoverCommands(engine: string, userId: string) {
  if (engine === 'opencode-sdk') return discoverOpenCodeSdkCommands(userId);
  if (engine === 'codegenie-sdk') return discoverCodegenieSdkCommands(userId);
  if (engine === 'nga-sdk') return discoverNgaSdkCommands(userId);
  if (engine === 'opencode') return discoverOpenCodeSdkCommands(userId);
  if (engine === 'codegenie') return discoverCodegenieSdkCommands(userId);
  if (engine === 'nga') return discoverNgaSdkCommands(userId);
  const resolvedEngine = await createEngine(engine as any);
  const discover = (resolvedEngine as Partial<DiscoverableAcpWrapper> | null)?.discoverCommands;
  if (typeof discover === 'function') {
    return discover.call(resolvedEngine, { workingDirectory: getWorkspaceRoot(), userId });
  }
  return [];
}

function isAdvertisedSkill(command: { source?: unknown; type?: unknown; kind?: unknown; category?: unknown }): boolean {
  return [command.source, command.type, command.kind, command.category]
    .some((value) => String(value || '').trim().toLowerCase() === 'skill');
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const auth = authResult;

  const requestedEngine = request.nextUrl.searchParams.get('engine') || '';
  const engine = await resolveRequestedEngineType(requestedEngine || undefined).catch(() => requestedEngine);
  const namespace = commandNamespaceForEngine(engine);

  try {
    const seen = new Set<string>();
    const commands = (await discoverCommands(engine, auth.id)).filter((command) => {
      const key = command.name.toLowerCase();
      if (isAdvertisedSkill(command)) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return NextResponse.json({ engine, namespace, commands });
  } catch (error: any) {
    console.error(`[engine/commands] Failed to discover ${engine} commands:`, error);
    return NextResponse.json(
      { engine, namespace, commands: [], error: error?.message || 'Failed to discover commands' },
      { status: 500 },
    );
  }
}
