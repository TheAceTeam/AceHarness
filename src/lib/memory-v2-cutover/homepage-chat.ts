import { randomUUID } from 'crypto';
import { loadRunState } from '@/lib/run/state-persistence';
import {
  createAiMemoryContinuityIdentity,
} from '@/lib/agent/ai-memory-session';
import {
  prepareAiMemoryEngineTurn,
} from '@/lib/agent/ai-memory-protocol';
import type { AiMemoryV2EnginePlan } from '@/lib/agent/ai-memory-engine-adapter';
import {
  buildMemoryV2ConsumerManifest,
  buildMemoryV2RequestContext,
  type MemoryV2ConsumerManifestResult,
} from './consumer-context';
import {
  ensureMemoryV2FreshStart,
  type MemoryV2CutoverStatus,
} from './feature-flag';
import {
  createMemoryService,
  type MemoryRequestContext,
  type MemoryService,
} from '@/lib/memory-v2';
import { loadOwnerBoundChatSession } from './chat-session-identity';

interface HomepageChatMemoryIdentity {
  frontendSessionId: string;
  runId?: string;
  workflowId?: string;
  agentId?: string;
}

export interface PreparedHomepageChatMemoryV2 {
  memoryV2: MemoryV2ConsumerManifestResult;
  plan?: AiMemoryV2EnginePlan;
}

