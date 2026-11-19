// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkflowScriptExecutionDetails } from '@/components/workflow/WorkflowScriptExecution';
import { findScriptExecution, scriptExecutionLabel } from '@/lib/workflow/script-presentation';
import type { WorkflowStep } from '@/lib/core/schemas';

afterEach(cleanup);
const step: WorkflowStep = { name: '构建', type: 'script', agent: '', task: '', script: { interpreter: 'python', source: 'print("done")', timeoutMs: 120000, onFailure: { action: 'continue' } } };
describe('script execution presentation', () => {
  it('keeps zero exit codes and literal terminal output visible', () => {
    render(<WorkflowScriptExecutionDetails step={step} record={{stepName:'构建',status:'completed',scriptExitCode:0,durationMs:1274,scriptStdout:'<hello> **literal**',scriptStderr:''}} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('1.3秒')).toBeInTheDocument();
    expect(screen.getByText('<hello> **literal**')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.queryByText('Agent')).not.toBeInTheDocument();
  });
  it('distinguishes a nonzero script that continued from stopping the workflow', () => {
    render(<WorkflowScriptExecutionDetails step={step} record={{stepName:'构建',status:'failed',scriptExitCode:7,scriptFailureAction:'continue',scriptStdout:'',scriptStderr:'build failed'}} />);
    expect(screen.getByText('失败 · 继续')).toBeInTheDocument();
    expect(screen.getByText('继续执行下一步')).toBeInTheDocument();
    expect(screen.getByText('build failed')).toBeInTheDocument();
  });
  it('preserves historical output without requiring new metadata', () => {
    render(<WorkflowScriptExecutionDetails step={step} record={{stepName:'构建',status:'completed',output:'old terminal output'}} />);
    expect(screen.getByText('old terminal output')).toBeInTheDocument();
  });
  it('resolves qualified repeated names, iterations, and superseded attempts', () => {
    const records = [
      {id:'a1',stepName:'状态A-构建',status:'completed',timestamp:'2026-11-19T00:00:00Z'},
      {id:'b1',stepName:'状态B-构建',status:'failed',timestamp:'2026-11-19T01:00:00Z'},
      {id:'a2',stepName:'状态A-构建-迭代2',status:'failed',timestamp:'2026-11-19T02:00:00Z',superseded:true},
    ];
    expect(findScriptExecution(records,'状态A','构建')?.id).toBe('a1');
    expect(findScriptExecution(records,'状态B','构建')?.id).toBe('b1');
    expect(findScriptExecution(records,'状态C','构建')).toBeUndefined();
    expect(scriptExecutionLabel({stepName:'构建',status:'failed',scriptFailureAction:'transition'})).toBe('失败 · 转移');
  });
});
