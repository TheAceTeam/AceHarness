import { describe, expect, it } from 'vitest';
import { extractWorkflowDraftPreview } from '../src/lib/ai/result-normalizers';
import { buildDashboardSystemPrompt } from '../src/lib/chat/system-prompt';
import { validateWorkflowDraft } from '../src/lib/core/creator-validation';

function createValidWorkflowDraft() {
  return {
    workflow: {
      name: 'Todo API',
      description: 'Build a todo API with authentication',
      mode: 'phase-based',
      phases: [
        {
          name: 'Implementation',
          steps: [
            {
              id: 'implement-auth',
              name: 'Implement authentication',
              agent: 'developer',
              task: 'Implement JWT login and auth middleware',
              specTaskBinding: {
                taskIds: ['T1.1'],
                requirementIds: ['req-auth'],
                artifactKeys: ['api-src'],
              },
            },
          ],
        },
      ],
      supervisor: {
        enabled: true,
        agent: 'default-supervisor',
        stageReviewEnabled: true,
        checkpointAdviceEnabled: true,
        scoringEnabled: true,
        experienceEnabled: true,
      },
    },
    context: {
      projectRoot: process.cwd(),
      workspaceMode: 'in-place',
      requirements: 'Build a REST API for a todo-list application with authentication',
    },
  };
}

describe('Workflow creation pipeline', () => {
  it('documents the current workflow creation protocol in the dashboard system prompt', async () => {
    const systemPrompt = await buildDashboardSystemPrompt();

    expect(systemPrompt).toContain('workflow_draft');
    expect(systemPrompt).toContain('home_sidebar');
    expect(systemPrompt).toContain('shouldOpenModal:true');
  });

  it('parses a workflow_draft result payload produced by the current protocol', () => {
    const config = createValidWorkflowDraft();
    const aiResponse = [
      '我已经整理好工作流草案。',
      '<result>',
      JSON.stringify({
        kind: 'workflow_draft',
        payload: {
          filename: 'todo-api.yaml',
          summary: 'Todo API workflow draft',
          config,
        },
      }, null, 2),
      '</result>',
    ].join('\n');

    const parsed = extractWorkflowDraftPreview(aiResponse, 'fallback.yaml');

    expect(parsed).toMatchObject({
      source: 'result-json',
      filename: 'todo-api.yaml',
      summary: 'Todo API workflow draft',
    });
    expect(parsed.config).toMatchObject({
      workflow: { name: 'Todo API', mode: 'phase-based' },
      context: { projectRoot: process.cwd() },
    });
  });

  it('accepts a valid phase-based workflow draft through the current validator', () => {
    const validation = validateWorkflowDraft(createValidWorkflowDraft());

    expect(validation.ok).toBe(true);
    expect(validation.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(validation.normalized).toMatchObject({
      workflow: { name: 'Todo API', mode: 'phase-based' },
      context: { workspaceMode: 'in-place' },
    });
  });

  it('rejects a workflow draft whose projectRoot is not an absolute path', () => {
    const validation = validateWorkflowDraft({
      ...createValidWorkflowDraft(),
      context: {
        projectRoot: './relative/path',
        workspaceMode: 'in-place',
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['context', 'projectRoot'],
          severity: 'error',
          message: expect.stringContaining('绝对路径'),
        }),
      ]),
    );
  });

  it('does not confuse home_sidebar payloads with workflow_draft payloads', () => {
    const aiResponse = `
<result>
{
  "kind": "home_sidebar",
  "payload": {
    "shouldOpenModal": true,
    "workflowDraft": {
      "name": "Todo API"
    }
  }
}
</result>
`;

    const parsed = extractWorkflowDraftPreview(aiResponse, 'todo-api.yaml');

    expect(parsed.source).toBe('none');
    expect(parsed.config).toBeNull();
    expect(parsed.parseError).toBeTruthy();
  });
});
