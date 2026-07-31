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
