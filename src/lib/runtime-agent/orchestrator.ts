import { randomUUID } from 'crypto';
import { getBuiltinAgentDefinition } from './agent-registry';
import { createRuntimeAdapterRegistry, type RuntimeAdapterRegistry } from './adapters/adapter-registry';
import type {
  AdapterRuntimeEvent,
  CompactResult,
  CompactSessionInput,
  CostUsage,
  ForkResult,
  ForkSessionInput,
  OpenRuntimeSessionInput,
  ResolvedModelRoute,
  RunRuntimeTurnInput,
  RuntimeAdapter,
  RuntimeBinding,
  RuntimeErrorDto,
  RuntimeEvent,
  RuntimeEventType,
  RuntimePermissionPolicyId,
  RuntimeOrchestrator,
  RuntimeProfileSnapshot,
  RuntimeSessionRef,
  RuntimeSessionStatus,
  RuntimeTurnStatus,
    TokenUsage,
    CancelTurnInput,
    CancelSessionInput,
    SessionStatusInput,
} from './contracts';
import { defaultPermissionPolicy } from './contracts';
import {
  RuntimeSqliteStore,
  type RuntimeBindingRecord,
  type RuntimeEventRecord,
  type RuntimeProjection,
  type RuntimeSessionRecord,
} from './sqlite/runtime-store';
import type { RuntimeSqliteDatabase } from './sqlite/database';
import { capabilitiesForResolvedRoute, resolveModelRoute, type ResolvedModelRouteRecord } from './models/model-routes';

export interface RuntimeOrchestratorOptions {
  db?: RuntimeSqliteDatabase;
  store?: RuntimeSqliteStore;
  adapterRegistry?: RuntimeAdapterRegistry;
  resolveModelRoute?: (input: { agentId: string; modelRouteId?: string }) => ResolvedModelRoute | Promise<ResolvedModelRoute>;
  leaseOwner?: string;
  leaseDurationMs?: number;
}

export function createRuntimeOrchestrator(options: RuntimeOrchestratorOptions): RuntimeOrchestrator {
  if (!options.store && !options.db) {
    throw new Error('createRuntimeOrchestrator requires store or db');
  }
  return new DefaultRuntimeOrchestrator(options);
}

class DefaultRuntimeOrchestrator implements RuntimeOrchestrator {
  private readonly store: RuntimeSqliteStore;
  private readonly adapterRegistry: RuntimeAdapterRegistry;
  private readonly leaseOwner: string;
  private readonly leaseDurationMs: number;

  constructor(private readonly options: RuntimeOrchestratorOptions) {
    this.store = options.store ?? new RuntimeSqliteStore(options.db!);
    this.adapterRegistry = options.adapterRegistry ?? createRuntimeAdapterRegistry();
    this.leaseOwner = options.leaseOwner ?? 'runtime-orchestrator';
    this.leaseDurationMs = options.leaseDurationMs ?? 120_000;
  }

  async openSession(input: OpenRuntimeSessionInput): Promise<RuntimeSessionRef> {
    const modelRoute = await this.resolveModelRoute(input.agentId, input.modelRouteId);
    const profileSnapshot = createProfileSnapshot(input, modelRoute);
    this.ensurePermissionPolicy(profileSnapshot.permissionPolicyId);
    const traceId = randomUUID();
    const session = this.store.createSession({
      agentId: input.agentId,
      kind: input.kind,
      modelRouteId: modelRoute.modelRouteId,
      ownerUserId: input.ownerUserId,
      title: input.title,
      status: 'active',
      workingDirectory: input.cwd,
    });
    this.store.saveSessionSnapshot({
      sessionId: session.id,
      agentId: input.agentId,
      modelRouteId: modelRoute.modelRouteId,
      systemPromptHash: profileSnapshot.systemPromptHash,
      skillsRevision: profileSnapshot.skillsRevision,
      mcpRevision: profileSnapshot.mcpRevision,
      interruptPolicy: profileSnapshot.interruptPolicy,
      skills: profileSnapshot.skills,
      mcpServers: profileSnapshot.mcpServers,
      envProfileId: profileSnapshot.envProfileId,
      secretProfileId: profileSnapshot.secretProfileId,
      permissionPolicyId: profileSnapshot.permissionPolicyId,
      cwd: input.cwd,
      snapshot: profileSnapshot,
    });

    let runtime: RuntimeBinding['runtime'] | undefined;
    if (!input.deferAdapterSessionInitialization) {
      const adapter = this.adapterRegistry.getAdapterForAgent(input.agentId);
      let binding: RuntimeBinding | undefined;
      try {
        binding = await adapter.createOrLoadSession({
          runtimeSessionId: session.id,
          agentId: input.agentId,
          modelRoute,
          profileSnapshot,
        });
        this.persistBinding(binding);
        runtime = binding.runtime;
      } catch (error) {
        if (binding) {
          await adapter.close(binding).catch(() => {});
        }
        const runtimeFailure = toRuntimeError(error);
        this.store.updateSessionStatus({ sessionId: session.id, status: 'invalid' });
        this.store.appendTrace({
          traceId,
          sessionId: session.id,
          level: 'error',
          source: 'orchestrator',
          payload: { event: 'session.open.failed', error: runtimeFailure },
          redacted: true,
        });
        throw new Error(runtimeFailure.message);
      }
    }
    this.store.appendTrace({
      traceId,
      sessionId: session.id,
      level: 'info',
      source: 'orchestrator',
      payload: {
        event: 'session.opened',
        agentId: input.agentId,
        modelRouteId: modelRoute.modelRouteId,
        runtime,
        deferredAdapterSessionInitialization: Boolean(input.deferAdapterSessionInitialization),
      },
      redacted: true,
    });

    return sessionToRef(session);
  }

