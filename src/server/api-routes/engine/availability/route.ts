import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import type { AvailabilityProbeSpec } from '@/lib/runtime-agent/agent-registry';
import {
  mergeAgentRuntimeState,
  runtimeStateRecordsToDtos,
} from '@/lib/runtime-agent/agent-registry';
import { normalizeRuntimeEngineId } from '@/lib/models/engine-compatibility';
import { openRuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import { RuntimeSqliteStore } from '@/lib/runtime-agent/sqlite/runtime-store';
import { jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';
import { spawn } from 'node:child_process';

/**
 * Migration-only availability route. Runtime readiness should converge
 * on runtime-agent adapters; this route only adapts runtime agent state for
 * callers that have not moved yet.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const engineType = searchParams.get('engine');
    const refresh = searchParams.get('refresh') === '1' || searchParams.get('refresh') === 'true';

    if (!engineType) {
      return jsonError('Engine type is required', 400);
    }

    const report = await getRuntimeAgentAvailabilityReport(engineType, { refresh });

    return jsonOk({
      ...report,
      source: 'runtime-agent-state',
      migrationOnly: true,
      canonicalRoute: '/api/agents',
    });
  } catch (error) {
    console.error('Failed to check engine availability:', error);
    return jsonOk({
      error: 'Failed to check engine availability',
      available: false,
      migrationOnly: true,
      canonicalRoute: '/api/agents',
    }, { status: 500 });
  }
}

async function getRuntimeAgentAvailabilityReport(engine: string, options: { refresh?: boolean } = {}) {
  const requestedEngine = String(engine || '').trim();
  const normalizedEngine = normalizeRuntimeEngineId(requestedEngine) || requestedEngine;
  const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
  try {
    const store = new RuntimeSqliteStore(db);
    const agents = mergeAgentRuntimeState(runtimeStateRecordsToDtos(store.listAgentRuntimeStates()));
    const entry = agents.find((agent) => (
      normalizeRuntimeEngineId(agent.definition.id) === normalizedEngine
    ));
    if (options.refresh && entry) {
      const probe = await runAvailabilityProbe(entry.definition.availabilityProbe);
      store.upsertAgentRuntimeState({
        agentId: entry.definition.id,
        availabilityStatus: probe.status,
        availabilityCheckedAt: probe.checkedAt,
      });
      return {
        engine: normalizedEngine,
        available: probe.status === 'available',
        diagnostics: {
          status: probe.status,
          summary: probe.message,
          checkedAt: probe.checkedAt,
          error: probe.status === 'error' || probe.status === 'missing' ? probe.message || probe.status : undefined,
        },
      };
    }

    const availability = entry?.runtimeState.availability;
    const status = availability?.status || 'unknown';
    return {
      engine: normalizedEngine,
      available: status === 'unknown' ? undefined : status === 'available',
      diagnostics: {
        status,
        summary: availability?.message,
        checkedAt: status === 'unknown' ? undefined : availability?.checkedAt,
        error: status === 'error' || status === 'missing' ? availability?.message || status : undefined,
      },
    };
  } finally {
    db.close();
  }
}

async function runAvailabilityProbe(probe: AvailabilityProbeSpec) {
  const checkedAt = new Date().toISOString();
  const commands = uniqueStrings([
    probe.resolver.primaryCommand,
    probe.command,
    ...probe.resolver.fallbackCommands,
  ]);
  const failures: string[] = [];

  for (const command of commands) {
    const result = await runCommand(command, probe.args);
    if (result.ok) {
      return {
        status: 'available' as const,
        checkedAt,
        message: firstOutputLine(result.output) || `${command} is available`,
      };
    }

    if (result.missing) {
      failures.push(`${command}: missing`);
      continue;
    }

    failures.push(`${command}: ${result.output || `exited with code ${result.exitCode ?? 'unknown'}`}`);
  }

  const hasOnlyMissing = failures.length > 0 && failures.every((failure) => failure.endsWith(': missing'));
  return {
    status: hasOnlyMissing ? 'missing' as const : 'error' as const,
    checkedAt,
    message: failures.join('; ') || 'availability probe failed',
  };
}

function runCommand(command: string, args: string[]): Promise<{
  ok: boolean;
  missing: boolean;
  output: string;
  exitCode?: number | null;
}> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (result: {
      ok: boolean;
      missing: boolean;
      output: string;
      exitCode?: number | null;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const child = spawn(command, args, {
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    timeout = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        missing: false,
        output: 'availability probe timed out',
        exitCode: null,
      });
    }, 5_000);

    child.stdout?.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        ok: false,
        missing: error.code === 'ENOENT',
        output: error.message,
        exitCode: null,
      });
    });
    child.on('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf8').trim();
      finish({
        ok: code === 0,
        missing: code === 127 || isMissingCommandOutput(output),
        output,
        exitCode: code,
      });
    });
  });
}

function isMissingCommandOutput(output: string) {
  const normalized = output.toLowerCase();
  return normalized.includes('is not recognized as an internal or external command')
    || normalized.includes('command not found')
    || normalized.includes('not found');
}

function firstOutputLine(output: string) {
  return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}
