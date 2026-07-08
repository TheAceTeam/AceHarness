import { ClaudeCodeEngineWrapper } from '@/lib/engines/claude-code-wrapper';
import { executeEngineWithContextRecovery } from '@/lib/engines/context-recovery';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

const DEFAULT_MODELS = ['default', 'best', 'sonnet', 'opus', 'haiku', 'opusplan'];

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const requestedModels = Array.isArray(body?.models) ? body.models : DEFAULT_MODELS;
    const models = requestedModels
      .map((item: unknown) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 10);

    if (models.length === 0) {
      return jsonError('models is required', 400);
    }

    const engine = new ClaudeCodeEngineWrapper();
    const available = await engine.isAvailable();
    if (!available) {
      return jsonError('Claude Code engine is not available', 400);
    }

    const results: Array<{
      model: string;
      ok: boolean;
      resolvedModel?: string;
      error?: string;
      durationMs: number;
      preview?: string;
    }> = [];

    for (const model of models) {
      const startedAt = Date.now();
      try {
        const result = await executeEngineWithContextRecovery(engine, {
          agent: 'engine-model-smoke-test',
          step: 'model-smoke-test',
          prompt: 'Reply with exactly OK.',
          systemPrompt: 'You are running a model availability smoke test. Reply with exactly OK.',
          model,
          workingDirectory: process.cwd(),
          timeoutMs: 20_000,
        });

        results.push({
          model,
          ok: result.success,
          resolvedModel: result.metadata?.resolvedModel,
          error: result.success ? undefined : (result.error || 'Unknown error'),
          durationMs: Date.now() - startedAt,
          preview: result.output?.trim().slice(0, 120) || undefined,
        });
      } catch (error) {
        results.push({
          model,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        });
      }
    }

    return jsonOk({ engine: 'claude-code', results });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