  async *runTurn(input: RunRuntimeTurnInput): AsyncIterable<RuntimeEvent> {
    let session = this.store.getSession(input.runtimeSessionId);
    if (!session) throw new Error(`Runtime session not found: ${input.runtimeSessionId}`);
    const modelRoute = await this.resolveModelRoute(session.agentId, session.modelRouteId);
    const profileSnapshot = input.profileSnapshot ?? createProfileSnapshot({
      agentId: session.agentId,
      cwd: session.workingDirectory,
      kind: session.kind,
      modelRouteId: modelRoute.modelRouteId,
      ownerUserId: session.ownerUserId,
    }, modelRoute);
    const interruptPolicy = input.interruptPolicy ?? profileSnapshot.interruptPolicy;

    const existing = this.store.getTurnByRequestId(input.runtimeSessionId, input.requestId);
    if (existing) {
      const existingTerminal = this.replayIfTerminal(existing.id);
      if (existingTerminal) {
        for (const event of existingTerminal) yield event;
        return;
      }
      const active = this.store.getActiveTurn(input.runtimeSessionId);
      if (existing.status !== 'queued' || (active && active.id !== existing.id)) {
        for (const event of this.store.listEventsAfter(input.runtimeSessionId).filter((event) => event.turnId === existing.id).map(eventRecordToDto)) yield event;
        return;
      }
    } else {
      const active = this.store.getActiveTurn(input.runtimeSessionId);
      if (active) {
        if (interruptPolicy === 'reject') {
          const rejected = this.store.enqueueTurn({
            sessionId: input.runtimeSessionId,
            requestId: input.requestId,
            inputText: input.input,
            interruptPolicy,
          });
          const error = runtimeError('CONFLICT', `Runtime session already has active turn: ${active.id}`);
          this.store.rejectQueuedTurn({ turnId: rejected.id, error });
          const event = this.store.appendEvent({
            sessionId: input.runtimeSessionId,
            turnId: rejected.id,
            traceId: rejected.traceId,
            type: 'turn.failed',
            payload: {
              message: error.message,
              activeTurnId: active.id,
              interruptPolicy,
            },
            redacted: true,
          });
          this.store.appendTrace({
            traceId: rejected.traceId,
            sessionId: input.runtimeSessionId,
            turnId: rejected.id,
            level: 'warning',
            source: 'orchestrator',
            payload: {
              event: 'turn.rejected',
              activeTurnId: active.id,
              requestId: input.requestId,
            },
            redacted: true,
          });
          yield eventRecordToDto(event);
          return;
        }

        if (interruptPolicy === 'queue') {
          const queued = this.store.enqueueTurn({
            sessionId: input.runtimeSessionId,
            requestId: input.requestId,
            inputText: input.input,
            interruptPolicy,
          });
          const event = this.store.appendEvent({
            sessionId: input.runtimeSessionId,
            turnId: queued.id,
            traceId: queued.traceId,
            type: 'turn.queued',
            payload: {
              activeTurnId: active.id,
              interruptPolicy,
            },
            redacted: true,
          });
          this.store.appendTrace({
            traceId: queued.traceId,
            sessionId: input.runtimeSessionId,
            turnId: queued.id,
            level: 'info',
            source: 'orchestrator',
            payload: {
              event: 'turn.queued',
              activeTurnId: active.id,
              requestId: input.requestId,
            },
            redacted: true,
          });
          yield eventRecordToDto(event);
          return;
        }

        try {
          await this.cancelActiveTurn(session.id, active.id, input.requestId);
        } catch (error) {
          session = this.createCancelFailureIsolationSession({
            session,
            activeTurnId: active.id,
            requestId: input.requestId,
            error: toRuntimeError(error),
          });
        }
      }
    }

    const queued = this.store.enqueueTurn({
      sessionId: session.id,
      requestId: input.requestId,
      inputText: input.input,
      interruptPolicy,
    });
    const existingTerminal = this.replayIfTerminal(queued.id);
    if (existingTerminal) {
      for (const event of existingTerminal) yield event;
      return;
    }

    const claimed = this.store.claimTurn({
      turnId: queued.id,
      leaseOwner: this.leaseOwner,
      leaseDurationMs: this.leaseDurationMs,
    });
    if (!claimed?.leaseToken) {
      for (const event of this.store.listEventsAfter(session.id).map(eventRecordToDto)) yield event;
      return;
    }

    const adapter = this.adapterRegistry.getAdapterForAgent(session.agentId);
    let binding: RuntimeBinding;
    try {
      binding = await this.loadOrCreateBinding(
        adapter,
        session.id,
        session.agentId,
        session.kind,
        claimed.id,
        modelRoute,
        profileSnapshot,
      );
    } catch (error) {
      const runtimeFailure = toRuntimeError(error);
      this.store.appendTrace({
        traceId: claimed.traceId,
        sessionId: session.id,
        turnId: claimed.id,
        level: 'error',
        source: 'orchestrator',
        payload: { event: 'turn.binding.failed', error: runtimeFailure },
        redacted: true,
      });
      yield this.persistAdapterEvent(session.id, claimed.id, claimed.traceId, {
        type: 'turn.failed',
        payload: { message: runtimeFailure.message },
        error: runtimeFailure,
        redacted: true,
      });
      this.store.completeTurn({
        turnId: claimed.id,
        leaseToken: claimed.leaseToken,
        status: 'failed',
        error: runtimeFailure,
      });
      return;
    }
    let finalStatus: Extract<RuntimeTurnStatus, 'completed' | 'failed' | 'cancelled' | 'expired' | 'invalid'> = 'completed';
    let finalUsage: TokenUsage | undefined;
    let finalCost: CostUsage | undefined;
    let finalError: RuntimeErrorDto | undefined;

    let adapterFinished = false;

    try {
      for await (const adapterEvent of adapter.runTurn(binding, {
        turnId: claimed.id,
        requestId: input.requestId,
        traceId: claimed.traceId,
        input: input.input,
        interruptPolicy,
        profileSnapshot,
        metadata: input.metadata,
      })) {
        const event = this.persistAdapterEvent(session.id, claimed.id, claimed.traceId, adapterEvent);
        finalUsage = adapterEvent.usage ?? finalUsage;
        finalCost = adapterEvent.cost ?? finalCost;
        if (adapterEvent.type === 'turn.failed') {
          finalStatus = 'failed';
          finalError = adapterEvent.error ?? runtimeError('ADAPTER_FAILED', 'Runtime adapter reported failure');
        } else if (adapterEvent.type === 'turn.cancelled') {
          finalStatus = 'cancelled';
        }
        yield event;
      }
      adapterFinished = true;
    } catch (error) {
      adapterFinished = true;
      finalStatus = 'failed';
      finalError = toRuntimeError(error);
      yield this.persistAdapterEvent(session.id, claimed.id, claimed.traceId, {
        type: 'turn.failed',
        payload: { message: finalError.message },
        error: finalError,
        redacted: true,
      });
    } finally {
      await this.closeBindingAfterTurn({
        adapter,
        binding,
        sessionId: session.id,
        turnId: claimed.id,
        traceId: claimed.traceId,
        reason: adapterFinished ? 'turn terminal' : 'turn consumer detached',
      });
      if (!adapterFinished) {
        this.store.appendTrace({
          traceId: claimed.traceId,
          sessionId: session.id,
          turnId: claimed.id,
          level: 'info',
          source: 'orchestrator',
          payload: { event: 'turn.consumer.detached' },
          redacted: true,
        });
        return;
      }
      const latestTurn = this.store.getTurn(claimed.id);
      if (latestTurn && !['running', 'canceling'].includes(latestTurn.status)) {
        return;
      }
      if (finalStatus === 'completed' && latestTurn?.status === 'canceling') {
        finalStatus = 'cancelled';
      }
      this.store.completeTurn({
        turnId: claimed.id,
        leaseToken: claimed.leaseToken,
        status: finalStatus,
        usage: finalUsage,
        cost: finalCost,
        error: finalError,
      });
    }
  }

