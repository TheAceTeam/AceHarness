import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome, withTempWorkspace } from './helpers/module-helpers';
import { assertErrorResponse, makeRequest, responseJson } from './helpers/route-helpers';

interface AuthResult {
  token: string;
  user: { id: string };
}

async function createAuthToken(role: 'admin' | 'user' = 'user'): Promise<AuthResult> {
  vi.resetModules();
  const { createUser, storeToken } = await import('@/lib/core/user-store');
  const suffix = `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await createUser({
    username: `spec-${suffix}`,
    email: `spec-${suffix}@example.com`,
    password: 'password',
    question: 'q',
    answer: 'a',
    role,
    personalDir: '',
  });
  const token = `token-${suffix}`;
  storeToken(token, user.id);
  return { token, user };
}

async function loadSpecCodingRoutes() {
  const [sessions, sessionById] = await Promise.all([
    import('@/app/api/spec-coding/sessions/route'),
    import('@/app/api/spec-coding/sessions/[id]/route'),
  ]);
  return { sessions, sessionById };
}

function phaseConfig(projectRoot: string) {
  return {
    workflow: {
      name: 'Spec Coding Workflow',
      phases: [
        {
          name: 'Design',
          checkpoint: { name: 'Design review' },
          steps: [
            { name: 'Plan', agent: 'architect', task: 'Design the implementation approach' },
          ],
        },
        {
          name: 'Implement',
          steps: [
            { name: 'Code', agent: 'developer', task: 'Implement the agreed change' },
            { name: 'Verify', agent: 'tester', task: 'Verify the implementation' },
          ],
        },
      ],
    },
    context: {
      projectRoot,
      workspaceMode: 'in-place',
      requirements: 'Deliver the feature through a confirmed spec first',
    },
  };
}

function sessionPayload(workspace: string, overrides: Record<string, any> = {}) {
  return {
    chatSessionId: 'chat-main',
    filename: 'spec-workflow.yaml',
    workflowName: 'Spec Coding Workflow',
    mode: 'phase-based',
    workingDirectory: workspace,
    workspaceMode: 'in-place',
    description: 'Route test spec coding workflow',
    requirements: 'Confirm requirements before generating workflow config',
    config: phaseConfig(workspace),
    ...overrides,
  };
}

function withValidTasksArtifact(specCoding: any) {
  return {
    ...specCoding,
    artifacts: {
      ...(specCoding.artifacts || {}),
      tasks: [
        '# tasks.md',
        '',
        '- [ ] T1 Confirm baseline spec',
        '  - [ ] T1.1 Confirm baseline spec detail <!-- spec-coding-task:T1.1 -->',
        '    - 需求追踪：R1',
        '    - 设计追踪：D1',
        '    - 动作：检查 requirements/design/tasks 是否一致。',
        '    - 交付：确认后的 SpecCoding 基线。',
        '    - 验证：人工确认所有计划制品通过质量校验。',
      ].join('\n'),
    },
  };
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('spec-coding API routes', () => {
  test('session routes require authentication before reading or writing sessions', async () => {
    await withIsolatedAceHome(async () => {
      await withTempWorkspace(async ({ workspace }) => {
        vi.resetModules();
        const { sessions, sessionById } = await loadSpecCodingRoutes();

        await assertErrorResponse(
          await sessions.GET(makeRequest('/api/spec-coding/sessions')),
          401
        );
        await assertErrorResponse(
          await sessions.POST(makeRequest('/api/spec-coding/sessions', { json: sessionPayload(workspace) })),
          401
        );
        await assertErrorResponse(
          await sessionById.GET(makeRequest('/api/spec-coding/sessions/missing'), idParams('missing')),
          401
        );
        await assertErrorResponse(
          await sessionById.PUT(makeRequest('/api/spec-coding/sessions/missing', {
            method: 'PUT',
            json: { requirements: 'unauthorized update' },
          }), idParams('missing')),
          401
        );
      });
    });
  });

  test('creates sessions, lists only the authenticated owner, and filters by chat session', async () => {
    await withIsolatedAceHome(async () => {
      await withTempWorkspace(async ({ workspace }) => {
        const owner = await createAuthToken();
        const other = await createAuthToken();
        const { sessions } = await loadSpecCodingRoutes();

        let response = await sessions.POST(makeRequest('/api/spec-coding/sessions', {
          token: owner.token,
          json: sessionPayload(workspace, { chatSessionId: 'chat-main' }),
        }));
        expect(response.status).toBe(200);
        const created = await responseJson<any>(response);
        expect(created.session.createdBy).toBe(owner.user.id);
        expect(created.session.workflowName).toBe('Spec Coding Workflow');
        expect(created.session.specCoding.status).toBe('draft');
        expect(created.session.specCoding.phases.map((phase: any) => phase.title)).toEqual(['Design', 'Implement']);
        expect(created.session.specCoding.assignments.map((assignment: any) => assignment.agent)).toEqual([
          'architect',
          'developer',
          'tester',
        ]);
        expect(created.session.artifactSnapshots).toHaveLength(1);
        expect(created.session.specCoding.artifacts.requirements).toContain('Confirm requirements before generating workflow config');
        expect(created.session.specCoding.artifacts.tasks).toContain('spec-coding-task:T1');

        response = await sessions.POST(makeRequest('/api/spec-coding/sessions', {
          token: owner.token,
          json: sessionPayload(workspace, {
            chatSessionId: 'chat-secondary',
            filename: 'secondary.yaml',
            workflowName: 'Secondary Workflow',
          }),
        }));
        expect(response.status).toBe(200);

        response = await sessions.POST(makeRequest('/api/spec-coding/sessions', {
          token: other.token,
          json: sessionPayload(workspace, {
            chatSessionId: 'chat-main',
            filename: 'other-user.yaml',
            workflowName: 'Other User Workflow',
          }),
        }));
        expect(response.status).toBe(200);

        response = await sessions.GET(makeRequest('/api/spec-coding/sessions', { token: owner.token }));
        expect(response.status).toBe(200);
        let json = await responseJson<any>(response);
        expect(json.sessions.map((session: any) => session.createdBy).every((id: string) => id === owner.user.id)).toBe(true);
        expect(json.sessions.map((session: any) => session.workflowName).sort()).toEqual([
          'Secondary Workflow',
          'Spec Coding Workflow',
        ]);

        response = await sessions.GET(makeRequest('/api/spec-coding/sessions?chatSessionId=chat-main', { token: owner.token }));
        expect(response.status).toBe(200);
        json = await responseJson<any>(response);
        expect(json.sessions).toHaveLength(1);
        expect(json.sessions[0].workflowName).toBe('Spec Coding Workflow');
      });
    });
  });

  test('session detail routes enforce ownership and append confirmation revisions', async () => {
    await withIsolatedAceHome(async () => {
      await withTempWorkspace(async ({ workspace }) => {
        const owner = await createAuthToken();
        const other = await createAuthToken();
        const { sessions, sessionById } = await loadSpecCodingRoutes();

        let response = await sessions.POST(makeRequest('/api/spec-coding/sessions', {
          token: owner.token,
          json: sessionPayload(workspace),
        }));
        expect(response.status).toBe(200);
        const created = await responseJson<any>(response);
        const sessionId = created.session.id;
        const initialSpecVersion = created.session.specCoding.version;

        await assertErrorResponse(
          await sessionById.GET(makeRequest(`/api/spec-coding/sessions/${sessionId}`, { token: other.token }), idParams(sessionId)),
          403
        );
        await assertErrorResponse(
          await sessionById.PUT(makeRequest(`/api/spec-coding/sessions/${sessionId}`, {
            token: other.token,
            method: 'PUT',
            json: { requirements: 'other user update' },
          }), idParams(sessionId)),
          403
        );
        await assertErrorResponse(
          await sessionById.GET(makeRequest('/api/spec-coding/sessions/missing', { token: owner.token }), idParams('missing')),
          404
        );

        response = await sessionById.PUT(makeRequest(`/api/spec-coding/sessions/${sessionId}`, {
          token: owner.token,
          method: 'PUT',
          json: {
            specCoding: withValidTasksArtifact(created.session.specCoding),
            specCodingStatus: 'confirmed',
            persistMode: 'repository',
            specRoot: '.custom-spec',
            revisionSummary: 'Confirm baseline spec before workflow generation',
          },
        }), idParams(sessionId));
        expect(response.status).toBe(200);
        const updated = await responseJson<any>(response);
        expect(updated.session.id).toBe(sessionId);
        expect(updated.session.specCoding.status).toBe('confirmed');
        expect(updated.session.specCoding.confirmedAt).toBeTruthy();
        expect(updated.session.specCoding.persistMode).toBe('repository');
        expect(updated.session.specCoding.specRoot).toBe('.custom-spec');
        expect(updated.session.specCoding.version).toBe(initialSpecVersion + 1);
        expect(updated.session.specCoding.revisions.at(-1).summary).toBe('Confirm baseline spec before workflow generation');
        expect(updated.session.specCoding.revisions.at(-1).createdBy).toBe(owner.user.id);
        expect(updated.session.artifactSnapshots.map((snapshot: any) => snapshot.version)).toEqual([1, 2]);

        response = await sessionById.GET(makeRequest(`/api/spec-coding/sessions/${sessionId}`, { token: owner.token }), idParams(sessionId));
        expect(response.status).toBe(200);
        const fetched = await responseJson<any>(response);
        expect(fetched.session.specCoding.status).toBe('confirmed');
        expect(fetched.session.specCoding.revisions.at(-1).summary).toBe('Confirm baseline spec before workflow generation');
      });
    });
  });

  test('session detail route accepts partial specCoding document updates when revising artifacts', async () => {
    await withIsolatedAceHome(async () => {
      await withTempWorkspace(async ({ workspace }) => {
        const owner = await createAuthToken();
        const { sessions, sessionById } = await loadSpecCodingRoutes();

        let response = await sessions.POST(makeRequest('/api/spec-coding/sessions', {
          token: owner.token,
          json: sessionPayload(workspace),
        }));
        expect(response.status).toBe(200);
        const created = await responseJson<any>(response);
        const sessionId = created.session.id;
        const originalSpec = withValidTasksArtifact(created.session.specCoding);

        response = await sessionById.PUT(makeRequest(`/api/spec-coding/sessions/${sessionId}`, {
          token: owner.token,
          method: 'PUT',
          json: {
            specCoding: {
              id: originalSpec.id,
              version: originalSpec.version,
              status: originalSpec.status,
              summary: '设计页手动修订 design.md',
              workflowName: originalSpec.workflowName,
              phases: originalSpec.phases,
              assignments: originalSpec.assignments,
              checkpoints: originalSpec.checkpoints,
              tasks: originalSpec.tasks,
              progress: originalSpec.progress,
              revisions: originalSpec.revisions,
              artifacts: {
                ...originalSpec.artifacts,
                design: `${originalSpec.artifacts.design}\n\n## Revised\n\nUpdated from design page.`,
              },
              linkedConfigFilename: originalSpec.linkedConfigFilename,
              createdAt: originalSpec.createdAt,
              updatedAt: new Date().toISOString(),
            },
            specCodingStatus: originalSpec.status,
            revisionSummary: '设计页手动修订 design.md',
          },
        }), idParams(sessionId));

        const updated = await responseJson<any>(response);
        expect(response.status).toBe(200);
        expect(updated.session.specCoding.title).toBe(originalSpec.title);
        expect(updated.session.specCoding.goals).toEqual(originalSpec.goals);
        expect(updated.session.specCoding.artifacts.design).toContain('## Revised');
        expect(updated.session.specCoding.version).toBe(originalSpec.version + 1);
      });
    });
  });

  test('session detail route rejects confirmed specCoding artifacts that are only format skeletons', async () => {
    await withIsolatedAceHome(async () => {
      await withTempWorkspace(async ({ workspace }) => {
        const owner = await createAuthToken();
        const { sessions, sessionById } = await loadSpecCodingRoutes();

        const response = await sessions.POST(makeRequest('/api/spec-coding/sessions', {
          token: owner.token,
          json: sessionPayload(workspace),
        }));
        expect(response.status).toBe(200);
        const created = await responseJson<any>(response);
        const sessionId = created.session.id;

        const badSpecCoding = {
          ...created.session.specCoding,
          artifacts: {
            requirements: '# requirements.md\n\n### 需求 R1：占位\n\nTODO',
            design: '# design.md\n\nTODO',
            tasks: '# tasks.md\n\n- [ ] T1.1 TODO',
          },
        };

        const rejected = await sessionById.PUT(makeRequest(`/api/spec-coding/sessions/${sessionId}`, {
          token: owner.token,
          method: 'PUT',
          json: {
            specCoding: badSpecCoding,
            specCodingStatus: 'confirmed',
          },
        }), idParams(sessionId));

        expect(rejected.status).toBe(400);
        const json = await responseJson<any>(rejected);
        expect(json.error).toContain('Spec 制品质量校验未通过');
        expect(json.qualityValidation.errors.length).toBeGreaterThan(0);
      });
    });
  });
});
