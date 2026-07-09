import { describe, expect, test } from 'vitest';
import {
  runtimeAgentsToEngineAvailabilityMap,
  runtimeAgentsToEngineAvailabilityReports,
  type RuntimeAgentListItem,
} from '@/client/query/engines';

describe('client engine availability adapters', () => {
  const agents: RuntimeAgentListItem[] = [
    {
      id: 'unknown-agent',
      runtimeState: {
        availability: {
          status: 'unknown',
          checkedAt: '2026-07-09T03:00:00.000Z',
        },
      },
    },
    {
      id: 'missing-agent',
      runtimeState: {
        availability: {
          status: 'missing',
          checkedAt: '2026-07-09T03:01:00.000Z',
          message: 'missing command',
        },
      },
    },
    {
      id: 'error-agent',
      runtimeState: {
        availability: {
          status: 'error',
          checkedAt: '2026-07-09T03:02:00.000Z',
          message: 'probe failed',
        },
      },
    },
    {
      id: 'available-agent',
      runtimeState: {
        availability: {
          status: 'available',
          checkedAt: '2026-07-09T03:03:00.000Z',
        },
      },
    },
  ];

  test('reports preserve runtime agent availability diagnostics', () => {
    const reports = runtimeAgentsToEngineAvailabilityReports(agents);

    expect(reports['unknown-agent']).toMatchObject({
      diagnostics: {
        status: 'unknown',
      },
    });
    expect(reports['unknown-agent'].available).toBeUndefined();
    expect(reports['unknown-agent'].diagnostics?.checkedAt).toBeUndefined();
    expect(reports['missing-agent']).toMatchObject({
      available: false,
      diagnostics: {
        summary: 'missing command',
        checkedAt: '2026-07-09T03:01:00.000Z',
        error: 'missing command',
      },
    });
    expect(reports['error-agent']).toMatchObject({
      available: false,
      diagnostics: {
        summary: 'probe failed',
        checkedAt: '2026-07-09T03:02:00.000Z',
        error: 'probe failed',
      },
    });
    expect(reports['available-agent']).toMatchObject({
      available: true,
      diagnostics: {
        checkedAt: '2026-07-09T03:03:00.000Z',
      },
    });
  });

  test('refresh mutation availability map only marks available status true', () => {
    expect(runtimeAgentsToEngineAvailabilityMap(agents)).toEqual({
      'unknown-agent': false,
      'missing-agent': false,
      'error-agent': false,
      'available-agent': true,
    });
  });

  test('normalizes legacy engine ids to runtime agent ids', () => {
    const reports = runtimeAgentsToEngineAvailabilityReports([
      {
        id: 'claude-code',
        runtimeState: {
          availability: {
            status: 'available',
            checkedAt: '2026-07-09T03:04:00.000Z',
          },
        },
      },
      {
        id: 'kiro-cli',
        runtimeState: {
          availability: {
            status: 'missing',
            checkedAt: '2026-07-09T03:05:00.000Z',
          },
        },
      },
    ]);

    expect(reports.claude).toMatchObject({ engine: 'claude', available: true });
    expect(reports.kiro).toMatchObject({ engine: 'kiro', available: false });
    expect(reports['claude-code']).toBeUndefined();
    expect(reports['kiro-cli']).toBeUndefined();
  });
});