  private async cancelActiveTurn(runtimeSessionId: string, turnId: string, requestId: string): Promise<void> {
    try {
      await this.cancelTurn({
        runtimeSessionId,
        turnId,
        requestId: `${requestId}:interrupt`,
        reason: 'interrupted by a newer runtime turn',
      });
    } catch (error) {
      const runtimeFailure = toRuntimeError(error);
      try {
        this.store.restoreTurnRunning({ turnId, error: runtimeFailure });
      } catch {
        // The turn may already have reached a terminal state in a race.
      }
      throw runtimeFailure;
    }
    const cancelled = this.store.getTurn(turnId);
    if (cancelled?.status === 'canceling' && cancelled.leaseToken) {
      this.store.completeTurn({
        turnId,
        leaseToken: cancelled.leaseToken,
        status: 'cancelled',
      });
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const turn = this.store.getTurn(input.turnId);
    if (!turn || turn.sessionId !== input.runtimeSessionId) {
      throw new Error(`Runtime turn not found: ${input.turnId}`);
    }
    if (turn.status === 'queued') {
      this.store.cancelQueuedTurn({
        turnId: input.turnId,
        cancelRequestId: input.requestId,
        reason: input.reason,
      });
      this.store.appendEvent({
        sessionId: input.runtimeSessionId,
        turnId: input.turnId,
        traceId: turn.traceId,
        type: 'turn.cancelled',
        payload: { reason: input.reason ?? 'cancelled' },
        redacted: true,
      });
      return;
    }
    if (turn.status !== 'running') return;

    this.store.markTurnCanceling({
      turnId: input.turnId,
      cancelRequestId: input.requestId,
      reason: input.reason,
    });
    const bindingRecord = this.store.getPrimaryBinding(input.runtimeSessionId);
    if (!bindingRecord) return;
    try {
      await this.adapterRegistry.getAdapter(bindingRecord.runtime).cancel(bindingRecordToRuntimeBinding(bindingRecord), {
        turnId: input.turnId,
        requestId: input.requestId,
        reason: input.reason,
      });
    } catch (error) {
      const runtimeFailure = toRuntimeError(error);
      this.store.appendTrace({
        traceId: turn.traceId,
        sessionId: input.runtimeSessionId,
        turnId: input.turnId,
        level: 'error',
        source: 'orchestrator',
        payload: { event: 'turn.cancel.failed', error: runtimeFailure },
        redacted: true,
      });
      throw runtimeFailure;
    }
    this.store.appendEvent({
      sessionId: input.runtimeSessionId,
      turnId: input.turnId,
      traceId: turn.traceId,
      type: 'turn.canceling',
      payload: { reason: input.reason ?? 'cancel requested' },
      redacted: true,
    });
  }

  async cancelSession(input: CancelSessionInput): Promise<void> {
    const active = this.store.getActiveTurn(input.runtimeSessionId);
    if (!active) return;
    await this.cancelTurn({
      runtimeSessionId: input.runtimeSessionId,
      turnId: active.id,
      requestId: input.requestId,
      reason: input.reason,
    });
  }

  async getSessionStatus(input: SessionStatusInput): Promise<RuntimeSessionStatus> {
    const session = this.store.getSession(input.runtimeSessionId);
    if (!session) throw new Error(`Runtime session not found: ${input.runtimeSessionId}`);
    const bindingRecord = this.store.getPrimaryBinding(input.runtimeSessionId);
    if (bindingRecord) {
      try {
        await this.adapterRegistry.getAdapter(bindingRecord.runtime).getStatus(bindingRecordToRuntimeBinding(bindingRecord));
      } catch (error) {
        this.store.appendTrace({
          traceId: randomUUID(),
          sessionId: input.runtimeSessionId,
          level: 'error',
          source: 'orchestrator',
          payload: { event: 'session.status.adapter.failed', error: toRuntimeError(error) },
          redacted: true,
        });
      }
    }
    return session.status;
  }

  async compactSession(input: CompactSessionInput): Promise<CompactResult> {
    const session = this.store.getSession(input.runtimeSessionId);
    if (!session) return { runtimeSessionId: input.runtimeSessionId, status: 'failed', error: runtimeError('NOT_FOUND', 'Runtime session not found') };
    const traceId = randomUUID();
    const operation = this.store.createOperation({
      sessionId: input.runtimeSessionId,
      kind: 'compact',
      traceId,
      request: input,
    });
    this.store.updateSessionStatus({ sessionId: input.runtimeSessionId, status: 'compacting' });
    try {
      this.store.updateOperationStatus({ operationId: operation.id, status: 'external-running' });
      const bindingRecord = this.store.getPrimaryBinding(input.runtimeSessionId);
      let summary: string | undefined;
      if (bindingRecord) {
        const adapter = this.adapterRegistry.getAdapter(bindingRecord.runtime);
        if (adapter.compact) {
          const handoff = await adapter.compact(bindingRecordToRuntimeBinding(bindingRecord), {
            traceId,
            atTurnId: input.atTurnId,
            strategy: input.strategy,
          });
          summary = handoff.summary;
        }
      }
      this.store.updateOperationStatus({ operationId: operation.id, status: 'finalizing' });
      this.store.updateSessionStatus({ sessionId: input.runtimeSessionId, status: 'compacted' });
      this.store.completeOperation({
        operationId: operation.id,
        status: 'completed',
        result: { strategy: input.strategy ?? 'summary', atTurnId: input.atTurnId, summary },
      });
      this.store.appendTrace({
        traceId,
        sessionId: input.runtimeSessionId,
        level: 'info',
        source: 'orchestrator',
        payload: { event: 'session.compacted', requestId: input.requestId, summary: Boolean(summary) },
        redacted: true,
      });
      return { runtimeSessionId: input.runtimeSessionId, status: 'completed', summary };
    } catch (error) {
      const runtimeFailure = toRuntimeError(error);
      this.store.updateOperationStatus({ operationId: operation.id, status: 'failed', error: runtimeFailure });
      this.store.updateSessionStatus({ sessionId: input.runtimeSessionId, status: 'active' });
      this.store.appendTrace({
        traceId,
        sessionId: input.runtimeSessionId,
        level: 'error',
        source: 'orchestrator',
        payload: { event: 'session.compact.failed', error: runtimeFailure },
        redacted: true,
      });
      return { runtimeSessionId: input.runtimeSessionId, status: 'failed', error: runtimeFailure };
    }
  }

  async forkSession(input: ForkSessionInput): Promise<ForkResult> {
    const session = this.store.getSession(input.runtimeSessionId);
    if (!session) return { runtimeSessionId: input.runtimeSessionId, status: 'failed', error: runtimeError('NOT_FOUND', 'Runtime session not found') };
    const traceId = randomUUID();
    const operation = this.store.createOperation({
      sessionId: input.runtimeSessionId,
      kind: 'fork',
      traceId,
      request: input,
    });
    this.store.updateSessionStatus({ sessionId: input.runtimeSessionId, status: 'forking' });
    const forked = this.store.createSession({
      kind: session.kind,
      agentId: session.agentId,
      modelRouteId: session.modelRouteId,
      ownerUserId: session.ownerUserId,
      title: input.title ?? session.title,
      workingDirectory: session.workingDirectory,
      status: 'active',
    });
    const edgeId = this.store.createSessionEdge({
      operationId: operation.id,
      fromSessionId: input.runtimeSessionId,
      toSessionId: forked.id,
      kind: 'fork',
      status: 'pending',
      atTurnId: input.atTurnId,
      atMessageId: input.atMessageId,
      metadata: { requestId: input.requestId },
    });
    try {
      this.store.updateOperationStatus({ operationId: operation.id, status: 'external-running', targetSessionId: forked.id });
      const bindingRecord = this.store.getPrimaryBinding(input.runtimeSessionId);
      if (bindingRecord) {
        const adapter = this.adapterRegistry.getAdapter(bindingRecord.runtime);
        if (adapter.fork) {
          const handoff = await adapter.fork(bindingRecordToRuntimeBinding(bindingRecord), {
            traceId,
            targetRuntimeSessionId: forked.id,
            atTurnId: input.atTurnId,
            atMessageId: input.atMessageId,
          });
          this.persistBinding({ ...handoff.binding, runtimeSessionId: forked.id });
        }
      }
      this.store.updateOperationStatus({ operationId: operation.id, status: 'finalizing', targetSessionId: forked.id });
      this.store.createSessionEdge({
        id: edgeId,
        operationId: operation.id,
        fromSessionId: input.runtimeSessionId,
        toSessionId: forked.id,
        kind: 'fork',
        status: 'active',
        atTurnId: input.atTurnId,
        atMessageId: input.atMessageId,
        metadata: { requestId: input.requestId },
      });
      this.store.updateSessionStatus({ sessionId: input.runtimeSessionId, status: 'active' });
      this.store.completeOperation({
        operationId: operation.id,
        status: 'completed',
        targetSessionId: forked.id,
        result: { forkedSessionId: forked.id },
      });
      this.store.appendTrace({
        traceId,
        sessionId: input.runtimeSessionId,
        level: 'info',
        source: 'orchestrator',
        payload: { event: 'session.forked', forkedSessionId: forked.id },
        redacted: true,
      });
      return { runtimeSessionId: input.runtimeSessionId, forkedSessionId: forked.id, status: 'completed' };
    } catch (error) {
      const runtimeFailure = toRuntimeError(error);
      this.store.updateOperationStatus({ operationId: operation.id, status: 'compensating', error: runtimeFailure });
      this.store.createSessionEdge({
        id: edgeId,
        operationId: operation.id,
        fromSessionId: input.runtimeSessionId,
        toSessionId: forked.id,
        kind: 'fork',
        status: 'failed',
        atTurnId: input.atTurnId,
        atMessageId: input.atMessageId,
        error: runtimeFailure,
        metadata: { requestId: input.requestId },
      });
      this.store.updateSessionStatus({ sessionId: forked.id, status: 'invalid' });
      this.store.updateSessionStatus({ sessionId: input.runtimeSessionId, status: 'active' });
      this.store.updateOperationStatus({
        operationId: operation.id,
        status: 'compensated',
        targetSessionId: forked.id,
        error: runtimeFailure,
        compensation: { invalidatedSessionId: forked.id },
      });
      this.store.appendTrace({
        traceId,
        sessionId: input.runtimeSessionId,
        level: 'error',
        source: 'orchestrator',
        payload: { event: 'session.fork.failed', error: runtimeFailure },
        redacted: true,
      });
      return { runtimeSessionId: input.runtimeSessionId, forkedSessionId: forked.id, status: 'failed', error: runtimeFailure };
    }
  }

  private async resolveModelRoute(agentId: string, modelRouteId?: string): Promise<ResolvedModelRoute> {
    if (this.options.resolveModelRoute) {
      return this.options.resolveModelRoute({ agentId, modelRouteId });
    }
    if (!this.options.db) {
      throw new Error('Runtime model route resolver requires db or resolveModelRoute option');
    }
    const resolved = resolveModelRoute(this.options.db, {
      agentId,
      modelRouteId,
      modelId: modelRouteId ? undefined : undefined,
    });
    return toContractModelRoute(resolved);
  }

  private ensurePermissionPolicy(policyId: RuntimePermissionPolicyId): void {
    this.store.upsertPermissionPolicy({
      policyId,
      displayName: policyId === 'unrestricted' ? 'Unrestricted' : policyId,
      visibility: 'workspace',
    });
  }

  private async loadOrCreateBinding(
    adapter: RuntimeAdapter,
    runtimeSessionId: string,
    agentId: string,
    sessionKind: RuntimeSessionRecord['kind'],
    claimedTurnId: string,
    modelRoute: ResolvedModelRoute,
    profileSnapshot: RuntimeProfileSnapshot,
  ): Promise<RuntimeBinding> {
    const existing = this.store.getPrimaryBinding(runtimeSessionId);
    if (existing) {
      const existingBinding = bindingRecordToRuntimeBinding(existing);
      // Earlier workflow prewarm versions persisted an ACPX binding before a
      // turn existed. That backend session cannot be resumed because it has
      // no rollout. Replace it with a first-turn binding rather than passing
      // its provider session id into reconnectSession.
      const shouldReplaceEmptyWorkflowBinding = sessionKind === 'workflow-agent'
        && !this.store.hasOtherTurns(runtimeSessionId, claimedTurnId);
      if (shouldReplaceEmptyWorkflowBinding) {
        return this.createBinding(adapter, runtimeSessionId, agentId, modelRoute, profileSnapshot, existingBinding);
      }
      if (adapter.reconnectSession) {
        const refreshedBinding = await adapter.reconnectSession({
          runtimeSessionId,
          agentId,
          modelRoute,
          profileSnapshot,
          existingBinding,
        });
        this.persistBinding(refreshedBinding);
        return refreshedBinding;
      }
      return existingBinding;
    }
    return this.createBinding(adapter, runtimeSessionId, agentId, modelRoute, profileSnapshot);
  }

  private async createBinding(
    adapter: RuntimeAdapter,
    runtimeSessionId: string,
    agentId: string,
    modelRoute: ResolvedModelRoute,
    profileSnapshot: RuntimeProfileSnapshot,
    replaceBinding?: RuntimeBinding,
  ): Promise<RuntimeBinding> {
    let binding: RuntimeBinding | undefined;
    try {
      binding = await adapter.createOrLoadSession({
        runtimeSessionId,
        agentId,
        modelRoute,
        profileSnapshot,
      });
      const persistedBinding = replaceBinding
        ? {
            ...binding,
            id: replaceBinding.id,
            role: replaceBinding.role,
            generation: replaceBinding.generation,
            createdAt: replaceBinding.createdAt,
          }
        : binding;
      this.persistBinding(persistedBinding);
      return persistedBinding;
    } catch (error) {
      if (binding) await adapter.close(binding).catch(() => {});
      throw error;
    }
  }

  private async closeBindingAfterTurn(input: {
    adapter: RuntimeAdapter;
    binding: RuntimeBinding;
    sessionId: string;
    turnId: string;
    traceId: string;
    reason: string;
  }): Promise<void> {
    try {
      await input.adapter.close(input.binding);
      this.store.appendTrace({
        traceId: input.traceId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        level: 'info',
        source: 'orchestrator',
        payload: { event: 'turn.runtime.closed', reason: input.reason },
        redacted: true,
      });
    } catch (error) {
      // Cleanup failures must be observable without replacing the turn result. A later turn will
      // reconnect from the persisted session record, while this trace keeps the leak signal in
      // the backend diagnostics rather than relying on a process-manager sweep.
      this.store.appendTrace({
        traceId: input.traceId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        level: 'error',
        source: 'orchestrator',
        payload: { event: 'turn.runtime.close.failed', reason: input.reason, error: toRuntimeError(error) },
        redacted: true,
      });
    }
  }

  private persistBinding(binding: RuntimeBinding): void {
    this.store.upsertBinding({
      id: binding.id,
      sessionId: binding.runtimeSessionId,
      runtime: binding.runtime,
      role: binding.role,
      generation: binding.generation,
      externalRecordId: binding.externalIds.externalRecordId,
      externalSessionId: binding.externalIds.externalSessionId,
      providerSessionId: binding.externalIds.providerSessionId,
      raw: binding.raw,
      now: binding.updatedAt,
    });
  }

  private persistAdapterEvent(
    sessionId: string,
    turnId: string,
    traceId: string,
    adapterEvent: AdapterRuntimeEvent,
  ): RuntimeEvent {
    const payload = withRuntimeUsageAndCost(adapterEvent.payload, adapterEvent.usage, adapterEvent.cost);
    const record = this.store.appendEvent({
      sessionId,
      turnId,
      traceId,
      type: adapterEvent.type,
      correlationId: adapterEvent.correlationId,
      parentEventId: adapterEvent.parentEventId,
      messageId: adapterEvent.messageId,
      toolCallId: adapterEvent.toolCallId,
      payload: sanitizeForBusiness(payload),
      redacted: adapterEvent.redacted,
      createdAt: adapterEvent.createdAt,
      projectionUpdate: projectionUpdateForAdapterEvent(adapterEvent),
    });
    this.store.appendTrace({
      traceId,
      sessionId,
      turnId,
      level: adapterEvent.error ? 'error' : 'debug',
      source: 'adapter',
      payload: {
        type: adapterEvent.type,
        usage: adapterEvent.usage,
        cost: adapterEvent.cost,
        error: adapterEvent.error ? sanitizeRuntimeError(adapterEvent.error) : undefined,
      },
      redacted: true,
    });
    return eventRecordToDto(record);
  }

  private replayIfTerminal(turnId: string): RuntimeEvent[] | null {
    const turn = this.store.getTurn(turnId);
    if (!turn || !['completed', 'failed', 'cancelled', 'dropped', 'expired', 'invalid'].includes(turn.status)) {
      return null;
    }
    return this.store.listEventsAfter(turn.sessionId).filter((event) => event.turnId === turnId).map(eventRecordToDto);
  }

  private createCancelFailureIsolationSession(input: {
    session: RuntimeSessionRecord;
    activeTurnId: string;
    requestId: string;
    error: RuntimeErrorDto;
  }): RuntimeSessionRecord {
    const traceId = randomUUID();
    const operation = this.store.createOperation({
      sessionId: input.session.id,
      kind: 'fork',
      traceId,
      request: {
        requestId: input.requestId,
        reason: 'cancel-and-send isolation after cancel failure',
      },
    });
    this.store.updateOperationStatus({ operationId: operation.id, status: 'compensating', error: input.error });
    const forked = this.store.createSession({
      kind: input.session.kind,
      agentId: input.session.agentId,
      modelRouteId: input.session.modelRouteId,
      ownerUserId: input.session.ownerUserId,
      title: input.session.title ? `${input.session.title} (isolated)` : undefined,
      workingDirectory: input.session.workingDirectory,
      status: 'active',
    });
    this.store.createSessionEdge({
      operationId: operation.id,
      fromSessionId: input.session.id,
      toSessionId: forked.id,
      kind: 'fork',
      status: 'active',
      atTurnId: input.activeTurnId,
      error: input.error,
      metadata: {
        requestId: input.requestId,
        isolation: 'cancel-and-send',
      },
    });
    this.store.updateOperationStatus({
      operationId: operation.id,
      status: 'compensated',
      targetSessionId: forked.id,
      error: input.error,
      compensation: { isolatedSessionId: forked.id, activeTurnId: input.activeTurnId },
    });
    this.store.appendTrace({
      traceId,
      sessionId: input.session.id,
      turnId: input.activeTurnId,
      level: 'error',
      source: 'orchestrator',
      payload: {
        event: 'turn.cancel_and_send.isolated',
        forkedSessionId: forked.id,
        error: input.error,
      },
      redacted: true,
    });
    return forked;
  }
}

function createProfileSnapshot(
  input: Pick<OpenRuntimeSessionInput, 'agentId' | 'cwd' | 'runtimeProfileId' | 'modelRouteId' | 'mcpServers' | 'ownerUserId'> & { kind?: string },
  modelRoute: ResolvedModelRoute,
): RuntimeProfileSnapshot {
  const definition = getBuiltinAgentDefinition(input.agentId);
  return {
    agentId: input.agentId,
    ownerUserId: input.ownerUserId,
    modelRouteId: modelRoute.modelRouteId,
    cwd: input.cwd,
    systemPromptHash: 'sha256:runtime-default',
    skillsRevision: 'runtime-default',
    mcpRevision: 'runtime-default',
    permissionPolicyId: defaultPermissionPolicy,
    interruptPolicy: 'queue',
    skills: definition ? [{ agentId: definition.id, tier: definition.tier }] : [],
    mcpServers: input.mcpServers || [],
  };
}

function sessionToRef(session: {
  id: string;
  agentId: string;
  kind: RuntimeSessionRef['kind'];
  status: RuntimeSessionStatus;
  modelRouteId?: string;
  createdAt: string;
  updatedAt: string;
}): RuntimeSessionRef {
  return {
    runtimeSessionId: session.id,
    agentId: session.agentId,
    kind: session.kind,
    status: session.status,
    modelRouteId: session.modelRouteId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function eventRecordToDto(record: RuntimeEventRecord): RuntimeEvent {
  return {
    id: record.id,
    sessionId: record.sessionId,
    turnId: record.turnId,
    traceId: record.traceId,
    seq: record.seq,
    type: record.type as RuntimeEventType,
    correlationId: record.correlationId,
    parentEventId: record.parentEventId,
    messageId: record.messageId,
    toolCallId: record.toolCallId,
    payload: record.payload,
    usage: isPlainRecord(record.payload) ? record.payload.usage as TokenUsage | undefined : undefined,
    cost: isPlainRecord(record.payload) ? record.payload.cost as CostUsage | undefined : undefined,
    redacted: record.redacted,
    createdAt: record.createdAt,
  };
}

function withRuntimeUsageAndCost(payload: unknown, usage: TokenUsage | undefined, cost: CostUsage | undefined): unknown {
  const hasUsage = usage && !usage.missing;
  const hasCost = cost && !cost.missing;
  if (!hasUsage && !hasCost) return payload;
  const base = isPlainRecord(payload) ? payload : { value: payload };
  return {
    ...base,
    ...(hasUsage ? { usage } : {}),
    ...(hasCost ? { cost } : {}),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function projectionUpdateForAdapterEvent(adapterEvent: AdapterRuntimeEvent): {
  projection: RuntimeProjection;
  version: number;
  payload: unknown;
} | undefined {
  if (adapterEvent.type === 'message.delta' || adapterEvent.type === 'message.completed') {
    return {
      projection: 'chat',
      version: 1,
      payload: {
        lastMessageEvent: sanitizeForBusiness(adapterEvent.payload),
        messageId: adapterEvent.messageId,
      },
    };
  }
  if (adapterEvent.type === 'status.changed' || adapterEvent.type.startsWith('turn.')) {
    return {
      projection: 'workflow',
      version: 1,
      payload: {
        lastStatusEvent: adapterEvent.type,
        payload: sanitizeForBusiness(adapterEvent.payload),
      },
    };
  }
  if (adapterEvent.type.startsWith('tool.') || adapterEvent.type === 'command.invoked') {
    return {
      projection: 'process-block',
      version: 1,
      payload: {
        lastProcessEvent: adapterEvent.type,
        toolCallId: adapterEvent.toolCallId,
        payload: sanitizeForBusiness(adapterEvent.payload),
      },
    };
  }
  return undefined;
}

function sanitizeRuntimeError(error: RuntimeErrorDto): RuntimeErrorDto {
  return {
    ...error,
    message: redactNativeIds(error.message),
    details: sanitizeForBusiness(error.details) as Record<string, unknown> | undefined,
    cause: error.cause
      ? {
          ...error.cause,
          code: error.cause.code ? redactNativeIds(error.cause.code) : undefined,
          message: redactNativeIds(error.cause.message),
        }
      : undefined,
    redacted: true,
  };
}

function sanitizeForBusiness(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sanitizeForBusiness);
  if (input && typeof input === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (isNativeIdKey(key)) {
        output[key] = '[redacted]';
      } else {
        output[key] = sanitizeForBusiness(value);
      }
    }
    return output;
  }
  if (typeof input === 'string') return redactNativeIds(input);
  return input;
}

function isNativeIdKey(key: string): boolean {
  return /^(raw|externalIds)$/.test(key) || /(provider|external|native).*id/i.test(key) || /.*(provider|external|native).*session/i.test(key);
}

function redactNativeIds(input: string): string {
  return input
    .replace(/\b(?:provider|external|native|record|session)-[A-Za-z0-9_.:-]+\b/g, '[redacted]')
    .replace(/\bprovider-session-private\b/g, '[redacted]')
    .replace(/\bsession-private\b/g, '[redacted]')
    .replace(/\brecord-private\b/g, '[redacted]');
}

function bindingRecordToRuntimeBinding(record: RuntimeBindingRecord): RuntimeBinding {
  return {
    id: record.id,
    runtimeSessionId: record.sessionId,
    runtime: record.runtime,
    role: record.role,
    generation: record.generation,
    externalIds: {
      externalRecordId: record.externalRecordId,
      externalSessionId: record.externalSessionId,
      providerSessionId: record.providerSessionId,
    },
    raw: record.raw,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toContractModelRoute(route: ResolvedModelRouteRecord): ResolvedModelRoute {
  return {
    modelRouteId: route.modelRouteId,
    agentId: route.agentId,
    runtime: route.runtime,
    providerModel: route.providerModel,
    configOptions: route.configOptions,
    envRequirements: route.envRequirements.map((item) => {
      if (item && typeof item === 'object') return item as ResolvedModelRoute['envRequirements'][number];
      return { key: String(item), required: false, secret: false };
    }),
    capabilities: capabilitiesForResolvedRoute(route),
  };
}

function runtimeError(code: RuntimeErrorDto['code'], message: string): RuntimeErrorDto {
  return {
    code,
    message,
    retryable: code === 'ADAPTER_UNAVAILABLE' || code === 'ADAPTER_FAILED',
    redacted: true,
  };
}

function toRuntimeError(error: unknown): RuntimeErrorDto {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const candidate = error as Partial<RuntimeErrorDto>;
    return {
      code: candidate.code ?? 'UNKNOWN',
      message: typeof candidate.message === 'string' ? redactNativeIds(candidate.message) : 'Runtime adapter failed',
      retryable: Boolean(candidate.retryable),
      details: sanitizeForBusiness(candidate.details) as Record<string, unknown> | undefined,
      cause: candidate.cause
        ? {
            ...candidate.cause,
            code: candidate.cause.code ? redactNativeIds(candidate.cause.code) : undefined,
            message: redactNativeIds(candidate.cause.message),
          }
        : undefined,
      redacted: true,
    };
  }
  return runtimeError('ADAPTER_FAILED', error instanceof Error ? redactNativeIds(error.message) : 'Runtime adapter failed');
}
