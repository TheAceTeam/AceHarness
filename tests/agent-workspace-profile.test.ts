import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { describe, expect, test, vi } from 'vitest';
import { stringify } from 'yaml';
import { validateAgentDraft } from '@/lib/core/creator-validation';
import { withTempDir } from './helpers/module-helpers';

describe('agent workspace profile', () => {
  test('preserves optional workspaceProfile when validating agent YAML', () => {
    const result = validateAgentDraft({
      name: 'office-architect',
      team: 'red',
      roleType: 'normal',
      engineModels: {},
      activeEngine: '',
      capabilities: ['架构设计'],
      systemPrompt: '你是架构师。',
      workspaceProfile: {
        nickname: '老周',
        officeRole: 'engineering-lead',
        residency: {
          office: true,
          meetingRoom: true,
          defaultDirectRoom: true,
        },
        visual: {
          accent: 'orange',
          desk: 'desk-1',
          order: 10,
        },
        memory: {
          baseBudget: 5000,
          deepSearchEnabled: true,
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.normalized?.workspaceProfile).toMatchObject({
      nickname: '老周',
      officeRole: 'engineering-lead',
      residency: {
        office: true,
        meetingRoom: true,
        defaultDirectRoom: true,
      },
      visual: {
        accent: 'orange',
        desk: 'desk-1',
        order: 10,
      },
      memory: {
        baseBudget: 5000,
        deepSearchEnabled: true,
      },
    });
  });

  test('derives office and meeting room members from agent workspaceProfile', async () => {
    await withTempDir('aceharness-agent-workspace-profile-', async (dir) => {
      const agentsDir = path.join(dir, 'agents');
      await mkdir(agentsDir, { recursive: true });
      await writeFile(path.join(agentsDir, 'architect.yaml'), stringify({
        name: 'architect',
        team: 'red',
        roleType: 'normal',
        engineModels: {},
        activeEngine: '',
        capabilities: ['架构设计'],
        systemPrompt: '你是架构师。',
        workspaceProfile: {
          nickname: '老周',
          officeRole: 'engineering-lead',
          residency: {
            office: true,
            defaultDirectRoom: true,
          },
          visual: {
            order: 2,
          },
        },
      }), 'utf-8');
      await writeFile(path.join(agentsDir, 'reviewer.yaml'), stringify({
        name: 'reviewer',
        team: 'judge',
        roleType: 'normal',
        engineModels: {},
        activeEngine: '',
        capabilities: ['评审'],
        systemPrompt: '你是评审。',
        workspaceProfile: {
          displayName: '评审',
          residency: {
            meetingRoom: true,
          },
          visual: {
            order: 1,
          },
        },
      }), 'utf-8');

      vi.resetModules();
      vi.doMock('@/lib/run/runtime-configs', () => ({
        getRuntimeAgentsDirPath: async () => agentsDir,
      }));

      const { listCollaborationMembers } = await import('@/lib/collaboration/members');
      const officeMembers = await listCollaborationMembers({ spaceType: 'office' });
      const meetingMembers = await listCollaborationMembers({ spaceType: 'meeting-room' });

      expect(officeMembers.map((member) => member.agentName)).toEqual(['architect']);
      expect(officeMembers[0]).toMatchObject({
        displayName: '老周',
        officeRole: 'engineering-lead',
        participantKind: 'resident',
        defaultDirectRoom: true,
      });
      expect(meetingMembers.map((member) => member.agentName)).toEqual(['reviewer']);
      expect(meetingMembers[0]).toMatchObject({
        displayName: '评审',
        participantKind: 'resident',
      });
    });
  });
});
