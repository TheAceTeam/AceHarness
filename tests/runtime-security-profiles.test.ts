import { describe, expect, test } from 'vitest';
import {
  checkSecretProfileReadiness,
  createPermissionAuditEvents,
  createPermissionTraceEvents,
  defaultPermissionPolicy,
  redactRecord,
  redactRuntimeBinding,
  redactText,
  resolvePermissionRequest,
  resolveRuntimeEnv,
  toPublicSecretProfileDto,
  type RuntimeBinding,
  type RuntimePermissionRequest,
  type RuntimeSecretProfileDto,
} from '../src/lib/runtime-agent';
import { openRuntimeSqliteDatabase } from '../src/lib/runtime-agent/sqlite/database';
import { RuntimeSqliteStore } from '../src/lib/runtime-agent/sqlite/runtime-store';

const permissionRequest = {
  id: 'permission-1',
  sessionId: 'runtime-session-1',
  turnId: 'turn-1',
  agentId: 'codex',
  operation: 'execute',
  proposedCommand: 'rm -rf /tmp/project',
  risk: 'high',
  raw: {
    Authorization: 'Bearer real-token-value',
    apiKey: 'sk-real',
  },
} satisfies RuntimePermissionRequest;

describe('runtime security profiles', () => {
  test('defaults to unrestricted permission policy and auto-approves all operations', () => {
    expect(defaultPermissionPolicy).toBe('unrestricted');

    const operations = ['read', 'write', 'execute', 'network', 'mcp', 'unknown'] as const;
    for (const operation of operations) {
      const result = resolvePermissionRequest({
        request: {
          ...permissionRequest,
          id: `permission-${operation}`,
          operation,
          risk: operation === 'unknown' ? 'high' : 'low',
        },
        resolvedAt: '2026-07-09T00:00:00.000Z',
      });

      expect(result.requiresUserDecision).toBe(false);
      expect(result.resolution).toMatchObject({
        decision: 'auto-approved',
        policyId: 'unrestricted',
        resolvedBy: 'policy',
      });
    }
  });

  test('permission audit helpers emit requested/resolved runtime events and traces with redacted raw payloads', () => {
    const result = resolvePermissionRequest({
      request: permissionRequest,
      resolvedAt: '2026-07-09T00:00:00.000Z',
    });
    expect(result.resolution).toBeDefined();

    const events = createPermissionAuditEvents({
      request: permissionRequest,
      resolution: result.resolution,
      traceId: 'trace-1',
      seqStart: 7,
      createdAt: '2026-07-09T00:00:00.000Z',
    });
    const traces = createPermissionTraceEvents({
      request: permissionRequest,
      resolution: result.resolution,
      traceId: 'trace-1',
      createdAt: '2026-07-09T00:00:00.000Z',
    });

    expect(events.map((event) => event.type)).toEqual(['permission.requested', 'permission.resolved']);
    expect(events.map((event) => event.seq)).toEqual([7, 8]);
    expect(events[0].redacted).toBe(true);
    expect(JSON.stringify(events[0].payload)).not.toContain('real-token-value');
    expect(JSON.stringify(events[0].payload)).not.toContain('sk-real');
    expect(events[1].payload).toMatchObject({ decision: 'auto-approved' });
    expect(traces.map((trace) => trace.source)).toEqual(['permission', 'permission']);
    expect(JSON.stringify(traces[0].payload)).not.toContain('real-token-value');
  });

  test('non-default policies ask, approve reads, deny destructive requests, or deny all', () => {
    expect(resolvePermissionRequest({ request: { ...permissionRequest, operation: 'read', risk: 'low' }, policyId: 'approve-reads' }).resolution?.decision).toBe('auto-approved');
    expect(resolvePermissionRequest({ request: permissionRequest, policyId: 'approve-reads' }).requiresUserDecision).toBe(true);
    expect(resolvePermissionRequest({ request: permissionRequest, policyId: 'deny-destructive' }).resolution?.decision).toBe('auto-denied');
    expect(resolvePermissionRequest({ request: { ...permissionRequest, risk: 'low', proposedCommand: 'npm test' }, policyId: 'deny-destructive' }).resolution?.decision).toBe('auto-approved');
    expect(resolvePermissionRequest({ request: permissionRequest, policyId: 'deny-all' }).resolution?.decision).toBe('auto-denied');
    expect(resolvePermissionRequest({ request: permissionRequest, policyId: 'ask' }).requiresUserDecision).toBe(true);
  });

  test('redaction helpers redact common secret shapes and runtime binding internals', () => {
    expect(redactText('Authorization: Bearer abcdefghijklmnop').value).toBe('Authorization: Bearer [REDACTED]');
    expect(redactText('OPENAI_API_KEY=sk-real').value).toBe('OPENAI_API_KEY=[REDACTED]');
    expect(redactText('sftp://alice:secret@example.com/home').value).toBe('sftp://alice:[REDACTED]@example.com/home');

    const record = redactRecord({
      nested: {
        token: 'real-token',
        safe: 'ok',
      },
    });
    expect(record.redacted).toBe(true);
    expect(record.value).toEqual({ nested: { token: '[REDACTED]', safe: 'ok' } });

    const binding: RuntimeBinding = {
      id: 'binding-1',
      runtimeSessionId: 'runtime-session-1',
      runtime: 'acpx',
      role: 'primary',
      generation: 1,
      externalIds: { providerSessionId: 'provider-secret' },
      raw: { accessToken: 'secret' },
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    };
    expect(redactRuntimeBinding(binding)).toEqual({
      id: 'binding-1',
      runtimeSessionId: 'runtime-session-1',
      runtime: 'acpx',
      role: 'primary',
      generation: 1,
      externalIdsRedacted: true,
      rawRedacted: true,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    });
  });

  test('redaction covers diagnostic, command, diff, stderr, binding, tool IO, and private key shapes', () => {
    const leakedSecret = 'super-secret-value';
    const payload = {
      prompt: `use token ${leakedSecret}`,
      toolIo: {
        input: { api_token: leakedSecret },
        output: `Authorization: Bearer abcdefghijklmnop`,
      },
      rawBinding: {
        providerSessionId: 'provider-private',
        raw: { accessToken: leakedSecret },
      },
      command: `OPENAI_API_KEY=${leakedSecret} npm test`,
      diff: `+ const token = "${leakedSecret}";`,
      stderr: `private_key=${leakedSecret}`,
      pem: '-----BEGIN PRIVATE KEY-----\nabcdef\n-----END PRIVATE KEY-----',
    };

    const redacted = redactRecord(payload, { secrets: [leakedSecret, 'abcdef'] });
    const serialized = JSON.stringify(redacted.value);

    expect(redacted.redacted).toBe(true);
    expect(serialized).not.toContain(leakedSecret);
    expect(serialized).not.toContain('abcdefghijklmnop');
    expect(serialized).not.toContain('abcdef');
    expect(serialized).toContain('[REDACTED]');
  });

  test('env resolution uses turn, env profile, secret profile, agent default, process env priority without storing secret values in DTOs', () => {
    const secretProfile = {
      id: 'secret-profile-1',
      displayName: 'Codex Secrets',
      encrypted: true,
      encryptionKeyReady: true,
      secrets: [
        {
          key: 'OPENAI_API_KEY',
          secretRef: 'vault://openai',
          required: true,
          readiness: 'ready',
        },
      ],
    } satisfies RuntimeSecretProfileDto;

    const result = resolveRuntimeEnv({
      agentId: 'codex',
      modelRouteId: 'route-1',
      cwd: '/workspace',
      systemPromptHash: 'sha256:abc',
      skillsRevision: 'skills-1',
      mcpRevision: 'mcp-1',
      requirements: [
        { key: 'OPENAI_API_KEY', required: true, secret: true },
        { key: 'PATH', required: false, secret: false },
        { key: 'SAFE_MODE', required: false, secret: false },
      ],
      processEnv: {
        PATH: '/usr/bin',
        OPENAI_API_KEY: 'process-secret',
      },
      agentDefaults: {
        SAFE_MODE: 'default',
      },
      secretProfile,
      secretValues: [
        {
          key: 'OPENAI_API_KEY',
          secretRef: 'vault://openai',
          value: 'runtime-secret',
        },
      ],
      envProfile: {
        id: 'env-profile-1',
        displayName: 'Codex Env',
        variables: [
          {
            key: 'PATH',
            value: '/custom/bin',
          },
        ],
      },
      turnOverrides: {
        SAFE_MODE: 'turn',
      },
    });

    expect(result.adapterEnv).toMatchObject({
      OPENAI_API_KEY: 'runtime-secret',
      PATH: '/custom/bin',
      SAFE_MODE: 'turn',
    });
    expect(result.snapshot.envProfileId).toBe('env-profile-1');
    expect(result.snapshot.secretProfileId).toBe('secret-profile-1');
    expect(result.snapshot.permissionPolicyId).toBe('unrestricted');
    expect(result.snapshot.env).toContainEqual({
      key: 'OPENAI_API_KEY',
      source: 'secret-profile',
      secret: true,
      readiness: 'ready',
    });
    expect(JSON.stringify(result.snapshot)).not.toContain('runtime-secret');
    expect(JSON.stringify(result.snapshot)).not.toContain('process-secret');
    expect(result.conflicts).toContainEqual({
      key: 'OPENAI_API_KEY',
      sources: ['secret-profile', 'process-env'],
      selectedSource: 'secret-profile',
    });
  });

  test('env resolution reports encryption readiness, required secret missing, misconfigured refs, and conflict metadata', () => {
    const result = resolveRuntimeEnv({
      agentId: 'codex',
      modelRouteId: 'route-1',
      cwd: '/workspace',
      systemPromptHash: 'sha256:abc',
      skillsRevision: 'skills-1',
      mcpRevision: 'mcp-1',
      requirements: [
        { key: 'MISSING_TOKEN', required: true, secret: true },
        { key: 'REF_TOKEN', required: false, secret: true },
      ],
      processEnv: {
        MISSING_TOKEN: 'process-token',
      },
      secretProfile: {
        id: 'secret-profile-2',
        displayName: 'Broken Secrets',
        encrypted: true,
        encryptionKeyReady: true,
        secrets: [
          {
            key: 'MISSING_TOKEN',
            secretRef: 'vault://missing-token',
            required: true,
            readiness: 'unknown',
          },
        ],
      },
      envProfile: {
        id: 'env-profile-2',
        displayName: 'Broken Env',
        variables: [
          {
            key: 'REF_TOKEN',
            secretRef: 'vault://not-bound',
          },
        ],
      },
    });

    expect(result.adapterEnv).toEqual({});
    expect(result.missing).toEqual(['MISSING_TOKEN', 'REF_TOKEN']);
    expect(result.snapshot.env).toContainEqual({
      key: 'MISSING_TOKEN',
      source: 'secret-profile',
      secret: true,
      readiness: 'missing',
    });
    expect(result.snapshot.env).toContainEqual({
      key: 'REF_TOKEN',
      source: 'env-profile',
      secret: true,
      readiness: 'misconfigured',
    });
    expect(result.conflicts).toContainEqual({
      key: 'MISSING_TOKEN',
      sources: ['secret-profile', 'process-env'],
      selectedSource: 'secret-profile',
    });
    expect(JSON.stringify(result.snapshot)).not.toContain('process-token');
  });

  test('env resolution rejects values outside a route requirement allowlist', () => {
    const result = resolveRuntimeEnv({
      agentId: 'deepseek-harness',
      modelRouteId: 'route-deepseek',
      cwd: '/workspace',
      systemPromptHash: 'sha256:abc',
      skillsRevision: 'skills-1',
      mcpRevision: 'mcp-1',
      requirements: [
        {
          key: 'DSH_PERMISSION_MODE',
          required: false,
          secret: false,
          allowedValues: ['workspace-write', 'danger-full-access'],
        },
      ],
      processEnv: { DSH_PERMISSION_MODE: 'invalid-mode' },
    });

    expect(result.missing).toEqual(['DSH_PERMISSION_MODE']);
    expect(result.adapterEnv).toEqual({});
    expect(result.snapshot.env).toContainEqual({
      key: 'DSH_PERMISSION_MODE',
      source: 'process-env',
      secret: false,
      readiness: 'misconfigured',
    });
  });

  test('secret profile DTOs expose readiness and refs without secret values', () => {
    const profile = {
      id: 'secret-profile-1',
      displayName: 'Secrets',
      encrypted: true,
      encryptionKeyReady: true,
      secrets: [
        {
          key: 'API_TOKEN',
          secretRef: 'vault://api-token',
          required: true,
          readiness: 'ready',
        },
      ],
    } satisfies RuntimeSecretProfileDto;

    expect(toPublicSecretProfileDto(profile)).toEqual(profile);
    expect(JSON.stringify(toPublicSecretProfileDto(profile))).not.toContain('secret-value');
    expect(checkSecretProfileReadiness(profile)).toBe('ready');
    expect(checkSecretProfileReadiness({ ...profile, encryptionKeyReady: false })).toBe('misconfigured');
    expect(checkSecretProfileReadiness({ ...profile, secrets: [{ ...profile.secrets[0], readiness: 'missing' }] })).toBe('missing');
  });

  test('sqlite profile persistence preserves owner boundaries and never stores secret values in public profile rows', () => {
    const db = openRuntimeSqliteDatabase(':memory:');
    const store = new RuntimeSqliteStore(db);
    try {
      const policy = store.upsertPermissionPolicy({
        policyId: 'deny-destructive',
        displayName: 'Deny Destructive',
        visibility: 'workspace',
      });
      const envProfile = store.upsertEnvProfile({
        id: 'env-private',
        ownerUserId: 'user-1',
        visibility: 'private',
        displayName: 'Private Env',
        variables: [
          { key: 'SAFE_MODE', value: '1' },
          { key: 'API_TOKEN', secretRef: 'vault://api-token', secret: true, required: true },
        ],
      });
      const secretProfile = store.upsertSecretProfile({
        id: 'secret-private',
        ownerUserId: 'user-1',
        visibility: 'private',
        displayName: 'Private Secrets',
        encrypted: true,
        encryptionKeyReady: true,
        secrets: [
          { key: 'API_TOKEN', secretRef: 'vault://api-token', required: true, readiness: 'ready' },
        ],
      });

      expect(policy).toMatchObject({ policyId: 'deny-destructive', visibility: 'workspace' });
      expect(envProfile).toMatchObject({ ownerUserId: 'user-1', visibility: 'private' });
      expect(secretProfile).toMatchObject({ ownerUserId: 'user-1', visibility: 'private', encrypted: true });
      expect(store.getEnvProfile('env-private', { ownerUserId: 'user-2' })).toBeNull();
      expect(store.getSecretProfile('secret-private', { ownerUserId: 'user-2' })).toBeNull();
      expect(store.getEnvProfile('env-private', { ownerUserId: 'user-1' })).toMatchObject({ id: 'env-private' });
      expect(store.getSecretProfile('secret-private', { ownerUserId: 'user-1' })).toMatchObject({ id: 'secret-private' });
      expect(store.listPermissionPolicies({ ownerUserId: 'user-2' })).toContainEqual(expect.objectContaining({ policyId: 'deny-destructive' }));

      const publicDto = toPublicSecretProfileDto(secretProfile);
      const serialized = JSON.stringify({
        env: envProfile,
        secret: publicDto,
        rawRows: db.prepare('SELECT variables_json, secrets_json FROM env_profiles, secret_profiles').get(),
      });
      expect(serialized).not.toContain('super-secret-value');
      expect(serialized).not.toContain('raw-secret');
      expect(serialized).toContain('vault://api-token');
    } finally {
      db.close();
    }
  });
});
