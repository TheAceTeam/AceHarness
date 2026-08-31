import { describe, expect, test, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { withIsolatedAceHome, withTempWorkspace } from './helpers/module-helpers';
import { assertErrorResponse, makeRequest, responseJson } from './helpers/route-helpers';

async function createAuthToken(label = 'template') {
  vi.resetModules();
  const { createUser, storeToken } = await import('@/lib/core/user-store');
  const suffix = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await createUser({
    username: suffix,
    email: `${suffix}@example.com`,
    password: 'password',
    question: 'q',
    answer: 'a',
    role: 'user',
    personalDir: '',
  });
  const token = `token-${suffix}`;
  storeToken(token, user.id);
  return { token, user };
}

describe('workflow templates', () => {
  test('lists valid built-in versioned template packages', async () => {
    await withIsolatedAceHome(async () => {
      const { token } = await createAuthToken();
      vi.resetModules();
      const { GET } = await import('@/server/api-routes/workflow-templates/route');

      const response = await GET(makeRequest('/api/workflow-templates', { token }));
      expect(response.status).toBe(200);
      const body = await responseJson<any>(response);
      expect(body.templates.map((template: any) => template.id)).toEqual(expect.arrayContaining([
        'general-red-blue-review',
        'issue-fix',
        'software-delivery',
      ]));
      expect(body.templates.every((template: any) => template.mode === 'state-machine')).toBe(true);
      expect(body.templates.every((template: any) => !('phaseCount' in template))).toBe(true);
      expect(body.templates.every((template: any) => template.version === '1.0.0')).toBe(true);
      expect(body.templates.every((template: any) => /^[a-f0-9]{64}$/.test(template.digest))).toBe(true);
      expect(body.issues).toEqual([]);
    });
  });

  test('instantiates a built-in template and records immutable provenance', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token } = await createAuthToken();
        vi.resetModules();
        const { POST } = await import('@/server/api-routes/workflow-templates/instantiate/route');

        const input = {
          source: 'builtin',
          id: 'general-red-blue-review',
          version: '1.0.0',
          filename: 'delivery-from-template.yaml',
          values: {
            workflowName: '交付实例',
            projectRoot: workspace,
            requirements: '默认背景：交付接口兼容性评估能力。',
          },
          agentMappings: {},
        };
        const response = await POST(makeRequest('/api/workflow-templates/instantiate', { token, json: input }));
        expect(response.status).toBe(201);
        const body = await responseJson<any>(response);
        expect(body.success).toBe(true);
        expect(body.templateRef).toMatchObject({ source: 'builtin', id: 'general-red-blue-review', version: '1.0.0' });
        expect(body.dependencyReport.missingAgents).toEqual([]);

        const config = parse(await readFile(path.join(aceHome, 'configs', input.filename), 'utf8'));
        expect(config.workflow.name).toBe('交付实例');
        expect(config.context.projectRoot).toBe(workspace);
        expect(config.context.requirements).toBe('默认背景：交付接口兼容性评估能力。');
        expect(config.workflow.mode).toBe('state-machine');
        expect(config.workflow.states).toHaveLength(4);
        expect(config.templateRef).toBeUndefined();

        const metadata = JSON.parse(await readFile(path.join(aceHome, 'configs', '.metadata.json'), 'utf8'));
        expect(metadata[input.filename].templateRef).toMatchObject({
          source: 'builtin',
          id: 'general-red-blue-review',
          version: '1.0.0',
        });
        expect(metadata[input.filename].templateRef.parameterKeys).toEqual([
          'description',
          'projectRoot',
          'requirements',
          'workflowName',
          'workspaceMode',
        ]);

        const duplicate = await POST(makeRequest('/api/workflow-templates/instantiate', { token, json: input }));
        const duplicateBody = await assertErrorResponse(duplicate, 409);
        expect(duplicateBody.code).toBe('WORKFLOW_CONFIG_EXISTS');
      });
    });
  });

  test('ships the joint PR fix template with optional default background and minimal issue-driven run input', async () => {
    await withIsolatedAceHome(async () => {
      const { token } = await createAuthToken();
      vi.resetModules();
      const { GET } = await import('@/server/api-routes/workflow-templates/route');

      const response = await GET(makeRequest('/api/workflow-templates?source=builtin&id=issue-fix&version=1.0.0', { token }));
      expect(response.status).toBe(200);
      const body = await responseJson<any>(response);
      expect(body.template).toMatchObject({ name: '联合 PR 缺陷修复' });
      expect(body.template.manifest.spec.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'requirements',
          label: '默认任务背景（可选）',
          purpose: 'default-task-background',
          required: false,
        }),
      ]));
      expect(body.template.workflow.context.taskInput.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'issueUrl', required: true }),
        expect.objectContaining({ id: 'targetBranch', required: false }),
        expect.objectContaining({ id: 'reproductionContract', required: false }),
        expect.objectContaining({ id: 'validationCommands', required: false }),
        expect.objectContaining({ id: 'deliveryPolicy', required: false }),
        expect.objectContaining({ id: 'gateContract', required: false }),
      ]));
      expect(body.template.workflow.context.taskInput.fields.filter((field: any) => field.required)).toEqual([
        expect.objectContaining({ id: 'issueUrl' }),
      ]);
      expect(body.template.workflow.context.taskInput.fields.find((field: any) => field.id === 'jointPrContract'))
        .toBeUndefined();
      expect(body.template.workflow.context.skills).toContain('aceharness-gitcode-ci-delivery');
      expect(body.template.workflow.workflow.states.map((state: any) => state.name)).toEqual(expect.arrayContaining([
        '上下文固化',
        '最小化用例',
        '描述与门禁',
        'PR 合入前检查与跟踪',
      ]));
      expect(body.template.workflow.workflow.transitionContractVersion).toBe(1);
      const gateState = body.template.workflow.workflow.states
        .find((state: any) => state.name === 'PR 合入前检查与跟踪');
      expect(gateState).toMatchObject({
        maxSelfTransitions: 1,
        transitionContract: {
          completionCriteria: expect.arrayContaining(['all-required-prs-merged', 'required-gates-passed']),
          selfLoop: {
            maxAttempts: 1,
            progressCriteria: ['ci-or-review-state-changed'],
          },
        },
      });
      expect(body.template.workflow.context.taskInput.fields.find((field: any) => field.id === 'gateContract'))
        .toMatchObject({ required: false, description: expect.stringContaining('conditional_pass') });
      expect(body.template.workflow.workflow.states.find((state: any) => state.name === '描述与门禁')?.steps[0].task)
        .toContain('不能直接提交 PR');
      const contextSteps = body.template.workflow.workflow.states
        .find((state: any) => state.name === '上下文固化')?.steps || [];
      expect(contextSteps.find((step: any) => step.name === '固化联合交付范围')?.task)
        .toContain('不得要求用户填写测试仓地址');
      const repairSteps = body.template.workflow.workflow.states
        .find((state: any) => state.name === '根因与修复')?.steps || [];
      expect(repairSteps.find((step: any) => step.name === '补充联合测试仓回归')?.task)
        .toContain('DEPENDENCE/EXEC/ERRCHECK/ASSERT');
      const prTrackingSteps = body.template.workflow.workflow.states
        .find((state: any) => state.name === 'PR 合入前检查与跟踪')?.steps || [];
      expect(prTrackingSteps.find((step: any) => step.name === '归因门禁失败与受控恢复')?.task)
        .toContain('suspected_transient');
      expect(prTrackingSteps.find((step: any) => step.name === '归因门禁失败与受控恢复')?.task)
        .toContain('botReadyEventId');
      expect(prTrackingSteps.find((step: any) => step.name === '同步 PR 合入前事实')?.task)
        .toContain('evidenceDigest');
      expect(prTrackingSteps.find((step: any) => step.name === '处理评审线程闭环')?.task)
        .toContain('不得代为 Resolve 他人线程');
      expect(prTrackingSteps.find((step: any) => step.name === '同步 PR 合入前事实')?.task)
        .toContain('gateContract.requiredPrs');
    });
  });

  test('saves an existing workflow as a sanitized private template', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const owner = await createAuthToken('owner');
        vi.resetModules();
        const { POST: createConfig } = await import('@/server/api-routes/configs/create/route');
        const sourceFilename = 'source-workflow.yaml';
        const createResponse = await createConfig(makeRequest('/api/configs/create', {
          token: owner.token,
          json: {
            filename: sourceFilename,
            workflowName: 'Source Workflow',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            mode: 'state-machine',
            skipSpecCoding: true,
          },
        }));
        expect(createResponse.status).toBe(200);

        const sourcePath = path.join(aceHome, 'configs', sourceFilename);
        const source = parse(await readFile(sourcePath, 'utf8'));
        source.workflow.states[0].steps[0].specTaskBinding = {
          taskIds: ['task-1'],
          requirementIds: ['requirement-1'],
          artifactKeys: [],
        };
        await writeFile(sourcePath, stringify(source), 'utf8');

        const nestedSourceFilename = 'team/企业授信审查.yaml';
        await mkdir(path.join(aceHome, 'configs', 'team'), { recursive: true });
        await writeFile(path.join(aceHome, 'configs', nestedSourceFilename), stringify(source), 'utf8');

        vi.resetModules();
        const { POST: saveTemplate, GET: listTemplates } = await import('@/server/api-routes/workflow-templates/route');
        const templateInput = {
          sourceFilename,
          id: 'source-workflow-template',
          version: '1.0.0',
          name: 'Source Template',
          description: 'Reusable source workflow',
          category: 'Test',
          tags: ['test'],
          visibility: 'private',
        };
        const saveResponse = await saveTemplate(makeRequest('/api/workflow-templates', {
          token: owner.token,
          json: templateInput,
        }));
        expect(saveResponse.status).toBe(201);

        const duplicateVersion = await saveTemplate(makeRequest('/api/workflow-templates', {
          token: owner.token,
          json: templateInput,
        }));
        expect((await assertErrorResponse(duplicateVersion, 409)).code).toBe('WORKFLOW_TEMPLATE_VERSION_EXISTS');

        const nextVersion = await saveTemplate(makeRequest('/api/workflow-templates', {
          token: owner.token,
          json: { ...templateInput, version: '1.1.0' },
        }));
        expect(nextVersion.status).toBe(201);

        const nestedSource = await saveTemplate(makeRequest('/api/workflow-templates', {
          token: owner.token,
          json: {
            ...templateInput,
            sourceFilename: nestedSourceFilename,
            id: 'nested-source-workflow-template',
          },
        }));
        expect(nestedSource.status).toBe(201);

        const templateWorkflowPath = path.join(
          aceHome,
          'templates',
          'workflows',
          'source-workflow-template',
          '1.0.0',
          'workflow.yaml',
        );
        const templateWorkflow = parse(await readFile(templateWorkflowPath, 'utf8'));
        expect(templateWorkflow.context.projectRoot).toBe('');
        expect(templateWorkflow.context.requirements).toBe('');
        expect(templateWorkflow.workflow.mode).toBe('state-machine');
        expect(templateWorkflow.workflow.states[0].steps[0].specTaskBinding).toBeUndefined();

        const ownerList = await responseJson<any>(await listTemplates(makeRequest('/api/workflow-templates', { token: owner.token })));
        const savedSummary = ownerList.templates.find((template: any) => template.id === 'source-workflow-template');
        expect(savedSummary).toMatchObject({ version: '1.1.0', versions: ['1.1.0', '1.0.0'] });

        const other = await createAuthToken('other');
        vi.resetModules();
        const { GET: listAsOther } = await import('@/server/api-routes/workflow-templates/route');
        const otherList = await responseJson<any>(await listAsOther(makeRequest('/api/workflow-templates', { token: other.token })));
        expect(otherList.templates.some((template: any) => template.id === 'source-workflow-template')).toBe(false);
      });
    });
  });

  test('rejects malformed identities and unauthenticated access', async () => {
    await withIsolatedAceHome(async () => {
      const { token } = await createAuthToken();
      vi.resetModules();
      const { GET } = await import('@/server/api-routes/workflow-templates/route');

      const malformed = await GET(makeRequest('/api/workflow-templates?source=builtin&id=..&version=1.0.0', { token }));
      const malformedBody = await assertErrorResponse(malformed, 400);
      expect(malformedBody.code).toBe('WORKFLOW_TEMPLATE_IDENTITY_INVALID');

      const unauthenticated = await GET(makeRequest('/api/workflow-templates'));
      await assertErrorResponse(unauthenticated, 401);
    });
  });
});