function textValue(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

function unavailableMemoryV2(
  status: MemoryV2CutoverStatus,
  reason: string,
): PreparedHomepageChatMemoryV2 {
  const unavailableStatus: MemoryV2CutoverStatus = { ...status, ready: false, reason };
  return {
    memoryV2: {
      status: unavailableStatus,
      manifest: null,
      promptBlock: '',
      skippedReason: reason,
    },
  };
}

/**
 * A browser-provided session ID is only a lookup key. Memory V2 uses it after
 * the persisted session proves that it belongs to the authenticated owner.
 */
async function resolveOwnerBoundHomepageChatIdentity(input: {
  ownerUserId: string;
  frontendSessionId?: string;
}): Promise<HomepageChatMemoryIdentity | null> {
  const requestedFrontendSessionId = textValue(input.frontendSessionId);
  if (!requestedFrontendSessionId) return null;

  const session = await loadOwnerBoundChatSession({
    ownerUserId: input.ownerUserId,
    frontendSessionId: requestedFrontendSessionId,
  });
  if (!session) return null;

  const runId = textValue(session.workflowBinding?.runId);
  const workflowId = textValue(session.workflowBinding?.configFile);
  const hasWorkflowIdentity = Boolean(runId && workflowId);
  return {
    frontendSessionId: session.id,
    ...(hasWorkflowIdentity ? { runId, workflowId } : {}),
    ...(textValue(session.agentBinding?.agentName) || textValue(session.workflowBinding?.supervisorAgent)
      ? { agentId: textValue(session.agentBinding?.agentName) || textValue(session.workflowBinding?.supervisorAgent) }
      : {}),
  };
}

async function assertHomepageWorkflowMemoryV2Authorization(input: {
  context: MemoryRequestContext;
  sourceEventId: string;
  service: MemoryService;
}): Promise<void> {
  const runId = input.context.runId;
  const workflowId = input.context.workflowId;
  if (!runId || !workflowId || !input.context.agentId) {
    throw new Error('workflow Memory V2 context requires a run, workflow, and agent identity');
  }

  const persistedRun = await loadRunState(runId);
  if (!persistedRun || textValue(persistedRun.configFile) !== workflowId) {
    throw new Error('workflow Memory V2 context is not bound to the persisted run');
  }
  input.service.getRequiredReadStatus({
    context: input.context,
    targetStepAttemptId: `homepage-chat-membership:${input.sourceEventId}`,
  });
}

/**
 * Keeps the compact/recovery manifest path index-only. Homepage chat has no
 * server-owned project identity, so it does not accept a browser working
 * directory or grant any project V2 scope.
 */
export async function resolveHomepageChatMemoryV2(input: {
  ownerUserId: string;
  frontendSessionId?: string;
  message?: string;
}): Promise<MemoryV2ConsumerManifestResult> {
  const identity = await resolveOwnerBoundHomepageChatIdentity(input);
  if (!identity) {
    const status = await ensureMemoryV2FreshStart();
    return unavailableMemoryV2(
      status,
      'Memory V2 requires a persisted frontend session owned by the authenticated user',
    ).memoryV2;
  }

  return buildMemoryV2ConsumerManifest({
    ownerUserId: input.ownerUserId,
    // Workflow short memory is run-scoped. Session identity remains a durable
    // browser/session binding, but it does not widen workflow V2 authority.
    sessionId: identity.runId ? undefined : identity.frontendSessionId,
    runId: identity.runId,
    workflowId: identity.workflowId,
    agentId: identity.agentId,
    trigger: 'conversation-turn',
    queryText: input.message,
  });
}

/**
 * Builds the AI execution plan for homepage chat. The route supplies an
 * authenticated user and a frontend session lookup key; this module resolves
 * the persisted owner-bound identity and creates the source event ID itself.
 */
export async function prepareHomepageChatMemoryV2(input: {
  ownerUserId: string;
  frontendSessionId?: string;
  message: string;
}): Promise<PreparedHomepageChatMemoryV2> {
  const status = await ensureMemoryV2FreshStart();
  if (!status.ready) {
    return {
      memoryV2: { status, manifest: null, promptBlock: '', skippedReason: status.reason },
    };
  }

  const identity = await resolveOwnerBoundHomepageChatIdentity(input);
  if (!identity) {
    return unavailableMemoryV2(
      status,
      'Memory V2 requires a persisted frontend session owned by the authenticated user',
    );
  }

  const hasWorkflowIdentity = Boolean(identity.runId && identity.workflowId);
  try {
    const continuity = createAiMemoryContinuityIdentity({
      frontendSessionId: identity.frontendSessionId,
      runId: identity.runId,
      workflowId: identity.workflowId,
    });
    const requestContext = {
      ...buildMemoryV2RequestContext({
        ownerUserId: input.ownerUserId,
        // Do not project a browser working directory into project scope. This
        // endpoint has no server-owned project identity to authorize.
        sessionId: hasWorkflowIdentity ? undefined : identity.frontendSessionId,
        runId: identity.runId,
        workflowId: identity.workflowId,
        agentId: identity.agentId,
      }),
      actor: 'ai' as const,
      actorId: 'homepage-chat',
    } satisfies MemoryRequestContext;
    const sourceEventId = `homepage-chat-memory-v2:${randomUUID()}`;
    const memoryV2: MemoryV2ConsumerManifestResult = { status, manifest: null, promptBlock: '' };
    const previewService = createMemoryService();
    try {
      if (continuity.kind === 'workflow-run') {
        await assertHomepageWorkflowMemoryV2Authorization({
          context: requestContext,
          sourceEventId,
          service: previewService,
        });
      }
      const previewTurn = prepareAiMemoryEngineTurn({
        memoryService: previewService,
        requestContext,
        continuity,
        sourceEventId,
        trigger: 'conversation-turn',
        queryText: input.message,
        ...(requestContext.stepAttemptId ? { targetStepAttemptId: requestContext.stepAttemptId } : {}),
      });
      memoryV2.manifest = previewTurn.manifest;
      memoryV2.promptBlock = previewTurn.manifest.promptBlock;
    } finally {
      previewService.close();
    }
    return {
      memoryV2,
      plan: {
        requestContext,
        continuity,
        sourceEventId,
        queryText: input.message,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Memory V2 homepage chat context is unavailable';
    return unavailableMemoryV2(status, reason);
  }
}

export function buildMemoryV2RecoverySource(input: {
  promptBlock: string;
  currentRequest: string;
}): string {
  return [
    input.promptBlock || 'No authorized Memory V2 index items matched this stable conversation scope.',
    '# Current request',
    input.currentRequest,
  ].join('\n\n');
}
